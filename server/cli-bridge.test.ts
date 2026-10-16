import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventType, type AdapterYieldChunk } from '@tanstack/ai';
import { relayToolCalls } from '../src/assistant/relay';
import { TOOL_CALL_EVENT, TOOL_RESULT_URL, ToolCallEventSchema } from '../src/assistant/relay-wire';
import { TOOL_DEFINITIONS } from '../src/assistant/tools';
import { CliBridge } from './cli-bridge';

// Stands in for `claude -p`: the test writes its stream-json lines and decides when it exits.
class FakeCli extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  constructor(readonly args: string[]) { super(); }
  line(e: object): void { this.stdout.write(`${JSON.stringify(e)}\n`); }
  event(ev: object): void { this.line({ type: 'stream_event', event: ev }); }
  exit(code: number | null): void { setImmediate(() => this.emit('close', code)); }
  kill(): boolean { this.killed = true; this.exit(null); return true; }
}

const THREAD = '0b6f1f9e-3c41-4c1a-9d55-2f3e8f2a7c10';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.unstubAllGlobals(); });

// One run on a bridge with a fake CLI: its chunks, the CLI, and an MCP client with the URL the CLI was given.
async function startRun(o: { toolTimeoutMs?: number } = {}) {
  const workdir = mkdtempSync(join(tmpdir(), 'cli-bridge-test-'));
  dirs.push(workdir);
  const clis: FakeCli[] = [];
  const bridge = new CliBridge({ workdir, ...o, spawn: (_bin, args) => { const c = new FakeCli(args); clis.push(c); return c as unknown as ChildProcess; } });
  const abortController = new AbortController();
  const adapter = bridge.adapter({ host: '127.0.0.1:1', continued: false });
  const chunks: AdapterYieldChunk[] = [];
  // What chat() hands the adapter (its logger stays unused: the adapter doesn't log).
  const logger = {} as Parameters<typeof adapter.chatStream>[0]['logger'];
  const options = { model: 'claude-code', messages: [{ role: 'user' as const, content: 'make it red' }], threadId: THREAD, runId: 'run-1', tools: [...TOOL_DEFINITIONS], abortController, logger };
  const done = (async () => { for await (const c of adapter.chatStream(options)) chunks.push(c); })();
  await vi.waitFor(() => expect(clis).toHaveLength(1));
  const cli = clis[0]!;
  const mcpConfig = JSON.parse(readFileSync(cli.args[cli.args.indexOf('--mcp-config') + 1]!, 'utf8'));
  const mcpUrl = new URL(mcpConfig.mcpServers.hallucinate.url);
  let id = 0;
  const mcp = (method: string, params?: object, url = mcpUrl) => Promise.resolve(bridge.routes['/mcp']!({ jsonrpc: '2.0', id: ++id, method, params }, url));
  const post = (body: unknown) => Promise.resolve(bridge.routes['/tool-result']!(body, new URL(`http://x${TOOL_RESULT_URL}`)));
  const ofType = <T extends EventType>(type: T) => chunks.filter((c): c is Extract<AdapterYieldChunk, { type: T | `${T}` }> => c.type === type);
  const toolCallEvent = async () => {
    await vi.waitFor(() => expect(ofType(EventType.CUSTOM)).toHaveLength(1));
    const ev = ofType(EventType.CUSTOM)[0]!;
    expect(ev.name).toBe(TOOL_CALL_EVENT);
    return ToolCallEventSchema.parse(ev.value);
  };
  return { bridge, cli, chunks, done, abortController, mcpUrl, mcp, post, ofType, toolCallEvent };
}

// The CLI streams a set_look tool_use block, as the model writes it.
function streamToolUse(cli: FakeCli, id = 'toolu_1') {
  cli.line({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'hallucinate', status: 'connected' }] });
  cli.event({ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 90 } } });
  cli.event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  cli.event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Making it red.' } });
  cli.event({ type: 'content_block_stop', index: 0 });
  cli.event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'mcp__hallucinate__set_look' } });
  cli.event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"hue":' } });
  cli.event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '0}' } });
  cli.event({ type: 'content_block_stop', index: 1 });
}

describe('the CLI bridge: a tool call round trip', () => {
  it('relays an MCP tools/call as the tool call event, and the posted result answers the MCP call', async () => {
    const r = await startRun();
    streamToolUse(r.cli);
    expect((await r.mcp('initialize', { protocolVersion: '2025-06-18' })).body).toMatchObject({ result: { serverInfo: { name: 'hallucinate' } } });
    const list = (await r.mcp('tools/list')).body as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOL_DEFINITIONS.map((t) => t.name));
    expect(list.result.tools[0]!.inputSchema.type).toBe('object');
    await vi.waitFor(() => expect(r.ofType(EventType.TOOL_CALL_END)).toHaveLength(1));

    const answered = r.mcp('tools/call', { name: 'set_look', arguments: { hue: 0 } });
    const ev = await r.toolCallEvent();
    expect(ev).toMatchObject({ threadId: THREAD, toolCallId: 'toolu_1', name: 'set_look', input: { hue: 0 } });

    expect(await r.post({ threadId: THREAD, callId: ev.callId, result: { content: [{ type: 'text', text: 'Look set.' }] } })).toEqual({ status: 200, body: { ok: true } });
    expect((await answered).body).toMatchObject({ result: { content: [{ type: 'text', text: 'Look set.' }] } });
    await vi.waitFor(() => expect(r.ofType(EventType.TOOL_CALL_RESULT)).toEqual([expect.objectContaining({ toolCallId: 'toolu_1', content: 'Look set.' })]));
    // Answered once: a second answer finds nothing waiting.
    expect((await r.post({ threadId: THREAD, callId: ev.callId, result: { content: [] } })).status).toBe(404);

    r.cli.line({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 });
    r.cli.exit(0);
    await r.done;
    expect(r.chunks[0]!.type).toBe(EventType.RUN_STARTED);
    expect(r.chunks.at(-1)).toMatchObject({ type: EventType.RUN_FINISHED, threadId: THREAD, runId: 'run-1', usage: { promptTokens: 10, completionTokens: 5 } });
  });

  it('translates the stream-json into text, tool call and usage chunks under the tool_use id', async () => {
    const r = await startRun();
    streamToolUse(r.cli);
    r.cli.line({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5 } });
    r.cli.exit(0);
    await r.done;
    expect(r.chunks.map((c) => c.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED,
    ]);
    expect(r.ofType(EventType.TOOL_CALL_START)[0]).toMatchObject({ toolCallId: 'toolu_1', toolName: 'set_look' });
    expect(r.ofType(EventType.TOOL_CALL_END)[0]).toMatchObject({ toolCallId: 'toolu_1', input: { hue: 0 } });
    expect(r.ofType(EventType.RUN_FINISHED)[0]).toMatchObject({ usage: { providerUsageDetails: { contextTokens: 100 } } });
    expect(r.cli.args[r.cli.args.indexOf('--session-id') + 1]).toBe(THREAD);
  });

  it('rejects an unknown chat or token, a malformed result and an unknown call id', async () => {
    const r = await startRun();
    const wrongToken = new URL(r.mcpUrl);
    wrongToken.searchParams.set('token', 'nope');
    expect((await r.mcp('tools/list', undefined, wrongToken)).status).toBe(403);
    const otherChat = new URL(r.mcpUrl);
    otherChat.searchParams.set('chat', 'someone-else');
    expect((await r.mcp('tools/list', undefined, otherChat)).status).toBe(403);
    expect(await r.post({ threadId: THREAD, callId: 'x', result: { content: 'not a list' } })).toEqual({ status: 400, body: { error: 'Bad tool result' } });
    expect(await r.post({ threadId: THREAD, callId: 'no-such-call', result: { content: [] } })).toEqual({ status: 404, body: { error: 'No such tool call (it may have timed out).' } });
    expect((await r.post({ threadId: 'no-such-thread', callId: 'x', result: { content: [] } })).status).toBe(404);
    r.cli.exit(0);
    await r.done;
  });

  it('answers the CLI with an error once the app takes too long, and refuses the late result', async () => {
    const r = await startRun({ toolTimeoutMs: 20 });
    streamToolUse(r.cli);
    const answered = r.mcp('tools/call', { name: 'set_look', arguments: { hue: 0 } });
    const ev = await r.toolCallEvent();
    expect((await answered).body).toMatchObject({ result: { content: [{ type: 'text', text: 'The app didn\'t answer in time.' }], isError: true } });
    expect((await r.post({ threadId: THREAD, callId: ev.callId, result: { content: [] } })).status).toBe(404);
    expect(r.ofType(EventType.TOOL_CALL_RESULT)).toHaveLength(0);
    r.cli.exit(0);
    await r.done;
  });

  it('stops the CLI on abort, and a call still waiting gets an error result', async () => {
    const r = await startRun();
    streamToolUse(r.cli);
    const answered = r.mcp('tools/call', { name: 'set_look', arguments: {} });
    await r.toolCallEvent();
    r.abortController.abort();
    expect(r.cli.killed).toBe(true);
    expect((await answered).body).toMatchObject({ result: { content: [{ text: 'The request ended before the app answered.' }], isError: true } });
    await r.done;
    expect(r.ofType(EventType.RUN_ERROR)).toHaveLength(0);   // a stop is not an error
    // The run is over: the next call finds no app to run it.
    expect((await r.mcp('tools/call', { name: 'set_look', arguments: {} })).body).toMatchObject({ result: { isError: true, content: [{ text: 'The app isn\'t connected.' }] } });
  });

  it('forgets a conversation: its CLI is stopped and its MCP URL no longer works', async () => {
    const r = await startRun();
    expect(await r.bridge.routes['/new']!({ threadId: THREAD }, r.mcpUrl)).toEqual({ status: 200, body: { ok: true } });
    expect(r.cli.killed).toBe(true);
    expect((await r.mcp('tools/list')).status).toBe(403);
    await r.done;
  });
});

describe('the browser relay and the bridge agree on the wire', () => {
  it('the relay runs the event the bridge sends and posts a result the bridge accepts', async () => {
    const r = await startRun();
    streamToolUse(r.cli);
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => { posts.push({ url, body: JSON.parse(String(init.body)) }); return Promise.resolve(new Response('{}')); });
    const runner = vi.fn(() => Promise.resolve([{ type: 'text', content: 'Look set.' }, { type: 'image', source: { type: 'data', value: 'AAAA', mimeType: 'image/jpeg' } }]));

    const answered = r.mcp('tools/call', { name: 'set_look', arguments: { hue: 0.5 } });
    await r.toolCallEvent();
    const ev = r.ofType(EventType.CUSTOM)[0]!;
    relayToolCalls(runner)(ev.name, ev.value);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(runner).toHaveBeenCalledWith('set_look', { hue: 0.5 });
    expect(posts[0]!.url).toBe('/api/assistant/tool-result');

    expect(await r.post(posts[0]!.body)).toEqual({ status: 200, body: { ok: true } });
    expect((await answered).body).toMatchObject({ result: { content: [{ type: 'text', text: 'Look set.' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }], isError: false } });
    await vi.waitFor(() => expect(r.ofType(EventType.TOOL_CALL_RESULT)[0]).toMatchObject({ toolCallId: 'toolu_1', content: 'Look set.\n(image)' }));
    r.cli.exit(0);
    await r.done;
  });

  it('a tool that throws reaches the bridge as an error result', async () => {
    const r = await startRun();
    streamToolUse(r.cli);
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => { posts.push(JSON.parse(String(init.body))); return Promise.resolve(new Response('{}')); });
    const answered = r.mcp('tools/call', { name: 'set_look', arguments: {} });
    await r.toolCallEvent();
    const ev = r.ofType(EventType.CUSTOM)[0]!;
    relayToolCalls(() => Promise.reject(new Error('No such scene')))(ev.name, ev.value);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect((await r.post(posts[0])).status).toBe(200);
    expect((await answered).body).toMatchObject({ result: { content: [{ type: 'text', text: 'No such scene' }], isError: true } });
    await vi.waitFor(() => expect(r.ofType(EventType.TOOL_CALL_RESULT)[0]).toMatchObject({ state: 'output-error' }));
    r.cli.exit(0);
    await r.done;
  });
});

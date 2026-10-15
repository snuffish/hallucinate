// A TanStack AI text adapter that runs the user's Claude subscription through the local Claude Code
// CLI, locked down: no built-in tools (`--tools ''`: no files, no shell), none of the user's settings
// (`--setting-sources ''`), a throw-away working directory, and ONLY this app's tools, offered to the CLI as a tiny MCP server at
// /api/assistant/mcp. Every tool call is handed to the browser (which owns the renderer and
// editors) as a CUSTOM stream event and answered through POST /api/assistant/tool-result.
//
// TanStack's own @tanstack/ai-claude-code adapter cannot be made tool-free (verified 2026-10-13:
// `disallowedTools` is not exhaustive and `--tools ''` is only emitted when our tools are dropped too).

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventType, type AdapterYieldChunk, type AnyTool, type DefaultMessageMetadataByModality, type ModelMessage, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import { z } from 'zod';

export const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const SERVER = 'hallucinate';
const PREFIX = `mcp__${SERVER}__`;
const WORKDIR = join(tmpdir(), 'hallucinate-assistant');   // keeps these sessions apart from the user's projects
const TOOL_TIMEOUT_MS = 120_000;
const DEBUG = !!process.env.ASSISTANT_DEBUG;   // log the CLI arguments, MCP traffic and stderr
const debug = (...args: unknown[]) => { if (DEBUG) console.error('[assistant]', ...args); };

export interface ClaudeCliProviderOptions {
  // Host header of the dev server, so the CLI can reach the MCP endpoint.
  host?: string;
  // The conversation already has replies (the browser keeps the history): resume its CLI session.
  continued?: boolean;
}

interface PendingCall { resolve: (result: McpResult) => void; toolCallId: string; name: string }
interface Session {
  token: string;
  sessionId: string;
  started: boolean;
  proc: ChildProcess | null;
  push: ((chunk: AdapterYieldChunk) => void) | null;   // the stream of the message in flight
  uses: { id: string; name: string; claimed: boolean }[];
  pending: Map<string, PendingCall>;
  tools: AnyTool[];
}
export interface McpResult { content: { type: 'text'; text: string }[] | { type: 'image'; data: string; mimeType: string }[] | ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean }

const sessions = new Map<string, Session>();   // threadId -> session

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The browser names each conversation with a UUID; the CLI session reuses it, so a conversation finds
// its session again after the dev server restarts.
function sessionFor(threadId: string): Session {
  let s = sessions.get(threadId);
  if (!s) { s = { token: randomUUID(), sessionId: UUID.test(threadId) ? threadId : randomUUID(), started: false, proc: null, push: null, uses: [], pending: new Map(), tools: [] }; sessions.set(threadId, s); }
  return s;
}

const toolError = (text: string): McpResult => ({ content: [{ type: 'text', text }], isError: true });

// Simple push-based async iterable: the process parser and the MCP bridge both feed it.
class Channel<T> {
  private queue: T[] = [];
  private waiters: ((v: IteratorResult<T>) => void)[] = [];
  private closed = false;
  push(v: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false }); else this.queue.push(v);
  }
  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as T, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const v = this.queue.shift();
        if (v !== undefined) return Promise.resolve({ value: v, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// The latest user turn as plain text (the CLI keeps the conversation in its own session).
function latestUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => ('content' in p && typeof p.content === 'string' ? p.content : '')).filter(Boolean).join('\n');
  }
  return '';
}

export class ClaudeCliAdapter extends BaseTextAdapter<string, ClaudeCliProviderOptions, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'claude-cli';
  override readonly inputModalities = ['text'] as const;

  // Host of the dev server (from the request), so the CLI can reach the MCP endpoint.
  host = 'localhost:5173';

  constructor(model: string | undefined, private readonly effort: string | undefined) {
    super({}, model ?? 'claude-code');
  }

  structuredOutput(_options: StructuredOutputOptions<ClaudeCliProviderOptions>): Promise<never> {
    return Promise.reject(new Error('Structured output is not supported by the Claude Code backend.'));
  }

  async *chatStream(options: TextOptions<ClaudeCliProviderOptions>): AsyncIterable<AdapterYieldChunk> {
    const model = this.model;
    const now = () => Date.now();
    const runId = options.runId ?? this.generateId();
    const threadId = options.threadId ?? this.generateId();
    const session = sessionFor(threadId);
    const host = options.modelOptions?.host ?? this.host;
    session.tools = options.tools ?? [];
    // A conversation reopened from the browser's history after a server restart: its CLI session exists on disk.
    if (options.modelOptions?.continued && !session.started) session.started = true;

    // The previous message's process may still be exiting after its result: give it a moment.
    if (session.proc) await new Promise<void>((resolve) => { session.proc?.once('close', () => resolve()); setTimeout(resolve, 5000); });
    if (session.proc) {
      yield { type: EventType.RUN_ERROR, model, timestamp: now(), message: 'The assistant is still working on the previous message.', code: 'busy', error: { message: 'busy', code: 'busy' } };
      return;
    }

    const system = (options.systemPrompts ?? []).map((p) => (typeof p === 'string' ? p : p.content)).join('\n\n');
    const text = latestUserText(options.messages);
    const mcp = { mcpServers: { [SERVER]: { type: 'http', url: `http://${host}/api/assistant/mcp?chat=${encodeURIComponent(threadId)}&token=${session.token}` } } };
    mkdirSync(WORKDIR, { recursive: true });
    // The CLI wants the MCP config as a file (inline JSON is silently ignored by recent versions).
    const mcpPath = join(WORKDIR, `mcp-${session.token}.json`);
    writeFileSync(mcpPath, JSON.stringify(mcp));
    const argsFor = (resume: boolean) => [
      '--setting-sources', '',                             // none of the user's CLAUDE.md, plugins, hooks or settings
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '',                                       // no built-in tools: no files, no shell
      '--mcp-config', mcpPath, '--strict-mcp-config',
      '--allowedTools', session.tools.map((t) => PREFIX + t.name).join(','),
      '--system-prompt', `${system}\n\n(Your tools come from the "${SERVER}" MCP server, so their names carry the prefix ${PREFIX}.)`,
      '--disable-slash-commands',                          // (no --safe-mode: it silently disables MCP servers, i.e. our tools)
      ...(resume ? ['--resume', session.sessionId] : ['--session-id', session.sessionId]),
      ...(this.model !== 'claude-code' ? ['--model', this.model] : []),
      ...(this.effort ? ['--effort', this.effort] : []),
    ];

    const chunks = new Channel<AdapterYieldChunk>();
    session.push = (c) => chunks.push(c);
    const push = session.push;
    let finished = false;
    let textId: string | null = null, reasoningId: string | null = null;
    let context = 0;                                       // input tokens of the newest model call: the conversation's size
    const toolArgs = new Map<string, { name: string; args: string }>();

    push({ type: EventType.RUN_STARTED, runId, threadId, model, timestamp: now() });

    const endText = () => { if (textId) { push({ type: EventType.TEXT_MESSAGE_END, messageId: textId, model, timestamp: now() }); textId = null; } };
    const endReasoning = () => {
      if (!reasoningId) return;
      push({ type: EventType.REASONING_MESSAGE_END, messageId: reasoningId, model, timestamp: now() });
      push({ type: EventType.REASONING_END, messageId: reasoningId, model, timestamp: now() });
      reasoningId = null;
    };

    const handleLine = (line: string, onInit: () => void) => {
      let e: Record<string, unknown>;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type === 'system' && e.subtype === 'init') {
        session.started = true;
        onInit();
        debug('init', JSON.stringify({ mcp_servers: e.mcp_servers, tools: e.tools, model: e.model }).slice(0, 600));
      }
      if (e.type === 'stream_event') {
        const ev = e.event as Record<string, unknown> & { content_block?: { type: string; id?: string; name?: string }; delta?: Record<string, string>; index?: number; message?: { usage?: CliUsage } };
        if (ev.type === 'message_start' && ev.message?.usage) context = promptOf(ev.message.usage);
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          endText(); endReasoning();
          const name = (ev.content_block.name ?? '').replace(PREFIX, '');
          const id = ev.content_block.id ?? randomUUID();
          session.uses.push({ id, name, claimed: false });
          toolArgs.set(String(ev.index), { name, args: '' });
          push({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name, toolName: name, model, timestamp: now() });
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta') {
            endReasoning();
            if (!textId) { textId = randomUUID(); push({ type: EventType.TEXT_MESSAGE_START, messageId: textId, model, timestamp: now(), role: 'assistant' }); }
            push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textId, model, timestamp: now(), delta: ev.delta.text ?? '', content: ev.delta.text ?? '' });
          } else if (ev.delta.type === 'thinking_delta') {
            endText();
            if (!reasoningId) {
              reasoningId = randomUUID();
              push({ type: EventType.REASONING_START, messageId: reasoningId, model, timestamp: now() });
              push({ type: EventType.REASONING_MESSAGE_START, messageId: reasoningId, role: 'reasoning', model, timestamp: now() });
            }
            push({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningId, delta: ev.delta.thinking ?? '', model, timestamp: now() });
          } else if (ev.delta.type === 'input_json_delta') {
            const t = toolArgs.get(String(ev.index));
            const use = session.uses.find((u) => u.name === t?.name && !u.claimed);
            if (t && use) {
              t.args += ev.delta.partial_json ?? '';
              push({ type: EventType.TOOL_CALL_ARGS, toolCallId: use.id, model, timestamp: now(), delta: ev.delta.partial_json ?? '', args: t.args });
            }
          }
        } else if (ev.type === 'content_block_stop') {
          const t = toolArgs.get(String(ev.index));
          if (t) {
            const use = [...session.uses].reverse().find((u) => u.name === t.name);
            let input: unknown = {};
            try { input = t.args ? JSON.parse(t.args) : {}; } catch { /* streamed JSON may be incomplete; the MCP call carries the real input */ }
            if (use) push({ type: EventType.TOOL_CALL_END, toolCallId: use.id, toolCallName: t.name, toolName: t.name, model, timestamp: now(), input });
            toolArgs.delete(String(ev.index));
          } else { endText(); endReasoning(); }
        } else if (ev.type === 'message_stop') { endText(); endReasoning(); }
      } else if (e.type === 'result') {
        finished = true;
        endText(); endReasoning();
        const usage = cliUsage(e.usage as CliUsage | undefined, e.total_cost_usd, context);
        if (e.is_error) {
          const message = e.subtype === 'error_max_turns' ? 'Stopped: the assistant took too many steps. Ask it to continue.' : `Claude Code reported an error: ${String(e.result ?? e.subtype ?? 'unknown')}`;
          push({ type: EventType.RUN_ERROR, model, timestamp: now(), message, code: String(e.subtype ?? 'error'), error: { message, code: String(e.subtype ?? 'error') }, ...(usage && { usage }) });
        } else {
          push({ type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now(), finishReason: 'stop', ...(usage && { usage }) });
        }
      }
    };

    // One CLI process. A session that can't be resumed (the CLI deleted it) or can't be created (it
    // already exists) is retried once the other way; a lost session continues from a transcript.
    let proc: ChildProcess;
    const launch = (resume: boolean, prompt: string, retried: boolean) => {
      const args = argsFor(resume);
      debug('spawn', CLAUDE_BIN, args.map((a) => (a.length > 200 ? `${a.slice(0, 200)}…` : a)));
      const p = spawn(CLAUDE_BIN, args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'] });
      proc = p;
      session.proc = p;
      session.uses = [];
      p.stdin!.end(prompt);
      let stderr = '', rest = '', init = false;
      p.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); debug('stderr', d.toString().trim()); });
      p.stdout!.on('data', (d: Buffer) => {
        const lines = (rest + d.toString()).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) handleLine(line, () => { init = true; });
      });
      p.on('error', (err: NodeJS.ErrnoException) => {
        finished = true;
        const message = err.code === 'ENOENT' ? 'Claude Code (the `claude` command) wasn\'t found. Install it and sign in with your subscription, then restart the dev server.' : err.message;
        push({ type: EventType.RUN_ERROR, model, timestamp: now(), message, code: 'spawn', error: { message, code: 'spawn' } });
        chunks.close();
      });
      p.on('close', (code) => {
        if (session.proc === p) session.proc = null;
        const retry = !finished && !init && !retried && code !== null && code !== 0 ? sessionRetry(resume, stderr) : null;
        if (retry && !aborted) {
          debug('session retry', retry, stderr.trim().split('\n').pop());
          if (retry === 'new') { session.sessionId = randomUUID(); session.started = false; }
          launch(retry === 'resume', retry === 'new' ? withTranscript(options.messages, text) : text, true);
          return;
        }
        try { rmSync(mcpPath, { force: true }); } catch { /* already gone */ }
        for (const pc of session.pending.values()) pc.resolve(toolError('The request ended before the app answered.'));
        session.pending.clear();
        if (!finished && code !== null) {
          const message = describeExit(stderr, code);
          push({ type: EventType.RUN_ERROR, model, timestamp: now(), message, code: 'exit', error: { message, code: 'exit' } });
        }
        session.push = null;
        chunks.close();
      });
    };
    let aborted = false;
    launch(session.started, text, false);

    const onAbort = () => { aborted = true; if (session.proc === proc && !proc.killed) proc.kill('SIGTERM'); };   // Stop pressed
    options.abortController?.signal.addEventListener('abort', onAbort, { once: true });

    try {
      for await (const chunk of chunks) yield chunk;
    } finally {
      options.abortController?.signal.removeEventListener('abort', onAbort);
      onAbort();
    }
  }

  // POST /api/assistant/new — forget a conversation.
  static forget(threadId: string): void {
    const s = sessions.get(threadId);
    s?.proc?.kill('SIGTERM');
    sessions.delete(threadId);
  }

  // POST /api/assistant/tool-result { threadId, callId, result } — the browser's answer to a tool call.
  static answer(threadId: string, callId: string, result: McpResult): boolean {
    const s = sessions.get(threadId);
    const p = s?.pending.get(callId);
    if (!s || !p) return false;
    s.pending.delete(callId);
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '(image)')).join('\n');
    s.push?.({ type: EventType.TOOL_CALL_RESULT, toolCallId: p.toolCallId, messageId: randomUUID(), model: 'claude-code', timestamp: Date.now(), content: text, ...(result.isError && { state: 'output-error' as const }) });
    p.resolve(result);
    return true;
  }

  // The MCP server Claude Code connects to: initialize, tools/list, tools/call (JSON-RPC over HTTP).
  static async handleMcp(req: IncomingMessage, res: ServerResponse, url: URL, body: { id?: unknown; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } }): Promise<void> {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const threadId = url.searchParams.get('chat') ?? '';
    const s = sessions.get(threadId);
    if (!s || url.searchParams.get('token') !== s.token) { debug('mcp rejected', threadId, !!s); return json(res, 403, { error: 'unknown chat' }); }
    const reply = (result: unknown) => json(res, 200, { jsonrpc: '2.0', id: body.id, result });
    debug('mcp', body.method, body.method === 'tools/call' ? body.params?.name : '', 'tools:', s.tools.length);
    switch (body.method) {
      case 'initialize':
        return reply({ protocolVersion: body.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SERVER, version: '2.0.0' } });
      case 'tools/list':
        return reply({ tools: s.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: schemaOf(t) })) });
      case 'tools/call':
        return reply(await callInBrowser(threadId, s, body.params?.name ?? '', body.params?.arguments ?? {}));
      case 'ping':
        return reply({});
      default:
        if (body.id === undefined) { res.writeHead(202).end(); return; }
        return json(res, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `Unknown method ${body.method}` } });
    }
  }
}

// Our tools are defined with zod; the CLI wants plain JSON Schema.
function schemaOf(tool: AnyTool): unknown {
  const schema = (tool as { inputSchema?: unknown }).inputSchema;
  if (schema instanceof z.ZodType) return z.toJSONSchema(schema);
  return schema ?? { type: 'object', properties: {} };
}

// Hands a tool call to the browser and waits for its answer. The tool_use id from the stream is
// matched by name and order, so the panel can update the right chip.
function callInBrowser(threadId: string, s: Session, name: string, input: unknown): Promise<McpResult> {
  if (!s.push) return Promise.resolve(toolError('The app isn\'t connected.'));
  const use = s.uses.find((u) => !u.claimed && u.name === name);
  if (use) use.claimed = true;
  const callId = randomUUID();
  const toolCallId = use?.id ?? callId;
  s.push({ type: EventType.CUSTOM, model: 'claude-code', timestamp: Date.now(), name: 'hallucinate.tool_call', value: { threadId, callId, toolCallId, name, input } });
  return new Promise((resolve) => {
    s.pending.set(callId, { resolve, toolCallId, name });
    setTimeout(() => {
      if (!s.pending.has(callId)) return;
      s.pending.delete(callId);
      resolve(toolError('The app didn\'t answer in time.'));
    }, TOOL_TIMEOUT_MS);
  });
}

// ---------- Usage and lost sessions ----------

interface CliUsage { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const promptOf = (u: CliUsage) => n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);

// The CLI's `result` usage (every model call of the run, summed) in TanStack's TokenUsage shape, the
// way the Anthropic adapter reports it. `contextTokens`: the newest call's input, i.e. what one more
// message resends. `cost`: the CLI's API-equivalent figure (not a bill on a subscription).
export function cliUsage(u: CliUsage | undefined, cost: unknown, context: number) {
  if (!u) return undefined;
  const prompt = promptOf(u), completion = n(u.output_tokens);
  const cacheRead = n(u.cache_read_input_tokens), cacheWrite = n(u.cache_creation_input_tokens);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    ...((cacheRead || cacheWrite) && { promptTokensDetails: { ...(cacheRead && { cachedTokens: cacheRead }), ...(cacheWrite && { cacheWriteTokens: cacheWrite }) } }),
    ...(Number.isFinite(Number(cost)) && cost !== undefined && cost !== null && { cost: Number(cost) }),
    providerUsageDetails: { contextTokens: context || prompt },
  };
}

// Whether a CLI that failed before starting should be retried: `resume` when --session-id says the
// session exists, `new` when --resume can't find it (the CLI cleaned it up).
export function sessionRetry(resumed: boolean, stderr: string): 'resume' | 'new' | null {
  if (!resumed && /already in use|already exists/i.test(stderr)) return 'resume';
  if (resumed && /no conversation found|not found|does not exist|no session/i.test(stderr)) return 'new';
  return null;
}

const TRANSCRIPT_CHARS = 8000;

// A lost session continues from the conversation as text: the newest turns, user and assistant
// words only (no tool payloads), then the new message.
export function withTranscript(messages: ModelMessage[], text: string): string {
  const lines: string[] = [];
  for (const m of messages.slice(0, -1)) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const body = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => ('content' in p && typeof p.content === 'string' ? p.content : '')).join('') : '';
    if (body.trim()) lines.push(`${m.role === 'user' ? 'User' : 'You'}: ${body.trim()}`);
  }
  if (!lines.length) return text;
  let transcript = lines.join('\n\n');
  if (transcript.length > TRANSCRIPT_CHARS) transcript = `…${transcript.slice(-TRANSCRIPT_CHARS)}`;
  return `(This conversation's earlier session is gone; here is what was said so far, for context:)\n\n${transcript}\n\n(The user's new message:)\n${text}`;
}

function describeExit(stderr: string, code: number): string {
  if (/log ?in|auth|credential|subscription/i.test(stderr)) return 'Claude Code isn\'t signed in. Run `claude` once in a terminal and log in with your subscription, then try again.';
  if (/rate|limit|usage/i.test(stderr)) return `Your Claude usage limit was reached. ${stderr.trim().split('\n').pop()}`;
  return `Claude Code stopped (exit code ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

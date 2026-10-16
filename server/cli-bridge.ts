// The subscription backend's side of /api/assistant: the CLI sessions, the sub-routes the CLI and the
// browser call, and the tool round trip between them. Its adapter (claude-cli-adapter.ts) runs the CLI.
//
//   the CLI calls a tool   POST /mcp (tools/call, JSON-RPC)  → a TOOL_CALL_EVENT on the run's stream
//   the browser answers    POST /tool-result                 → a TOOL_CALL_RESULT chunk, and the MCP result
//   the panel deletes one  POST /new                         → its session is forgotten
//
// The event and the posted answer are declared once, in src/assistant/relay-wire.ts, which the
// browser's relay reads and writes them with.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventType, type AdapterYieldChunk, type AnyTool } from '@tanstack/ai';
import { z } from 'zod';
import { TOOL_CALL_EVENT, ToolResultPostSchema, type ToolCallEvent, type ToolResult } from '../src/assistant/relay-wire';
import { ClaudeCliAdapter, debug, MCP_SERVER, WORKDIR, type CliRun } from './claude-cli-adapter';

const TOOL_TIMEOUT_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A sub-route's answer; the route writes it as JSON (no body: an empty response).
export interface Reply { status: number; body?: unknown }
export type SubRoute = (body: unknown, url: URL) => Reply | Promise<Reply>;
export type Spawn = (bin: string, args: string[], options: { cwd: string }) => ChildProcess;

export interface CliBridgeOptions {
  spawn?: Spawn;            // how the CLI is started (tests pass a fake one)
  workdir?: string;         // where its sessions and MCP configs live
  toolTimeoutMs?: number;   // how long a tool call waits for the browser
}

const toolError = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });
const ok = (body: unknown): Reply => ({ status: 200, body });

const McpRequestSchema = z.object({
  id: z.unknown().optional(),
  method: z.string().optional(),
  params: z.object({ name: z.string().optional(), arguments: z.unknown().optional(), protocolVersion: z.string().optional() }).optional(),
});

// One conversation's CLI session and the run in flight on it. The adapter drives the process and
// reports the tool_use blocks it streams; the session hands the CLI's calls to the browser.
export class CliSession {
  readonly token = randomUUID();   // in the MCP URL: only this session's CLI may call its tools
  // The browser names each conversation with a UUID; the CLI session reuses it, so a conversation finds
  // its session again after the server restarts.
  sessionId: string;
  started = false;
  proc: ChildProcess | null = null;
  tools: AnyTool[] = [];
  private push: ((chunk: AdapterYieldChunk) => void) | null = null;   // the stream of the message in flight
  private uses: { id: string; name: string; claimed: boolean }[] = [];
  private readonly pending = new Map<string, { toolCallId: string; resolve: (result: ToolResult) => void }>();

  constructor(readonly threadId: string, private readonly timeoutMs: number) {
    this.sessionId = UUID.test(threadId) ? threadId : randomUUID();
  }

  // A run starts streaming to `push`; each CLI process of it starts with no tool_use blocks seen.
  attach(push: (chunk: AdapterYieldChunk) => void): void { this.push = push; }
  launched(proc: ChildProcess): void { this.proc = proc; this.uses = []; }
  toolUse(id: string, name: string): void { this.uses.push({ id, name, claimed: false }); }

  // The run is over: calls still waiting get an error result, and later ones find no app.
  end(push: (chunk: AdapterYieldChunk) => void): void {
    for (const p of this.pending.values()) p.resolve(toolError('The request ended before the app answered.'));
    this.pending.clear();
    if (this.push === push) this.push = null;
  }

  // Hands a tool call to the browser and waits for its answer, or the timeout. The tool_use id from the
  // stream is matched by name and order, so the panel can update the right chip.
  call(name: string, input: unknown): Promise<ToolResult> {
    if (!this.push) return Promise.resolve(toolError('The app isn\'t connected.'));
    const use = this.uses.find((u) => !u.claimed && u.name === name);
    if (use) use.claimed = true;
    const callId = randomUUID();
    const toolCallId = use?.id ?? callId;
    this.push({ type: EventType.CUSTOM, model: 'claude-code', timestamp: Date.now(), name: TOOL_CALL_EVENT, value: { threadId: this.threadId, callId, toolCallId, name, input } satisfies ToolCallEvent });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { if (this.pending.delete(callId)) resolve(toolError('The app didn\'t answer in time.')); }, this.timeoutMs);
      this.pending.set(callId, { toolCallId, resolve: (result) => { clearTimeout(timer); resolve(result); } });
    });
  }

  // The browser's answer. False when no such call is waiting (unknown, already answered, or timed out).
  answer(callId: string, result: ToolResult): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    this.pending.delete(callId);
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '(image)')).join('\n');
    this.push?.({ type: EventType.TOOL_CALL_RESULT, toolCallId: p.toolCallId, messageId: randomUUID(), model: 'claude-code', timestamp: Date.now(), content: text, ...(result.isError && { state: 'output-error' as const }) });
    p.resolve(result);
    return true;
  }
}

export class CliBridge {
  readonly spawn: Spawn;
  readonly workdir: string;
  private readonly timeoutMs: number;
  private readonly sessions = new Map<string, CliSession>();   // threadId -> session

  constructor(o: CliBridgeOptions = {}) {
    this.spawn = o.spawn ?? ((bin, args, { cwd }) => nodeSpawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.workdir = o.workdir ?? WORKDIR;
    this.timeoutMs = o.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  }

  // Mounted under /api/assistant by the route, which reads the JSON body (POST only).
  readonly routes: Record<string, SubRoute> = {
    '/mcp': (body, url) => this.mcp(url.searchParams.get('chat') ?? '', url.searchParams.get('token'), body),
    '/tool-result': (body) => {
      const post = ToolResultPostSchema.safeParse(body);
      if (!post.success) return { status: 400, body: { error: 'Bad tool result' } };
      const answered = this.sessions.get(post.data.threadId)?.answer(post.data.callId, post.data.result) ?? false;
      return answered ? ok({ ok: true }) : { status: 404, body: { error: 'No such tool call (it may have timed out).' } };
    },
    '/new': (body) => {
      const t = z.object({ threadId: z.string() }).safeParse(body);
      if (t.success) this.forget(t.data.threadId);
      return ok({ ok: true });
    },
  };

  // The adapter for one run on the subscription.
  adapter(run: CliRun): ClaudeCliAdapter { return new ClaudeCliAdapter(this, run); }

  session(threadId: string): CliSession {
    let s = this.sessions.get(threadId);
    if (!s) { s = new CliSession(threadId, this.timeoutMs); this.sessions.set(threadId, s); }
    return s;
  }

  // Where the session's CLI reaches the MCP endpoint: `host` is this server's own address.
  mcpUrl(host: string, s: CliSession): string {
    return `http://${host}/api/assistant/mcp?chat=${encodeURIComponent(s.threadId)}&token=${s.token}`;
  }

  forget(threadId: string): void {
    this.sessions.get(threadId)?.proc?.kill('SIGTERM');
    this.sessions.delete(threadId);
  }

  // The MCP server the CLI connects to: initialize, tools/list, tools/call (JSON-RPC over HTTP).
  private async mcp(threadId: string, token: string | null, raw: unknown): Promise<Reply> {
    const s = this.sessions.get(threadId);
    if (!s || token !== s.token) { debug('mcp rejected', threadId, !!s); return { status: 403, body: { error: 'unknown chat' } }; }
    const req = McpRequestSchema.safeParse(raw);
    if (!req.success) return { status: 400, body: { error: 'Bad MCP request' } };
    const { id, method, params } = req.data;
    const reply = (result: unknown) => ok({ jsonrpc: '2.0', id, result });
    debug('mcp', method, method === 'tools/call' ? params?.name : '', 'tools:', s.tools.length);
    switch (method) {
      case 'initialize':
        return reply({ protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: MCP_SERVER, version: '2.0.0' } });
      case 'tools/list':
        return reply({ tools: s.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: schemaOf(t) })) });
      case 'tools/call':
        return reply(await s.call(params?.name ?? '', params?.arguments ?? {}));
      case 'ping':
        return reply({});
      default:
        if (id === undefined) return { status: 202 };   // a notification
        return ok({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
    }
  }
}

// Our tools are defined with zod; the CLI wants plain JSON Schema.
function schemaOf(tool: AnyTool): unknown {
  const schema = (tool as { inputSchema?: unknown }).inputSchema;
  if (schema instanceof z.ZodType) return z.toJSONSchema(schema);
  return schema ?? { type: 'object', properties: {} };
}

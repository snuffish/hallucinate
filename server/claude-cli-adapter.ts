// A TanStack AI text adapter that runs the user's Claude subscription through the local Claude Code
// CLI, locked down: no built-in tools (`--tools ''`: no files, no shell), none of the user's settings
// (`--setting-sources ''`), a private working directory of its own, and ONLY this app's tools, offered to the CLI as a tiny MCP server at
// /api/assistant/mcp. It translates the CLI's stream-json into TanStack's chunks; the CLI bridge
// (cli-bridge.ts) holds its sessions and hands each tool call to the browser, which owns the renderer
// and editors.
//
// TanStack's own @tanstack/ai-claude-code adapter cannot be made tool-free (verified 2026-10-13:
// `disallowedTools` is not exhaustive and `--tools ''` is only emitted when our tools are dropped too).

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { EventType, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type ModelMessage, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import type { CliBridge } from './cli-bridge';
import { debug } from './programs';

export const MCP_SERVER = 'hallucinate';
const PREFIX = `mcp__${MCP_SERVER}__`;
// Keeps these sessions apart from the user's projects. It stays the same across restarts (the CLI files
// its sessions by working directory, so `--resume` needs that) and only this user can read it: it
// holds the MCP configs, whose tokens let a caller run the app's tools.
export const WORKDIR = join(tmpdir(), `hallucinate-assistant-${userInfo().username}`);

// What one run tells the adapter besides chat()'s options.
export interface CliRun {
  model?: string | undefined;    // unset: the CLI picks its own
  effort?: string | undefined;
  // Where the CLI reaches this server's MCP endpoint (the server's own address, never the Host header).
  host: string;
  // The conversation already has replies (the browser keeps the history): resume its CLI session.
  continued: boolean;
}

function privateWorkdir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) throw new Error(`${dir} isn't a directory of yours. Remove it and try again.`);
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  return dir;
}

export interface CliArgsOptions { mcpPath: string; tools: readonly string[]; system: string; resume: boolean; sessionId: string; model: string; effort: string | undefined }

// The CLI's arguments. The first lines are the lockdown (ARCHITECTURE.md, invariant 8); the test pins them.
export function cliArgs(o: CliArgsOptions): string[] {
  return [
    '--setting-sources', '',                             // none of the user's CLAUDE.md, plugins, hooks or settings
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '',                                       // no built-in tools: no files, no shell
    '--mcp-config', o.mcpPath, '--strict-mcp-config',
    '--allowedTools', o.tools.map((t) => PREFIX + t).join(','),
    '--system-prompt', `${o.system}\n\n(Your tools come from the "${MCP_SERVER}" MCP server, so their names carry the prefix ${PREFIX}.)`,
    '--disable-slash-commands',                          // (no --safe-mode: it silently disables MCP servers, i.e. our tools)
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    ...(o.model !== 'claude-code' ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

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

type NoOptions = Record<string, never>;

// One run on the subscription. The bridge makes it (`bridge.adapter(run)`) and keeps its session.
export class ClaudeCliAdapter extends BaseTextAdapter<string, NoOptions, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'claude-cli';
  override readonly inputModalities = ['text'] as const;

  constructor(private readonly bridge: CliBridge, private readonly run: CliRun) {
    super({}, run.model ?? 'claude-code');
  }

  structuredOutput(_options: StructuredOutputOptions<NoOptions>): Promise<never> {
    return Promise.reject(new Error('Structured output is not supported by the Claude Code backend.'));
  }

  async *chatStream(options: TextOptions<NoOptions>): AsyncIterable<AdapterYieldChunk> {
    const model = this.model;
    const now = () => Date.now();
    const runId = options.runId ?? this.generateId();
    const threadId = options.threadId ?? this.generateId();
    const session = this.bridge.session(threadId);
    session.tools = options.tools ?? [];
    // A conversation reopened from the browser's history after a server restart: its CLI session exists on disk.
    if (this.run.continued && !session.started) session.started = true;

    // The previous message's process may still be exiting after its result: give it a moment.
    if (session.proc) await new Promise<void>((resolve) => { session.proc?.once('close', () => resolve()); setTimeout(resolve, 5000); });
    if (session.proc) {
      yield { type: EventType.RUN_ERROR, model, timestamp: now(), message: 'The assistant is still working on the previous message.', code: 'busy', error: { message: 'busy', code: 'busy' } };
      return;
    }

    const system = (options.systemPrompts ?? []).map((p) => (typeof p === 'string' ? p : p.content)).join('\n\n');
    const text = latestUserText(options.messages);
    const mcp = { mcpServers: { [MCP_SERVER]: { type: 'http', url: this.bridge.mcpUrl(this.run.host, session) } } };
    const workdir = privateWorkdir(this.bridge.workdir);
    // The CLI wants the MCP config as a file (inline JSON is silently ignored by recent versions).
    const mcpPath = join(workdir, `mcp-${session.token}.json`);
    writeFileSync(mcpPath, JSON.stringify(mcp), { mode: 0o600 });
    const argsFor = (resume: boolean) => cliArgs({ mcpPath, tools: session.tools.map((t) => t.name), system, resume, sessionId: session.sessionId, model: this.model, effort: this.run.effort });

    const chunks = new Channel<AdapterYieldChunk>();
    const push = (c: AdapterYieldChunk) => chunks.push(c);
    session.attach(push);
    let finished = false;
    let textId: string | null = null, reasoningId: string | null = null;
    let context = 0;                                       // input tokens of the newest model call: the conversation's size
    const toolArgs = new Map<string, { id: string; name: string; args: string }>();   // by content block index

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
          session.toolUse(id, name);
          toolArgs.set(String(ev.index), { id, name, args: '' });
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
            if (t) {
              t.args += ev.delta.partial_json ?? '';
              push({ type: EventType.TOOL_CALL_ARGS, toolCallId: t.id, model, timestamp: now(), delta: ev.delta.partial_json ?? '', args: t.args });
            }
          }
        } else if (ev.type === 'content_block_stop') {
          const t = toolArgs.get(String(ev.index));
          if (t) {
            let input: unknown = {};
            try { input = t.args ? JSON.parse(t.args) : {}; } catch { /* streamed JSON may be incomplete; the MCP call carries the real input */ }
            push({ type: EventType.TOOL_CALL_END, toolCallId: t.id, toolCallName: t.name, toolName: t.name, model, timestamp: now(), input });
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
      debug('spawn', this.bridge.claudeBin, args.map((a) => (a.length > 200 ? `${a.slice(0, 200)}…` : a)));
      const p = this.bridge.spawn(this.bridge.claudeBin, args, { cwd: workdir });
      proc = p;
      session.launched(p);
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
        session.end(push);
        if (!finished && code !== null) {
          const message = describeExit(stderr, code);
          push({ type: EventType.RUN_ERROR, model, timestamp: now(), message, code: 'exit', error: { message, code: 'exit' } });
        }
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

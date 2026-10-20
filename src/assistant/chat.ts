// One TanStack ChatClient and the runs on it, shared by the assistant's conversations and the
// director: the tools (run here in the browser, from either backend), the tool calls still running,
// when a run is over, sealing what a stop cut off, and a dispose that is final (nothing it reports
// afterwards: a deleted conversation stays deleted).

import { ChatClient, createChatClientOptions, type ConnectionAdapter, type UIMessage } from '@tanstack/ai-client';
import { clientTools } from './client-tools';
import type { ToolRunner } from './executor';
import { relayToolCalls } from './relay';
import { sealInterrupted } from './transcript';
import { contextOf, usageOf, type Usage } from './usage';
import { postJSON } from '../app/http';
import { NEW_CHAT_URL } from './relay-wire';

// Browser-run tools continue a run after its stream ends: a run is over once the stream is closed
// and no tool is running, for this long.
export const SETTLE_MS = 400;

export interface ChatOptions {
  connection: ConnectionAdapter;
  runner: ToolRunner;
  threadId: string;
  messages?: UIMessage[];
  body?: Record<string, unknown>;   // sent with every request (the director's mode)
}

// What the chat reports. None of it comes after dispose().
export interface ChatEvents {
  messages?: (messages: UIMessage[]) => void;   // the transcript changed (streaming, a tool result, a seal)
  replied?: () => void;                          // a response stream closed: a reply is complete
  tool?: () => void;                             // a tool call started
  usage?: (usage: Usage, context: number) => void;
  error?: (message: string) => void;             // a stop is not an error
  settled?: () => void;                          // the run is over
}

export class Chat {
  private readonly client: ChatClient;
  private loading = false;
  private inflight = 0;
  private active = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiting: (() => void)[] = [];

  constructor(opts: ChatOptions, private readonly on: ChatEvents = {}) {
    const counted: ToolRunner = (name, input, call) => {
      this.inflight++;
      if (!this.disposed) this.on.tool?.();
      this.check();
      return opts.runner(name, input, call).finally(() => { this.inflight--; this.check(); });
    };
    this.client = new ChatClient(createChatClientOptions({
      connection: opts.connection,
      tools: clientTools,
      context: { run: counted },
      threadId: opts.threadId,
      initialMessages: opts.messages ?? [],
      ...(opts.body && { body: opts.body }),
      onCustomEvent: relayToolCalls(counted),   // subscription backend: tool calls arrive as stream events
      onMessagesChange: (messages) => { if (!this.disposed) this.on.messages?.(messages); },
      onLoadingChange: (loading) => {
        this.loading = loading;
        if (this.disposed) return;
        if (!loading) this.on.replied?.();
        this.check();
      },
      onChunk: (chunk) => { const u = usageOf(chunk); if (u && !this.disposed) this.on.usage?.(u, contextOf(chunk)); },
      onError: (err) => this.fail(err),
    }));
  }

  // A run is going: started, and not settled yet.
  get running(): boolean { return this.active; }

  // Starts a run with a message. Resolves once the run is over (settled, stopped or disposed).
  send(text: string, data?: Record<string, unknown>): Promise<void> { return this.start(() => this.client.sendMessage(text, data)); }

  // Re-sends the last request (after an error).
  retry(): Promise<void> { return this.start(() => this.client.reload()); }

  // Ends the run: the stream stops, tool calls without a result get one, and it settles.
  stop(): void {
    this.client.stop();
    this.seal();
    this.check();
  }

  // Final: stops the run, and reports nothing from here on. Returns the transcript, sealed.
  dispose(): UIMessage[] {
    if (this.disposed) return this.client.getMessages();
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.client.stop();
    const sealed = sealInterrupted(this.client.getMessages());
    this.client.dispose();
    this.end();
    return sealed;
  }

  // ---- internals ----

  private start(request: () => Promise<void>): Promise<void> {
    this.active = true;
    const over = new Promise<void>((resolve) => this.waiting.push(resolve));
    request().catch((err: Error) => this.fail(err)).finally(() => this.check());
    return over;
  }

  private fail(err: Error): void {
    if (err?.name !== 'AbortError' && !this.disposed) this.on.error?.(err.message);
  }

  // Gives every tool call without a result an error result (see sealInterrupted).
  private seal(): void {
    const messages = this.client.getMessages();
    const sealed = sealInterrupted(messages);
    if (sealed === messages) return;
    this.client.setMessagesManually(sealed);
    this.on.messages?.(sealed);
  }

  private quiet(): boolean { return !this.disposed && this.active && !this.loading && this.inflight === 0; }

  private check(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.quiet()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.quiet()) return;
      this.seal();
      this.end();
      this.on.settled?.();
    }, SETTLE_MS);
  }

  private end(): void {
    this.active = false;
    for (const resolve of this.waiting.splice(0)) resolve();
  }
}

// The subscription backend keeps a CLI session per thread: this drops it.
export function forgetThread(threadId: string): void {
  postJSON(NEW_CHAT_URL, { threadId }).catch(() => {});
}

// Subscription backend: the server relays each of Claude's tool calls as a custom stream event;
// the browser runs it and posts the answer back. Shared by the assistant panel and the director.
// The event and the answer are declared in relay-wire.ts, which the server reads them with.

import { TOOL_CALL_EVENT, TOOL_RESULT_URL, ToolCallEventSchema, type ToolResult, type ToolResultPost } from './relay-wire';
import { ContentPartsSchema } from './tools';

// executor.ts's ToolRunner, said again so that the server's tests can load the relay without the app.
type ToolRunner = (name: string, input: unknown) => Promise<unknown>;

// A tool's output (TanStack content parts, or anything else as JSON text) in the wire's MCP form.
function toToolResult(out: unknown): ToolResult {
  const parts = ContentPartsSchema.safeParse(out);
  const content = parts.success
    ? parts.data.map((p) => (p.type === 'image' ? { type: 'image' as const, data: p.source.value, mimeType: p.source.mimeType } : { type: 'text' as const, text: p.content }))
    : [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) }];
  return { content, isError: false };
}

export function relayToolCalls(runner: ToolRunner): (type: string, data: unknown) => void {
  return (type, data) => {
    if (type !== TOOL_CALL_EVENT) return;
    const ev = ToolCallEventSchema.safeParse(data);
    if (!ev.success) return;
    const { threadId, callId, name, input } = ev.data;
    runner(name, (input ?? {}) as Record<string, unknown>)
      .then(toToolResult)
      .catch((err: Error): ToolResult => ({ content: [{ type: 'text', text: err.message }], isError: true }))
      .then((result) => fetch(TOOL_RESULT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId, callId, result } satisfies ToolResultPost) }))
      .catch(() => {});
  };
}

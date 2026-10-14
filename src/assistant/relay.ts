// Subscription backend: the server relays each of Claude's tool calls as a custom stream event;
// the browser runs it and posts the answer back. Shared by the assistant panel and the director.

import { z } from 'zod';
import type { ToolRunner } from './executor';
import { ContentPartsSchema } from './tools';

export const TOOL_CALL_EVENT = 'hallucinate.tool_call';
const ToolCallEventSchema = z.object({ threadId: z.string(), callId: z.string(), toolCallId: z.string(), name: z.string(), input: z.unknown() });

export function relayToolCalls(runner: ToolRunner): (type: string, data: unknown) => void {
  return (type, data) => {
    if (type !== TOOL_CALL_EVENT) return;
    const ev = ToolCallEventSchema.safeParse(data);
    if (!ev.success) return;
    const { callId, name, input } = ev.data;
    runner(name, (input ?? {}) as Record<string, unknown>)
      .then((out) => {
        const parts = ContentPartsSchema.safeParse(out);
        const content = parts.success
          ? parts.data.map((p) => (p.type === 'image' ? { type: 'image' as const, data: p.source.value, mimeType: p.source.mimeType } : { type: 'text' as const, text: p.content }))
          : [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) }];
        return { content, isError: false };
      })
      .catch((err: Error) => ({ content: [{ type: 'text' as const, text: err.message }], isError: true }))
      .then((result) => fetch('/api/assistant/tool-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: ev.data.threadId, callId, result }) }))
      .catch(() => {});
  };
}

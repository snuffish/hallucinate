// The subscription backend's tool round trip on the wire, declared once for both ends: the server's CLI
// bridge (server/cli-bridge.ts) sends the tool call event and reads the posted result; the browser's
// relay (relay.ts) reads the event and posts the result. A leaf: zod only, so the browser can load it.

import { z } from 'zod';

// The CUSTOM stream event a relayed tool call arrives as. `callId` names this round trip; `toolCallId`
// is the model's tool_use id, so the panel updates the right chip.
export const TOOL_CALL_EVENT = 'hallucinate.tool_call';
export const ToolCallEventSchema = z.object({ threadId: z.string(), callId: z.string(), toolCallId: z.string(), name: z.string(), input: z.unknown() });
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

// A tool's answer in MCP's content form, which the bridge hands the CLI as the `tools/call` result.
export const ToolResultSchema = z.object({
  content: z.array(z.union([
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
  ])),
  isError: z.boolean().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// POST /api/assistant/tool-result: the browser's answer to one event.
export const TOOL_RESULT_URL = '/api/assistant/tool-result';
export const ToolResultPostSchema = z.object({ threadId: z.string(), callId: z.string(), result: ToolResultSchema });
export type ToolResultPost = z.infer<typeof ToolResultPostSchema>;

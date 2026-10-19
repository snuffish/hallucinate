// Browser implementations of the shared tool definitions (API-key backend): TanStack runs these in
// the browser when the model calls them and resumes the server with the result. One wrapper per
// definition, generated, so a new tool needs no entry here.

import type { AssistantContext } from './executor';
import { TOOL_DEFINITIONS } from './tools';

type Definition = (typeof TOOL_DEFINITIONS)[number];
type Client = ReturnType<Definition['client']>;

export const clientTools: Client[] = TOOL_DEFINITIONS.map((d) =>
  (d.client as (run: (input: unknown, ctx?: { context: AssistantContext; toolCallId?: string }) => Promise<unknown>) => Client)(
    async (input, ctx) => ctx!.context.run(d.name, input ?? {}, { toolCallId: ctx!.toolCallId }),
  ));

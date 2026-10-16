// In-app assistant: /api/assistant runs one TanStack AI chat() per request and streams it back as
// server-sent events. The browser owns the tools (they act on the renderer, the editors and the
// scene library): with an API key they are TanStack client tools; on the subscription backend the
// CLI bridge (server/cli-bridge.ts) relays each call as a stream event. The credentials stay here, on the server.
//
// Two run modes, chosen by `forwardedProps.mode` in the body: `chat` (the panel: every tool, up to
// 30 turns) and `director` (a show-planning cycle: the show tools only, a few turns).
//
// Routes:  GET  /info            backend and model (the settings themselves: /api/settings, server/settings-route.ts)
//          POST /                one chat run (AG-UI body from the panel's ChatClient)
//          POST /mcp …           the subscription backend's own (the CLI's MCP endpoint, the browser's tool
//                                results, forgetting a conversation): CliBridge.routes in server/cli-bridge.ts

import type { IncomingMessage, ServerResponse } from 'node:http';
import { chat, chatParamsFromRequestBody, maxIterations, toServerSentEventsResponse } from '@tanstack/ai';
import type { AssistantInfo } from '../src/assistant/settings-wire';
import { DIRECTOR_TOOLS, TOOL_DEFINITIONS } from '../src/assistant/tools';
import { apiModel, createAdapter, NO_BACKEND, type AssistantConfig, type Backend } from './adapters';
import { CliBridge } from './cli-bridge';
import { DEFAULT_EFFORT } from './config';
import { localAddress } from './guard';
import { readBody, requestUrl, sendJSON } from './http';
import { SYSTEM } from './system-prompt';

const MAX_BODY = 30 * 1024 * 1024;   // screenshots travel back as base64 images
export type RunMode = 'chat' | 'director';

// What a run gets, by mode. Exported for the route test.
export function runConfig(mode: RunMode, backend: Backend, efforts = { effort: DEFAULT_EFFORT as string, directorEffort: DEFAULT_EFFORT as string }) {
  const director = mode === 'director';
  return {
    tools: director ? [...DIRECTOR_TOOLS] : [...TOOL_DEFINITIONS],
    maxTurns: director ? 6 : 30,
    effort: director ? efforts.directorEffort : efforts.effort,
    // The system prompt and the tool list are the same every run: cache them (Anthropic adds no markers by itself).
    ...(backend === 'api' && { promptCache: 'short' as const }),
  };
}
export const modeOf = (forwardedProps: Record<string, unknown> | undefined): RunMode => (forwardedProps?.mode === 'director' ? 'director' : 'chat');
// The panel says so when a conversation already has replies: the CLI backend resumes its session.
export const continuedOf = (forwardedProps: Record<string, unknown> | undefined): boolean => forwardedProps?.continued === true;

// `config`: the settings (server/config.ts) and the backend they lead to, shared with /api/settings so a
// save there takes effect at the next run. Settings changed while a run goes on apply to the next one.
// `cli`: the subscription backend's sessions and sub-routes, one per server.
export function createAssistant(config: AssistantConfig, cli = new CliBridge()) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = requestUrl(req);
    const route = url.pathname.replace(/^\/api\/assistant/, '').replace(/\/$/, '') || '/';
    const b = await config.backend();
    const cfg = config.current();
    if (route === '/info') return sendJSON(res, 200, { backend: b, model: b === 'api' ? apiModel(cfg) : cfg.model.value, ...(b === 'none' && { setup: NO_BACKEND }) } satisfies AssistantInfo);
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST only' });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY, 'conversation too large — start a new chat'));
    } catch (err) {
      return sendJSON(res, 400, { error: `Bad request: ${(err as Error).message}` });
    }
    const sub = cli.routes[route];
    if (sub) { const reply = await sub(body, url); return sendJSON(res, reply.status, reply.body); }
    if (route !== '/') return sendJSON(res, 404, { error: 'Unknown endpoint' });

    let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
    try {
      params = await chatParamsFromRequestBody(body);
    } catch (err) {
      return sendJSON(res, 400, { error: `Bad request: ${err instanceof Response ? await err.text() : (err as Error).message}` });
    }
    const run = runConfig(modeOf(params.forwardedProps), b, { effort: cfg.effort.value, directorEffort: cfg.directorEffort.value });
    const adapter = createAdapter(b, cfg, run.effort, cli, { host: localAddress(req), continued: continuedOf(params.forwardedProps) });
    if (!adapter) return sendJSON(res, 503, { error: NO_BACKEND });

    // Stop in the panel closes the connection: abort the run (and the CLI process) with it.
    const abortController = new AbortController();
    res.on('close', () => abortController.abort());
    const stream = chat({
      adapter,
      messages: params.messages,
      threadId: params.threadId,
      runId: params.runId,
      systemPrompts: [SYSTEM],
      tools: run.tools,
      agentLoopStrategy: maxIterations(run.maxTurns),
      abortController,
      ...(run.promptCache && { promptCache: run.promptCache }),
      ...(b === 'api' && { reasoning: run.effort as 'high' }),
    });
    const response = toServerSentEventsResponse(stream, { abortController });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const reader = response.body?.getReader();
    if (!reader) return void res.end();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch { /* client went away */ } finally {
      res.end();
    }
  };
}


// No body: an empty response (an MCP notification's 202).

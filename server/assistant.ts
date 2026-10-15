// In-app assistant: /api/assistant runs one TanStack AI chat() per request and streams it back as
// server-sent events. The browser owns the tools (they act on the renderer, the editors and the
// scene library): with an API key they are TanStack client tools; on the subscription backend the
// CLI adapter relays each call as a stream event. The credentials stay here, on the server.
//
// Two run modes, chosen by `forwardedProps.mode` in the body: `chat` (the panel: every tool, up to
// 30 turns) and `director` (a show-planning cycle: the show tools only, a few turns).
//
// Routes:  GET  /info            backend and model
//          POST /                one chat run (AG-UI body from the panel's ChatClient)
//          POST /new             forget a conversation (subscription backend; the panel deleted it)
//          POST /tool-result     the browser's answer to a relayed tool call
//          POST /mcp             the MCP endpoint the CLI connects to

import type { IncomingMessage, ServerResponse } from 'node:http';
import { chat, chatParamsFromRequestBody, maxIterations, toServerSentEventsResponse } from '@tanstack/ai';
import { z } from 'zod';
import { DIRECTOR_TOOLS, TOOL_DEFINITIONS } from '../src/assistant/tools';
import { createAdapter, detectBackend, DIRECTOR_EFFORT, EFFORT, MODEL, NO_BACKEND, type Backend } from './adapters';
import { ClaudeCliAdapter, type McpResult } from './claude-cli-adapter';
import { localAddress } from './guard';
import { SYSTEM } from './system-prompt';

const MAX_BODY = 30 * 1024 * 1024;   // screenshots travel back as base64 images
export type RunMode = 'chat' | 'director';

// What a run gets, by mode. Exported for the route test.
export function runConfig(mode: RunMode, backend: Backend) {
  const director = mode === 'director';
  return {
    tools: director ? [...DIRECTOR_TOOLS] : [...TOOL_DEFINITIONS],
    maxTurns: director ? 6 : 30,
    effort: director ? DIRECTOR_EFFORT : EFFORT,
    // The system prompt and the tool list are the same every run: cache them (Anthropic adds no markers by itself).
    ...(backend === 'api' && { promptCache: 'short' as const }),
  };
}
export const modeOf = (forwardedProps: Record<string, unknown> | undefined): RunMode => (forwardedProps?.mode === 'director' ? 'director' : 'chat');
// The panel says so when a conversation already has replies: the CLI backend resumes its session.
export const continuedOf = (forwardedProps: Record<string, unknown> | undefined): boolean => forwardedProps?.continued === true;

const ToolResultSchema = z.object({
  threadId: z.string(),
  callId: z.string(),
  result: z.object({
    content: z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
    ])),
    isError: z.boolean().optional(),
  }),
});

export function createAssistant() {
  let backend: Promise<Backend> | undefined;
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/^\/api\/assistant/, '').replace(/\/$/, '') || '/';
    backend ??= detectBackend();
    const b = await backend;
    if (route === '/info') return json(res, 200, { backend: b, model: b === 'api' ? MODEL : process.env.ASSISTANT_MODEL ?? null, ...(b === 'none' && { setup: NO_BACKEND }) });
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: `Bad request: ${(err as Error).message}` });
    }
    if (route === '/mcp') return ClaudeCliAdapter.handleMcp(req, res, url, body as Parameters<typeof ClaudeCliAdapter.handleMcp>[3]);
    if (route === '/new') {
      const t = z.object({ threadId: z.string() }).safeParse(body);
      if (t.success) ClaudeCliAdapter.forget(t.data.threadId);
      return json(res, 200, { ok: true });
    }
    if (route === '/tool-result') {
      const parsed = ToolResultSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: 'Bad tool result' });
      const ok = ClaudeCliAdapter.answer(parsed.data.threadId, parsed.data.callId, parsed.data.result as McpResult);
      return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'No such tool call (it may have timed out).' });
    }
    if (route !== '/') return json(res, 404, { error: 'Unknown endpoint' });

    let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
    try {
      params = await chatParamsFromRequestBody(body);
    } catch (err) {
      return json(res, 400, { error: `Bad request: ${err instanceof Response ? await err.text() : (err as Error).message}` });
    }
    const config = runConfig(modeOf(params.forwardedProps), b);
    const adapter = createAdapter(b, config.effort);
    if (!adapter) return json(res, 503, { error: NO_BACKEND });
    const self = localAddress(req);
    if (adapter instanceof ClaudeCliAdapter) adapter.host = self;

    // Stop in the panel closes the connection: abort the run (and the CLI process) with it.
    const abortController = new AbortController();
    res.on('close', () => abortController.abort());
    const stream = chat({
      adapter,
      messages: params.messages,
      threadId: params.threadId,
      runId: params.runId,
      systemPrompts: [SYSTEM],
      tools: config.tools,
      agentLoopStrategy: maxIterations(config.maxTurns),
      abortController,
      ...(config.promptCache && { promptCache: config.promptCache }),
      ...(b === 'api' ? { reasoning: config.effort as 'high' } : { modelOptions: { host: self, continued: continuedOf(params.forwardedProps) } }),
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('conversation too large — start a new chat')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Token usage of assistant runs. Each run's RUN_FINISHED carries TanStack's TokenUsage (the Anthropic
// adapter and our CLI adapter both fill it); a conversation and the director add those up.

export interface Usage {
  prompt: number;        // every input token, cached or not
  completion: number;
  cacheRead: number;     // part of `prompt` served from the prompt cache
  cacheWrite: number;    // part of `prompt` written to the cache
  cost: number;          // USD as the provider reported it (the CLI's API-equivalent figure); 0 when unknown
  context: number;       // the biggest single call's input: how much the conversation resends per step
}

export const NO_USAGE: Usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0, cost: 0, context: 0 };

interface TokenUsageLike {
  promptTokens?: unknown;
  providerUsageDetails?: { contextTokens?: unknown };
  completionTokens?: unknown;
  cost?: unknown;
  promptTokensDetails?: { cachedTokens?: unknown; cacheWriteTokens?: unknown };
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function fromTokenUsage(u: TokenUsageLike): Usage {
  return {
    prompt: num(u.promptTokens),
    completion: num(u.completionTokens),
    cacheRead: num(u.promptTokensDetails?.cachedTokens),
    cacheWrite: num(u.promptTokensDetails?.cacheWriteTokens),
    cost: num(u.cost),
    context: num(u.providerUsageDetails?.contextTokens) || num(u.promptTokens),
  };
}

// Sums, except the context: a conversation only grows, so the larger one is the later one, whichever
// order runs are added in.
export function addUsage(a: Usage, b: Usage): Usage {
  return { prompt: a.prompt + b.prompt, completion: a.completion + b.completion, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, cost: a.cost + b.cost, context: Math.max(a.context, b.context) };
}

// Input the cache didn't serve: written to it, or not cached at all. Both cost at least full price,
// while a cache read costs about a tenth; "in" alone mostly counts those cheap reads.
export const newInput = (u: Usage) => Math.max(0, u.prompt - u.cacheRead);

// The usage a stream chunk reports: only RUN_FINISHED carries it (an object, or AG-UI's array form).
export function usageOf(chunk: { type: string; usage?: unknown }): Usage | null {
  if (chunk.type !== 'RUN_FINISHED' || !chunk.usage || typeof chunk.usage !== 'object') return null;
  const items = (Array.isArray(chunk.usage) ? chunk.usage : [chunk.usage]) as TokenUsageLike[];
  return items.reduce((sum, u) => addUsage(sum, fromTokenUsage(u ?? {})), NO_USAGE);
}

// How big the conversation is now: the newest model call's input, i.e. what one more message resends.
// The CLI adapter reports it (its usage sums every call of a run); otherwise a run is one call.
export function contextOf(chunk: { type: string; usage?: unknown }): number {
  if (chunk.type !== 'RUN_FINISHED' || !chunk.usage || typeof chunk.usage !== 'object') return 0;
  const last = (Array.isArray(chunk.usage) ? chunk.usage.at(-1) : chunk.usage) as TokenUsageLike | undefined;
  return num(last?.providerUsageDetails?.contextTokens) || num(last?.promptTokens);
}

// 950 → "950", 1234 → "1.2k", 48210 → "48k", 1_250_000 → "1.3M".
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export const totalTokens = (u: Usage) => u.prompt + u.completion;

export const formatCost = (usd: number) => `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_CAP, loadTranscript, parseIndex, prune, transcriptWriter, type ChatMeta, type Transcript, type TranscriptBackend } from './history-store';
import { createLock, serialized } from './lock';
import { NOT_RUN } from './transcript';
import { addUsage, contextOf, formatCost, formatTokens, newInput, NO_USAGE, usageOf } from './usage';

describe('usage', () => {
  it('reads TanStack usage off RUN_FINISHED, with the cache split and the cost', () => {
    const u = usageOf({ type: 'RUN_FINISHED', usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050, promptTokensDetails: { cachedTokens: 700, cacheWriteTokens: 200 }, cost: 0.02 } });
    expect(u).toEqual({ prompt: 1000, completion: 50, cacheRead: 700, cacheWrite: 200, cost: 0.02, context: 1000 });
    expect(usageOf({ type: 'TEXT_MESSAGE_CONTENT', usage: { promptTokens: 5 } })).toBeNull();
    expect(usageOf({ type: 'RUN_FINISHED' })).toBeNull();
    expect(usageOf({ type: 'RUN_FINISHED', usage: [{ promptTokens: 10, completionTokens: 1 }, { promptTokens: 20, completionTokens: 2 }] })).toMatchObject({ prompt: 30, completion: 3, context: 20 });
    // The CLI sums every call of a run and names the newest call's input apart.
    expect(usageOf({ type: 'RUN_FINISHED', usage: { promptTokens: 100_292, providerUsageDetails: { contextTokens: 50_958 } } })).toMatchObject({ prompt: 100_292, context: 50_958 });
  });

  it('sizes the conversation by the newest call (the CLI reports it; otherwise the run is one call)', () => {
    expect(contextOf({ type: 'RUN_FINISHED', usage: { promptTokens: 9000, providerUsageDetails: { contextTokens: 3000 } } })).toBe(3000);
    expect(contextOf({ type: 'RUN_FINISHED', usage: { promptTokens: 9000 } })).toBe(9000);
    expect(contextOf({ type: 'RUN_STARTED' })).toBe(0);
  });

  it('adds up and formats', () => {
    expect(addUsage(NO_USAGE, { prompt: 1, completion: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5, context: 1 })).toEqual({ prompt: 1, completion: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5, context: 1 });
    const later = { ...NO_USAGE, prompt: 9000, cacheRead: 8500, context: 5000 }, earlier = { ...NO_USAGE, prompt: 3000, context: 3000 };
    expect(addUsage(later, earlier).context).toBe(5000);   // the larger (later) context, in either order
    expect(addUsage(earlier, later).context).toBe(5000);
    expect(newInput(later)).toBe(500);
    expect([0.0412, 1.2].map(formatCost)).toEqual(['$0.041', '$1.20']);
    expect([950, 1234, 48_210, 1_250_000].map(formatTokens)).toEqual(['950', '1.2k', '48k', '1.3M']);
    expect(formatTokens(2000)).toBe('2k');
  });
});

describe('the tool lock', () => {
  it('runs tools one at a time in call order, across runners, and a failure does not block the next', async () => {
    const lock = createLock();
    const log: string[] = [];
    const slow = (tag: string, ms: number, fail = false) => async () => {
      log.push(`start ${tag}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${tag}`);
      if (fail) throw new Error(tag);
      return tag;
    };
    const a = serialized((name) => slow(`a:${name}`, 30, name === 'boom')(), lock);
    const b = serialized((name) => slow(`b:${name}`, 5)(), lock);
    const results = await Promise.allSettled([a('one', {}), b('two', {}), a('boom', {}), b('three', {})]);
    expect(log).toEqual(['start a:one', 'end a:one', 'start b:two', 'end b:two', 'start a:boom', 'end a:boom', 'start b:three', 'end b:three']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
  });
});

const meta = (id: string, updatedAt: number, pinned = false): ChatMeta => ({ id, title: id, renamed: false, createdAt: updatedAt, updatedAt, pinned, usage: NO_USAGE, lastPrompt: 0, count: 2 });

describe('the history index', () => {
  it('keeps every valid entry when one is broken, drops duplicates, and forgets an active id it no longer has', () => {
    const index = parseIndex({ v: 1, chats: [meta('a', 1), { id: 'b' }, meta('a', 2), { ...meta('c', 3), pinned: 'yes' }, meta('d', 4)], activeId: 'gone' });
    expect(index.chats.map((c) => c.id)).toEqual(['a', 'd']);
    expect(index.activeId).toBeNull();
    expect(parseIndex({ v: 2 })).toEqual({ chats: [], activeId: null });
    expect(parseIndex(null)).toEqual({ chats: [], activeId: null });
  });

  it(`keeps the ${HISTORY_CAP} newest conversations, never a pinned or running one`, () => {
    const chats = [meta('old-pinned', 1, true), meta('oldest', 2), meta('running', 3), meta('old', 4), meta('new', 5)];
    const { chats: kept, dropped } = prune(chats, 3, new Set(['running']));
    expect(dropped).toEqual(['oldest', 'old']);
    expect(kept.map((c) => c.id)).toEqual(['old-pinned', 'running', 'new']);
    expect(prune(chats, 10).dropped).toEqual([]);
  });
});

describe('transcripts', () => {
  afterEach(() => { vi.useRealTimers(); });

  const memory = () => {
    const data = new Map<string, Transcript>();
    const writes: string[] = [];
    const backend: TranscriptBackend = {
      get: async (id) => data.get(id) ?? null,
      set: async (id, v) => { writes.push(id); data.set(id, v); },
      remove: async (id) => { data.delete(id); },
    };
    return { data, writes, backend };
  };

  it('writes at most once a second however often the transcript changes, and at once on flush', async () => {
    vi.useFakeTimers();
    const { data, writes, backend } = memory();
    const w = transcriptWriter(backend, 'x');
    for (let i = 0; i < 50; i++) w.schedule({ messages: [{ id: `m${i}`, role: 'assistant', parts: [] }], replyUsage: {} });   // 50 streamed tokens
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toEqual(['x']);
    expect(data.get('x')!.messages[0]!.id).toBe('m49');   // only the newest state
    w.schedule({ messages: [], replyUsage: {} });
    await w.flush();
    expect(writes).toEqual(['x', 'x']);
    await w.flush();                                       // nothing pending: no write
    expect(writes).toHaveLength(2);
    w.dispose();
  });

  it('reads a transcript sealed, and survives a broken store', async () => {
    const { data, backend } = memory();
    data.set('x', { messages: [{ id: 'a', role: 'assistant', parts: [{ type: 'tool-call', id: 'c', name: 'set_look', arguments: '{}', state: 'input-complete' }] }], replyUsage: {} });
    const t = await loadTranscript(backend, 'x');
    expect(t!.messages[0]!.parts.at(-1)).toMatchObject({ type: 'tool-result', content: NOT_RUN });
    expect(await loadTranscript({ ...backend, get: () => Promise.reject(new Error('no IndexedDB')) }, 'x')).toBeNull();
  });
});

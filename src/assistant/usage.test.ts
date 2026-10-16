import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_CAP, parseIndex, prune, storedTranscript, type ChatMeta, type Transcript, type TranscriptBackend } from './history-store';
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

  const t = (id: string): Transcript => ({ messages: [{ id, role: 'assistant', parts: [] }], replyUsage: {} });
  const microtasks = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };   // a queued write starts

  it('writes at most once a second however often the transcript changes, and at once when a reply completes', async () => {
    vi.useFakeTimers();
    const { data, writes, backend } = memory();
    const st = storedTranscript(backend, 'x', { exists: () => false });
    await st.read();
    for (let i = 0; i < 50; i++) st.update(t(`m${i}`));   // 50 streamed tokens
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toEqual(['x']);
    expect(data.get('x')!.messages[0]!.id).toBe('m49');   // only the newest state
    await st.commit(t('done'));
    expect(writes).toEqual(['x', 'x']);
    await vi.advanceTimersByTimeAsync(1000);              // nothing pending: no write
    expect(writes).toHaveLength(2);
    st.close();
  });

  it('reads a transcript sealed, and survives a broken store', async () => {
    const { data, backend } = memory();
    data.set('x', { messages: [{ id: 'a', role: 'assistant', parts: [{ type: 'tool-call', id: 'c', name: 'set_look', arguments: '{}', state: 'input-complete' }] }], replyUsage: {} });
    const read = await storedTranscript(backend, 'x').read();
    expect(read!.messages[0]!.parts.at(-1)).toMatchObject({ type: 'tool-result', content: NOT_RUN });
    expect(await storedTranscript({ ...backend, get: () => Promise.reject(new Error('no IndexedDB')) }, 'x').read()).toBeNull();
    expect(await storedTranscript(backend, 'x', { exists: () => false }).read()).toBeNull();   // not in the index: not asked
  });

  it('never writes before the stored one was read, so closing early keeps it', async () => {
    const { data, writes, backend } = memory();
    data.set('x', t('keep me'));
    const st = storedTranscript(backend, 'x');
    st.update(t('empty'));
    await st.commit(t('empty'));
    st.close();
    expect(writes).toEqual([]);
    expect(data.get('x')!.messages[0]!.id).toBe('keep me');
  });

  it('writes in order, so a completed reply is never overtaken by an older state', async () => {
    const { data, backend } = memory();
    let release!: () => void;
    const slow: TranscriptBackend = { ...backend, set: (id, v) => (v.messages[0]!.id === 'older' ? new Promise((r) => { release = () => r(backend.set(id, v)); }) : backend.set(id, v)) };
    const st = storedTranscript(slow, 'x', { exists: () => false });
    await st.read();
    void st.commit(t('older'));
    const final = st.commit(t('final'));
    await microtasks();
    release();
    await final;
    expect(data.get('x')!.messages[0]!.id).toBe('final');
  });

  it('after destroy writes nothing, and a write in flight lands before the record goes', async () => {
    vi.useFakeTimers();
    const { data, backend } = memory();
    let release!: () => void;
    const slow: TranscriptBackend = { ...backend, set: (id, v) => new Promise((r) => { release = () => r(backend.set(id, v)); }) };
    const st = storedTranscript(slow, 'x', { exists: () => false });
    await st.read();
    void st.commit(t('in flight'));
    await microtasks();
    st.update(t('pending'));
    const gone = st.destroy();
    release();
    await gone;
    st.update(t('streamed in after'));
    await st.commit(t('streamed in after'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(data.has('x')).toBe(false);
  });

  it('reports a failed write', async () => {
    const { backend } = memory();
    const errors: string[] = [];
    const st = storedTranscript({ ...backend, set: () => Promise.reject(new Error('quota')) }, 'x', { exists: () => false, onError: (e) => errors.push(e.message) });
    await st.read();
    await st.commit(t('a'));
    expect(errors).toEqual(['quota']);
  });
});

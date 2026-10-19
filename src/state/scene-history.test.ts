import { describe, expect, it } from 'vitest';
import { memoryStore } from './history-db';
import { COALESCE_MS, MAX_VERSIONS, SceneHistory, type Version } from './scene-history';

function setup(initial: Version[] = []) {
  const backend = memoryStore<Version>(initial);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const history = new SceneHistory(backend, clock.now);
  return { backend, clock, history };
}

const bodies = (h: SceneHistory, key: string) => h.list(key).map((v) => `${v.by}:${v.body}`);

describe('scene history', () => {
  it('folds typing with short pauses into one version, and starts a new one after a long pause', async () => {
    const { history, clock } = setup();
    await history.ready;
    history.note('user:A', 'a1', { by: 'you' }, 'a0');
    clock.advance(10_000);
    history.note('user:A', 'a2', { by: 'you' }, 'a1');
    expect(bodies(history, 'user:A')).toEqual(['you:a2', 'earlier:a0']);
    clock.advance(COALESCE_MS + 1);
    history.note('user:A', 'a3', { by: 'you' }, 'a2');
    expect(bodies(history, 'user:A')).toEqual(['you:a3', 'you:a2', 'earlier:a0']);
  });

  it('keeps the code an assistant change replaced, and never folds it into your typing', async () => {
    const { history } = setup();
    await history.ready;
    history.note('user:A', 'mine', { by: 'you' }, 'old');
    history.note('user:A', 'ai', { by: 'assistant', chatId: 'c1', toolCallId: 't1', label: 'Edited A' }, 'mine');
    history.note('user:A', 'mine again', { by: 'you' }, 'ai');
    const list = history.list('user:A');
    expect(list.map((v) => v.by)).toEqual(['you', 'assistant', 'you', 'earlier']);
    expect(list[1]).toMatchObject({ body: 'ai', chatId: 'c1', toolCallId: 't1', label: 'Edited A' });
  });

  it('keeps the code before a change as an earlier version when history did not have it', async () => {
    const { history } = setup();
    await history.ready;
    history.note('scene:Vortex', 'edited', { by: 'assistant' }, 'shipped');
    expect(bodies(history, 'scene:Vortex')).toEqual(['assistant:edited', 'earlier:shipped']);
  });

  it('notes nothing for code that is already the newest version', async () => {
    const { history } = setup();
    await history.ready;
    history.note('custom', 'x', { by: 'template' }, 'x0');
    history.note('custom', 'x', { by: 'you' }, 'x');
    expect(history.list('custom')).toHaveLength(2);
  });

  it('keeps versions across sessions, and applies notes taken before they loaded after them', async () => {
    const first = setup();
    await first.history.ready;
    first.history.note('user:A', 'a1', { by: 'template' }, 'a0');
    await first.history.flush();
    const second = new SceneHistory(first.backend, () => 2_000_000);
    second.note('user:A', 'a2', { by: 'you' }, 'a1');
    await second.flush();
    expect(bodies(second, 'user:A')).toEqual(['you:a2', 'template:a1', 'earlier:a0']);
  });

  it('trims the oldest of your versions first, and keeps the first one', async () => {
    const { history, clock, backend } = setup();
    await history.ready;
    history.note('user:A', 'start', { by: 'library' });
    history.note('user:A', 'ai', { by: 'assistant' });
    for (let n = 0; n < MAX_VERSIONS + 5; n++) { clock.advance(COALESCE_MS + 1); history.note('user:A', `you${n}`, { by: 'you' }); }
    const list = history.list('user:A');
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list.at(-1)!.body).toBe('start');
    expect(list.some((v) => v.body === 'ai')).toBe(true);
    expect(list.some((v) => v.body === 'you0')).toBe(false);
    await history.flush();
    expect(backend.records.size).toBe(MAX_VERSIONS);
  });

  it('moves versions with a renamed scene, and drops them with a discarded one', async () => {
    const { history, backend } = setup();
    await history.ready;
    history.note('user:A', 'a', { by: 'library' });
    history.rename('user:A', 'user:A (mine)');
    expect(history.list('user:A')).toEqual([]);
    expect(history.list('user:A (mine)')).toHaveLength(1);
    history.drop('user:A (mine)');
    await history.flush();
    expect(history.list('user:A (mine)')).toEqual([]);
    expect(backend.records.size).toBe(0);
  });
});

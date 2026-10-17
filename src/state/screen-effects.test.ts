import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from './persistence';
import { loadScreenEffects, screenEffectsWriter } from './screen-effects';

describe("the main screen's effects, kept for the next start", () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('start with none', () => {
    expect(loadScreenEffects()).toEqual([]);
  });

  it('come back as they were written', () => {
    let stack = [{ id: 'mirror' as const, on: false, settings: { axis: 1 } }];
    const writer = screenEffectsWriter(() => stack);
    writer.schedule();
    writer.flush();
    stack = [];
    expect(loadScreenEffects()).toEqual([{ id: 'mirror', on: false, settings: { axis: 1 } }]);
    writer.dispose();
  });

  it('load cleaned up: an unknown effect, a duplicate and an out-of-range setting', () => {
    map.set(KEYS.screenEffects, JSON.stringify([
      { id: 'echo', on: true, settings: {} },
      { id: 'mirror', on: true, settings: { axis: 7 } },
      { id: 'mirror', on: false, settings: { axis: 0 } },
    ]));
    expect(loadScreenEffects()).toEqual([{ id: 'mirror', on: true, settings: { axis: 2 } }]);
  });

  it('load as none when what is stored is not a stack', () => {
    map.set(KEYS.screenEffects, '{broken');
    expect(loadScreenEffects()).toEqual([]);
    map.set(KEYS.screenEffects, JSON.stringify({ mirror: true }));
    expect(loadScreenEffects()).toEqual([]);
  });
});

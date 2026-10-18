import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_BACKGROUND, type Background } from '../engine/background';
import { KEYS } from './persistence';
import { loadScreenBackground, screenBackgroundWriter } from './screen-background';

describe("the main screen's background, kept for the next start", () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts with none', () => {
    expect(loadScreenBackground()).toEqual(NO_BACKGROUND);
  });

  it('comes back as it was written', () => {
    let background: Background = { ...NO_BACKGROUND, kind: 'gradient', colour: '#102030' };
    const writer = screenBackgroundWriter(() => background);
    writer.schedule();
    writer.flush();
    background = NO_BACKGROUND;
    expect(loadScreenBackground()).toEqual({ ...NO_BACKGROUND, kind: 'gradient', colour: '#102030' });
    writer.dispose();
  });

  it('loads cleaned up, and as none when what is stored is broken', () => {
    map.set(KEYS.screenBackground, JSON.stringify({ kind: 'colour', colour: 'red', brightness: 9 }));
    expect(loadScreenBackground()).toEqual({ ...NO_BACKGROUND, kind: 'colour', brightness: 1 });
    map.set(KEYS.screenBackground, '{broken');
    expect(loadScreenBackground()).toEqual(NO_BACKGROUND);
  });
});

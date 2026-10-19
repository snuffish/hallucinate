import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLook } from './app-state';
import { loadLook, lookWriter } from './look-store';
import { KEYS } from './persistence';

describe('the Look, kept for the next start', () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts as the laser look', () => {
    expect(loadLook()).toEqual(defaultLook());
  });

  it('comes back as it was written: sliders, switches, locks and XY pads', () => {
    let look = { ...defaultLook(), reactivity: 1.6, hue: 0.42, drift: true, locked: ['hue', 'trails'] as const, xyOpen: false, xy: [{ x: 'trails', y: 'aberration' }, { x: 'hue', y: 'synesthesia' }] as const };
    const writer = lookWriter(() => look);
    writer.schedule();
    writer.flush();
    look = defaultLook() as typeof look;
    expect(loadLook()).toEqual({ ...defaultLook(), reactivity: 1.6, hue: 0.42, drift: true, locked: ['trails', 'hue'], xyOpen: false, xy: [{ x: 'trails', y: 'aberration' }, { x: 'hue', y: 'synesthesia' }] });
    writer.dispose();
  });

  it('loads a damaged value field by field: a bad field falls back, an out-of-range slider is clamped', () => {
    map.set(KEYS.look, JSON.stringify({
      reactivity: 9, speed: 'fast', trails: 0.5, drift: 'yes',
      locked: ['hue', 'volume', 'hue', 3],
      xy: [{ x: 'speed', y: 'speed' }, { x: 'hue', y: 'cycle' }],
    }));
    expect(loadLook()).toEqual({ ...defaultLook(), reactivity: 2, trails: 0.5, locked: ['hue'] });
  });

  it('loads a palette of 2–5 hues wrapped into the wheel, and fewer than two as the whole wheel', () => {
    map.set(KEYS.look, JSON.stringify({ palette: { hues: [1.25, -0.5, 0.1, 0.2, 0.3, 0.4], steps: true } }));
    expect(loadLook().palette).toEqual({ hues: [0.25, 0.5, 0.1, 0.2, 0.3], steps: true });
    map.set(KEYS.look, JSON.stringify({ palette: { hues: [0.3], steps: 'yes' } }));
    expect(loadLook().palette).toEqual({ hues: [], steps: false });
    map.set(KEYS.look, JSON.stringify({ palette: 'warm' }));
    expect(loadLook().palette).toEqual({ hues: [], steps: false });
  });

  it('loads the sliders that follow the music, dropping a broken route and an unknown slider', () => {
    const good = { source: 'kick', depth: -0.5, attack: 0.1, release: 1 };
    map.set(KEYS.look, JSON.stringify({ routes: { trails: good, hue: { ...good, source: 'snare' }, reactivity: good, speed: { ...good, attack: 9 } } }));
    expect(loadLook().routes).toEqual({ trails: good });
  });

  it('loads as the laser look when what is stored is not a look', () => {
    map.set(KEYS.look, '{broken');
    expect(loadLook()).toEqual(defaultLook());
    map.set(KEYS.look, JSON.stringify([1, 2]));
    expect(loadLook()).toEqual(defaultLook());
  });
});

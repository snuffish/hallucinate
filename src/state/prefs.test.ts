import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRendererPrefs, type OutputPrefs } from '../engine/output-link';
import { KEYS } from './persistence';
import { APPLIES, DEFAULT_PREFS, PrefsSchema, loadPrefs, micConstraints, outputPrefs, type PrefKey } from './prefs';

describe('device preferences', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts from the defaults, with the scenes at full resolution', () => {
    expect(loadPrefs()).toEqual({
      v: 1, resolution: 1, maxPixelRatio: 2, audioSmoothing: 0.6,
      micEchoCancellation: false, micNoiseSuppression: false, micAutoGain: false, idleHideSeconds: 3, showKeyBadges: true,
    });
    expect(DEFAULT_PREFS).toEqual(loadPrefs());
  });

  it('keeps the valid fields when one is broken', () => {
    store.set(KEYS.prefs, JSON.stringify({ v: 1, maxPixelRatio: 3, idleHideSeconds: null, audioSmoothing: 'loud', showKeyBadges: false }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, idleHideSeconds: null, showKeyBadges: false });
  });

  it('leaves the old Start resolution behind: Resolution starts at 100%', () => {
    store.set(KEYS.prefs, JSON.stringify({ v: 1, startResolution: 0.5, showKeyBadges: false }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, showKeyBadges: false });
    expect(loadPrefs().resolution).toBe(1);
  });

  it('falls back to the defaults for another version or unreadable data', () => {
    store.set(KEYS.prefs, JSON.stringify({ v: 2, showKeyBadges: false }));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    store.set(KEYS.prefs, '{nope');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips what it stores', () => {
    const prefs = { ...DEFAULT_PREFS, resolution: 0.5, maxPixelRatio: 1.5 as const, idleHideSeconds: 10 as const, micAutoGain: true };
    store.set(KEYS.prefs, JSON.stringify(prefs));
    expect(PrefsSchema.parse(JSON.parse(store.get(KEYS.prefs)!))).toEqual(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });

  it('sends projectors exactly the preferences that apply to every renderer', () => {
    const everyRenderer = (Object.keys(APPLIES) as PrefKey[]).filter((k) => APPLIES[k] === 'all-renderers').sort();
    const sent = Object.keys(outputPrefs(DEFAULT_PREFS)) as (keyof OutputPrefs)[];
    expect(sent.sort()).toEqual(everyRenderer);
  });

  it('applies every preference a renderer gets, the same way for each renderer', () => {
    const prefs = outputPrefs({ ...DEFAULT_PREFS, maxPixelRatio: 1.5 });
    const seen: Partial<OutputPrefs> = {};
    applyRendererPrefs({ setMaxPixelRatio: (v) => { seen.maxPixelRatio = v; } }, prefs);
    expect(seen).toEqual(prefs);
  });

  it('turns the microphone settings into track constraints', () => {
    expect(micConstraints({ ...DEFAULT_PREFS, micNoiseSuppression: true })).toEqual({ echoCancellation: false, noiseSuppression: true, autoGainControl: false });
  });
});

import { describe, expect, it } from 'vitest';
import { LOOK_RANGES, defaultLook } from '../state/app-state';
import { RANDOM_RANGES } from '../state/look-drift';
import type { Hearing } from './listener';
import type { FrameLook } from './look';
import { HUE_SPAN, ROUTE_SOURCES, ROUTE_TARGETS, STRONGEST_ROUTES, followMusic, followed, type Route } from './look-routes';

const sound = (o: Partial<Hearing> = {}): Hearing => ({ bass: 0, mid: 0, high: 0, level: 0, beat: 0, kick: false, tick: false, tickPhase: 0, ticks: 0, bpm: 120, bright: 0, centroid: 2500, energy: 0.5, mood: 0, ...o });
const LOUD = sound({ bass: 1, mid: 1, high: 1, level: 1, beat: 1, bright: 1, mood: 1 });
const route = (o: Partial<Route> = {}): Route => ({ source: 'bass', depth: 1, attack: 0.05, release: 0.05, ...o });

// Runs `frames` frames of `h` with `look`, from rest; the followed look after the last.
function run(look: FrameLook, h: Hearing, frames: number, env = new Float32Array(ROUTE_TARGETS.length)): FrameLook {
  const out = { ...defaultLook() } as FrameLook;
  for (let i = 0; i < frames; i++) followMusic(out, look, env, h, 1 / 60);
  return out;
}

describe('sliders that follow the music (ADR 0005)', () => {
  it('leave the look as it is without routes, and Reactivity can never follow', () => {
    const look = { ...defaultLook(), routes: {} };
    expect(run(look, LOUD, 30)).toMatchObject({ speed: 1, trails: 0.35, hue: 0, synesthesia: 0.3, aberration: 0, reactivity: 1 });
    expect(ROUTE_TARGETS).not.toContain('reactivity');
  });

  it('rise over the attack and fall back over the release', () => {
    const look = { ...defaultLook(), trails: 0, routes: { trails: route({ attack: 0.2, release: 0.5 }) } };
    const env = new Float32Array(ROUTE_TARGETS.length);
    expect(run(look, LOUD, 1, env).trails).toBeLessThan(0.6 * 0.1);   // one frame: under a tenth of the way
    const risen = run(look, LOUD, 60, env).trails;
    expect(risen).toBeGreaterThan(0.5);
    expect(run(look, sound(), 15, env).trails).toBeGreaterThan(risen * 0.5);   // 250 ms into a 500 ms release
  });

  it('never go above the higher of the hand value and the top of the Randomize range, nor below the bottom, for any source and depth', () => {
    for (const t of ROUTE_TARGETS.filter((x) => x !== 'hue')) for (const base of [LOOK_RANGES[t].min, RANDOM_RANGES[t][1] / 2, LOOK_RANGES[t].max]) for (const depth of [-1, -0.3, 0.5, 1]) {
      const v = followed(t, base, route({ depth }), 1);
      expect(v).toBeLessThanOrEqual(Math.max(base, RANDOM_RANGES[t][1]) + 1e-9);
      expect(v).toBeGreaterThanOrEqual(LOOK_RANGES[t].min);
    }
  });

  it('move Colour at most ±0.1 of the wheel, and no faster than 150 ms however short the attack', () => {
    expect(followed('hue', 0.5, route({ depth: 1 }), 1)).toBeCloseTo(0.5 + HUE_SPAN, 9);
    expect(followed('hue', 0.5, route({ depth: -1 }), 1)).toBeCloseTo(0.5 - HUE_SPAN, 9);
    const look = { ...defaultLook(), hue: 0.5, routes: { hue: route({ attack: 0 }) } };
    expect(run(look, LOUD, 1).hue - 0.5).toBeLessThan(HUE_SPAN * 0.11);   // 1 − e^(−1/60/0.15) ≈ 0.105 of the way
  });

  it('rise no faster than 50 ms however short the attack', () => {
    const look = { ...defaultLook(), trails: 0, routes: { trails: route({ attack: 0 }) } };
    expect(run(look, LOUD, 1).trails).toBeLessThan(0.6 * 0.29);   // 1 − e^(−1/60/0.05) ≈ 0.28 of the way
  });

  it('follow each source', () => {
    for (const source of ROUTE_SOURCES) {
      const look = { ...defaultLook(), speed: 0.5, routes: { speed: route({ source }) } };
      expect(run(look, LOUD, 60).speed, source).toBeGreaterThan(1.5);
      expect(run(look, sound(), 60).speed, source).toBe(0.5);
    }
  });

  it('name the worst case: every slider that can follow, on the kick, at full depth', () => {
    expect(Object.keys(STRONGEST_ROUTES).sort()).toEqual([...ROUTE_TARGETS].sort());
    for (const r of Object.values(STRONGEST_ROUTES)) expect(r).toMatchObject({ source: 'kick', depth: 1 });
  });
});

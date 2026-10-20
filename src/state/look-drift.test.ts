import { describe, expect, it } from 'vitest';
import { defaultLook } from './app-state';
import { LookDrift, RANDOM_RANGES, STRONGEST_LOOK, type DriftKey } from './look-drift';

// A repeatable "random" sequence.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const keys = Object.keys(RANDOM_RANGES) as DriftKey[];

describe('laser defaults and ranges', () => {
  it('opens with the laser look', () => {
    expect(defaultLook()).toMatchObject({ reactivity: 1, speed: 1, trails: 0.35, hue: 0, cycle: 0.2, synesthesia: 0.3, aberration: 0 });
  });

  it('lets Randomize and Drift pick only from laser-friendly ranges', () => {
    expect(RANDOM_RANGES).toEqual({
      reactivity: [0.6, 1.4], speed: [0.5, 1.6], trails: [0, 0.6], hue: [0, 1],
      cycle: [0, 1], synesthesia: [0, 0.6], aberration: [0, 0.006],
    });
  });

  it('names the strongest Look: the top of every range', () => {
    expect(STRONGEST_LOOK).toEqual({ reactivity: 1.4, speed: 1.6, trails: 0.6, hue: 1, cycle: 1, synesthesia: 0.6, aberration: 0.006 });
  });
});

describe('LookDrift', () => {
  it('glides every slider smoothly, inside its range once it gets there, and leaves the rest alone', () => {
    const look = defaultLook();
    const drift = new LookDrift(seeded());
    let prev = { ...look };
    for (let frame = 0; frame < 60 * 120; frame++) {   // two minutes at 60 fps
      drift.step(look, 1 / 60, 1);
      for (const k of keys) {
        const span = RANDOM_RANGES[k][1] - RANDOM_RANGES[k][0];
        expect(Math.abs(look[k] - prev[k])).toBeLessThan(span * 0.01);   // no jumps between frames
      }
      prev = { ...look };
    }
    for (const k of keys) {
      expect(look[k]).toBeGreaterThanOrEqual(RANDOM_RANGES[k][0]);
      expect(look[k]).toBeLessThanOrEqual(RANDOM_RANGES[k][1]);
      expect(look[k]).not.toBe(defaultLook()[k]);
    }
  });

  it('carries on from a value the user set instead of snapping back', () => {
    const look = defaultLook();
    const drift = new LookDrift(seeded(7));
    for (let i = 0; i < 100; i++) drift.step(look, 1 / 60, 1);
    look.speed = 1.55;   // dragged by hand
    drift.step(look, 1 / 60, 1);
    expect(Math.abs(look.speed - 1.55)).toBeLessThan(0.01);
  });

  it('leaves a locked slider where it is, and glides it on from there once it is unlocked', () => {
    const look = defaultLook();
    const drift = new LookDrift(seeded(5));
    for (let i = 0; i < 600; i++) drift.step(look, 1 / 60, 2, ['hue', 'trails']);
    expect(look.hue).toBe(defaultLook().hue);
    expect(look.trails).toBe(defaultLook().trails);
    expect(look.speed).not.toBe(defaultLook().speed);   // the rest drifted
    look.hue = 0.5;   // set by hand while locked
    drift.step(look, 1 / 60, 2);
    expect(Math.abs(look.hue - 0.5)).toBeLessThan(0.01);   // unlocked: no snap back to an old glide
  });

  it('moves faster at a higher drift speed', () => {
    const slow = defaultLook(), fast = defaultLook();
    const a = new LookDrift(seeded(3)), b = new LookDrift(seeded(3));
    for (let i = 0; i < 30; i++) { a.step(slow, 1 / 60, 0.5); b.step(fast, 1 / 60, 3); }
    expect(Math.abs(fast.hue - defaultLook().hue)).toBeGreaterThan(Math.abs(slow.hue - defaultLook().hue));
  });
});

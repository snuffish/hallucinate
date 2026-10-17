import { describe, expect, it } from 'vitest';
import { defaultLook } from './app-state';
import { LookDrift, RANDOM_RANGES, type DriftKey } from './look-drift';

// A repeatable "random" sequence.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const keys = Object.keys(RANDOM_RANGES) as DriftKey[];

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
    expect(look.mood).toBe(true);
  });

  it('carries on from a value the user set instead of snapping back', () => {
    const look = defaultLook();
    const drift = new LookDrift(seeded(7));
    for (let i = 0; i < 100; i++) drift.step(look, 1 / 60, 1);
    look.speed = 1.55;   // dragged by hand
    drift.step(look, 1 / 60, 1);
    expect(Math.abs(look.speed - 1.55)).toBeLessThan(0.01);
  });

  it('moves faster at a higher drift speed', () => {
    const slow = defaultLook(), fast = defaultLook();
    const a = new LookDrift(seeded(3)), b = new LookDrift(seeded(3));
    for (let i = 0; i < 30; i++) { a.step(slow, 1 / 60, 0.5); b.step(fast, 1 / 60, 3); }
    expect(Math.abs(fast.hue - defaultLook().hue)).toBeGreaterThan(Math.abs(slow.hue - defaultLook().hue));
  });
});

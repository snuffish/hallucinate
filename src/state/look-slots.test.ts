import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLook } from './app-state';
import { RANDOM_RANGES } from './look-drift';
import { INTENSITY_KEYS, LookGlide, intensityValue, loadLookSlots, lookSlotsWriter, slotOf, type SlotLook } from './look-slots';
import { KEYS } from './persistence';

describe('the Look slots A–D, kept with the setup', () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('start empty', () => {
    expect(loadLookSlots()).toEqual([null, null, null, null]);
  });

  it('come back as they were written', () => {
    const b = slotOf({ ...defaultLook(), hue: 0.4, trails: 0.6 });
    const writer = lookSlotsWriter(() => [null, b, null, null]);
    writer.schedule();
    writer.flush();
    expect(loadLookSlots()).toEqual([null, b, null, null]);
    writer.dispose();
  });

  it('load a damaged slot as empty or clamped, and anything else as four empty slots', () => {
    map.set(KEYS.lookSlots, JSON.stringify([{ ...slotOf(defaultLook()), reactivity: 9 }, 'nope', null, null]));
    expect(loadLookSlots()).toEqual([{ ...slotOf(defaultLook()), reactivity: 2 }, null, null, null]);
    map.set(KEYS.lookSlots, JSON.stringify([null, null]));
    expect(loadLookSlots()).toEqual([null, null, null, null]);
  });
});

describe('a slot recall', () => {
  const from = slotOf({ ...defaultLook(), hue: 0.9, speed: 0.5 });
  const to: SlotLook = { ...from, hue: 0.1, speed: 1.5 };

  it('glides there over a second without jumping, the hue the short way round the wheel', () => {
    const look = defaultLook();
    Object.assign(look, from);
    const glide = new LookGlide();
    glide.start(from, to);
    let prev = look.speed;
    for (let i = 0; i < 30; i++) {
      glide.step(look, 1 / 60);
      expect(Math.abs(look.speed - prev)).toBeLessThan(0.06);   // a small step each frame
      prev = look.speed;
    }
    expect(look.speed).toBeGreaterThan(0.5);
    expect(look.speed).toBeLessThan(1.5);
    expect(look.hue === 0 || look.hue > 0.9 || look.hue < 0.1).toBe(true);   // through red (0), not through green and blue
    for (let i = 0; i < 40; i++) glide.step(look, 1 / 60);
    expect(glide.active).toBe(false);
    expect(look.speed).toBeCloseTo(1.5, 9);
    expect(look.hue).toBeCloseTo(0.1, 9);
  });

  it('leaves the look alone once stopped', () => {
    const look = defaultLook();
    const glide = new LookGlide();
    glide.start(from, to);
    glide.stop();
    glide.step(look, 1 / 60);
    expect(look).toEqual(defaultLook());
  });
});

describe('Intensity', () => {
  it('moves Reactivity, Trails and Fringing along the Randomize ranges, 0 the bottom and 1 the top', () => {
    expect(INTENSITY_KEYS).toEqual(['reactivity', 'trails', 'aberration']);
    for (const k of INTENSITY_KEYS) {
      expect(intensityValue(k, 0)).toBe(RANDOM_RANGES[k][0]);
      expect(intensityValue(k, 1)).toBe(RANDOM_RANGES[k][1]);
      expect(intensityValue(k, 3)).toBe(RANDOM_RANGES[k][1]);   // never past the tested ranges
    }
    expect(intensityValue('trails', 0.5)).toBeCloseTo(0.3, 9);
  });
});

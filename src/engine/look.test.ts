import { describe, expect, it } from 'vitest';
import { defaultLook } from '../state/app-state';
import type { Hearing } from './listener';
import { composeFrame, programState, type Motion } from './look';

const sound = (o: Partial<Hearing> = {}): Hearing => ({ bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beat: 0, kick: false, tick: false, tickPhase: 0, ticks: 0, bpm: 120, bright: 0.5, centroid: 2500, energy: 0.5, mood: 0.5, ...o });
const still = (): Motion => ({ time: 0, timeRate: 1, huePhase: 0 });

function frame(h: Hearing, look = defaultLook(), motion = still(), dt = 1 / 60) {
  const p = programState();
  composeFrame(p, motion, h, look, 1, dt);
  return p;
}

describe('composeFrame', () => {
  it('scales the bands by reactivity, up to 1.5', () => {
    const p = frame(sound({ bass: 0.9, mid: 0.2 }), { ...defaultLook(), reactivity: 2 });
    expect(p.bass).toBe(1.5);
    expect(p.mid).toBeCloseTo(0.4);
    expect(p.warp).toBe(1.5);
    expect(p.zoom).toBeCloseTo(1.006 + 1.5 * 0.025);
  });

  it('passes the tick phase and count to the shaders as heard, whatever the reactivity', () => {
    const p = frame(sound({ tickPhase: 0.25, ticks: 37 }), { ...defaultLook(), reactivity: 2 });
    expect(p.tickPhase).toBe(0.25);
    expect(p.ticks).toBe(37);
  });

  it('leaves the tone and the mood unscaled', () => {
    const p = frame(sound({ bright: 0.8, mood: 0.9 }), { ...defaultLook(), reactivity: 2 });
    expect(p.bright).toBe(0.8);
    expect(p.mood).toBe(0.9);
  });

  it('reads bright sound as light, warm and crisp, dark sound as dim, cool and lingering', () => {
    const bright = frame(sound({ bright: 1 })), dark = frame(sound({ bright: 0 }));
    expect(bright.grade.exposure).toBeGreaterThan(1);
    expect(dark.grade.exposure).toBeLessThan(1);
    expect(bright.grade.tint[0]).toBeGreaterThan(bright.grade.tint[2]!);   // warm: more red than blue
    expect(dark.grade.tint[2]).toBeGreaterThan(dark.grade.tint[0]!);
    expect(dark.feedback).toBeGreaterThan(bright.feedback);                // longer trails
    expect(bright.aberration).toBeGreaterThan(dark.aberration);            // more fringing
  });

  it('at synesthesia 0 leaves the colour untouched: a neutral grade, saturation exactly 1', () => {
    const p = frame(sound({ mood: 1, bright: 1 }), { ...defaultLook(), synesthesia: 0 });
    expect(p.grade).toEqual({ exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] });
  });

  it('always lets the mood grade the picture: energetic music is more saturated and warmer, no flag needed', () => {
    const look = { ...defaultLook(), synesthesia: 1 };
    const energetic = frame(sound({ mood: 1 }), look), calm = frame(sound({ mood: 0 }), look);
    expect(energetic.grade.saturation).toBeGreaterThan(1);
    expect(calm.grade.saturation).toBeLessThan(1);
    expect(energetic.grade.tint[0]! - energetic.grade.tint[2]!).toBeGreaterThan(calm.grade.tint[0]! - calm.grade.tint[2]!);
    expect(energetic.mood).toBe(1);
  });

  it('runs the clock faster with louder music and jumps the hue on a kick', () => {
    const quiet = still(), loud = still();
    for (let i = 0; i < 120; i++) { frame(sound({ level: 0 }), defaultLook(), quiet); frame(sound({ level: 1 }), defaultLook(), loud); }
    expect(loud.time).toBeGreaterThan(quiet.time * 1.5);
    const m = still();
    frame(sound({ kick: true }), { ...defaultLook(), cycle: 0, reactivity: 1 }, m, 0);
    expect(m.huePhase).toBeCloseTo(0.03);
  });
});

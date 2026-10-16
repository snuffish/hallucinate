import { describe, expect, it } from 'vitest';
import { defaultLook } from '../state/app-state';
import type { Hearing } from './listener';
import { composeFrame, programState, type Motion } from './look';

const sound = (o: Partial<Hearing> = {}): Hearing => ({ bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beat: 0, kick: false, tick: false, bpm: 120, bright: 0.5, centroid: 2500, energy: 0.5, mood: 0.5, ...o });
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

  it('with "Mood from tempo" off, the mood reads neutral to the grade and the shaders', () => {
    const on = frame(sound({ mood: 1 }));
    const off = frame(sound({ mood: 1 }), { ...defaultLook(), mood: false });
    expect(on.grade.saturation).toBeGreaterThan(1);
    expect(off.grade.saturation).toBe(1);
    expect(off.mood).toBe(0.5);
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

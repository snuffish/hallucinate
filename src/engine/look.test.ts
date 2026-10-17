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
  });

  it('leaves the trails in place: no zoom, rotation, warp or colour drift, however loud', () => {
    const p = frame(sound({ bass: 1, mid: 1, high: 1, level: 1, beat: 1 }), { ...defaultLook(), reactivity: 2 });
    for (const key of ['zoom', 'rotation', 'warp', 'hueDrift']) expect(p).not.toHaveProperty(key);
  });

  it('blends the afterglow by the trails amount, and none at all at trails 0', () => {
    expect(frame(sound(), { ...defaultLook(), trails: 0.5, synesthesia: 0 }).feedback).toBeCloseTo(0.5);
    expect(frame(sound({ bright: 0 }), { ...defaultLook(), trails: 0, synesthesia: 1 }).feedback).toBe(0);
  });

  it('lengthens the afterglow on dark sound through synesthesia', () => {
    const look = { ...defaultLook(), trails: 0.5, synesthesia: 1 };
    expect(frame(sound({ bright: 0 }), look).feedback).toBeGreaterThan(frame(sound({ bright: 0.5 }), look).feedback);
  });

  it('never flashes a kick brighter than 1, whatever the reactivity', () => {
    expect(frame(sound({ beat: 1 }), { ...defaultLook(), reactivity: 2 }).beat).toBe(1);
    expect(frame(sound({ beat: 0.6 }), { ...defaultLook(), reactivity: 2 }).beat).toBe(1);
    expect(frame(sound({ beat: 0.4 }), { ...defaultLook(), reactivity: 2 }).beat).toBeCloseTo(0.8);
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

  it('with "Mood from tempo" off, the mood reads neutral to the grade and the shaders', () => {
    const on = frame(sound({ mood: 1 }));
    const off = frame(sound({ mood: 1 }), { ...defaultLook(), mood: false });
    expect(on.grade.saturation).toBeGreaterThan(1);
    expect(off.grade.saturation).toBe(1);
    expect(off.mood).toBe(0.5);
  });

  it('runs the clock faster with louder music', () => {
    const quiet = still(), loud = still();
    for (let i = 0; i < 120; i++) { frame(sound({ level: 0 }), defaultLook(), quiet); frame(sound({ level: 1 }), defaultLook(), loud); }
    expect(loud.time).toBeGreaterThan(quiet.time * 1.5);
  });

  it('at Colour cycling 0 holds the hue across kicks, at any reactivity', () => {
    for (const reactivity of [0, 1, 2]) {
      const m = still();
      for (let i = 0; i < 60; i++) frame(sound({ kick: i % 10 === 0, beat: 1 }), { ...defaultLook(), cycle: 0, reactivity }, m);
      expect(m.huePhase).toBe(0);
    }
  });

  it('jumps the hue on a kick further the higher Colour cycling is', () => {
    const jump = (cycle: number) => { const m = still(); frame(sound({ kick: true }), { ...defaultLook(), cycle }, m, 0); return m.huePhase; };
    expect(jump(0.5)).toBeGreaterThan(0);
    expect(jump(1)).toBeGreaterThan(jump(0.5));
    expect(jump(2)).toBeGreaterThan(jump(1));
  });

  it('jumps the hue on a kick no further at higher reactivity', () => {
    const jump = (reactivity: number) => { const m = still(); frame(sound({ kick: true }), { ...defaultLook(), cycle: 1, reactivity }, m, 0); return m.huePhase; };
    expect(jump(2)).toBe(jump(1));
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { STRONGEST_LOOK } from '../state/look-drift';
import { composeFrame, programState } from './look';
import { SCENE_INPUTS, stillHearing, stillUniforms } from './scene-inputs';
import { EDGE_BAND, EDGE_CLEAR, EDGE_FADE, EDGE_FULL, EFFECTS, EffectStackSchema, addEffect, cleanStack, effectDef, effectShader, passesOf, effectsToAdd, moveEffect, removeEffect, setEffectOn, setEffectSetting, strongest } from './effects';

describe('cleaning up a stored effect stack', () => {
  it('keeps a well-formed stack as it is', () => {
    expect(cleanStack([{ id: 'mirror', on: false, settings: { axis: 1 } }])).toEqual([{ id: 'mirror', on: false, settings: { axis: 1 } }]);
  });

  it('drops effects it does not know', () => {
    expect(cleanStack([{ id: 'echo', on: true, settings: {} }, { id: 'mirror', on: true, settings: { axis: 2 } }]))
      .toEqual([{ id: 'mirror', on: true, settings: { axis: 2 } }]);
  });

  it('keeps the first of a duplicate', () => {
    expect(cleanStack([{ id: 'mirror', on: true, settings: { axis: 1 } }, { id: 'mirror', on: false, settings: { axis: 2 } }]))
      .toEqual([{ id: 'mirror', on: true, settings: { axis: 1 } }]);
  });

  it('clamps settings to their ranges and steps', () => {
    expect(cleanStack([{ id: 'mirror', on: true, settings: { axis: 9 } }])[0]!.settings).toEqual({ axis: 2 });
    expect(cleanStack([{ id: 'mirror', on: true, settings: { axis: -3 } }])[0]!.settings).toEqual({ axis: 0 });
    expect(cleanStack([{ id: 'mirror', on: true, settings: { axis: 1.4 } }])[0]!.settings).toEqual({ axis: 1 });
  });

  it('gives missing or broken settings their defaults and forgets ones it does not know', () => {
    expect(cleanStack([{ id: 'mirror', on: true }])[0]!.settings).toEqual({ axis: 0 });
    expect(cleanStack([{ id: 'mirror', on: true, settings: { axis: 'both', glow: 3 } }])[0]!.settings).toEqual({ axis: 0 });
  });

  it('switches an effect on when the stack does not say', () => {
    expect(cleanStack([{ id: 'mirror' }])).toEqual([{ id: 'mirror', on: true, settings: { axis: 0 } }]);
  });

  it('reads anything that is not a list of effects as no effects', () => {
    for (const garbage of [null, undefined, 3, 'mirror', { id: 'mirror' }]) expect(cleanStack(garbage)).toEqual([]);
    expect(cleanStack([null, 7, 'mirror', { on: true }])).toEqual([]);
  });

  it('reads a stored value without a stack as one with no effects, and never fails it', () => {
    const Stored = z.object({ name: z.string(), effects: EffectStackSchema });
    expect(Stored.parse({ name: 'old' })).toEqual({ name: 'old', effects: [] });
    expect(Stored.parse({ name: 'broken', effects: { id: 'mirror' } })).toEqual({ name: 'broken', effects: [] });
  });
});

describe('editing a stack', () => {
  it('adds an effect switched on, at its defaults, at the end, and only once', () => {
    const one = addEffect([], 'mirror');
    expect(one).toEqual([{ id: 'mirror', on: true, settings: { axis: 0 } }]);
    expect(addEffect(one, 'mirror')).toBe(one);
  });

  it('offers only the effects not yet in the stack', () => {
    expect(effectsToAdd([]).map((e) => e.id)).toEqual(EFFECTS.map((e) => e.id));
    expect(effectsToAdd(addEffect([], 'mirror')).map((e) => e.id)).not.toContain('mirror');
  });

  it('switches an effect off and on, keeping its settings', () => {
    const stack = [{ id: 'mirror' as const, on: true, settings: { axis: 2 } }];
    const off = setEffectOn(stack, 'mirror', false);
    expect(off).toEqual([{ id: 'mirror', on: false, settings: { axis: 2 } }]);
    expect(setEffectOn(off, 'mirror', true)).toEqual(stack);
  });

  it('sets a setting within its range', () => {
    const stack = addEffect([], 'mirror');
    expect(setEffectSetting(stack, 'mirror', 'axis', 1)[0]!.settings).toEqual({ axis: 1 });
    expect(setEffectSetting(stack, 'mirror', 'axis', 7)[0]!.settings).toEqual({ axis: 2 });
    expect(setEffectSetting(stack, 'mirror', 'size', 1)).toBe(stack);   // no such setting
  });

  it('removes an effect', () => {
    expect(removeEffect(addEffect([], 'mirror'), 'mirror')).toEqual([]);
  });

  it('moves an effect to another place in the order', () => {
    const a = { id: 'mirror' as const, on: true, settings: { axis: 0 } };
    const b = { id: 'other' as never, on: true, settings: {} };
    const c = { id: 'third' as never, on: true, settings: {} };
    expect(moveEffect([a, b, c], 'mirror', 2)).toEqual([b, c, a]);
    expect(moveEffect([a, b, c], 'third' as never, 0)).toEqual([c, a, b]);
    expect(moveEffect([a, b, c], 'mirror', 9)).toEqual([b, c, a]);
  });

  it('never edits the stack it was given', () => {
    const stack = Object.freeze([Object.freeze({ id: 'mirror' as const, on: true, settings: Object.freeze({ axis: 0 }) })]);
    expect(() => { setEffectOn(stack, 'mirror', false); setEffectSetting(stack, 'mirror', 'axis', 2); removeEffect(stack, 'mirror'); moveEffect(stack, 'mirror', 0); }).not.toThrow();
    expect(stack).toEqual([{ id: 'mirror', on: true, settings: { axis: 0 } }]);
  });
});

describe('the catalogue', () => {
  it('gives every setting a default inside its range and on its step, and a label for each choice', () => {
    for (const e of EFFECTS) for (const s of e.settings as readonly { key: string; min: number; max: number; step: number; default: number; options?: readonly string[] }[]) {
      expect(s.default, `${e.id}.${s.key}`).toBeGreaterThanOrEqual(s.min);
      expect(s.default, `${e.id}.${s.key}`).toBeLessThanOrEqual(s.max);
      expect(Number.isInteger(Math.round((s.default - s.min) / s.step * 1e6) / 1e6), `${e.id}.${s.key}`).toBe(true);
      if (s.options) expect(s.options.length, `${e.id}.${s.key}`).toBe((s.max - s.min) / s.step + 1);
    }
  });

  it('has each effect once', () => {
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
  });

  it("runs an effect at its strongest at the top of every setting's range", () => {
    expect(strongest('mirror')).toEqual([{ id: 'mirror', on: true, settings: { axis: 2 } }]);   // both axes
    expect(strongest('glow')).toEqual([{ id: 'glow', on: true, settings: { strength: 1.5, radius: 24 } }]);
  });

  it('offers a Glow with a strength and a radius, at its defaults when added', () => {
    expect(addEffect([], 'glow')).toEqual([{ id: 'glow', on: true, settings: { strength: 0.8, radius: 10 } }]);
    expect(cleanStack([{ id: 'glow', settings: { strength: 9, radius: -1 } }])[0]!.settings).toEqual({ strength: 1.5, radius: 2 });
  });

  it('renders the passes before a picture step at a share of the picture no larger than all of it', () => {
    for (const e of EFFECTS) for (const pass of passesOf(e)) {
      expect(pass.scale, e.id).toBeGreaterThan(0);
      expect(pass.scale, e.id).toBeLessThanOrEqual(1);
    }
    expect(passesOf(effectDef('glow')!).length, 'a blur before the glow').toBeGreaterThan(0);
  });

  it('folds a Kaleidoscope into 3 to 12 whole segments, strongest at 12 and its fastest spin', () => {
    const k = EFFECTS.find((e) => e.id === 'kaleidoscope')!;
    expect(k.settings.map((s) => [s.key, s.min, s.max, s.step])).toEqual([['segments', 3, 12, 1], ['spin', 0, 1, 0.01]]);
    expect(cleanStack([{ id: 'kaleidoscope', settings: { segments: 7.6, spin: 4 } }])[0]!.settings).toEqual({ segments: 8, spin: 1 });
    expect(cleanStack([{ id: 'kaleidoscope', settings: { segments: 1 } }])[0]!.settings.segments).toBe(3);
    expect(strongest('kaleidoscope')).toEqual([{ id: 'kaleidoscope', on: true, settings: { segments: 12, spin: 1 } }]);
  });

  // The bass or a fading kick read directly would spring the turn back as they fall; the effects' turn
  // (uTurn, composeFrame) holds their pace and only ever runs on.
  it('turns a Kaleidoscope on the effects\' turn alone, so nothing it hears can turn it back', () => {
    const k = EFFECTS.find((e) => e.id === 'kaleidoscope')!;
    const read = new Set(k.glsl.match(/\bu[A-Z]\w*/g));
    expect([...read].sort()).toEqual(['uRes', 'uSegments', 'uSpin', 'uTurn']);
    expect(effectShader(k)).toMatch(/uniform float uTurn;/);
  });
});

// The safety spec measures the border band (EDGE_BAND) in silence; the effects leave the scene's own
// picture alone from the edge to EDGE_CLEAR. Between the two lies the reach of the Look's fringing, which
// pulls colour outward from inside: at its strongest (STRONGEST_LOOK, the most Randomize or Drift sets)
// with no kick, in the brightest tone (a quiet stretch of a crisp track), the display pass reads up to
// half the fringing amount of the picture's width away (16:9: the width is 16/9 short sides). An effect's
// light pulled that far must still miss the band. (A kick fringes further, but the edge rule is about
// silence; a kick answers to the strobe rule.)
describe('the edge fade', () => {
  it('leaves the scene alone across the measured band and the Look\'s strongest fringing beyond it', () => {
    const p = programState();
    const quiet = stillHearing(stillUniforms({ uBass: 0, uMid: 0, uHigh: 0, uLevel: 0, uBeat: 0, uBright: 1 }), false);
    composeFrame(p, { time: 0, timeRate: 1, huePhase: 0, turn: 0 }, quiet, STRONGEST_LOOK, 1, 1 / 60);
    const fringing = 0.5 * p.aberration * (16 / 9);
    expect(fringing).toBeGreaterThan(0.005);   // 3.6 px of 720: there is a reach to cover
    expect(EDGE_BAND).toBeGreaterThan(0);
    expect(EDGE_CLEAR - EDGE_BAND).toBeGreaterThanOrEqual(fringing);
    expect(EDGE_FULL).toBeCloseTo(EDGE_CLEAR + EDGE_FADE);
  });
});

describe('the Wave', () => {
  it('has an amount and a wavelength, each a slider', () => {
    expect(addEffect([], 'wave')).toEqual([{ id: 'wave', on: true, settings: { amount: 0.4, wavelength: 0.4 } }]);
    const wave = EFFECTS.find((e) => e.id === 'wave')!;
    expect(wave.settings.map((s) => [s.key, 'options' in s])).toEqual([['amount', false], ['wavelength', false]]);
  });

  it('is strongest at its largest amount and its longest wavelength', () => {
    expect(strongest('wave')).toEqual([{ id: 'wave', on: true, settings: { amount: 1, wavelength: 1 } }]);
  });

  it('keeps a stored Wave within its ranges', () => {
    expect(cleanStack([{ id: 'wave', on: true, settings: { amount: 5, wavelength: 0 } }])[0]!.settings).toEqual({ amount: 1, wavelength: 0.1 });
  });

  // Its kick ripple reads the scene inputs the scene reads: no input of its own.
  it('moves with the kick through the existing scene inputs', () => {
    const wave = EFFECTS.find((e) => e.id === 'wave')!;
    const known = new Set<string>([...SCENE_INPUTS.map((i) => i.uniform), ...wave.settings.map((s) => s.uniform), 'uRes']);
    const read = new Set(wave.glsl.match(/\bu[A-Z]\w*/g));
    expect([...read].filter((u) => !known.has(u))).toEqual([]);
    expect(read).toContain('uBeat');
  });
});

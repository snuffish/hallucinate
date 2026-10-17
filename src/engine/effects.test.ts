import { describe, expect, it } from 'vitest';
import { EFFECTS, addEffect, cleanStack, effectsToAdd, moveEffect, removeEffect, setEffectOn, setEffectSetting, strongest } from './effects';

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
  });

  it('folds a Kaleidoscope into 3 to 12 whole segments, strongest at 12 and its fastest spin', () => {
    const k = EFFECTS.find((e) => e.id === 'kaleidoscope')!;
    expect(k.settings.map((s) => [s.key, s.min, s.max, s.step])).toEqual([['segments', 3, 12, 1], ['spin', 0, 1, 0.01]]);
    expect(cleanStack([{ id: 'kaleidoscope', settings: { segments: 7.6, spin: 4 } }])[0]!.settings).toEqual({ segments: 8, spin: 1 });
    expect(cleanStack([{ id: 'kaleidoscope', settings: { segments: 1 } }])[0]!.settings.segments).toBe(3);
    expect(strongest('kaleidoscope')).toEqual([{ id: 'kaleidoscope', on: true, settings: { segments: 12, spin: 1 } }]);
  });
});

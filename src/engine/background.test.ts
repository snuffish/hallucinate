import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BACKGROUND_KINDS, BACKGROUND_MAX, BACKGROUND_SHADER, BackgroundSchema, NO_BACKGROUND, backgroundUniforms, brightest, cleanBackground, hasBackground, setBackgroundColour, setBackgroundKind, setBackgroundSetting, type Background } from './background';
import { EDGE_CLEAR, EDGE_FULL } from './effects';

const BLUE: Background = { kind: 'colour', colour: '#0000ff', colour2: '#ff0000', angle: 45, brightness: 0.8, breathe: 0.2 };

describe('cleaning up a stored background', () => {
  it('keeps a well-formed background as it is', () => {
    expect(cleanBackground(BLUE)).toEqual(BLUE);
  });

  it('reads an unknown kind, or anything that is not a background, as none', () => {
    expect(cleanBackground({ ...BLUE, kind: 'video' }).kind).toBe('none');
    for (const garbage of [null, undefined, 3, 'colour', ['colour']]) expect(cleanBackground(garbage)).toEqual(NO_BACKGROUND);
  });

  it('gives a colour that is not #rrggbb its default, and lower-cases one that is', () => {
    expect(cleanBackground({ ...BLUE, colour: 'blue', colour2: '#12' })).toMatchObject({ colour: NO_BACKGROUND.colour, colour2: NO_BACKGROUND.colour2 });
    expect(cleanBackground({ ...BLUE, colour: '#AABBCC' }).colour).toBe('#aabbcc');
  });

  it('clamps numbers to their ranges and steps, and gives missing ones their defaults', () => {
    expect(cleanBackground({ ...BLUE, angle: 720, brightness: 3, breathe: -1 })).toMatchObject({ angle: 360, brightness: 1, breathe: 0 });
    expect(cleanBackground({ ...BLUE, brightness: 0.333 }).brightness).toBe(0.33);
    expect(cleanBackground({ kind: 'gradient' })).toEqual({ ...NO_BACKGROUND, kind: 'gradient' });
  });

  it('never fails the value it sits in: missing reads as none', () => {
    const Holder = z.object({ background: BackgroundSchema });
    expect(Holder.parse({}).background).toEqual(NO_BACKGROUND);
    expect(Holder.parse({ background: { kind: 7 } }).background).toEqual(NO_BACKGROUND);
  });
});

describe('editing a background', () => {
  it('returns the same one when nothing changes, and never edits the one given', () => {
    expect(setBackgroundKind(BLUE, 'colour')).toBe(BLUE);
    expect(setBackgroundColour(BLUE, 'colour', '#0000FF')).toBe(BLUE);
    expect(setBackgroundSetting(BLUE, 'brightness', 0.8)).toBe(BLUE);
    const next = setBackgroundKind(BLUE, 'gradient');
    expect(next).toEqual({ ...BLUE, kind: 'gradient' });
    expect(BLUE.kind).toBe('colour');
  });

  it('keeps a bad colour as it was and clamps a number', () => {
    expect(setBackgroundColour(BLUE, 'colour2', 'red')).toBe(BLUE);
    expect(setBackgroundSetting(BLUE, 'breathe', 5).breathe).toBe(1);
    expect(setBackgroundKind(BLUE, 'nope' as never)).toBe(BLUE);
  });

  it('has a background unless it is none', () => {
    expect(hasBackground(NO_BACKGROUND)).toBe(false);
    for (const k of BACKGROUND_KINDS.filter((k) => k.id !== 'none')) expect(hasBackground(brightest(k.id))).toBe(true);
  });
});

describe('the background pass', () => {
  it('writes each picture as its kind, angle in radians, brightness, breathe and linear colours', () => {
    const u = backgroundUniforms({ ...BLUE, kind: 'gradient', angle: 180 }, { params: [0, 0, 0, 0], colour: [0, 0, 0], colour2: [0, 0, 0] });
    expect(u.params).toEqual([2, Math.PI, 0.8, 0.2]);
    expect(u.colour).toEqual([0, 0, 1]);
    expect(u.colour2).toEqual([1, 0, 0]);
  });

  it('caps the brightness, fades at the edges like the effects, and never reads the bass or the kick', () => {
    expect(BACKGROUND_MAX).toBeLessThanOrEqual(0.35);
    expect(BACKGROUND_SHADER).toContain(String(EDGE_CLEAR));
    expect(BACKGROUND_SHADER).toContain(String(EDGE_FULL));
    expect(BACKGROUND_SHADER).not.toMatch(/\buBeat\b|\buBass\b|\buLevel\b/);
  });
});

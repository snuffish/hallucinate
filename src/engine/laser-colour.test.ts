import { describe, expect, it } from 'vitest';
import { LASER_GRADIENT, PALETTE_FLOATS, laserCss, laserRgb, packPalette, paletteHue } from './laser-colour';

// Each channel within floating-point error of the expected one.
const near = (t: number, rgb: number[]) => laserRgb(t).forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 9));

describe('the laser palette in TypeScript', () => {
  it('walks the same wheel as GLSL laser(): the six pure colours at every sixth, repeating every 1.0', () => {
    near(0, [1, 0, 0]);
    near(1 / 6, [1, 1, 0]);
    near(1 / 3, [0, 1, 0]);
    near(1 / 2, [0, 1, 1]);
    near(2 / 3, [0, 0, 1]);
    near(5 / 6, [1, 0, 1]);
    near(1.25, laserRgb(0.25));
    near(-0.75, laserRgb(0.25));
  });

  it('keeps every colour at full strength: one channel always lit fully', () => {
    for (let t = 0; t < 1; t += 0.01) expect(Math.max(...laserRgb(t))).toBeCloseTo(1, 6);
  });

  it('writes CSS colours and a wheel gradient', () => {
    expect(laserCss(1 / 12)).toBe('rgb(255 128 0)');
    expect(LASER_GRADIENT('90deg')).toBe('linear-gradient(90deg, rgb(255 0 0), rgb(255 255 0), rgb(0 255 0), rgb(0 255 255), rgb(0 0 255), rgb(255 0 255), rgb(255 0 0))');
  });
});

describe("the Look's palette over the wheel (ADR 0004)", () => {
  const BLUE_YELLOW = { hues: [2 / 3, 1 / 6], steps: false };

  it('is the whole wheel without hues', () => {
    for (const t of [0, 0.3, 1.7]) expect(paletteHue(t, { hues: [], steps: false })).toBeCloseTo(t - Math.floor(t), 9);
  });

  it('walks the hues in order and comes back round, each to the next the short way round the wheel', () => {
    const p = { hues: [0.9, 0.1, 0.5], steps: false };
    expect(paletteHue(0, p)).toBeCloseTo(0.9, 9);
    expect(paletteHue(1 / 3, p)).toBeCloseTo(0.1, 9);
    expect(paletteHue(2 / 3, p)).toBeCloseTo(0.5, 9);
    expect(paletteHue(1 / 6, p)).toBeCloseTo(0, 9);        // 0.9 → 0.1 through red, not through green and blue
    expect(paletteHue(1 + 1 / 3, p)).toBeCloseTo(0.1, 9);  // repeats every 1.0
  });

  it('keeps every colour at full strength, also between two hues', () => {
    for (let t = 0; t < 1; t += 0.01) expect(Math.max(...laserRgb(paletteHue(t, BLUE_YELLOW)))).toBeCloseTo(1, 6);
  });

  it('in steps, holds each hue and eases to the next over the last 30% of it, never in a jump', () => {
    const p = { ...BLUE_YELLOW, steps: true };
    expect(paletteHue(0.1, p)).toBeCloseTo(2 / 3, 9);   // held
    expect(paletteHue(0.34, p)).toBeCloseTo(2 / 3, 9);  // still held at 68% of the first half
    let prev = paletteHue(0.35, p);
    for (let t = 0.35; t <= 0.5; t += 0.001) {
      const h = paletteHue(t, p);
      expect(Math.abs(h - prev)).toBeLessThan(0.02);   // a small move for each small step of t
      prev = h;
    }
    expect(paletteHue(0.5, p)).toBeCloseTo(1 / 6, 9);
  });

  it('packs as the shaders read it: the hues, how many, whether it steps', () => {
    const out = new Float32Array(PALETTE_FLOATS);
    packPalette(out, { hues: [0.1, 0.2, 0.3], steps: true });
    expect([...out].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.1, 0.2, 0.3, 0, 0, 3, 1, 0]);
    packPalette(out, { hues: [], steps: false });
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

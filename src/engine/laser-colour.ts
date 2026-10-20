// The laser palette in TypeScript: the same wheel as GLSL laser() in src/scenes/header.ts, for the
// controls that show a colour (the Look's Colour swatch and XY pad, the studio's cue swatches), and the
// Look's palette over it (ADR 0004).

import { clamp01, fract, lerpHue, smoothstep } from './math';

const channel = (t: number, offset: number): number => clamp01(Math.abs(fract(t + offset / 3) * 6 - 3) - 1);

// laser(t): pure, fully saturated colours, red -> yellow -> green -> cyan -> blue -> magenta -> red, every 1.0.
export const laserRgb = (t: number): [number, number, number] => [channel(t, 0), channel(t, 2), channel(t, 1)];

export const laserCss = (t: number): string => {
  const [r, g, b] = laserRgb(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
};

// The hue laser(t) shows under `palette` (ADR 0004), the twin of GLSL laser() in src/scenes/header.ts: the whole
// wheel without hues; otherwise t walks the hues, each to the next the short way round the wheel, smoothly or
// in steps that ease over the last STEP_EASE of each.
export const STEP_EASE = 0.3;
export function paletteHue(t: number, palette: { readonly hues: readonly number[]; readonly steps: boolean }): number {
  const n = palette.hues.length;
  if (n < 1) return fract(t);
  const p = fract(t) * n;
  const i = Math.min(n - 1, Math.floor(p));
  let f = p - i;
  const a = palette.hues[i]!, b = palette.hues[(i + 1) % n]!;
  if (palette.steps) f = smoothstep((f - (1 - STEP_EASE)) / STEP_EASE);
  return lerpHue(a, b, f);
}

// A palette as the shaders read it (uniform vec4 uPalette[2]): the hues, then how many, then whether it steps.
export const PALETTE_FLOATS = 8;
export function packPalette(out: Float32Array, palette: { readonly hues: readonly number[]; readonly steps: boolean }): void {
  const n = Math.min(5, palette.hues.length);
  for (let i = 0; i < 5; i++) out[i] = i < n ? palette.hues[i]! : 0;
  out[5] = n;
  out[6] = palette.steps ? 1 : 0;
  out[7] = 0;
}

// The wheel as a CSS gradient along `direction`, for a track or a pad that picks a hue.
export const LASER_GRADIENT = (direction: string): string =>
  `linear-gradient(${direction}, ${[0, 1, 2, 3, 4, 5, 6].map((i) => laserCss(i / 6)).join(', ')})`;

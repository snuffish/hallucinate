// Small numeric helpers shared by the engine, the state and the controls. The GLSL twins (fract, smoothstep,
// the hue's short way round) live in src/scenes/header.ts.

export const fract = (x: number): number => x - Math.floor(x);

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// Eased 0 -> 1, flat at both ends; x is clamped to 0..1 first.
export const smoothstep = (x: number): number => { x = clamp01(x); return x * x * (3 - 2 * x); };

// From hue `a` toward hue `b` by `f`, the short way round the wheel (hues wrap every 1.0).
export const lerpHue = (a: number, b: number, f: number): number => fract(a + (fract(b - a + 0.5) - 0.5) * f);

// "#rrggbb" as 0..1 channels.
export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

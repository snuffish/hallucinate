// The laser palette in TypeScript: the same wheel as GLSL laser() in src/scenes/header.ts, for the
// controls that show a colour (the Look's Colour swatch and XY pad, the studio's cue swatches).

const fract = (x: number): number => x - Math.floor(x);
const channel = (t: number, offset: number): number => Math.min(1, Math.max(0, Math.abs(fract(t + offset / 3) * 6 - 3) - 1));

// laser(t): pure, fully saturated colours, red -> yellow -> green -> cyan -> blue -> magenta -> red, every 1.0.
export const laserRgb = (t: number): [number, number, number] => [channel(t, 0), channel(t, 2), channel(t, 1)];

export const laserCss = (t: number): string => {
  const [r, g, b] = laserRgb(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
};

// The wheel as a CSS gradient along `direction`, for a track or a pad that picks a hue.
export const LASER_GRADIENT = (direction: string): string =>
  `linear-gradient(${direction}, ${[0, 1, 2, 3, 4, 5, 6].map((i) => laserCss(i / 6)).join(', ')})`;

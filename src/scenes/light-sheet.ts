import { scene } from './scene';

// The "laser ceiling": a sheet of light overhead, drawn as scan lines receding to the horizon. It ripples
// with the spectrum (near lines = bass, far lines = treble), dips on kicks, and a bright front runs from
// near to far on every tick.
const BODY = /* glsl */ `
// @group Sheet
const float LINES = 28.;     // @param min=8 max=48 int label="Scan lines"
const float HEIGHT = .28;    // @param min=.08 max=.6 label="Sheet height"
const float RIPPLE = 1.;     // @param min=0 max=2.5 label="Ripple (spectrum)"
// @group Look
const float WIDTH = 1.5;     // @param min=.75 max=5 label="Line width (px)"
const float HAZE = .35;      // @param min=0 max=1 label="Haze (glow around the lines)"
const float KICK = 1.6;      // @param min=0 max=3 label="Kick wave"

void main() {
  vec2 p = centered();
  float px = onePixel();
  p *= rot(sin(uTime * .11) * .04);          // a slow roll, as if the room breathes

  const float HORIZON = -.18, FOCAL = 1.;
  float h0 = HEIGHT * (1. - .25 * uBeat);    // the sheet drops a little on each kick
  vec3 c = rainbow(uHue);
  vec3 col = vec3(0.);

  // Haze texture: slow noise drifting out towards the horizon, read once per pixel.
  float n = noise(vec2(p.x * 3., p.y * 7. - uTime * .3));
  float hazeR = 22. * px;                    // haze glows this far around a line, and stops there
  float haze = HAZE * .16 * (.4 + .9 * n) * (.6 + .6 * min(uLevel, 1.));
  float wave = 1. - uBeat;                   // the kick runs out from the near lines to the far ones

  for (float k = 0.; k < LINES; k++) {
    float f = (k + .5) / LINES;              // 0 near … 1 far
    float z = .5 + 9.5 * f * f;
    float xw = p.x * z / FOCAL;
    float amp = .15 + 1.5 * spec(mix(.03, .7, f));
    float ph = xw * 6. + z * 1.3 - uTime * 2.;
    float h = h0 + RIPPLE * .04 * amp * (sin(ph) + .4 * sin(ph * 2.3 + uTime));
    float slope = RIPPLE * .04 * amp * 6. * (cos(ph) + .92 * cos(ph * 2.3 + uTime));
    float d = (p.y - (HORIZON + FOCAL * h / z)) / sqrt(1. + slope * slope);
    float level = (.45 + 1.1 * amp) * exp(-z * .16);
    level += 1.4 * exp(-abs(f - uTick) * 14.);                         // the tick front
    level *= 1. + KICK * uBeat * exp(-abs(f - wave) * 9.);           // the kick wave: a few lines at a time
    float g = 1. - smoothstep(0., hazeR, abs(d));
    col += c * (beam(d, WIDTH * px) + haze * g * g) * level;
  }

  fragColor = vec4(col, 1.);
}
`;

export const LIGHT_SHEET = scene('Light Sheet', 'Beams', 'A laser ceiling: scan lines receding to a horizon, rippling with the spectrum, a front running out on each tick', BODY);

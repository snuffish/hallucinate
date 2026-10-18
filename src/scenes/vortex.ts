import { scene } from './scene';

// Spiral arms of light winding out from the centre, like a galaxy drawn with beams. The bass winds them
// tighter, their brightness follows the spectrum outwards (bass at the core, treble at the rim), a
// pulse runs out along every arm on each tick, and a kick flares every other arm. They fade out well
// before the edges.
//
// The arms are logarithmic spirals, angle = TWIST · ln(r) + spin: in log-polar terms they are straight,
// evenly spaced lines, so the nearest arm is found in one step and only it and its neighbours are drawn.
const BODY = /* glsl */ `
// @group Vortex
const float ARMS = 5.;       // @param min=2 max=12 int label="Arms"
const float TWIST = 2.;      // @param min=0 max=5 label="Twist (winds tighter with the bass)"
const float SPIN = .3;       // @param min=0 max=1.5 label="Spin speed"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Beam width (px)"
const float PULSE = 1.;      // @param min=0 max=2 label="Tick pulse"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

void main() {
  vec2 p = centered();
  float px = onePixel();
  float r = max(length(p), 1e-4);
  float a = atan(p.y, p.x);

  float twist = TWIST * (.8 + .3 * min(uBass, 1.2));
  float stretch = sqrt(1. + twist * twist);
  float spin = uTime * SPIN;
  float ph = (a - twist * log(r) - spin) * ARMS / TAU;     // arm k sits where ph = k
  float nearest = floor(ph + .5);

  float f = clamp(r / .42, 0., 1.);                          // 0 core … 1 rim
  float front = .03 + .4 * sqrt(uTick);                      // the tick pulse, running out
  float pulse = PULSE * 1.5 * exp(-abs(r - front) * 28.) * (1. - uTick);
  float mask = smoothstep(.0, .05, r) * smoothstep(.44, .3, r);

  vec3 col = vec3(0.);
  for (float j = -1.; j <= 1.; j++) {
    float k = nearest + j;
    float i = mod(k, ARMS);
    float d = r * (ph - k) * TAU / ARMS / stretch;           // across the arm
    float kicked = mod(i + uTicks, 2.) < .5 ? uBeat * FLARE : 0.;
    float level = .35 + 1.2 * spec(.03 + .6 * f) + pulse + 2. * kicked;
    vec3 c = mix(laser(uHue + (i / ARMS - .5) * .1 + f * .08), vec3(1.), .5 * kicked);
    col += c * beam(d, WIDTH * px) * level * mask;
  }
  col += laser(uHue) * beam(r, 4. * px) * (1. + uBeat * FLARE);   // the core
  fragColor = vec4(col, 1.);
}
`;

export const VORTEX = scene('Vortex', 'Beams', 'Spiral arms of light winding out from the centre: the bass winds them tighter, a pulse runs out on each tick', BODY);

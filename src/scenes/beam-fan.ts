import { scene } from './scene';

// A fan of thin beams rising from the bottom edge. It sweeps, opens with the bass, the beams strobe on
// kicks, and a chase steps one beam along on every tick. Flat and hard-edged, on pure black.
const BODY = /* glsl */ `
// @group Fan
const float BEAMS = 12.;     // @param min=3 max=32 int label="Beams"
const float SPREAD = .65;    // @param min=.1 max=1.4 label="Spread (opens with the bass)"
const float SWEEP = .35;     // @param min=0 max=2 label="Sweep speed"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Beam width (px)"
const float STROBE = .8;     // @param min=0 max=1 label="Kick strobe"

void main() {
  vec2 p = centered();
  float px = 1. / uRes.y;

  vec2 q = p - vec2(0., -.52);               // the source sits just below the bottom edge
  float r = length(q);
  float a = atan(q.x, q.y);                  // 0 = straight up

  float sweep = sin(uTime * SWEEP) * .35 + sin(uTime * SWEEP * .37 + 1.) * .15;
  float spread = SPREAD * (.45 + .7 * min(uBass, 1.2));
  float gap = 2. * spread / max(BEAMS - 1., 1.);
  float nearest = floor((a - sweep + spread) / gap + .5);
  float chase = mod(uTicks, BEAMS);
  float strobe = uBeat * STROBE;

  vec3 col = vec3(0.);
  for (float j = -1.; j <= 1.; j++) {        // the nearest beam and its neighbours, for halos where they converge
    float i = nearest + j;
    if (i < 0. || i > BEAMS - 1.) continue;
    float da = a - (sweep - spread + i * gap);
    if (abs(da) > 1.5) continue;
    float d = r * sin(da);
    float f = i / max(BEAMS - 1., 1.);
    float level = .35 + 1.3 * spec(.04 + .5 * f);                     // calm but lit when quiet
    level += (i == chase ? 1.6 * (1. - uTick) * (1. - uTick) : 0.);  // the tick chase
    level += 2. * strobe;
    vec3 c = mix(rainbow(uHue + (f - .5) * .08), vec3(1.), .55 * strobe);
    col += c * beam(d, WIDTH * px) * level * mix(1., .45, clamp(r, 0., 1.));
  }
  col += rainbow(uHue) * beam(r, 5. * px) * (1. + strobe);            // hot spot at the source
  fragColor = vec4(col, 1.);
}
`;

export const BEAM_FAN = scene('Beam Fan', 'Beams', 'A fan of laser beams rising from the floor: sweeps, opens with the bass, chases the ticks', BODY);

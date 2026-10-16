import { scene } from './scene';

// A star of thin beams from the centre, one per frequency band, each as long as its band is loud: bass
// at the top, treble at the bottom, mirrored left and right. The star turns slowly and steps one ray on
// every tick; a kick strobes every third ray (which third moves with the ticks). On pure black.
const BODY = /* glsl */ `
// @group Rays
const float RAYS = 48.;      // @param min=8 max=96 int label="Rays"
const float REACH = .5;      // @param min=.1 max=1 label="Reach (how far a loud band shoots)"
const float SPIN = .06;      // @param min=0 max=1 label="Spin speed"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Beam width (px)"
const float STROBE = .8;     // @param min=0 max=1 label="Kick strobe"

void main() {
  vec2 p = centered();
  float px = onePixel();
  float r = length(p);
  float a = atan(p.x, p.y);                  // 0 = straight up

  float gap = TAU / RAYS;
  float step = easedTicks();              // one ray further on each tick, eased
  float turn = uTime * SPIN + step * gap;
  float nearest = floor((a - turn) / gap + .5);
  float strobe = uBeat * STROBE;

  vec3 col = vec3(0.);
  for (float j = -1.; j <= 1.; j++) {        // the nearest ray and its neighbours, for halos where they converge
    float k = nearest + j;
    float i = mod(k, RAYS);
    float da = a - (turn + k * gap);
    if (abs(da) > 1.5) continue;
    float f = 1. - abs(2. * i / RAYS - 1.);                     // 0 = bass (top) … 1 = treble (bottom)
    float loud = spec(.03 + .6 * f);
    float len = .08 + REACH * loud * (.8 + .5 * f);             // calm stubs in silence
    float along = r * cos(da), across = r * sin(da);
    float d = along > len ? length(vec2(along - len, across)) : abs(across);
    float kicked = mod(i + uTicks, 3.) < .5 ? strobe : 0.;      // a staggered third of the rays
    float level = (.35 + 1.2 * loud + 2. * kicked) * mix(.35, 1., clamp(along / max(len, .01), 0., 1.));
    vec3 c = mix(rainbow(uHue + (f - .5) * .12), vec3(1.), .5 * kicked);
    col += c * (beam(d, WIDTH * px) * level + beam(length(vec2(along - len, across)), 2. * WIDTH * px) * (.6 + kicked));
  }
  col += rainbow(uHue) * beam(r, 4. * px) * (1. + strobe);         // hot spot at the centre
  fragColor = vec4(col, 1.);
}
`;

export const SPECTRUM_RAYS = scene('Spectrum Rays', 'Beams', 'A star of laser beams, one per frequency, each as long as its band is loud: turns, steps on the ticks, strobes on kicks', BODY);

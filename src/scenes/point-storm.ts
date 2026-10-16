import { scene } from './scene';

// Hundreds of laser dots on three nested rings that hold a shape: a polygon or a star that changes on
// every tick, the dots flowing into the new one. A kick throws them outwards and they fall back; between
// ticks they loosen and pull together again on the tick. The bass, mids and treble each light one ring.
//
// Each dot keeps its own angular slot on its ring (scatter moves it in and out, jitter stays inside
// the slot), so a pixel only looks at the few dots in the slots around its own angle, never at all of them.
const BODY = /* glsl */ `
// @group Storm
const float DOTS = 160.;     // @param min=40 max=320 int label="Dots on the outer ring"
const float SHAPE = .34;     // @param min=.15 max=.48 label="Shape size"
const float SCATTER = .7;    // @param min=0 max=1.5 label="Kick scatter"
const float SPIN = .12;      // @param min=0 max=1 label="Spin speed"
// @group Look
const float SIZE = 3.;       // @param min=1 max=8 label="Dot size (px)"

// The outline of shape number i at angle a, as a radius (1 at its points): a 3- to 6-sided polygon,
// every other one a star.
float outline(float a, float i) {
  float n = 3. + mod(i, 4.);
  float seg = TAU / n;
  float b = mod(a, seg) - seg * .5;          // 0 between two points, ±seg/2 at a point
  float t = abs(b) / (seg * .5);
  return mod(i, 2.) < .5 ? cos(seg * .5) / cos(b) : mix(.42, 1., t * t);
}

void main() {
  vec2 p = centered();
  float px = 1. / uRes.y;
  float a = atan(p.y, p.x);
  float r = length(p);

  float morph = smoothstep(0., .4, uTick);                              // flow into the tick's new shape
  float loose = .12 * max(smoothstep(.55, 1., uTick), 1. - smoothstep(0., .12, uTick)); // pull together on the tick
  float kick = SCATTER * uBeat * (.6 + .5 * min(uBass, 1.));

  vec3 col = vec3(0.);
  for (float k = 0.; k < 3.; k++) {                                     // outer ring = bass, then mids, inner = treble
    float scale = SHAPE * (1. - .32 * k) * (1. + .12 * spec(.05));
    float n = floor(DOTS * (1. - .3 * k));
    float slot = TAU / n;
    float spin = uTime * SPIN * (k == 1. ? -1. : 1.) * (1. + .4 * k) + k;
    float band = spec(.06 + .4 * k);
    float u = (a - spin) / slot;                                        // this pixel's angle, in slots
    float nearest = floor(u);
    for (float j = -2.; j <= 2.; j++) {                                 // the dots in the nearby slots
      float i = mod(nearest + j, n);
      float window = 1. - smoothstep(1.5, 2.5, abs(nearest + j + .5 - u)); // fade out before the slot drops out: no seams
      float h = hash(vec2(i, k + 1.));
      float h2 = hash(vec2(k + 7., i));
      float da = (i + .5 + .9 * (h2 - .5)) * slot + spin;               // jitter stays inside the slot
      float sa = da - .7 * spin;                                         // the shape turns slower than the dots
      float rad = mix(outline(sa, uTicks - 1. + k), outline(sa, uTicks + k), morph);
      float push = exp((kick + loose) * (h - .3) * 2.6);                 // in or out along its ray, mostly out
      rad *= scale * push * (1. + .03 * sin(uTime * .8 + h * TAU));      // a slow shimmer in silence
      vec2 q = rad * vec2(cos(da), sin(da));
      float level = .5 + 1.4 * band + 1.5 * uBeat * step(.7, h);         // a kick flares a few dots, not all
      vec3 c = mix(rainbow(uHue + k * .06 + (h - .5) * .05), vec3(1.), .3 * step(.92, h2) * band);
      col += c * beam(length(p - q), SIZE * px) * level * window;
    }
  }
  fragColor = vec4(col, 1.);
}
`;

export const POINT_STORM = scene('Point Storm', 'Geometry', 'Hundreds of laser dots that hold a shape, scatter on kicks and pull into a new shape on each tick', BODY);

import { scene } from './scene';

// An oscilloscope in XY mode: one thin trace drawing a Lissajous figure. Every 4 ticks the trace flows
// into the next frequency ratio (1:2, 3:2, 3:4, 5:4, 2:3, 5:6), the phase drifts so the figure seems to
// turn in depth, and the music's waveform trembles along the line. The scope's dot runs round the
// figure once every 2 ticks with a bright tail, the trace swells with the bass and flares on kicks.
//
// The figure is a closed polyline of SEG segments: a pixel takes its distance to the nearest one and
// draws one beam from it, so where the trace crosses itself it isn't lit twice.
const BODY = /* glsl */ `
// @group Figure
const float SIZE = .3;       // @param min=.15 max=.36 label="Size (swells with the bass)"
const float DRIFT = .25;     // @param min=0 max=1.5 label="Phase drift"
const float WOBBLE = .5;     // @param min=0 max=1 label="Waveform on the trace"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Trace width (px)"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

const float SEG = 140.;

// The frequency ratio x:y of figure number i.
vec2 ratio(float i) {
  i = mod(i, 6.);
  return i < .5 ? vec2(1., 2.) : i < 1.5 ? vec2(3., 2.) : i < 2.5 ? vec2(3., 4.)
       : i < 3.5 ? vec2(5., 4.) : i < 4.5 ? vec2(2., 3.) : vec2(5., 6.);
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0., 1.));
}

void main() {
  vec2 p = centered();
  float px = onePixel();

  float bar = floor(uTicks / 4.);
  float morph = smoothstep(0., 1., mod(uTicks, 4.) + uTick);   // into the new figure over the bar's first tick
  vec2 ab0 = ratio(bar - 1.), ab1 = ratio(bar);
  float ph = uTime * DRIFT;
  float size = SIZE * (.85 + .25 * min(uBass, 1.2));
  float wob = WOBBLE * .12;
  vec2 scale = size * vec2(1.3, 1.);

  vec3 col = vec3(0.);
  if (any(greaterThan(abs(p), scale * (1. + wob) + 40. * px))) { fragColor = vec4(col, 1.); return; }

  // The figure at parameter t (0 … TAU), with the waveform along it: mirrored, so the loop closes.
  #define AT(t, m) (mix(vec2(sin(ab0.x * t + ph), sin(ab0.y * t)), vec2(sin(ab1.x * t + ph), sin(ab1.y * t)), morph) \
                    * scale * (1. + wob * wave(m)))
  float best = 1e9, bt = 0.;
  vec2 prev = AT(0., 1.);
  for (float i = 1.; i <= SEG; i++) {
    float t = i / SEG * TAU;
    vec2 q = AT(t, abs(1. - 2. * i / SEG));
    float d = segment(p, prev, q);
    if (d < best) { best = d; bt = t; }
    prev = q;
  }

  // The scope's dot, once round every 2 ticks, and the tail it leaves behind it.
  float spot = TAU * fract(.5 * (uTicks + uTick));
  float tail = exp(-mod(spot - bt, TAU) * 2.5);
  float flare = uBeat * FLARE;
  float level = .4 + 1.1 * spec(.04 + .5 * abs(1. - bt / PI)) + 1.4 * tail + 2. * flare;
  vec3 c = mix(laser(uHue + .06 * sin(bt)), vec3(1.), .5 * flare);
  col += c * beam(best, WIDTH * px) * level;
  vec2 dot = AT(spot, abs(1. - spot / PI));
  col += mix(laser(uHue), vec3(1.), .4) * beam(length(p - dot), 2.5 * WIDTH * px) * 1.2;
  fragColor = vec4(col, 1.);
}
`;

export const LISSAJOUS = scene('Lissajous', 'Signals', 'An oscilloscope trace drawing Lissajous figures: a new ratio every 4 ticks, the waveform trembling along it, the dot running on the ticks', BODY);

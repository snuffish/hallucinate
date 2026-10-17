import { INPUT_DECLARATIONS } from '../engine/scene-inputs';

// Every scene is a fragment shader rendered over a fullscreen triangle, after this header. The float
// inputs come from one table (scene-inputs.ts), each declared with what it means.
//   uSpec  – 256x1 texture: R = log-scaled spectrum, G = waveform
//   uMedia – the dropped image / video (uMediaSize in pixels, uHasMedia 0/1); sample it with media(p)

export const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
${INPUT_DECLARATIONS}
uniform sampler2D uSpec;
uniform sampler2D uMedia;
uniform vec2 uMediaSize;
uniform float uHasMedia;
out vec4 fragColor;

#define PI 3.14159265359
#define TAU 6.28318530718

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }
vec3 rainbow(float t) { return pal(t, vec3(.5), vec3(.5), vec3(1.), vec3(0., .33, .67)); }
vec3 neon(float t) { return pal(t, vec3(.5), vec3(.5), vec3(1., 1., .5), vec3(.8, .9, .3)); }
// The laser palette: pure, fully saturated colours on a continuous wheel, red -> yellow -> green -> cyan -> blue ->
// magenta -> red, repeating every 1.0. Every colour is at full strength (no brightness balancing), like RGB lasers.
vec3 laser(float t) { return clamp(abs(fract(t + vec3(0., 2., 1.) / 3.) * 6. - 3.) - 1., 0., 1.); }

float spec(float x) { return texture(uSpec, vec2(clamp(x, 0., 1.) * .996 + .002, .5)).r; }
float wave(float x) { return texture(uSpec, vec2(clamp(x, 0., 1.) * .996 + .002, .5)).g * 2. - 1.; }

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
             mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = rot(.5) * p * 2.03 + 11.7; a *= .5; }
  return v;
}
vec2 centered() { return (gl_FragCoord.xy - .5 * uRes) / uRes.y; }
// One pixel in centered() units: sizes given in pixels keep their size on any screen.
float onePixel() { return 1. / uRes.y; }
// The tick's flash: 1 on the tick, fading to 0 by the next one.
float tickFlash() { return (1. - uTick) * (1. - uTick); }
// The ticks so far, easing into each new one over the first 30% of it: steps in time without jumping.
float easedTicks() { return uTicks + smoothstep(0., .3, uTick); }
// A thin luminous line at distance d from it: a hard core w wide plus a short halo that never lights
// the whole frame. Give w in pixels, as WIDTH * onePixel(), so lines keep their width at any size.
float beam(float d, float w) { d = abs(d); return 1. - smoothstep(w * .35, w, d) + .45 * exp(-d / (w * 3.)); }
float luma(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
// Undo the display's tonemapping, so a picture keeps its true colours on screen.
vec3 untone(vec3 c) { return -log(1. - clamp(c, 0., .985)) / 1.3; }

// The dropped image / video at p (centered coords). It covers the screen and is mirrored beyond
// its edges, so warped coordinates never run out of picture. A test pattern stands in until you drop one.
vec3 media(vec2 p) {
  float screen = uRes.x / uRes.y, aspect = uMediaSize.x / max(uMediaSize.y, 1.);
  vec2 uv = vec2(p.x / aspect, p.y) * min(1., aspect / screen) + .5;
  uv = 1. - abs(1. - mod(uv, 2.));
  if (uHasMedia > .5) return texture(uMedia, uv).rgb;
  vec2 g = floor(uv * vec2(12., 8.));
  vec3 col = rainbow(uv.x * .7 + uv.y * .3 + uHue) * (.45 + .3 * mod(g.x + g.y, 2.));
  float r = length((uv - .5) * vec2(1.5, 1.));
  return mix(col, vec3(.95), smoothstep(.012, 0., abs(r - .3)) + smoothstep(.012, 0., abs(r - .18)));
}
`;

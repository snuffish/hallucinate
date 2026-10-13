import { parseParams } from './params.js';

// Every scene is a fragment shader rendered over a fullscreen triangle.
// Shared uniforms (all audio values are 0..~1.5, already scaled by "reactivity"):
//   uTime  – audio-driven clock (runs faster when the music is louder)
//   uBass / uMid / uHigh / uLevel – smoothed band energies
//   uBeat  – 1.0 on a detected beat, decaying to 0
//   uHue   – global colour rotation
//   uBright – timbral brightness, 0 = dark/muffled .. 1 = bright/crisp (changes over seconds)
//   uMood  – 0 = calm/slow .. 1 = energetic/fast (tempo + energy, changes over seconds)
//   uSpec  – 256x1 texture: R = log-scaled spectrum, G = waveform
//   uMedia – the dropped image / video (uMediaSize in pixels, uHasMedia 0/1); sample it with media(p)

export const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass, uMid, uHigh, uLevel, uBeat, uHue, uBright, uMood;
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

const KALEIDO = /* glsl */ `
const float SEGMENTS = 8.;               // @param min=2 max=24 int label="Mirror segments"
const float FOLDS = 8.;                  // @param min=1 max=12 int label="Fractal folds"
const float ZOOM = 1.6;                  // @param min=.5 max=4 label="Zoom out"
const float SPIN = .08;                  // @param min=-1 max=1 label="Spin speed"
const float GLOW = 1.;                   // @param min=.2 max=4 label="Brightness"

void main() {
  vec2 p = centered();
  p *= rot(uTime * SPIN);
  float r = length(p), a = atan(p.y, p.x);
  float seg = TAU / SEGMENTS;
  a = mod(a, seg);
  a = abs(a - seg * .5);
  p = vec2(cos(a), sin(a)) * r;

  vec2 q = p * (ZOOM - uBass * .6);
  vec3 col = vec3(0.);
  for (int i = 0; i < 12; i++) {
    if (float(i) >= FOLDS) break;
    float fi = float(i);
    q = abs(q) / max(dot(q, q), 1e-3) - vec2(.85 + .12 * sin(uTime * .21), .55 + .12 * cos(uTime * .17) + uBass * .12);
    q *= rot(uTime * .03 + fi * .2);
    float d = length(q);
    col += rainbow(d * .25 + fi * .08 + uTime * .04 + uHue) * exp(-d * 1.6) * (.25 + spec(fi / FOLDS) * 1.1);
  }
  col *= (.3 + uBeat * .35 + uHigh * .2) * GLOW;
  col *= smoothstep(1.4, .2, r);
  fragColor = vec4(col, 1.);
}
`;

const TUNNEL = /* glsl */ `
const float SPEED = 1.2;                 // @param min=0 max=5 label="Flight speed"
const float TWIST = 3.;                  // @param min=0 max=10 int label="Twist"
const float TILES = 5.;                  // @param min=1 max=20 label="Tile density"
const float WOBBLE = .12;                // @param min=0 max=.4 label="Wobble"
uniform bool uRings;                     // @param default=true label="Light rings"

void main() {
  vec2 p = centered();
  p += WOBBLE * vec2(sin(uTime * .37), cos(uTime * .29));
  p *= rot(uTime * .15 + .4 * sin(uTime * .23));
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  float z = .35 / r + uTime * SPEED;   // depth into the tunnel
  float u = a / PI;                  // -1..1 around the wall

  float twist = u * TWIST + z * .15 + sin(z * .5) * uMid;
  float tiles = sin(z * TILES) * sin(twist * TAU);
  vec3 col = rainbow(z * .08 + u * .25 + uHue) * smoothstep(-.2, .8, tiles);

  float ring = smoothstep(.9, 1., sin(z * 2. - uTime * 3.));
  if (uRings) col += rainbow(z * .05 + .5 + uHue) * ring * (.6 + uBass * 3.);

  float s = spec(abs(u));
  col += rainbow(abs(u) + uTime * .1 + uHue) * s * s * smoothstep(.15, 0., abs(fract(twist) - .5)) * 2.;

  col *= smoothstep(0., .35, r);
  col += vec3(1., .7, 1.) * (.015 / r) * (.3 + uLevel * 1.5);
  fragColor = vec4(col, 1.);
}
`;

const MANDALA = /* glsl */ `
const float PETALS = 12.;                // @param min=4 max=32 step=2 int label="Petals"
const float RINGS = 28.;                 // @param min=5 max=80 label="Ring density"
const float WOBBLE = 1.2;                // @param min=0 max=4 label="Ring wobble"
const float SPIN = .1;                   // @param min=-1 max=1 label="Spin speed"
uniform bool uCore;                      // @param default=true label="Glowing centre"

void main() {
  vec2 p = centered();
  p *= 1. - uBass * .25;
  float r = length(p), a = atan(p.y, p.x) + uTime * SPIN;
  float n = PETALS;
  float petals = cos(a * n + sin(r * 8. - uTime * 1.5) * 2.5);
  float inner = cos(a * n * .5 - uTime * .7 + r * 12.);
  float rings = sin(r * RINGS - uTime * 2.5 + petals * (WOBBLE + uMid * 3.));
  float s = spec(fract(r * 1.1));

  float m = smoothstep(0., .9, rings * .5 + .5) * (.35 + s * 1.8);
  vec3 col = rainbow(r * .9 - uTime * .08 + petals * .12 + uHue) * m;
  col += neon(inner * .2 + r + uHue) * smoothstep(.6, 1., inner * petals) * (.4 + uHigh * 1.5);
  if (uCore) col += vec3(1., .85, .95) * .02 / (r + .02) * (.4 + uBeat * 1.5);
  col *= smoothstep(1.3, .3, r);
  fragColor = vec4(col, 1.);
}
`;

const PLASMA = /* glsl */ `
const float SCALE = 2.5;                 // @param min=.5 max=8 label="Scale"
const float SPEED = .15;                 // @param min=0 max=1 label="Flow speed"
const float WARP = 4.;                   // @param min=0 max=8 label="Warp"
const float NEON_MIX = .6;               // @param min=0 max=1 label="Neon mix"
uniform bool uVeins;                     // @param default=true label="Bright veins"

void main() {
  vec2 p = centered() * SCALE;
  float t = uTime * SPEED;
  vec2 q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 w = vec2(fbm(p + WARP * q + vec2(1.7, 9.2) + t * 1.3 + uBass * .8),
                fbm(p + WARP * q + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(p + (3.5 + uMid * 2.) * w);

  vec3 col = rainbow(f * 1.8 + length(q) * .8 + uHue + t * .3);
  col = mix(col, neon(w.x + uHue), clamp(length(w) * .6 - .2, 0., 1.) * NEON_MIX);
  col *= f * f * 2.2 + .15;
  if (uVeins) col += rainbow(f * 3. + uHue + .5) * smoothstep(.62, .75, f) * (.5 + uHigh * 2.);
  col *= .7 + uBeat * .5;
  fragColor = vec4(col, 1.);
}
`;

const GYROID = /* glsl */ `
const float SPEED = 1.5;                 // @param min=0 max=6 label="Flight speed"
const float DENSITY = 1.;                // @param min=.5 max=2.5 label="Cave density"
const float THICKNESS = .06;             // @param min=0 max=.3 label="Wall thickness"
const float TUNNEL_WIDTH = .7;           // @param min=.3 max=1.5 label="Tunnel width"
const float HAZE = .25;                  // @param min=0 max=1 label="Haze"

vec3 warp(vec3 p) { p.xy *= rot(p.z * .08); return p; }
float map(vec3 p) {
  p = warp(p);
  float shell = abs(dot(sin(p * DENSITY), cos(p.yzx * DENSITY))) / (1.6 * DENSITY) - THICKNESS - uBass * .1;
  return max(shell, TUNNEL_WIDTH - length(p.xy));   // carve a flight path along z
}
vec3 normalAt(vec3 p) {
  vec2 e = vec2(.002, 0.);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
void main() {
  vec2 p = centered();
  vec3 ro = vec3(0., 0., uTime * SPEED);
  vec3 rd = normalize(vec3(p, 1.1 - length(p) * .4));
  rd.xy *= rot(uTime * .12);
  rd.xz *= rot(sin(uTime * .2) * .25);

  vec3 glow = vec3(0.);
  float t = 0., d = 1.;
  for (int i = 0; i < 90; i++) {
    vec3 pos = ro + rd * t;
    d = map(pos);
    glow += rainbow(pos.z * .05 + uHue + .3) * .006 / (.02 + d * d * 40.);
    if (d < .002 || t > 25.) break;
    t += d * .8;
  }

  vec3 col = vec3(0.);
  if (d < .02) {
    vec3 pos = ro + rd * t;
    vec3 n = normalAt(pos);
    float fres = pow(1. - abs(dot(n, rd)), 2.);
    float bands = spec(fract(warp(pos).z * .08 + .5));
    col = rainbow(pos.z * .04 + dot(n, vec3(.3, .5, .2)) + uHue) * (.25 + .75 * max(dot(n, -rd), 0.));
    col += neon(pos.z * .1 + uHue) * fres * (.6 + bands * 2.);
    col *= exp(-t * .1);
  }
  col += glow * (.4 + uLevel) * HAZE;
  col *= .8 + uBeat * .6;
  fragColor = vec4(col, 1.);
}
`;

const ORBITS = /* glsl */ `
const float RINGS = 6.;                  // @param min=1 max=10 int label="Rings"
const float SPACING = .085;              // @param min=.03 max=.15 label="Ring spacing"
const float WAVE = .1;                   // @param min=0 max=.4 label="Wave height"
const float SPIN = 1.;                   // @param min=0 max=4 label="Spin speed"
uniform bool uRipples;                   // @param default=true label="Background ripples"

void main() {
  vec2 p = centered();
  p *= 1. + uBeat * .08;
  vec3 col = vec3(0.);
  for (int i = 0; i < 10; i++) {
    if (float(i) >= RINGS) break;
    float fi = float(i);
    float dir = mod(fi, 2.) * 2. - 1.;
    vec2 q = p * rot(uTime * (.1 + fi * .05) * dir * SPIN);
    float a = atan(q.y, q.x), r = length(q);
    float x = abs(fract(a / TAU + .5) * 2. - 1.);   // mirrored so the loop is seamless
    float rad = .12 + fi * SPACING + wave(x) * WAVE * (.5 + uLevel) + spec(x) * .12;
    float d = abs(r - rad);
    col += rainbow(fi * .15 + uTime * .05 + uHue + x * .5) * .004 / (d + .002) * (.5 + uBeat * .8);
  }
  float r = length(p);
  if (uRipples) col += neon(r - uTime * .1 + uHue) * spec(fract(r)) * smoothstep(.05, 0., abs(fract(r * 6. - uTime * .5) - .5) - .45) * .5;
  fragColor = vec4(col, 1.);
}
`;

const JULIA = /* glsl */ `
const float ZOOM = 3.;                   // @param min=1 max=6 label="Zoom out"
const float SPIN = .05;                  // @param min=-.5 max=.5 label="Spin speed"
const float DRIFT = .05;                 // @param min=0 max=.3 label="Shape drift speed"
const float DETAIL = 96.;                // @param min=16 max=96 int label="Detail (iterations)"
uniform bool uTrap;                      // @param default=true label="Glowing orbit ring"

void main() {
  vec2 p = centered() * ZOOM;
  p *= rot(uTime * SPIN);
  // Trace just outside the Mandelbrot cardioid, where the Julia sets are full of spirals.
  float th = 1. + uTime * DRIFT + uBass * .05;
  vec2 c = (1.03 + uMid * .02) * (.5 * vec2(cos(th), sin(th)) - .25 * vec2(cos(2. * th), sin(2. * th)));
  vec2 z = p;
  float n = 0., trap = 1e9;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= DETAIL) break;
    z = vec2(z.x * z.x - z.y * z.y, 2. * z.x * z.y) + c;
    trap = min(trap, abs(length(z) - .5 - uBeat * .2));
    if (dot(z, z) > 64.) break;
    n += 1.;
  }
  float k = (n - log2(log2(max(dot(z, z), 1.0001))) + 4.) / DETAIL;   // smooth iteration count
  vec3 col = rainbow(k * 3. + uTime * .05 + uHue) * pow(clamp(k, 0., 1.), .6) * 1.4;
  if (uTrap) col += neon(trap * 2. + uHue) * exp(-trap * 25.) * (.4 + uHigh * 1.5);
  if (n > DETAIL - 1.) col = rainbow(trap * 4. + uHue + .5) * exp(-trap * 4.) * .6;
  fragColor = vec4(col, 1.);
}
`;

const VORONOI = /* glsl */ `
const float CELLS = 4.;                  // @param min=1.5 max=12 label="Cells (higher = smaller)"
const float DRIFT = .2;                  // @param min=0 max=1 label="Drift speed"
const float WOBBLE = .4;                 // @param min=0 max=.5 label="Cell wobble"
const float EDGE = .08;                  // @param min=.01 max=.3 label="Edge width"
const float FLASH = .25;                 // @param min=0 max=1 label="Share of cells flashing on the beat"

vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
void main() {
  vec2 p = centered() * max(CELLS - uBass, 1.);
  p *= rot(uTime * .04);
  p.x += uTime * DRIFT;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8., d2 = 8.;
  vec2 id = vec2(0.);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = .5 + WOBBLE * sin(uTime * .6 + TAU * hash2(ip + g));
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; }
      else if (d < d2) d2 = d;
    }
  float edge = sqrt(d2) - sqrt(d1);
  float h = hash(id);
  vec3 col = rainbow(h + uTime * .03 + uHue) * (.15 + spec(h) * 1.4) * (1. - sqrt(d1) * .6);
  col += neon(h * 2. + uTime * .1 + uHue) * smoothstep(EDGE, 0., edge) * (.5 + uHigh * 1.5);
  col *= 1. + uBeat * step(1. - FLASH, h) * 1.5;   // a quarter of the cells flash on the beat
  fragColor = vec4(col, 1.);
}
`;

const HEX = /* glsl */ `
const float DENSITY = 7.;                // @param min=3 max=20 label="Hex density"
const float WAVES = 12.;                 // @param min=2 max=40 label="Wave density"
const float SPEED = 3.;                  // @param min=0 max=10 label="Pulse speed"
const float SPIN = .03;                  // @param min=-.5 max=.5 label="Spin speed"
uniform bool uOutline;                   // @param default=true label="Outlines"

float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1., 1.73))), p.x); }
void main() {
  vec2 p = centered() * DENSITY;
  p *= rot(uTime * SPIN);
  vec2 rr = vec2(1., 1.73);
  vec2 a = mod(p, rr) - rr * .5, b = mod(p - rr * .5, rr) - rr * .5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;   // position inside the hex cell
  vec2 id = p - gv;                          // cell centre
  float r = length(id) / DENSITY;
  float ring = spec(fract(r * .8));
  float pulse = sin(r * WAVES - uTime * SPEED) * .5 + .5;
  float hd = hexDist(gv);
  float size = .12 + .3 * pulse * (.4 + ring * 1.6) + uBeat * .08;
  vec3 col = rainbow(r * .6 - uTime * .1 + uHue) * smoothstep(size + .03, size, hd) * (.5 + ring * 1.5);
  if (uOutline) col += neon(r + uHue) * smoothstep(.03, 0., abs(hd - .45)) * .25 * (.5 + uMid);
  fragColor = vec4(col, 1.);
}
`;

// ---- Inspired by Shadertoy classics (own implementations of the techniques) ----

// kishimisu's "An introduction to Shader Art Coding": repeated fract() space folding
// with an inverse-distance neon glow per iteration.
const NEON_LOOP = /* glsl */ `
const float ZOOM = 2.;                   // @param min=.5 max=6 label="Zoom out"
const float FOLDS = 4.;                  // @param min=1 max=8 int label="Folds"
const float REPEAT = 1.5;                // @param min=1 max=3 label="Repeat factor"
const float RINGS = 8.;                  // @param min=2 max=20 label="Ring frequency"
const float WIDTH = .01;                 // @param min=.002 max=.04 label="Line width"

void main() {
  vec2 uv = centered() * ZOOM;
  vec2 uv0 = uv;
  vec3 col = vec3(0.);
  // Audio only changes glow width and brightness. Putting it into the zoom or the phase
  // makes the pattern jump on every kick, because the fold loop amplifies it ~5x.
  float width = WIDTH + uBass * .006;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= FOLDS) break;
    float fi = float(i);
    uv = fract(uv * REPEAT) - .5;
    float d = length(uv) * exp(-length(uv0));
    d = abs(sin(d * RINGS + uTime) / 8.);
    d = pow(width / max(d, 1e-4), 1.2);
    col += rainbow(length(uv0) + fi * .4 + uTime * .4 + uHue) * d * (.5 + spec(fi / FOLDS + .05) * .9);
  }
  col *= .45 + uBeat * .25;
  fragColor = vec4(min(col, vec3(4.)), 1.);
}
`;

// Kali's "Star Nest": volumetric march through a tiled 3D Kali fractal (p = abs(p)/dot(p,p) - c).
const STAR_NEST = /* glsl */ `
const float FORM = .53;                  // @param min=.4 max=.7 label="Fractal form"
const float SPEED = 1.;                  // @param min=0 max=5 label="Travel speed"
const float TURN = 1.;                   // @param min=0 max=5 label="Turn speed"
const float GLOW = 1.;                   // @param min=.2 max=3 label="Brightness"
const float SATURATION = .85;            // @param min=0 max=1.5 label="Colour saturation"
const float TINT = .45;                  // @param min=0 max=1 label="Colour tint"

void main() {
  vec2 uv = centered();
  vec3 dir = normalize(vec3(uv * 1.2, 1.));
  float a1 = .5 + uTime * .02 * TURN, a2 = .8 + uTime * .013 * TURN;
  dir.xz *= rot(a1);
  dir.xy *= rot(a2);
  vec3 from = vec3(1., .5, .5) + vec3(uTime * .04 * SPEED, uTime * .025 * SPEED, -2.);
  from.xz *= rot(a1);
  from.xy *= rot(a2);

  float form = FORM + uBass * .015;
  float s = .1, fade = 1.;
  vec3 v = vec3(0.);
  for (int r = 0; r < 18; r++) {
    vec3 p = from + s * dir * .5;
    p = abs(vec3(.85) - mod(p, vec3(1.7)));        // tile space
    float pa = 0., a = 0.;
    for (int i = 0; i < 15; i++) {
      p = abs(p) / dot(p, p) - form;               // the Kali fold
      a += abs(length(p) - pa);
      pa = length(p);
    }
    float dm = max(0., .3 - a * a * .001);         // dark matter
    a *= a * a;
    if (r > 6) fade *= 1. - dm;
    v += fade;
    v += vec3(s, s * s, s * s * s * s) * a * .0015 * fade;
    fade *= .73;
    s += .1;
  }
  v = mix(vec3(length(v)), v, SATURATION) * .01 * GLOW;
  vec3 tint = mix(vec3(1.), rainbow(uHue + .1), TINT);
  vec3 col = v * tint * (.8 + uBeat * .7 + uHigh * .3);
  fragColor = vec4(col, 1.);
}
`;

// "Phantom star" / "Octagrams" style: march through repeated shapes and accumulate
// exp(-distance) as neon glow instead of shading a surface.
const NEON_JACKS = /* glsl */ `
const float SPEED = 3.;                  // @param min=0 max=10 label="Flight speed"
const float SPACING = 4.;                // @param min=2 max=8 label="Spacing"
const float SIZE = .45;                  // @param min=.2 max=1.2 label="Jack size"
const float THICKNESS = .14;             // @param min=.05 max=.4 label="Arm thickness"
const float SPIN = 1.;                   // @param min=0 max=4 label="Spin speed"
const float TWIST = .12;                 // @param min=0 max=.5 label="Tunnel twist"

float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float map(vec3 p) {
  p.xy *= rot(p.z * TWIST + uTime * .15);
  vec3 q = mod(p, SPACING) - SPACING * .5;
  q.xy *= rot(uTime * .6 * SPIN);
  q.yz *= rot(uTime * .4 * SPIN);
  float s = SIZE + uBass * .3, w = s * THICKNESS;
  float d = sdBox(q, vec3(s, w, w));
  d = min(d, sdBox(q, vec3(w, s, w)));
  return min(d, sdBox(q, vec3(w, w, s)));
}
void main() {
  vec2 uv = centered();
  vec3 ro = vec3(0., 0., uTime * SPEED);
  vec3 rd = normalize(vec3(uv, 1.));
  rd.xy *= rot(uTime * .1);
  vec3 col = vec3(0.);
  float t = 0.;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = max(abs(map(p)), .015);
    col += rainbow(p.z * .04 + uHue + t * .01) * exp(-d * 18.) * .022 * exp(-t * .03);
    t += d * .55;
    if (t > 45.) break;
  }
  col *= .7 + uBeat * .7 + uHigh * .3;
  fragColor = vec4(col, 1.);
}
`;

// "Audio Reactive Liquid Blobs": smooth-min metaballs; bass melts them together,
// each blob's size follows its own slice of the spectrum.
const BLOBS = /* glsl */ `
const float COUNT = 6.;                  // @param min=1 max=10 int label="Blobs"
const float SIZE = .32;                  // @param min=.1 max=.6 label="Blob size"
const float GOO = .2;                    // @param min=.02 max=1 label="Gooiness"
const float SPEED = 1.;                  // @param min=0 max=3 label="Speed"
const float SPREAD = .95;                // @param min=.3 max=1.6 label="Spread"
uniform bool uHalo;                      // @param default=true label="Halo"

float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float map(vec3 p) {
  float k = GOO + uBass * .45;
  float d = 1e9;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= COUNT) break;
    float fi = float(i);
    float T = uTime * SPEED;
    vec3 c = vec3(sin(T * .7 + fi * 1.7), cos(T * .5 + fi * 2.3), sin(T * .6 + fi * .9)) * SPREAD;
    d = smin(d, length(p - c) - (SIZE + spec(fi / 6. + .02) * .35), k);
  }
  return d;
}
void main() {
  vec2 uv = centered();
  vec3 ro = vec3(0., 0., -4.2);
  vec3 rd = normalize(vec3(uv, 1.5));
  float t = 0., d = 1., glow = 0.;
  for (int i = 0; i < 70; i++) {
    d = map(ro + rd * t);
    glow += .012 / (.05 + d * d * 8.);
    if (d < .002 || t > 10.) break;
    t += d * .9;
  }
  vec3 col = rainbow(uv.y * .5 + uTime * .03 + uHue + .5) * glow * .12 * float(uHalo);   // halo
  if (d < .01) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(.002, 0.);
    vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
    float fres = pow(1. - max(dot(n, -rd), 0.), 3.);
    vec3 irid = rainbow(dot(n, rd) * 1.5 + p.y * .3 + uTime * .05 + uHue);   // soap-film colour
    vec3 l = normalize(vec3(.6, .8, -.5));
    col = irid * (.25 + .6 * max(dot(n, l), 0.));
    col += pow(max(dot(reflect(rd, n), l), 0.), 40.) * (1. + uHigh * 2.);
    col += neon(fres + uHue) * fres * (1.2 + uBeat);
  }
  fragColor = vec4(col, 1.);
}
`;

// ---- Library additions ----

// Curtains of light over a mountain ridge. Each curtain glows with its own slice of the spectrum.
const AURORA = /* glsl */ `
const float CURTAINS = 5.;               // @param min=1 max=8 int label="Curtains"
const float SPEED = 1.;                  // @param min=0 max=5 label="Flow speed"
const float HEIGHT = .55;                // @param min=0 max=1.2 label="Wave height"
const float STARS = .007;                // @param min=0 max=.05 label="Star density"
uniform vec3 uLowColour;                 // @param color default=#1aff8c label="Lower colour"
uniform vec3 uTopColour;                 // @param color default=#bf40ff label="Upper colour"
uniform bool uMountains;                 // @param default=true label="Mountains"

void main() {
  vec2 p = centered();
  vec3 col = mix(vec3(.01, .02, .06), vec3(.03, 0., .09), p.y + .5);
  vec2 sp = p * 90.;
  col += vec3(.8, .9, 1.) * step(1. - STARS, hash(floor(sp))) * smoothstep(.45, 0., length(fract(sp) - .5)) * (.4 + uHigh * .8);

  for (int i = 0; i < 8; i++) {
    if (float(i) >= CURTAINS) break;
    float fi = float(i);
    float x = p.x * (1.1 + fi * .22) + fi * 3.7;
    float base = -.02 + fi * .055 + (fbm(vec2(x * .7, uTime * .06 * SPEED + fi * 1.3)) - .5) * HEIGHT;
    float dy = p.y - base;
    float curtain = smoothstep(-.015, .02, dy) * exp(-max(dy, 0.) * (5. + fi * 1.5));
    float rays = .45 + .55 * noise(vec2(x * 16., uTime * .3 * SPEED + fi * 7.));
    vec3 tint = mix(uLowColour, uTopColour, clamp(dy * 3. + fi * .12, 0., 1.));
    tint = mix(tint, rainbow(uHue + fi * .1 + dy), .3);
    tint = mix(tint, tint * vec3(1.15, .95, .8), uBright);   // warmer when the music is bright
    col += tint * curtain * rays * (.18 + spec(fi * .17 + .04) * .9 + uBeat * .15);
  }

  float ridge = -.3 + (fbm(vec2(p.x * 2.5, 3.)) - .5) * .25 + abs(sin(p.x * 1.3)) * .06;
  if (uMountains) col = mix(col, vec3(.005, .0, .02), smoothstep(.004, -.004, p.y - ridge));
  fragColor = vec4(col, 1.);
}
`;

// Circular spectrum analyser: 64 mirrored bars around a waveform ring.
const RADIAL_EQ = /* glsl */ `
const float BARS = 48.;                  // @param min=8 max=128 int label="Bars"
const float INNER = .17;                 // @param min=.05 max=.35 label="Inner radius"
const float HEIGHT = .3;                 // @param min=.05 max=.6 label="Bar height"
const float SPIN = .05;                  // @param min=-1 max=1 label="Spin speed"
uniform bool uWaveRing;                  // @param default=true label="Waveform ring"

void main() {
  vec2 p = centered() * rot(uTime * SPIN);
  float r = length(p);
  float x = abs(atan(p.y, p.x)) / PI;          // bass on the right … treble on the left, mirrored top / bottom
  float id = floor(x * BARS), fx = fract(x * BARS);
  float s = spec((id + .5) / BARS);
  float inner = INNER;
  float h = .015 + s * s * HEIGHT;
  float gap = smoothstep(0., .15, fx) * smoothstep(1., .85, fx);
  vec3 c = rainbow(id / BARS * .8 + uHue + uTime * .03);

  float inBar = step(inner, r) * smoothstep(inner + h + .004, inner + h, r) * gap;
  vec3 col = c * inBar * (.5 + (r - inner) / max(h, .01));
  col += c * smoothstep(.005, 0., abs(r - inner - h - .014)) * gap;                   // peak caps
  col += c * exp(-max(r - inner - h, 0.) * 14.) * step(inner + h, r) * gap * .18;     // haze
  float w = wave(x) * .035;
  if (uWaveRing) col += neon(x + uHue) * .0025 / (abs(r - (inner - .045 + w)) + .0025);              // waveform ring
  col += c * .2 * .01 / (abs(r - inner) + .01) * (1. + uBeat * 2.);
  col += vec3(1., .8, 1.) * .02 / (r + .02) * (.2 + uBeat * .8);
  fragColor = vec4(col, 1.);
}
`;

// Phosphor oscilloscope: waveform trace, spectrum trace and an XY Lissajous figure.
const SCOPE = /* glsl */ `
const float GAIN = .8;                   // @param min=.2 max=2 label="Gain"
uniform vec3 uPhosphor;                  // @param color default=#40ff73 label="Phosphor colour"
uniform bool uGrid;                      // @param default=true label="Graticule"
uniform bool uSpectrumTrace;             // @param default=true label="Spectrum trace"
uniform bool uLissajous;                 // @param default=true label="XY figure"
uniform bool uScanlines;                 // @param default=true label="Scanlines"

float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
void main() {
  vec2 p = centered();
  float aspect = uRes.x / uRes.y;
  vec3 phosphor = mix(uPhosphor, rainbow(uHue + .3), .35);
  vec3 col = vec3(0.);

  vec2 g = abs(fract(p * 10. + .5) - .5) / fwidth(p * 10.);                        // graticule
  if (uGrid) col += phosphor * .06 * (1. - clamp(min(g.x, g.y), 0., 1.));

  float peak = .15;                                                                    // auto-gain, like a scope's trigger
  for (int i = 0; i < 24; i++) peak = max(peak, abs(wave((float(i) + .5) / 24.)));
  float gain = GAIN / peak;

  float x = clamp(p.x / aspect + .5, 0., 1.);
  float dx = 1. / 256.;
  float amp = .17 * gain;
  float y = .22 + wave(x) * amp;
  float slope = (wave(x + dx) - wave(x - dx)) * amp / (2. * dx * aspect);
  float d = abs(p.y - y) / sqrt(1. + slope * slope);
  col += phosphor * .0022 / (d + .0015) * (.6 + uLevel * .6);

  float sy = -.42 + spec(x) * .3;
  float ss = (spec(x + dx) - spec(x - dx)) * .3 / (2. * dx * aspect);
  d = abs(p.y - sy) / sqrt(1. + ss * ss);
  if (uSpectrumTrace) col += rainbow(x * .7 + uHue) * .0018 / (d + .0015) * .8;

  vec2 q = p - vec2(0., -.05);
  float dl = 9.;
  float xy = .2 * gain;
  vec2 prev = vec2(wave(0.), wave(.13)) * xy;
  for (int i = 1; i <= 64; i++) {
    float t = float(i) / 64.;
    vec2 cur = vec2(wave(t), wave(fract(t + .13))) * xy;
    dl = min(dl, seg(q, prev, cur));
    prev = cur;
  }
  if (uLissajous) col += neon(uHue + .6) * .0016 / (dl + .0015) * (.5 + uBeat * .8);

  if (uScanlines) col *= .9 + .1 * sin(gl_FragCoord.y * 2.);                                           // scanlines
  fragColor = vec4(col, 1.);
}
`;

// Truchet tiles: random quarter-circle arcs that join into endless winding neon tubes.
const TRUCHET = /* glsl */ `
const float SCALE = 6.;                  // @param min=2 max=20 label="Tile density"
const float SPEED = 1.;                  // @param min=0 max=4 label="Scroll speed"
const float WIDTH = .07;                 // @param min=.02 max=.2 label="Tube width"
const float DASHES = 8.;                 // @param min=0 max=20 int label="Dashes"
const float FLOW = 3.;                   // @param min=0 max=10 label="Flow speed"

void main() {
  vec2 p = centered() * SCALE;
  p *= rot(uTime * .03);
  p += vec2(uTime * .3, uTime * .12) * SPEED;
  vec2 id = floor(p), f = fract(p) - .5;
  float h = hash(id);
  if (h < .5) f.x = -f.x;
  vec2 c1 = f - .5, c2 = f + .5;
  float d1 = abs(length(c1) - .5), d2 = abs(length(c2) - .5);
  vec2 cc = d1 < d2 ? c1 : c2;
  float d = min(d1, d2);
  float side = mod(id.x + id.y, 2.) * 2. - 1.;          // alternate direction so the flow lines up
  float along = atan(cc.y, cc.x) * side * (h < .5 ? -1. : 1.);
  float dash = .5 + .5 * sin(along * DASHES - uTime * FLOW);
  float w = WIDTH + uBass * .03;
  float e = hash(id + 7.);
  vec3 c = rainbow(e * .3 + length(id) * .03 + uTime * .04 + uHue);
  vec3 col = c * smoothstep(w, w - .025, d) * (.3 + .7 * dash) * (.4 + spec(e) * 1.4);
  col += c * .012 / (d + .012) * .25;
  col += neon(e + uHue) * smoothstep(.03, 0., abs(d - w - .03)) * .3 * (.5 + uHigh);
  col *= .8 + uBeat * .4;
  fragColor = vec4(col, 1.);
}
`;

// Op-art moiré: three sets of concentric rings drifting over each other.
const MOIRE = /* glsl */ `
const float DENSITY = 55.;               // @param min=10 max=150 label="Ring density"
const float DRIFT = 1.;                  // @param min=0 max=4 label="Drift speed"
const float ORBIT = 1.;                  // @param min=0 max=3 label="Orbit size"
uniform bool uSecond;                    // @param default=true label="Second pattern"

void main() {
  vec2 p = centered();
  float T = uTime * DRIFT;
  vec2 c1 = .2 * ORBIT * vec2(sin(T * .31), cos(T * .23));
  vec2 c2 = .2 * ORBIT * vec2(sin(T * .27 + 2.), cos(T * .19 + 4.));
  vec2 c3 = .25 * ORBIT * vec2(cos(T * .17 + 1.), sin(T * .21 + 3.));
  float f = DENSITY;
  float r1 = sin(length(p - c1) * f), r2 = sin(length(p - c2) * f), r3 = sin(length(p - c3) * f * .8);
  float m1 = r1 * r2, m2 = r2 * r3;
  float r = length(p);
  vec3 col = rainbow(m1 * .2 + r * .6 - uTime * .05 + uHue) * smoothstep(.1, .9, m1) * (.4 + spec(fract(r)) * 1.2);
  if (uSecond) col += neon(m2 * .3 + r + uHue + .5) * smoothstep(.3, 1., m2) * (.3 + uHigh * .8);
  col *= (.6 + uBeat * .5) * smoothstep(1.2, .2, r);
  fragColor = vec4(col, 1.);
}
`;

// Jump to light speed: star streaks rushing out of the centre.
const HYPERSPACE = /* glsl */ `
const float SPEED = 1.;                  // @param min=0 max=4 label="Warp speed"
const float LAYERS = 4.;                 // @param min=1 max=6 int label="Layers"
const float DENSITY = .5;                // @param min=0 max=1 label="Star density"
const float LENGTH = .35;                // @param min=.05 max=1 label="Streak length"
uniform bool uCore;                      // @param default=true label="Centre glow"

void main() {
  vec2 p = centered();
  float a = atan(p.y, p.x), r = length(p);
  vec3 col = vec3(0.);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= LAYERS) break;
    float fi = float(i);
    float cells = 70. + fi * 37.;
    float sa = (a / TAU + .5) * cells;
    float id = floor(sa);
    float h = hash(vec2(id, fi)), h2 = hash(vec2(fi * 3.1, id));
    float pos = fract(h2 + uTime * SPEED * (.12 + h * .12));
    float head = pos * pos * 1.3;
    float len = .01 + head * LENGTH;
    float on = step(head - len, r) * step(r, head);
    float tail = clamp((r - head + len) / len, 0., 1.);
    float lat = abs(fract(sa) - .5) / cells * TAU * r;
    float w = .001 + head * .004;
    float s = smoothstep(w, 0., lat) * on * tail * tail * step(1. - DENSITY, h);
    col += mix(vec3(.7, .85, 1.), rainbow(h * 3. + uHue), .5) * s * (1.5 + spec(h) * 2.);
  }
  if (uCore) col += rainbow(uHue + .6) * .02 / (r + .02) * (.3 + uLevel * .6 + uBeat * .5);
  col += neon(r * 2. - uTime * .2 + uHue) * smoothstep(.0, .6, r) * .04 * (1. + uBass);
  fragColor = vec4(col, 1.);
}
`;

// Flight through an endless Menger sponge, lit by bands of light that run along the halls.
const MENGER = /* glsl */ `
const float SPEED = .5;                  // @param min=0 max=3 label="Flight speed"
const float LEVELS = 4.;                 // @param min=1 max=5 int label="Detail levels"
const float TWIST = .04;                 // @param min=0 max=.3 label="Twist"
const float BAND_GLOW = 1.;              // @param min=0 max=4 label="Light bands"
const float FOG = .18;                   // @param min=0 max=.6 label="Fog"

float map(vec3 p) {
  p.xy *= rot(p.z * TWIST);
  float d = -1e5, s = 1.;
  for (int m = 0; m < 5; m++) {
    if (float(m) >= LEVELS) break;
    vec3 a = mod(p * s, 2.) - 1.;
    s *= 3.;
    vec3 r = abs(1. - 3. * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.) / s;
    d = max(d, c);
  }
  return d;
}
void main() {
  vec2 uv = centered();
  vec3 ro = vec3(0., 0., uTime * SPEED);
  vec3 rd = normalize(vec3(uv, 1.2));
  rd.xy *= rot(uTime * .07);
  float t = .02, d = 1.;
  int steps = 0;
  for (int i = 0; i < 90; i++) {
    d = map(ro + rd * t);
    if (d < .0008 * t || t > 12.) break;
    t += d;
    steps = i;
  }
  vec3 col = vec3(0.);
  if (t < 12.) {
    vec3 p = ro + rd * t;
    float ao = 1. - float(steps) / 90.;
    float band = smoothstep(.85, 1., sin(p.z * 3. - uTime * 2.));
    col = rainbow(p.z * .08 + length(p.xy) + uHue) * ao * ao * (.35 + spec(fract(p.z * .1)) * .9);
    col += neon(p.z * .1 + uHue) * band * (.3 + uBass * 1.2) * BAND_GLOW;
    col *= exp(-t * FOG);
  }
  col += rainbow(uHue + .4) * exp(-t * .5) * .05 * (1. + uBeat);
  fragColor = vec4(col, 1.);
}
`;

// The Flower of Life: 19 overlapping circles. Petal colour comes from how many circles overlap.
const FLOWER = /* glsl */ `
const float ZOOM = 5.2;                  // @param min=2 max=12 label="Zoom out"
const float SPIN = .04;                  // @param min=-.5 max=.5 label="Spin speed"
const float RINGS = 2.;                  // @param min=0 max=2 int label="Flower rings"
const float FILL = 1.;                   // @param min=0 max=3 label="Petal fill"
uniform bool uOuter;                     // @param default=true label="Outer circle"
uniform bool uLattice;                   // @param default=true label="Background lattice"

void main() {
  vec2 p = centered() * ZOOM;
  p *= rot(uTime * SPIN);
  mat2 lat = mat2(1., 0., .5, .8660254);
  vec2 base = floor(inverse(lat) * p);
  float ring = 9., grid = 9., inside = 0.;
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      vec2 c = lat * (base + vec2(float(i), float(j)));
      float d = length(p - c);
      grid = min(grid, abs(d - 1.));
      if (length(c) < RINGS + .01) { ring = min(ring, abs(d - 1.)); inside += step(d, 1.); }
    }
  float r = length(p);
  float outer = abs(r - RINGS - 1.);
  vec3 col = rainbow(inside * .11 - uTime * .06 + r * .05 + uHue) * inside * .09 * FILL * (.5 + spec(fract(inside * .13)) * 1.3);
  col += neon(r * .1 + uHue + uTime * .03) * (.025 / (ring + .025)) * .45 * (.6 + uHigh * .8);
  if (uOuter) col += neon(r * .1 + uHue + .5) * (.02 / (outer + .02)) * .5 * (.6 + uBeat);
  if (uLattice) col += rainbow(uHue + r * .1) * (.015 / (grid + .015)) * .06 * smoothstep(RINGS + .8, RINGS + 2., r);
  col *= .8 + uBeat * .4;
  fragColor = vec4(col, 1.);
}
`;

// Quasicrystal: seven plane waves at evenly spaced angles never repeat, giving Penrose-like order.
const QUASI = /* glsl */ `
const float WAVES = 7.;                  // @param min=3 max=15 int label="Symmetry (waves)"
const float SCALE = 40.;                 // @param min=10 max=100 label="Pattern density"
const float BANDS = 3.;                  // @param min=1 max=8 label="Bands"
const float SPEED = .7;                  // @param min=0 max=3 label="Pulse speed"
const float SPIN = .02;                  // @param min=-.5 max=.5 label="Spin speed"

void main() {
  vec2 p = centered() * SCALE;
  p *= rot(uTime * SPIN);
  float v = 0.;
  for (int i = 0; i < 15; i++) {
    if (float(i) >= WAVES) break;
    float a = float(i) * PI / WAVES;
    v += cos(dot(p, vec2(cos(a), sin(a))) + uTime * SPEED);
  }
  v /= WAVES;                                       // -1 … 1
  float r = length(p) / SCALE;
  float bands = pow(.5 + .5 * cos(v * PI * BANDS), 2.);
  vec3 col = rainbow(v * .6 + r * .3 + uHue + uTime * .02) * bands * (.35 + spec(v * .5 + .5) * 1.3);
  col += neon(v + uHue) * smoothstep(.8, 1., v * .5 + .5) * (.4 + uBeat);
  col *= smoothstep(1.3, .3, r);
  fragColor = vec4(col, 1.);
}
`;

// Tumbling blocks: the classic isometric cube tiling. Cubes flip inside-out in slow waves.
const BLOCKS = /* glsl */ `
const float SCALE = 6.;                  // @param min=2 max=16 label="Cube density"
const float DRIFT = 1.;                  // @param min=0 max=4 label="Drift speed"
const float DEPTH = 1.;                  // @param min=0 max=1.3 label="3D shading"
const float FLIP_SPEED = .6;             // @param min=0 max=3 label="Flip wave speed"
uniform bool uFlip;                      // @param default=true label="Cubes flip inside-out"
uniform bool uEdges;                     // @param default=true label="Glowing edges"

void main() {
  vec2 p = centered() * SCALE;
  p += vec2(uTime * .15, uTime * .05) * DRIFT;
  vec2 rr = vec2(1., 1.73);
  vec2 a = mod(p, rr) - rr * .5, b = mod(p - rr * .5, rr) - rr * .5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - gv;
  float h = hash(floor(id * vec2(2., 1.156) + .5));   // stable per-cell id (centres sit on a .5 × .865 lattice)
  if (uFlip && sin(uTime * FLIP_SPEED + id.x * .7 + id.y * .4) > .3) gv.y = -gv.y;   // Necker flip: corner in instead of out
  float ang = degrees(atan(gv.y, gv.x));
  float face = ang > 30. && ang < 150. ? 0. : (ang >= 150. || ang < -90. ? 1. : 2.);
  float shade = face == 0. ? 1. : 1. - DEPTH * (face == 1. ? .45 : .75);
  vec3 c = rainbow(h * .25 + face * .08 + length(id) * .03 + uHue + uTime * .02);
  vec3 col = c * shade * (.35 + spec(fract(h * 3.)) * 1.2);

  float edge = 1.;
  for (int k = 0; k < 3; k++) {                   // the three inner edges, from the centre to every other corner
    float ra = radians(30. + 120. * float(k));
    vec2 dir = vec2(cos(ra), sin(ra));
    float along = dot(gv, dir);
    if (along > 0.) edge = min(edge, abs(dot(gv, vec2(-dir.y, dir.x))));
  }
  vec2 q = abs(gv);
  edge = min(edge, abs(max(dot(q, normalize(vec2(1., 1.73))), q.x) - .5));   // hexagon outline
  if (uEdges) col += neon(h + uHue) * .012 / (edge + .012) * (.25 + uHigh * .5 + uBeat * .4);
  fragColor = vec4(col, 1.);
}
`;

// Endless zoom through nested, twisting squares and triangles (log-polar repetition).
const POLY_TUNNEL = /* glsl */ `
const float SIDES_A = 4.;                // @param min=3 max=8 int label="Shape 1 sides"
const float SIDES_B = 3.;                // @param min=3 max=8 int label="Shape 2 sides"
const float SPEED = 1.;                  // @param min=0 max=4 label="Zoom speed"
const float DENSITY = 3.;                // @param min=1 max=8 label="Ring density"
const float TWIST = .6;                  // @param min=-2 max=2 label="Twist"
uniform bool uSecond;                    // @param default=true label="Second shape"

float polyRadius(vec2 p, float n, float twist) {
  float a = atan(p.y, p.x) + twist;
  float seg = TAU / n;
  return length(p) * cos(mod(a, seg) - seg * .5) / cos(PI / n);
}
float rings(float pr, float speed, out float id) {
  float u = log(pr) * DENSITY - uTime * speed;
  id = floor(u);
  float f = fract(u);
  return min(f, 1. - f) / max(fwidth(u), 1e-4);
}
void main() {
  vec2 p = centered();
  float twist = log(length(p) + 1e-4) * TWIST;
  float id1, id2;
  float d1 = rings(polyRadius(p, SIDES_A, twist + uTime * .1), .6 * SPEED, id1);
  float d2 = rings(polyRadius(p, SIDES_B, -twist * 1.3 - uTime * .07), .45 * SPEED, id2);
  vec3 col = rainbow(id1 * .07 + uHue) * smoothstep(3., 0., d1) * (.5 + spec(fract(id1 * .13)) * 1.4);
  col += rainbow(id1 * .07 + uHue) * .25 / (1. + d1 * .3);
  if (uSecond) col += neon(id2 * .09 + uHue + .5) * smoothstep(2., 0., d2) * (.35 + uHigh * .9);
  float r = length(p);
  col *= smoothstep(0., .12, r) * (.8 + uBeat * .5);
  col += vec3(1., .8, 1.) * .01 / (r + .01) * (.3 + uLevel);
  fragColor = vec4(col, 1.);
}
`;

// Vasarely-style op art: a checkerboard bulged by two orbiting lenses.
const VASARELY = /* glsl */ `
const float CHECKS = 14.;                // @param min=4 max=40 label="Checker density"
const float LENS = .3;                   // @param min=.1 max=.6 label="Lens size"
const float MAGNIFY = .55;               // @param min=0 max=.9 label="Lens strength"
const float DRIFT = 1.;                  // @param min=0 max=4 label="Lens drift"
uniform bool uMono;                      // @param default=false label="Black & white"

void main() {
  vec2 p = centered();
  float T = uTime * DRIFT;
  vec2 c1 = .22 * vec2(cos(T * .23), sin(T * .31));
  vec2 c2 = -.25 * vec2(cos(T * .17 + 1.), sin(T * .21 + 2.));
  float R = LENS + uBass * .03;
  float b1 = smoothstep(R, 0., length(p - c1)), b2 = smoothstep(R * .8, 0., length(p - c2));
  vec2 q = p;
  q = c1 + (q - c1) * (1. - b1 * MAGNIFY);            // magnify near each lens
  q = c2 + (q - c2) * (1. - b2 * MAGNIFY * .9);
  q *= rot(uTime * .03);
  float k = CHECKS;
  vec2 g = sin(q * k * PI);
  float checker = g.x * g.y;
  float aa = fwidth(checker) * 1.5 + 1e-4;
  float m = smoothstep(-aa, aa, checker);
  vec3 a = uMono ? vec3(1.) : rainbow(q.x * .4 + q.y * .2 + uHue + uTime * .02);
  vec3 b = uMono ? vec3(0.) : neon(q.y * .5 - q.x * .3 + uHue + .5) * .18;
  float light = 1. + (b1 + b2) * (.5 + uBeat * .5);
  vec3 col = mix(b, a * (.45 + spec(fract(length(q) * .7)) * .9), m) * light;
  col *= smoothstep(1.2, .4, length(p));
  fragColor = vec4(col, 1.);
}
`;

// A tesseract (4D hypercube) turning through the fourth dimension, drawn as glowing edges.
const TESSERACT = /* glsl */ `
const float SPIN_4D = 1.;                // @param min=0 max=3 label="Spin through 4D"
const float SPIN_3D = 1.;                // @param min=0 max=3 label="Spin in 3D"
const float DEPTH_4D = 3.;               // @param min=1.6 max=8 label="4D depth (low = deep inner cube)"
const float SIZE = 1.25;                 // @param min=.4 max=3 label="Size"
const float EDGE_GLOW = 1.;              // @param min=.2 max=4 label="Edge glow"
const float CORNER_GLOW = 1.;            // @param min=0 max=4 label="Corner glow"
uniform bool uAxisColours;               // @param default=true label="Colour each axis"
uniform vec3 uEdgeColour;                // @param color default=#4fe3ff label="Single edge colour"
uniform bool uCornerFlash;               // @param default=true label="Corners flash on the beat"
const float DOTS = 2.;                   // @param min=0 max=6 int label="Dots per edge"
const float DOT_SPEED = .3;              // @param min=0 max=2 label="Dot speed"
const float DOT_SIZE = 1.;               // @param min=.2 max=3 label="Dot size"

float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
void main() {
  vec2 p = centered();
  vec2 v[16];
  for (int i = 0; i < 16; i++) {
    vec4 q = vec4(i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1) * 2. - 1.;
    q.xw *= rot(uTime * .31 * SPIN_4D);
    q.yw *= rot(uTime * .23 * SPIN_4D);
    q.xy *= rot(uTime * .11 * SPIN_3D);
    q.yz *= rot(.5 + uTime * .07 * SPIN_3D);
    vec3 s = q.xyz / (DEPTH_4D - q.w);            // 4D -> 3D
    v[i] = s.xy / (2.6 - s.z) * (SIZE + uBass * .08) * (DEPTH_4D - 1.) / 2.;   // 3D -> 2D, size kept steady as the depth changes
  }
  vec3 col = vec3(0.);
  for (int i = 0; i < 16; i++)
    for (int j = 0; j < 4; j++) {
      int k = i ^ (1 << j);
      if (k < i) continue;
      float d = seg(p, v[i], v[k]);
      vec3 c = uAxisColours ? rainbow(float(j) * .22 + uHue + uTime * .02) : uEdgeColour;
      col += c * EDGE_GLOW * .0016 / (d + .0018) * (.5 + spec(float(j) * .2 + .08) * 1.2);

      // Dots travelling along the edge: each has its own random colour, start, direction and speed.
      for (int n = 0; n < 6; n++) {
        if (float(n) >= DOTS) break;
        vec2 id = vec2(float(i * 4 + j), float(n));
        float dir = hash(id + 3.7) < .5 ? -1. : 1.;
        float t = fract(hash(id) + uTime * DOT_SPEED * (.5 + hash(id + 9.1)) * dir);
        float dd = length(p - mix(v[i], v[k], t));
        float dot_ = smoothstep(.012 * DOT_SIZE, .004 * DOT_SIZE, dd) * 2. + .0012 * DOT_SIZE / (dd + .003);
        col += rainbow(hash(id + 1.3) * 5.) * dot_ * (.7 + uBeat * .8);
      }
    }
  float flash = uCornerFlash ? .3 + uBeat * .9 : .5;
  for (int i = 0; i < 16; i++) col += vec3(1., .9, 1.) * CORNER_GLOW * .002 / (length(p - v[i]) + .004) * flash;
  fragColor = vec4(col, 1.);
}
`;

// Spirograph: a hypotrochoid whose pen distance slowly morphs, coloured along its path.
const SPIRO = /* glsl */ `
const float R_OUTER = 7.;                // @param min=2 max=15 int label="Ring size (sets the lobes)"
const float R_INNER = 3.;                // @param min=1 max=6 int label="Wheel size"
const float PEN = 3.5;                   // @param min=0 max=6 label="Pen distance"
const float MORPH = 1.5;                 // @param min=0 max=3 label="Pen morph"
const float MORPH_SPEED = .09;           // @param min=0 max=.5 label="Morph speed"
const float SPIN = .05;                  // @param min=-1 max=1 label="Spin speed"
uniform bool uCircle;                    // @param default=true label="Outer circle"

float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
// Hypotrochoid: a wheel of size r rolling inside a ring of size R (R = 7, r = 3: seven lobes, 3 turns).
vec2 curve(float t, float pen) {
  float k = (R_OUTER - R_INNER) / R_INNER;
  return (vec2(cos(t), sin(t)) * (R_OUTER - R_INNER) + vec2(cos(t * k), -sin(t * k)) * pen) * .05 * 9. / (abs(R_OUTER - R_INNER) + 5.);
}
void main() {
  vec2 p = centered() * rot(uTime * SPIN);
  float pen = PEN + MORPH * sin(uTime * MORPH_SPEED);
  const int N = 360;
  float best = 9., bestT = 0.;
  vec2 prev = curve(0., pen);
  for (int i = 1; i <= N; i++) {
    float t = float(i) / float(N) * TAU * R_INNER;   // the curve closes after r turns
    vec2 cur = curve(t, pen);
    float d = seg(p, prev, cur);
    if (d < best) { best = d; bestT = t; }
    prev = cur;
  }
  float u = bestT / (TAU * R_INNER);
  vec3 col = rainbow(u * 2. + uHue + uTime * .03) * .0022 / (best + .002) * (.45 + spec(u) * 1.3);
  float r = length(p);
  if (uCircle) col += neon(r * 2. + uHue) * .004 / (abs(r - .41 - uBass * .01) + .004) * .3 * (.5 + uBeat);
  fragColor = vec4(col, 1.);
}
`;

// ---- Scenes with live parameters (tweak them in the Parameters overlay, P) ----

// Lissajous figure: two sine waves at a whole-number ratio trace a closed knot.
const LISSAJOUS = /* glsl */ `
const float FREQ_X = 3.;                 // @param min=1 max=9 int label="X frequency"
const float FREQ_Y = 2.;                 // @param min=1 max=9 int label="Y frequency"
const float DRIFT = .15;                 // @param min=0 max=1 label="Phase drift"
const float GLOW = 1.;                   // @param min=.2 max=3 label="Glow"
const vec3 COLOR_A = vec3(.3, .9, 1.);   // @param color label="Colour A"
const vec3 COLOR_B = vec3(1., .3, .8);   // @param color label="Colour B"

float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
void main() {
  vec2 p = centered();
  float ph = uTime * DRIFT;
  const int N = 360;
  vec2 prev = .38 * vec2(sin(ph), 0.);
  float best = 9., bestT = 0.;
  for (int i = 1; i <= N; i++) {
    float t = float(i) / float(N) * TAU;
    vec2 cur = .38 * vec2(sin(FREQ_X * t + ph), sin(FREQ_Y * t));
    float d = seg(p, prev, cur);
    if (d < best) { best = d; bestT = t; }
    prev = cur;
  }
  vec3 c = mix(COLOR_A, COLOR_B, .5 + .5 * sin(bestT * 2. + uTime * .3));
  vec3 col = c * GLOW * .0022 / (best + .002) * (.5 + spec(bestT / TAU) * 1.3);
  fragColor = vec4(col * (.8 + uBeat * .5), 1.);
}
`;

// Kaleidoscope over flowing noise, with control over the mirror itself.
const MIRROR_KALEIDO = /* glsl */ `
const float SEGMENTS = 8.;               // @param min=2 max=24 int label="Mirror segments"
const float ZOOM = 3.;                   // @param min=.5 max=10 label="Zoom"
const float TWIST = .5;                  // @param min=-3 max=3 label="Twist"
const float SPIN = .1;                   // @param min=-1 max=1 label="Spin speed"
uniform bool uFlip;                      // @param default=true label="Mirror each segment"
uniform vec3 uTint;                      // @param color default=#ffffff label="Tint"

void main() {
  vec2 p = centered();
  float r = length(p), a = atan(p.y, p.x) + uTime * SPIN + r * TWIST;
  float seg = TAU / SEGMENTS;
  a = mod(a, seg);
  if (uFlip) a = abs(a - seg * .5);
  vec2 q = vec2(cos(a), sin(a)) * r * ZOOM + vec2(uTime * .1, uTime * .07);
  float n = fbm(q + fbm(q * .5 + uTime * .05) * 2.);
  vec3 col = rainbow(n * 1.5 + r * .5 + uHue) * smoothstep(.3, .8, n) * (.5 + spec(n) * 1.3);
  col += neon(n + uHue) * smoothstep(.42, .5, abs(fract(n * 6.) - .5)) * .5 * (.5 + uHigh);
  col *= uTint * smoothstep(1.3, .2, r) * (.8 + uBeat * .4);
  fragColor = vec4(col, 1.);
}
`;

// The demoscene classic: summed sine waves through your own three-colour gradient.
const RETRO_PLASMA = /* glsl */ `
const float SCALE = 6.;                  // @param min=1 max=20 label="Scale"
const float SPEED = 1.;                  // @param min=0 max=4 label="Speed"
const float BANDS = 0.;                  // @param min=0 max=16 int label="Posterize (0 = smooth)"
uniform vec3 uColA;                      // @param color default=#ff2fa0 label="Colour 1"
uniform vec3 uColB;                      // @param color default=#2fd8ff label="Colour 2"
uniform vec3 uColC;                      // @param color default=#ffe14f label="Colour 3"

void main() {
  vec2 p = centered() * SCALE;
  float t = uTime * SPEED;
  float v = sin(p.x + t) + sin((p.y + t) * .5) + sin((p.x + p.y + t) * .5);
  vec2 c = p + .5 * SCALE * vec2(sin(t / 5.), cos(t / 3.));
  v += sin(sqrt(dot(c, c) + 1.) + t);
  v = v * .125 + .5;
  if (BANDS > 0.) v = floor(v * BANDS) / BANDS;
  float k = fract(v + uHue) * 3.;          // colour cycling walks around the gradient
  vec3 col = k < 1. ? mix(uColA, uColB, k) : k < 2. ? mix(uColB, uColC, k - 1.) : mix(uColC, uColA, k - 2.);
  fragColor = vec4(col * (.55 + spec(v) * .9 + uBeat * .25), 1.);
}
`;

// Layered starfield flying towards a movable vanishing point.
const STARFIELD = /* glsl */ `
const float DENSITY = .5;                // @param min=.05 max=1 label="Density"
const float SPEED = 1.;                  // @param min=0 max=5 label="Warp speed"
const float SIZE = 1.;                   // @param min=.3 max=3 label="Star size"
uniform vec2 uCentre;                    // @param min=-.4 max=.4 label="Vanishing point"
uniform vec3 uStarColor;                 // @param color default=#cfe4ff label="Star colour"
uniform bool uRainbow;                   // @param default=false label="Rainbow stars"

void main() {
  vec2 p = centered() - uCentre;
  vec3 col = vec3(0.);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float depth = fract(fi / 6. + uTime * SPEED * .05);   // 0 far … 1 passing the camera
    float fade = depth * smoothstep(1., .85, depth);
    vec2 q = p * mix(18., .6, depth) + fi * 17.31;
    vec2 id = floor(q), f = fract(q) - .5;
    float h = hash(id);
    if (h > DENSITY) continue;
    vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - .5;
    float d = length(f - o * .3);          // stars stay near the cell centre …
    vec3 c = uRainbow ? rainbow(h * 5. + uHue) : uStarColor;
    float star = (smoothstep(.05 * SIZE, 0., d) + .006 * SIZE / (d + .006)) * smoothstep(.35, .1, d);   // … and fade out before its edge
    col += c * star * fade * (.6 + spec(h) * 1.2 + uBeat * .5);
  }
  fragColor = vec4(col, 1.);
}
`;

// Rotating rays from a movable centre.
const SUNBURST = /* glsl */ `
const float RAYS = 16.;                  // @param min=3 max=48 int label="Rays"
const float SPIN = .2;                   // @param min=-2 max=2 label="Spin speed"
const float SHARPNESS = .5;              // @param min=0 max=1 label="Edge sharpness"
uniform vec2 uCentre;                    // @param min=-.5 max=.5 label="Centre"
uniform vec3 uColA;                      // @param color default=#ff7a18 label="Ray colour"
uniform vec3 uColB;                      // @param color default=#3a0a5a label="Gap colour"
uniform bool uPulse;                     // @param default=true label="Glow on the beat"

void main() {
  vec2 p = centered() - uCentre;
  float r = length(p), a = atan(p.y, p.x) + uTime * SPIN;
  float edge = mix(.8, .02, SHARPNESS);
  float m = smoothstep(-edge, edge, sin(a * RAYS) + sin(r * 6. - uTime * 2.) * .15);
  vec3 col = mix(uColB, uColA, m) * (.5 + spec(clamp(r, 0., 1.)) * 1.2);
  col += uColA * .04 / (r + .04) * (1. + (uPulse ? uBeat * 2. : 0.));
  col *= smoothstep(1.5, .1, r);
  fragColor = vec4(col, 1.);
}
`;

// 2D metaballs: blobs drift and merge like wax in a lava lamp.
const LAVA_LAMP = /* glsl */ `
const float BLOBS = 6.;                  // @param min=1 max=12 int label="Blobs"
const float SIZE = .12;                  // @param min=.03 max=.3 label="Blob size"
const float GOO = .5;                    // @param min=0 max=1 label="Gooiness"
const float SPEED = .5;                  // @param min=0 max=2 label="Speed"
uniform vec3 uBlob;                      // @param color default=#ff5a1f label="Lava colour"
uniform vec3 uBack;                      // @param color default=#2a0838 label="Glass colour"

void main() {
  vec2 p = centered();
  float field = 0.;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= BLOBS) break;
    float fi = float(i);
    vec2 c = vec2(sin(fi * 2.1 + uTime * SPEED * (.3 + hash(vec2(fi, 1.)) * .4)) * .45,
                  sin(fi * 1.3 + uTime * SPEED * (.2 + hash(vec2(fi, 2.)) * .3)) * .36);
    float s = SIZE * (1. + spec(fi / 12. + .03) * .5);
    field += s * s / (dot(p - c, p - c) + 1e-4);
  }
  float th = mix(1.6, .5, GOO);            // lower threshold = fatter blobs that merge sooner
  float inside = smoothstep(th, th * 1.08, field);
  vec3 back = uBack * (.5 + .7 * (p.y + .5));
  vec3 col = mix(back, uBlob, inside);
  col += uBlob * .35 * smoothstep(th * 2., th * 5., field);           // hot core
  col += uBlob * .2 * smoothstep(th * .3, th, field) * (1. - inside); // glow around each blob
  fragColor = vec4(col * (.85 + uBeat * .3 + uLevel * .2), 1.);
}
`;

// ---- Media: distort the image / video you drop in ----

const MEDIA_KALEIDO = /* glsl */ `
const float SEGMENTS = 6.;               // @param min=0 max=16 int label="Segments (0 = off)"
const float ZOOM = 1.;                   // @param min=.2 max=4 label="Zoom"
const float SPIN = .05;                  // @param min=-1 max=1 label="Spin speed"
const float BEAT_FLASH = .3;             // @param min=0 max=1 label="Flash on the beat"
uniform bool uRainbowTint;               // @param default=false label="Rainbow tint"

void main() {
  vec2 p = centered() * rot(uTime * SPIN) / ZOOM;
  float r = length(p);
  if (SEGMENTS > 0.) {
    float seg = TAU / SEGMENTS;
    float a = abs(mod(atan(p.y, p.x), seg) - seg * .5);
    p = vec2(cos(a), sin(a)) * r;
  }
  vec3 col = media(p);
  if (uRainbowTint) col *= rainbow(r + uTime * .05 + uHue) * 1.4;
  fragColor = vec4(untone(col * (.85 + uBeat * BEAT_FLASH + uLevel * .15)), 1.);
}
`;

const MEDIA_LIQUID = /* glsl */ `
const float AMOUNT = .08;                // @param min=0 max=.4 label="Warp amount"
const float SCALE = 3.;                  // @param min=.5 max=10 label="Wave scale"
const float SPEED = .3;                  // @param min=0 max=2 label="Flow speed"
const float CHROMA = .01;                // @param min=0 max=.05 label="Colour split"
uniform bool uSwirl;                     // @param default=false label="Swirl"

void main() {
  vec2 p = centered();
  vec2 q = p * SCALE + uTime * SPEED * vec2(.3, .2);
  vec2 d = p + (vec2(fbm(q), fbm(q + 7.3)) - .5) * AMOUNT * 2.;
  if (uSwirl) d = rot(length(p) * 3. * sin(uTime * .2)) * d;
  vec2 split = vec2(CHROMA * (1. + uBeat), 0.);
  vec3 col = vec3(media(d + split).r, media(d).g, media(d - split).b);
  fragColor = vec4(untone(col * (.85 + uBeat * .3)), 1.);
}
`;

const MEDIA_GLITCH = /* glsl */ `
const float GLITCH = .5;                 // @param min=0 max=1 label="Glitch amount"
const float BLOCKS = 12.;                // @param min=2 max=40 int label="Block rows"
const float RGB_SPLIT = .015;            // @param min=0 max=.06 label="RGB split"
uniform bool uScanlines;                 // @param default=true label="Scanlines"
uniform bool uOnBeat;                    // @param default=true label="Burst on the beat"

void main() {
  vec2 p = centered();
  float t = floor(uTime * 8.);           // the glitch pattern changes 8 times a second
  float amt = GLITCH * (uOnBeat ? .25 + uBeat * 1.2 : 1.);
  float row = floor((p.y + .5) * BLOCKS);
  float shift = step(1. - amt * .6, hash(vec2(row, t))) * (hash(vec2(t, row)) - .5) * .3 * amt;
  vec2 q = p + vec2(shift, 0.);
  vec2 split = vec2(RGB_SPLIT * (1. + amt * 2.), 0.);
  vec3 col = vec3(media(q + split).r, media(q).g, media(q - split).b);
  vec2 cell = floor((p + .5) * vec2(BLOCKS * 1.7, BLOCKS));
  if (hash(cell + t) > 1. - amt * .15) col = col.gbr * 1.5;   // corrupted blocks
  if (uScanlines) col *= .85 + .15 * sin(gl_FragCoord.y * 1.5);
  col += (hash(p * 500. + t) - .5) * .08 * amt;
  fragColor = vec4(untone(col), 1.);
}
`;

const MEDIA_HALFTONE = /* glsl */ `
const float DOTS = 50.;                  // @param min=10 max=150 int label="Dots per screen height"
const float ANGLE = .4;                  // @param min=0 max=1.57 label="Screen angle"
uniform vec3 uInk;                       // @param color default=#1a0f2e label="Ink"
uniform vec3 uPaper;                     // @param color default=#f6efe0 label="Paper"
uniform bool uColourDots;                // @param default=false label="Colour dots on ink"

void main() {
  vec2 p = centered();
  vec2 q = rot(ANGLE) * p * DOTS;
  vec2 cell = floor(q) + .5;
  vec3 m = media(rot(-ANGLE) * cell / DOTS);
  float l = luma(m);
  float r = (uColourDots ? sqrt(l) : sqrt(1. - l)) * .62 * (1. + uBeat * .12);
  float aa = length(fwidth(q));
  float dotMask = smoothstep(r + aa, r - aa, length(q - cell));
  vec3 col = uColourDots ? mix(uInk, m * 1.25, dotMask) : mix(uPaper, uInk, dotMask);
  fragColor = vec4(untone(col * (.9 + uLevel * .15)), 1.);
}
`;

const MEDIA_RIPPLE = /* glsl */ `
const float RINGS = 20.;                 // @param min=2 max=60 label="Ring density"
const float STRENGTH = .02;              // @param min=0 max=.08 label="Strength"
const float SPEED = 2.;                  // @param min=0 max=8 label="Speed"
uniform vec2 uCentre;                    // @param min=-.5 max=.5 label="Drop point"
uniform bool uShade;                     // @param default=true label="Light the waves"

void main() {
  vec2 p = centered();
  vec2 d = p - uCentre;
  float r = length(d), fall = exp(-r * 2.);
  float ph = r * RINGS - uTime * SPEED;
  vec3 col = media(p + d / max(r, 1e-4) * sin(ph) * fall * STRENGTH);
  if (uShade) col *= 1. + cos(ph) * fall * .25;
  fragColor = vec4(untone(col * (.85 + uBeat * .3)), 1.);
}
`;

// Droste effect: the picture contains a smaller copy of itself, forever, while you zoom in.
const MEDIA_DROSTE = /* glsl */ `
const float ZOOM_SPEED = .3;             // @param min=-1.5 max=1.5 label="Zoom speed"
const float SPIRAL = 0.;                 // @param min=-3 max=3 int label="Spiral arms"
const float RATIO = 2.5;                 // @param min=1.3 max=6 label="Scale per copy"
uniform bool uFrame;                     // @param default=true label="Glowing frame"

void main() {
  vec2 p = centered();
  float r = length(p) + 1e-5, a = atan(p.y, p.x);
  float k = log(RATIO);
  float lr = log(r) - uTime * ZOOM_SPEED + a / TAU * SPIRAL * k;
  float f = mod(lr, k);                   // where we are inside one copy
  vec2 q = vec2(cos(a), sin(a)) * exp(f) * (.75 / RATIO);
  vec3 col = media(q);
  if (uFrame) col += neon(floor(lr / k) * .17 + uHue) * smoothstep(.06, 0., f) * (.6 + uBeat);
  fragColor = vec4(untone(col * (.85 + uLevel * .2)), 1.);
}
`;

const MEDIA_EDGES = /* glsl */ `
const float THRESHOLD = .15;             // @param min=0 max=.6 label="Edge threshold"
const float GLOW = 1.5;                  // @param min=.2 max=4 label="Glow"
const float SOURCE = .15;                // @param min=0 max=1 label="Show the media"
uniform bool uRainbow;                   // @param default=true label="Rainbow edges"
uniform vec3 uEdge;                      // @param color default=#4fe3ff label="Edge colour"

void main() {
  vec2 p = centered();
  vec2 e = vec2(1.5 / uRes.y, 0.);
  vec3 m = media(p);
  float gx = luma(media(p + e.xy)) - luma(media(p - e.xy));
  float gy = luma(media(p + e.yx)) - luma(media(p - e.yx));
  float edge = smoothstep(THRESHOLD, THRESHOLD + .2, length(vec2(gx, gy)) * 4.);
  vec3 c = uRainbow ? rainbow(luma(m) * 2. + uTime * .1 + uHue + length(p)) : uEdge;
  vec3 col = m * SOURCE + c * edge * GLOW * (.5 + spec(luma(m)) * 1.2 + uBeat * .5);
  fragColor = vec4(untone(col), 1.);
}
`;

// Beat Racer: game state lives in src/game.js and arrives through these uniforms.
const GAME = /* glsl */ `
uniform vec4 uObs[12];   // x lane position, z distance, type (0 wall, 1 orb), alive
uniform vec3 uGame;      // player x, distance travelled, crash flash
const float HOR = .12;   // horizon height on screen
const float CAMH = .6;   // camera height
const float PZ = 2.;     // player depth

float sdBox(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }

void main() {
  vec2 p = centered();
  p.x += sin(uTime * 60.) * uGame.z * .015;   // screen shake on crash
  p *= rot(-uGame.x * .04);
  vec3 col;
  float sy = p.y - HOR;

  if (sy > 0.) {
    col = mix(vec3(.25, .02, .35), vec3(.02, 0., .08), clamp(sy * 2.2, 0., 1.));
    vec2 sp = p - vec2(0., HOR + .2);
    float sr = .2 + uBass * .03;
    float stripes = clamp(step(0., sin(sp.y * 90. - uTime * 2.)) + step(.02, sp.y), 0., 1.);
    col += mix(vec3(1., .2, .6), vec3(1., .85, .2), clamp(sp.y / sr * .5 + .5, 0., 1.)) * smoothstep(sr, sr - .006, length(sp)) * stripes;
    col += vec3(1., .3, .7) * .01 / (abs(length(sp) - sr) + .02) * (.5 + uBeat);
    float m = spec(fract(abs(p.x) * .7)) * .22 + .015;    // mountains = spectrum
    col = mix(col, vec3(.05, 0., .1), smoothstep(.003, 0., sy - m));
    col += rainbow(abs(p.x) * .5 + uHue) * smoothstep(.006, 0., abs(sy - m)) * .8;
  } else {
    float z = CAMH / -sy;
    float wx = p.x * z;
    vec2 g = vec2(wx + .5, z + uGame.y);
    vec2 gg = abs(fract(g - .5) - .5) / max(fwidth(g), 1e-4);
    float line = 1. - clamp(min(gg.x, gg.y), 0., 1.);
    float fog = exp(-z * .05);
    col = vec3(.03, 0., .06) + rainbow(z * .02 + uHue + .6) * line * (.5 + uBass) * fog;
    col += vec3(1., .3, .9) * smoothstep(.08, 0., abs(abs(wx) - 1.5)) * fog * 1.5;   // road edges
  }

  for (int i = 0; i < 12; i++) {                  // sorted far -> near on the CPU
    vec4 o = uObs[i];
    if (o.w < .5 || o.y < .4) continue;
    float s = 1. / o.y;
    float base = HOR - CAMH * s;
    float fog = exp(-o.y * .04);
    if (o.z < .5) {
      float d = sdBox(p - vec2(o.x * s, base + .25 * s), vec2(.4, .25) * s);
      if (d < 0.) col = mix(col, vec3(.12, 0., .06) + vec3(.4, 0., .1) * uBeat, fog);
      col += vec3(1., .15, .3) * smoothstep(.006, 0., abs(d)) * 1.5 * fog;
      col += vec3(1., .1, .3) * .004 / (abs(d) + .01) * fog;
    } else {
      float d = length(p - vec2(o.x * s, base + .3 * s)) - .14 * s * (1. + uBeat * .3);
      col += rainbow(uTime * .5 + float(i) * .1) * (smoothstep(.01, 0., d) * .8 + .006 / (abs(d) + .01)) * fog;
    }
  }

  vec2 d = p - vec2(uGame.x / PZ, HOR - CAMH / PZ + .03);
  float ship = max(abs(d.x) * 1.6 + d.y, -d.y - .04) - .06;
  if (ship < 0.) col = vec3(.02, .05, .1);
  col += vec3(.2, 1., 1.) * smoothstep(.006, 0., abs(ship)) * 1.5;
  col += vec3(.3, .8, 1.) * .003 / (abs(ship) + .01);
  col += vec3(.2, .6, 1.) * .012 / (length(d + vec2(0., .06)) + .02) * (.5 + uBass * 1.5);   // engine glow
  col += vec3(1., .1, .2) * uGame.z * .7;
  fragColor = vec4(col, 1.);
}
`;

// Starting point for your own scene in the shader editor.
export const TEMPLATE = /* glsl */ `// Your own scene. Edit me — it recompiles as you type.
// Available: uTime uBass uMid uHigh uLevel uBeat uHue uBright uMood uRes
//            spec(x) wave(x) rainbow(t) neon(t) rot(a) noise(p) fbm(p) centered()
// Lines tagged // @param get a live control in the Parameters overlay (P).

const float RINGS = 30.;                    // @param min=5 max=80 int
const float PETALS = 6.;                    // @param min=1 max=16 int label="Petals"
uniform float uGlow;                        // @param min=0 max=3 default=1 label="Glow"
uniform vec3 uTint;                         // @param color default=#ffffff label="Tint"
uniform bool uCore;                         // @param default=true label="Beat flash in the centre"

void main() {
  vec2 p = centered();                 // (0,0) = screen centre, y goes -0.5..0.5
  float r = length(p);
  float a = atan(p.y, p.x);

  float rings = sin(r * RINGS - uTime * 4. + uBass * 6.);
  float petals = cos(a * PETALS + uTime);
  float shape = smoothstep(.0, .2, rings * petals + uMid);

  vec3 col = rainbow(r + uTime * .1 + uHue) * shape * uTint;
  col *= (.4 + spec(r) * 2.) * uGlow;   // brighter where the spectrum is loud
  if (uCore) col += vec3(1.) * uBeat * .3 * smoothstep(.3, .0, r);
  fragColor = vec4(col, 1.);
}
`;

// cat/desc are shown in the scene library.
const scene = (name, cat, desc, body, extra) => {
  const { code, params } = parseParams(body);
  return { name, cat, desc, body: body.trim() + '\n', frag: COMMON + code, params, ...extra };
};

export const CATEGORIES = ['Fractal', 'Tunnel & 3D', 'Geometric', 'Organic', 'Spectrum', 'Space', 'Media'];

export const SCENES = [
  scene('Kaleido Fractal', 'Fractal', 'Eightfold mirrored inversion fractal', KALEIDO),
  scene('Hyper Tunnel', 'Tunnel & 3D', 'Endless twisting tiled tunnel', TUNNEL),
  scene('Mandala Bloom', 'Geometric', 'Petals and rings that bloom with the mids', MANDALA),
  scene('Liquid Plasma', 'Organic', 'Domain-warped noise that flows like ink', PLASMA),
  scene('Gyroid Cave', 'Tunnel & 3D', 'Flight through a gyroid surface', GYROID),
  scene('Wave Orbits', 'Spectrum', 'Rings shaped by the waveform', ORBITS),
  scene('Julia Morph', 'Fractal', 'Julia set drifting along the Mandelbrot edge', JULIA),
  scene('Voronoi Glass', 'Geometric', 'Stained-glass cells that flash on the beat', VORONOI),
  scene('Hex Pulse', 'Geometric', 'Hexagon grid pulsing with the spectrum', HEX),
  scene('Neon Loop', 'Fractal', 'Repeated space folding with neon glow', NEON_LOOP, { trails: 0.45 }),   // fine, fast detail ghosts badly with long trails
  scene('Star Nest', 'Space', 'Volumetric flight through a Kali fractal', STAR_NEST),
  scene('Neon Jacks', 'Tunnel & 3D', 'Spinning glowing crosses in an endless grid', NEON_JACKS),
  scene('Liquid Blobs', 'Organic', 'Iridescent metaballs that melt with the bass', BLOBS),
  scene('Aurora Veil', 'Organic', 'Northern lights over a mountain ridge', AURORA, { trails: 0.5 }),
  scene('Radial EQ', 'Spectrum', 'Circular spectrum analyser with a waveform ring', RADIAL_EQ, { trails: 0.45 }),
  scene('Oscilloscope', 'Spectrum', 'Phosphor traces and an XY Lissajous figure', SCOPE, { trails: 0.6 }),
  scene('Truchet Weave', 'Geometric', 'Random arcs that join into winding neon tubes', TRUCHET, { trails: 0.55 }),
  scene('Moiré Bloom', 'Geometric', 'Op-art interference of drifting ring sets', MOIRE, { trails: 0.5 }),
  scene('Hyperspace', 'Space', 'Star streaks at light speed', HYPERSPACE),
  scene('Menger Halls', 'Tunnel & 3D', 'Flight through an endless Menger sponge', MENGER),
  scene('Flower of Life', 'Geometric', 'Sacred-geometry circles, coloured by overlap', FLOWER),
  scene('Quasicrystal', 'Geometric', 'Seven interfering waves with Penrose-like order', QUASI, { trails: 0.5 }),
  scene('Tumbling Blocks', 'Geometric', 'Isometric cubes that flip inside-out in waves', BLOCKS, { trails: 0.4 }),
  scene('Polygon Tunnel', 'Geometric', 'Endless zoom through twisting squares and triangles', POLY_TUNNEL),
  scene('Op Art Lens', 'Geometric', 'Vasarely-style checkerboard bulged by orbiting lenses', VASARELY, { trails: 0.35 }),
  scene('Tesseract', 'Geometric', 'A 4D hypercube turning through the fourth dimension', TESSERACT, { trails: 0.6 }),
  scene('Spirograph', 'Geometric', 'Morphing hypotrochoid, coloured along its path', SPIRO, { trails: 0.6 }),
  scene('Lissajous Knot', 'Geometric', 'Two sine waves tracing a closed knot', LISSAJOUS, { trails: 0.6 }),
  scene('Mirror Kaleidoscope', 'Geometric', 'Kaleidoscope with adjustable mirrors over flowing noise', MIRROR_KALEIDO, { trails: 0.5 }),
  scene('Retro Plasma', 'Organic', 'Demoscene sine plasma in your own colours', RETRO_PLASMA, { trails: 0.4 }),
  scene('Starfield', 'Space', 'Layered stars flying to a movable vanishing point', STARFIELD, { trails: 0.5 }),
  scene('Sunburst', 'Geometric', 'Rotating rays from a movable centre', SUNBURST, { trails: 0.5 }),
  scene('Lava Lamp', 'Organic', 'Metaballs that drift and merge like wax', LAVA_LAMP, { trails: 0.45 }),
  scene('Media Kaleidoscope', 'Media', 'Your image or video in a kaleidoscope', MEDIA_KALEIDO, { trails: 0.3 }),
  scene('Media Liquid', 'Media', 'Your image or video flowing like liquid', MEDIA_LIQUID, { trails: 0.3 }),
  scene('Media Glitch', 'Media', 'Datamosh-style glitches that burst on the beat', MEDIA_GLITCH, { trails: 0.2 }),
  scene('Media Halftone', 'Media', 'Print-style halftone dots', MEDIA_HALFTONE, { trails: 0.2 }),
  scene('Media Ripple', 'Media', 'Water ripples spreading over your picture', MEDIA_RIPPLE, { trails: 0.3 }),
  scene('Media Droste', 'Media', 'Endless zoom into copies of your picture', MEDIA_DROSTE, { trails: 0.3 }),
  scene('Media Neon Edges', 'Media', 'The outlines of your picture as glowing neon', MEDIA_EDGES, { trails: 0.5 }),
  scene('Beat Racer', 'Game', 'Dodge walls that drop on the beat', GAME, { kind: 'game', trails: 0.55 }),
];

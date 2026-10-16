import { scene } from './scene';

// A wireframe polyhedron drawn with beams, turning in perspective. Every 4 ticks it becomes the next
// solid (tetrahedron, cube, octahedron, icosahedron), a spark runs from vertex to vertex on each tick,
// it swells with the bass, and on a kick its front edges flare while the back ones stay as they were.
const BODY = /* glsl */ `
// @group Solid
const float SIZE = .3;       // @param min=.1 max=.48 label="Size (swells with the bass)"
const float SPIN = .4;       // @param min=0 max=2 label="Spin speed"
const float DEPTH = .35;     // @param min=0 max=.6 label="Perspective"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Beam width (px)"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

const float PHI = 1.61803399;

// Vertex i of solid s (0 tetrahedron, 1 cube, 2 octahedron, 3 icosahedron), on the unit sphere.
vec3 vert(int s, int i) {
  if (s == 0) {
    vec3 v = i == 0 ? vec3(1.) : i == 1 ? vec3(1., -1., -1.) : i == 2 ? vec3(-1., 1., -1.) : vec3(-1., -1., 1.);
    return v / sqrt(3.);
  }
  if (s == 1) return (vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1) * 2. - 1.) / sqrt(3.);
  if (s == 2) { vec3 v = vec3(0.); v[i >> 1] = (i & 1) == 0 ? 1. : -1.; return v; }
  vec2 c = vec2((i & 1) == 0 ? 1. : -1., (i & 2) == 0 ? PHI : -PHI);    // (0, ±1, ±φ), cyclic
  int k = i >> 2;
  vec3 v = k == 0 ? vec3(0., c) : k == 1 ? vec3(c, 0.) : vec3(c.y, 0., c.x);
  return v / sqrt(1. + PHI * PHI);
}
int count(int s) { return s == 0 ? 4 : s == 1 ? 8 : s == 2 ? 6 : 12; }
int edges(int s) { return s == 0 ? 6 : s == 3 ? 30 : 12; }
// The edge length on the unit sphere: two vertices this far apart share an edge.
float edgeLen(int s) { return s == 0 ? 1.633 : s == 1 ? 1.1547 : s == 2 ? 1.4142 : 1.0515; }

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.));
}

void main() {
  vec2 p = centered();
  float px = onePixel();
  int s = int(mod(floor(uTicks / 4.), 4.));
  int n = count(s);
  float L = edgeLen(s);

  float t = uTime * SPIN;
  float ca = cos(t), sa = sin(t), cb = cos(t * .63 + .8), sb = sin(t * .63 + .8);
  mat3 m = mat3(ca, 0., -sa, 0., 1., 0., sa, 0., ca) * mat3(1., 0., 0., 0., cb, sb, 0., -sb, cb);
  float size = SIZE * (.85 + .3 * min(uBass, 1.2)) * (1. + .12 * tickFlash() * step(mod(uTicks, 4.), .5));

  vec3 col = vec3(0.);
  if (length(p) > size / (1. - DEPTH) + 40. * px) { fragColor = vec4(col, 1.); return; }

  vec3 v3[12];
  vec2 v2[12];
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    vec3 v = m * vert(s, i);
    v3[i] = v;
    v2[i] = v.xy * size / (1. + DEPTH * v.z);
  }

  float spark = mod(uTicks, float(n));
  float w = WIDTH * px;
  int e = 0;
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    for (int j = i + 1; j < 12; j++) {
      if (j >= n) break;
      if (abs(distance(v3[i], v3[j]) - L) > .02) continue;
      float z = .5 * (v3[i].z + v3[j].z);              // −1 front … 1 back
      float front = smoothstep(.15, -.15, z);
      float f = float(e) / float(edges(s));
      float level = (.45 + 1.2 * spec(.08 + .6 * f)) * mix(1., .45, smoothstep(-1., 1., z));
      float flare = uBeat * FLARE * front;
      level += 2.2 * flare;
      vec3 c = mix(rainbow(uHue + (f - .5) * .1), vec3(1.), .5 * flare);
      col += c * beam(segment(p, v2[i], v2[j]), w) * level;
      e++;
    }
  }
  // The tick spark: a hot point on one vertex that fades through the tick.
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float hot = float(i) == spark ? 1.8 * tickFlash() : 0.;
    col += rainbow(uHue + .05) * beam(length(p - v2[i]), 2.5 * w) * (.35 + hot);
  }
  fragColor = vec4(col, 1.);
}
`;

export const WIRE_SOLID = scene('Wire Solid', 'Geometry', 'A rotating wireframe polyhedron of beams: a new solid every 4 ticks, edges flare on kicks', BODY);

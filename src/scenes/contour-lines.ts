import { scene } from './scene';

// Glowing contour lines over a slowly drifting island of terrain, like a laser-drawn map. The bass
// raises the land, so its contours swell outwards; on every tick the lines step one level uphill, and a
// kick lights the level the step lands on. The sea around the island is pure black.
const BODY = /* glsl */ `
// @group Terrain
const float LEVELS = 9.;     // @param min=3 max=20 int label="Contour levels"
const float ROUGH = .55;     // @param min=0 max=1 label="Roughness"
const float DRIFT = .06;     // @param min=0 max=.4 label="Drift speed"
const float LIFT = .5;       // @param min=0 max=1 label="Bass lift"
// @group Look
const float WIDTH = 1.6;     // @param min=1 max=5 label="Line width (px)"
const float KICK = .8;       // @param min=0 max=1 label="Kick flash"

void main() {
  vec2 p = centered();
  float px = 1. / uRes.y;

  // An island: a broad hill, roughened by drifting noise, that falls below sea level (0) before the edges.
  float hill = 1. - 1.75 * length(p * vec2(.8, 1.25));
  vec2 w = p * 2.6 + vec2(uTime * DRIFT, -uTime * DRIFT * .6);
  float h = (hill + ROUGH * (fbm(w) - .5)) * (.75 + LIFT * .5 * min(uBass, 1.5));

  // The contours climb a quarter of a level on each tick: quickly at its start, then they rest.
  float climb = (uTicks + smoothstep(0., .3, uTick)) * .25;
  float t = h * LEVELS - climb;
  float k = floor(t + .5);                                 // the nearest contour
  float grad = max(length(vec2(dFdx(t), dFdy(t))), 1e-4);  // contours per pixel
  float d = abs(t - k) / grad * px;                        // distance to it, in centered units

  float hk = (k + climb) / LEVELS;                         // the height this contour sits at
  float land = smoothstep(-.03, .03, hk);                  // only on the island: the sea stays black
  float f = clamp(hk, 0., 1.);                             // 0 = shore … 1 = summit
  float lit = .4 + 1.2 * spec(.03 + .45 * f);              // calm but lit when quiet
  float landed = mod(k, 3.) == mod(uTicks, 3.) ? 1. : 0.;  // a kick lights every third contour, turning with the tick
  lit += uBeat * KICK * (1.4 * landed + .25);

  vec3 c = mix(rainbow(uHue + (f - .5) * .12), vec3(1.), .35 * uBeat * KICK * landed);
  vec3 col = c * beam(d, WIDTH * px) * lit * land;
  fragColor = vec4(col, 1.);
}
`;

export const CONTOUR_LINES = scene('Contour Lines', 'Fields', 'Glowing contour lines over a slowly drifting terrain: the bass lifts it, the lines step uphill on each tick', BODY);

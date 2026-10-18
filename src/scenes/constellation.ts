import { scene } from './scene';

// A drifting field of laser stars, linked by thin lines to their near neighbours. The bass stretches the
// links so more stars join up, the treble makes them twinkle, a kick flares half of them, and on every
// tick a new handful of links lights up: a constellation drawn for one beat. It fades out before the
// edges of the frame.
//
// One star wanders inside each cell of a grid, so a pixel only looks at the 3×3 cells around it, and
// links only join stars in neighbouring cells: every link then lies in cells that see both its ends.
const BODY = /* glsl */ `
// @group Stars
const float DENSITY = 7.;    // @param min=4 max=12 int label="Stars (cells across the height)"
const float LINK = .9;       // @param min=.5 max=1.4 label="Link reach (stretches with the bass)"
const float DRIFT = .2;      // @param min=0 max=1 label="Drift speed"
// @group Look
const float WIDTH = 1.5;     // @param min=.75 max=4 label="Line width (px)"
const float STAR = 3.;       // @param min=1 max=8 label="Star size (px)"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

vec2 star(vec2 cell) {
  float h = hash(cell), h2 = hash(cell + 17.3);
  float t = uTime * DRIFT * (.5 + h);
  return cell + .5 + .32 * vec2(sin(t + h * TAU), cos(t * .8 + h2 * TAU));
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0., 1.));
}

void main() {
  vec2 p = centered();
  float px = onePixel();
  vec2 g = p * DENSITY;
  vec2 c0 = floor(g);

  vec2 cell[9];
  vec2 pos[9];
  for (int k = 0; k < 9; k++) {
    cell[k] = c0 + vec2(k % 3 - 1, k / 3 - 1);
    pos[k] = star(cell[k]);
  }

  float reach = LINK * (.8 + .35 * min(uBass, 1.2));
  float flash = tickFlash();
  vec3 col = vec3(0.);
  for (int i = 0; i < 9; i++) {
    for (int j = i + 1; j < 9; j++) {
      vec2 dc = abs(cell[i] - cell[j]);
      if (max(dc.x, dc.y) > 1.5) continue;              // neighbouring cells only
      float len = distance(pos[i], pos[j]);
      if (len > reach) continue;
      float fade = smoothstep(reach, reach * .6, len);
      vec2 id = cell[i] + cell[j];                      // the same for the pair either way round
      float h = hash(id * .37 + 3.1);
      float chosen = step(.82, hash(id * .53 + vec2(uTicks * 1.7, uTicks * .31)));
      float level = (.3 + .9 * spec(.05 + .45 * h) + 1.6 * chosen * flash) * fade;
      vec3 c = mix(laser(uHue + (h - .5) * .1), vec3(1.), .4 * chosen * flash);
      col += c * beam(segment(g, pos[i], pos[j]) / DENSITY, WIDTH * px) * level;
    }
  }
  for (int k = 0; k < 9; k++) {
    float h = hash(cell[k] + 5.7);
    float twinkle = spec(.5 + .45 * h) * (.6 + .4 * sin(uTime * 3. + h * TAU));
    float kicked = uBeat * FLARE * step(.5, h);
    float level = .6 + 1.4 * twinkle + 2. * kicked;
    vec3 c = mix(laser(uHue + .04), vec3(1.), .5 * kicked + .2);
    col += c * beam(length(g - pos[k]) / DENSITY, STAR * px) * level;
  }

  // Fade out before the frame's edges: the border stays pure black.
  float edge = min(.5 * uRes.x / uRes.y - abs(p.x), .5 - abs(p.y));
  col *= smoothstep(.02, .09, edge);
  fragColor = vec4(col, 1.);
}
`;

export const CONSTELLATION = scene('Constellation', 'Geometry', 'Drifting laser stars linked to their neighbours: the bass stretches the links, each tick lights a new constellation', BODY);

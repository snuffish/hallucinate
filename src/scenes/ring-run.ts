import { scene } from './scene';

// Thin polygon rings flying towards the viewer: a new ring is born at the centre on every tick and
// grows outwards, fading before it reaches the edges. The rings glow with the spectrum (newest =
// treble, oldest = bass), flare on kicks, and twist slowly even when the music stops.
//
// Ring k was born on tick k, so at s = uTicks + uTick it is (s - k) ticks old and its apothem is
// START · e^(SPEED · age). That makes the ring nearest a pixel found in one step from the pixel's
// radius, and only it and its neighbours are drawn.
const BODY = /* glsl */ `
// @group Rings
const float SIDES = 6.;      // @param min=3 max=12 int label="Polygon sides"
const float SPEED = .45;     // @param min=.15 max=1.2 label="Ring speed (growth per tick)"
const float TWIST = .12;     // @param min=0 max=.6 label="Twist between rings"
const float SPIN = .15;      // @param min=0 max=1 label="Spin speed"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Line width (px)"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

const float START = .025;    // a newborn ring's apothem
const float FADE = .3;       // rings start fading at this apothem ...
const float GONE = .62;      // ... and are gone by this one, before they light the edges

void main() {
  vec2 p = centered();
  float px = onePixel();
  float r = max(length(p), 1e-4);
  float a = atan(p.y, p.x);
  float s = uTicks + uTick;
  float sector = TAU / SIDES;
  float flare = uBeat * FLARE;

  // The age of a ring whose corners pass through p; its edges pass at most a few ticks younger.
  float k0 = floor(s - log(r / START) / SPEED);

  vec3 col = vec3(0.);
  for (float j = -1.; j <= 2.; j++) {
    float k = k0 + j;
    float age = s - k;
    if (age < 0.) continue;
    float R = START * exp(SPEED * age);
    if (R > GONE) continue;
    float t = a - k * TWIST - uTime * SPIN;
    float apo = r * cos(mod(t + sector * .5, sector) - sector * .5);   // p's distance to the edge's line
    float f = clamp(log(R / START) / log(GONE / START), 0., 1.);        // 0 newborn … 1 leaving
    float level = .4 + 1.3 * spec(.75 - .7 * f);                       // calm but lit when quiet
    level += 1.6 * max(1. - age, 0.) * max(1. - age, 0.);               // the tick: a bright birth
    level += 1.8 * flare * (1. - .6 * f);                               // the kick flares the inner rings most
    level *= smoothstep(GONE, FADE, R) * smoothstep(0., .4, age);
    vec3 c = mix(rainbow(uHue + (fract(k * .618) - .5) * .1), vec3(1.), .5 * flare);
    col += c * beam(apo - R, WIDTH * px) * level;
  }
  fragColor = vec4(col, 1.);
}
`;

export const RING_RUN = scene('Ring Run', 'Geometry', 'Thin polygon rings flying towards you: a new ring on every tick, glowing with the spectrum and flaring on kicks', BODY);

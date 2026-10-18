import { scene } from './scene';

// The music's waveform wrapped round a circle, like a scope in polar mode, with its spectrum as a
// closed outline inside it (bass at the top, treble at the bottom, mirrored left and right). On every
// tick an echo of the waveform ring leaves it and fades as it grows outwards; a kick flares the outer
// ring. The rings turn slowly, a little further on each tick.
//
// Each ring is a radius r = f(angle): the distance to it is (r - f) over the slope's stretch, so the
// line keeps its width where the waveform is steep.
const BODY = /* glsl */ `
// @group Rings
const float RADIUS = .22;    // @param min=.12 max=.28 label="Radius (swells with the bass)"
const float AMP = .1;        // @param min=0 max=.14 label="Waveform height"
const float SPIN = .1;       // @param min=0 max=1 label="Spin speed"
const float ECHO = .8;       // @param min=0 max=1 label="Tick echo"
// @group Look
const float WIDTH = 2.;      // @param min=1 max=6 label="Line width (px)"
const float FLARE = .8;      // @param min=0 max=1 label="Kick flare"

const float E = TAU / 512.;

// m: 0 at the top … 1 at the bottom, either way round, so both curves close.
float outerAt(float a, float R) { float m = abs(fract(a / TAU) * 2. - 1.); return R + AMP * wave(m); }
float innerAt(float a, float R) {
  float m = abs(fract(a / TAU) * 2. - 1.), x = .03 + .6 * m;
  return R * .5 + R * .45 * (spec(x - .006) + spec(x) + spec(x + .006)) / 3.;   // smoothed a little
}

// The slope's stretch is capped: where the curve jumps, an uncapped one would draw a streak to the centre.
float ringDist(float r, float f, float f1, float f0) {
  float s = min(abs(f1 - f0) / (2. * E) / max(r, 1e-2), 4.);
  return (r - f) / sqrt(1. + s * s);
}

void main() {
  vec2 p = centered();
  float px = onePixel();
  float r = length(p);
  float turn = uTime * SPIN + easedTicks() * TAU / 32.;
  float a = atan(p.x, p.y) - turn;            // 0 = straight up
  float R = RADIUS * (.9 + .2 * min(uBass, 1.2));
  float flare = uBeat * FLARE;
  float w = WIDTH * px;

  vec3 col = vec3(0.);
  if (r > R + AMP + .25) { fragColor = vec4(col, 1.); return; }

  float fo = outerAt(a, R);
  float d = ringDist(r, fo, outerAt(a + E, R), outerAt(a - E, R));
  float level = .5 + 1.2 * min(uLevel, 1.2) + 2.2 * flare;
  col += mix(laser(uHue), vec3(1.), .5 * flare) * beam(d, w) * level;

  float fi = innerAt(a, R);
  float di = ringDist(r, fi, innerAt(a + E, R), innerAt(a - E, R));
  col += laser(uHue + .12) * beam(di, w) * (.45 + 1.1 * spec(.05));

  // The tick's echo: the waveform ring, growing outwards and fading before the edges.
  float reach = max(.44 - R - AMP, .03);
  float grow = reach * sqrt(uTick);
  float de = ringDist(r - grow, fo, outerAt(a + E, R), outerAt(a - E, R));
  col += laser(uHue - .08) * beam(de, w) * ECHO * 1.6 * tickFlash() * smoothstep(1., .2, uTick);
  fragColor = vec4(col, 1.);
}
`;

export const SCOPE_RING = scene('Scope Ring', 'Signals', "The waveform wrapped round a circle with the spectrum inside it: an echo leaves on each tick, the ring flares on kicks", BODY);

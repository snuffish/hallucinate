import { scene } from './scene';

// The dropped video or camera redrawn as horizontal laser scan lines, each pushed up by the brightness
// of the picture beneath it. A scan beam runs down the lines through every tick, a kick flashes every
// third line (a different third each tick) and pushes the picture higher. With nothing loaded the
// lines lie flat on black.
const BODY = /* glsl */ `
// @group Lines
const float LINES = 32.;     // @param min=12 max=90 int label="Scan lines"
const float PUSH = .07;      // @param min=0 max=.2 label="Push (brightness → height)"
const float WIDTH = 1.6;     // @param min=1 max=5 label="Line width (px)"
// @group Rhythm
const float SCAN = 1.;       // @param min=0 max=2 label="Tick scan"
const float FLASH = .8;      // @param min=0 max=1 label="Kick flash"

const float SPAN = .8;       // the lines cover the middle of the frame, top to bottom

// How far the picture pushes a line up at x: none without media, so the lines lie flat.
float height(float x, float y, float push) {
  if (uHasMedia < .5) return 0.;
  return push * luma(media(vec2(x, y)));
}

void main() {
  vec2 p = centered();
  float px = onePixel();
  float halfW = .5 * uRes.x / uRes.y;
  float fade = smoothstep(halfW - .02, halfW - .14, abs(p.x));   // lines end before the side edges
  if (fade <= 0.) { fragColor = vec4(0., 0., 0., 1.); return; }

  float gap = SPAN / max(LINES - 1., 1.);
  float y0 = -.5 * SPAN;
  float push = PUSH * (.6 + .6 * min(uBass, 1.5) + .5 * uBeat);
  float scanY = .5 * SPAN - uTick * SPAN;                          // the scan beam runs down through the tick
  float lit = mod(uTicks, 3.);                                     // the third of the lines a kick flashes
  float shimmer = .85 + .15 * sin(p.x * 7. - uTime * .9);

  // The lines that can reach this pixel: from those pushed up from below to the one just above.
  float first = floor((p.y - push - y0) / gap) - 1.;
  vec3 col = vec3(0.);
  for (int k = 0; k < 16; k++) {
    float i = first + float(k);
    if (i > LINES - 1.) break;
    if (i < 0.) continue;
    float base = y0 + i * gap;
    if (base > p.y + 4. * WIDTH * px) break;
    float h = height(p.x, base, push);
    float slope = (height(p.x + 2. * px, base, push) - h) / (2. * px);
    float d = (p.y - base - h) / sqrt(1. + slope * slope);
    float f = i / max(LINES - 1., 1.);
    float level = (.35 + 1.1 * spec(.03 + .6 * f)) * shimmer;      // calm but lit when quiet; low lines hear the bass
    level *= .6 + .8 * h / max(push, 1e-4);                        // bright picture, bright line
    level += SCAN * 1.4 * exp(-abs(base - scanY) / (2. * gap));    // the tick scan
    level += mod(i, 3.) == lit ? 2.2 * FLASH * uBeat : 0.;         // the kick, on a third of the lines
    col += laser(uHue + (f - .5) * .1) * beam(d, WIDTH * px) * level;
  }
  fragColor = vec4(col * fade, 1.);
}
`;

export const SCAN_TRACE = scene('Scan Trace', 'Media', 'Your video or camera as laser scan lines, each pushed up by the brightness beneath it', BODY);

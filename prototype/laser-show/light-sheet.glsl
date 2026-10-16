// Light Sheet: PROTOTYPE for the laser-show direction. Throwaway; see NOTES.md next to this file.
// The "laser ceiling": a thin sheet of light overhead, drawn as scan lines receding to the horizon, seen
// through haze. It ripples with the spectrum (near lines = bass, far lines = treble), dips on kicks,
// and a bright front runs from near to far on every tick.

// @group Sheet
const float LINES = 28.;     // @param min=8 max=48 int label="Scan lines"
const float HEIGHT = .28;    // @param min=.08 max=.6 label="Sheet height"
const float RIPPLE = 1.;     // @param min=0 max=2.5 label="Ripple (spectrum)"
// @group Look
const float WIDTH = 1.5;     // @param min=.75 max=5 label="Line width (px)"
const float HAZE = .35;      // @param min=0 max=1 label="Haze"
// @group Prototype
const float BPM = 124.;      // @param min=60 max=180 int label="Fake tempo (until uTick exists)"

// Ticks: x = 0→1 through the current tick, y = tick count. Faked from a constant tempo for now.
vec2 ticks() { float t = uTime * BPM / 60.; return vec2(fract(t), floor(t)); }   // later: return vec2(uTick, uTicks);

// A thin luminous line at distance d: a hard core w wide plus a short halo. Never lights the whole frame.
float beam(float d, float w) { d = abs(d); return 1. - smoothstep(w * .35, w, d) + .45 * exp(-d / (w * 3.)); }

void main() {
  vec2 p = centered();
  float px = 1. / uRes.y;
  vec2 tk = ticks();
  p *= rot(sin(uTime * .11) * .04);          // a slow roll, as if the room breathes

  const float HORIZON = -.18, FOCAL = 1.;
  float h0 = HEIGHT * (1. - .25 * uBeat);    // the sheet drops a little on each kick
  vec3 c = rainbow(uHue);
  vec3 col = vec3(0.);

  for (float k = 0.; k < LINES; k++) {
    float f = (k + .5) / LINES;              // 0 near … 1 far
    float z = .5 + 9.5 * f * f;
    float xw = p.x * z / FOCAL;
    float amp = .15 + 1.5 * spec(mix(.03, .7, f));
    float ph = xw * 6. + z * 1.3 - uTime * 2.;
    float h = h0 + RIPPLE * .04 * amp * (sin(ph) + .4 * sin(ph * 2.3 + uTime));
    float slope = RIPPLE * .04 * amp * 6. * (cos(ph) + .92 * cos(ph * 2.3 + uTime));
    float d = (p.y - (HORIZON + FOCAL * h / z)) / sqrt(1. + slope * slope);
    float level = (.45 + 1.1 * amp) * exp(-z * .16);
    level += 1.4 * exp(-abs(f - tk.x) * 14.);                          // the tick front
    level *= 1. + .8 * uBeat;
    col += c * beam(d, WIDTH * px) * level;
  }

  // Haze: where each ray crosses the (flat) sheet, lit by noise; brightest towards the horizon, where
  // the ray runs longest through the sheet. Kept dim and never on the kick, so it can't wash the frame.
  float above = p.y - HORIZON;
  if (above > 0. && HAZE > 0.) {
    float zp = FOCAL * h0 / above;
    vec2 hp = vec2(p.x * zp / FOCAL, zp);
    float n = .6 * noise(hp * vec2(1.5, .8) - vec2(0., uTime * .25)) + .4 * noise(hp * vec2(3.4, 1.9) + uTime * .1);
    float path = min(1. / (above * 4. + .03), 8.);
    col += c * HAZE * .045 * n * n * path * exp(-zp * .12) * (.6 + .6 * min(uLevel, 1.));
  }
  fragColor = vec4(col, 1.);
}

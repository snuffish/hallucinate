import { INPUT_NAMES } from '../engine/scene-inputs';

// Starting point for your own scene in the shader editor.
export const TEMPLATE = /* glsl */ `// Your own scene. Edit me — it recompiles as you type.
// Available: ${INPUT_NAMES} uRes
//            spec(x) wave(x) laser(t) laserWheel(t) rainbow(t) neon(t) rot(a) noise(p) fbm(p) centered() onePixel() beam(d, w)
//            tickFlash() easedTicks()
// Lines tagged // @param get a live control in the Parameters overlay (P);
// a // @group line gives the ones after it a heading that folds.

// @group Shape
const float RINGS = 30.;                    // @param min=5 max=80 int
const float PETALS = 6.;                    // @param min=1 max=16 int label="Petals"
// @group Look
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

  vec3 col = laser(r + uTime * .1 + uHue) * shape * uTint;
  col *= (.4 + spec(r) * 2.) * uGlow;   // brighter where the spectrum is loud
  if (uCore) col += vec3(1.) * uBeat * .3 * smoothstep(.3, .0, r);
  fragColor = vec4(col, 1.);
}
`;

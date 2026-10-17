// The effect catalogue: every built-in effect, one row each. An effect is a step that reshapes a scene's
// picture before the Look (ADR 0003): its id and label, its settings (each with a range, step and
// default), any passes it runs first (Glow's blur), its picture step (GLSL that reads the picture with
// pick() and the same scene inputs the scene reads, so the Look's Reactivity scales its music movement
// the way it scales the scene, plus the effects' turn uTurn, which only ever runs on) and how it moves
// with the music. Everything that lists effects is made from this table: the Effects widget and its
// "Add effect" menu, the clean-up of a stored stack, the renderer's effect programs and the built-in
// scenes safety spec, which checks each effect alone at its strongest (the top of each range) and all of
// them stacked at their strongest. Adding an effect is one row here. Pure: the safety spec imports it in
// Node.

import { z } from 'zod';
import { INPUT_DECLARATIONS } from './scene-inputs';

export interface EffectSetting {
  readonly key: string;
  readonly label: string;
  readonly uniform: `u${string}`;   // what the picture step reads it as
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly options?: readonly string[];   // a choice: one label per whole number from min to max
}

// A pass an effect runs before its picture step, such as one direction of a blur. It renders at `scale`
// (a share of the picture's width and height: a blur needs less than all of it) and defines
// `vec3 pass(vec2 uv)`, reading its input with `pick(uv)`: the picture so far for the first pass, the
// pass before for the others. It sees the same uniforms as the picture step (uRes is the picture's size).
export interface EffectPass {
  readonly scale: number;
  readonly glsl: string;
}

export interface EffectDef {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly music: string;   // how it moves with the music
  readonly settings: readonly EffectSetting[];
  // Passes run first, in order (most effects need none); the picture step reads the last one's result
  // with `passed(uv)`.
  readonly passes?: readonly EffectPass[];
  // The picture step: defines `vec3 effect(vec2 uv)`, reading the picture with `pick(uv)`.
  readonly glsl: string;
}

// A Gaussian blur along `dir` (one axis), for Glow's two passes. Its reach is uRadius pixels of a
// 720-high picture, so it looks the same at any size; a tap every 2 of those pixels, which the half-size
// pass's linear sampling averages in between, so a thin line can't fall between two taps. Weights sum to
// 1: a blur of black is exactly black, so the glow can't light the background away from the lines.
const GLOW_BLUR = /* glsl */ `
vec3 blur(vec2 uv, vec2 dir) {
  float unit = min(uRes.x, uRes.y) / 720.;      // picture pixels per pixel of a 720-high picture
  vec2 tap = dir * 2. * unit / uRes;            // a tap every 2 of those, in uv
  float sigma = uRadius * .5;
  int n = int(ceil(uRadius * 1.25 / 2.));       // out to 2.5 sigma
  vec3 sum = vec3(0.);
  float total = 0.;
  for (int k = -n; k <= n; k++) {
    float x = float(k) * 2.;
    float w = exp(-x * x / (2. * sigma * sigma));
    sum += pick(uv + tap * float(k)) * w;
    total += w;
  }
  return sum / total;
}`;

export const EFFECTS = [
  {
    id: 'mirror',
    label: 'Mirror',
    help: 'Reflects one half of the picture onto the other: left onto right, top onto bottom, or both.',
    music: 'Holds still, so a reflection never flickers on the beat.',
    settings: [
      { key: 'axis', label: 'Axis', uniform: 'uAxis', min: 0, max: 2, step: 1, default: 0, options: ['Left ↔ right', 'Top ↕ bottom', 'Both'] },
    ],
    glsl: /* glsl */ `
vec3 effect(vec2 uv) {
  float axis = floor(uAxis + .5);
  if (axis != 1.) uv.x = .5 - abs(uv.x - .5);   // the left half, reflected onto the right
  if (axis != 0.) uv.y = .5 + abs(uv.y - .5);   // the top half (GL rows run bottom-up), onto the bottom, as in water
  return pick(uv);
}`,
  },
  {
    id: 'kaleidoscope',
    label: 'Kaleidoscope',
    help: 'Folds the picture into segments around the centre, every other one mirrored, and turns the whole mandala.',
    music: 'Turns steadily, faster with the bass, and each kick sends it a step further on; it never turns back. At spin speed 0 it holds still.',
    settings: [
      { key: 'segments', label: 'Segments', uniform: 'uSegments', min: 3, max: 12, step: 1, default: 6 },
      { key: 'spin', label: 'Spin speed', uniform: 'uSpin', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    glsl: /* glsl */ `
vec3 effect(vec2 uv) {
  float side = min(uRes.x, uRes.y);
  vec2 p = (uv - .5) * uRes / side;            // from the centre, in shares of the short side
  float seg = TAU / floor(uSegments + .5);
  // The effects' turn: it runs on, faster with the bass and a step with each kick, and never back (the
  // bass or the beat read here directly would spring it back as they fall). Spin speed scales it, so at 0
  // the mandala holds still.
  float a = mod(atan(p.y, p.x) - uSpin * uTurn, seg);
  a = min(a, seg - a);                          // every other segment mirrored, so neighbours meet without a seam
  a += PI * .5 - seg * .25;                     // each segment shows the wedge just above the centre
  vec2 q = .5 + length(p) * vec2(cos(a), sin(a)) * side / uRes;
  if (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) return vec3(0.);   // past the picture: dark, never a smeared edge
  return pick(q);
}`,
  },
  {
    id: 'glow',
    label: 'Glow',
    help: 'A soft bloom of light around the lines: Strength sets how bright, Radius how far it spreads.',
    music: 'Swells with the bass, and gives way to each kick: the halo dips while the lines flash and blooms back after.',
    settings: [
      { key: 'strength', label: 'Strength', uniform: 'uStrength', min: 0, max: 1.5, step: 0.05, default: 0.8 },
      { key: 'radius', label: 'Radius', uniform: 'uRadius', min: 2, max: 24, step: 1, default: 10 },
    ],
    // The blur, at half size (a bloom is soft, and a quarter of the pixels costs a quarter as much):
    // across, from the picture, then down, from that.
    passes: [
      { scale: 0.5, glsl: `${GLOW_BLUR}\nvec3 pass(vec2 uv) { return blur(uv, vec2(1., 0.)); }` },
      { scale: 0.5, glsl: `${GLOW_BLUR}\nvec3 pass(vec2 uv) { return blur(uv, vec2(0., 1.)); }` },
    ],
    // The blurred lines, added to the picture. A thin line's blur is faint, and fainter the wider it
    // spreads, so it is lifted in proportion to the radius and then eased towards 1 (1 - e^-x): a line's
    // halo gets about as bright at any radius, and a filled area can gain no more than Strength. The bass
    // swells it by up to half again. A kick ducks it (gone at a full beat, back as the beat fades): on a
    // kick the scene's lines flash and move, and a halo following them at once would light a wide band
    // around every line that moved, doubling far more of the frame than the scene does alone (Point
    // Storm: 38%, against the strobe rule's 25%). Ducked, a kick with a Glow doubles no more of the frame
    // than without it, at any strength or radius.
    glsl: /* glsl */ `
vec3 effect(vec2 uv) {
  vec3 halo = 1. - exp(-passed(uv) * uRadius * .6);
  float swell = (1. + .5 * min(uBass, 1.)) * (1. - min(uBeat, 1.));
  return pick(uv) + halo * uStrength * swell;
}`,
    },
    {
    id: 'wave',
    label: 'Wave',
    help: 'Ripples and bends the picture: Amount sets how far it bends, Wavelength how far apart the ripples are.',
    music: 'A ripple runs outward from the centre on each kick.',
    settings: [
      { key: 'amount', label: 'Amount', uniform: 'uAmount', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'wavelength', label: 'Wavelength', uniform: 'uWavelength', min: 0.1, max: 1, step: 0.01, default: 0.4 },
    ],
    // Distances are shares of the short side. The bend is a share of the wavelength, so at any setting it
    // stays a bend and never folds the picture over onto itself: the most it moves the picture is at the
    // top of both ranges, where the safety spec checks it.
    glsl: /* glsl */ `
vec3 effect(vec2 uv) {
  float side = min(uRes.x, uRes.y);
  vec2 p = (uv - .5) * uRes / side;   // from the centre
  float k = TAU / uWavelength;
  float reach = .08 * uAmount * uWavelength;
  // The bend: two slow waves across each other, carried along by the music's clock.
  vec2 bend = vec2(sin(p.y * k + uTime * 1.3), sin(p.x * k * .8 - uTime * 1.1));
  // The kick ripple: a ring that starts at the centre on a kick and runs outward as the kick fades
  // (uBeat falls from 1 to 0 within half a second), pushing the picture to and fro along its radius.
  float r = length(p);
  float front = (1. - uBeat) * 1.1;
  float ring = uBeat * exp(-pow((r - front) / (.35 * uWavelength), 2.));
  vec2 ripple = (r > 1e-4 ? p / r : vec2(0.)) * sin((r - front) * k) * ring;
  return pick(uv + (bend + ripple) * reach * side / uRes);
}`,
  },
] as const satisfies readonly EffectDef[];

// The edge fade, in shares of the picture's short side, so it holds at any size. Defined here once, read by
// the renderer (which fades every effect) and the built-in scenes safety spec (which measures the band).
//   EDGE_BAND   the border band the safety spec measures: at least 75% pure black in silence (ADR 0002).
//   EDGE_CLEAR  how far in from the edge effects leave the scene's own picture alone: the band and a margin
//               inside it, because the Look's fringing pulls colour a few pixels outward from inside.
//   EDGE_FULL   where effects run at full strength, after fading in over EDGE_FADE.
// The border keeps whatever the scene alone drew there, which the scenes' own safety checks already prove
// black enough, so no stack of effects can light it. The margin is derived from the band, so widening the
// band moves the fade with it; effects.test.ts checks the margin covers the strongest Look's fringing.
export const EDGE_BAND = 0.01;                      // 7 px at 720
const FRINGING_MARGIN = 0.015;                      // 11 px at 720
export const EDGE_CLEAR = EDGE_BAND + FRINGING_MARGIN;
export const EDGE_FADE = 0.05;                      // 36 px at 720
export const EDGE_FULL = EDGE_CLEAR + EDGE_FADE;

export type Effect = (typeof EFFECTS)[number];
export type EffectId = Effect['id'];

// One effect in a stack: which, whether it is switched on, and its settings by key.
export interface EffectEntry { readonly id: EffectId; readonly on: boolean; readonly settings: Readonly<Record<string, number>> }
// A show scene's effects, in the order they run; each effect at most once.
export type EffectStack = readonly EffectEntry[];

export const NO_EFFECTS: EffectStack = Object.freeze([]);

const BY_ID = new Map<string, EffectDef>(EFFECTS.map((e) => [e.id, e]));
export const effectDef = (id: string): EffectDef | undefined => BY_ID.get(id);
// The passes an effect runs before its picture step (none for most).
export const passesOf = (def: EffectDef): readonly EffectPass[] => def.passes ?? [];
// Every size a pass renders at, as a share of the picture: the renderer keeps targets for each.
export const PASS_SCALES: readonly number[] = [...new Set(EFFECTS.flatMap((e) => passesOf(e).map((p) => p.scale)))];

const decimals = (step: number): number => (String(step).split('.')[1] ?? '').length;

// A setting's value as the effect can take it: a number inside its range, on its step.
export function clampSetting(s: EffectSetting, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return s.default;
  const v = Math.min(s.max, Math.max(s.min, value));
  return Math.min(s.max, Number((s.min + Math.round((v - s.min) / s.step) * s.step).toFixed(decimals(s.step))));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// A stored stack, cleaned up: effects it doesn't know dropped, a duplicate dropped (the first kept), each
// setting clamped to its range and step, a missing one at its default, a missing on/off as on. Anything
// that isn't a list reads as no effects. Never throws: a damaged show can't produce an unsafe picture.
export function cleanStack(raw: unknown): EffectStack {
  if (!Array.isArray(raw)) return NO_EFFECTS;
  const stack: EffectEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const def = BY_ID.get(item.id);
    if (!def || stack.some((e) => e.id === def.id)) continue;
    const stored = isRecord(item.settings) ? item.settings : {};
    const settings = Object.fromEntries(def.settings.map((s) => [s.key, clampSetting(s, stored[s.key])]));
    stack.push({ id: def.id as EffectId, on: typeof item.on === 'boolean' ? item.on : true, settings });
  }
  return stack;
}

// A stored stack (the main screen's, a show scene's) as zod reads it: anything, cleaned up, so it never
// fails the value it sits in; missing reads as no effects (optional, or zod 4 refuses an object without
// the key before the clean-up runs).
export const EffectStackSchema: z.ZodType<EffectStack, unknown> = z.unknown().optional().transform(cleanStack);

const defaults = (def: EffectDef): Record<string, number> => Object.fromEntries(def.settings.map((s) => [s.key, s.default]));

// The edits the Effects widget makes. Each returns a new stack (the one given is never changed, so a
// captured stack never follows later edits), or the same one when nothing changes.

// The effects the "Add effect" menu offers: those not yet in the stack, in catalogue order.
export const effectsToAdd = (stack: EffectStack): readonly Effect[] => EFFECTS.filter((e) => !stack.some((x) => x.id === e.id));

export function addEffect(stack: EffectStack, id: EffectId): EffectStack {
  const def = BY_ID.get(id);
  if (!def || stack.some((e) => e.id === id)) return stack;
  return [...stack, { id, on: true, settings: defaults(def) }];
}

export const removeEffect = (stack: EffectStack, id: EffectId): EffectStack => stack.filter((e) => e.id !== id);

const update = (stack: EffectStack, id: EffectId, change: (e: EffectEntry) => EffectEntry): EffectStack => {
  const i = stack.findIndex((e) => e.id === id);
  if (i < 0) return stack;
  const next = change(stack[i]!);
  return next === stack[i] ? stack : stack.with(i, next);
};

export const setEffectOn = (stack: EffectStack, id: EffectId, on: boolean): EffectStack =>
  update(stack, id, (e) => (e.on === on ? e : { ...e, on }));

export const setEffectSetting = (stack: EffectStack, id: EffectId, key: string, value: number): EffectStack =>
  update(stack, id, (e) => {
    const s = BY_ID.get(id)?.settings.find((x) => x.key === key);
    if (!s) return e;
    const v = clampSetting(s, value);
    return e.settings[key] === v ? e : { ...e, settings: { ...e.settings, [key]: v } };
  });

// `id` moved to place `to` in the order (clamped to the stack).
export function moveEffect(stack: EffectStack, id: EffectId, to: number): EffectStack {
  const from = stack.findIndex((e) => e.id === id);
  if (from < 0) return stack;
  const rest = stack.filter((_, i) => i !== from);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, stack[from]!);
  return rest;
}

// An effect alone at its strongest: switched on, every setting at the top of its range. The built-in
// scenes safety spec checks each catalogue effect this way.
export function strongest(id: EffectId): EffectStack {
  const def = BY_ID.get(id)!;
  return [{ id, on: true, settings: Object.fromEntries(def.settings.map((s) => [s.key, s.max])) }];
}

const glslFloat = (x: number): string => (Number.isInteger(x) ? `${x}.` : String(x));

// An effect's picture step as a whole fragment shader. It reads the picture so far (uTex), the scene's own
// picture (uScene), the result of its own passes if it has any (uPassed), the scene inputs (the same
// uniforms, so the Look's Reactivity reaches its movement), the effects' turn (uTurn) and its settings, and blends back to the scene's
// own picture towards the edges (the edge fade). Each effect of a stack fades the same way, so however many
// run, the border shows the scene alone.
export function effectShader(def: EffectDef): string {
  return /* glsl */ `${header(def)}
uniform sampler2D uScene, uPassed;
vec3 passed(vec2 uv) { return texture(uPassed, uv).rgb; }
${def.glsl}

void main() {
  vec2 px = min(vUv, 1. - vUv) * uRes;
  float fromEdge = min(px.x, px.y) / min(uRes.x, uRes.y);
  float w = smoothstep(${glslFloat(EDGE_CLEAR)}, ${glslFloat(EDGE_FULL)}, fromEdge);
  vec3 scene = texture(uScene, vUv).rgb;
  fragColor = vec4(w > 0. ? mix(scene, effect(vUv), w) : scene, 1.);
}
`;
}

// One of an effect's passes as a whole fragment shader: the same uniforms as its picture step, and its
// input (uTex) read with pick(). No edge fade: the picture step that reads it fades.
export function passShader(def: EffectDef, pass: EffectPass): string {
  return /* glsl */ `${header(def)}
${pass.glsl}

void main() { fragColor = vec4(pass(vUv), 1.); }
`;
}

function header(def: EffectDef): string {
  return /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
${INPUT_DECLARATIONS}
uniform float uTurn;    // the effects' turn: runs on, faster with the bass and a step each kick, never back (radians, counting up)
${def.settings.map((s) => `uniform float ${s.uniform};   // ${s.label}`).join('\n')}
#define PI 3.14159265359
#define TAU 6.28318530718

vec3 pick(vec2 uv) { return texture(uTex, uv).rgb; }`;
}

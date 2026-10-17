// The effect catalogue: every built-in effect, one row each. An effect is a step that reshapes a scene's
// picture before the Look (ADR 0003): its id and label, its settings (each with a range, step and
// default), any passes it runs first (Glow's blur), its picture step (GLSL that reads the picture with
// pick() and the same scene inputs the scene reads, so the Look's Reactivity scales its music movement
// the way it scales the scene) and how it moves with the music. Everything that lists effects is made
// from this table: the Effects widget and its "Add effect" menu, the clean-up of a stored stack, the
// renderer's effect programs and the built-in scenes safety spec, which checks each effect alone at its
// strongest (the top of each range). Adding an effect is one row here. Pure: the safety spec imports it
// in Node.

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
] as const satisfies readonly EffectDef[];

// The edge fade, in shares of the picture's short side, so it holds at any size. The border band is what
// the safety spec measures (ADR 0002: at least 75% pure black in silence). Effects leave the scene's own
// picture alone across the band and a margin inside it, EDGE_CLEAR from the edge, because Fringing pulls
// colour a few pixels outward from inside; then they fade in over EDGE_FADE. The border keeps whatever the
// scene alone drew there, which the scenes' own safety checks already prove black enough, so no stack of
// effects can light it.
export const EDGE_BAND = 0.01;    // 7 px at 720
export const EDGE_CLEAR = 0.025;  // 18 px at 720
export const EDGE_FADE = 0.05;    // 36 px at 720

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
// fails the value it sits in; missing reads as no effects.
export const EffectStackSchema: z.ZodType<EffectStack, unknown> = z.unknown().transform(cleanStack);

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
// uniforms, so the Look's Reactivity reaches its movement) and its settings, and blends back to the scene's
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
  float w = smoothstep(${glslFloat(EDGE_CLEAR)}, ${glslFloat(EDGE_CLEAR + EDGE_FADE)}, fromEdge);
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
${def.settings.map((s) => `uniform float ${s.uniform};   // ${s.label}`).join('\n')}
#define PI 3.14159265359
#define TAU 6.28318530718

vec3 pick(vec2 uv) { return texture(uTex, uv).rgb; }`;
}

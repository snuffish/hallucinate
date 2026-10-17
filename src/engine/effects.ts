// The effect catalogue: every built-in effect, one row each. An effect is a step that reshapes a scene's
// picture before the Look (ADR 0003): its id and label, its settings (each with a range, step and
// default), its picture step (GLSL that reads the picture with pick() and the same scene inputs the scene
// reads, so the Look's Reactivity scales its music movement the way it scales the scene) and how it moves
// with the music. Everything that lists effects is made from this table: the Effects widget and its "Add
// effect" menu, the clean-up of a stored stack, the renderer's effect programs and the built-in scenes
// safety spec, which checks each effect alone at its strongest (the top of each range). Adding an effect
// is one row here. Pure: the safety spec imports it in Node.

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

export interface EffectDef {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly music: string;   // how it moves with the music
  readonly settings: readonly EffectSetting[];
  // The picture step: defines `vec3 effect(vec2 uv)`, reading the picture with `pick(uv)`.
  readonly glsl: string;
}

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
    music: "Turns on the music's clock, which runs faster when the music is loud; the bass pushes the turn ahead and each kick jumps it on a step. At spin speed 0 it holds still.",
    settings: [
      { key: 'segments', label: 'Segments', uniform: 'uSegments', min: 3, max: 12, step: 1, default: 6 },
      { key: 'spin', label: 'Spin speed', uniform: 'uSpin', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    glsl: /* glsl */ `
vec3 effect(vec2 uv) {
  float side = min(uRes.x, uRes.y);
  vec2 p = (uv - .5) * uRes / side;            // from the centre, in shares of the short side
  float seg = TAU / floor(uSegments + .5);
  // The turn runs on the music's clock (faster when the music is loud), the bass pushes it ahead and a kick
  // jumps it on a step. Spin speed scales all three, so at 0 the mandala holds still.
  float turn = uSpin * (.3 * uTime + .25 * min(uBass, 1.5) + .2 * uBeat);
  float a = mod(atan(p.y, p.x) - turn, seg);
  a = min(a, seg - a);                          // every other segment mirrored, so neighbours meet without a seam
  a += PI * .5 - seg * .25;                     // each segment shows the wedge just above the centre
  vec2 q = .5 + length(p) * vec2(cos(a), sin(a)) * side / uRes;
  if (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) return vec3(0.);   // past the picture: dark, never a smeared edge
  return pick(q);
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
// picture (uScene), the scene inputs (the same uniforms, so the Look's Reactivity reaches its movement) and
// its settings, and blends back to the scene's own picture towards the edges (the edge fade). Each pass of
// a stack fades the same way, so however many run, the border shows the scene alone.
export function effectShader(def: EffectDef): string {
  return /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex, uScene;
uniform vec2 uRes;
${INPUT_DECLARATIONS}
${def.settings.map((s) => `uniform float ${s.uniform};   // ${s.label}`).join('\n')}
#define PI 3.14159265359
#define TAU 6.28318530718

vec3 pick(vec2 uv) { return texture(uTex, uv).rgb; }
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

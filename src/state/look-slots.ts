// The Look slots A–D: four looks kept to come back to, the Look's seven sliders each and the ones that
// follow the music. Stored under
// KEYS.lookSlots and exported with the setup. A recall glides there over a second, the hue the short way
// round the wheel, so the picture never jumps; it moves locked sliders too (a lock only keeps Randomize
// and Drift off). Intensity is here too: one control that moves Reactivity, Trails and Fringing together,
// inside the ranges Randomize uses, so it never reaches a look the safety rules haven't checked.

import { z } from 'zod';
import type { Routes } from '../engine/look-routes';
import { SLIDER_KEYS, type Look, type SliderKey, type SlotOrder } from './app-state';
import { RANDOM_RANGES } from './look-drift';
import { RoutesSchema, slider } from './look-store';
import { KEYS, debouncedWriter, readJSON, type DebouncedWriter } from './persistence';
import { clamp01, lerpHue, smoothstep } from '../engine/math';

export const SLOT_NAMES = ['A', 'B', 'C', 'D'] as const;
export type SlotLook = Record<SliderKey, number>;
// A slot: the sliders, and the ones following the music (ADR 0005); routes absent in a slot stored before them.
export type Slot = SlotLook & { routes?: Routes };
export type LookSlots = readonly (Slot | null)[];   // null: empty

const EMPTY: LookSlots = SLOT_NAMES.map(() => null);
const SlotSchema = z.object({ ...Object.fromEntries(SLIDER_KEYS.map((k) => [k, slider(k)])), routes: RoutesSchema.optional() }) as unknown as z.ZodType<Slot>;
export const LookSlotsSchema = z.array(SlotSchema.nullable().catch(null)).length(SLOT_NAMES.length).catch(EMPTY.slice());

export const loadLookSlots = (): LookSlots => readJSON(KEYS.lookSlots, LookSlotsSchema, EMPTY);
export const lookSlotsWriter = (read: () => LookSlots): DebouncedWriter => debouncedWriter(KEYS.lookSlots, read, 300);

export const slotOf = (look: Readonly<Look>): SlotLook => Object.fromEntries(SLIDER_KEYS.map((k) => [k, look[k]])) as SlotLook;
// What a slot stores: the sliders and the routes, copied.
export const slotWithRoutes = (look: Readonly<Look>): Slot => ({ ...slotOf(look), routes: structuredClone(look.routes) });

// The slot auto-change goes to next from slot `at` (-1: none yet): the next filled one after it, round again,
// or a random filled one other than it. Null while fewer than two are filled.
export function nextSlot(slots: LookSlots, at: number, order: SlotOrder, random: () => number = Math.random): number | null {
  const filled = slots.flatMap((s, i) => (s ? [i] : []));
  if (filled.length < 2) return null;
  if (order === 'random') {
    const others = filled.filter((i) => i !== at);
    return others[Math.floor(random() * others.length)]!;
  }
  return filled.find((i) => i > at) ?? filled[0]!;
}

const RECALL_SECONDS = 1;

// A recall in progress, stepped by the frame loop after Drift (so it wins while both run). No allocation
// per frame.
export class LookGlide {
  private readonly from = {} as SlotLook;
  private readonly to = {} as SlotLook;
  private t = 1;

  get active(): boolean { return this.t < 1; }

  start(from: SlotLook, to: SlotLook): void {
    Object.assign(this.from, from);
    Object.assign(this.to, to);
    this.t = 0;
  }

  stop(): void { this.t = 1; }

  step(look: Look, dt: number): void {
    if (!this.active) return;
    this.t = Math.min(1, this.t + dt / RECALL_SECONDS);
    const e = smoothstep(this.t);
    for (const k of SLIDER_KEYS) {
      const from = this.from[k], to = this.to[k];
      look[k] = k === 'hue' ? lerpHue(from, to, e) : from + (to - from) * e;
    }
  }
}

// What Intensity sets: these sliders along a line through the Randomize ranges, 0 the bottom of each, 1 the top.
export const INTENSITY_KEYS: readonly SliderKey[] = ['reactivity', 'trails', 'aberration'];
export const intensityValue = (key: SliderKey, x: number): number => {
  const [min, max] = RANDOM_RANGES[key];
  return min + (max - min) * clamp01(x);
};
// Sets Intensity to `x` and moves the unlocked INTENSITY_KEYS with it.
export function applyIntensity(look: Look, x: number): void {
  look.intensity = clamp01(x);
  for (const k of INTENSITY_KEYS) if (!look.locked.includes(k)) look[k] = intensityValue(k, look.intensity);
}

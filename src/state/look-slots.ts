// The Look slots A–D: four looks kept to come back to, the Look's seven sliders each. Stored under
// KEYS.lookSlots and exported with the setup. A recall glides there over a second, the hue the short way
// round the wheel, so the picture never jumps; it moves locked sliders too (a lock only keeps Randomize
// and Drift off). Intensity is here too: one control that moves Reactivity, Trails and Fringing together,
// inside the ranges Randomize uses, so it never reaches a look the safety rules haven't checked.

import { z } from 'zod';
import { SLIDER_KEYS, type Look, type SliderKey } from './app-state';
import { RANDOM_RANGES } from './look-drift';
import { slider } from './look-store';
import { KEYS, debouncedWriter, readJSON, type DebouncedWriter } from './persistence';

export const SLOT_NAMES = ['A', 'B', 'C', 'D'] as const;
export type SlotLook = Record<SliderKey, number>;
export type LookSlots = readonly (SlotLook | null)[];   // null: empty

const EMPTY: LookSlots = SLOT_NAMES.map(() => null);
const SlotSchema = z.object(Object.fromEntries(SLIDER_KEYS.map((k) => [k, slider(k)]))) as unknown as z.ZodType<SlotLook>;
export const LookSlotsSchema = z.array(SlotSchema.nullable().catch(null)).length(SLOT_NAMES.length).catch(EMPTY.slice());

export const loadLookSlots = (): LookSlots => readJSON(KEYS.lookSlots, LookSlotsSchema, EMPTY);
export const lookSlotsWriter = (read: () => LookSlots): DebouncedWriter => debouncedWriter(KEYS.lookSlots, read, 300);

export const slotOf = (look: Readonly<Look>): SlotLook => Object.fromEntries(SLIDER_KEYS.map((k) => [k, look[k]])) as SlotLook;

const RECALL_SECONDS = 1;
const ease = (x: number) => x * x * (3 - 2 * x);
const fract = (x: number) => x - Math.floor(x);

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
    const e = ease(this.t);
    for (const k of SLIDER_KEYS) {
      const from = this.from[k], to = this.to[k];
      look[k] = k === 'hue' ? fract(from + (fract(to - from + 0.5) - 0.5) * e) : from + (to - from) * e;
    }
  }
}

// What Intensity sets: these sliders along a line through the Randomize ranges, 0 the bottom of each, 1 the top.
export const INTENSITY_KEYS: readonly SliderKey[] = ['reactivity', 'trails', 'aberration'];
export const intensityValue = (key: SliderKey, x: number): number => {
  const [min, max] = RANDOM_RANGES[key];
  return min + (max - min) * Math.min(1, Math.max(0, x));
};

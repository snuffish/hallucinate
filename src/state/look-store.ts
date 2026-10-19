// The Look as it was left (the Look widget's sliders, locks, switches and XY pads), kept for the next start
// the way the screen's effects are: under KEYS.look, not exported (show scenes carry their own look in an
// export). Every field falls back on its own, so one bad value doesn't reset the rest, and a slider out
// of its range is clamped back into it.

import { z } from 'zod';
import { DEFAULT_XY, LOOK_RANGES, SLIDER_KEYS, defaultLook, type Look, type LookKey, type SliderKey } from './app-state';
import { KEYS, debouncedWriter, readWithDefaults, type DebouncedWriter } from './persistence';

const DEFAULTS = defaultLook();

const slider = (key: LookKey) => {
  const r = LOOK_RANGES[key];
  return z.number().catch(DEFAULTS[key]).transform((v) => Math.min(r.max, Math.max(r.min, v)));
};
const sliderKey = z.custom<SliderKey>((v) => SLIDER_KEYS.includes(v as SliderKey));
const xyAxes = z.object({ x: sliderKey, y: sliderKey }).refine((a) => a.x !== a.y);

export const LookSchema = z.object({
  reactivity: slider('reactivity'),
  speed: slider('speed'),
  trails: slider('trails'),
  hue: slider('hue'),
  cycle: slider('cycle'),
  aberration: slider('aberration'),
  synesthesia: slider('synesthesia'),
  auto: z.boolean().catch(DEFAULTS.auto),
  randomScene: z.boolean().catch(DEFAULTS.randomScene),
  drift: z.boolean().catch(DEFAULTS.drift),
  driftSpeed: slider('driftSpeed'),
  locked: z.array(z.unknown()).catch([]).transform((keys) => SLIDER_KEYS.filter((k) => keys.includes(k))),
  xyOpen: z.boolean().catch(DEFAULTS.xyOpen),
  xy: z.array(xyAxes).length(DEFAULT_XY.length).catch(DEFAULT_XY.map((a) => ({ ...a }))),
}) satisfies z.ZodType<Look>;

export const loadLook = (): Look => readWithDefaults(KEYS.look, LookSchema);

// Slider drags and Drift's glides coalesce into one write; the page's hiding flushes the last one.
export const lookWriter = (read: () => Look): DebouncedWriter => debouncedWriter(KEYS.look, read, 300);

// The Look as it was left (the Look widget's sliders, locks, switches and XY pads), kept for the next start
// the way the screen's effects are: under KEYS.look, not exported (show scenes carry their own look in an
// export). Every field falls back on its own, so one bad value doesn't reset the rest, and a slider out
// of its range is clamped back into it.

import { z } from 'zod';
import { AUTO_SLOT_BEATS, DEFAULT_XY, PALETTE_MAX, clampLook, SLIDER_KEYS, WHEEL, defaultLook, type Look, type LookKey, type Palette, type SliderKey } from './app-state';
import { ROUTE_SECONDS, ROUTE_SOURCES, ROUTE_TARGETS, type Routes } from '../engine/look-routes';
import { KEYS, debouncedWriter, readWithDefaults, type DebouncedWriter } from './persistence';

const DEFAULTS = defaultLook();

// A slider's stored value: the default when it isn't a number, clamped into its range when it is.
export const slider = (key: LookKey) => z.number().catch(DEFAULTS[key]).transform((v) => clampLook(key, v));
// A palette (ADR 0004): 2–5 hues on the wheel, each wrapped into 0–1, or none (the whole wheel); fewer than
// two hues read as none, extra ones are dropped.
export const PaletteSchema = z.object({
  hues: z.array(z.number().transform((h) => h - Math.floor(h))).catch([]).transform((h) => (h.length >= 2 ? h.slice(0, PALETTE_MAX) : [])),
  steps: z.boolean().catch(false),
}).catch(() => ({ hues: [], steps: WHEEL.steps })) satisfies z.ZodType<Palette>;

// Sliders that follow the music (ADR 0005): a route per slider that can follow, each field checked; a broken
// route is dropped, not the rest.
const RouteSchema = z.object({
  source: z.enum(ROUTE_SOURCES),
  depth: z.number().min(-1).max(1),
  attack: z.number().min(ROUTE_SECONDS.min).max(ROUTE_SECONDS.max),
  release: z.number().min(ROUTE_SECONDS.min).max(ROUTE_SECONDS.max),
});
export const RoutesSchema = z.record(z.string(), z.unknown()).catch({}).transform((raw) => {
  const routes: Routes = {};
  for (const t of ROUTE_TARGETS) { const r = RouteSchema.safeParse(raw[t]); if (r.success) routes[t] = r.data; }
  return routes;
});

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
  intensity: z.number().min(0).max(1).catch(DEFAULTS.intensity),
  autoSlots: z.object({
    on: z.boolean().catch(DEFAULTS.autoSlots.on),
    beats: z.number().refine((b) => (AUTO_SLOT_BEATS as readonly number[]).includes(b)).catch(DEFAULTS.autoSlots.beats),
    order: z.enum(['linear', 'random']).catch(DEFAULTS.autoSlots.order),
    transition: z.enum(['soft', 'hard']).catch(DEFAULTS.autoSlots.transition),
  }).catch(() => ({ ...DEFAULTS.autoSlots })),
  palette: PaletteSchema,
  routes: RoutesSchema,
  locked: z.array(z.unknown()).catch([]).transform((keys) => SLIDER_KEYS.filter((k) => keys.includes(k))),
  xyOpen: z.boolean().catch(DEFAULTS.xyOpen),
  xy: z.array(xyAxes).length(DEFAULT_XY.length).catch(DEFAULT_XY.map((a) => ({ ...a }))),
}) satisfies z.ZodType<Look>;

export const loadLook = (): Look => readWithDefaults(KEYS.look, LookSchema);

// Slider drags and Drift's glides coalesce into one write; the page's hiding flushes the last one.
export const lookWriter = (read: () => Look): DebouncedWriter => debouncedWriter(KEYS.look, read, 300);

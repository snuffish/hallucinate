// The Hearing monitor's plot: the signals it can draw and their colours, the presets, what was picked (remembered on
// this computer), where the lanes go, and the what-if threshold's arithmetic. The drawing is in HearingWorkbench.tsx.

import { z } from 'zod';
import type { BandKey, HearingSample } from '../engine/hearing-history';
import { KICK_MIN_GAP } from '../engine/kick-hearer';
import { SCENE_INPUTS, type InputUniform } from '../engine/scene-inputs';
import { KEYS, readWithDefaults, writeJSON } from '../state/persistence';

export const COLOURS = { line: '#4fe3ff', kick: '#ff4fd8', tick: '#4fffa0', threshold: '#ffd84f', whatIf: '#ff9f4f', due: 'rgba(255, 255, 255, 0.1)', grid: 'rgba(255, 255, 255, 0.25)', muted: '#a99fc4' };
const BAND_COLOURS: Record<BandKey, string> = { bass: '#ff4fd8', mid: '#ffd84f', high: '#4fe3ff', level: '#e8e2ff' };

export const GROUPS = ['kicks', 'bands', 'scene', 'tempo'] as const;
export type SignalGroup = (typeof GROUPS)[number];

// A signal is a value over time (`value`, drawn as a line between `range`; null: between its lowest and highest
// shown), or, without `value`, one the kick lane draws its own way: the threshold, the due windows, kicks and ticks.
export interface Signal {
  id: string;
  group: SignalGroup;
  colour: string;
  help: string;
  value?: (s: HearingSample) => number | null;
  range?: readonly [number, number] | null;
}

// The scene inputs that reach 1.5 at high reactivity; the others stay within 0…1, or have no top.
const INPUT_RANGE: Partial<Record<InputUniform, readonly [number, number]>> = {
  uBass: [0, 1.5], uMid: [0, 1.5], uHigh: [0, 1.5], uLevel: [0, 1.5], uBeat: [0, 1.5], uTick: [0, 1], uHue: [0, 1], uBright: [0, 1], uMood: [0, 1],
};
const INPUT_COLOURS: Partial<Record<InputUniform, string>> = { uBeat: COLOURS.kick, uTick: COLOURS.tick, uBass: '#4fe3ff', uMood: '#ffd84f', uHue: '#c78bff', uBright: '#ffffff' };

export const SIGNALS: readonly Signal[] = [
  { id: 'rise', group: 'kicks', colour: COLOURS.line, help: 'How much the kick\'s bins rose', value: (s) => s.rise, range: null },
  { id: 'threshold', group: 'kicks', colour: COLOURS.threshold, help: 'The rise a kick must reach' },
  { id: 'due', group: 'kicks', colour: 'rgba(255, 255, 255, 0.55)', help: 'Where the next kick was due (the last 6 s)' },
  { id: 'kicks', group: 'kicks', colour: COLOURS.kick, help: 'The kicks heard' },
  { id: 'ticks', group: 'kicks', colour: COLOURS.tick, help: 'The ticks of the tempo clock' },
  ...(['bass', 'mid', 'high', 'level'] as const).map((b): Signal => ({
    id: b, group: 'bands', colour: BAND_COLOURS[b], help: `The ${b === 'level' ? 'three bands together' : `${b} band`}, as heard`, value: (s) => s.bands[b], range: [0, 1],
  })),
  ...SCENE_INPUTS.map((input): Signal => ({
    id: input.uniform, group: 'scene', colour: INPUT_COLOURS[input.uniform] ?? '#4fe3ff', help: `${input.help} (${input.range})`,
    value: (s) => s.inputs[input.uniform], range: INPUT_RANGE[input.uniform] ?? null,
  })),
  { id: 'bpm', group: 'tempo', colour: COLOURS.line, help: 'The tempo (80–180 BPM)', value: (s) => s.bpm, range: [80, 180] },
  { id: 'confidence', group: 'tempo', colour: COLOURS.tick, help: 'How clearly the kicks repeat at the tempo', value: (s) => s.confidence, range: [0, 1] },
];
const SIGNAL_IDS = new Set(SIGNALS.map((s) => s.id));

export const PRESETS: Readonly<Record<string, readonly string[]>> = {
  Overview: ['rise', 'threshold', 'due', 'kicks', 'ticks', 'bass', 'mid', 'high', 'level'],
  Kicks: ['rise', 'threshold', 'due', 'kicks', 'ticks'],
  'Kicks → scene': ['rise', 'kicks', 'ticks', 'uBeat', 'uTick'],
  Bands: ['bass', 'mid', 'high', 'level', 'uBass', 'uMid', 'uHigh', 'uLevel'],
  Tempo: ['kicks', 'ticks', 'bpm', 'confidence'],
};

// The preset that shows exactly these signals, if one does.
export function presetOf(signals: readonly string[]): string | null {
  const on = new Set(signals);
  return Object.entries(PRESETS).find(([, ids]) => ids.length === on.size && ids.every((id) => on.has(id)))?.[0] ?? null;
}

// ---------- What was picked ----------

export const SPANS = [6, 20, 60] as const;   // seconds the plot looks back
export type Span = (typeof SPANS)[number];
export interface WorkbenchSettings { signals: string[]; span: Span }

const SettingsSchema = z.object({
  signals: z.array(z.string()).default([...PRESETS.Overview!]),
  span: z.union([z.literal(6), z.literal(20), z.literal(60)]).default(6),
});

// Signals this version doesn't know (renamed, removed) are dropped.
export function parseWorkbench(raw: unknown): WorkbenchSettings {
  const parsed = SettingsSchema.safeParse(raw ?? {});
  const s = parsed.success ? parsed.data : SettingsSchema.parse({});
  return { signals: s.signals.filter((id) => SIGNAL_IDS.has(id)), span: s.span };
}

export const loadWorkbench = (): WorkbenchSettings => parseWorkbench(readWithDefaults(KEYS.hearingWorkbench, SettingsSchema));
export const saveWorkbench = (settings: WorkbenchSettings): void => writeJSON(KEYS.hearingWorkbench, settings);

// Shows or hides one signal; `only` shows just that one.
export function toggleSignal(signals: readonly string[], id: string, only = false): string[] {
  if (only) return [id];
  return signals.includes(id) ? signals.filter((s) => s !== id) : [...signals, id];
}

// ---------- Lanes ----------

export const LANE_HEIGHT: Record<SignalGroup, number> = { kicks: 100, bands: 64, scene: 64, tempo: 52 };
export const LANE_GAP = 6;
export const AXIS_HEIGHT = 14;

export interface Lane { group: SignalGroup; top: number; height: number }

// One lane per group with a signal shown, top to bottom in the groups' order.
export function lanesFor(signals: readonly string[]): { lanes: Lane[]; height: number } {
  const on = new Set(signals);
  let top = 0;
  const lanes = GROUPS.filter((g) => SIGNALS.some((s) => s.group === g && on.has(s.id))).map((group) => {
    const lane = { group, top, height: LANE_HEIGHT[group] };
    top += LANE_HEIGHT[group] + LANE_GAP;
    return lane;
  });
  return { lanes, height: lanes.length ? top + AXIS_HEIGHT : 0 };
}

// ---------- What if the threshold were different ----------

// The rise peaks over `line` in the last few seconds (seconds before now, oldest first), a kick's gap apart at the
// least: the kicks a threshold at `line` would let through. Only shown, never used for hearing.
export function peaksOver(rises: ArrayLike<number>, cell: number, line: number): number[] {
  const out: number[] = [];
  let last = Infinity;
  for (let i = 1; i < rises.length - 1; i++) {
    const r = rises[i]!;
    if (r < line || r < rises[i - 1]! || r < rises[i + 1]!) continue;
    const ago = (rises.length - 1 - i) * cell;
    if (last - ago < KICK_MIN_GAP) continue;
    out.push(ago);
    last = ago;
  }
  return out;
}

// The sample nearest `at`, or null when there is none.
export function sampleAt(samples: readonly HearingSample[], at: number): HearingSample | null {
  let best: HearingSample | null = null;
  for (const s of samples) if (!best || Math.abs(s.at - at) < Math.abs(best.at - at)) best = s;
  return best;
}

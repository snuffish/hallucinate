// The app's mutable state, shared by the engines (read every frame, no React) and the React tree
// (through store.ts, which publishes immutable snapshots at UI rate). Nothing here allocates per frame.

import type { EffectStack } from '../engine/effects';
import type { Scene } from '../scenes';

export const BEATS_PER_SCENE = 32;
export const MAX_SECONDS_PER_SCENE = 45;
export const CROSSFADE_SECONDS = 1.5;

export interface Look {
  reactivity: number;
  speed: number;
  trails: number;
  hue: number;
  cycle: number;
  aberration: number;
  synesthesia: number;
  auto: boolean;
  randomScene: boolean;   // Randomize also jumps to a random scene
  drift: boolean;         // the sliders wander on their own (src/state/look-drift.ts)
  driftSpeed: number;
  locked: readonly SliderKey[];   // Randomize and Drift leave these alone
  xyOpen: boolean;                // the Look widget shows its XY pads
  xy: readonly XYAxes[];          // what each XY pad moves, across and up
}
export type LookKey = 'hue' | 'cycle' | 'trails' | 'speed' | 'reactivity' | 'aberration' | 'synesthesia' | 'driftSpeed';
// The Look's sliders: every number a frame is composed with (Drift speed only paces Drift).
export type SliderKey = Exclude<LookKey, 'driftSpeed'>;
export const SLIDER_KEYS: readonly SliderKey[] = ['reactivity', 'speed', 'trails', 'hue', 'cycle', 'synesthesia', 'aberration'];
export interface XYAxes { x: SliderKey; y: SliderKey }
export const LOOK_KEYS: readonly LookKey[] = ['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration'];   // stored in show scenes
export const LOOK_RANGES: Record<LookKey, { min: number; max: number; step: number }> = {
  reactivity: { min: 0, max: 2, step: 0.01 },
  speed: { min: 0, max: 2.5, step: 0.01 },
  trails: { min: 0, max: 0.97, step: 0.01 },
  hue: { min: 0, max: 1, step: 0.001 },
  cycle: { min: 0, max: 2, step: 0.01 },
  synesthesia: { min: 0, max: 1, step: 0.01 },
  aberration: { min: 0, max: 0.04, step: 0.001 },
  driftSpeed: { min: 0.2, max: 4, step: 0.05 },
};

// The XY pads start on the pairs a performer reaches for together: how fast and how hard, and where the
// colour sits and how fast it walks.
export const DEFAULT_XY: readonly XYAxes[] = [{ x: 'speed', y: 'reactivity' }, { x: 'hue', y: 'cycle' }];

export const defaultLook = (): Look => ({
  reactivity: 1, speed: 1, trails: 0.35, hue: 0, cycle: 0.2, aberration: 0,
  synesthesia: 0.3, auto: true, randomScene: false, drift: false, driftSpeed: 1,
  locked: [], xyOpen: true, xy: DEFAULT_XY,
});

export interface Clock {
  clock: number;
  time: number;
  timeRate: number;
  huePhase: number;
  turn: number;
  scene: number;
  prevScene: number;
  transitionStart: number;
  sceneStart: number;
  fade: number;
  beatsInScene: number;   // kicks since the scene came on (auto-switch)
}

export const defaultClock = (): Clock => ({
  clock: 0, time: 0, timeRate: 1, huePhase: 0, turn: 0,
  scene: 0, prevScene: -1, transitionStart: -10, sceneStart: 0, fade: CROSSFADE_SECONDS,
  beatsInScene: 0,
});

export type SourceButton = 'file' | 'mic' | 'soundcloud' | 'display' | 'demo' | 'media';

export interface AppState {
  scenes: readonly Scene[]; // the shared list; stable indices, soft-deleted entries stay (append with appendScene)
  customIndex: number;
  nodesIndex: number;
  keyedScenes: number[];
  look: Look;
  effects: EffectStack;   // the main screen's: what is on screen, like the Look, not the scene's (ADR 0003)
  clock: Clock;
  activeSource: SourceButton | null;
}

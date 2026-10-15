// The app's mutable state, shared by the engines (read every frame, no React) and the React tree
// (through store.ts, which publishes immutable snapshots at UI rate). Nothing here allocates per frame.

import type { Scene } from '../engine/scenes';

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
  resolution: number;
  synesthesia: number;
  mood: boolean;
  auto: boolean;
  randomScene: boolean;   // Randomize also jumps to a random scene
  drift: boolean;         // the sliders wander on their own (src/state/look-drift.ts)
  driftSpeed: number;
  spin: number;
}
export type LookKey = 'hue' | 'cycle' | 'trails' | 'speed' | 'reactivity' | 'aberration' | 'synesthesia' | 'resolution' | 'driftSpeed';
export const LOOK_KEYS: readonly LookKey[] = ['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration'];   // stored in show scenes
export const LOOK_RANGES: Record<LookKey, { min: number; max: number; step: number }> = {
  reactivity: { min: 0, max: 2, step: 0.01 },
  speed: { min: 0, max: 2.5, step: 0.01 },
  trails: { min: 0, max: 0.97, step: 0.01 },
  hue: { min: 0, max: 1, step: 0.001 },
  cycle: { min: 0, max: 2, step: 0.01 },
  synesthesia: { min: 0, max: 1, step: 0.01 },
  aberration: { min: 0, max: 0.04, step: 0.001 },
  resolution: { min: 0.3, max: 1, step: 0.05 },
  driftSpeed: { min: 0.2, max: 4, step: 0.05 },
};

export const defaultLook = (): Look => ({
  reactivity: 1, speed: 1, trails: 0.86, hue: 0, cycle: 0.6, aberration: 0.012, resolution: 0.75,
  synesthesia: 0.7, mood: true, auto: true, randomScene: false, drift: false, driftSpeed: 1, spin: 1,
});

export interface Clock {
  clock: number;
  time: number;
  timeRate: number;
  huePhase: number;
  mood: number;
  scene: number;
  prevScene: number;
  transitionStart: number;
  sceneStart: number;
  fade: number;
  beatsInScene: number;
  beatTimes: number[];
  bpm: number | null;   // recomputed on each beat, not every frame
}

export const defaultClock = (): Clock => ({
  clock: 0, time: 0, timeRate: 1, huePhase: 0, mood: 0.5,
  scene: 0, prevScene: -1, transitionStart: -10, sceneStart: 0, fade: CROSSFADE_SECONDS,
  beatsInScene: 0, beatTimes: [], bpm: null,
});

export type SourceButton = 'file' | 'mic' | 'soundcloud' | 'display' | 'demo' | 'media';

export interface AppState {
  scenes: Scene[];          // the shared list; stable indices, soft-deleted entries stay
  gameIndex: number;
  customIndex: number;
  nodesIndex: number;
  keyedScenes: number[];
  look: Look;
  clock: Clock;
  activeSource: SourceButton | null;
}

export function estimateBpm(beatTimes: readonly number[], now: number): number | null {
  if (beatTimes.length < 5 || now - beatTimes[beatTimes.length - 1]! > 2) return null;
  const gaps = beatTimes.slice(1).map((v, i) => v - beatTimes[i]!).sort((a, b) => a - b);
  return Math.round(60 / gaps[Math.floor(gaps.length / 2)]!);
}

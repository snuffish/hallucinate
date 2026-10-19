// Drift: the Look sliders wander on their own. Each one glides (eased in and out) to a random value
// within the same watchable range Randomize uses, then picks the next, each at its own pace, so the
// look keeps changing without ever jumping. A locked slider stays where it is. Runs in the frame loop: no
// allocation per frame.

import type { FrameLook } from '../engine/look';
import type { Look, SliderKey } from './app-state';

// What Randomize and Drift may pick from: laser-friendly territory (ADR 0002). Narrower than the
// sliders' full range, which stays open for hand use.
export const RANDOM_RANGES = {
  reactivity: [0.6, 1.4],
  speed: [0.5, 1.6],
  trails: [0, 0.6],
  hue: [0, 1],
  cycle: [0, 1],
  synesthesia: [0, 0.6],
  aberration: [0, 0.006],   // Fringing
} as const satisfies Record<SliderKey, readonly [number, number]>;   // every slider a frame is composed with, and only those
export type DriftKey = keyof typeof RANDOM_RANGES;
// The sliders Randomize rolls and Drift moves, in a fixed order.
export const DRIFT_KEYS = Object.keys(RANDOM_RANGES) as DriftKey[];

// The strongest Look Randomize or Drift can reach: the top of every range. The safety rules check
// scenes with this applied.
export const STRONGEST_LOOK: Readonly<FrameLook> = Object.fromEntries(DRIFT_KEYS.map((k) => [k, RANDOM_RANGES[k][1]])) as Record<DriftKey, number>;

// Seconds one glide takes at drift speed 1; each slider also gets its own tempo.
const MIN_SECONDS = 6;
const MAX_SECONDS = 22;

interface Lane { from: number; to: number; t: number; seconds: number; written: number }

const ease = (x: number) => x * x * (3 - 2 * x);

export class LookDrift {
  private readonly lanes = new Map<DriftKey, Lane>();
  private readonly tempo = new Map<DriftKey, number>();

  constructor(private readonly random: () => number = Math.random) {
    for (const key of DRIFT_KEYS) this.tempo.set(key, 0.6 + this.random() * 0.9);   // some sliders wander faster than others
  }

  // Forget the glides in progress, so the next step starts from the sliders as they are now.
  reset(): void { this.lanes.clear(); }

  // Advance every slider but the `locked` ones by `dt` seconds at `speed` (1 = normal). Writes into `look`.
  // A locked slider forgets its glide, so once unlocked it glides on from where it is.
  step(look: Look, dt: number, speed: number, locked: readonly DriftKey[] = []): void {
    for (const key of DRIFT_KEYS) {
      if (locked.includes(key)) { this.lanes.delete(key); continue; }
      let lane = this.lanes.get(key);
      // A new lane, or the user moved the slider since the last step: glide on from where it is.
      if (!lane || look[key] !== lane.written) {
        lane = lane ?? { from: 0, to: 0, t: 0, seconds: 1, written: 0 };
        this.next(key, lane, look[key]);
        this.lanes.set(key, lane);
      }
      lane.t = Math.min(1, lane.t + (dt * speed * this.tempo.get(key)!) / lane.seconds);
      look[key] = lane.from + (lane.to - lane.from) * ease(lane.t);
      lane.written = look[key];
      if (lane.t >= 1) this.next(key, lane, look[key]);
    }
  }

  private next(key: DriftKey, lane: Lane, from: number): void {
    const [min, max] = RANDOM_RANGES[key];
    lane.from = from;
    lane.to = min + this.random() * (max - min);
    lane.t = 0;
    lane.seconds = MIN_SECONDS + this.random() * (MAX_SECONDS - MIN_SECONDS);
    lane.written = from;
  }
}

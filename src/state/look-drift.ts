// Drift: the Look sliders wander on their own. Each one glides (eased in and out) to a random value
// within the same watchable range Randomize uses, then picks the next, each at its own pace, so the
// look keeps changing without ever jumping. Runs in the frame loop: no allocation per frame.

import type { Look } from './app-state';

// What Randomize and Drift may pick from: narrower than the sliders' full range where the extremes
// look broken (no reactivity, frozen motion, no trails).
export const RANDOM_RANGES = {
  reactivity: [0.5, 1.6],
  speed: [0.5, 1.6],
  trails: [0.6, 0.95],
  hue: [0, 1],
  cycle: [0, 1.5],
  synesthesia: [0, 1],
  aberration: [0, 0.025],
} as const;
export type DriftKey = keyof typeof RANDOM_RANGES;
const KEYS = Object.keys(RANDOM_RANGES) as DriftKey[];

// Seconds one glide takes at drift speed 1; each slider also gets its own tempo.
const MIN_SECONDS = 6;
const MAX_SECONDS = 22;

interface Lane { from: number; to: number; t: number; seconds: number; written: number }

const ease = (x: number) => x * x * (3 - 2 * x);

export class LookDrift {
  private readonly lanes = new Map<DriftKey, Lane>();
  private readonly tempo = new Map<DriftKey, number>();

  constructor(private readonly random: () => number = Math.random) {
    for (const key of KEYS) this.tempo.set(key, 0.6 + this.random() * 0.9);   // some sliders wander faster than others
  }

  // Forget the glides in progress, so the next step starts from the sliders as they are now.
  reset(): void { this.lanes.clear(); }

  // Advance every slider by `dt` seconds at `speed` (1 = normal). Writes into `look`.
  step(look: Look, dt: number, speed: number): void {
    for (const key of KEYS) {
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

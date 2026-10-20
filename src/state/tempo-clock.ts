// A steady beat clock for the show: it runs at the estimated tempo and re-anchors on every detected
// kick, so the count keeps going through breakdowns and silence instead of following bass hits alone.
//
//   clock.setBpm(124)            from the BPM estimate, whenever it changes
//   clock.onDetectedBeat(now)    a real kick: counts as a tick (unless one just happened) and resets the phase
//   clock.advance(now)           once per frame: how many ticks fell due since last time
//   clock.phase(now)             how far through the current tick: 0 on the tick, rising towards 1

import { clamp01 } from '../engine/math';

export class TempoClock {
  private interval = 0;     // seconds per beat; 0 = no tempo yet
  private next = 0;         // when the next tick is due
  private last = -1e9;      // when the last tick happened

  get bpm(): number | null { return this.interval ? Math.round(60 / this.interval) : null; }
  get running(): boolean { return this.interval > 0; }

  setBpm(bpm: number | null): void {
    if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return;
    const interval = 60 / bpm;
    if (this.interval) this.next += interval - this.interval;   // keep the phase, change the rate
    this.interval = interval;
  }

  reset(): void {
    this.interval = 0;
    this.next = 0;
    this.last = -1e9;
  }

  // A detected beat is a tick, unless the clock just ticked (a kick a hair late must not count twice).
  // Either way the clock re-anchors to the real hit.
  onDetectedBeat(now: number): boolean {
    if (!this.interval) return false;
    const ticked = now - this.last >= this.interval * 0.5;
    if (ticked) this.last = now;
    this.next = now + this.interval;
    return ticked;
  }

  // How far `now` is through the current tick, 0..1 (0 with no tempo yet).
  phase(now: number): number {
    if (!this.interval) return 0;
    return clamp01((now - this.last) / this.interval);
  }

  // Ticks that fell due by `now`. After a long stall (tab hidden) it catches up by at most one.
  advance(now: number): number {
    if (!this.interval || now < this.next) return 0;
    let ticks = 0;
    while (now >= this.next && ticks < 1) { ticks++; this.last = this.next; this.next += this.interval; }
    if (this.next <= now) this.next = now + this.interval;
    return ticks;
  }
}

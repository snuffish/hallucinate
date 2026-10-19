// The Hearing monitor's last minute, so its plot can look back further than the Listener's 6 s: one sample per view
// the monitor is shown (~15 a second), and every kick and tick once, all on the Listener's clock (seconds). The
// controller keeps it only while the monitor is open, like the Listener keeps its diagnostics.

import type { HearingDiagnostics } from './listener';
import type { InputUniform } from './scene-inputs';

export const HISTORY_SECONDS = 60;
const SAME_TIME = 1e-6;   // seconds: a kick or tick seen again in the next view, give or take rounding

export type BandKey = keyof HearingDiagnostics['bands'];

export interface HearingSample {
  at: number;            // the Listener's clock, seconds
  rise: number;          // the highest rise in the kick's bins since the sample before
  threshold: number;     // the rise a kick had to reach
  bpm: number | null;
  confidence: number;
  bands: Record<BandKey, number>;   // each band's level
  inputs: Record<InputUniform, number>;
}

export interface HearingHistory {
  samples: readonly HearingSample[];   // oldest first
  kicks: readonly number[];            // when each kick peaked, oldest first
  ticks: readonly number[];            // when each tick came, oldest first
}

export const NO_HISTORY: HearingHistory = { samples: [], kicks: [], ticks: [] };

export class HearingRecorder {
  private samples: HearingSample[] = [];
  private kicks: number[] = [];
  private ticks: number[] = [];

  // Adds what the monitor is shown now and returns the history: new arrays each time, for the UI store to see.
  record(d: HearingDiagnostics, inputs: Readonly<Record<InputUniform, number>>): HearingHistory {
    const at = d.at, before = this.samples.at(-1);
    if (before && at <= before.at) return this.history();
    const k = d.kicks, cells = before ? Math.min(k.rises.length, Math.max(1, Math.ceil((at - before.at) / k.cell))) : 1;
    let rise = 0;
    for (let i = k.rises.length - cells; i < k.rises.length; i++) rise = Math.max(rise, k.rises[i]!);
    this.samples.push({
      at, rise,
      threshold: k.threshold,
      bpm: d.tempo.bpm,
      confidence: d.tempo.confidence,
      bands: { bass: d.bands.bass.level, mid: d.bands.mid.level, high: d.bands.high.level, level: d.bands.level.level },
      inputs: { ...inputs },
    });
    append(this.kicks, k.kicks, at);
    append(this.ticks, k.ticks, at);
    const oldest = at - HISTORY_SECONDS;
    while (this.samples.length && this.samples[0]!.at < oldest) this.samples.shift();
    for (const times of [this.kicks, this.ticks]) while (times.length && times[0]! < oldest) times.shift();
    return this.history();
  }

  clear(): void {
    this.samples = [];
    this.kicks = [];
    this.ticks = [];
  }

  history(): HearingHistory {
    return { samples: this.samples.slice(), kicks: this.kicks.slice(), ticks: this.ticks.slice() };
  }
}

// The times `agos` seconds before `at` (oldest first) that come after the last one kept.
function append(times: number[], agos: readonly number[], at: number): void {
  for (const ago of agos) {
    const t = at - ago;
    if (t > (times.at(-1) ?? -Infinity) + SAME_TIME) times.push(t);
  }
}

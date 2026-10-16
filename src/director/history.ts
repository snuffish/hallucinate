// What the director remembers between cycles, since every cycle is a fresh conversation: energy
// samples (one per beat) grouped by cycle, so the digest can say where the music is heading, and
// the last few decisions with their notes. `energy` is the steady loudness (the one the mood uses), so
// a build-up reads as rising; the bass is against its last few seconds.

export interface EnergySample { energy: number; bass: number; bright: number }
export interface Decision { at: number; note: string }   // `at` in set seconds

const MAX_SAMPLES = 4096;
const MAX_DECISIONS = 8;
const WINDOWS = 4;

export type Direction = 'rising' | 'falling' | 'steady' | 'unknown';
export interface Trend { energy: number[]; bass: number[]; bright: number[]; direction: Direction }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 100) / 100;

export class DirectorHistory {
  private samples: EnergySample[] = [];
  private marks: number[] = [];   // sample index where each cycle started
  readonly decisions: Decision[] = [];

  sample(s: EnergySample): void {
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) {
      const drop = this.samples.length - MAX_SAMPLES;
      this.samples.splice(0, drop);
      this.marks = this.marks.map((m) => m - drop).filter((m) => m >= 0);
    }
  }

  markCycle(): void { this.marks.push(this.samples.length); }

  decide(note: string, at: number): void {
    this.decisions.push({ at, note });
    if (this.decisions.length > MAX_DECISIONS) this.decisions.shift();
  }

  // Mean energy per cycle window (the last WINDOWS, the current partial one last) and its direction.
  trend(): Trend {
    const bounds = [0, ...this.marks, this.samples.length];
    const windows: EnergySample[][] = [];
    for (let i = bounds.length - 2; i >= 0 && windows.length < WINDOWS; i--) {
      const w = this.samples.slice(bounds[i]!, bounds[i + 1]!);
      if (w.length) windows.unshift(w);
    }
    const energy = windows.map((w) => round(mean(w.map((s) => s.energy))));
    const bass = windows.map((w) => round(mean(w.map((s) => s.bass))));
    const bright = windows.map((w) => round(mean(w.map((s) => s.bright))));
    let direction: Direction = 'unknown';
    if (energy.length >= 2) {
      const d = energy[energy.length - 1]! - energy[0]!;
      direction = d > 0.08 ? 'rising' : d < -0.08 ? 'falling' : 'steady';
    }
    return { energy, bass, bright, direction };
  }

  clear(): void { this.samples = []; this.marks = []; this.decisions.length = 0; }
}

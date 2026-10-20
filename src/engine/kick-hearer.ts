// Kicks: the sudden rises in the low end that land on the pulse. A rise (positive spectral flux over the
// kick's bins) can't tell a kick from the rolling bassline between kicks, which rises in the same bins,
// often as strongly, nor from a kick the analyser has clipped at the top of its range. What sets the kick
// apart is that it comes back steadily. So the rises of the last few seconds are kept, cell by cell; the
// pulse is the period they repeat at most strongly (their autocorrelation, at the period and its multiples),
// placed where the strongest rises fall (a comb); and a kick is a clear rise where the next pulse is due, one
// a pulse at most. Rises off the pulse (bass notes, hats) are not kicks.
//
// Internal to the Listener, which owns every threshold behind what it hears: tested through Listener.hear.
//
//   kickHearer.hear(bins.freq, binHz, now)   once a frame: true when this frame heard a kick
//   kickHearer.reset()                       a new source, or a long passage without kicks: start clean
//   kickHearer.clarity                       how clearly the rises repeat at the pulse, 0..1, as last read
//   kickHearer.lastKickAt                    when the last kick peaked
//   kickHearer.signal(now)                   the rises and the pulses due, for the Hearing monitor
//   kickHearer.candidates()                  ... and the pulses the rises could be, as last read

import { clamp01 } from './math';

const KICK_HZ = [20, 280] as const;   // the kick's body and its top, which still rises when the sub is clipped
const KICK_STRENGTH = 0.15;           // a kick rises at least this much of the rise usually heard on the pulse ...
const KICK_MIN_RISE = 8;              // ... and at least this much at all (byte steps over the kick's bins)
export const KICK_MIN_GAP = 0.28;            // seconds between kicks, at least: caps them at ~214 BPM
const KICK_WINDOW = 0.06;             // a kick lands within this part of a pulse of where the pulse is due ...
const KICK_WINDOW_MIN = 0.025;        // ... and seconds, at least: a frame and a half at 60 fps
const RISES_CELL = 0.01;              // seconds: the rises' resolution, whatever the frame rate
const RISES_HISTORY = 6;              // seconds of them the pulse is read from ...
const RISES_RECENT = 4;               // ... the last few seconds counting most (an exponential fade)
const RISES_WARMUP = 1;               // seconds of them before the first reading
const RISES_OVERLAP = 1;              // seconds of them, at least, that a lag of the autocorrelation compares
const PULSE_EVERY = 0.25;             // seconds between readings of the pulse
const PULSE_RANGE = [60 / 200, 60 / 40] as const;   // seconds: the pulse periods considered
const PULSE_MULTIPLES = 3;            // a pulse's multiples (two pulses, three) count toward it; a pattern off the pulse's don't
const PULSE_PRIOR_BPM = 120, PULSE_PRIOR_OCTAVES = 0.9;   // where pulses usually sit: one is preferred over its half and double
const PULSE_LOST = 2;                 // seconds without a pulse in the rises before it's gone
const PULSE_HALVED = 0.9;             // how strongly the rises must repeat at half the period to hear that as the pulse
const PULSE_CLARITY = 0.1;            // how periodic the rises must be to hear a pulse (autocorrelation at the period, of 1)
const PULSE_SAME = 0.04;              // periods within this part of each other are the same pulse
const PULSE_PULL = 0.1;               // how far a kick moves the pulse toward itself: one early rise can't drag it
const PULSE_STEADY = 4;               // kicks in a row a pulse apart settle the pulse ...
const PULSE_APART = 0.1;              // ... "a pulse apart" give or take this part of one ...
const PULSE_HELD = 4;                 // ... and it stays settled while the last kick is at most this many pulses ago
const PULSE_SWITCH = 8;               // a settled pulse changes only when another is heard this many readings in a row
const PULSE_MOVES = 3;                // an unsettled pulse moves where the comb places it, this many readings in a row ...
const PULSE_MOVES_BY = 1.2;           // ... collecting this much more rise there than where the pulse is kept
const COMB_FADE = 0.9;                // each pulse further back counts this much of the one after it in the comb

// The kick signal as the Hearing monitor draws it. Times are seconds before `now`; negative is still to come.
export interface KickSignal {
  rises: Float32Array;   // the rise in each cell of the last few seconds, oldest first
  cell: number;          // seconds a cell
  threshold: number;     // the rise a kick must reach
  due: number[];         // when the pulses were and are due, the next first
  window: number;        // how far either side of a due pulse a kick may land
}

// The pulses the rises could be, as the Hearing monitor draws them: one entry per period considered.
export interface PulseCandidates {
  bpm: number[];          // the pulse, slowest first
  strength: number[];     // 0..1 how strongly the rises repeat at it and its multiples
  preference: number[];   // 0..1 how much it is preferred for where pulses usually sit
  clear: number;          // the strength it takes to hear a pulse at all
}

// How much a pulse `lag` cells long is preferred: most around PULSE_PRIOR_BPM, less an octave either side.
const preference = (lag: number) => Math.exp(-0.5 * (Math.log2(60 / (lag * RISES_CELL) / PULSE_PRIOR_BPM) / PULSE_PRIOR_OCTAVES) ** 2);

const samePulse = (a: number, b: number) => Math.abs(a - b) <= b * PULSE_SAME;

// The last kick: when it peaked and was heard, the window it was heard in, its rise and when its pulse was due.
interface LastKick { at: number; heardAt: number; windowOpens: number; rise: number; due: number }
// The frame before, judged once this one shows whether its rise had peaked: when, its rise, the gap before it.
interface Candidate { at: number; rise: number; gap: number }

export class KickHearer {
  private readonly cells = Math.round(RISES_HISTORY / RISES_CELL);
  private readonly rises = new Float32Array(this.cells);   // a ring: the rise heard in each cell
  private readonly recency = Float32Array.from({ length: this.cells }, (_, k) => Math.exp((-k * RISES_CELL) / RISES_RECENT));
  private readonly centred = new Float64Array(this.cells);              // scratch for readPulse: the rises, newest first, about their mean ...
  private readonly weighted = new Float64Array(this.cells);             // ... weighted by recency ...
  private readonly cumulativeWeight = new Float64Array(this.cells + 1); // ... and the recency summed up to each cell
  private readonly acf = new Float64Array(this.cells + 2);              // ... the autocorrelation at each lag
  private readonly strengths = new Float64Array(this.cells + 2);        // ... at each lag and its multiples, of 1
  private strengthLags: [number, number] = [0, -1];     // ... the lags read last time
  private kickBins = new Float32Array(0);   // the kick's bins this frame ...
  private oneFrameAgo = new Float32Array(0);
  private twoFramesAgo = new Float32Array(0);
  private readonly lastKick: LastKick = { at: 0, heardAt: 0, windowOpens: 0, rise: 0, due: 0 };
  private readonly candidate: Candidate = { at: 0, rise: 0, gap: 0 };
  private framesHeld!: number;    // frames of the kick's bins held (0..2)
  private cell!: number;          // the absolute index of the last cell written
  private filled!: number;        // cells written since the start (or a gap)
  private frameGap!: number;      // seconds since the frame before: at a low frame rate a kick is heard that late
  private nextRead!: number;      // when the pulse is read next
  private period!: number;        // seconds a pulse; 0 = no pulse heard
  private pulseRise!: number;     // the rise usually heard on the pulse
  private combRise!: number;      // ... as the last comb heard it
  private due!: number;           // when the next pulse is due
  private steady!: number;        // kicks in a row a pulse apart
  private challenger!: number;    // a period heard other than the one kept ...
  private challenges!: number;    // ... in how many readings in a row
  private movedReadings!: number; // readings in a row the comb placed the pulse elsewhere
  private pulseHeardAt!: number;  // when a pulse was last heard in the rises
  clarity!: number;               // how clearly the rises repeat at the pulse (autocorrelation at it, of 1), as last read

  constructor() {
    this.reset();
  }

  reset(): void {
    this.framesHeld = 0;
    this.cell = -1;
    this.filled = 0;
    this.frameGap = 0;
    this.nextRead = 0;
    this.period = 0;
    this.pulseRise = this.combRise = 0;
    this.due = 0;
    this.steady = this.challenger = this.challenges = this.movedReadings = 0;
    this.pulseHeardAt = -1e9;
    this.clarity = 0;
    this.strengthLags = [0, -1];
    const k = this.lastKick;
    k.at = k.heardAt = k.windowOpens = -1e9;
    k.rise = k.due = 0;
    const c = this.candidate;
    c.at = c.gap = 0;
    c.rise = Infinity;
  }

  hear(freq: Uint8Array, binHz: number, now: number): boolean {
    const rise = this.rise(freq, binHz);
    this.record(rise, now);
    if (now >= this.nextRead && this.filled * RISES_CELL >= RISES_WARMUP) {
      this.nextRead = now + PULSE_EVERY;
      this.readPulse(now);
    }
    // A kick is the peak of a rise: the frame before is judged once this one shows the rise has turned.
    const c = this.candidate, t = c.at, peak = c.rise, gap = c.gap;
    c.at = now;
    c.rise = rise;
    c.gap = this.frameGap;
    if (!(this.period > 0) || rise > peak) return false;
    const p = this.period, window = Math.max(p * KICK_WINDOW, KICK_WINDOW_MIN), last = this.lastKick;
    // A stronger peak later in the window the kick was heard in: that was the kick, so the pulse follows it
    // (the kick itself has been heard already).
    if (t <= last.windowOpens + window * 2 + gap && peak > last.rise) {
      last.rise = peak;
      this.due = last.due + p + (t - last.due) * PULSE_PULL;
      return false;
    }
    while (t > this.due + p / 2) this.due += p;   // a pulse went by without a kick: the next one
    if (t < this.due - window || t > this.due + window + gap) return false;
    if (peak < this.pulseRise * KICK_STRENGTH || peak < KICK_MIN_RISE) return false;
    this.steady = Math.abs(t - last.at - p) <= p * PULSE_APART ? this.steady + 1 : 0;
    last.at = t;
    last.windowOpens = this.due - window;
    last.rise = peak;
    last.due = this.due;
    this.due += p + (t - this.due) * PULSE_PULL;
    if (now - last.heardAt <= KICK_MIN_GAP) return false;
    last.heardAt = now;
    return true;
  }

  get lastKickAt(): number { return this.lastKick.at; }

  signal(now: number): KickSignal {
    // The cells gone by since the last frame (none came: paused, nothing connected): nothing rose in them.
    const n = this.cells, rises = new Float32Array(n);
    const since = this.cell < 0 ? n : Math.max(0, Math.floor(now / RISES_CELL) - this.cell);
    for (let k = since; k < Math.min(this.filled + since, n); k++) rises[n - 1 - k] = this.riseAgo(k - since);
    const p = this.period, due: number[] = [];
    if (p > 0) for (let t = this.due; t > now - RISES_HISTORY; t -= p) due.push(now - t);
    return {
      rises,
      cell: RISES_CELL,
      threshold: Math.max(this.pulseRise * KICK_STRENGTH, KICK_MIN_RISE),
      due,
      window: p > 0 ? Math.max(p * KICK_WINDOW, KICK_WINDOW_MIN) : 0,
    };
  }

  candidates(): PulseCandidates {
    const [lo, hi] = this.strengthLags, out: PulseCandidates = { bpm: [], strength: [], preference: [], clear: PULSE_CLARITY };
    for (let lag = hi; lag >= lo; lag--) {
      out.bpm.push(60 / (lag * RISES_CELL));
      out.strength.push(this.strengths[lag]!);
      out.preference.push(preference(lag));
    }
    return out;
  }

  // No pulse in the rises: after a while of that, the pulse is gone (until the rises repeat again).
  private lose(now: number): void {
    if (now - this.pulseHeardAt > PULSE_LOST) this.period = 0;
  }

  // The rise in the kick's bins since two frames ago (a kick's attack spans a frame or two), on the byte scale.
  private rise(freq: Uint8Array, binHz: number): number {
    const a = Math.max(1, Math.floor(KICK_HZ[0] / binHz)), b = Math.min(freq.length - 1, Math.ceil(KICK_HZ[1] / binHz));
    if (this.kickBins.length !== b + 1 - a) {   // a new analyser size: nothing to compare with yet
      this.kickBins = new Float32Array(b + 1 - a);
      this.oneFrameAgo = new Float32Array(b + 1 - a);
      this.twoFramesAgo = new Float32Array(b + 1 - a);
      this.framesHeld = 0;
    }
    const current = this.kickBins;
    for (let i = 0; i < current.length; i++) current[i] = freq[a + i]!;
    const before = this.framesHeld >= 2 ? this.twoFramesAgo : this.framesHeld === 1 ? this.oneFrameAgo : current;
    let sum = 0;
    for (let i = 0; i < current.length; i++) sum += Math.max(0, current[i]! - before[i]!);
    // Shift the frames along, reusing the oldest buffer for the next frame.
    this.kickBins = this.twoFramesAgo;
    this.twoFramesAgo = this.oneFrameAgo;
    this.oneFrameAgo = current;
    this.framesHeld = Math.min(2, this.framesHeld + 1);
    return sum;
  }

  // Writes the rise into the cells since the last frame, so the rises are the same at any frame rate.
  private record(rise: number, now: number): void {
    const cell = Math.floor(now / RISES_CELL);
    if (this.cell < 0 || cell <= this.cell - this.cells || cell - this.cell > this.cells) {   // a start, or a gap
      this.rises.fill(0);
      this.filled = 0;
      this.cell = cell - 1;
      this.frameGap = 0;
    } else this.frameGap = Math.max(0, cell - this.cell) * RISES_CELL;
    for (let c = this.cell + 1; c <= cell; c++) { this.rises[c % this.cells] = rise; this.filled++; }
    this.cell = Math.max(this.cell, cell);
  }

  // The rise `k` cells ago.
  private riseAgo(k: number): number {
    return this.rises[(((this.cell - k) % this.cells) + this.cells) % this.cells]!;
  }

  // The pulse in the rises: its period (where the autocorrelation peaks, at the period and its multiples,
  // weighted toward the usual pulse) and where it falls (the phase whose pulses collect the most rise).
  private readPulse(now: number): void {
    const n = Math.min(this.filled, this.cells), w = this.recency;
    let mean = 0, total = 0, energy = 0;
    for (let k = 0; k < n; k++) { mean += this.riseAgo(k) * w[k]!; total += w[k]!; }
    mean /= total;
    const centred = this.centred, weighted = this.weighted, cumulative = this.cumulativeWeight;
    for (let k = 0; k < n; k++) {
      centred[k] = this.riseAgo(k) - mean;
      weighted[k] = centred[k]! * w[k]!;
      cumulative[k + 1] = cumulative[k]! + w[k]!;
      energy += centred[k]! * weighted[k]!;
    }
    energy /= total;
    if (energy <= 0) { this.clarity = 0; this.strengthLags = [0, -1]; this.lose(now); return; }
    const lo = Math.round(PULSE_RANGE[0] / RISES_CELL), hi = Math.min(Math.round(PULSE_RANGE[1] / RISES_CELL), Math.floor(n / 2));
    const reach = Math.max(hi + 1, Math.min(n - Math.round(RISES_OVERLAP / RISES_CELL), PULSE_MULTIPLES * (hi + 1)));
    const acf = this.acf;
    acf[lo - 2] = acf[reach + 1] = 0;   // just outside the lags computed: the period's refinement may read them
    for (let lag = lo - 1; lag <= reach; lag++) {
      let s = 0;
      for (let k = 0; k + lag < n; k++) s += weighted[k]! * centred[k + lag]!;
      acf[lag] = n > lag ? s / cumulative[n - lag]! : 0;
    }
    let best = -Infinity, bestLag = 0;
    this.strengthLags = [lo, hi];
    for (let lag = lo; lag <= hi; lag++) {
      let sum = 0, terms = 0;
      for (let m = 1; m <= PULSE_MULTIPLES && m * lag <= reach; m++) { sum += acf[m * lag]! / m; terms += 1 / m; }
      const prior = preference(lag);
      this.strengths[lag] = clamp01(sum / terms / energy);
      if (acf[lag]! > 0 && (sum / terms) * prior > best) { best = (sum / terms) * prior; bestLag = lag; }
    }
    // A grid of kicks repeats at twice its period as strongly as at its period: the multiples can't tell 174
    // from 87. Where the rises repeat as strongly at half the lag, the pulse is that.
    const half = Math.round(bestLag / 2);
    if (half >= lo && acf[half]! >= acf[bestLag]! * PULSE_HALVED) bestLag = half;
    this.clarity = bestLag ? clamp01(acf[bestLag]! / energy) : 0;
    if (!bestLag || acf[bestLag]! / energy < PULSE_CLARITY) { this.lose(now); return; }
    this.pulseHeardAt = now;
    // The period to a fraction of a cell: from the peak at the furthest multiple in reach, divided back.
    let m = PULSE_MULTIPLES;
    while (m > 1 && m * bestLag + m + 1 > reach) m--;
    let peak = m * bestLag;
    for (let lag = m * bestLag - m; lag <= m * bestLag + m; lag++) if (acf[lag]! > acf[peak]!) peak = lag;
    const left = acf[peak - 1]!, centre = acf[peak]!, right = acf[peak + 1]!;
    const curve = left - 2 * centre + right;
    const between = curve < 0 ? Math.min(0.5, Math.max(-0.5, (0.5 * (left - right)) / curve)) : 0;
    const heard = ((peak + between) / m) * RISES_CELL;

    // A settled pulse holds until another is heard for a while: a bar of offbeat bass or a fill doesn't move it.
    if (!this.period || samePulse(heard, this.period)) this.challenges = 0;
    else this.challenges = samePulse(heard, this.challenger) ? this.challenges + 1 : 1;
    this.challenger = heard;
    const settled = this.steady >= PULSE_STEADY && now - this.lastKick.at < this.period * PULSE_HELD;
    const period = !settled || this.challenges === 0 || this.challenges >= PULSE_SWITCH ? heard : this.period;
    if (period === heard) this.challenges = 0;

    // Where the pulse falls: the phase whose pulses collect the most rise, the recent ones counting most.
    const lag = period / RISES_CELL;
    let phase = 0, top = -1;
    for (let k = 0; k < lag; k++) {
      const s = this.comb(k, lag, n);
      if (s > top) { top = s; phase = k; this.pulseRise = this.combRise; }
    }
    // The comb's pulse against the one kept: while the kicks don't hold it in place, the comb's wins when it
    // clearly hears the pulse elsewhere for a while.
    const latest = now - phase * RISES_CELL;
    const due = now - latest < period * KICK_WINDOW ? latest : latest + period;
    const keptPhase = Math.round(((((now - this.due + period) / RISES_CELL) % lag) + lag) % lag) % Math.max(1, Math.round(lag));
    const apart = Math.abs(((((due - this.due + period / 2) % period) + period) % period) - period / 2) > period * KICK_WINDOW;
    const elsewhere = this.period && !settled && apart && top > this.comb(keptPhase, lag, n) * PULSE_MOVES_BY;
    this.movedReadings = elsewhere ? this.movedReadings + 1 : 0;
    if (!this.period || this.movedReadings >= PULSE_MOVES) { this.due = due; this.movedReadings = 0; }
    this.period = period;
  }

  // The rise collected by the pulses at `phase` cells ago and every `lag` cells before, the recent ones
  // counting most; their plain mean rise is left in combRise.
  private comb(phase: number, lag: number, n: number): number {
    let sum = 0, weight = 1, pulses = 0, plain = 0;
    for (let k = phase; k < n; k += lag) {
      const i = Math.round(k), v = Math.max(this.riseAgo(i), i > 0 ? this.riseAgo(i - 1) : 0, i + 1 < n ? this.riseAgo(i + 1) : 0);
      sum += v * weight; plain += v; pulses++; weight *= COMB_FADE;
    }
    this.combRise = plain / Math.max(1, pulses);
    return sum;
  }
}

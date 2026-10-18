// What the music sounds like, heard once a frame from the analyser's bins: the band energies, the kicks
// and the tempo, the tone and the mood, and the spectrum texture the shaders read. The one owner of every
// threshold and time constant behind them; nothing outside reads the analysis' state. Pure: the tests
// drive it with synthetic bins.
//
//   listener.hear(audio.read(), music.playing, dt, now)   once a frame, on real time (seconds)
//   listener.reset()                                      a new source: the tempo starts over
//                                                         (as it does by itself after ~90 s without kicks)
//   listener.setSmoothing(prefs.audioSmoothing)           how calm the bands and the spectrum texture look

import { TempoClock } from '../state/tempo-clock';

const BANDS = { bass: [25, 140], mid: [140, 2000], high: [2000, 12000] } as const;
const BAND_KEYS = ['bass', 'mid', 'high', 'level'] as const;
const MIN_KICK_GAP = 0.28;     // seconds, caps detection at ~214 BPM
const KICK_WINDOW = 12;        // the last kicks the tempo is estimated from
const KICK_MIN = 5;            // ... and how many it takes
const BRIGHT_LOW_HZ = 1100;    // spectral centroid that counts as fully "dark" (piano/ambient ≈ 1.3 kHz)
const BRIGHT_HIGH_HZ = 5500;   // ... and fully "bright" (hi-hat heavy house ≈ 5.3 kHz, psytrance ≈ 4.1 kHz)
const TONE_SECONDS = 2.5;      // the tone follows the character of the track, not single hits
const MOOD_SECONDS = 4;        // the mood follows the stretch of the set; the tone relaxes at this pace too
const CALM_BPM = 80, ENERGETIC_BPM = 160;
const TEMPO_RANGE = [85, 175] as const;   // BPM: a half or double reading is folded into it
const FORGET_SECONDS = 90;     // playing this long without a kick (longer than any breakdown) forgets the tempo

// One frame of the analyser (AudioEngine.read): the dB-scaled byte spectrum and the byte waveform.
export interface Bins {
  readonly freq: Uint8Array;   // frequencyBinCount bytes, 0..255 between minDecibels and maxDecibels
  readonly time: Uint8Array;   // fftSize bytes, 128 = silence
  readonly sampleRate: number;
  readonly minDecibels: number;
  readonly maxDecibels: number;
}

// The sound this frame. One object, refilled by every hear().
export interface Hearing {
  bass: number;      // 0..1 each band against its last few seconds, plus some absolute loudness
  mid: number;
  high: number;
  level: number;     // the three bands together
  beat: number;      // 1 on a kick, fading out within ~0.5 s
  kick: boolean;     // a kick (a clear bass hit) in this frame
  tick: boolean;     // a tick of the tempo clock in this frame: steady, through breakdowns, only while playing
  tickPhase: number; // 0..1 how far through the current tick, 0 on each tick; holds still while not playing
  ticks: number;     // the ticks so far
  bpm: number | null;   // held once known, until the next source
  bright: number;    // the tone: 0 dark, muffled … 1 bright, crisp (log of the spectral centroid)
  centroid: number;  // Hz, smoothed like the tone
  energy: number;    // 0..1 how loud the music is, steadily (absolute, over seconds)
  mood: number;      // 0 calm … 1 energetic: the tempo, and some energy
}

type Bands = Record<(typeof BAND_KEYS)[number], number>;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (dt: number, seconds: number) => 1 - Math.exp(-dt / seconds);

export class Listener {
  readonly hearing: Hearing = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, kick: false, tick: false, tickPhase: 0, ticks: 0, bpm: null, bright: 0.5, centroid: 0, energy: 0, mood: 0.5 };
  readonly spectrum = new Uint8Array(512);   // 256 texels * (log-frequency spectrum, waveform)

  private readonly tempo = new TempoClock();
  private readonly avg: Bands = { bass: 0.3, mid: 0.3, high: 0.3, level: 0.3 };
  private readonly raw: Bands = { bass: 0, mid: 0, high: 0, level: 0 };   // reused every frame
  private readonly kickHearer = new KickHearer();
  private lastKick = -1e9;
  private kicks: number[] = [];
  private sinceKick = 0;   // seconds played since the last kick
  private amplitude = new Float32Array(256);   // byte -> linear amplitude, for the analyser's dB range
  private dbRange = '';
  private smoothing = 0.6;   // Settings → Audio (src/state/prefs.ts)
  private magnitude = new Float32Array(0);   // per bin, the smoothed linear magnitude
  private smoothed = new Uint8Array(0);      // ... back on the byte scale

  hear(bins: Bins | null, playing: boolean, dt: number, now: number): Readonly<Hearing> {
    const h = this.hearing;
    h.beat *= Math.exp(-dt * 5);
    h.kick = false;
    if (bins) this.listen(bins, dt, now);
    else {
      for (const k of BAND_KEYS) h[k] *= Math.exp(-dt * 3);
      this.spectrum.fill(0);
      for (let i = 0; i < 256; i++) this.spectrum[i * 2 + 1] = 128;
    }
    this.sinceKick = h.kick ? 0 : this.sinceKick + (playing ? dt : 0);
    if (this.sinceKick > FORGET_SECONDS && h.bpm !== null) this.reset();   // a long passage without kicks
    const ticked = h.kick && playing && this.tempo.onDetectedBeat(now);
    h.tick = playing && (this.tempo.advance(now) > 0 || ticked);
    if (playing) h.tickPhase = this.tempo.phase(now);
    if (h.tick) h.ticks++;
    h.energy = clamp01((this.avg.level - 0.15) / 0.4);
    const tempo = h.bpm ? clamp01((h.bpm - CALM_BPM) / (ENERGETIC_BPM - CALM_BPM)) : 0.5;
    h.mood += ((playing ? tempo * 0.65 + h.energy * 0.35 : 0.5) - h.mood) * ease(dt, MOOD_SECONDS);
    if (!playing) h.bright += (0.5 - h.bright) * ease(dt, MOOD_SECONDS);   // nothing plays: the grade goes neutral
    return h;
  }

  // How much each spectrum frame is averaged with the previous ones, for the bands and the spectrum
  // texture: higher is calmer, lower twitchier. Kicks are heard in the unsmoothed bins.
  setSmoothing(value: number): void {
    this.smoothing = value;
  }

  // Forgets the tempo: the ticks stop and the mood lets it go, until enough kicks come to hear it again.
  reset(): void {
    this.kicks = [];
    this.kickHearer.reset();
    this.sinceKick = 0;
    this.hearing.bpm = null;
    this.tempo.reset();
  }

  private listen(bins: Bins, dt: number, now: number): void {
    const h = this.hearing, raw = this.raw;
    const binHz = bins.sampleRate / (bins.freq.length * 2);
    const freq = this.smooth(bins);
    raw.bass = band(freq, binHz, BANDS.bass);
    raw.mid = band(freq, binHz, BANDS.mid);
    raw.high = band(freq, binHz, BANDS.high);
    raw.level = raw.bass * 0.5 + raw.mid * 0.35 + raw.high * 0.15;

    // Adaptive normalisation: compare against a slow running average so quiet and loud
    // tracks both drive the visuals, while keeping some absolute loudness in the mix.
    const slow = ease(dt, 2.5);
    const attack = 1 - Math.exp(-dt * 30);
    const release = 1 - Math.exp(-dt * 6);
    for (const k of BAND_KEYS) {
      this.avg[k] += (raw[k] - this.avg[k]) * slow;
      const avg = Math.max(this.avg[k], 0.05);
      const rel = clamp01((raw[k] - avg * 0.85) / (avg * 0.5));
      const target = raw[k] < 0.02 ? 0 : Math.min(1, rel * 0.7 + raw[k] * 0.5);
      h[k] += (target - h[k]) * (target > h[k] ? attack : release);
    }

    // The tone and the kicks are heard in the unsmoothed bins: the Smoothing setting only shapes the look.
    const bass = band(bins.freq, binHz, BANDS.bass);
    const level = bass * 0.5 + band(bins.freq, binHz, BANDS.mid) * 0.35 + band(bins.freq, binHz, BANDS.high) * 0.15;
    this.hearTone(bins, binHz, dt, level);

    // A kick: a sudden rise in the low end that lands on the beat (see KickHearer).
    if (this.kickHearer.hear(bins.freq, binHz, now) && now - this.lastKick > MIN_KICK_GAP) {
      this.lastKick = now;
      h.beat = 1;
      h.kick = true;
      this.hearTempo(now);
    }

    this.fillSpectrum(freq, bins.time, binHz);
  }

  // The bins smoothed the way the analyser smooths them: each bin's linear magnitude averaged with the
  // previous frames' by the Smoothing setting, then back to the analyser's dB byte scale. What the bands
  // and the spectrum texture read.
  private smooth(bins: Bins): Uint8Array {
    const { freq, minDecibels: lo, maxDecibels: hi } = bins;
    const amplitude = this.amplitudes(bins);
    if (this.magnitude.length !== freq.length) {
      this.magnitude = new Float32Array(freq.length);
      this.smoothed = new Uint8Array(freq.length);
    }
    const m = this.magnitude, out = this.smoothed, k = this.smoothing, scale = 255 / (hi - lo);
    for (let i = 0; i < freq.length; i++) {
      m[i] = k * m[i]! + (1 - k) * amplitude[freq[i]!]!;
      const db = m[i]! > 0 ? 20 * Math.log10(m[i]!) : -Infinity;
      out[i] = Math.min(255, Math.max(0, Math.floor(scale * (db - lo) + 1e-6)));
    }
    return out;
  }

  // The tempo: the median gap between the last kicks (averaged with the gaps close to it), folded into the
  // tempo range, held once known (a breakdown keeps it).
  private hearTempo(now: number): void {
    const kicks = this.kicks;
    kicks.push(now);
    if (kicks.length > KICK_WINDOW) kicks.shift();
    if (kicks.length < KICK_MIN) return;
    const gaps = kicks.slice(1).map((t, i) => t - kicks[i]!).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    const agreeing = gaps.filter((g) => Math.abs(g - median) <= median * 0.1);   // a missed or extra kick is left out
    const gap = agreeing.reduce((sum, g) => sum + g, 0) / agreeing.length;     // ... and frame timing averages out
    const bpm = foldTempo(Math.round(60 / gap));
    this.hearing.bpm = bpm;
    this.tempo.setBpm(bpm);
  }

  // The tone (timbral brightness): the spectral centroid (amplitude-weighted mean frequency), mapped
  // log-wise to 0 (dark, muffled) .. 1 (bright, crisp) and smoothed over a few seconds, so it follows
  // the character of the track rather than single hits. Quiet passages hold it.
  private hearTone(bins: Bins, binHz: number, dt: number, level: number): void {
    const amplitude = this.amplitudes(bins);
    const freq = bins.freq;
    const a = Math.ceil(60 / binHz), b = Math.min(freq.length - 1, Math.floor(16000 / binHz));
    let num = 0, den = 0;
    for (let i = a; i <= b; i++) {
      const amp = amplitude[freq[i]!]!;
      num += amp * i;
      den += amp;
    }
    const centroid = den > 0 ? (num / den) * binHz : 0;
    if (level < 0.04 || !centroid) return;
    const h = this.hearing, k = ease(dt, TONE_SECONDS);
    h.centroid += (centroid - h.centroid) * k;
    const t = (Math.log2(centroid) - Math.log2(BRIGHT_LOW_HZ)) / (Math.log2(BRIGHT_HIGH_HZ) - Math.log2(BRIGHT_LOW_HZ));
    h.bright += (clamp01(t) - h.bright) * k;
  }

  // Byte spectrum value -> linear amplitude (the analyser stores dB scaled to 0..255).
  private amplitudes(bins: Bins): Float32Array {
    const range = `${bins.minDecibels}:${bins.maxDecibels}`;
    if (range !== this.dbRange) {
      const { minDecibels: lo, maxDecibels: hi } = bins;
      this.amplitude = Float32Array.from({ length: 256 }, (_, b) => 10 ** ((lo + (b / 255) * (hi - lo)) / 20));
      this.dbRange = range;
    }
    return this.amplitude;
  }

  // Log-frequency spectrum (23 Hz .. 16 kHz) + downsampled waveform for the shaders.
  private fillSpectrum(freq: Uint8Array, time: Uint8Array, binHz: number): void {
    const minBin = 1;
    const maxBin = Math.min(freq.length - 2, Math.floor(16000 / binHz));
    const step = time.length / 256;
    for (let i = 0; i < 256; i++) {
      const pos = minBin * Math.pow(maxBin / minBin, i / 255);
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const v = (freq[idx]! * (1 - frac) + freq[idx + 1]! * frac) * (0.85 + (i / 255) * 0.5);
      this.spectrum[i * 2] = Math.min(255, v);
      this.spectrum[i * 2 + 1] = time[Math.floor(i * step)]!;
    }
  }
}

// Kicks: the sudden rises in the low end that land on the beat. A rise (positive spectral flux over the
// kick's bins) can't tell a kick from the rolling bassline between kicks, which rises in the same bins,
// often as strongly, nor from a kick the analyser has clipped at the top of its range. What sets the kick
// apart is that it comes back on every beat. So the rises of the last few seconds are kept as an onset
// envelope; the beat is the period it repeats at most strongly (its autocorrelation, at the beat and its
// multiples), placed where the strongest rises fall (a comb); and a kick is a clear rise where the next
// beat is due, one a beat at most. Rises off the beat (bass notes, hats) are not kicks.
const KICK_HZ = [20, 280] as const;   // the kick's body and its top, which still rises when the sub is clipped
const KICK_STRENGTH = 0.15;           // a kick rises at least this much of the rise usually heard on the beat
const ONSET_CELL = 0.01;              // seconds: the onset envelope's resolution, whatever the frame rate
const ONSET_HISTORY = 6;              // seconds of it the beat is read from ...
const ONSET_RECENT = 4;               // ... the last few seconds counting most (an exponential fade)
const ONSET_WARMUP = 1;               // seconds of it before the first reading
const BEAT_EVERY = 0.25;              // seconds between readings of the beat
const BEAT_RANGE = [60 / 200, 60 / 40] as const;   // seconds: the beat periods considered
const BEAT_MULTIPLES = 3;             // a beat's multiples (two beats, three) count toward it; a pattern off the beat's don't
const BEAT_PRIOR_BPM = 120, BEAT_PRIOR_OCTAVES = 0.9;   // where beats usually sit: a beat is preferred over its half and double
const BEAT_LOST = 2;                  // seconds without a beat in the rises before it's gone
const BEAT_DOUBLE = 0.9;              // how strongly the rises must repeat at half the beat to hear that as the beat
const BEAT_CLEAR = 0.1;               // how periodic the rises must be to hear a beat (autocorrelation at the beat, of 1)
const BEAT_WINDOW = 0.06;             // a kick lands within this part of a beat of where the beat is due
const BEAT_WINDOW_MIN = 0.025;        // seconds, at least: a frame and a half at 60 fps
const BEAT_PULL = 0.1;                // how far a kick moves the beat toward itself: one early rise can't drag it
const BEAT_STEADY = 4;                // kicks in a row a beat apart settle the beat ...
const BEAT_SWITCH = 8;                // ... and a settled beat changes only when another is heard this many readings in a row
const BEAT_PARTED = 3;                // an unsettled beat moves where the comb places it, this many readings in a row ...
const BEAT_PARTED_BY = 1.2;           // ... collecting this much more rise there than where the beat is kept

class KickHearer {
  private readonly cells = Math.round(ONSET_HISTORY / ONSET_CELL);
  private readonly onsets = new Float32Array(this.cells);   // a ring: the rise heard in each cell
  private readonly recency = Float32Array.from({ length: this.cells }, (_, k) => Math.exp((-k * ONSET_CELL) / ONSET_RECENT));
  private readonly centred = new Float64Array(this.cells);      // scratch for readBeat
  private readonly weighted = new Float64Array(this.cells);
  private readonly cumulative = new Float64Array(this.cells + 1);
  private cell = -1;           // the absolute index of the last cell written
  private filled = 0;          // cells written since the start (or a gap)
  private frameGap = 0;        // seconds since the frame before: at a low frame rate a kick is heard that late
  private older = new Float32Array(0);   // the kick's bins two frames ago ...
  private last = new Float32Array(0);    // ... and one
  private nextRead = 0;
  private period = 0;          // seconds a beat; 0 = no beat heard
  private beatRise = 0;        // the rise usually heard on the beat
  private due = 0;             // when the next beat is due
  private lastKick = -1e9;
  private kicked = -1e9;       // where the window of the last kick opened, its rise, and when its beat was due
  private kickedRise = 0;
  private kickedDue = 0;
  private peakTime = 0;        // the frame before: when, its rise, and the gap before it
  private peakRise = Infinity;
  private peakGap = 0;
  private steady = 0;          // kicks in a row a beat apart
  private challenger = 0;      // a beat heard other than the one kept ...
  private challenges = 0;      // ... in how many readings in a row
  private parted = 0;          // readings in a row the comb placed the beat elsewhere
  private clear = -1e9;        // when a beat was last heard in the rises

  reset(): void {
    this.cell = -1;
    this.filled = 0;
    this.period = 0;
    this.lastKick = this.clear = -1e9;
    this.steady = this.challenges = this.parted = 0;
  }

  hear(freq: Uint8Array, binHz: number, now: number): boolean {
    const rise = this.rise(freq, binHz);
    this.record(rise, now);
    if (now >= this.nextRead && this.filled * ONSET_CELL >= ONSET_WARMUP) {
      this.nextRead = now + BEAT_EVERY;
      this.readBeat(now);
    }
    // A kick is the peak of a rise: the frame before is judged once this one shows the rise has turned.
    const [t, peak, gap] = [this.peakTime, this.peakRise, this.peakGap];
    [this.peakTime, this.peakRise, this.peakGap] = [now, rise, this.frameGap];
    if (!(this.period > 0) || rise > peak) return false;
    const p = this.period, window = Math.max(p * BEAT_WINDOW, BEAT_WINDOW_MIN);
    // A stronger peak later in the window the kick was heard in: that was the kick, so the beat follows it
    // (the kick itself has been heard already).
    if (t <= this.kicked + window * 2 + gap && peak > this.kickedRise) {
      this.kickedRise = peak;
      this.due = this.kickedDue + p + (t - this.kickedDue) * BEAT_PULL;
      return false;
    }
    while (t > this.due + p / 2) this.due += p;   // a beat went by without a kick: the next one
    if (t < this.due - window || t > this.due + window + gap) return false;
    if (peak < this.beatRise * KICK_STRENGTH || peak < 8) return false;
    this.steady = Math.abs(t - this.lastKick - p) <= p * 0.1 ? this.steady + 1 : 0;
    this.lastKick = t;
    [this.kicked, this.kickedRise, this.kickedDue] = [this.due - window, peak, this.due];
    this.due += p + (t - this.due) * BEAT_PULL;
    return true;
  }

  // No beat in the rises: after a while of that, the beat is gone (until the rises repeat again).
  private lose(now: number): void {
    if (now - this.clear > BEAT_LOST) this.period = 0;
  }

  // The rise in the kick's bins since two frames ago (a kick's attack spans a frame or two), on the byte scale.
  private rise(freq: Uint8Array, binHz: number): number {
    const a = Math.max(1, Math.floor(KICK_HZ[0] / binHz)), b = Math.min(freq.length - 1, Math.ceil(KICK_HZ[1] / binHz));
    const current = Float32Array.from(freq.subarray(a, b + 1));
    const older = this.older.length === current.length ? this.older : current;
    let sum = 0;
    for (let i = 0; i < current.length; i++) sum += Math.max(0, current[i]! - older[i]!);
    this.older = this.last.length === current.length ? this.last : current;
    this.last = current;
    return sum;
  }

  // Writes the rise into the cells since the last frame, so the envelope is the same at any frame rate.
  private record(rise: number, now: number): void {
    const cell = Math.floor(now / ONSET_CELL);
    if (this.cell < 0 || cell <= this.cell - this.cells || cell - this.cell > this.cells) {   // a start, or a gap
      this.onsets.fill(0);
      this.filled = 0;
      this.cell = cell - 1;
      this.frameGap = 0;
    } else this.frameGap = Math.max(0, cell - this.cell) * ONSET_CELL;
    for (let c = this.cell + 1; c <= cell; c++) { this.onsets[c % this.cells] = rise; this.filled++; }
    this.cell = Math.max(this.cell, cell);
  }

  // The beat in the envelope: its period (where the autocorrelation peaks, at the beat and its multiples,
  // weighted toward the usual pulse) and where it falls (the phase whose beats collect the most rise).
  private readBeat(now: number): void {
    const n = Math.min(this.filled, this.cells), end = this.cell, w = this.recency;
    const at = (k: number) => this.onsets[(((end - k) % this.cells) + this.cells) % this.cells]!;   // k cells ago
    let mean = 0, total = 0, energy = 0;
    for (let k = 0; k < n; k++) { mean += at(k) * w[k]!; total += w[k]!; }
    mean /= total;
    const z = this.centred, wz = this.weighted, cw = this.cumulative;   // the envelope, newest first, about its mean
    for (let k = 0; k < n; k++) {
      z[k] = at(k) - mean;
      wz[k] = z[k]! * w[k]!;
      cw[k + 1] = cw[k]! + w[k]!;
      energy += z[k]! * wz[k]!;
    }
    energy /= total;
    if (energy <= 0) { this.lose(now); return; }
    const lo = Math.round(BEAT_RANGE[0] / ONSET_CELL), hi = Math.min(Math.round(BEAT_RANGE[1] / ONSET_CELL), Math.floor(n / 2));
    const reach = Math.max(hi + 1, Math.min(n - Math.round(1 / ONSET_CELL), BEAT_MULTIPLES * (hi + 1)));   // a second of overlap
    const acf = new Float64Array(reach + 2);
    for (let lag = lo - 1; lag <= reach; lag++) {
      let s = 0;
      for (let k = 0; k + lag < n; k++) s += wz[k]! * z[k + lag]!;
      acf[lag] = n > lag ? s / cw[n - lag]! : 0;
    }
    let best = -Infinity, bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let sum = 0, terms = 0;
      for (let m = 1; m <= BEAT_MULTIPLES && m * lag <= reach; m++) { sum += acf[m * lag]! / m; terms += 1 / m; }
      const prior = Math.exp(-0.5 * (Math.log2(60 / (lag * ONSET_CELL) / BEAT_PRIOR_BPM) / BEAT_PRIOR_OCTAVES) ** 2);
      if (acf[lag]! > 0 && (sum / terms) * prior > best) { best = (sum / terms) * prior; bestLag = lag; }
    }
    // A grid of kicks repeats at twice its beat as strongly as at its beat: the multiples can't tell 174 from
    // 87. Where the rises repeat as strongly at half the lag, the beat is that.
    const half = Math.round(bestLag / 2);
    if (half >= lo && acf[half]! >= acf[bestLag]! * BEAT_DOUBLE) bestLag = half;
    if (!bestLag || acf[bestLag]! / energy < BEAT_CLEAR) { this.lose(now); return; }
    this.clear = now;
    // The period to a fraction of a cell: from the peak at the furthest multiple in reach, divided back.
    let m = BEAT_MULTIPLES;
    while (m > 1 && m * bestLag + m + 1 > reach) m--;
    let peak = m * bestLag;
    for (let lag = m * bestLag - m; lag <= m * bestLag + m; lag++) if (acf[lag]! > acf[peak]!) peak = lag;
    const [l, c, r] = [acf[peak - 1]!, acf[peak]!, acf[peak + 1]!];
    const between = l - 2 * c + r < 0 ? Math.min(0.5, Math.max(-0.5, (0.5 * (l - r)) / (l - 2 * c + r))) : 0;
    const heard = ((peak + between) / m) * ONSET_CELL;

    // A settled beat holds until another is heard for a while: a bar of offbeat bass or a fill doesn't move it.
    const near = (a: number, b: number) => Math.abs(a - b) <= b * 0.04;
    if (!this.period || near(heard, this.period)) this.challenges = 0;
    else this.challenges = near(heard, this.challenger) ? this.challenges + 1 : 1;
    this.challenger = heard;
    const settled = this.steady >= BEAT_STEADY && now - this.lastKick < this.period * 4;
    const period = !settled || this.challenges === 0 || this.challenges >= BEAT_SWITCH ? heard : this.period;
    if (period === heard) this.challenges = 0;

    // Where the beat falls: the phase whose beats collect the most rise, the recent beats counting most.
    const lag = period / ONSET_CELL;
    const comb = (phase: number) => {
      let s = 0, weight = 1, beats = 0, plain = 0;
      for (let k = phase; k < n; k += lag) {
        const i = Math.round(k), v = Math.max(at(i), i > 0 ? at(i - 1) : 0, i + 1 < n ? at(i + 1) : 0);
        s += v * weight; plain += v; beats++; weight *= 0.9;
      }
      return { s, rise: plain / Math.max(1, beats) };
    };
    let phase = 0, top = -1;
    for (let k = 0; k < lag; k++) {
      const { s, rise } = comb(k);
      if (s > top) { top = s; phase = k; this.beatRise = rise; }
    }
    // The comb's beat against the one kept: while the kicks don't hold it in place, the comb's wins when it
    // clearly hears the beat elsewhere for a while.
    const last = now - phase * ONSET_CELL;
    const due = now - last < period * BEAT_WINDOW ? last : last + period;
    const keptPhase = Math.round(((((now - this.due + period) / ONSET_CELL) % lag) + lag) % lag) % Math.max(1, Math.round(lag));
    const apart = Math.abs(((((due - this.due + period / 2) % period) + period) % period) - period / 2) > period * BEAT_WINDOW;
    this.parted = this.period && !settled && apart && top > comb(keptPhase).s * BEAT_PARTED_BY ? this.parted + 1 : 0;
    if (!this.period || this.parted >= BEAT_PARTED) { this.due = due; this.parted = 0; }
    this.period = period;
  }
}

// A tempo halved or doubled until it lies in the tempo range: 72 (half-time) reads 144, 180 reads 90.
function foldTempo(bpm: number): number {
  const [lo, hi] = TEMPO_RANGE;
  while (bpm > hi) bpm = Math.round(bpm / 2);
  while (bpm < lo) bpm *= 2;
  return bpm;
}

// A band's mean byte level, 0..1.
function band(freq: Uint8Array, binHz: number, [lo, hi]: readonly [number, number]): number {
  const a = Math.max(1, Math.floor(lo / binHz));
  const b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += freq[i]!;
  return sum / ((b - a + 1) * 255);
}

// How the sound reads in words, for the meters, the assistant and the director: the mood and the tone,
// both 0..1, in thirds.
export type MoodWord = 'calm' | 'groovy' | 'energetic';
export type ToneWord = 'dark' | 'balanced' | 'bright';
const thirds = <T>(x: number, words: readonly [T, T, T]): T => (x < 0.35 ? words[0] : x > 0.65 ? words[2] : words[1]);
export const moodWord = (mood: number): MoodWord => thirds(mood, ['calm', 'groovy', 'energetic']);
export const toneWord = (bright: number): ToneWord => thirds(bright, ['dark', 'balanced', 'bright']);

// The sound now, as the assistant and the director are told it: no mood or tone while nothing plays.
export function soundNow(h: Readonly<Hearing>, playing: boolean, source: string | null) {
  return {
    source: source ?? 'none',
    bpm: h.bpm,
    mood: playing ? moodWord(h.mood) : null,
    tone: playing ? toneWord(h.bright) : null,
  };
}

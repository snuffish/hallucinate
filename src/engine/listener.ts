// What the music sounds like, heard once a frame from the analyser's bins: the band energies, the kicks
// and the tempo, the tone and the mood, and the spectrum texture the shaders read. The one owner of every
// threshold and time constant behind them; nothing outside reads the analysis' state, except the Hearing
// monitor through a snapshot made only while it watches. Pure: the tests drive it with synthetic bins.
//
//   listener.hear(audio.read(), music.playing, dt, now)   once a frame, on real time (seconds)
//   listener.reset()                                      a new source: the tempo starts over
//                                                         (as it does by itself after ~90 s without kicks)
//   listener.setSmoothing(prefs.audioSmoothing)           how calm the bands and the spectrum texture look
//   listener.watch(true) / listener.diagnostics()         the Hearing monitor: why it hears what it hears

import { TempoClock } from '../state/tempo-clock';
import { KickHearer, type KickSignal, type PulseCandidates } from './kick-hearer';
import { clamp01 } from './math';

const BANDS = { bass: [25, 140], mid: [140, 2000], high: [2000, 12000] } as const;
const BAND_KEYS = ['bass', 'mid', 'high', 'level'] as const;
const KICK_WINDOW = 12;        // the last kicks the tempo is estimated from
const KICK_MIN = 5;            // ... and how many it takes
const TEMPO_AGREE = 0.1;       // the gaps within this part of the median gap make the tempo
// The tone range, set from the spectral centroids of the reference clips: the darkest music (melodic techno
// ≈ 1.0 kHz, piano ≈ 1.4 kHz) sits at the dark end, and the brightest (Closer to Heaven ≈ 4.1–4.3 kHz, up to
// ≈ 5.5 kHz) well short of the bright end, so bright psytrance keeps moving instead of pinning at fully bright.
const BRIGHT_LOW_HZ = 1000;    // spectral centroid that counts as fully "dark"
const BRIGHT_HIGH_HZ = 8000;   // ... and fully "bright": three octaves up
const TONE_SECONDS = 2.5;      // the tone follows the character of the track, not single hits
const MOOD_SECONDS = 2;        // the mood follows the energy of the moment (itself heard over a few seconds) ...
const TRACK_SECONDS = 10;      // ... and the tempo of the track, which a brief misheard tempo hardly moves
const NEUTRAL_SECONDS = 4;     // nothing plays: the mood and the tone relax to neutral at this pace
const CALM_BPM = 80, ENERGETIC_BPM = 160;
// The energy: the level of the bands over the last few seconds, from 0 at QUIET (ambient without kicks, ≈ 0.42) to
// 1 at LOUD (the loudest psytrance drop, ≈ 0.77–0.80). Breakdowns measured 0.29–0.65, drops 0.62–0.77.
const QUIET_LEVEL = 0.45, LOUD_LEVEL = 0.8;
// The mood: the tempo sets where a track sits, the energy moves it from moment to moment. Over half is the
// tempo, so a forgotten tempo still lifts it halfway; the rest is enough to take a breakdown down by ~0.15.
const MOOD_TEMPO = 0.55, MOOD_ENERGY = 1 - MOOD_TEMPO;
export const TEMPO_RANGE = [85, 175] as const;   // BPM: a half or double reading is folded into it
const FORGET_SECONDS = 90;     // playing this long without a kick (longer than any breakdown) forgets the tempo
const HOLDING_TICKS = 4;       // this many ticks without a kick: the tempo is held, no longer heard
const WATCH_SECONDS = 6;       // the Hearing monitor's timeline: the kicks and ticks this far back
const FRAME_RATE_SECONDS = 2;  // ... and its frame rate: over the frames heard this far back

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
  mood: number;      // 0 calm … 1 energetic: the tempo sets where a track sits, the energy moves it
}

// Whether the tempo is heard in the kicks now, held through a breakdown, or not known.
export type TempoState = 'hearing' | 'holding' | 'none';

// What the Hearing monitor is shown: the hearing, and why the Listener hears it that way. Made on request.
export interface HearingDiagnostics {
  at: number;   // the Listener's clock when this was made, seconds: the kicks' and ticks' "seconds before now" count from it
  tempo: {
    bpm: number | null;        // the tempo, unrounded
    heardBpm: number | null;   // ... as the kicks' gaps gave it, before folding into the tempo range
    confidence: number;        // 0..1 how clearly the kicks repeat at the tempo; drains through a breakdown
    state: TempoState;
  };
  frameRate: number;   // frames a second heard lately; 0 while none come (paused, nothing connected)
  tickLag: number | null;   // ms the ticks land after their kicks lately (the median); null without a kick and its tick
  kicks: KickSignal & {
    kicks: number[];   // when each kick peaked, seconds before now, the latest last
    ticks: number[];   // when each tick came, likewise
  };
  candidates: PulseCandidates;   // the tempos the kicks could be, as last read
  bands: Record<(typeof BAND_KEYS)[number], {
    level: number;     // 0..1 the band's loudness this frame
    average: number;   // ... over the last few seconds: what the band is compared against
    shown: number;     // the band as the hearing gives it (see Hearing)
  }>;
  spectrum: {          // the analyser's bins as last heard; null while nothing is connected
    bins: Uint8Array;
    binHz: number;
    minDecibels: number;
    maxDecibels: number;
  } | null;
}

type Bands = Record<(typeof BAND_KEYS)[number], number>;
const ease = (dt: number, seconds: number) => 1 - Math.exp(-dt / seconds);

export class Listener {
  readonly hearing: Hearing = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, kick: false, tick: false, tickPhase: 0, ticks: 0, bpm: null, bright: 0.5, centroid: 0, energy: 0, mood: 0.5 };
  readonly spectrum = new Uint8Array(512);   // 256 texels * (log-frequency spectrum, waveform)

  private readonly tempo = new TempoClock();
  private readonly avg: Bands = { bass: 0.3, mid: 0.3, high: 0.3, level: 0.3 };
  private readonly raw: Bands = { bass: 0, mid: 0, high: 0, level: 0 };   // reused every frame
  private readonly kickHearer = new KickHearer();
  private readonly kicks = new Float64Array(KICK_WINDOW);   // when the last kicks were heard, oldest first ...
  private kickCount = 0;                                     // ... and how many there are
  private readonly gaps = new Float64Array(KICK_WINDOW - 1); // scratch for hearTempo
  private sinceKick = 0;   // seconds played since the last kick
  private kickGap = 0;     // seconds between kicks, as the tempo was last heard; 0 = none
  private watching = false;   // the Hearing monitor is open ...
  private kickTimes: number[] = [];   // ... and the kicks and ticks of the last few seconds since it opened
  private tickTimes: number[] = [];
  private frameTimes: number[] = [];   // ... and the frames heard
  private now = 0;
  private lastBins: Bins | null = null;
  private trackMood = 0.5; // the tempo's part of the mood, 0 calm … 1 energetic, eased over the track
  private amplitude = new Float32Array(256);   // byte -> linear amplitude, for the analyser's dB range
  private dbRange = '';
  private smoothing = 0.6;   // Settings → Audio (src/state/prefs.ts)
  private magnitude = new Float32Array(0);   // per bin, the smoothed linear magnitude
  private smoothed = new Uint8Array(0);      // ... back on the byte scale

  hear(bins: Bins | null, playing: boolean, dt: number, now: number): Readonly<Hearing> {
    const h = this.hearing;
    h.beat *= Math.exp(-dt * 5);
    h.kick = false;
    this.lastBins = bins;
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
    this.now = now;
    if (this.watching) this.remember(bins !== null, h.kick, h.tick, now);
    h.energy = clamp01((this.avg.level - QUIET_LEVEL) / (LOUD_LEVEL - QUIET_LEVEL));
    if (playing) {
      const tempo = h.bpm ? clamp01((h.bpm - CALM_BPM) / (ENERGETIC_BPM - CALM_BPM)) : 0.5;
      this.trackMood += (tempo - this.trackMood) * ease(dt, TRACK_SECONDS);
      h.mood += (this.trackMood * MOOD_TEMPO + h.energy * MOOD_ENERGY - h.mood) * ease(dt, MOOD_SECONDS);
    } else {   // nothing plays: the grade goes neutral
      h.mood += (0.5 - h.mood) * ease(dt, NEUTRAL_SECONDS);
      h.bright += (0.5 - h.bright) * ease(dt, NEUTRAL_SECONDS);
    }
    return h;
  }

  // How much each spectrum frame is averaged with the previous ones, for the bands and the spectrum
  // texture: higher is calmer, lower twitchier. Kicks are heard in the unsmoothed bins.
  setSmoothing(value: number): void {
    this.smoothing = value;
  }

  // The Hearing monitor opens or closes: only while it watches are diagnostics made.
  watch(on: boolean): void {
    this.watching = on;
    this.kickTimes = [];
    this.tickTimes = [];
    this.frameTimes = [];
  }

  // What the Hearing monitor is shown now, or null while it isn't watching.
  diagnostics(): HearingDiagnostics | null {
    if (!this.watching) return null;
    const h = this.hearing, gap = this.kickGap;
    const heardBpm = gap ? 60 / gap : null;
    const holding = h.bpm !== null && this.sinceKick > HOLDING_TICKS * (60 / h.bpm);
    const frames = this.frameTimes, span = frames.length > 1 ? frames.at(-1)! - frames[0]! : 0;
    return {
      at: this.now,
      frameRate: span > 0 ? (frames.length - 1) / span : 0,
      tickLag: this.tickLag(),
      tempo: {
        bpm: heardBpm && foldExact(heardBpm),
        heardBpm,
        confidence: h.bpm === null ? 0 : this.kickHearer.clarity,
        state: h.bpm === null ? 'none' : holding ? 'holding' : 'hearing',
      },
      kicks: {
        ...this.kickHearer.signal(this.now),
        kicks: this.kickTimes.map((t) => this.now - t),
        ticks: this.tickTimes.map((t) => this.now - t),
      },
      candidates: this.kickHearer.candidates(),
      bands: Object.fromEntries(BAND_KEYS.map((k) => [k, { level: this.raw[k], average: this.avg[k], shown: h[k] }])) as HearingDiagnostics['bands'],
      spectrum: this.lastBins && {
        bins: Uint8Array.from(this.lastBins.freq),
        binHz: this.lastBins.sampleRate / (this.lastBins.freq.length * 2),
        minDecibels: this.lastBins.minDecibels,
        maxDecibels: this.lastBins.maxDecibels,
      },
    };
  }

  // Each kick of the last few seconds against the tick nearest it (within half a tick): the median gap, in ms.
  private tickLag(): number | null {
    const bpm = this.hearing.bpm;
    if (!bpm) return null;
    const lags = this.kickTimes.flatMap((kick) => {
      const tick = this.tickTimes.reduce((best, t) => (Math.abs(t - kick) < Math.abs(best - kick) ? t : best), Infinity);
      return Math.abs(tick - kick) < 30 / bpm ? [(tick - kick) * 1000] : [];
    }).sort((a, b) => a - b);
    return lags.length ? lags[Math.floor(lags.length / 2)]! : null;
  }

  private remember(heard: boolean, kick: boolean, tick: boolean, now: number): void {
    if (heard) this.frameTimes.push(now);
    while (this.frameTimes.length && this.frameTimes[0]! < now - FRAME_RATE_SECONDS) this.frameTimes.shift();
    if (kick) this.kickTimes.push(this.kickHearer.lastKickAt);
    if (tick) this.tickTimes.push(now);
    for (const times of [this.kickTimes, this.tickTimes]) while (times.length && times[0]! < now - WATCH_SECONDS) times.shift();
  }

  // Forgets the tempo: the ticks stop and the mood lets it go, until enough kicks come to hear it again.
  reset(): void {
    this.kickCount = 0;
    this.kickHearer.reset();
    this.sinceKick = 0;
    this.kickGap = 0;
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
    raw.level = levelOf(raw.bass, raw.mid, raw.high);

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
    const level = levelOf(band(bins.freq, binHz, BANDS.bass), band(bins.freq, binHz, BANDS.mid), band(bins.freq, binHz, BANDS.high));
    this.hearTone(bins, binHz, dt, level);

    // A kick: a sudden rise in the low end, landing where the kicks before it say the next is due (see KickHearer).
    if (this.kickHearer.hear(bins.freq, binHz, now)) {
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
    if (this.kickCount === KICK_WINDOW) kicks.copyWithin(0, 1);
    else this.kickCount++;
    kicks[this.kickCount - 1] = now;
    if (this.kickCount < KICK_MIN) return;
    const gaps = this.gaps, count = this.kickCount - 1;
    for (let i = 0; i < count; i++) {   // the gaps between them, sorted as they go in
      const g = kicks[i + 1]! - kicks[i]!;
      let j = i;
      for (; j > 0 && gaps[j - 1]! > g; j--) gaps[j] = gaps[j - 1]!;
      gaps[j] = g;
    }
    const median = gaps[Math.floor(count / 2)]!;
    let sum = 0, agreeing = 0;
    for (let i = 0; i < count; i++) {   // a missed or extra kick is left out
      if (Math.abs(gaps[i]! - median) <= median * TEMPO_AGREE) { sum += gaps[i]!; agreeing++; }
    }
    const gap = sum / agreeing;   // ... and frame timing averages out
    this.kickGap = gap;
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

// A tempo halved or doubled until it lies in the tempo range: 72 (half-time) reads 144, 180 reads 90.
export function foldTempo(bpm: number): number {
  const [lo, hi] = TEMPO_RANGE;
  while (bpm > hi) bpm = Math.round(bpm / 2);
  while (bpm < lo) bpm *= 2;
  return bpm;
}

// foldTempo to a fraction of a BPM, for the Hearing monitor.
function foldExact(bpm: number): number {
  const [lo, hi] = TEMPO_RANGE;
  while (bpm > hi + 0.5) bpm /= 2;
  while (bpm < lo - 0.5) bpm *= 2;
  return bpm;
}

// The three bands together, the bass counting most.
const levelOf = (bass: number, mid: number, high: number) => bass * 0.5 + mid * 0.35 + high * 0.15;

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

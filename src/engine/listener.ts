// What the music sounds like, heard once a frame from the analyser's bins: the band energies, the kicks
// and the tempo, the tone and the mood, and the spectrum texture the shaders read. The one owner of every
// threshold and time constant behind them; nothing outside reads the analysis' state. Pure: the tests
// drive it with synthetic bins.
//
//   listener.hear(audio.read(), music.playing, dt, now)   once a frame, on real time (seconds)
//   listener.reset()                                      a new source: the tempo starts over

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
  readonly hearing: Hearing = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, kick: false, tick: false, bpm: null, bright: 0.5, centroid: 0, energy: 0, mood: 0.5 };
  readonly spectrum = new Uint8Array(512);   // 256 texels * (log-frequency spectrum, waveform)

  private readonly tempo = new TempoClock();
  private readonly avg: Bands = { bass: 0.3, mid: 0.3, high: 0.3, level: 0.3 };
  private readonly raw: Bands = { bass: 0, mid: 0, high: 0, level: 0 };   // reused every frame
  private kickAvg = 0.3;
  private kickArmed = true;
  private lastKick = -1e9;
  private kicks: number[] = [];
  private amplitude = new Float32Array(256);   // byte -> linear amplitude, for the analyser's dB range
  private dbRange = '';

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
    const ticked = h.kick && playing && this.tempo.onDetectedBeat(now);
    h.tick = playing && (this.tempo.advance(now) > 0 || ticked);
    h.energy = clamp01((this.avg.level - 0.15) / 0.4);
    const tempo = h.bpm ? clamp01((h.bpm - CALM_BPM) / (ENERGETIC_BPM - CALM_BPM)) : 0.5;
    h.mood += ((playing ? tempo * 0.65 + h.energy * 0.35 : 0.5) - h.mood) * ease(dt, MOOD_SECONDS);
    if (!playing) h.bright += (0.5 - h.bright) * ease(dt, MOOD_SECONDS);   // nothing plays: the grade goes neutral
    return h;
  }

  reset(): void {
    this.kicks = [];
    this.hearing.bpm = null;
    this.tempo.reset();
  }

  private listen(bins: Bins, dt: number, now: number): void {
    const h = this.hearing, raw = this.raw;
    const binHz = bins.sampleRate / (bins.freq.length * 2);
    raw.bass = band(bins.freq, binHz, BANDS.bass);
    raw.mid = band(bins.freq, binHz, BANDS.mid);
    raw.high = band(bins.freq, binHz, BANDS.high);
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

    this.hearTone(bins, binHz, dt, raw.level);

    // A kick: bass rising clearly above its ~1 s average, with hysteresis.
    this.kickAvg += (raw.bass - this.kickAvg) * ease(dt, 1);
    if (raw.bass < this.kickAvg) this.kickArmed = true;
    if (this.kickArmed && raw.bass > this.kickAvg * 1.12 + 0.02 && raw.bass > 0.15 && now - this.lastKick > MIN_KICK_GAP) {
      this.kickArmed = false;
      this.lastKick = now;
      h.beat = 1;
      h.kick = true;
      this.hearTempo(now);
    }

    this.fillSpectrum(bins, binHz);
  }

  // The tempo: the median gap between the last kicks, held once known (a breakdown keeps it).
  private hearTempo(now: number): void {
    const kicks = this.kicks;
    kicks.push(now);
    if (kicks.length > KICK_WINDOW) kicks.shift();
    if (kicks.length < KICK_MIN) return;
    const gaps = kicks.slice(1).map((t, i) => t - kicks[i]!).sort((a, b) => a - b);
    const bpm = Math.round(60 / gaps[Math.floor(gaps.length / 2)]!);
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
  private fillSpectrum(bins: Bins, binHz: number): void {
    const { freq, time } = bins;
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

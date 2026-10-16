// Audio sources -> AnalyserNode -> band energies, beat pulses and a spectrum texture.

const BANDS = { bass: [25, 140], mid: [140, 2000], high: [2000, 12000] } as const;
const BAND_KEYS = ['bass', 'mid', 'high', 'level'] as const;
const MIN_BEAT_GAP = 0.28; // seconds, caps detection at ~214 BPM
const BRIGHT_LOW_HZ = 1100;  // spectral centroid that counts as fully "dark" (piano/ambient ≈ 1.3 kHz)
const BRIGHT_HIGH_HZ = 5500; // ... and fully "bright" (hi-hat heavy house ≈ 5.3 kHz, psytrance ≈ 4.1 kHz)

export type AudioKind = 'file' | 'mic' | 'display' | 'demo';

export interface AudioFeatures {
  bass: number;
  mid: number;
  high: number;
  level: number;
  beat: number;
  bright: number;
  centroid: number;
}

type Bands = Record<(typeof BAND_KEYS)[number], number>;

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private demo: DemoSynth | null = null;
  private readonly elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  kind: AudioKind | null = null;
  onBeat: (() => void) | null = null;
  // A live input stopped by itself: a shared tab stopped sharing, the microphone went away.
  onEnded: ((kind: AudioKind) => void) | null = null;
  recordDest: MediaStreamAudioDestinationNode | null = null;
  private output: GainNode | null = null;
  private volume = 1;
  private demoRate = 1;
  private smoothing = 0.6;   // Settings → Audio (src/state/prefs.ts)

  private freq = new Uint8Array(0);
  private time = new Uint8Array(0);
  private amplitude = new Float32Array(256);

  readonly spectrum = new Uint8Array(512); // 256 texels * (spectrum, waveform)
  readonly features: AudioFeatures = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, bright: 0.5, centroid: 0 };
  readonly avg: Bands = { bass: 0.3, mid: 0.3, high: 0.3, level: 0.3 };
  private readonly raw: Bands = { bass: 0, mid: 0, high: 0, level: 0 };   // reused every frame
  private beatAvg = 0.3;
  private beatArmed = true;
  private lastBeat = 0;

  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = this.smoothing;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    // Byte spectrum value -> linear amplitude (the analyser stores dB scaled to 0..255).
    const { minDecibels: lo, maxDecibels: hi } = this.analyser;
    this.amplitude = Float32Array.from({ length: 256 }, (_, b) => 10 ** ((lo + (b / 255) * (hi - lo)) / 20));
    this.recordDest = ctx.createMediaStreamDestination();
    // Listening volume sits after the analyser, so the visuals react the same at any volume.
    this.output = ctx.createGain();
    this.output.gain.value = this.volume;
    this.output.connect(ctx.destination);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.output && this.ctx) this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // How much each spectrum frame is averaged with the previous ones: higher is calmer, lower twitchier.
  setSmoothing(value: number): void {
    this.smoothing = value;
    if (this.analyser) this.analyser.smoothingTimeConstant = value;
  }

  // Tempo of the demo loop (files use playbackRate instead).
  setDemoRate(rate: number): void {
    this.demoRate = rate;
    if (this.demo) this.demo.bpm = 124 * rate;
  }

  async ready(): Promise<void> {
    this.init();
    if (this.ctx!.state === 'suspended') await this.ctx!.resume();
  }

  detach(): void {
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.demo) this.demo.stop();
    this.source = this.stream = null;
    this.kind = null;
  }

  private attach(node: AudioNode, kind: AudioKind, audible: boolean): void {
    node.connect(this.analyser!);
    node.connect(this.recordDest!);
    if (audible) node.connect(this.output!);
    this.source = node;
    this.kind = kind;
  }

  async useElement(el: HTMLMediaElement): Promise<void> {
    await this.ready();
    this.detach();
    let node = this.elementSources.get(el);
    if (!node) { node = this.ctx!.createMediaElementSource(el); this.elementSources.set(el, node); }
    this.attach(node, 'file', true);
  }

  // The browser's voice processing is off by default: it would duck and gate the music.
  async useMicrophone(constraints: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }): Promise<void> {
    await this.ready();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this.detach();
    this.stream = stream;
    this.endWith(stream, 'mic');
    this.attach(this.ctx!.createMediaStreamSource(stream), 'mic', false);
  }

  // Captures a browser tab / the system. Great for Spotify, YouTube, etc.
  async useDisplayAudio(): Promise<void> {
    await this.ready();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' } as DisplayMediaStreamOptions);
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio was shared. Pick a tab or screen and tick "Share audio".');
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    this.detach();
    this.stream = stream;
    this.endWith(stream, 'display');
    this.attach(this.ctx!.createMediaStreamSource(stream), 'display', false);
  }

  // When the stream's audio ends while it is still the source, let go of it and say so.
  private endWith(stream: MediaStream, kind: AudioKind): void {
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.stream !== stream) return;
      this.detach();
      this.onEnded?.(kind);
    });
  }

  async useDemo(): Promise<void> {
    await this.ready();
    this.detach();
    this.demo ??= new DemoSynth(this.ctx!);
    this.demo.bpm = 124 * this.demoRate;
    this.demo.start();
    this.attach(this.demo.output, 'demo', true);
  }

  private band(lo: number, hi: number): number {
    const binHz = this.ctx!.sampleRate / this.analyser!.fftSize;
    const a = Math.max(1, Math.floor(lo / binHz));
    const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += this.freq[i]!;
    return sum / ((b - a + 1) * 255);
  }

  // Timbral brightness: the spectral centroid (amplitude-weighted mean frequency), mapped
  // log-wise to 0 (dark, muffled) .. 1 (bright, crisp) and smoothed over a few seconds so it
  // follows the character of the track rather than individual hits.
  private updateBrightness(dt: number, level: number): void {
    const binHz = this.ctx!.sampleRate / this.analyser!.fftSize;
    const a = Math.ceil(60 / binHz), b = Math.min(this.freq.length - 1, Math.floor(16000 / binHz));
    let num = 0, den = 0;
    for (let i = a; i <= b; i++) {
      const amp = this.amplitude[this.freq[i]!]!;
      num += amp * i;
      den += amp;
    }
    const f = this.features;
    const centroid = den > 0 ? (num / den) * binHz : 0;
    if (level < 0.04 || !centroid) return; // hold the last value through silence
    const ease = 1 - Math.exp(-dt / 2.5);
    f.centroid += (centroid - f.centroid) * ease;
    const t = (Math.log2(centroid) - Math.log2(BRIGHT_LOW_HZ)) / (Math.log2(BRIGHT_HIGH_HZ) - Math.log2(BRIGHT_LOW_HZ));
    f.bright += (Math.min(1, Math.max(0, t)) - f.bright) * ease;
  }

  update(dt: number, now: number): AudioFeatures {
    const f = this.features;
    f.beat *= Math.exp(-dt * 5);

    if (!this.source || !this.analyser) {
      for (const k of BAND_KEYS) f[k] *= Math.exp(-dt * 3);
      this.spectrum.fill(0);
      for (let i = 0; i < 256; i++) this.spectrum[i * 2 + 1] = 128;
      return f;
    }

    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    const raw = this.raw;
    raw.bass = this.band(BANDS.bass[0], BANDS.bass[1]);
    raw.mid = this.band(BANDS.mid[0], BANDS.mid[1]);
    raw.high = this.band(BANDS.high[0], BANDS.high[1]);
    raw.level = raw.bass * 0.5 + raw.mid * 0.35 + raw.high * 0.15;

    // Adaptive normalisation: compare against a slow running average so quiet and loud
    // tracks both drive the visuals, while keeping some absolute loudness in the mix.
    const slow = 1 - Math.exp(-dt / 2.5);
    const attack = 1 - Math.exp(-dt * 30);
    const release = 1 - Math.exp(-dt * 6);
    for (const k of BAND_KEYS) {
      this.avg[k] += (raw[k] - this.avg[k]) * slow;
      const avg = Math.max(this.avg[k], 0.05);
      const rel = Math.min(1, Math.max(0, (raw[k] - avg * 0.85) / (avg * 0.5)));
      const target = raw[k] < 0.02 ? 0 : Math.min(1, rel * 0.7 + raw[k] * 0.5);
      f[k] += (target - f[k]) * (target > f[k] ? attack : release);
    }

    this.updateBrightness(dt, raw.level);

    // Beat detection: bass rising clearly above its ~1s average, with hysteresis.
    this.beatAvg += (raw.bass - this.beatAvg) * (1 - Math.exp(-dt / 1.0));
    if (raw.bass < this.beatAvg) this.beatArmed = true;
    if (this.beatArmed && raw.bass > this.beatAvg * 1.12 + 0.02 && raw.bass > 0.15 && now - this.lastBeat > MIN_BEAT_GAP) {
      this.beatArmed = false;
      this.lastBeat = now;
      f.beat = 1;
      this.onBeat?.();
    }

    // Log-frequency spectrum (23 Hz .. 16 kHz) + downsampled waveform for the shaders.
    const binHz = this.ctx!.sampleRate / this.analyser.fftSize;
    const minBin = 1;
    const maxBin = Math.min(this.freq.length - 2, Math.floor(16000 / binHz));
    for (let i = 0; i < 256; i++) {
      const pos = minBin * Math.pow(maxBin / minBin, i / 255);
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const v = (this.freq[idx]! * (1 - frac) + this.freq[idx + 1]! * frac) * (0.85 + (i / 255) * 0.5);
      this.spectrum[i * 2] = Math.min(255, v);
      this.spectrum[i * 2 + 1] = this.time[i * 8]!;
    }
    return f;
  }

  dispose(): void {
    this.detach();
    this.demo = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.output = null;
    this.recordDest = null;
  }
}

// A small generated techno loop so the visuals can be tried without any music file.
class DemoSynth {
  readonly output: GainNode;
  bpm = 124;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly noise: AudioBuffer;
  private step = 0;
  private next = 0;

  constructor(private readonly ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.7;
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  start(): void {
    this.stop();
    this.step = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const stepLen = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += stepLen;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const roots = [55, 55, 43.65, 43.65, 65.41, 65.41, 49, 49]; // A F C G
    const root = roots[bar]!;

    if (s % 4 === 0) this.kick(t);
    if (s % 4 === 2) this.hat(t, 0.18, 0.09);
    else if (s % 2 === 1) this.hat(t, 0.06, 0.03);
    if (s === 4 || s === 12) this.clap(t);
    if (s % 4 !== 0) this.bass(t, s % 4 === 2 ? root * 2 : root);
    if (s === 0 && bar % 2 === 0) this.pad(t, root * 4, (60 / this.bpm) * 8);
    if (step >= 64 && s % 2 === 0) {
      const arp = [1, 1.5, 2, 2.4, 3, 2.4, 2, 1.5];
      this.pluck(t, root * 4 * arp[(s / 2) % 8]!);
    }
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.output);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  private noiseBurst(t: number, dur: number, filterType: BiquadFilterType, freq: number, dest: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    src.connect(f).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  private kick(t: number): void {
    const o = this.osc('sine', 160, t, 0.45, this.env(t, 1, 0.003, 0.4));
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  private hat(t: number, peak: number, decay: number): void { this.noiseBurst(t, decay + 0.02, 'highpass', 7500, this.env(t, peak, 0.001, decay)); }

  private clap(t: number): void { this.noiseBurst(t, 0.2, 'bandpass', 1500, this.env(t, 0.45, 0.002, 0.16)); }

  private bass(t: number, freq: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.15);
    f.connect(this.env(t, 0.35, 0.005, 0.16));
    this.osc('sawtooth', freq, t, 0.2, f);
  }

  private pad(t: number, freq: number, dur: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.output);
    for (const [ratio, detune] of [[1, -7], [1.19, 5], [1.5, -3], [2, 8]] as const) {
      this.osc('sawtooth', freq * ratio, t, dur, f).detune.value = detune;
    }
  }

  private pluck(t: number, freq: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    f.connect(this.env(t, 0.09, 0.002, 0.14));
    this.osc('square', freq, t, 0.18, f);
  }
}

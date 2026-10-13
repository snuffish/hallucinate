// Audio sources -> AnalyserNode -> band energies, beat pulses and a spectrum texture.

const BANDS = { bass: [25, 140], mid: [140, 2000], high: [2000, 12000] };
const MIN_BEAT_GAP = 0.28; // seconds, caps detection at ~214 BPM
const BRIGHT_LOW_HZ = 1100;  // spectral centroid that counts as fully "dark" (piano/ambient ≈ 1.3 kHz)
const BRIGHT_HIGH_HZ = 5500; // ... and fully "bright" (hi-hat heavy house ≈ 5.3 kHz, psytrance ≈ 4.1 kHz)

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.demo = null;
    this.elementSources = new WeakMap();
    this.kind = null;
    this.onBeat = null;

    this.spectrum = new Uint8Array(512); // 256 texels * (spectrum, waveform)
    this.features = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, bright: 0.5, centroid: 0 };
    this.avg = { bass: 0.3, mid: 0.3, high: 0.3, level: 0.3 };
    this.beatAvg = 0.3;
    this.beatArmed = true;
    this.lastBeat = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    // Byte spectrum value -> linear amplitude (the analyser stores dB scaled to 0..255).
    const { minDecibels: lo, maxDecibels: hi } = this.analyser;
    this.amplitude = Float32Array.from({ length: 256 }, (_, b) => 10 ** ((lo + (b / 255) * (hi - lo)) / 20));
    this.recordDest = ctx.createMediaStreamDestination();
    // Listening volume sits after the analyser, so the visuals react the same at any volume.
    this.output = ctx.createGain();
    this.output.gain.value = this.volume ?? 1;
    this.output.connect(ctx.destination);
  }

  setVolume(v) {
    this.volume = v;
    if (this.output) this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // Tempo of the demo loop (files use playbackRate instead).
  setDemoRate(rate) {
    this.demoRate = rate;
    if (this.demo) this.demo.bpm = 124 * rate;
  }

  async ready() {
    this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  detach() {
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.demo) this.demo.stop();
    this.source = this.stream = this.kind = null;
  }

  attach(node, kind, audible) {
    node.connect(this.analyser);
    node.connect(this.recordDest);
    if (audible) node.connect(this.output);
    this.source = node;
    this.kind = kind;
  }

  async useElement(el) {
    await this.ready();
    this.detach();
    if (!this.elementSources.has(el)) this.elementSources.set(el, this.ctx.createMediaElementSource(el));
    this.attach(this.elementSources.get(el), 'file', true);
  }

  async useMicrophone() {
    await this.ready();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.detach();
    this.stream = stream;
    this.attach(this.ctx.createMediaStreamSource(stream), 'mic', false);
  }

  // Captures a browser tab / the system. Great for Spotify, YouTube, etc.
  async useDisplayAudio() {
    await this.ready();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio was shared. Pick a tab or screen and tick "Share audio".');
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    this.detach();
    this.stream = stream;
    stream.getAudioTracks()[0].addEventListener('ended', () => { if (this.stream === stream) this.detach(); });
    this.attach(this.ctx.createMediaStreamSource(stream), 'display', false);
  }

  async useDemo() {
    await this.ready();
    this.detach();
    this.demo ??= new DemoSynth(this.ctx);
    this.demo.bpm = 124 * (this.demoRate ?? 1);
    this.demo.start();
    this.attach(this.demo.output, 'demo', true);
  }

  band(lo, hi) {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const a = Math.max(1, Math.floor(lo / binHz));
    const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += this.freq[i];
    return sum / ((b - a + 1) * 255);
  }

  // Timbral brightness: the spectral centroid (amplitude-weighted mean frequency), mapped
  // log-wise to 0 (dark, muffled) .. 1 (bright, crisp) and smoothed over a few seconds so it
  // follows the character of the track rather than individual hits.
  updateBrightness(dt, level) {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const a = Math.ceil(60 / binHz), b = Math.min(this.freq.length - 1, Math.floor(16000 / binHz));
    let num = 0, den = 0;
    for (let i = a; i <= b; i++) {
      const amp = this.amplitude[this.freq[i]];
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

  update(dt, now) {
    const f = this.features;
    f.beat *= Math.exp(-dt * 5);

    if (!this.source) {
      for (const k of ['bass', 'mid', 'high', 'level']) f[k] *= Math.exp(-dt * 3);
      this.spectrum.fill(0);
      for (let i = 0; i < 256; i++) this.spectrum[i * 2 + 1] = 128;
      return f;
    }

    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    const raw = {};
    for (const [k, [lo, hi]] of Object.entries(BANDS)) raw[k] = this.band(lo, hi);
    raw.level = raw.bass * 0.5 + raw.mid * 0.35 + raw.high * 0.15;

    // Adaptive normalisation: compare against a slow running average so quiet and loud
    // tracks both drive the visuals, while keeping some absolute loudness in the mix.
    const slow = 1 - Math.exp(-dt / 2.5);
    const attack = 1 - Math.exp(-dt * 30);
    const release = 1 - Math.exp(-dt * 6);
    for (const k of ['bass', 'mid', 'high', 'level']) {
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
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const minBin = 1;
    const maxBin = Math.min(this.freq.length - 2, Math.floor(16000 / binHz));
    for (let i = 0; i < 256; i++) {
      const pos = minBin * Math.pow(maxBin / minBin, i / 255);
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const v = (this.freq[idx] * (1 - frac) + this.freq[idx + 1] * frac) * (0.85 + (i / 255) * 0.5);
      this.spectrum[i * 2] = Math.min(255, v);
      this.spectrum[i * 2 + 1] = this.time[i * 8];
    }
    return f;
  }
}

// A small generated techno loop so the visuals can be tried without any music file.
class DemoSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.7;
    this.bpm = 124;
    this.timer = null;
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  start() {
    this.stop();
    this.step = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    const stepLen = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += stepLen;
      this.step = (this.step + 1) % 128;
    }
  }

  playStep(step, t) {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const roots = [55, 55, 43.65, 43.65, 65.41, 65.41, 49, 49]; // A F C G
    const root = roots[bar];

    if (s % 4 === 0) this.kick(t);
    if (s % 4 === 2) this.hat(t, 0.18, 0.09);
    else if (s % 2 === 1) this.hat(t, 0.06, 0.03);
    if (s === 4 || s === 12) this.clap(t);
    if (s % 4 !== 0) this.bass(t, s % 4 === 2 ? root * 2 : root);
    if (s === 0 && bar % 2 === 0) this.pad(t, root * 4, (60 / this.bpm) * 8);
    if (step >= 64 && s % 2 === 0) {
      const arp = [1, 1.5, 2, 2.4, 3, 2.4, 2, 1.5];
      this.pluck(t, root * 4 * arp[(s / 2) % 8]);
    }
  }

  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.output);
    return g;
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  noiseBurst(t, dur, filterType, freq, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    src.connect(f).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  kick(t) {
    const o = this.osc('sine', 160, t, 0.45, this.env(t, 1, 0.003, 0.4));
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  hat(t, peak, decay) { this.noiseBurst(t, decay + 0.02, 'highpass', 7500, this.env(t, peak, 0.001, decay)); }

  clap(t) { this.noiseBurst(t, 0.2, 'bandpass', 1500, this.env(t, 0.45, 0.002, 0.16)); }

  bass(t, freq) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.15);
    f.connect(this.env(t, 0.35, 0.005, 0.16));
    this.osc('sawtooth', freq, t, 0.2, f);
  }

  pad(t, freq, dur) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.output);
    for (const [ratio, detune] of [[1, -7], [1.19, 5], [1.5, -3], [2, 8]]) {
      this.osc('sawtooth', freq * ratio, t, dur, f).detune.value = detune;
    }
  }

  pluck(t, freq) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    f.connect(this.env(t, 0.09, 0.002, 0.14));
    this.osc('square', freq, t, 0.18, f);
  }
}

// Audio sources -> AnalyserNode: what plays (a file through the <audio> player, the microphone, a shared tab,
// the demo beat), how loud you hear it and what a recording takes. The analyser's bins go to the Listener
// (listener.ts), which hears what they sound like.

import type { Bins } from './listener';

export type AudioKind = 'file' | 'mic' | 'display' | 'demo';

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private demo: DemoSynth | null = null;
  private readonly elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  kind: AudioKind | null = null;   // what is connected (routing; whether the music plays is MusicSource.playing)
  // A live input stopped by itself: a shared tab stopped sharing, the microphone went away.
  onEnded: ((kind: AudioKind) => void) | null = null;
  recordDest: MediaStreamAudioDestinationNode | null = null;
  private output: GainNode | null = null;
  private volume = 1;
  private demoRate = 1;
  private audible = false;   // the source plays through the app's own output (not heard elsewhere)
  private bins: (Bins & { freq: Uint8Array<ArrayBuffer>; time: Uint8Array<ArrayBuffer> }) | null = null;

  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;   // unsmoothed: the Listener smooths what it shows (Settings → Audio)
    const { frequencyBinCount, fftSize, minDecibels, maxDecibels } = this.analyser;
    this.bins = { freq: new Uint8Array(frequencyBinCount), time: new Uint8Array(fftSize), sampleRate: ctx.sampleRate, minDecibels, maxDecibels };
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
    this.audible = audible;
  }

  // How long the sound takes from here to the speakers, in ms, as the browser reports it; music heard
  // outside the app (the microphone, a shared tab) never passes through here.
  latency(): number | 'outside' | null {
    if (!this.source || !this.ctx) return null;
    if (!this.audible) return 'outside';
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
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

  // This frame's bins, or null while nothing is connected. The arrays are reused: read them before the next call.
  read(): Bins | null {
    const { analyser, bins } = this;
    if (!this.source || !analyser || !bins) return null;
    analyser.getByteFrequencyData(bins.freq);
    analyser.getByteTimeDomainData(bins.time);
    return bins;
  }

  dispose(): void {
    this.detach();
    this.demo = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
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

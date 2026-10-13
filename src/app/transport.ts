// The music player's logic, without its buttons: play/pause, seek, ±10 s, previous/next track,
// loop, volume and tempo over the <audio> element (tempo = playbackRate); the demo beat gets
// play/pause, volume and tempo (its BPM). Volume and pitch mode are remembered.

import { z } from 'zod';
import type { AudioEngine } from '../engine/audio';
import { KEYS, readJSON, writeJSON } from '../state/persistence';
import type { TransportView } from '../state/ui-state';

const SettingsSchema = z.object({ volume: z.number().min(0).max(1).default(0.8), pitchFollows: z.boolean().default(false) });

export type TransportMode = 'element' | 'demo' | null;

export class Transport {
  mode: TransportMode = null;   // mic / tab audio: nothing to control
  scrubbing = false;
  volume: number;
  muted = false;
  pitchFollows: boolean;
  rate = 1;
  private hasQueue = false;
  private readonly unlisten: (() => void)[] = [];

  constructor(
    readonly el: HTMLAudioElement,
    private readonly audio: AudioEngine,
    private readonly publish: (view: TransportView) => void,
    private readonly hooks: { onPrev: () => boolean; onNext: () => boolean },
  ) {
    const saved = readJSON(KEYS.player, SettingsSchema, { volume: 0.8, pitchFollows: false });
    this.volume = saved.volume;
    this.pitchFollows = saved.pitchFollows;
    const on = (ev: string, fn: () => void) => { el.addEventListener(ev, fn); this.unlisten.push(() => el.removeEventListener(ev, fn)); };
    for (const ev of ['play', 'pause', 'playing', 'timeupdate', 'durationchange', 'loadedmetadata', 'ended']) on(ev, () => this.emit());
    on('loadedmetadata', () => this.applyRate());   // a new src resets playbackRate
    this.applyVolume();
    this.applyRate();
  }

  // hasQueue: SoundCloud results can be stepped through; a single local file can't.
  setMode(mode: TransportMode, { hasQueue = false } = {}): void {
    this.mode = mode;
    this.hasQueue = hasQueue;
    this.applyRate();
    this.emit();
  }

  prev(): void {
    if (this.el.currentTime > 3 || !this.hooks.onPrev()) this.el.currentTime = 0;   // restart, like most players
  }

  next(): void { this.hooks.onNext(); }

  skip(seconds: number): void {
    if (this.mode !== 'element' || !isFinite(this.el.duration)) return;
    this.el.currentTime = Math.min(this.el.duration - 0.1, Math.max(0, this.el.currentTime + seconds));
    this.emit();
  }

  seekTo(fraction: number): void {
    if (isFinite(this.el.duration)) this.el.currentTime = fraction * this.el.duration;
    this.emit();
  }

  setLoop(loop: boolean): void { this.el.loop = loop; this.emit(); }

  setVolume(v: number): number {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    this.save();
    return this.volume;
  }

  changeVolume(delta: number): number { return this.setVolume(this.volume + delta); }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  private applyVolume(): void {
    const v = this.muted ? 0 : this.volume;
    this.audio.setVolume(v * v);   // squared feels closer to even loudness steps
    this.emit();
  }

  setRate(rate: number): number {
    this.rate = Math.round(Math.min(2, Math.max(0.5, rate)) * 100) / 100;
    this.applyRate();
    return this.rate;
  }

  changeRate(delta: number): number { return this.setRate(this.rate + delta); }

  setPitchFollows(on: boolean): void {
    this.pitchFollows = on;
    this.applyRate();
    this.save();
  }

  private applyRate(): void {
    this.el.playbackRate = this.rate;
    this.el.preservesPitch = !this.pitchFollows;
    this.audio.setDemoRate(this.rate);
    this.emit();
  }

  get effectiveVolume(): number { return this.muted ? 0 : this.volume; }

  private emit(): void {
    const el = this.el;
    this.publish({
      mode: this.mode,
      hasQueue: this.hasQueue,
      playing: !el.paused,
      currentTime: el.currentTime,
      duration: isFinite(el.duration) ? el.duration : 0,
      loop: el.loop,
    });
  }

  private save(): void {
    writeJSON(KEYS.player, { volume: this.volume, pitchFollows: this.pitchFollows });
  }

  dispose(): void { for (const off of this.unlisten) off(); }
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// What the music is: which source button is playing, what the "now playing" line says, and the moves
// between them. A source starts here (a live input, or a file / track / video's sound through the
// <audio> player), pauses here, and ends here, including when the audio engine lets go of it by itself
// (a shared tab stops sharing, the microphone is unplugged). The only writer of `activeSource`.

import type { AudioKind } from '../engine/audio';
import type { AppState, SourceButton } from '../state/app-state';
import type { Transport } from './transport';

// The sources that play without the <audio> player.
export type LiveSource = 'mic' | 'display' | 'demo';

// What the music needs of the audio engine (AudioEngine).
export interface AudioRouting {
  readonly kind: AudioKind | null;
  onEnded: ((kind: AudioKind) => void) | null;   // a live input stopped by itself
  useElement(el: HTMLMediaElement): Promise<void>;
  useMicrophone(constraints?: MediaTrackConstraints): Promise<void>;
  useDisplayAudio(): Promise<void>;
  useDemo(): Promise<void>;
  detach(): void;
}

export interface MusicDeps {
  readonly audio: AudioRouting;
  readonly player: HTMLMediaElement;
  readonly state: Pick<AppState, 'activeSource'>;
  readonly transport: Pick<Transport, 'setMode'>;
  publish(view: { nowText: string; activeSource: SourceButton | null }): void;
  started(source: SourceButton): void;   // a source began playing (the controller resets the tempo, …)
}

const LABELS: Record<LiveSource, string> = { mic: 'Microphone / line-in', display: 'Tab / system audio', demo: 'Demo beat (124 BPM)' };
const ENDED: Partial<Record<AudioKind, string>> = {
  display: '❚❚ Tab audio stopped — share it again or pick another source',
  mic: '❚❚ The microphone stopped — pick a source',
};

export class MusicSource {
  private demoPaused = false;

  constructor(private readonly d: MusicDeps) {
    d.audio.onEnded = (kind) => this.ended(kind);
  }

  get active(): SourceButton | null { return this.d.state.activeSource; }

  // A live source. Throws what the browser refused (a permission, a cancelled capture).
  async start(kind: LiveSource, mic?: MediaTrackConstraints): Promise<void> {
    const audio = this.d.audio;
    this.d.player.pause();
    if (kind === 'mic') await audio.useMicrophone(mic);
    else if (kind === 'display') await audio.useDisplayAudio();
    else await audio.useDemo();
    this.playing(LABELS[kind], kind);
    this.d.transport.setMode(kind === 'demo' ? 'demo' : null);
  }

  // Through the <audio> player (a file, a SoundCloud track, a video's sound), so seeking works.
  // `hasQueue`: the source's results can be stepped through. Throws when it can't play.
  async play(src: string, label: string, as: SourceButton, { hasQueue = false } = {}): Promise<void> {
    const player = this.d.player;
    player.src = src;
    await this.d.audio.useElement(player);
    await player.play();
    this.playing(label, as);
    this.d.transport.setMode('element', { hasQueue });
  }

  // Play / pause: the player's, or the demo beat's (it stops, and starts again). Live input doesn't pause.
  async toggle(): Promise<void> {
    const { audio, player } = this.d;
    if (audio.kind === 'file') {
      if (player.paused) player.play().catch(() => {}); else player.pause();
    } else if (audio.kind === 'demo') {
      audio.detach();
      this.demoPaused = true;
      this.d.publish({ nowText: '❚❚ Demo beat paused', activeSource: this.active });
      this.d.transport.setMode('demo');
    } else if (!audio.kind && this.demoPaused) {
      await this.start('demo');
    }
  }

  // The music stops being what it was (the video's sound switched off): nothing plays until another
  // source is picked. `text` says why.
  stop(text: string): void {
    this.d.player.pause();
    this.set(null, text);
  }

  private playing(label: string, source: SourceButton): void {
    this.demoPaused = false;
    this.set(source, `▶ ${label}`);
    this.d.started(source);
  }

  // The engine let go of a live input by itself.
  private ended(kind: AudioKind): void {
    this.set(null, ENDED[kind] ?? '❚❚ The music stopped — pick a source');
    this.d.transport.setMode(null);
  }

  private set(source: SourceButton | null, nowText: string): void {
    this.d.state.activeSource = source;
    this.d.publish({ nowText, activeSource: source });
  }
}

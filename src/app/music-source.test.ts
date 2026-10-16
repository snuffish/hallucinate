import { describe, expect, it } from 'vitest';
import type { AudioKind } from '../engine/audio';
import type { SourceButton } from '../state/app-state';
import { MusicSource, type AudioRouting } from './music-source';
import type { TransportMode } from './transport';

// The audio engine and the <audio> player in memory; `end` is the engine letting go by itself.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function music(o: { refuse?: Error } = {}) {
  const audio: Mutable<AudioRouting> & { end(): void } = {
    kind: null as AudioKind | null,
    onEnded: null,
    async useElement() { audio.kind = 'file'; },
    async useMicrophone() { if (o.refuse) throw o.refuse; audio.kind = 'mic'; },
    async useDisplayAudio() { if (o.refuse) throw o.refuse; audio.kind = 'display'; },
    async useDemo() { audio.kind = 'demo'; },
    detach() { audio.kind = null; },
    end() { const k = audio.kind!; audio.kind = null; audio.onEnded?.(k); },
  };
  const player = { src: '', paused: true, async play() { if (player.src.includes('broken')) throw new Error('unsupported'); player.paused = false; }, pause() { player.paused = true; } };
  const state = { activeSource: null as SourceButton | null };
  const modes: TransportMode[] = [];
  const shown: string[] = [];
  const started: SourceButton[] = [];
  const m = new MusicSource({
    audio, player: player as unknown as HTMLMediaElement, state,
    transport: { setMode: (mode) => { modes.push(mode); } },
    publish: (v) => { shown.push(v.nowText); },
    started: (s) => { started.push(s); },
  });
  return { m, audio, player, state, modes, shown, started };
}

describe('MusicSource', () => {
  it('starts a live source, says so, and hands the transport what it can control', async () => {
    const { m, state, shown, started, modes } = music();
    await m.start('demo');
    expect(state.activeSource).toBe('demo');
    expect(shown.at(-1)).toBe('▶ Demo beat (124 BPM)');
    expect(started).toEqual(['demo']);
    expect(modes.at(-1)).toBe('demo');
    await m.start('display');
    expect(modes.at(-1)).toBeNull();
  });

  it('pauses the demo beat and starts it again', async () => {
    const { m, audio, state, shown, started } = music();
    await m.start('demo');
    await m.toggle();
    expect(audio.kind).toBeNull();
    expect(state.activeSource).toBe('demo');   // still the music, paused
    expect(shown.at(-1)).toBe('❚❚ Demo beat paused');
    await m.toggle();
    expect(audio.kind).toBe('demo');
    expect(started).toEqual(['demo', 'demo']);
  });

  it('does not start the demo beat on play when nothing was playing', async () => {
    const { m, audio } = music();
    await m.toggle();
    expect(audio.kind).toBeNull();
  });

  it('plays a file through the player, pauses and resumes it', async () => {
    const { m, player, state, shown, modes } = music();
    await m.play('blob:a', 'Track', 'soundcloud', { hasQueue: true });
    expect(state.activeSource).toBe('soundcloud');
    expect(shown.at(-1)).toBe('▶ Track');
    expect(modes.at(-1)).toBe('element');
    await m.toggle();
    expect(player.paused).toBe(true);
    await m.toggle();
    expect(player.paused).toBe(false);
  });

  it('keeps what was playing when a new one fails, and throws the reason', async () => {
    const { m, state } = music({ refuse: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) });
    await m.start('demo');
    await expect(m.start('mic')).rejects.toThrow('denied');
    await expect(m.play('broken.mp3', 'X', 'file')).rejects.toThrow('unsupported');
    expect(state.activeSource).toBe('demo');
  });

  it('says so when a shared tab stops sharing, instead of still claiming it plays', async () => {
    const { m, audio, state, shown, modes } = music();
    await m.start('display');
    audio.end();
    expect(state.activeSource).toBeNull();
    expect(shown.at(-1)).toBe('❚❚ Tab audio stopped — share it again or pick another source');
    expect(modes.at(-1)).toBeNull();
    await m.start('mic');
    audio.end();
    expect(shown.at(-1)).toBe('❚❚ The microphone stopped — pick a source');
  });

  it('is playing only while the music sounds: paused, stopped or ended, it is not', async () => {
    const { m, audio, player } = music();
    expect(m.playing).toBe(false);
    await m.play('blob:a', 'Track', 'file');
    expect(m.playing).toBe(true);
    await m.toggle();
    expect(m.playing).toBe(false);            // a paused file is still the source, but not playing
    await m.toggle();
    player.paused = true;                     // the track reached its end
    expect(m.playing).toBe(false);
    await m.start('demo');
    expect(m.playing).toBe(true);
    await m.toggle();
    expect(m.playing).toBe(false);            // the demo beat paused
    await m.start('mic');
    expect(m.playing).toBe(true);
    audio.end();
    expect(m.playing).toBe(false);
    await m.play('v.mp4', 'Clip', 'media');
    m.stop('❚❚ Video sound off — pick a music source');
    expect(m.playing).toBe(false);
  });

  it('stops being the music with the reason it gives', async () => {
    const { m, player, state, shown } = music();
    await m.play('v.mp4', 'Clip', 'media');
    m.stop('❚❚ Video sound off — pick a music source');
    expect(player.paused).toBe(true);
    expect(state.activeSource).toBeNull();
    expect(shown.at(-1)).toBe('❚❚ Video sound off — pick a music source');
  });
});

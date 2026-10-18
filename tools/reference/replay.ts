// Replays a recording through the Listener the way the app hears live music: one Listener.hear per frame,
// playing, on the recording's own frame timing. Returns the Hearing over time; nothing else of the
// Listener is read.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Listener, type Bins } from '../../src/engine/listener.ts';
import { decodeRecording, recordingFile, type Recording } from './recording.ts';

export const RECORDINGS_DIR = join(import.meta.dirname, '..', '..', 'reference', 'recordings');

/** What the Hearing said at one frame. */
export interface HeardFrame {
  t: number;              // seconds from the clip's start
  kick: boolean;
  tick: boolean;
  bpm: number | null;
  bright: number;         // the Tone
  mood: number;
  energy: number;
}

export interface Heard {
  frames: HeardFrame[];
  kicks: number[];        // when each kick was heard, seconds from the clip's start
  ticks: number[];        // ... each tick
  duration: number;
}

export function replay(recording: Recording, { smoothing = 0.6 } = {}): Heard {
  const { binCount, frameStep, frames: bytes } = recording;
  const listener = new Listener();
  listener.setSmoothing(smoothing);
  const time = new Uint8Array(recording.fftSize).fill(128);   // the waveform only feeds the spectrum texture
  const count = Math.floor(bytes.length / binCount);
  const heard: Heard = { frames: [], kicks: [], ticks: [], duration: count * frameStep };
  for (let f = 0; f < count; f++) {
    const t = (f + 1) * frameStep;
    const bins: Bins = {
      freq: bytes.subarray(f * binCount, (f + 1) * binCount), time,
      sampleRate: recording.sampleRate, minDecibels: recording.minDecibels, maxDecibels: recording.maxDecibels,
    };
    const h = listener.hear(bins, true, frameStep, t);
    heard.frames.push({ t, kick: h.kick, tick: h.tick, bpm: h.bpm, bright: h.bright, mood: h.mood, energy: h.energy });
    if (h.kick) heard.kicks.push(t);
    if (h.tick) heard.ticks.push(t);
  }
  return heard;
}

/** The clip's recording from reference/recordings/, or null when it hasn't been recorded. */
export async function loadRecording(name: string, dir = RECORDINGS_DIR): Promise<Recording | null> {
  try { return decodeRecording(await readFile(join(dir, recordingFile(name)))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}

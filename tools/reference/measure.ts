// Numbers measured from the Hearing of a replayed clip, for the real-music tests to hold against the
// clip's right answers (reference/clips.json). Windows are seconds from the clip's start.

import type { Window } from './list.ts';
import type { Heard, HeardFrame } from './replay.ts';

const inWindow = ([from, to]: Window) => (t: number) => t >= from && t < to;

/** Kicks heard in the window for each beat of the music at `bpm`. */
export function kicksPerBeat(heard: Heard, window: Window, bpm: number): number {
  const beats = ((window[1] - window[0]) * bpm) / 60;
  return heard.kicks.filter(inWindow(window)).length / beats;
}

export interface TickGrid {
  onGrid: number;         // 0..1 of the ticks within `toleranceMs` of the grid
  worstMs: number;        // the tick furthest off it
  ticksPerBeat: number;
}

/**
 * How close the ticks in the window fall to a steady grid of beats at `bpm`. The music's downbeat isn't
 * on the list, so the grid is placed where the ticks fit it best (their circular mean phase); ticks at
 * the wrong tempo spread around it and fall off.
 */
export function tickGrid(heard: Heard, window: Window, bpm: number, toleranceMs = 40): TickGrid {
  const beat = 60 / bpm;
  const ticks = heard.ticks.filter(inWindow(window));
  const ticksPerBeat = ticks.length / ((window[1] - window[0]) / beat);
  if (!ticks.length) return { onGrid: 0, worstMs: Infinity, ticksPerBeat };
  const angle = (t: number) => ((t % beat) / beat) * 2 * Math.PI;
  const phase = Math.atan2(ticks.reduce((s, t) => s + Math.sin(angle(t)), 0), ticks.reduce((s, t) => s + Math.cos(angle(t)), 0));
  const offsetsMs = ticks.map((t) => {
    const d = angle(t) - phase;
    return (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / (2 * Math.PI)) * beat * 1000;
  });
  return { onGrid: offsetsMs.filter((ms) => ms <= toleranceMs).length / ticks.length, worstMs: Math.max(...offsetsMs), ticksPerBeat };
}

type Part = 'bright' | 'mood' | 'energy';

/** The mean of a part of the Hearing over the window. */
export function mean(heard: Heard, window: Window, part: Part): number {
  const frames = heard.frames.filter((f) => inWindow(window)(f.t));
  return frames.reduce((s, f) => s + f[part], 0) / Math.max(1, frames.length);
}

const near = (bpm: number) => (f: HeardFrame) => f.bpm !== null && Math.abs(f.bpm - bpm) <= 1;

/** Seconds after `from` until the tempo is within ±1 of `bpm` and stays there to the end; null if it never does. */
export function tempoSettles(heard: Heard, bpm: number, from: number): number | null {
  const frames = heard.frames, ok = near(bpm);
  let i = frames.length;
  while (i > 0 && ok(frames[i - 1]!)) i--;
  if (i === frames.length) return null;
  return Math.max(0, frames[i]!.t - from);
}

/**
 * A published BPM as the Listener hears it: halved or doubled into the tempo range, 85–175 (issue #57). The
 * list keeps the published BPM; a half-time track at 82 is heard, and checked, as 164.
 */
export function tempoInRange(bpm: number): number {
  while (bpm > 175) bpm = Math.round(bpm / 2);
  while (bpm < 85) bpm *= 2;
  return bpm;
}

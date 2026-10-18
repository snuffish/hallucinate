// Suggests where to cut reference clips from a long mix, from its readings second by second. The
// maintainer listens to each suggestion and decides; nothing here says what a clip's BPM is.
//
// Kicks are told apart by the bass's share of the loudness: under kicks and a bassline the low band
// carries almost all of it (a few dB under the full mix); in a breakdown or an ambient passage it falls
// 15 dB or more below. A change of track shows as a step in the low band's pulse (its kick and bass
// pattern) or level between two stretches of kicks.

import { formatTime, type ClipType } from './list.ts';
import type { Reading } from './meter.ts';

export interface Suggestion { type: ClipType; start: number; length: number; reason: string }

export interface SuggestOptions { clipLength?: number; perType?: number }

const KICKS = -8;          // bass share (dB under the full mix) above which the kicks are in
const NO_KICKS = -12;      // ... and below which they are gone
const SMOOTH = 5;          // seconds, median over the share, so one odd second doesn't split a stretch
const BREAKDOWN = [8, 60]; // seconds without kicks that make a breakdown; longer is an ambient passage
const AROUND = 45;         // seconds of kicks compared on each side of a possible change of track
const CHANGE = 2;          // how big that change must be (see changeScore)

interface Run { start: number; end: number }   // [start, end) in seconds

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const dB = (x: number) => `${x.toFixed(0)} dB`;
const span = (from: number, to: number) => `${formatTime(from)}–${formatTime(to)}`;

/** Stretches where `inside` holds for every second. */
function runs(n: number, inside: (t: number) => boolean): Run[] {
  const out: Run[] = [];
  let start = -1;
  for (let t = 0; t <= n; t++) {
    const yes = t < n && inside(t);
    if (yes && start < 0) start = t;
    if (!yes && start >= 0) { out.push({ start, end: t }); start = -1; }
  }
  return out;
}

/** The best-scored windows that don't overlap each other, at most `count`. */
function pick<T extends { start: number; length: number; score: number }>(candidates: T[], count: number): T[] {
  const chosen: T[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (chosen.length === count) break;
    if (chosen.every((o) => c.start + c.length <= o.start || o.start + o.length <= c.start)) chosen.push(c);
  }
  return chosen;
}

export function suggestClips(readings: Reading[], { clipLength = 60, perType = 3 }: SuggestOptions = {}): Suggestion[] {
  const n = readings.length, L = clipLength;
  if (n < L) return [];
  const at = (t: number) => readings[t]!;
  const rawShare = readings.map((r) => r.low - r.loudness);
  const share = rawShare.map((_, t) => median(rawShare.slice(Math.max(0, t - (SMOOTH >> 1)), t + (SMOOTH >> 1) + 1)));
  const kicks = (t: number) => share[t]! > KICKS;
  const clamp = (start: number) => Math.min(Math.max(0, Math.round(start)), n - L);
  const low = (from: number, to: number) => mean(readings.slice(from, to).map((r) => r.low));

  const kickRuns = runs(n, kicks);
  const quietRuns = runs(n, (t) => share[t]! < NO_KICKS);
  const kicksBefore = (t: number) => kickRuns.find((k) => k.end <= t && t - k.end <= SMOOTH + 3);
  const kicksAfter = (t: number) => kickRuns.find((k) => k.start >= t && k.start - t <= SMOOTH + 3);

  // A full drop: a clip's length of unbroken kicks, as loud in the bass as the mix gets.
  const drops = pick(kickRuns.flatMap((k) => {
    const out = [];
    for (let s = k.start; s + L <= k.end; s += 5) out.push({ start: s, length: L, score: low(s, s + L) });
    return out;
  }), perType).map(({ start, length }): Suggestion => {
    const run = kickRuns.find((k) => k.start <= start && start + length <= k.end)!;
    const loud = mean(readings.slice(start, start + length).map((r) => r.loudness));
    const after = quietRuns.find((q) => q.end <= run.start && run.start - q.end <= SMOOTH + 3);
    return {
      type: 'drop', start, length,
      reason: `${span(start, start + length)}: kicks and bass all the way through (bass ${dB(low(start, start + length))}, loudness ${dB(loud)}), part of ${span(run.start, run.end)} without a break` +
        (after ? `, which starts as the kicks come back after a breakdown at ${formatTime(after.start)}` : ''),
    };
  });

  // A breakdown near a drop: a short stretch without kicks between two stretches of kicks, cut so the
  // clip ends 25 s into the drop that follows.
  const breakdowns = pick(quietRuns.filter((q) => {
    const length = q.end - q.start;
    return length >= BREAKDOWN[0]! && length <= BREAKDOWN[1]! && kicksBefore(q.start) && kicksAfter(q.end) && kicksAfter(q.end)!.end - kicksAfter(q.end)!.start >= 20;
  }).map((q) => {
    const drop = kicksAfter(q.end)!;
    const start = clamp(Math.max(q.start - 10, drop.start - (L - 25)));
    return { q, drop, start, length: L, score: low(drop.start, drop.start + 20) - low(q.start, q.end) };
  }), perType).map(({ q, drop, start, length, score }): Suggestion => ({
    type: 'breakdown', start, length,
    reason: `${span(start, start + length)}: the kicks stop at ${formatTime(q.start)}, the bass falls ${dB(score)} for ${q.end - q.start} s, and the kicks come back at ${formatTime(drop.start)}`,
  }));

  // A beatless ambient passage: the longest stretches without kicks.
  const ambient = pick(quietRuns.filter((q) => q.end - q.start >= 20).map((q) => ({
    q, start: clamp((q.start + q.end - L) / 2), length: L, score: q.end - q.start,
  })), perType).map(({ q, start, length }): Suggestion => ({
    type: 'ambient', start, length,
    reason: `${span(start, start + length)}: no kicks from ${formatTime(q.start)} to ${formatTime(q.end)} (${q.end - q.start} s${q.end - q.start < L ? ', shorter than the clip' : ''}), bass ${dB(low(q.start, q.end))}, ${dB(-median(share.slice(q.start, q.end)))} under the full mix`,
  }));

  // A transition between two tracks: the kick and bass pattern on one side differs from the other.
  const kickSeconds = (from: number, to: number) => {
    const out: Reading[] = [];
    for (let t = Math.max(0, from); t < Math.min(n, to); t++) if (kicks(t)) out.push(at(t));
    return out;
  };
  const changes = [];
  for (let t = AROUND; t < n - AROUND; t++) {
    const before = kickSeconds(t - AROUND, t), after = kickSeconds(t, t + AROUND);
    if (before.length < 20 || after.length < 20) continue;
    const pulse = [median(before.map((r) => r.pulse)), median(after.map((r) => r.pulse))] as const;
    const bass = [median(before.map((r) => r.low)), median(after.map((r) => r.low))] as const;
    const score = Math.abs(pulse[1] - pulse[0]) / 3 + Math.abs(bass[1] - bass[0]) / 2;
    if (score < CHANGE) continue;
    // Centre the clip on the gap between the old track's last kicks and the new one's first.
    let last = t; while (last > 0 && !kicks(last)) last--;
    let first = t; while (first < n - 1 && !kicks(first)) first++;
    if (first - last > L - 16) continue;   // keep at least 8 s of each track
    changes.push({ t, last, first, pulse, bass, start: clamp((last + first - L) / 2), length: L, score });
  }
  const transitions = pick(changes, perType).map(({ last, first, pulse, bass, start, length }): Suggestion => {
    let quiet = 0;
    for (let t = start; t < start + length; t++) if (!kicks(t)) quiet++;
    return {
      type: 'transition', start, length,
      reason: `${span(start, start + length)}: the kick and bass pattern changes around ${formatTime((last + first) / 2)} (pulse ${pulse[0].toFixed(0)} → ${pulse[1].toFixed(0)}, bass ${dB(bass[0])} → ${dB(bass[1])})` +
        (quiet > SMOOTH ? `, with ${quiet} s without kicks in the clip` : ', with no break in the kicks') + '; likely the next track',
    };
  });

  return [...drops, ...breakdowns, ...ambient, ...transitions];
}

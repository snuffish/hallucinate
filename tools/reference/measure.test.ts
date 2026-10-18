import { describe, expect, it } from 'vitest';
import { kicksPerBeat, mean, shareAbove, tempoInRange, tempoSettles, tickGrid } from './measure.ts';
import type { Heard, HeardFrame } from './replay.ts';

// A Hearing over `seconds` at 60 fps, with kicks and ticks at the given times and `at(t)` for the rest.
function heard(seconds: number, { kicks = [] as number[], ticks = [] as number[], at = (_t: number): Partial<HeardFrame> => ({}) } = {}): Heard {
  const frames: HeardFrame[] = [];
  for (let f = 1; f <= seconds * 60; f++) {
    const t = f / 60;
    frames.push({ t, kick: false, tick: false, bpm: null, bright: 0.5, mood: 0.5, energy: 0.5, ...at(t) });
  }
  return { frames, kicks, ticks, duration: seconds };
}

const grid = (from: number, to: number, step: number, offset = 0) =>
  Array.from({ length: Math.floor((to - from) / step) }, (_, i) => from + offset + i * step);

describe('measuring the Hearing of a clip', () => {
  it('counts the kicks per beat in a window', () => {
    const h = heard(60, { kicks: grid(0, 60, 0.5) });   // 120 BPM
    expect(kicksPerBeat(h, [10, 40], 120)).toBeCloseTo(1, 2);
    expect(kicksPerBeat(h, [10, 40], 60)).toBeCloseTo(2, 2);
    const every2nd = heard(60, { kicks: grid(0, 60, 1) });
    expect(kicksPerBeat(every2nd, [10, 40], 120)).toBeCloseTo(0.5, 2);
  });

  it('measures how close the ticks fall to a steady beat grid at the right BPM, wherever the grid starts', () => {
    const steady = tickGrid(heard(60, { ticks: grid(0, 60, 0.5, 0.123) }), [10, 40], 120);
    expect(steady.onGrid).toBe(1);
    expect(steady.worstMs).toBeLessThan(1);
    expect(steady.ticksPerBeat).toBeCloseTo(1, 2);

    // A tick 60 ms late every fourth beat: 3 in 4 on the grid, the worst ~45 ms off its fitted phase.
    const ticks = grid(0, 60, 0.5).map((t, i) => (i % 4 === 3 ? t + 0.06 : t));
    const wobbly = tickGrid(heard(60, { ticks }), [10, 40], 120);
    expect(wobbly.onGrid).toBeCloseTo(0.75, 1);
    expect(wobbly.worstMs).toBeGreaterThan(40);
  });

  it('finds ticks off the grid when they run at the wrong tempo', () => {
    const drifting = tickGrid(heard(60, { ticks: grid(0, 60, 60 / 118) }), [10, 40], 120);
    expect(drifting.onGrid).toBeLessThan(0.5);
  });

  it('averages a part of the Hearing over a window', () => {
    const h = heard(60, { at: (t) => ({ mood: t < 30 ? 0.2 : 0.8 }) });
    expect(mean(h, [0, 30], 'mood')).toBeCloseTo(0.2);
    expect(mean(h, [30, 60], 'mood')).toBeCloseTo(0.8);
  });

  it('measures how much of a window a part of the Hearing sits at or above a level', () => {
    const h = heard(60, { at: (t) => ({ bright: t < 15 ? 1 : 0.7 }) });
    expect(shareAbove(h, [0, 60], 'bright', 0.98)).toBeCloseTo(0.25, 2);
    expect(shareAbove(h, [30, 60], 'bright', 0.98)).toBe(0);
  });

  it('times how long after a moment the tempo settles on a BPM and stays there', () => {
    const h = heard(60, { at: (t) => ({ bpm: t < 20 ? 140 : t < 23 ? 150 : 145 }) });
    expect(tempoSettles(h, 145, 18)).toBeCloseTo(5, 1);
    expect(tempoSettles(h, 146, 0)).toBeCloseTo(23, 1);   // within ±1
    expect(tempoSettles(h, 140, 0)).toBeNull();           // it was there, but didn't stay
    expect(tempoSettles(heard(10), 140, 0)).toBeNull();   // no tempo at all
  });

  it('expects a published BPM folded into the tempo range (85–175), the way the Listener hears it', () => {
    expect([82, 70, 40, 85, 96, 144, 174, 175, 180, 200, 360].map(tempoInRange)).toEqual([164, 140, 160, 85, 96, 144, 174, 175, 90, 100, 90]);
  });
});

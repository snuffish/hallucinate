import { describe, expect, it } from 'vitest';
import { TempoClock } from './tempo-clock';

describe('TempoClock', () => {
  it('does nothing until a tempo is known', () => {
    const c = new TempoClock();
    expect(c.running).toBe(false);
    expect(c.onDetectedBeat(1)).toBe(false);
    expect(c.advance(5)).toBe(0);
  });

  it('ticks at the tempo through silence, anchored to the last real beat', () => {
    const c = new TempoClock();
    c.setBpm(120);                       // 0.5 s per beat
    expect(c.onDetectedBeat(10)).toBe(true);
    expect(c.advance(10.4)).toBe(0);
    expect(c.advance(10.5)).toBe(1);
    expect(c.advance(10.9)).toBe(0);
    expect(c.advance(11.0)).toBe(1);
    expect(c.advance(11.5)).toBe(1);     // no kicks at all, still counting
  });

  it('does not double count a kick that lands just after a scheduled tick', () => {
    const c = new TempoClock();
    c.setBpm(120);
    c.onDetectedBeat(10);
    expect(c.advance(10.5)).toBe(1);     // scheduled tick
    expect(c.onDetectedBeat(10.55)).toBe(false);   // the real kick, a hair late: no extra tick
    expect(c.advance(11.04)).toBe(0);    // but the phase moved to the real kick
    expect(c.advance(11.05)).toBe(1);
  });

  it('catches up by at most one tick after a stall and keeps the rate on a tempo change', () => {
    const c = new TempoClock();
    c.setBpm(120);
    c.onDetectedBeat(0);
    expect(c.advance(5)).toBe(1);        // the tab was hidden for 5 s: one tick, not ten
    expect(c.advance(5.4)).toBe(0);
    c.setBpm(60);                        // slower: next tick one second after the last one
    expect(c.advance(5.9)).toBe(0);
    expect(c.advance(6.0)).toBe(1);
    expect(c.bpm).toBe(60);
  });
});

import { describe, expect, it } from 'vitest';
import type { Reading } from './meter.ts';
import { suggestClips, type Suggestion } from './suggest.ts';

// A mix described in sections, one reading per second.
type Section = { seconds: number; loudness: number; low: number; pulse: number };
const beat = (seconds: number, o: Partial<Section> = {}): Section => ({ seconds, loudness: -12, low: -13.5, pulse: 15, ...o });
const beatless = (seconds: number, o: Partial<Section> = {}): Section => ({ seconds, loudness: -22, low: -40, pulse: 10, ...o });

const mix = (...sections: Section[]): Reading[] => {
  const out: Reading[] = [];
  for (const s of sections) for (let i = 0; i < s.seconds; i++) out.push({ t: out.length, loudness: s.loudness, low: s.low, pulse: s.pulse });
  return out;
};

const of = (type: Suggestion['type'], all: Suggestion[]) => all.filter((s) => s.type === type);
const inside = (s: Suggestion, from: number, to: number) => s.start >= from && s.start + s.length <= to;

describe('clip suggestions', () => {
  // 0–60 intro without kicks, 60–340 track A (louder from 190), 340–380 breakdown, 380–640 track B (another
  // kick pattern), 640–730 a long beatless passage, 730–840 track B again.
  const MIX = mix(
    beatless(60),
    beat(130), beat(150, { loudness: -10, low: -11 }),
    beatless(40),
    beat(260, { pulse: 22 }),
    beatless(90, { loudness: -26, low: -45 }),
    beat(110, { pulse: 22 }),
  );
  const all = suggestClips(MIX);

  it('suggests a full drop inside the loudest stretch of unbroken kicks, loudest first', () => {
    const drops = of('drop', all);
    expect(drops.length).toBeGreaterThan(0);
    expect(inside(drops[0]!, 190, 340)).toBe(true);
    for (const d of drops) expect(d.length).toBe(60);
  });

  it('suggests a breakdown with the drop that follows it in the same clip', () => {
    const [b] = of('breakdown', all);
    expect(b!.start).toBeLessThan(370);
    expect(b!.start + b!.length).toBeGreaterThan(400);
  });

  it('suggests the longest beatless passage as the ambient clip', () => {
    const [a] = of('ambient', all);
    expect(inside(a!, 640, 730)).toBe(true);
  });

  it('suggests a transition where the kick pattern changes from one track to the next', () => {
    const transitions = of('transition', all);
    expect(transitions.some((t) => t.start < 340 && t.start + t.length > 380)).toBe(true);
  });

  it('gives each suggestion a short reason with its times', () => {
    for (const s of all) expect(s.reason).toMatch(/\d+:\d\d/);
  });

  it('suggests clips that never overlap within a type, and never past the end of the mix', () => {
    for (const type of ['drop', 'breakdown', 'ambient', 'transition'] as const) {
      const clips = of(type, all).sort((a, b) => a.start - b.start);
      clips.forEach((c, i) => { if (i) expect(c.start).toBeGreaterThanOrEqual(clips[i - 1]!.start + clips[i - 1]!.length); });
    }
    for (const s of all) { expect(s.start).toBeGreaterThanOrEqual(0); expect(s.start + s.length).toBeLessThanOrEqual(MIX.length); }
  });

  it('suggests no drop, breakdown or transition in music without kicks', () => {
    const calm = suggestClips(mix(beatless(600)));
    expect(calm.map((s) => s.type)).toEqual(['ambient']);
  });
});

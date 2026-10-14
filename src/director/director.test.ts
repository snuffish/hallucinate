import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestInput } from './digest';
import { cycleDue } from './director';
import { DirectorHistory } from './history';

describe('director cadence', () => {
  it('on beats: after N beats, or two minutes without them', () => {
    expect(cycleDue('beats', 127, 128, 10_000, 120)).toBe(false);
    expect(cycleDue('beats', 128, 128, 10_000, 120)).toBe(true);
    expect(cycleDue('beats', 0, 128, 119_000, 120)).toBe(false);
    expect(cycleDue('beats', 0, 128, 120_000, 120)).toBe(true);
  });

  it('on the timer: after N seconds, beats or not', () => {
    expect(cycleDue('seconds', 500, 64, 29_000, 30)).toBe(false);
    expect(cycleDue('seconds', 0, 64, 30_000, 30)).toBe(true);
    expect(cycleDue('seconds', 0, 64, 121_000, 600)).toBe(false);   // no two-minute fallback on the timer
  });
});

const base: DigestInput = {
  bpm: 124, mood: 'energetic', tone: 'bright', source: 'demo', elapsedSeconds: 754, media: false,
  trend: { level: [0.4, 0.5, 0.6], bass: [0.3, 0.4, 0.5], bright: [0.5, 0.5, 0.6], direction: 'rising' },
  cues: [
    { id: 'a', name: 'Opener', scene: 'Hyper Tunnel', category: 'Tunnel & 3D', hue: 0.1, missing: false },
    { id: 'b', name: 'Peak', scene: 'Star Nest', category: 'Space', hue: 0.7, missing: false },
    { id: 'c', name: 'Gone', scene: 'Old', category: null, hue: null, missing: true },
  ],
  liveId: 'a', previewId: 'b',
  transition: { mode: 'fade', seconds: 2.3 },
  autopilot: { on: true, unit: 'beats', beats: 32, beatsElapsed: 11, beatsTarget: 32, seconds: 30, secondsElapsed: 4 },
  plan: { steps: [{ cue: 'a', beats: 32, maxSeconds: 90 }, { cue: 'b', beats: 64, mode: 'cut', maxSeconds: 90 }], note: 'build up', loop: true },
  planIndex: 0, cycle: { unit: 'beats', every: 128 },
  decisions: [{ at: 600, note: 'build up' }],
  userTouched: true,
};

describe('director digest', () => {
  it('says everything the model needs in a few lines, with names for ids', () => {
    const d = buildDigest(base);
    expect(d.startsWith('Director cycle.')).toBe(true);
    expect(d).toContain('124 BPM · mood energetic · tone bright · source demo · 12:34 into the set');
    expect(d).toContain('rising): level 0.4 → 0.5 → 0.6');
    expect(d).toContain('Live "Opener" · Preview "Peak" · transition fade 2.3 s · autopilot on, 11/32 beats');
    expect(d).toContain('1. a · "Opener" · Hyper Tunnel · Tunnel & 3D · hue 0.10');
    expect(d).toContain('MISSING SCENE');
    expect(d).toContain('PLAN (step 1 playing, loops, note: "build up"):');
    expect(d).toContain('2. "Peak" 64 beats cut');
    expect(d).toContain('RECENT DECISIONS: 10:00 "build up"');
    expect(d).toContain('changed the show by hand');
    expect(d.length).toBeLessThan(2000);
  });

  it('says when the autopilot runs on the timer', () => {
    const d = buildDigest({ ...base, autopilot: { ...base.autopilot, unit: 'seconds', secondsElapsed: 12.4 } });
    expect(d).toContain('autopilot on the timer (every 30 s per step, plan beats are ignored), 12 s into the current step');
    expect(buildDigest({ ...base, cycle: { unit: 'seconds', every: 90 } })).toContain('next cycle in 90 s');
  });

  it('handles an empty show and no tempo', () => {
    const d = buildDigest({ ...base, bpm: null, mood: null, tone: null, cues: [], liveId: null, previewId: null, plan: null, planIndex: -1, decisions: [], userTouched: false, trend: { level: [], bass: [], bright: [], direction: 'unknown' } });
    expect(d).toContain('no tempo yet · mood — · tone —');
    expect(d).toContain('level — · bass —');
    expect(d).toContain('PLAN: none (list order)');
    expect(d).toContain('RECENT DECISIONS: none yet');
    expect(d).toContain('no changes by hand');
  });

  it('stays the same size cycle after cycle (the app, not the thread, is the memory)', () => {
    const h = new DirectorHistory();
    const sizes: number[] = [];
    for (let cycle = 0; cycle < 100; cycle++) {
      for (let b = 0; b < 128; b++) h.sample({ level: Math.random(), bass: Math.random(), bright: Math.random() });
      h.markCycle();
      h.decide(`cycle ${cycle}: keep building`, cycle * 60);
      sizes.push(buildDigest({ ...base, trend: h.trend(), decisions: h.decisions, elapsedSeconds: cycle * 60 }).length);
    }
    const first = sizes[9]!, last = sizes[99]!;   // after the decision log has filled up
    expect(Math.abs(last - first) / first).toBeLessThan(0.1);
  });
});

describe('director history', () => {
  it('averages energy per cycle window and reads the direction', () => {
    const h = new DirectorHistory();
    for (const level of [0.2, 0.4, 0.6, 0.8]) {
      for (let i = 0; i < 10; i++) h.sample({ level, bass: level / 2, bright: 0.5 });
      h.markCycle();
    }
    for (let i = 0; i < 5; i++) h.sample({ level: 0.9, bass: 0.45, bright: 0.5 });   // the current, partial window
    const t = h.trend();
    expect(t.level).toEqual([0.4, 0.6, 0.8, 0.9]);   // the last four windows
    expect(t.bass).toEqual([0.2, 0.3, 0.4, 0.45]);
    expect(t.direction).toBe('rising');
  });

  it('keeps the last eight decisions', () => {
    const h = new DirectorHistory();
    for (let i = 0; i < 12; i++) h.decide(`d${i}`, i);
    expect(h.decisions.map((d) => d.note)).toEqual(['d4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11']);
  });

  it('is unknown with fewer than two windows', () => {
    const h = new DirectorHistory();
    h.sample({ level: 0.5, bass: 0.5, bright: 0.5 });
    expect(h.trend().direction).toBe('unknown');
  });
});

// The Listener against real music: each clip on the reference list (reference/clips.json) whose recording
// is in reference/recordings/ (npm run clips && npm run clips:record) is replayed through Listener.hear,
// and the Hearing is held against the clip's right answers. Clips without a recording are skipped, so CI
// and a fresh clone pass. Each clip logs what was measured.
//
// Checks today's Listener fails are listed in EXPECTED_TO_FAIL below: they run as `it.fails`, so the suite
// stays green and tells you when one starts passing. To turn a check on, delete it from the list.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseReferenceList, type Clip, type Window } from './list.ts';
import { kicksPerBeat, mean, tempoSettles, tickGrid, type TickGrid } from './measure.ts';
import { loadRecording, replay, type Heard } from './replay.ts';

// The right answers (docs/reference-clips.md, issue #57).
const BPM_TOLERANCE = 1;                    // the tempo heard, within ±1 of the BPM given by ear
const KICKS_PER_BEAT = [0.9, 1.1] as const; // in the drop
const TICK_TOLERANCE_MS = 40;               // a tick this close to the beat grid is on it ...
const TICKS_ON_GRID = 0.9;                  // ... and this many of the drop's ticks are
const CLEARLY_HIGHER = 0.1;                 // tone and mood, drop over breakdown (each 0..1)
const FORGET_SECONDS = 90;                  // the tempo is forgotten this long after the last kick
const SETTLE_SECONDS = 5;                   // the tempo reaches a transition's new BPM this soon

type Check = 'bpm' | 'kicks' | 'ticks' | 'tone' | 'mood' | 'forgotten' | 'transition';

// The ticket that turns each check on.
const TICKET: Record<Check, string> = { bpm: '#63', kicks: '#62', ticks: '#62', tone: '#65', mood: '#65', forgotten: '#63', transition: '#63' };

// Which checks fail on today's Listener, per clip. A check listed here runs as `it.fails`: green while it
// fails, red once it passes, which is the cue to delete it from here.
const EXPECTED_TO_FAIL: Record<string, Check[]> = {
  'lazy-which-way-drop': ['bpm', 'kicks', 'ticks'],
  'lazy-new-moon-to-light-breakdown': ['bpm', 'kicks', 'ticks', 'tone'],
  'lazy-light-to-ring-of-clouds-transition': ['bpm', 'kicks', 'ticks', 'transition'],
  'lazy-frozen-to-earthbound-ambient': ['forgotten'],
  'closer-to-heaven-breakdown': ['bpm', 'kicks', 'ticks', 'tone'],
  'deep-jungle-walk-breakdown': ['bpm', 'kicks', 'ticks', 'tone', 'mood'],
  'singularity-drop': ['bpm', 'kicks', 'ticks'],
  'says-ambient': ['forgotten'],
};

const list = parseReferenceList(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'reference', 'clips.json'), 'utf8')));

// The checks a clip's right answers allow, and how each is judged.
interface Measured {
  bpm: number | null;   // at the end of the clip
  kicksPerBeat?: number;
  ticks?: TickGrid;
  tone?: [drop: number, breakdown: number];
  mood?: [drop: number, breakdown: number];
  lastKick: number | null;
  lastTick: number | null;
  settles?: number | null;
}

function measure(clip: Clip, heard: Heard): Measured {
  const m: Measured = { bpm: heard.frames.at(-1)?.bpm ?? null, lastKick: heard.kicks.at(-1) ?? null, lastTick: heard.ticks.at(-1) ?? null };
  if (clip.drop && clip.bpm) {
    m.kicksPerBeat = kicksPerBeat(heard, clip.drop, clip.bpm);
    m.ticks = tickGrid(heard, clip.drop, clip.bpm, TICK_TOLERANCE_MS);
  }
  if (clip.drop && clip.breakdown) {
    m.tone = [mean(heard, clip.drop, 'bright'), mean(heard, clip.breakdown, 'bright')];
    m.mood = [mean(heard, clip.drop, 'mood'), mean(heard, clip.breakdown, 'mood')];
  }
  if (clip.type === 'transition' && clip.drop && clip.bpm) m.settles = tempoSettles(heard, clip.bpm, clip.drop[0]);
  return m;
}

const fmt = (x: number | null | undefined, digits = 2) => (x == null ? '–' : x.toFixed(digits));
const span = ([from, to]: Window) => `${from}–${to} s`;

function report(clip: Clip, m: Measured): string {
  const parts = [`bpm ${m.bpm ?? 'none'}${clip.bpm ? ` (by ear ${clip.bpm})` : ''}`];
  if (m.kicksPerBeat !== undefined) parts.push(`kicks/beat ${fmt(m.kicksPerBeat)} in drop ${span(clip.drop!)}`);
  if (m.ticks) parts.push(`ticks on grid ${Math.round(m.ticks.onGrid * 100)}% (worst ${fmt(m.ticks.worstMs, 0)} ms, ${fmt(m.ticks.ticksPerBeat)}/beat)`);
  if (m.tone) parts.push(`tone drop ${fmt(m.tone[0])} / breakdown ${fmt(m.tone[1])}`);
  if (m.mood) parts.push(`mood drop ${fmt(m.mood[0])} / breakdown ${fmt(m.mood[1])}`);
  parts.push(`last kick ${fmt(m.lastKick, 1)} s, last tick ${fmt(m.lastTick, 1)} s`);
  if (m.settles !== undefined) parts.push(`settles ${m.settles === null ? 'never' : `${fmt(m.settles, 1)} s`} after ${clip.drop![0]} s`);
  return `${clip.name} (${clip.type}): ${parts.join(', ')}`;
}

// Each check as a test: its name, and the assertion against the measured numbers.
function checksFor(clip: Clip): [Check, string, (m: Measured) => void][] {
  const checks: [Check, string, (m: Measured) => void][] = [];
  const { bpm, drop, breakdown } = clip;
  if (bpm) checks.push(['bpm', `hears ${bpm} BPM (±${BPM_TOLERANCE})`, (m) => {
    expect(m.bpm).not.toBeNull();
    expect(Math.abs(m.bpm! - bpm)).toBeLessThanOrEqual(BPM_TOLERANCE);
  }]);
  if (drop && bpm) {
    checks.push(['kicks', `hears ${KICKS_PER_BEAT.join('–')} kicks per beat in the drop`, (m) => {
      expect(m.kicksPerBeat).toBeGreaterThanOrEqual(KICKS_PER_BEAT[0]);
      expect(m.kicksPerBeat).toBeLessThanOrEqual(KICKS_PER_BEAT[1]);
    }]);
    checks.push(['ticks', `ticks on the beat grid in the drop (${TICKS_ON_GRID * 100}% within ${TICK_TOLERANCE_MS} ms)`, (m) => {
      expect(m.ticks!.ticksPerBeat).toBeGreaterThanOrEqual(KICKS_PER_BEAT[0]);
      expect(m.ticks!.ticksPerBeat).toBeLessThanOrEqual(KICKS_PER_BEAT[1]);
      expect(m.ticks!.onGrid).toBeGreaterThanOrEqual(TICKS_ON_GRID);
    }]);
  }
  if (drop && breakdown) {
    checks.push(['tone', 'tone is clearly higher in the drop than in the breakdown', (m) => {
      expect(m.tone![0] - m.tone![1]).toBeGreaterThanOrEqual(CLEARLY_HIGHER);
    }]);
    checks.push(['mood', 'mood is clearly higher in the drop than in the breakdown', (m) => {
      expect(m.mood![0] - m.mood![1]).toBeGreaterThanOrEqual(CLEARLY_HIGHER);
    }]);
  }
  if (clip.type === 'ambient') checks.push(['forgotten', `forgets the tempo and stops ticking within ${FORGET_SECONDS} s of the last kick`, (m) => {
    expect(m.bpm).toBeNull();
    if (m.lastTick !== null) expect(m.lastTick - (m.lastKick ?? 0)).toBeLessThanOrEqual(FORGET_SECONDS);
  }]);
  if (clip.type === 'transition' && bpm) checks.push(['transition', `reaches ${bpm} BPM within ${SETTLE_SECONDS} s of the new track (the drop window)`, (m) => {
    expect(m.settles, 'a transition clip needs a drop window: where the new track starts').toBeDefined();
    expect(m.settles).not.toBeNull();
    expect(m.settles!).toBeLessThanOrEqual(SETTLE_SECONDS);
  }]);
  return checks;
}

describe('the Listener on real music', () => {
  if (!list.clips.length) it.skip('has no clips on the reference list yet', () => {});

  it('expects failures only of clips on the list and checks they have', () => {
    for (const [name, checks] of Object.entries(EXPECTED_TO_FAIL)) {
      const clip = list.clips.find((c) => c.name === name);
      expect(clip, `EXPECTED_TO_FAIL names "${name}", which is not on the reference list`).toBeDefined();
      const has = checksFor(clip!).map(([check]) => check);
      for (const check of checks) expect(has, `"${name}" has no "${check}" check`).toContain(check);
    }
  });

  for (const clip of list.clips) {
    describe(clip.name, async () => {
      const recording = await loadRecording(clip.name);
      let measured: Measured;
      beforeAll(() => {
        if (!recording) return;
        measured = measure(clip, replay(recording));
        console.log(report(clip, measured));
      });

      for (const [check, title, assert] of checksFor(clip)) {
        const expectedToFail = EXPECTED_TO_FAIL[clip.name]?.includes(check);
        const test = !recording ? it.skip : expectedToFail ? it.fails : it;
        test(`${title}${expectedToFail ? ` [expected to fail until ${TICKET[check]}]` : ''}${recording ? '' : ' [no recording]'}`, () => {
          try { assert(measured); }
          catch (e) {
            if (!expectedToFail) (e as Error).message += `\n(If today's Listener is known to fail this, add '${check}' to EXPECTED_TO_FAIL['${clip.name}'].)`;
            throw e;
          }
        });
      }
    });
  }
});

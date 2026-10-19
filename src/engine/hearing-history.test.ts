import { describe, expect, it } from 'vitest';
import { HISTORY_SECONDS, HearingRecorder } from './hearing-history';
import type { HearingDiagnostics } from './listener';
import { stillUniforms } from './scene-inputs';

const CELL = 0.01;

// What the monitor is shown at `at`: kicks and ticks given as times, the rises as [seconds before `at`, rise] pairs.
function shown(at: number, { kicks = [] as number[], ticks = [] as number[], rises = [] as [number, number][], bpm = 120 as number | null } = {}): HearingDiagnostics {
  const cells = new Float32Array(600);
  for (const [ago, rise] of rises) cells[cells.length - 1 - Math.round(ago / CELL)] = rise;
  const band = (level: number) => ({ level, average: 0.3, shown: level });
  return {
    at,
    frameRate: 60,
    tickLag: null,
    tempo: { bpm, heardBpm: bpm, confidence: 0.8, state: 'hearing' },
    kicks: { rises: cells, cell: CELL, threshold: 12, due: [], window: 0.03, kicks: kicks.map((t) => at - t), ticks: ticks.map((t) => at - t) },
    candidates: { bpm: [], strength: [], preference: [], clear: 0.1 },
    bands: { bass: band(0.7), mid: band(0.4), high: band(0.2), level: band(0.5) },
    spectrum: null,
  };
}

describe('the Hearing monitor\'s last minute', () => {
  it('keeps one sample per view shown, with the tempo, the bands and the scene inputs then', () => {
    const r = new HearingRecorder();
    r.record(shown(10), stillUniforms());
    const h = r.record(shown(10.07, { bpm: 124 }), stillUniforms({ uBeat: 1 }));
    expect(h.samples.map((s) => s.at)).toEqual([10, 10.07]);
    expect(h.samples[1]).toMatchObject({ bpm: 124, confidence: 0.8, threshold: 12, bands: { bass: 0.7, level: 0.5 } });
    expect(h.samples[1]!.inputs.uBeat).toBe(1);
  });

  it('keeps each kick and tick once, though every view lists the last 6 s of them', () => {
    const r = new HearingRecorder();
    r.record(shown(10, { kicks: [9.5], ticks: [9.51] }), stillUniforms());
    r.record(shown(10.07, { kicks: [9.5], ticks: [9.51] }), stillUniforms());
    const h = r.record(shown(10.5, { kicks: [9.5, 10.0], ticks: [9.51, 10.01] }), stillUniforms());
    expect(h.kicks).toEqual([9.5, 10.0]);
    expect(h.ticks).toEqual([9.51, 10.01]);
  });

  it('takes the highest rise since the sample before, so a kick between two views still shows', () => {
    const r = new HearingRecorder();
    r.record(shown(10), stillUniforms());
    const h = r.record(shown(10.1, { rises: [[0.05, 40], [0.02, 25], [0.3, 99]] }), stillUniforms());
    expect(h.samples[1]!.rise).toBe(40);   // the 99 came before the sample at 10
  });

  it('forgets what is older than a minute', () => {
    const r = new HearingRecorder();
    r.record(shown(10, { kicks: [9.9] }), stillUniforms());
    r.record(shown(40, { kicks: [39.9] }), stillUniforms());
    const h = r.record(shown(10 + HISTORY_SECONDS + 1, { kicks: [] }), stillUniforms());
    expect(h.samples.map((s) => s.at)).toEqual([40, 71]);
    expect(h.kicks).toEqual([39.9]);
  });

  it('ignores a view from the same moment again, and starts over when cleared', () => {
    const r = new HearingRecorder();
    r.record(shown(10), stillUniforms());
    expect(r.record(shown(10), stillUniforms()).samples).toHaveLength(1);
    r.clear();
    expect(r.history()).toEqual({ samples: [], kicks: [], ticks: [] });
  });

  it('hands out new arrays, so the monitor redraws', () => {
    const r = new HearingRecorder();
    const a = r.record(shown(10), stillUniforms()), b = r.record(shown(10.07), stillUniforms());
    expect(b.samples).not.toBe(a.samples);
    expect(a.samples).toHaveLength(1);
  });
});

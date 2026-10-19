import { describe, expect, it } from 'vitest';
import { SCENE_INPUTS } from '../engine/scene-inputs';
import { AXIS_HEIGHT, LANE_GAP, LANE_HEIGHT, PRESETS, SIGNALS, lanesFor, parseWorkbench, peaksOver, presetOf, sampleAt, toggleSignal } from './hearing-workbench';

describe('the Hearing monitor\'s plot', () => {
  it('offers every scene input as a signal, and presets of signals it knows', () => {
    const ids = new Set(SIGNALS.map((s) => s.id));
    for (const { uniform } of SCENE_INPUTS) expect(ids.has(uniform), uniform).toBe(true);
    for (const [name, signals] of Object.entries(PRESETS)) for (const id of signals) expect(ids.has(id), `${name}: ${id}`).toBe(true);
  });

  it('shows or hides a signal, or only that one, and names the preset that shows exactly what is on', () => {
    expect(toggleSignal(['rise', 'kicks'], 'kicks')).toEqual(['rise']);
    expect(toggleSignal(['rise'], 'kicks')).toEqual(['rise', 'kicks']);
    expect(toggleSignal(['rise', 'kicks'], 'uBeat', true)).toEqual(['uBeat']);
    expect(presetOf([...PRESETS.Kicks!].reverse())).toBe('Kicks');
    expect(presetOf(['rise'])).toBeNull();
  });

  it('gives each group with a signal on its own lane, in order', () => {
    const { lanes, height } = lanesFor(['uBeat', 'rise', 'bpm']);
    expect(lanes.map((l) => l.group)).toEqual(['kicks', 'scene', 'tempo']);
    expect(lanes[1]!.top).toBe(LANE_HEIGHT.kicks + LANE_GAP);
    expect(height).toBe(LANE_HEIGHT.kicks + LANE_HEIGHT.scene + LANE_HEIGHT.tempo + 3 * LANE_GAP + AXIS_HEIGHT);
    expect(lanesFor([])).toEqual({ lanes: [], height: 0 });
  });

  it('remembers what was picked; unknown signals and a broken setting fall back', () => {
    expect(parseWorkbench({ signals: ['rise', 'gone'], span: 20 })).toEqual({ signals: ['rise'], span: 20 });
    expect(parseWorkbench(undefined)).toEqual({ signals: [...PRESETS.Overview!], span: 6 });
    expect(parseWorkbench({ span: 30 })).toEqual({ signals: [...PRESETS.Overview!], span: 6 });
  });

  it('finds the rise peaks a different threshold would let through, a kick\'s gap apart', () => {
    const cell = 0.01, rises = new Float32Array(600);
    rises[100] = 30;   // 4.99 s ago
    rises[110] = 28;   // 0.1 s later: too close to be another kick
    rises[300] = 15;   // 2.99 s ago
    rises[500] = 8;    // under either line
    expect(peaksOver(rises, cell, 20).map((a) => a.toFixed(2))).toEqual(['4.99']);
    expect(peaksOver(rises, cell, 12).map((a) => a.toFixed(2))).toEqual(['4.99', '2.99']);
  });

  it('reads the values nearest a moment', () => {
    const s = (at: number) => ({ at, rise: 0, threshold: 0, bpm: null, confidence: 0, bands: { bass: 0, mid: 0, high: 0, level: 0 }, inputs: {} as never });
    expect(sampleAt([s(1), s(2), s(3)], 2.4)?.at).toBe(2);
    expect(sampleAt([], 2)).toBeNull();
  });
});

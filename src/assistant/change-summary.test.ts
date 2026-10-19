import { describe, expect, it } from 'vitest';
import type { Cue } from '../app/studio';
import { colourOf, formatValue, showLines, valueRows } from './change-summary';

const cue = (id: string, name: string, extra: Partial<Cue> = {}): Cue => ({ id, name, scene: name, values: {}, look: {}, effects: [], ...extra } as Cue);

describe('change summary', () => {
  it('lists only the values that changed', () => {
    expect(valueRows({ hue: 0.1, speed: 1 }, { hue: 0.5, speed: 1 })).toEqual([{ key: 'hue', before: 0.1, after: 0.5 }]);
    expect(formatValue(0.123456)).toBe('0.123');
    expect(formatValue(true)).toBe('on');
    expect(formatValue([1, 0.5, 0])).toBe('(1, 0.5, 0)');
    expect(colourOf([1, 0.5, 0])).toBe('rgb(255, 128, 0)');
    expect(colourOf([2, 0, 0])).toBeNull();
  });

  it('says which show scenes were added, removed, changed and moved, and what the plan became', () => {
    const before = { cues: [cue('a', 'Tunnel'), cue('b', 'Vortex', { look: { hue: 0.2 } })], plan: null };
    const after = {
      cues: [cue('b', 'Vortex fast', { scene: 'Vortex', look: { hue: 0.5 } }), cue('c', 'Drop', { scene: 'Scope Ring' })],
      plan: { steps: [{ cue: 'b', beats: 32, maxSeconds: 90 }, { cue: 'c', beats: 64, maxSeconds: 90 }], note: 'Build up', loop: true },
    };
    expect(showLines(before, after)).toEqual([
      '+ Added “Drop” (Scope Ring)',
      '− Removed “Tunnel”',
      '~ “Vortex”: renamed to “Vortex fast”; look hue 0.2 → 0.5',
      'Plan: none → 2 steps, looping: Vortex fast 32 · Drop 64',
      '  “Build up”',
    ]);
  });

  it('notices a new order', () => {
    const a = cue('a', 'A'), b = cue('b', 'B');
    expect(showLines({ cues: [a, b], plan: null }, { cues: [b, a], plan: null })).toEqual(['↕ New order: B, A']);
  });
});

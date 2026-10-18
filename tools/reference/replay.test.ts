import { describe, expect, it } from 'vitest';
import { RECORDING_VERSION, type Recording } from './recording.ts';
import { replay } from './replay.ts';

// A recording as the analyser would make it of a kick drum at `bpm` over a bed of sound, `seconds` long.
function kickGrid(bpm: number, seconds: number, frameStep = 1 / 60): Recording {
  const binCount = 1024, binHz = 48000 / 2048, beat = 60 / bpm;
  const count = Math.floor(seconds / frameStep);
  const frames = new Uint8Array(count * binCount);
  for (let f = 0; f < count; f++) {
    const kick = 255 * Math.exp(-(((f + 1) * frameStep) % beat) / 0.1);
    for (let i = 0; i < binCount; i++) frames[f * binCount + i] = Math.round(i * binHz < 140 ? Math.max(36, kick) : 120);
  }
  return { version: RECORDING_VERSION, audio: 'x', sampleRate: 48000, frameStep, fftSize: 2048, minDecibels: -100, maxDecibels: -30, binCount, frames };
}

describe('replaying a recording through the Listener', () => {
  it('hears every frame on the recording\'s own timing, while playing', () => {
    const heard = replay(kickGrid(120, 4));
    expect(heard.frames).toHaveLength(240);
    expect(heard.frames[0]!.t).toBeCloseTo(1 / 60);
    expect(heard.frames[239]!.t).toBeCloseTo(4);
    expect(heard.duration).toBeCloseTo(4);
  });

  it('returns the Hearing over time: the kicks and ticks it heard, the tempo, tone and mood', () => {
    const heard = replay(kickGrid(120, 20));
    const late = heard.kicks.filter((t) => t > 5);
    expect(late.length).toBeGreaterThan(25);
    for (const t of late) expect(Math.abs(t - Math.round(t * 2) / 2)).toBeLessThan(0.04);   // on the 0.5 s grid
    expect(heard.ticks.length).toBeGreaterThan(25);
    const last = heard.frames.at(-1)!;
    expect(last.bpm).toBe(120);
    expect(last.bright).toBeGreaterThanOrEqual(0);
    expect(last.mood).toBeGreaterThan(0);
    expect(last.energy).toBeGreaterThan(0);
  });

  it('hears at another frame step too', () => {
    const heard = replay(kickGrid(120, 20, 1 / 30));
    expect(heard.frames).toHaveLength(600);
    expect(heard.frames.at(-1)!.bpm).toBeGreaterThanOrEqual(119);
    expect(heard.frames.at(-1)!.bpm).toBeLessThanOrEqual(121);
  });
});

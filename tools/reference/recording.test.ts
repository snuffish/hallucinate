import { describe, expect, it } from 'vitest';
import { decodeRecording, encodeRecording, isUpToDate, RECORDING_VERSION, type Recording } from './recording.ts';

const recording = (audio = 'abc'): Recording => ({
  version: RECORDING_VERSION, audio, sampleRate: 48000, frameStep: 1 / 60, fftSize: 2048, minDecibels: -100, maxDecibels: -30,
  binCount: 4, frames: Uint8Array.from([1, 2, 3, 4, 250, 251, 252, 253, 0, 0, 0, 9]),
});

describe('a recording', () => {
  it('keeps the bins of every frame, with the sample rate, frame step and the analyser it was heard with', () => {
    expect(decodeRecording(encodeRecording(recording()))).toEqual(recording());
  });

  it('is not mistaken for something else', () => {
    expect(() => decodeRecording(new TextEncoder().encode('{"not": "a recording"}'))).toThrow(/not a recording/);
  });

  it('is up to date while it was made from the same audio by the same recorder', () => {
    expect(isUpToDate(recording('abc'), 'abc')).toBe(true);
    expect(isUpToDate(recording('abc'), 'def')).toBe(false);
    expect(isUpToDate({ ...recording('abc'), version: RECORDING_VERSION - 1 }, 'abc')).toBe(false);
    expect(isUpToDate(null, 'abc')).toBe(false);
  });
});

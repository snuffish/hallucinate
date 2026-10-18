import { describe, expect, it } from 'vitest';
import { meter } from './meter.ts';

const RATE = 11025;

/** `seconds` of a signal, from a function of time. */
const signal = (seconds: number, f: (t: number) => number): Float32Array => {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = f(i / RATE);
  return out;
};

/** A kick at `bpm`: a 55 Hz thump that dies away in about a tenth of a second. */
const kicks = (bpm: number) => (t: number) => {
  const since = t % (60 / bpm);
  return 0.8 * Math.exp(-since * 30) * Math.sin(2 * Math.PI * 55 * since);
};
const sustainedBass = (t: number) => 0.3 * Math.sin(2 * Math.PI * 55 * t);
const hiss = (() => { let s = 1; return () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 0.4; }; })();
/** Hiss with the bass taken out: each sample minus the last leaves only the highs. */
const highs = (() => { let last = 0; return () => { const h = hiss(); const d = h - last; last = h; return d; }; })();

describe('the meter', () => {
  it('gives one reading per second, chunked however the audio arrives', () => {
    const whole = meter(RATE, [signal(5, kicks(145))]);
    const audio = signal(5, kicks(145));
    const chunked = meter(RATE, [audio.subarray(0, 1234), audio.subarray(1234, 30000), audio.subarray(30000)]);
    expect(whole.map((s) => s.t)).toEqual([0, 1, 2, 3, 4]);
    expect(chunked).toEqual(whole);
  });

  it('hears kicks as pulse in the low band, and a held bass note as none', () => {
    const kick = meter(RATE, [signal(4, kicks(145))]).slice(1);
    const held = meter(RATE, [signal(4, sustainedBass)]).slice(1);
    for (const s of kick) expect(s.pulse).toBeGreaterThan(10);
    for (const s of held) expect(s.pulse).toBeLessThan(2);
  });

  it('hears bass as low-band energy close to the loudness, and highs as far below it', () => {
    const bass = meter(RATE, [signal(3, sustainedBass)])[1]!;
    const hats = meter(RATE, [signal(3, highs)])[1]!;
    expect(bass.loudness - bass.low).toBeLessThan(3);
    expect(hats.loudness - hats.low).toBeGreaterThan(15);
  });

  it('reads silence as very quiet, with no pulse', () => {
    const [s] = meter(RATE, [new Float32Array(RATE)]);
    expect(s!.loudness).toBeLessThanOrEqual(-90);
    expect(s!.low).toBeLessThanOrEqual(-90);
    expect(s!.pulse).toBe(0);
  });
});

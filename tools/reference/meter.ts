// Reads a long piece of music second by second, the way the clip suggestions need it: how loud it is,
// how much of that is bass, and how much the bass jumps (kicks) rather than holds (a pad or a drone).

export interface Reading {
  t: number;          // the second this reading covers, from the start
  loudness: number;   // dB (RMS, full scale = 0)
  low: number;        // dB of the low band (below about 120 Hz)
  pulse: number;      // how much the low band jumps within the second, relative to its level (0 when it holds)
}

const LOW_HZ = 120;
const FRAMES_PER_SECOND = 100;
const QUIET = 1e-12;   // -120 dB, what silence reads as

const dB = (meanSquare: number) => 10 * Math.log10(meanSquare + QUIET);

export class Meter {
  readonly readings: Reading[] = [];
  private readonly frameLength: number;
  // The low band: a 2nd-order low-pass (RBJ biquad, Q = 1/√2).
  private readonly b0: number; private readonly b1: number; private readonly b2: number; private readonly a1: number; private readonly a2: number;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  // The frame being filled, and the second's frames so far.
  private inFrame = 0; private frameFull = 0; private frameLow = 0;
  private frames: { full: number; low: number }[] = [];
  private lastEnvelope = 0;

  constructor(sampleRate: number) {
    this.frameLength = Math.round(sampleRate / FRAMES_PER_SECOND);
    const w = (2 * Math.PI * LOW_HZ) / sampleRate, alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
    this.b0 = (1 - Math.cos(w)) / 2 / a0; this.b1 = (1 - Math.cos(w)) / a0; this.b2 = this.b0;
    this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - alpha) / a0;
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!;
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      this.frameFull += x * x; this.frameLow += y * y;
      if (++this.inFrame === this.frameLength) this.endFrame();
    }
  }

  private endFrame(): void {
    this.frames.push({ full: this.frameFull / this.frameLength, low: this.frameLow / this.frameLength });
    this.inFrame = 0; this.frameFull = 0; this.frameLow = 0;
    if (this.frames.length === FRAMES_PER_SECOND) this.endSecond();
  }

  private endSecond(): void {
    let full = 0, low = 0, envelopeSum = 0, rises = 0;
    for (const f of this.frames) {
      full += f.full; low += f.low;
      const envelope = Math.sqrt(f.low);
      envelopeSum += envelope;
      rises += Math.max(0, envelope - this.lastEnvelope);
      this.lastEnvelope = envelope;
    }
    const n = this.frames.length, meanEnvelope = envelopeSum / n;
    this.readings.push({
      t: this.readings.length,
      loudness: dB(full / n),
      low: dB(low / n),
      pulse: meanEnvelope > 1e-5 ? rises / meanEnvelope : 0,
    });
    this.frames = [];
  }
}

/** Readings for audio that arrives in chunks; a last, unfinished second is left out. */
export function meter(sampleRate: number, chunks: Iterable<Float32Array>): Reading[] {
  const m = new Meter(sampleRate);
  for (const c of chunks) m.push(c);
  return m.readings;
}

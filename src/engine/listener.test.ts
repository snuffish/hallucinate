import { describe, expect, it } from 'vitest';
import { Listener, moodWord, soundNow, toneWord, type Bins } from './listener';

// The analyser in numbers: 48 kHz, fftSize 2048 (1024 bins of ~23.4 Hz), its default dB range.
const SAMPLE_RATE = 48000, BINS = 1024;
const HZ = SAMPLE_RATE / (BINS * 2);

// A spectrum as the analyser's bytes: `shape(hz)` gives 0..255 for each bin's frequency.
function bins(shape: (hz: number) => number): Bins {
  const freq = Uint8Array.from({ length: BINS }, (_, i) => Math.round(Math.min(255, Math.max(0, shape(i * HZ)))));
  return { freq, time: new Uint8Array(BINS * 2).fill(128), sampleRate: SAMPLE_RATE, minDecibels: -100, maxDecibels: -30 };
}

// Music: a kick drum at `bpm` (a bass hit fading over ~0.1 s) over a bed of sound; `bed` sets how loud
// and where it sits. Kicks land exactly on the beat grid, whatever the frame rate.
function music({ bpm, bed = (_hz: number) => 120 }: { bpm: number; bed?: (hz: number) => number }) {
  const beat = 60 / bpm;
  return (t: number) => {
    const sinceKick = t % beat;
    const kick = 255 * Math.exp(-sinceKick / 0.1);
    return bins((hz) => (hz < 140 ? Math.max(bed(hz) * 0.3, kick) : bed(hz)));
  };
}

// Hears `seconds` of `sound` at `fps`, from `start`; returns the ticks and kicks it heard.
function listen(l: Listener, sound: ((t: number) => Bins | null) | null, seconds: number, { fps = 60, playing = true, start = 0 } = {}) {
  const dt = 1 / fps;
  let ticks = 0, kicks = 0;
  for (let t = start; t < start + seconds; t += dt) {
    const h = l.hear(sound ? sound(t) : null, playing, dt, t);
    if (h.tick) ticks++;
    if (h.kick) kicks++;
  }
  return { ticks, kicks };
}

const dark = (hz: number) => (hz < 900 ? 220 : 40);
const bright = (hz: number) => (hz < 2000 ? 60 : hz < 12000 ? 210 : 60);

describe('Listener', () => {
  it('hears the tempo of a kick drum, and ticks with it', () => {
    const l = new Listener();
    const { ticks, kicks } = listen(l, music({ bpm: 124 }), 20);
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(123);
    expect(l.hearing.bpm).toBeLessThanOrEqual(125);
    expect(kicks).toBeGreaterThan(35);   // 41 beats in 20 s, the first few teach it the level
    expect(ticks).toBeGreaterThan(35);
  });

  it('hears the tempo at a low frame rate too, since it listens on real time', () => {
    const l = new Listener();
    listen(l, music({ bpm: 124 }), 30, { fps: 8 });
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(115);   // kicks land on 125 ms frames
    expect(l.hearing.bpm).toBeLessThanOrEqual(130);
  });

  it('keeps ticking through a breakdown, and holds the tempo', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 15);
    const quiet = () => bins(() => 30);
    const { ticks, kicks } = listen(l, quiet, 8, { start: 15 });
    expect(kicks).toBe(0);
    expect(ticks).toBeGreaterThanOrEqual(15);   // 16 beats in 8 s at 120 BPM
    expect(l.hearing.bpm).toBe(120);
  });

  it('does not tick while the music is not playing, and starts over on a new source', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 10);
    expect(listen(l, null, 5, { start: 10, playing: false }).ticks).toBe(0);
    l.reset();
    expect(l.hearing.bpm).toBeNull();
    expect(listen(l, null, 5, { start: 15 }).ticks).toBe(0);   // no tempo yet: nothing to tick
    listen(l, music({ bpm: 140 }), 10, { start: 20 });
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(137);   // kicks land on 1/60 s frames
    expect(l.hearing.bpm).toBeLessThanOrEqual(141);
  });

  it('hears how far through the current tick the music is: rising from 0 to 1, back to 0 on each tick', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 10);
    let last = l.hearing.tickPhase, rises = 0, resets = 0;
    for (let t = 10; t < 14; t += 1 / 60) {
      const h = l.hear(music({ bpm: 120 })(t), true, 1 / 60, t);
      expect(h.tickPhase).toBeGreaterThanOrEqual(0);
      expect(h.tickPhase).toBeLessThanOrEqual(1);
      if (h.tick) { expect(h.tickPhase).toBeLessThan(0.1); resets++; }
      else if (h.tickPhase > last) rises++;
      last = h.tickPhase;
    }
    expect(resets).toBeGreaterThanOrEqual(7);   // 8 beats in 4 s at 120 BPM
    expect(rises).toBeGreaterThan(200);         // every other frame climbs
  });

  it('counts the ticks, one step per tick', () => {
    const l = new Listener();
    const before = l.hearing.ticks;
    const { ticks } = listen(l, music({ bpm: 124 }), 20);
    expect(ticks).toBeGreaterThan(35);
    expect(l.hearing.ticks - before).toBe(ticks);
  });

  it('holds the tick phase and count still while the music is not playing', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 10.2);
    const { tickPhase, ticks } = l.hearing;
    expect(tickPhase).toBeGreaterThan(0);
    for (let t = 10.2; t < 15; t += 1 / 60) {
      const h = l.hear(null, false, 1 / 60, t);
      expect([h.tickPhase, h.ticks]).toEqual([tickPhase, ticks]);
    }
  });

  it('keeps the tick phase and count going through a breakdown', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 15);
    const ticks = l.hearing.ticks;
    const quiet = () => bins(() => 30);
    const phases = new Set<number>();
    for (let t = 15; t < 23; t += 1 / 60) phases.add(Math.round(l.hear(quiet(), true, 1 / 60, t).tickPhase * 10));
    expect(l.hearing.ticks - ticks).toBeGreaterThanOrEqual(15);   // 16 beats in 8 s at 120 BPM
    expect(phases.size).toBeGreaterThanOrEqual(10);               // the phase sweeps 0..1 the whole way
  });

  it('hears a dark tone and a bright one, and only over seconds', () => {
    const l = new Listener();
    listen(l, music({ bpm: 100, bed: dark }), 0.5);
    expect(l.hearing.bright).toBeGreaterThan(0.3);   // a moment of sound doesn't swing it
    listen(l, music({ bpm: 100, bed: dark }), 15, { start: 0.5 });
    expect(toneWord(l.hearing.bright)).toBe('dark');
    expect(l.hearing.centroid).toBeLessThan(1100);
    listen(l, music({ bpm: 100, bed: bright }), 15, { start: 15.5 });
    expect(toneWord(l.hearing.bright)).toBe('bright');
    expect(l.hearing.centroid).toBeGreaterThan(5500);
  });

  it('holds the tone through a quiet passage, and lets it go neutral once nothing plays', () => {
    const l = new Listener();
    listen(l, music({ bpm: 100, bed: dark }), 15);
    const tone = l.hearing.bright;
    listen(l, () => bins(() => 0), 3, { start: 15 });
    expect(l.hearing.bright).toBeCloseTo(tone, 5);
    listen(l, null, 20, { start: 18, playing: false });
    expect(l.hearing.bright).toBeCloseTo(0.5, 1);
  });

  it('hears fast loud music as energetic and slow quiet music as calm; with nothing playing, neither', () => {
    const fast = new Listener();
    listen(fast, music({ bpm: 160, bed: () => 210 }), 30);
    expect(fast.hearing.energy).toBeGreaterThan(0.9);
    expect(moodWord(fast.hearing.mood)).toBe('energetic');
    const slow = new Listener();
    listen(slow, music({ bpm: 80, bed: () => 25 }), 30);
    expect(slow.hearing.energy).toBeLessThan(0.1);
    expect(moodWord(slow.hearing.mood)).toBe('calm');
    listen(fast, null, 30, { start: 30, playing: false });
    expect(fast.hearing.mood).toBeCloseTo(0.5, 1);
  });

  it('draws the spectrum texture from the bins, and a flat line without them', () => {
    const l = new Listener();
    l.hear(music({ bpm: 120, bed: dark })(0), true, 1 / 60, 0);
    const bass = l.spectrum[2]!, treble = l.spectrum[2 * 250]!;
    expect(bass).toBeGreaterThan(treble);
    expect(l.spectrum[1]).toBe(128);   // the waveform: silence
    l.hear(null, false, 1 / 60, 1);
    expect(l.spectrum.filter((_, i) => i % 2 === 0).every((v) => v === 0)).toBe(true);
    expect(l.spectrum.filter((_, i) => i % 2 === 1).every((v) => v === 128)).toBe(true);
  });
});

describe('the sound in words', () => {
  it('reads the mood and the tone in thirds', () => {
    expect([0, 0.34, 0.35, 0.65, 0.66, 1].map(moodWord)).toEqual(['calm', 'calm', 'groovy', 'groovy', 'energetic', 'energetic']);
    expect([0.2, 0.5, 0.9].map(toneWord)).toEqual(['dark', 'balanced', 'bright']);
  });

  it('says no mood or tone while nothing plays', () => {
    const l = new Listener();
    Object.assign(l.hearing, { bpm: 124, mood: 0.8, bright: 0.2 });
    expect(soundNow(l.hearing, true, 'demo')).toEqual({ source: 'demo', bpm: 124, mood: 'energetic', tone: 'dark' });
    expect(soundNow(l.hearing, false, 'soundcloud')).toEqual({ source: 'soundcloud', bpm: 124, mood: null, tone: null });
    expect(soundNow(l.hearing, false, null).source).toBe('none');
  });
});

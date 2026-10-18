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

const BAND_NAMES = ['bass', 'mid', 'high', 'level'] as const;
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

  it('hears a half-time kick grid at 72 BPM as 144, inside the tempo range', () => {
    const l = new Listener();
    const { ticks } = listen(l, music({ bpm: 72 }), 30);
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(143);   // kicks land on 1/60 s frames
    expect(l.hearing.bpm).toBeLessThanOrEqual(145);
    expect(ticks).toBeGreaterThan(55);   // the clock runs at 144: two ticks to every kick
  });

  it('folds a doubled reading back into the tempo range: kicks at 190 read 95', () => {
    const l = new Listener();
    listen(l, music({ bpm: 190 }), 20);
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(94);   // kicks land on 1/60 s frames
    expect(l.hearing.bpm).toBeLessThanOrEqual(96);
  });

  it('hears drum and bass at 174 BPM as 174, at the top of the range', () => {
    const l = new Listener();
    listen(l, music({ bpm: 174 }), 20);
    expect(l.hearing.bpm).toBe(174);
  });

  it('never hears a tempo outside 85–175 BPM, whatever the kicks', () => {
    for (let bpm = 40; bpm <= 210; bpm += 5) {
      const l = new Listener();
      for (let t = 0; t < 15; t += 1 / 60) {
        const { bpm: heard } = l.hear(music({ bpm })(t), true, 1 / 60, t);
        if (heard !== null) expect(heard, `kicks at ${bpm} BPM`).toBeGreaterThanOrEqual(85);
        if (heard !== null) expect(heard, `kicks at ${bpm} BPM`).toBeLessThanOrEqual(175);
      }
      expect(l.hearing.bpm, `kicks at ${bpm} BPM`).not.toBeNull();
    }
  });

  it('hears one kick per beat under a rolling bassline that fills the gaps between them', () => {
    // Psytrance: a kick on every beat and a strong bass note on each of the three sixteenths after it, in
    // the same low band, so the bass never falls back between the kicks.
    const bpm = 145, beat = 60 / bpm, sixteenth = beat / 4;
    const rolling = (t: number) => {
      const sinceKick = t % beat;
      const kick = 255 * Math.exp(-sinceKick / 0.1);
      const sinceNote = sinceKick % sixteenth;
      const note = sinceKick < sixteenth ? 0 : 230 * Math.exp(-sinceNote / 0.04);
      return bins((hz) => (hz < 140 ? Math.max(40, kick, hz > 45 ? note : 0) : 120));
    };
    const l = new Listener();
    listen(l, rolling, 10);
    const { kicks, ticks } = listen(l, rolling, 20, { start: 10 });
    expect(kicks).toBeGreaterThanOrEqual(46);   // 48 beats in 20 s
    expect(kicks).toBeLessThanOrEqual(50);
    expect(ticks).toBeGreaterThanOrEqual(46);
    expect(ticks).toBeLessThanOrEqual(50);
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(144);
    expect(l.hearing.bpm).toBeLessThanOrEqual(146);
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

  it('forgets the tempo after a long passage without kicks: the ticks stop and the mood lets the tempo go', () => {
    const l = new Listener();
    listen(l, music({ bpm: 170 }), 15);
    const ambient = () => bins(() => 30);
    listen(l, ambient, 60, { start: 15 });
    expect(l.hearing.bpm).toBe(170);   // a minute without kicks is still a breakdown
    const moodWithTempo = l.hearing.mood;
    listen(l, ambient, 60, { start: 75 });
    expect(l.hearing.bpm).toBeNull();
    expect(listen(l, ambient, 20, { start: 135 }).ticks).toBe(0);
    expect(l.hearing.mood).toBeLessThan(moodWithTempo - 0.2);   // fast music's tempo no longer lifts it
    expect(l.hearing.mood).toBeGreaterThan(0.25);               // ... a neutral tempo still does, halfway
  });

  it('hears a new tempo once the kicks come back after it was forgotten, and ticks again', () => {
    const l = new Listener();
    listen(l, music({ bpm: 170 }), 15);
    listen(l, () => bins(() => 30), 120, { start: 15 });
    expect(l.hearing.bpm).toBeNull();
    const { ticks } = listen(l, music({ bpm: 140 }), 20, { start: 135 });
    expect(l.hearing.bpm).toBeGreaterThanOrEqual(139);   // not a mix with the 170 heard before
    expect(l.hearing.bpm).toBeLessThanOrEqual(141);
    expect(ticks).toBeGreaterThan(35);   // 46 beats in 20 s, the first few teach it the tempo
  });

  it('holds the tempo and keeps ticking through breakdowns of 30 to 60 s', () => {
    for (const seconds of [30, 45, 60]) {
      const l = new Listener();
      listen(l, music({ bpm: 120 }), 15);
      const { ticks, kicks } = listen(l, () => bins(() => 30), seconds, { start: 15 });
      expect(kicks).toBe(0);
      expect(ticks, `a ${seconds} s breakdown`).toBeGreaterThanOrEqual(seconds * 2 - 1);   // 120 BPM: 2 a second
      expect(l.hearing.bpm, `a ${seconds} s breakdown`).toBe(120);
    }
  });

  it('does not count a pause as a passage without kicks', () => {
    const l = new Listener();
    listen(l, music({ bpm: 120 }), 15);
    listen(l, () => bins(() => 30), 60, { start: 15 });
    listen(l, null, 300, { start: 75, playing: false });
    listen(l, () => bins(() => 30), 20, { start: 375 });
    expect(l.hearing.bpm).toBe(120);   // 80 s played without kicks, a breakdown still
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

  it('hears bright psytrance as bright, with room above it: the tone is not pinned at fully bright', () => {
    // Centroids like Closer to Heaven's (≈ 4–5.5 kHz): mids and highs over the kick.
    const l = new Listener();
    listen(l, music({ bpm: 144, bed: (hz) => (hz < 2000 ? 200 : hz < 12000 ? 165 : 60) }), 15);
    expect(l.hearing.centroid).toBeGreaterThan(4000);
    expect(l.hearing.centroid).toBeLessThan(5500);
    expect(toneWord(l.hearing.bright)).toBe('bright');
    expect(l.hearing.bright).toBeLessThan(0.9);
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
    expect(fast.hearing.energy).toBeGreaterThan(0.5);   // loud, though not as loud as a real psytrance drop
    expect(moodWord(fast.hearing.mood)).toBe('energetic');
    const slow = new Listener();
    listen(slow, music({ bpm: 90, bed: () => 25 }), 30);   // near the bottom of the tempo range (85–175)
    expect(slow.hearing.energy).toBeLessThan(0.1);
    expect(moodWord(slow.hearing.mood)).toBe('calm');
    listen(fast, null, 30, { start: 30, playing: false });
    expect(fast.hearing.mood).toBeCloseTo(0.5, 1);
  });

  it('hears a breakdown calmer than the drops around it, though the tempo holds', () => {
    // A psytrance drop at 144 BPM, a breakdown of pads without the kick and the bass, and the drop again.
    const drop = music({ bpm: 144, bed: () => 210 });
    const breakdown = () => bins((hz) => (hz < 140 ? 60 : 190));
    const l = new Listener();
    const mood = (sound: (t: number) => Bins, seconds: number, start: number) => {
      listen(l, sound, seconds - 5, { start });
      const seen: number[] = [];
      for (let t = start + seconds - 5; t < start + seconds; t += 1 / 60) seen.push(l.hear(sound(t), true, 1 / 60, t).mood);
      return seen.reduce((a, b) => a + b, 0) / seen.length;   // over its last 5 s
    };
    const first = mood(drop, 30, 0);
    const calm = mood(breakdown, 20, 30);
    expect(l.hearing.bpm).toBe(144);   // the tempo holds through it
    const again = mood(drop, 20, 50);
    expect(first - calm).toBeGreaterThan(0.1);   // clearly calmer, as the real-music tests ask
    expect(again - calm).toBeGreaterThan(0.1);
  });

  it('hears the same kicks and tempo whatever the Smoothing setting', () => {
    const heard = (smoothing: number) => {
      const l = new Listener();
      l.setSmoothing(smoothing);
      const kickTimes: number[] = [];
      for (let t = 0; t < 20; t += 1 / 60) if (l.hear(music({ bpm: 124 })(t), true, 1 / 60, t).kick) kickTimes.push(Math.round(t * 60));
      return { kickTimes, bpm: l.hearing.bpm };
    };
    const calm = heard(0.95), twitchy = heard(0);
    expect(twitchy.kickTimes.length).toBeGreaterThan(35);   // 41 beats in 20 s
    expect(calm).toEqual(twitchy);
  });

  it('smooths the spectrum texture by the Smoothing setting, the way the analyser did', () => {
    // A flat spectrum at byte 200 starts out of silence. The analyser averaged linear magnitudes:
    // half of it is 6.02 dB down, 21.9 bytes on its -100..-30 dB scale, so byte 178; the texture's
    // lowest texel weights it by 0.85.
    const flat = () => bins(() => 200);
    const half = new Listener();
    half.setSmoothing(0.5);
    half.hear(flat(), true, 1 / 60, 0);
    expect(half.spectrum[0]).toBe(Math.floor(178 * 0.85));
    listen(half, flat, 2, { start: 1 / 60 });
    expect(half.spectrum[0]).toBe(Math.floor(200 * 0.85));   // settled on the sound
    const none = new Listener();
    none.setSmoothing(0);
    none.hear(flat(), true, 1 / 60, 0);
    expect(none.spectrum[0]).toBe(Math.floor(200 * 0.85));   // no smoothing: there at once
  });

  it('smooths the bands by the Smoothing setting: a calm setting steadies a flickering sound', () => {
    const swing = (smoothing: number) => {
      const l = new Listener();
      l.setSmoothing(smoothing);
      const flicker = (t: number) => bins(() => (Math.round(t * 60) % 2 ? 200 : 100));
      listen(l, flicker, 5);
      const seen = { bass: [] as number[], mid: [] as number[], high: [] as number[], level: [] as number[] };
      for (let t = 5; t < 6; t += 1 / 60) {
        const h = l.hear(flicker(t), true, 1 / 60, t);
        for (const k of BAND_NAMES) seen[k].push(h[k]);
      }
      return Object.fromEntries(BAND_NAMES.map((k) => [k, Math.max(...seen[k]) - Math.min(...seen[k])]));
    };
    const calm = swing(0.95), twitchy = swing(0);
    for (const k of BAND_NAMES) {
      expect(twitchy[k]).toBeGreaterThan(0.1);
      expect(calm[k]).toBeLessThan(twitchy[k]! / 2);
    }
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

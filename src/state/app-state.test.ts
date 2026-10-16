import { describe, expect, it } from 'vitest';
import { defaultClock, moodWord, soundNow, toneWord } from './app-state';

describe('the sound in words', () => {
  it('reads the mood and the tone in thirds', () => {
    expect([0, 0.34, 0.35, 0.65, 0.66, 1].map(moodWord)).toEqual(['calm', 'calm', 'groovy', 'groovy', 'energetic', 'energetic']);
    expect([0.2, 0.5, 0.9].map(toneWord)).toEqual(['dark', 'balanced', 'bright']);
  });

  it('says no mood or tone while nothing plays', () => {
    const clock = { ...defaultClock(), bpm: 124, mood: 0.8 };
    expect(soundNow({ clock, activeSource: 'demo' }, { kind: 'demo', features: { bright: 0.2 } })).toEqual({ source: 'demo', bpm: 124, mood: 'energetic', tone: 'dark' });
    expect(soundNow({ clock, activeSource: null }, { kind: null, features: { bright: 0.2 } })).toEqual({ source: 'none', bpm: 124, mood: null, tone: null });
  });
});

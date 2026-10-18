import { describe, expect, it } from 'vitest';
import type { Clip, ReferenceList } from './list.ts';
import { clipFile, planFetch } from './plan.ts';

const clip = (name: string, source: string): Clip => ({ name, source, start: 0, length: 60, type: 'ambient', bpm: null, drop: null, breakdown: null });

const LIST: ReferenceList = {
  sources: {
    mix: { title: 'Mix', url: 'https://soundcloud.com/a/mix' },
    other: { title: 'Other', url: 'https://soundcloud.com/a/other' },
    unused: { title: 'Unused', url: 'https://soundcloud.com/a/unused' },
  },
  clips: [clip('mix-drop', 'mix'), clip('mix-ambient', 'mix'), clip('other-drop', 'other')],
};

describe('planning the fetch', () => {
  it('keeps each clip in its own flac file named after it', () => {
    expect(clipFile(clip('mix-drop', 'mix'))).toBe('mix-drop.flac');
  });

  it('fetches each source once, for all of its clips, and never a source without clips', () => {
    expect(planFetch(LIST, new Set())).toEqual([
      { id: 'mix', source: LIST.sources.mix, clips: [LIST.clips[0], LIST.clips[1]] },
      { id: 'other', source: LIST.sources.other, clips: [LIST.clips[2]] },
    ]);
  });

  it('skips clips already in the folder, and sources with every clip there', () => {
    expect(planFetch(LIST, new Set(['mix-drop.flac', 'other-drop.flac']))).toEqual([
      { id: 'mix', source: LIST.sources.mix, clips: [LIST.clips[1]] },
    ]);
    expect(planFetch(LIST, new Set(['mix-drop.flac', 'mix-ambient.flac', 'other-drop.flac']))).toEqual([]);
  });
});

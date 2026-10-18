import { describe, expect, it } from 'vitest';
import { parseReferenceList, ReferenceListError } from './list.ts';

const LAZY = { title: 'Unknown Reality – Lazy Mix', url: 'https://soundcloud.com/brainalien/unknown-reality-lazy-mix' };

const problemsOf = (raw: unknown): string[] => {
  try {
    parseReferenceList(raw);
  } catch (e) {
    if (e instanceof ReferenceListError) return e.problems;
    throw e;
  }
  return [];
};

describe('the reference list', () => {
  it('reads a source with no clips yet', () => {
    expect(parseReferenceList({ sources: { 'lazy-mix': LAZY }, clips: [] })).toEqual({ sources: { 'lazy-mix': LAZY }, clips: [] });
  });

  it('reads a clip, with times written as seconds or as m:ss / h:mm:ss', () => {
    const list = parseReferenceList({
      sources: { 'lazy-mix': LAZY },
      clips: [{ name: 'lazy-drop', source: 'lazy-mix', start: '1:02:03', length: 60, type: 'breakdown', bpm: 145, drop: ['0:40', 58], breakdown: [5, '0:30.5'] }],
    });
    expect(list.clips).toEqual([{ name: 'lazy-drop', source: 'lazy-mix', start: 3723, length: 60, type: 'breakdown', bpm: 145, drop: [40, 58], breakdown: [5, 30.5] }]);
  });

  it('lets an ambient clip go without a BPM, a drop or a breakdown', () => {
    const list = parseReferenceList({ sources: { 'lazy-mix': LAZY }, clips: [{ name: 'lazy-ambient', source: 'lazy-mix', start: 600, length: 60, type: 'ambient', bpm: null, drop: null, breakdown: null }] });
    expect(list.clips[0]).toMatchObject({ bpm: null, drop: null, breakdown: null });
  });

  it('names every problem at once, by where it is', () => {
    const problems = problemsOf({
      sources: { 'lazy-mix': { title: 'x', url: 'not a link' } },
      clips: [
        { name: 'a/b', source: 'nowhere', start: '1:75', length: 0, type: 'chorus', bpm: 145, drop: null, breakdown: null },
        { name: 'ok', source: 'lazy-mix', start: 10, length: 60, type: 'drop', bpm: -3, drop: [50, 70], breakdown: [20, 10] },
        { name: 'ok', source: 'lazy-mix', start: 10, length: 60, type: 'ambient', bpm: null, drop: null, breakdown: null },
      ],
    });
    expect(problems).toEqual([
      'sources.lazy-mix.url: not a link',
      'clips[0].name: "a/b" may only use letters, digits, "-" and "_"',
      'clips[0].source: "nowhere" is not in sources',
      'clips[0].start: "1:75" is not a time (seconds, m:ss or h:mm:ss)',
      'clips[0].length: must be more than 0 seconds',
      'clips[0].type: "chorus" is not one of drop, breakdown, ambient, transition',
      'clips[1].bpm: must be a positive number, given by ear (or null for an ambient clip)',
      'clips[1].drop: must lie within the clip (0–60 s) and end after it starts',
      'clips[1].breakdown: must lie within the clip (0–60 s) and end after it starts',
      'clips[2].name: "ok" is used twice',
    ]);
  });

  it('wants a BPM for every clip with kicks in it', () => {
    expect(problemsOf({ sources: { s: LAZY }, clips: [{ name: 'd', source: 's', start: 0, length: 60, type: 'transition', bpm: null, drop: null, breakdown: null }] }))
      .toEqual(['clips[0].bpm: must be a positive number, given by ear (or null for an ambient clip)']);
  });

  it('wants a drop window in a drop clip, and both windows in a breakdown clip', () => {
    expect(problemsOf({
      sources: { s: LAZY },
      clips: [
        { name: 'd', source: 's', start: 0, length: 60, type: 'drop', bpm: 145, drop: null, breakdown: null },
        { name: 'b', source: 's', start: 0, length: 60, type: 'breakdown', bpm: 145, drop: [40, 60], breakdown: null },
      ],
    })).toEqual(['clips[0].drop: a drop clip needs a drop window', 'clips[1].breakdown: a breakdown clip needs a breakdown window']);
  });

  it('refuses something that is not a list at all', () => {
    expect(problemsOf([])).toEqual(['the list must be an object with "sources" and "clips"']);
    expect(problemsOf({ sources: {}, clips: {} })).toEqual(['clips: must be an array']);
  });
});

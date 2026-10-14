import { describe, expect, it } from 'vitest';
import { splitFollowUps } from './follow-ups';

describe('splitFollowUps', () => {
  it('separates the suggestions line from the reply', () => {
    const r = splitFollowUps('Done: the rings now pulse with the bass.\n\nFOLLOW-UPS: ["Make them spin faster", "Add a colour parameter", "Add a colour parameter"]');
    expect(r.text).toBe('Done: the rings now pulse with the bass.');
    expect(r.followUps).toEqual(['Make them spin faster', 'Add a colour parameter']);
  });

  it('leaves replies without the line alone', () => {
    expect(splitFollowUps('Just text.')).toEqual({ text: 'Just text.', followUps: [] });
  });

  it('hides a partially streamed line and tolerates malformed JSON', () => {
    expect(splitFollowUps('Text\nFOLLOW-UPS: ["Make the')).toEqual({ text: 'Text', followUps: [] });
    expect(splitFollowUps('Text\nFOLLOW-UPS: [not json]')).toEqual({ text: 'Text', followUps: [] });
    expect(splitFollowUps('Text\nFOLLOW-UPS: ["", 3]').followUps).toEqual([]);
  });

  it('ignores the marker when it is not at the start of a line', () => {
    expect(splitFollowUps('Use the FOLLOW-UPS: idea').followUps).toEqual([]);
  });
});

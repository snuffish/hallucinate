import { describe, expect, it } from 'vitest';
import { memoryStore } from '../state/history-db';
import { ChangeLog, DIRECTOR_CHAT, DIRECTOR_KEEP, type Change, type ChangeDraft } from './change-log';

const draft = (toolCallId: string, label = 'Adjusted the look'): ChangeDraft => ({ tool: 'set_look', toolCallId, label, kind: 'look', before: { hue: 0 }, after: { hue: 0.5 } });

describe('change log', () => {
  it('finds a tool call\'s changes, and a chat\'s newest first', async () => {
    let t = 0;
    const log = new ChangeLog(memoryStore<Change>(), () => ++t);
    await log.ready;
    log.add('c1', draft('a', 'first'));
    log.add('c1', draft('b', 'second'));
    log.add('c2', draft('a', 'elsewhere'));
    expect(log.forCall('c1', 'a').map((c) => c.label)).toEqual(['first']);
    expect(log.forChat('c1').map((c) => c.label)).toEqual(['second', 'first']);
  });

  it('keeps changes across sessions, and deletes a chat\'s with it', async () => {
    const backend = memoryStore<Change>();
    const first = new ChangeLog(backend);
    await first.ready;
    first.add('c1', draft('a'));
    first.add('c2', draft('b'));
    await first.flush();
    const second = new ChangeLog(backend);
    second.dropChat('c1');   // before it loaded: applied once it has
    await second.flush();
    expect(second.forChat('c1')).toEqual([]);
    expect(second.forCall('c2', 'b')).toHaveLength(1);
    expect([...backend.records.values()].map((c) => c.chatId)).toEqual(['c2']);
  });

  it('keeps only the director\'s newest changes', async () => {
    let t = 0;
    const log = new ChangeLog(memoryStore<Change>(), () => ++t);
    await log.ready;
    for (let n = 0; n < DIRECTOR_KEEP + 3; n++) log.add(DIRECTOR_CHAT, draft(`d${n}`));
    log.add('c1', draft('mine'));
    const kept = log.forChat(DIRECTOR_CHAT);
    expect(kept).toHaveLength(DIRECTOR_KEEP);
    expect(kept.at(-1)!.toolCallId).toBe('d3');
    expect(log.forChat('c1')).toHaveLength(1);
  });
});

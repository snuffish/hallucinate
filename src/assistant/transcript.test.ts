import { describe, expect, it } from 'vitest';
import { chat, convertMessagesToModelMessages, EventType, maxIterations, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import type { UIMessage } from '@tanstack/ai-client';
import { codeHash, describeNote, resumeNote, sceneNote, splitNotes, undoNote, withNotes } from './notes';
import { TOOL_DEFINITIONS } from './tools';
import { NOT_RUN, OMITTED, prepareForSend, previewOf, sealInterrupted, titleFrom, toMarkdown } from './transcript';

const img = (n: number) => ({ type: 'image', source: { type: 'data', value: `IMG${n}`, mimeType: 'image/jpeg' } });

// A transcript saved while the browser was about to run set_look: the call has no result.
const interrupted = (): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'make it pink' }] },
  { id: 'a1', role: 'assistant', parts: [
    { type: 'text', content: 'On it.' },
    { type: 'tool-call', id: 'call-x', name: 'set_look', arguments: '{"hue":0.9}', input: { hue: 0.9 }, state: 'input-complete' },
  ] },
  { id: 'u2', role: 'user', parts: [{ type: 'text', content: 'hello again' }] },
];

class SpyAdapter extends BaseTextAdapter<string, Record<string, never>, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'spy';
  seen: TextOptions<Record<string, never>>['messages'][] = [];
  constructor() { super({}, 'spy-model'); }
  structuredOutput(_o: StructuredOutputOptions<Record<string, never>>): Promise<never> { return Promise.reject(new Error('no')); }
  async *chatStream(options: TextOptions<Record<string, never>>): AsyncIterable<AdapterYieldChunk> {
    this.seen.push(options.messages);
    const now = Date.now();
    yield { type: EventType.RUN_STARTED, runId: options.runId ?? 'r', threadId: options.threadId ?? 't', model: this.model, timestamp: now };
    yield { type: EventType.RUN_FINISHED, runId: options.runId ?? 'r', threadId: options.threadId ?? 't', model: this.model, timestamp: now, finishReason: 'stop' };
  }
}

async function serverRun(messages: UIMessage[]) {
  const adapter = new SpyAdapter();
  const chunks: { type: string }[] = [];
  const stream = chat({ adapter, messages: convertMessagesToModelMessages(messages), tools: [...TOOL_DEFINITIONS], agentLoopStrategy: maxIterations(3) });
  for await (const c of stream) chunks.push(c as { type: string });
  const answered = (adapter.seen[0] ?? []).some((m) => m.role === 'tool' && m.toolCallId === 'call-x');
  return { adapter, redispatched: chunks.some((c) => JSON.stringify(c).includes('call-x')), answered };
}

describe('sealing interrupted tool calls', () => {
  // TanStack already copes with an unanswered call in the two ways this app sends a transcript: a new
  // message gets a stand-in "No result provided" result, and reload() drops the call. Sealing makes the
  // transcript say what happened (and the chip stop spinning); it would also stop a re-dispatch if a
  // transcript were ever sent ending with the call.
  it('a transcript ending with an unanswered call would re-dispatch the stale tool; sealed, it does not', async () => {
    const endsWithCall = interrupted().slice(0, 2);
    expect((await serverRun(endsWithCall)).redispatched).toBe(true);
    const sealed = await serverRun(sealInterrupted(endsWithCall));
    expect(sealed.redispatched).toBe(false);
    expect(sealed.adapter.seen).toHaveLength(1);           // the model is asked instead
  });

  it('after a new message the model sees why the call has no result', async () => {
    const raw = await serverRun(interrupted());
    expect(raw.redispatched).toBe(false);
    expect(JSON.stringify(raw.adapter.seen[0])).toContain('No result provided');   // TanStack's stand-in
    const sealed = await serverRun(sealInterrupted(interrupted()));
    expect(sealed.redispatched).toBe(false);
    expect(sealed.answered).toBe(true);
    expect(JSON.stringify(sealed.adapter.seen[0])).toContain(NOT_RUN);
  });

  it('adds one error result per unanswered call and leaves the rest untouched', () => {
    const messages = interrupted();
    const out = sealInterrupted(messages);
    expect(out[1]!.parts.at(-1)).toMatchObject({ type: 'tool-result', toolCallId: 'call-x', state: 'error', content: NOT_RUN });
    expect(out[0]).toBe(messages[0]);
    expect(sealInterrupted(out)).toBe(out);                // idempotent: nothing left to seal
  });

  it('leaves answered calls and calls whose arguments never finished', () => {
    const messages: UIMessage[] = [{ id: 'a', role: 'assistant', parts: [
      { type: 'tool-call', id: 'done', name: 'set_look', arguments: '{}', state: 'complete', output: { applied: {} } },
      { type: 'tool-call', id: 'relayed', name: 'set_look', arguments: '{}', state: 'input-complete' },
      { type: 'tool-result', toolCallId: 'relayed', content: 'ok', state: 'complete' },
      { type: 'tool-call', id: 'partial', name: 'set_look', arguments: '{"hu', state: 'input-streaming' },
    ] }];
    expect(sealInterrupted(messages)).toBe(messages);
  });
});

describe('old screenshots', () => {
  it('keeps the newest three and replaces older ones, in tool outputs and in tool results, without touching the transcript', () => {
    const messages: UIMessage[] = [
      { id: 'a', role: 'assistant', parts: [{ type: 'tool-call', id: 'c1', name: 'look_at_scene', arguments: '{}', state: 'complete', output: [img(1), img(2)] }] },
      { id: 'b', role: 'assistant', parts: [{ type: 'tool-result', toolCallId: 'c2', content: [img(3) as never], state: 'complete' }] },
      { id: 'c', role: 'assistant', parts: [{ type: 'tool-call', id: 'c3', name: 'look_at_scene', arguments: '{}', state: 'complete', output: [{ type: 'text', content: 'two views' }, img(4)] }] },
    ];
    const before = JSON.stringify(messages);
    const sent = JSON.stringify(prepareForSend(messages));
    expect(sent).not.toContain('IMG1');
    for (const n of [2, 3, 4]) expect(sent).toContain(`IMG${n}`);
    expect(sent).toContain(OMITTED);
    expect(JSON.stringify(messages)).toBe(before);
    expect(prepareForSend(messages, 10)).toBe(messages);   // nothing to drop: same array
  });
});

describe('titles, previews and the Markdown export', () => {
  it('titles a chat by its first message, cut at a word', () => {
    expect(titleFrom('Make the scene on screen more intense on the beat, without making it jumpy.')).toBe('Make the scene on screen more intense…');
    expect(titleFrom('  short\n one ')).toBe('short one');
    expect(titleFrom('')).toBe('New chat');
  });

  it('previews the newest reply without its follow-ups line or Markdown marks', () => {
    const messages: UIMessage[] = [{ id: 'a', role: 'assistant', parts: [{ type: 'text', content: '**Done.** I made `Neon Tide`.\n\nFOLLOW-UPS: ["Make it slower"]' }] }];
    expect(previewOf(messages)).toBe('Done. I made Neon Tide.');
  });

  it('exports what was said and each tool call as a line, hiding app notes; reasoning only when asked', () => {
    const messages: UIMessage[] = [
      { id: 'u', role: 'user', parts: [{ type: 'text', content: withNotes([undoNote('Edited X')], 'try again') }] },
      { id: 'a', role: 'assistant', parts: [
        { type: 'thinking', content: 'The user wants it again.' },
        { type: 'tool-call', id: 'c', name: 'write_scene_code', arguments: '{}', input: { scene: 'Hyper Tunnel' }, state: 'complete', output: {} },
        { type: 'text', content: 'Done.\nFOLLOW-UPS: ["x"]' },
      ] },
    ];
    const md = toMarkdown('My chat', messages);
    expect(md).toContain('# My chat');
    expect(md).toContain('**You:** try again');
    expect(md).not.toContain('pressed Undo');
    expect(md).toContain('> ✓ Edited Hyper Tunnel');
    expect(md).toContain('Done.');
    expect(md).not.toContain('FOLLOW-UPS');
    expect(md).not.toContain('wants it again');
    expect(toMarkdown('My chat', messages, { reasoning: true })).toContain('> 💭 The user wants it again.');
  });
});

describe('app notes on a message', () => {
  it('ride at the start of the next message and are split off again for display', () => {
    const sent = withNotes([undoNote('Edited X'), resumeNote(new Date(0))], 'hello\n(not a note)');
    const { notes, text } = splitNotes(sent);
    expect(notes).toHaveLength(2);
    expect(text).toBe('hello\n(not a note)');
    expect(describeNote(notes[0]!)).toBe('Undid: Edited X');
    expect(describeNote(notes[1]!)).toMatch(/^Reopened later/);
    expect(splitNotes('(just parentheses)')).toEqual({ notes: [], text: '(just parentheses)' });
    expect(splitNotes(undoNote('Old form'))).toEqual({ notes: [undoNote('Old form')], text: '' });
  });

  it('a scene-changed note names the new scene and is split off like the others', () => {
    const note = sceneNote('Tunnel (v2)');
    expect(note).toBe('(The scene on screen changed since your last reply: now "Tunnel (v2)".)');
    expect(splitNotes(withNotes([note], 'brighter'))).toEqual({ notes: [note], text: 'brighter' });
    expect(describeNote(note)).toBe('Scene changed: "Tunnel (v2)"');
  });

  it('a reopen note says what is on screen and whether the scene\'s code changed, on one line the panel still splits off', () => {
    const seen = { scene: 'Tunnel (v2)', hash: codeHash('void main() {}') };
    const same = resumeNote(new Date(0), seen, { ...seen, values: { uGlow: 1.23456, uTint: [0.1111, 1, 0] } });
    expect(same).toContain('On screen: "Tunnel (v2)", the scene from your last reply, its code unchanged since; its parameters are {"uGlow":1.235,"uTint":[0.111,1,0]}');
    expect(same).not.toContain('call get_app_state before');
    expect(splitNotes(withNotes([same], 'hi'))).toEqual({ notes: [same], text: 'hi' });
    expect(resumeNote(new Date(0), seen, { ...seen, hash: codeHash('void main() { }'), values: {} })).toContain('its code changed since: read it before editing');
    expect(resumeNote(new Date(0), seen, { scene: 'Other', hash: seen.hash, values: {} })).toContain('a different scene than at your last reply');
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`uParam${i}`, i / 7]));
    expect(resumeNote(new Date(0), seen, { ...seen, values: many })).not.toContain('its parameters are');
    expect(resumeNote(new Date(0), null, { ...seen, values: {} })).toContain('call get_app_state before changing anything');   // older chats have no record
  });
});

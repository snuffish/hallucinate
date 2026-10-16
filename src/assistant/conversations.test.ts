import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventType } from '@tanstack/ai';
import type { ConnectConnectionAdapter, UIMessage } from '@tanstack/ai-client';
import { fakeApp, type FakeApp } from '../app/fake-app';
import { parseParams } from '../engine/params';
import { KEYS } from '../state/persistence';
import { SETTLE_MS } from './chat';
import { AssistantSession, MAX_RUNNING_CLI, type Conversation } from './conversations';
import type { Transcript, TranscriptBackend } from './history-store';
import { codeHash } from './notes';
import { NOT_RUN } from './transcript';

// Several conversations against a scripted connection: they run side by side, share one undo stack
// and one tool lock, count their tokens, queue what is typed while they work, wait for a free slot
// on the subscription backend, and come back from history sealed and told they were reopened.

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
});

function memoryTranscripts(): TranscriptBackend & { data: Map<string, Transcript> } {
  const data = new Map<string, Transcript>();
  return {
    data,
    get: async (id) => structuredClone(data.get(id) ?? null),
    set: async (id, v) => { data.set(id, structuredClone(v)); },
    remove: async (id) => { data.delete(id); },
  };
}

interface Seen { text: string; messages: UIMessage[]; forwardedProps: unknown }
const lastUserText = (messages: UIMessage[]) => {
  const m = [...messages].reverse().find((x) => x.role === 'user');
  return m ? m.parts.map((p) => (p.type === 'text' ? p.content : '')).join('') : '';
};

// "look …" → a set_look tool call, then (on the continuation) a short reply. "slow …" → waits until released.
function scripted(seen: Seen[], gate?: { wait: Promise<void> }): ConnectConnectionAdapter {
  return {
    async *connect(messages, _data, _signal, ctx) {
      const ms = messages as UIMessage[];
      const text = lastUserText(ms);
      const typed = text.split('\n').at(-1)!;   // what the user typed, after any notes
      seen.push({ text, messages: structuredClone(ms), forwardedProps: ctx?.forwardedProps });
      const model = 'fake', now = Date.now(), runId = ctx?.runId ?? 'r', threadId = ctx?.threadId ?? 't';
      yield { type: EventType.RUN_STARTED, runId, threadId, model, timestamp: now };
      const last = ms.at(-1)!;
      const continuation = last.role === 'assistant';
      if (typed.startsWith('slow') && !continuation && gate) await gate.wait;
      if (typed.startsWith('look') && !continuation) {
        const input = { hue: 0.5 };
        yield { type: EventType.TOOL_CALL_START, toolCallId: `call-${seen.length}`, toolCallName: 'set_look', toolName: 'set_look', model, timestamp: now };
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: `call-${seen.length}`, model, timestamp: now, delta: JSON.stringify(input), args: JSON.stringify(input) };
        yield { type: EventType.TOOL_CALL_END, toolCallId: `call-${seen.length}`, toolCallName: 'set_look', toolName: 'set_look', model, timestamp: now, input };
        yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'stop', usage: { promptTokens: 1000, completionTokens: 40, totalTokens: 1040, promptTokensDetails: { cachedTokens: 800 } } };
        return;
      }
      const id = `m-${seen.length}`;
      yield { type: EventType.TEXT_MESSAGE_START, messageId: id, role: 'assistant', model, timestamp: now };
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta: `Reply to: ${typed}`, model, timestamp: now };
      yield { type: EventType.TEXT_MESSAGE_END, messageId: id, model, timestamp: now };
      yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'stop', usage: { promptTokens: 1200, completionTokens: 10, totalTokens: 1210 } };
    },
  } as ConnectConnectionAdapter;
}

const until = async (cond: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

function session(seen: Seen[], extra: { transcripts?: TranscriptBackend; gate?: { wait: Promise<void> }; app?: FakeApp } = {}) {
  const app = extra.app ?? fakeApp();
  const forgotten: string[] = [];
  const s = new AssistantSession(app, { connection: scripted(seen, extra.gate), transcripts: extra.transcripts ?? memoryTranscripts(), locks: null, forgetThread: (id) => forgotten.push(id) });
  s.attach();
  return { app, s, forgotten };
}

describe('assistant conversations', () => {
  it('runs two conversations at once; each counts its tokens; replies with the panel closed are unread and peek', async () => {
    const seen: Seen[] = [];
    const gate = { release: () => {}, wait: Promise.resolve() };
    gate.wait = new Promise<void>((r) => { gate.release = r; });
    const { app, s } = session(seen, { gate });
    const a = s.active;
    await a.load();
    a.send('slow question');
    await until(() => a.running);
    s.newChat();
    await until(() => s.active !== a);
    const b = s.active;
    await b.load();
    b.send('quick question');
    await until(() => !b.running && b.view.messages.length === 2);

    expect(a.running).toBe(true);                         // still waiting on its slow reply
    expect(app.ui.get().assistantBusy).toBe(true);        // the director keeps waiting
    gate.release();
    await until(() => !a.running && a.view.messages.length === 2);
    expect(app.ui.get().assistantBusy).toBe(false);

    expect(s.view.chats.map((c) => c.title).sort()).toEqual(['quick question', 'slow question']);
    expect(s.meta(a.id)!.usage).toMatchObject({ prompt: 1200, completion: 10 });
    expect(s.meta(b.id)!.lastPrompt).toBe(1200);
    expect(app.ui.get().assistantUnread).toBe(2);         // the panel was closed for both
    expect(app.ui.get().assistantPeek).toMatchObject({ chatId: a.id, text: 'Reply to: slow question' });

    app.ui.set({ assistantOpen: true });                  // opening shows b: b is read
    expect(s.view.live[b.id]!.unread).toBe(false);
    expect(app.ui.get().assistantUnread).toBe(1);
    expect(app.ui.get().assistantPeek).toBeNull();
    s.dispose();
  });

  it('runs tools through one shared undo stack; Undo reverts the newest change and tells its conversation on the next message', async () => {
    const seen: Seen[] = [];
    const { app, s } = session(seen);
    const c = s.active;
    await c.load();
    c.send('look brighter');
    await until(() => !c.running && seen.length === 2);   // the run, and the continuation after the tool ran
    expect(app.state.look.hue).toBe(0.5);
    expect(s.undo.store.get()).toMatchObject({ labels: ['Adjusted the look'], lastChat: c.id });
    expect(s.meta(c.id)!.usage).toMatchObject({ prompt: 2200, completion: 50, cacheRead: 800 });
    // The tool call and the reply after it are two assistant messages; each keeps its own run's usage.
    const replies = c.view.messages.filter((m) => m.role === 'assistant');
    expect(replies.map((m) => c.view.replyUsage[m.id]?.prompt)).toEqual([1000, 1200]);

    expect(s.undoLast()).toEqual({ label: 'Adjusted the look' });
    expect(app.state.look.hue).toBe(0);
    expect(c.view.notes).toHaveLength(1);
    c.send('thanks');
    await until(() => seen.length === 3 && !c.running);
    expect(seen[2]!.text).toMatch(/^\(The user pressed Undo and reverted your change: Adjusted the look\.\)\n\nthanks$/);
    expect(c.view.notes).toEqual([]);
    expect(seen[2]!.forwardedProps).toMatchObject({ continued: true });
    s.dispose();
  });

  it('queues what is typed while a run is going and sends it next', async () => {
    const seen: Seen[] = [];
    const gate = { release: () => {}, wait: Promise.resolve() };
    gate.wait = new Promise<void>((r) => { gate.release = r; });
    const { s } = session(seen, { gate });
    const c = s.active;
    await c.load();
    c.send('slow one');
    await until(() => c.running);
    c.send('second');
    c.send('third');
    expect(c.view.outbox.map((m) => m.text)).toEqual(['second', 'third']);
    c.cancelQueued(c.view.outbox[1]!.id);
    gate.release();
    await until(() => seen.length === 2 && !c.running && !c.view.outbox.length);
    expect(seen.map((x) => x.text)).toEqual(['slow one', 'second']);
    s.dispose();
  });

  it(`runs at most ${MAX_RUNNING_CLI} conversations at once on the subscription backend; the next waits for a slot`, async () => {
    const seen: Seen[] = [];
    const gate = { release: () => {}, wait: Promise.resolve() };
    gate.wait = new Promise<void>((r) => { gate.release = r; });
    const { s } = session(seen, { gate });
    s.setBackend('claude-code');
    const convs: Conversation[] = [];
    for (let i = 0; i < MAX_RUNNING_CLI + 1; i++) {
      if (i) s.newChat();
      await until(() => !convs.includes(s.active));
      const c = s.active;
      convs.push(c);
      await c.load();
      c.send(`slow ${i}`);
    }
    await until(() => convs.filter((c) => c.running).length === MAX_RUNNING_CLI);
    expect(convs.at(-1)!.view.status).toBe('waiting');
    gate.release();
    await until(() => convs.every((c) => c.view.status === 'idle'), 6000);
    expect(seen.map((x) => x.text).sort()).toEqual(['slow 0', 'slow 1', 'slow 2', 'slow 3']);
    s.dispose();
  });

  it('reopens a conversation from history sealed (an interrupted tool call is not re-run) and says it was reopened', async () => {
    const transcripts = memoryTranscripts();
    const id = '00000000-0000-4000-8000-000000000001';
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'make it pink' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'tool-call', id: 'call-x', name: 'set_look', arguments: '{"hue":0.9}', input: { hue: 0.9 }, state: 'input-complete' }] },
    ];
    transcripts.data.set(id, { messages, replyUsage: {} });
    storage.set(KEYS.assistantChats, JSON.stringify({ v: 1, chats: [{ id, title: 'make it pink', createdAt: 1, updatedAt: 2, usage: { prompt: 10, completion: 1, cacheRead: 0, cacheWrite: 0, cost: 0 } }], activeId: id }));

    const seen: Seen[] = [];
    const { app, s } = session(seen, { transcripts });
    expect(s.view.activeId).toBe(id);
    const c = s.active;
    await until(() => c.view.loaded);
    const parts = c.view.messages[1]!.parts;
    expect(parts.find((p) => p.type === 'tool-result')).toMatchObject({ toolCallId: 'call-x', state: 'error', content: NOT_RUN });

    c.send('hello again');
    await until(() => seen.length >= 1 && !c.running);
    expect(app.state.look.hue).toBe(0);                   // the stale call (hue 0.9) did not run
    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toMatch(/^\(This conversation was reopened on .*get_app_state.*\)\n\nhello again$/);
    expect(JSON.stringify(seen[0]!.messages)).toContain(NOT_RUN);
    s.dispose();
  });

  it('remembers what was on screen when a reply finished, and a reopened conversation hears whether that scene changed', async () => {
    const transcripts = memoryTranscripts();
    const { params } = parseParams('uniform float uGlow; // @param min=0 max=3');
    const app = fakeApp({ scenes: [{ name: 'Alpha', body: 'void main() { fragColor = vec4(1.); }' }], params: [params] });
    app.library.setValues(0, { uGlow: 1.23456 });
    const scene = app.state.scenes[0]!;
    const first = session([], { transcripts, app });
    const c = first.s.active;
    await c.load();
    c.send('hello');
    await until(() => !c.running && c.view.messages.length === 2);
    expect(first.s.meta(c.id)!.seen).toEqual({ scene: 'Alpha', hash: codeHash(scene.body) });
    await until(() => transcripts.data.has(c.id));
    first.s.dispose();

    const reopen = async () => {
      const seen: Seen[] = [];
      const again = session(seen, { transcripts, app });
      await until(() => again.s.active.view.loaded);
      again.s.active.send('and now?');
      await until(() => seen.length >= 1 && !again.s.active.running);
      const n = again.s.active.view.messages.length;
      await until(() => transcripts.data.get(c.id)?.messages.length === n);   // kept before the next reopen reads it
      again.s.dispose();
      return seen[0]!.text;
    };
    const unchanged = await reopen();
    expect(unchanged).toContain('On screen: "Alpha", the scene from your last reply, its code unchanged since; its parameters are {"uGlow":1.235}');
    expect(unchanged).not.toContain('call get_app_state before');

    scene.body = 'void main() { fragColor = vec4(.5); }';   // edited by hand while the chat was closed
    expect(await reopen()).toContain('its code changed since: read it before editing');
  });

  it('a session disposed before a stored transcript was read leaves that transcript alone (StrictMode mounts twice)', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    const messages: UIMessage[] = [{ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'keep me' }] }];
    const stored = memoryTranscripts();
    stored.data.set(id, { messages, replyUsage: {} });
    // Reading takes a while (IndexedDB); the first session is gone before it answers.
    const slow: TranscriptBackend = { ...stored, get: async (key) => { await new Promise((r) => setTimeout(r, 50)); return stored.get(key); } };
    storage.set(KEYS.assistantChats, JSON.stringify({ v: 1, chats: [{ id, title: 'keep me', createdAt: 1, updatedAt: 2 }], activeId: id }));

    const first = session([], { transcripts: slow });
    first.s.dispose();
    await new Promise((r) => setTimeout(r, 80));   // past the slow read: nothing is written before it, nor after a close
    expect(stored.data.get(id)?.messages).toEqual(messages);

    const second = session([], { transcripts: slow });
    await until(() => second.s.active.view.loaded);
    expect(second.s.active.view.messages[0]!.id).toBe('u1');
    second.s.dispose();
  });

  it('deletes a conversation everywhere: index, transcript and the CLI session', async () => {
    const transcripts = memoryTranscripts();
    const seen: Seen[] = [];
    const { s, forgotten } = session(seen, { transcripts });
    const c = s.active;
    await c.load();
    c.send('hello');
    await until(() => !c.running && c.view.messages.length === 2);
    await until(() => transcripts.data.has(c.id));
    expect(JSON.parse(storage.get(KEYS.assistantChats)!).chats).toHaveLength(1);
    await s.remove(c.id);
    expect(transcripts.data.has(c.id)).toBe(false);
    expect(JSON.parse(storage.get(KEYS.assistantChats)!).chats).toHaveLength(0);
    expect(forgotten).toEqual([c.id]);
    expect(s.view.activeId).not.toBe(c.id);
    s.dispose();
  });

  it('deletes a running conversation for good: nothing writes it back or brings it back later', async () => {
    const transcripts = memoryTranscripts();
    const gate = { release: () => {}, wait: Promise.resolve() };
    gate.wait = new Promise<void>((r) => { gate.release = r; });
    const { app, s } = session([], { transcripts, gate });
    const c = s.active;
    await c.load();
    c.send('slow question');
    await until(() => c.running);
    await s.remove(c.id);
    gate.release();
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));   // past the run's settle (nothing writes after a delete)
    expect(transcripts.data.has(c.id)).toBe(false);
    expect(s.view.live[c.id]).toBeUndefined();
    expect(app.ui.get().assistantPeek).toBeNull();
    expect(app.ui.get().assistantBusy).toBe(false);
    s.dispose();
  });
});

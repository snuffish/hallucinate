// The assistant panel's conversations, outside React (like the studio and the director): several can
// run at once, each on its own Chat (chat.ts), and they keep running while the panel shows
// another one or is closed. The session keeps the history index, decides which conversation may
// start a run (the subscription backend runs a `claude` process per run), and publishes what the
// bubble needs (running, unread, the peek card) to the UI store.
//
// Shared between conversations: one tool lock (their tools act on one app) and one undo stack (an
// undo closure restores a snapshot, so only the newest change can be undone safely).

import { fetchServerSentEvents, type ConnectConnectionAdapter, type ConnectionAdapter, type UIMessage } from '@tanstack/ai-client';
import type { AppPort } from '../app/app-port';
import type { StudioSession } from '../app/studio';
import { KEYS } from '../state/persistence';
import { Store } from '../state/store';
import { Chat, forgetThread } from './chat';
import { createToolRunner, UndoConflict, type ToolRunner } from './executor';
import type { Backend } from './settings-wire';
import { HISTORY_CAP, indexedDBTranscripts, loadTranscript, prune, readIndex, transcriptWriter, writeIndex, type ChatMeta, type TranscriptBackend, type TranscriptWriter } from './history-store';
import { createLock, serialized, type Lock } from './lock';
import { codeHash, resumeNote, undoNote, withNotes, type ScreenNow } from './notes';
import { previewOf, prepareForSend, titleFrom } from './transcript';
import { UndoStack } from './undo';
import { addUsage, NO_USAGE, type Usage } from './usage';

export const MAX_RUNNING_CLI = 3;     // subscription backend: one `claude -p` per running conversation
export const LONG_CHAT_TOKENS = 80_000;   // context size: every step of every message resends it

export type ChatStatus = 'idle' | 'running' | 'waiting';
export interface Outgoing { id: string; text: string }

export interface ChatView {
  id: string;
  loaded: boolean;              // the stored transcript has been read (or there is none)
  messages: UIMessage[];
  replyUsage: Record<string, Usage>;
  status: ChatStatus;
  error: string | null;
  outbox: Outgoing[];           // typed while a run was going, or waiting for a free slot
  notes: string[];              // ride with the next message (undo, reopened)
  draft: string;
  readOnly: boolean;            // open in another tab
  runStartedAt: number | null;
  runTools: number;             // tool calls in the current run
}

export interface ChatLive { status: ChatStatus; unread: boolean; error: boolean }

export interface SessionView {
  chats: ChatMeta[];            // the history, newest first (an empty new chat isn't in it yet)
  activeId: string;
  live: Record<string, ChatLive>;
  storageOk: boolean;           // transcripts can be kept (IndexedDB works)
}

interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | null): Promise<unknown>;
}

export interface SessionOptions {
  connection?: ConnectConnectionAdapter;   // tests hand in a scripted one
  transcripts?: TranscriptBackend;
  locks?: LockManagerLike | null;
  forgetThread?: (threadId: string) => void;
  now?: () => number;
  lock?: Lock;                              // shared with the director (sessions.ts); one of its own otherwise
  studio?: () => StudioSession | null;      // the show the studio tools act on
}

const newId = () => crypto.randomUUID();
const sortChats = (chats: ChatMeta[]) => [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

// ---------------------------------------------------------------------------------------------

export class Conversation {
  readonly store: Store<ChatView>;
  private chat: Chat | null = null;
  private readonly writer: TranscriptWriter;
  private release: (() => void) | null = null;
  private loadPromise: Promise<void> | null = null;
  private restored = false;     // came from history: the first send says so

  constructor(readonly id: string, private readonly session: AssistantSession) {
    this.store = new Store<ChatView>({ id, loaded: false, messages: [], replyUsage: {}, status: 'idle', error: null, outbox: [], notes: [], draft: '', readOnly: false, runStartedAt: null, runTools: 0 });
    this.writer = transcriptWriter(session.transcripts, id, () => session.storageFailed());
  }

  get view(): ChatView { return this.store.get(); }
  get running(): boolean { return this.view.status === 'running'; }

  // Reads the stored transcript (sealed) and takes this tab's lock on the conversation. Once.
  load(stored: boolean): Promise<void> {
    this.loadPromise ??= (async () => {
      this.release = await this.session.lock(this.id, () => this.store.set({ readOnly: true }));
      const t = stored ? await loadTranscript(this.session.transcripts, this.id) : null;
      if (t && t.messages.length) this.restored = true;
      this.store.set({ loaded: true, ...(t && { messages: t.messages, replyUsage: t.replyUsage }) });
    })();
    return this.loadPromise;
  }

  setDraft(draft: string): void { this.store.set({ draft }); }

  // Queues a message; it goes out as soon as this conversation is idle and a slot is free.
  send(text: string): void {
    const t = text.trim();
    if (!t || this.view.readOnly) return;
    this.store.set({ outbox: [...this.view.outbox, { id: newId(), text: t }], error: null });
    this.pump();
  }

  cancelQueued(id: string): void {
    const outbox = this.view.outbox.filter((m) => m.id !== id);
    this.store.set({ outbox, ...(this.view.status === 'waiting' && !outbox.length && { status: 'idle' }) });
    this.session.changed(this);
  }

  addNote(note: string): void { this.store.set({ notes: [...this.view.notes, note] }); }

  // Starts the next queued message when it may.
  pump(): void {
    const v = this.view;
    if (!v.loaded || v.readOnly || this.running || !v.outbox.length) return;
    if (!this.session.mayStart(this)) {
      if (v.status !== 'waiting') { this.store.set({ status: 'waiting' }); this.session.changed(this); }
      return;
    }
    const [next, ...rest] = v.outbox;
    const notes = [...v.notes, ...(this.restored ? [resumeNote(new Date(this.session.now()), this.session.meta(this.id)?.seen, this.session.screen())] : [])];
    this.restored = false;
    this.store.set({ outbox: rest, notes: [], status: 'running', error: null, runStartedAt: this.session.now(), runTools: 0 });
    this.session.started(this, next!.text);
    const continued = v.messages.some((m) => m.role === 'assistant');
    void this.ensureChat().send(withNotes(notes, next!.text), { continued });
  }

  stop(): void {
    this.store.set({ outbox: [], ...(this.view.status === 'waiting' && { status: 'idle' }) });
    this.session.changed(this);
    this.chat?.stop();
  }

  // Re-sends the last request after an error.
  retry(): void {
    if (!this.chat || this.running || this.view.readOnly) return;
    if (!this.session.mayStart(this)) { this.store.set({ error: 'Waiting for another conversation to finish. Try again in a moment.' }); return; }
    this.store.set({ status: 'running', error: null, runStartedAt: this.session.now(), runTools: 0 });
    this.session.changed(this);
    void this.chat.retry();
  }

  // `save`: keep the transcript (false when the conversation is being deleted: nothing is written
  // after that, not even a reply still streaming in). A conversation whose stored transcript hasn't
  // been read yet has nothing of its own to save, and must not overwrite it.
  dispose(save = true): void {
    const sealed = this.chat?.dispose();
    this.chat = null;
    if (save && sealed) this.store.set({ messages: sealed });
    if (save && this.view.loaded) this.writer.schedule(this.transcript());
    else this.writer.cancel();
    this.writer.dispose();
    this.release?.();
    this.release = null;
  }

  // ---- internals ----

  private transcript() { return { messages: this.view.messages, replyUsage: this.view.replyUsage }; }

  private ensureChat(): Chat {
    this.chat ??= new Chat({ connection: this.session.connection, runner: this.session.runnerFor(this.id), threadId: this.id, messages: this.view.messages }, {
      messages: (messages) => {
        this.store.set({ messages });
        this.writer.schedule(this.transcript());
      },
      replied: () => { this.writer.schedule(this.transcript()); void this.writer.flush(); },   // a reply is complete: keep it now
      tool: () => this.store.set({ runTools: this.view.runTools + 1 }),
      usage: (u, context) => this.countUsage(u, context),
      error: (message) => this.store.set({ error: message }),
      settled: () => this.settled(),
    });
    return this.chat;
  }

  private countUsage(u: Usage, context: number): void {
    const reply = [...this.view.messages].reverse().find((m) => m.role === 'assistant');
    if (reply) this.store.set({ replyUsage: { ...this.view.replyUsage, [reply.id]: addUsage(this.view.replyUsage[reply.id] ?? NO_USAGE, u) } });
    this.session.usage(this, u, context);
  }

  private settled(): void {
    this.store.set({ status: 'idle', runStartedAt: null });
    void this.writer.flush().then(() => this.writer.schedule(this.transcript())).then(() => this.writer.flush());
    this.session.settled(this);
    this.pump();
  }
}

// ---------------------------------------------------------------------------------------------

export class AssistantSession {
  readonly store: Store<SessionView>;
  readonly undo = new UndoStack();
  readonly transcripts: TranscriptBackend;
  readonly connection: ConnectionAdapter;
  readonly now: () => number;
  private readonly lockTools: Lock;
  private readonly chats = new Map<string, Conversation>();
  private readonly runners = new Map<string, ToolRunner>();
  private readonly locks: LockManagerLike | null;
  private maxRunning = Infinity;
  private peekKey = 0;
  private baseTitle = typeof document !== 'undefined' ? document.title : '';
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly app: AppPort, private readonly opts: SessionOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.lockTools = opts.lock ?? createLock();
    this.transcripts = opts.transcripts ?? indexedDBTranscripts();
    const base: ConnectConnectionAdapter = opts.connection ?? fetchServerSentEvents('/api/assistant');
    // Not resumable on purpose (no joinRun): a run is never rejoined, only sealed. Old screenshots stay home.
    this.connection = { connect: (messages, ...rest) => base.connect(prepareForSend(messages as UIMessage[]), ...rest) };
    this.locks = opts.locks !== undefined ? opts.locks : ((typeof navigator !== 'undefined' && (navigator as { locks?: LockManagerLike }).locks) || null);

    const index = readIndex();
    const chats = sortChats(index.chats);
    const activeId = index.activeId ?? chats[0]?.id ?? newId();
    this.store = new Store<SessionView>({ chats, activeId, live: {}, storageOk: true });
  }

  // Starts listening and opens the conversation on screen. Returns the undo of the listening (React
  // StrictMode attaches twice); the conversations themselves keep running.
  attach(): () => void {
    const off: (() => void)[] = [];
    if (typeof window !== 'undefined') {
      const onStorage = (e: StorageEvent) => { if (e.key === KEYS.assistantChats) this.mergeIndex(); };
      const onVisible = () => this.publish();
      window.addEventListener('storage', onStorage);
      document.addEventListener('visibilitychange', onVisible);
      off.push(() => window.removeEventListener('storage', onStorage), () => document.removeEventListener('visibilitychange', onVisible));
    }
    // Opening the panel marks the conversation on screen as read; a peek click asks for one.
    off.push(this.app.ui.subscribe(() => {
      const ui = this.app.ui.get();
      if (ui.assistantFocus) { this.app.ui.set({ assistantFocus: null }); this.select(ui.assistantFocus); }
      if (ui.assistantOpen) { this.markRead(this.view.activeId); if (ui.assistantPeek) this.app.ui.set({ assistantPeek: null }); }
    }));
    void this.open(this.view.activeId);
    const detach = () => { for (const f of off.splice(0)) f(); };
    this.disposers.push(detach);
    return detach;
  }

  get view(): SessionView { return this.store.get(); }
  get active(): Conversation { return this.conversation(this.view.activeId); }
  meta(id: string): ChatMeta | undefined { return this.view.chats.find((c) => c.id === id); }
  isRunning(id: string): boolean { return this.chats.get(id)?.running ?? false; }

  conversation(id: string): Conversation {
    let c = this.chats.get(id);
    if (!c) { c = new Conversation(id, this); this.chats.set(id, c); }
    return c;
  }

  // The backend decides how many conversations may run at once.
  setBackend(backend: Backend): void {
    this.maxRunning = backend === 'claude-code' ? MAX_RUNNING_CLI : Infinity;
    for (const c of this.chats.values()) c.pump();
  }

  // ---- navigation ----

  async open(id: string): Promise<void> {
    const c = this.conversation(id);
    this.setActive(id);
    await c.load(!!this.meta(id));
    c.pump();
  }

  select(id: string): void { if (id !== this.view.activeId) void this.open(id); }

  // A fresh conversation, unless the one on screen is still empty.
  newChat(): void {
    const cur = this.active.view;
    if (!cur.messages.length && !cur.outbox.length && !this.meta(cur.id)) return;
    void this.open(newId());
  }

  // The next / previous conversation in the list (Alt+↓ / Alt+↑).
  step(dir: 1 | -1): void {
    const ids = this.view.chats.map((c) => c.id);
    if (!ids.length) return;
    const at = ids.indexOf(this.view.activeId);
    const next = at < 0 ? (dir > 0 ? 0 : ids.length - 1) : (at + dir + ids.length) % ids.length;
    this.select(ids[next]!);
  }

  rename(id: string, title: string): void {
    const t = title.trim();
    if (!t) return;
    this.updateMeta(id, { title: t.slice(0, 80), renamed: true }, false);
  }

  setPinned(id: string, pinned: boolean): void { this.updateMeta(id, { pinned }, false); }

  async remove(id: string): Promise<void> {
    const c = this.chats.get(id);
    c?.dispose(false);
    this.chats.delete(id);
    this.runners.delete(id);
    const { [id]: _gone, ...live } = this.view.live;
    const chats = this.view.chats.filter((m) => m.id !== id);
    this.store.set({ chats, live });
    this.saveIndex();
    (this.opts.forgetThread ?? forgetThread)(id);
    try { await this.transcripts.remove(id); } catch { /* storage unavailable */ }
    if (this.view.activeId === id) void this.open(chats[0]?.id ?? newId());
    this.publish();
  }

  async clearHistory(): Promise<void> {
    for (const id of this.view.chats.map((c) => c.id)) await this.remove(id);   // removing the active one opens the next, finally a new one
  }

  // Undo reverts the newest change any conversation made, and tells that conversation. A change that
  // something else built on since can't be undone safely: it is dropped and `error` says why.
  undoLast(): { label: string; error?: string } | null {
    const step = this.undo.pop();
    if (!step) return null;
    try {
      step.undo();
    } catch (err) {
      if (err instanceof UndoConflict) return { label: step.label, error: err.message };
      throw err;
    }
    if (step.chatId) this.chats.get(step.chatId)?.addNote(undoNote(step.label));   // (a deleted conversation hears nothing)
    return { label: step.label };
  }

  // ---- for conversations ----

  runnerFor(chatId: string): ToolRunner {
    let r = this.runners.get(chatId);
    if (!r) {
      r = serialized(createToolRunner(this.app, { push: (entry) => this.undo.push({ ...entry, chatId }) }, this.opts.studio), this.lockTools);
      this.runners.set(chatId, r);
    }
    return r;
  }

  mayStart(c: Conversation): boolean {
    let running = 0;
    for (const other of this.chats.values()) if (other !== c && other.running) running++;
    return running < this.maxRunning;
  }

  // A message goes out: the conversation joins the history (titled by its first message).
  started(c: Conversation, text: string): void {
    const meta = this.meta(c.id);
    if (!meta) {
      const now = this.now();
      const chat: ChatMeta = { id: c.id, title: titleFrom(text), renamed: false, createdAt: now, updatedAt: now, pinned: false, usage: NO_USAGE, lastPrompt: 0, count: 0 };
      const { chats, dropped } = prune([chat, ...this.view.chats], HISTORY_CAP, new Set([...this.chats.values()].filter((x) => x.running).map((x) => x.id)));
      this.store.set({ chats });
      for (const id of dropped) void this.remove(id);
    } else {
      this.updateMeta(c.id, {}, true);
    }
    this.changed(c);
    this.saveIndex();
  }

  usage(c: Conversation, u: Usage, context: number): void {
    const meta = this.meta(c.id);
    if (meta) this.updateMeta(c.id, { usage: addUsage(meta.usage, u), lastPrompt: context || meta.lastPrompt }, false);
  }

  settled(c: Conversation): void {
    const ui = this.app.ui.get();
    const seen = ui.assistantOpen && this.view.activeId === c.id && !(typeof document !== 'undefined' && document.hidden);
    const error = !!c.view.error;
    const screen = this.screen();
    this.updateMeta(c.id, { count: c.view.messages.length, ...(screen && { seen: { scene: screen.scene, hash: screen.hash } }) }, true);
    this.setLive(c.id, { status: 'idle', unread: !seen, error });
    if (!ui.assistantOpen) {
      const meta = this.meta(c.id);
      this.app.ui.set({ assistantPeek: { chatId: c.id, title: meta?.title ?? 'Assistant', text: error ? c.view.error! : previewOf(c.view.messages) || 'Done.', error, key: ++this.peekKey } });
    }
    for (const other of this.chats.values()) if (other !== c) other.pump();   // a slot is free
    this.publish();
  }

  // The scene on screen, its code's fingerprint and its parameter values (null where the app can't say, e.g. in tests).
  screen(): ScreenNow | null {
    try {
      const i = this.app.sceneIndex;
      return { scene: this.app.currentScene.name, hash: codeHash(this.app.editor.target(i).body), values: this.app.paramValues(i) };
    } catch {
      return null;
    }
  }

  changed(c: Conversation): void {
    this.setLive(c.id, { status: c.view.status });
  }

  storageFailed(): void { this.store.set({ storageOk: false }); }

  // One tab per conversation: a second tab gets it read-only.
  async lock(id: string, onTaken: () => void): Promise<(() => void) | null> {
    if (!this.locks) return null;
    return new Promise((resolve) => {
      this.locks!.request(`hallucinate.chat:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) { onTaken(); resolve(null); return null; }
        return new Promise<void>((release) => resolve(release));
      }).catch(() => resolve(null));
    });
  }

  markRead(id: string): void {
    const live = this.view.live[id];
    if (live?.unread) this.setLive(id, { unread: false, error: false });
    if (this.app.ui.get().assistantPeek?.chatId === id) this.app.ui.set({ assistantPeek: null });
  }

  dismissPeek(): void { this.app.ui.set({ assistantPeek: null }); }

  dispose(): void {
    for (const c of this.chats.values()) c.dispose();
    for (const d of this.disposers) d();
    this.saveIndex();
    if (typeof document !== 'undefined') document.title = this.baseTitle;
  }

  // ---- internals ----

  private setActive(id: string): void {
    this.store.set({ activeId: id });
    if (this.app.ui.get().assistantOpen) this.markRead(id);
    if (this.meta(id)) this.saveIndex();
  }

  private setLive(id: string, patch: Partial<ChatLive>): void {
    const cur = this.view.live[id] ?? { status: 'idle', unread: false, error: false };
    const next = { ...cur, ...patch };
    if (cur.status === next.status && cur.unread === next.unread && cur.error === next.error) return;
    this.store.set({ live: { ...this.view.live, [id]: next } });
    this.publish();
  }

  private updateMeta(id: string, patch: Partial<ChatMeta>, touch: boolean): void {
    let found = false;
    const chats = this.view.chats.map((c) => {
      if (c.id !== id) return c;
      found = true;
      return { ...c, ...patch, ...(touch && { updatedAt: this.now() }) };
    });
    if (!found) return;
    this.store.set({ chats: touch ? sortChats(chats) : chats });
    this.saveIndex();
  }

  private saveIndex(): void {
    const activeId = this.meta(this.view.activeId) ? this.view.activeId : null;
    writeIndex({ chats: this.view.chats, activeId });
  }

  // Another tab changed the history: take its list, but keep what this tab knows about its own conversations.
  private mergeIndex(): void {
    const theirs = readIndex().chats;
    const mine = new Map(this.view.chats.map((c) => [c.id, c]));
    const merged = theirs.map((c) => (this.chats.has(c.id) && mine.has(c.id) ? mine.get(c.id)! : c));
    for (const c of this.view.chats) if (this.chats.get(c.id)?.running && !merged.some((m) => m.id === c.id)) merged.push(c);
    this.store.set({ chats: sortChats(merged) });
  }

  // What the bubble and the director need, and the window title while the tab is hidden.
  private publish(): void {
    const live = Object.values(this.view.live);
    const running = [...this.chats.values()].filter((c) => c.view.status !== 'idle').length;
    const unread = live.filter((l) => l.unread).length;
    this.app.ui.set({ assistantBusy: running > 0, assistantRunning: running, assistantUnread: unread });
    if (typeof document === 'undefined') return;
    document.title = document.hidden && unread ? `(${unread}) ${this.baseTitle}` : this.baseTitle;
  }
}

export type { ChatMeta };

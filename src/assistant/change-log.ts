// What the assistant's and the director's tools changed: one record per change, with the state it
// touched before and after, so the chat can show it under the tool call that made it (a code diff,
// before → after values, show scenes added or changed) and the studio can show the director's. Records
// are made where every change is recorded for undo (executor.ts, `record`) and kept on this computer
// with the conversation they belong to: deleting or pruning a chat deletes them.

import { defaultStore, newId, type RecordStore } from '../state/history-db';
import { Store } from '../state/store';

export type ChangeKind = 'code' | 'created' | 'values' | 'look' | 'show' | 'transition' | 'autopilot' | 'plan';

// The director's records go under this chat id.
export const DIRECTOR_CHAT = 'director';
export const DIRECTOR_KEEP = 40;   // the director's newest changes kept

export interface Change {
  id: string;
  chatId: string;
  toolCallId?: string;
  tool: string;
  label: string;
  at: number;
  kind: ChangeKind;
  scene?: string;      // the scene a code, created or values change is to
  before: unknown;     // code: the code; values/look: name → value; show: the show snapshot; plan: { show, on }
  after: unknown;
}

// What a tool runner reports; the session adds whose it is and when.
export type ChangeDraft = Omit<Change, 'id' | 'chatId' | 'at'>;

export class ChangeLog {
  // `revision` moves on every change, for views to re-read.
  readonly store = new Store<{ revision: number }>({ revision: 0 });
  readonly ready: Promise<void>;
  private changes: Change[] = [];   // oldest first
  private loaded = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly backend: RecordStore<Change> = defaultStore<Change>('changes'), private readonly now: () => number = Date.now) {
    this.ready = backend.all()
      .catch(() => [] as Change[])
      .then((all) => {
        this.changes = [...all, ...this.changes].sort((a, b) => a.at - b.at);
        this.loaded = true;
        this.trim();
        this.publish();
      });
  }

  add(chatId: string, draft: ChangeDraft): Change {
    const change: Change = { id: newId('c'), chatId, at: this.now(), ...draft };
    if (change.toolCallId === undefined) delete change.toolCallId;
    if (change.scene === undefined) delete change.scene;
    this.changes.push(change);
    this.writes = this.writes.then(() => this.backend.put(change)).catch(() => { /* storage unavailable: kept for this session */ });
    if (chatId === DIRECTOR_CHAT) this.trim();
    this.publish();
    return change;
  }

  forCall(chatId: string, toolCallId: string): Change[] {
    return this.changes.filter((c) => c.chatId === chatId && c.toolCallId === toolCallId);
  }

  // Newest first.
  forChat(chatId: string): Change[] { return this.changes.filter((c) => c.chatId === chatId).reverse(); }

  // A conversation is deleted: its records go with it.
  dropChat(chatId: string): void {
    if (!this.loaded) { void this.ready.then(() => this.dropChat(chatId)); return; }
    const gone = this.changes.filter((c) => c.chatId === chatId).map((c) => c.id);
    if (!gone.length) return;
    this.changes = this.changes.filter((c) => c.chatId !== chatId);
    this.forget(gone);
    this.publish();
  }

  flush(): Promise<void> { return this.ready.then(() => this.writes); }

  private trim(): void {
    const mine = this.changes.filter((c) => c.chatId === DIRECTOR_CHAT);
    const over = mine.slice(0, Math.max(0, mine.length - DIRECTOR_KEEP));
    if (!over.length) return;
    const ids = new Set(over.map((c) => c.id));
    this.changes = this.changes.filter((c) => !ids.has(c.id));
    this.forget([...ids]);
  }

  private forget(ids: string[]): void {
    this.writes = this.writes.then(() => this.backend.delete(ids)).catch(() => {});
  }

  private publish(): void { this.store.set({ revision: this.store.get().revision + 1 }); }
}

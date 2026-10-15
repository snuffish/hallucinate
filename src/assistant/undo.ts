// The assistant's undo stack: every change a tool makes comes with a closure that reverts it.
// The panel's conversations share one stack (a closure restores a snapshot, so undoing an older
// change past a newer one would silently wipe the newer one out); `chatId` says whose change it was.

import { Store } from '../state/store';

export interface UndoEntry { label: string; undo: () => void; chatId?: string }

export class UndoStack {
  readonly store = new Store<{ labels: string[]; lastChat: string | null }>({ labels: [], lastChat: null });
  private entries: UndoEntry[] = [];

  push(entry: UndoEntry): void {
    this.entries = [...this.entries, entry];
    this.publish();
  }

  pop(): UndoEntry | undefined {
    const entry = this.entries.at(-1);
    if (!entry) return undefined;
    this.entries = this.entries.slice(0, -1);
    this.publish();
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.publish();
  }

  get last(): string | undefined { return this.entries.at(-1)?.label; }

  private publish(): void {
    this.store.set({ labels: this.entries.map((e) => e.label), lastChat: this.entries.at(-1)?.chatId ?? null });
  }
}

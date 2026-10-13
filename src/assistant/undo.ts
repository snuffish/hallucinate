// The assistant's undo stack: every change a tool makes comes with a closure that reverts it.

import { Store } from '../state/store';

export interface UndoEntry { label: string; undo: () => void }

export class UndoStack {
  readonly store = new Store<{ labels: string[] }>({ labels: [] });
  private entries: UndoEntry[] = [];

  push(entry: UndoEntry): void {
    this.entries = [...this.entries, entry];
    this.store.set({ labels: this.entries.map((e) => e.label) });
  }

  pop(): UndoEntry | undefined {
    const entry = this.entries.at(-1);
    if (!entry) return undefined;
    this.entries = this.entries.slice(0, -1);
    this.store.set({ labels: this.entries.map((e) => e.label) });
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.store.set({ labels: [] });
  }

  get last(): string | undefined { return this.entries.at(-1)?.label; }
}

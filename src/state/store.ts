// A tiny external store for React: components subscribe with selectors, the render loop and the
// actions publish a fresh snapshot only when something UI-visible changed. Per-frame values never
// go through here faster than ~30 Hz.

import { useSyncExternalStore } from 'react';

type Listener = () => void;

export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private snapshot: T) {}

  get(): T { return this.snapshot; }

  // Replace the snapshot (shallow-merge) and notify. Returns true when something changed.
  set(patch: Partial<T>): boolean {
    let changed = false;
    for (const key in patch) if (!Object.is(this.snapshot[key], patch[key])) { changed = true; break; }
    if (!changed) return false;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
    return true;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}

export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}

// Which parameter groups are open, per scene (keyed like the stored values, by `paramKey`). Groups
// start folded; opening one is remembered. A UI convenience like the help hint: kept across
// reloads, not part of the settings export.

import { z } from 'zod';
import { KEYS, readJSON, writeJSON } from './persistence';
import { Store, useStore } from './store';

const OpenSchema = z.record(z.string(), z.array(z.string()));
type Open = z.infer<typeof OpenSchema>;

const NONE: readonly string[] = [];
const store = new Store<Open>(readJSON(KEYS.paramGroups, OpenSchema, {}));

export const useOpenGroups = (key: string): readonly string[] => useStore(store, (s) => s[key] ?? NONE);

// Open or fold `group` of scene `key`. `current` (the scene's group names now) drops names a code
// edit renamed or removed, so the stored lists don't grow.
export function toggleGroup(key: string, group: string, current: readonly string[]): void {
  const was = store.get()[key] ?? [];
  setOpen(key, (was.includes(group) ? was.filter((g) => g !== group) : [...was, group]).filter((g) => current.includes(g)));
}

// Open every group of scene `key` (pass its group names) or fold them all (pass []).
export function setOpen(key: string, groups: readonly string[]): void {
  store.set({ [key]: [...groups] });
  writeJSON(KEYS.paramGroups, Object.fromEntries(Object.entries(store.get()).filter(([, list]) => list.length)));
}

// Which parameter groups are folded, per scene (keyed like the stored values, by `paramKey`). A UI
// convenience like the help hint: kept across reloads, not part of the settings export.

import { z } from 'zod';
import { KEYS, readJSON, writeJSON } from './persistence';
import { Store, useStore } from './store';

const CollapsedSchema = z.record(z.string(), z.array(z.string()));
type Collapsed = z.infer<typeof CollapsedSchema>;

const NONE: readonly string[] = [];
const store = new Store<Collapsed>(readJSON(KEYS.paramGroups, CollapsedSchema, {}));

export const useCollapsedGroups = (key: string): readonly string[] => useStore(store, (s) => s[key] ?? NONE);

// Fold or unfold `group` of scene `key`. `current` (the scene's group names now) drops names a code
// edit renamed or removed, so the stored lists don't grow.
export function toggleGroup(key: string, group: string, current: readonly string[]): void {
  const was = store.get()[key] ?? [];
  setCollapsed(key, (was.includes(group) ? was.filter((g) => g !== group) : [...was, group]).filter((g) => current.includes(g)));
}

// Fold every group of scene `key` (pass its group names) or unfold them all (pass []).
export function setCollapsed(key: string, groups: readonly string[]): void {
  store.set({ [key]: [...groups] });
  writeJSON(KEYS.paramGroups, Object.fromEntries(Object.entries(store.get()).filter(([, list]) => list.length)));
}

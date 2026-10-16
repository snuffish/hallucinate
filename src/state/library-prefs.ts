// Library preferences: favourites (come up twice as often in auto-switch) and scenes taken out of
// the rotation. Stored by scene name, as before.

import { z } from 'zod';
import { CATEGORIES, type Scene } from '../scenes';
import { KEYS, readWithDefaults, writeJSON } from './persistence';

export const PrefsSchema = z.object({ favs: z.array(z.string()).default([]), off: z.array(z.string()).default([]) });
export type LibraryPrefs = z.infer<typeof PrefsSchema>;

export const loadLibraryPrefs = (): LibraryPrefs => readWithDefaults(KEYS.library, PrefsSchema);
export const saveLibraryPrefs = (prefs: LibraryPrefs): void => writeJSON(KEYS.library, prefs);

export const isFav = (prefs: LibraryPrefs, s: Scene) => prefs.favs.includes(s.name);
export const inRotation = (prefs: LibraryPrefs, s: Scene) => !prefs.off.includes(s.name);

export function togglePref(prefs: LibraryPrefs, list: 'favs' | 'off', s: Scene): LibraryPrefs {
  const names = prefs[list];
  return { ...prefs, [list]: names.includes(s.name) ? names.filter((n) => n !== s.name) : [...names, s.name] };
}

// Scenes the library lists: the visuals and your saved scenes (not the editor slots).
export const listedScenes = (scenes: readonly Scene[]) =>
  scenes.map((s, i) => ({ s, i })).filter(({ s }) => !s.removed && !s.kind);

// The library's filter tabs. A category tab shows only when it has scenes; Mine only when you have saved one.
export const SPECIAL_TABS: readonly string[] = ['All', '★ Favourites', '⚙ Tweakable'];
export function libraryTabs(scenes: readonly Scene[]): string[] {
  const cats = new Set(listedScenes(scenes).map(({ s }) => (s.user ? 'Mine' : s.cat)));
  return [...SPECIAL_TABS, ...CATEGORIES.filter((c) => cats.has(c)), ...(cats.has('Mine') ? ['Mine'] : [])];
}

// Indices auto-switch may pick from. Favourites count twice, so they come up more often.
export function rotation(scenes: readonly Scene[], prefs: LibraryPrefs): number[] {
  const visual = listedScenes(scenes);
  const on = visual.filter(({ s }) => inRotation(prefs, s));
  return (on.length ? on : visual).flatMap(({ s, i }) => (isFav(prefs, s) ? [i, i] : [i]));
}

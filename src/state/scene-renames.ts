// Renames on load: one of your scenes named like a built-in that shipped after you saved it (ADR 0001).
// The scene list calls this while it is built; what the rename touches in other stores (parameter
// values, library preferences, the last-scene mark) and the startup toast about it live here.

import { userSceneId, type Scene } from '../scenes';
import { ParamDataSchema } from '../engine/params';
import { loadLibraryPrefs, saveLibraryPrefs } from './library-prefs';
import { KEYS, readJSON, readString, remove, writeJSON, writeString } from './persistence';

export interface Rename { from: string; to: string }

interface Named { name: string; body: string }

// A saved scene named like a built-in becomes "Name (mine)", or "Name (mine 2)" and so on when that is
// taken too, so both stay reachable by name. Save and import already refuse such names; this covers
// scenes saved before the built-in arrived.
export function renameClashes(stored: readonly Named[], shipped: readonly Scene[]): { stored: Named[]; renamed: Rename[] } {
  const builtin = new Set(shipped.map((s) => s.name));
  const taken = new Set([...builtin, ...stored.map((s) => s.name)]);
  const renamed: Rename[] = [];
  const out = stored.map(({ name, body }) => {
    if (!builtin.has(name)) return { name, body };
    let to = `${name} (mine)`;
    for (let n = 2; taken.has(to); n++) to = `${name} (mine ${n})`;
    taken.add(to);
    renamed.push({ from: name, to });
    return { name: to, body };
  });
  return { stored: out, renamed };
}

// What is stored under a renamed scene's old name follows it: its parameter values, favourite and
// auto-switch exclusion, and the last-scene mark; then the startup toast is stored. Saved-show cues are
// not moved: a cue that named your scene now plays the built-in of that name (ADR 0001).
export function followRenames(renamed: readonly Rename[]): void {
  if (!renamed.length) return;
  moveSettings(renamed);
  storeRenameReport(renamed);
}

// Your scenes' parameter values and last-scene mark are keyed by `paramKey`, which for them is `userSceneId`.
function moveSettings(renamed: readonly Rename[]): void {
  const params = readJSON(KEYS.params, ParamDataSchema, {});
  let paramsMoved = false;
  for (const { from, to } of renamed) {
    const values = params[userSceneId(from)];
    if (!values) continue;
    params[userSceneId(to)] = values;
    delete params[userSceneId(from)];
    paramsMoved = true;
  }
  if (paramsMoved) writeJSON(KEYS.params, params);

  const prefs = loadLibraryPrefs();
  const rename = (name: string) => renamed.find((r) => r.from === name)?.to ?? name;
  saveLibraryPrefs({ ...prefs, favs: prefs.favs.map(rename), off: prefs.off.map(rename) });

  const last = readString(KEYS.lastScene);
  const moved = renamed.find((r) => userSceneId(r.from) === last);
  if (moved) writeString(KEYS.lastScene, userSceneId(moved.to));
}

// The startup toast about renames, stored when the list is built and taken once. Stored rather than
// returned, so a list built twice (StrictMode: only the first build renames) still shows it.
const storeRenameReport = (renamed: readonly Rename[]): void =>
  writeString(KEYS.renameReport, `Renamed your scene(s) that share a built-in's name: ${renamed.map((r) => `${r.from} → ${r.to}`).join(', ')}`);

export function takeRenameReport(): string | null {
  const report = readString(KEYS.renameReport);
  if (report !== null) remove(KEYS.renameReport);
  return report;
}

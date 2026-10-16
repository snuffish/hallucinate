// The shared scene list and the only code that changes it. Engines, the projector protocol and the
// number keys all address scenes by INDEX, so entries are appended or soft-removed, never spliced
// or re-ordered. React keys use `scene.id`.

import { z } from 'zod';
import { COMMON, SCENES, TEMPLATE, type Scene } from '../scenes';
import { ParamDataSchema, parseParams } from '../engine/params';
import { loadLibraryPrefs, saveLibraryPrefs } from './library-prefs';
import { KEYS, readJSON, readString, remove, writeJSON, writeString } from './persistence';

export const UserScenesSchema = z.array(z.object({ name: z.string(), body: z.string() }));
export const SceneEditsSchema = z.record(z.string(), z.string());
export type StoredScene = z.infer<typeof UserScenesSchema>[number];

// Saved scenes and edits to built-ins that didn't compile at startup (another GPU, an older app).
// They stay stored until you delete them: every save writes them back, so saving something else
// never erases them. Saving a scene under the same name, or editing that built-in, supersedes them.
export interface ParkedScenes {
  userScenes: StoredScene[];
  sceneEdits: Record<string, string>;
}

export const loadUserScenes = () => readJSON(KEYS.userScenes, UserScenesSchema, []);
export const loadSceneEdits = () => readJSON(KEYS.sceneEdits, SceneEditsSchema, {});

export function userScene(name: string, body: string): Scene {
  const { code, params } = parseParams(body);
  return { id: `user:${name}`, name, body, frag: COMMON + code, params, cat: 'Mine', desc: 'Your shader', user: true };
}

// What is stored under a renamed scene's old name follows it: its parameter values, favourite and
// auto-switch exclusion, and the last-scene mark. Saved-show cues are not moved: a cue that named your
// scene now plays the built-in of that name (spec #23).
function moveSettings(renamed: readonly Rename[]): void {
  const params = readJSON(KEYS.params, ParamDataSchema, {});
  let paramsMoved = false;
  for (const { from, to } of renamed) {
    const values = params[`user:${from}`];
    if (!values) continue;
    params[`user:${to}`] = values;
    delete params[`user:${from}`];
    paramsMoved = true;
  }
  if (paramsMoved) writeJSON(KEYS.params, params);

  const prefs = loadLibraryPrefs();
  const rename = (name: string) => renamed.find((r) => r.from === name)?.to ?? name;
  saveLibraryPrefs({ ...prefs, favs: prefs.favs.map(rename), off: prefs.off.map(rename) });

  const last = readString(KEYS.lastScene);
  const moved = renamed.find((r) => `user:${r.from}` === last);
  if (moved) writeString(KEYS.lastScene, `user:${moved.to}`);
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

export interface SceneListInit {
  scenes: Scene[];
  customIndex: number;
  nodesIndex: number;
  keyedScenes: number[];   // keys 1–0
  errors: string[];        // saved scenes / edits that no longer compile
  parked: ParkedScenes;    // the same, kept stored
  renamed: Rename[];       // your scenes renamed because a built-in has their name
}

export interface Rename { from: string; to: string }

// A saved scene named like a built-in (one that shipped after you saved yours) becomes "Name (mine)",
// or "Name (mine 2)" and so on when that is taken too, so both stay reachable by name. Save and import
// already refuse such names; this covers scenes saved before the built-in arrived.
function renameClashes(stored: StoredScene[], shipped: readonly Scene[]): { stored: StoredScene[]; renamed: Rename[] } {
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

// Compiles a shader source and returns the error, or null (Renderer.check).
export type CompileCheck = (frag: string, name: string) => string | null;

// Built-ins, the two editor slots, then your saved scenes (compiled after the built-ins, so a broken
// one can't stop the app) and your edits to built-in scenes. Fills `scenes` in place: it is the array
// the renderer was created with, and it must stay that one array for the app's lifetime. The
// built-ins are copies, so building the list twice (React's StrictMode) can't leak one run's edits
// into the other's originals. With no built-ins (ADR 0001) My Shader is first, so the app starts there.
export function buildSceneList(scenes: Scene[], check: CompileCheck, shipped: readonly Scene[] = SCENES): SceneListInit {
  const builtins = shipped.map((s) => ({ ...s, original: s.body }));
  scenes.push(
    ...builtins,
    { id: 'custom', name: 'My Shader', kind: 'custom', cat: '', desc: '', body: TEMPLATE, frag: COMMON + TEMPLATE, params: [] },
    { id: 'nodes', name: 'Node Scene', kind: 'nodes', cat: '', desc: '', body: TEMPLATE, frag: COMMON + TEMPLATE, params: [] },
  );
  const errors: string[] = [];
  const parked: ParkedScenes = { userScenes: [], sceneEdits: {} };
  const { stored, renamed } = renameClashes(loadUserScenes(), shipped);
  if (renamed.length) { writeJSON(KEYS.userScenes, stored); moveSettings(renamed); storeRenameReport(renamed); }
  for (const { name, body } of stored) {
    const scene = userScene(name, body);
    if (check(scene.frag, name)) { errors.push(name); parked.userScenes.push({ name, body }); }
    else scenes.push(scene);
  }
  for (const [name, body] of Object.entries(loadSceneEdits())) {
    const s = builtins.find((x) => x.name === name);
    if (!s) continue;
    const { code, params } = parseParams(body);
    if (check(COMMON + code, name)) { errors.push(`${name} (your edit)`); parked.sceneEdits[name] = body; continue; }
    Object.assign(s, { body, frag: COMMON + code, params, edited: true });
  }
  return {
    scenes,
    customIndex: scenes.findIndex((s) => s.kind === 'custom'),
    nodesIndex: scenes.findIndex((s) => s.kind === 'nodes'),
    keyedScenes: scenes.map((s, i) => (s.kind ? -1 : i)).filter((i) => i >= 0).slice(0, 10),
    errors,
    parked,
    renamed,
  };
}

// Your scenes plus the parked ones. A parked scene whose name is now in the list was saved again
// (fixed in the editor), so it leaves the parked set.
export function saveUserScenes(scenes: readonly Scene[], parked: ParkedScenes): void {
  const mine = scenes.filter((s) => s.user && !s.removed).map(({ name, body }) => ({ name, body }));
  parked.userScenes = parked.userScenes.filter((p) => !mine.some((s) => s.name === p.name));
  writeJSON(KEYS.userScenes, [...mine, ...parked.userScenes]);
}

// Your edits to built-in scenes replace their code; Revert restores `original`. Editing or reverting
// a built-in supersedes its parked edit.
export function saveSceneEdit(scene: Scene, scenes: readonly Scene[], parked: ParkedScenes): void {
  scene.edited = scene.body.trim() !== (scene.original ?? '').trim();
  delete parked.sceneEdits[scene.name];
  writeSceneEdits(scenes, parked);
}

function writeSceneEdits(scenes: readonly Scene[], parked: ParkedScenes): void {
  const edits: Record<string, string> = { ...parked.sceneEdits };
  for (const s of scenes) if (!s.user && !s.kind && s.edited) edits[s.name] = s.body;
  writeJSON(KEYS.sceneEdits, edits);
}

// Deletes a parked scene or edit for good (Library → "Doesn't compile here").
export function discardParked(parked: ParkedScenes, kind: 'scene' | 'edit', name: string, scenes: readonly Scene[]): void {
  if (kind === 'scene') {
    parked.userScenes = parked.userScenes.filter((p) => p.name !== name);
    saveUserScenes(scenes, parked);
  } else {
    delete parked.sceneEdits[name];
    writeSceneEdits(scenes, parked);
  }
}

// The only way a scene joins the list: appended, so every index already handed out stays valid.
export function appendScene(scenes: readonly Scene[], scene: Scene): number {
  return (scenes as Scene[]).push(scene) - 1;
}

export const sceneByName = (scenes: readonly Scene[], name: string): number => scenes.findIndex((s) => s.name === name && !s.removed);

// Per-scene key for stored parameter values.
export function paramKey(scene: Scene): string {
  return scene.kind === 'custom' || scene.kind === 'nodes' ? scene.kind : `${scene.user ? 'user' : 'scene'}:${scene.name}`;
}

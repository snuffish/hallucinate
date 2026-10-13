// The shared scene list and the only code that changes it. Engines, the projector protocol and the
// number keys all address scenes by INDEX, so entries are appended or soft-removed, never spliced
// or re-ordered. React keys use `scene.id`.

import { z } from 'zod';
import { COMMON, SCENES, TEMPLATE, type Scene } from '../engine/scenes';
import { parseParams } from '../engine/params';
import type { Renderer } from '../engine/renderer';
import { KEYS, readJSON, writeJSON } from './persistence';

const UserScenesSchema = z.array(z.object({ name: z.string(), body: z.string() }));
const SceneEditsSchema = z.record(z.string(), z.string());

export const loadUserScenes = () => readJSON(KEYS.userScenes, UserScenesSchema, []);
export const loadSceneEdits = () => readJSON(KEYS.sceneEdits, SceneEditsSchema, {});

export function userScene(name: string, body: string): Scene {
  const { code, params } = parseParams(body);
  return { id: `user:${name}`, name, body, frag: COMMON + code, params, cat: 'Mine', desc: 'Your shader', user: true };
}

export interface SceneListInit {
  scenes: Scene[];
  gameIndex: number;
  customIndex: number;
  nodesIndex: number;
  keyedScenes: number[];   // keys 1–0
  errors: string[];        // saved scenes / edits that no longer compile
}

// Built-ins, the two editor slots, then your saved scenes (compiled after the built-ins, so a broken
// one can't stop the app) and your edits to built-in scenes.
export function buildSceneList(renderer: Renderer): SceneListInit {
  const scenes: Scene[] = [
    ...SCENES,
    { id: 'custom', name: 'My Shader', kind: 'custom', cat: '', desc: '', body: TEMPLATE, frag: COMMON + TEMPLATE, params: [] },
    { id: 'nodes', name: 'Node Scene', kind: 'nodes', cat: '', desc: '', body: TEMPLATE, frag: COMMON + TEMPLATE, params: [] },
  ];
  const errors: string[] = [];
  for (const { name, body } of loadUserScenes()) {
    const scene = userScene(name, body);
    if (renderer.check(scene.frag, name)) errors.push(name);
    else scenes.push(scene);
  }
  for (const s of SCENES) s.original = s.body;
  for (const [name, body] of Object.entries(loadSceneEdits())) {
    const s = SCENES.find((x) => x.name === name);
    if (!s) continue;
    const { code, params } = parseParams(body);
    if (renderer.check(COMMON + code, name)) { errors.push(`${name} (your edit)`); continue; }
    Object.assign(s, { body, frag: COMMON + code, params, edited: true });
  }
  return {
    scenes,
    gameIndex: scenes.findIndex((s) => s.kind === 'game'),
    customIndex: scenes.findIndex((s) => s.kind === 'custom'),
    nodesIndex: scenes.findIndex((s) => s.kind === 'nodes'),
    keyedScenes: scenes.map((s, i) => (s.kind ? -1 : i)).filter((i) => i >= 0).slice(0, 10),
    errors,
  };
}

export function saveUserScenes(scenes: readonly Scene[]): void {
  writeJSON(KEYS.userScenes, scenes.filter((s) => s.user && !s.removed).map(({ name, body }) => ({ name, body })));
}

// Your edits to built-in scenes replace their code; Revert restores `original`.
export function saveSceneEdit(scene: Scene, scenes: readonly Scene[]): void {
  scene.edited = scene.body.trim() !== (scene.original ?? '').trim();
  const edits: Record<string, string> = {};
  for (const s of scenes) if (!s.user && !s.kind && s.edited) edits[s.name] = s.body;
  writeJSON(KEYS.sceneEdits, edits);
}

export const sceneByName = (scenes: readonly Scene[], name: string): number => scenes.findIndex((s) => s.name === name && !s.removed);

// Per-scene key for stored parameter values.
export function paramKey(scene: Scene): string {
  return scene.kind === 'custom' || scene.kind === 'nodes' ? scene.kind : `${scene.user ? 'user' : 'scene'}:${scene.name}`;
}

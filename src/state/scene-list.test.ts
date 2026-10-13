import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../engine/renderer';
import { SCENES } from '../engine/scenes';
import { KEYS } from './persistence';
import { buildSceneList, loadUserScenes, paramKey, saveSceneEdit, saveUserScenes, sceneByName, userScene } from './scene-list';

// The scene list is the cross-window contract: indices must stay stable, so removal is a flag.
describe('scene list', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  });
  afterEach(() => vi.unstubAllGlobals());
  const renderer = { check: () => null } as unknown as Renderer;   // every shader "compiles"

  it('appends built-ins, the two editor slots, then saved scenes, and keys the first ten visuals', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Mine One', body: 'void main() { fragColor = vec4(1.); }' }]));
    const list = buildSceneList(renderer);
    expect(list.scenes.length).toBe(SCENES.length + 3);
    expect(list.scenes[list.customIndex]!.kind).toBe('custom');
    expect(list.scenes[list.nodesIndex]!.kind).toBe('nodes');
    expect(list.scenes[list.gameIndex]!.kind).toBe('game');
    expect(list.scenes.at(-1)).toMatchObject({ name: 'Mine One', user: true, cat: 'Mine' });
    expect(list.keyedScenes).toHaveLength(10);
    expect(list.keyedScenes.every((i) => !list.scenes[i]!.kind)).toBe(true);
    expect(list.errors).toEqual([]);
  });

  it('reports saved scenes that no longer compile instead of failing', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }]));
    const failing = { check: (frag: string) => (frag.includes('nope') ? 'ERROR: 0:1: bad' : null) } as unknown as Renderer;
    const list = buildSceneList(failing);
    expect(list.errors).toEqual(['Broken']);
    expect(list.scenes.some((s) => s.name === 'Broken')).toBe(false);
  });

  it('soft-removes user scenes so every other index keeps its meaning', () => {
    const scenes = [userScene('A', 'void main(){}'), userScene('B', 'void main(){}'), userScene('C', 'void main(){}')];
    scenes[1]!.removed = true;
    saveUserScenes(scenes);
    expect(loadUserScenes().map((s) => s.name)).toEqual(['A', 'C']);
    expect(scenes[2]!.name).toBe('C');                 // index 2 still means C
    expect(sceneByName(scenes, 'B')).toBe(-1);         // removed scenes are not found by name
    expect(sceneByName(scenes, 'C')).toBe(2);
  });

  it('stores built-in edits by name and clears them when the code matches the original', () => {
    const list = buildSceneList(renderer);
    const s = list.scenes[0]!;
    s.body = 'changed';
    saveSceneEdit(s, list.scenes);
    expect(s.edited).toBe(true);
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toEqual({ [s.name]: 'changed' });
    s.body = s.original!;
    saveSceneEdit(s, list.scenes);
    expect(s.edited).toBe(false);
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toEqual({});
  });

  it('keys parameter values per scene kind', () => {
    expect(paramKey({ kind: 'custom' } as never)).toBe('custom');
    expect(paramKey(userScene('X', ''))).toBe('user:X');
    expect(paramKey(SCENES[0]!)).toBe(`scene:${SCENES[0]!.name}`);
  });
});

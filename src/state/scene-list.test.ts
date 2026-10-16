import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scene } from '../scenes';
import { KEYS } from './persistence';
import { buildSceneList, type CompileCheck, discardParked, loadUserScenes, paramKey, saveSceneEdit, saveUserScenes, sceneByName, userScene, type ParkedScenes } from './scene-list';

// The scene list is the cross-window contract: indices must stay stable, so removal is a flag.
describe('scene list', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  });
  afterEach(() => vi.unstubAllGlobals());
  const compiles = () => null;   // every shader "compiles"
  const failing = (frag: string) => (frag.includes('nope') ? 'ERROR: 0:1: bad' : null);
  const noParked = (): ParkedScenes => ({ userScenes: [], sceneEdits: {} });
  // Stand-in built-ins: the list must not depend on which ones the app ships.
  const BUILTINS = ['Alpha', 'Beta', 'Gamma'].map((name) => scene(name, 'Beams', `${name} beams`, 'void main() { fragColor = vec4(1.); }'));
  const build = (check: CompileCheck = compiles) => buildSceneList([], check, BUILTINS);
  const mine = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Mine ${i + 1}`, body: 'void main() { fragColor = vec4(1.); }' }));

  it('appends built-ins, the two editor slots, then saved scenes, and keys the first ten visuals', () => {
    store.set(KEYS.userScenes, JSON.stringify(mine(8)));
    const list = build();
    expect(list.scenes.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'My Shader', 'Node Scene', ...mine(8).map((s) => s.name)]);
    expect(list.scenes[list.customIndex]!.kind).toBe('custom');
    expect(list.scenes[list.nodesIndex]!.kind).toBe('nodes');
    expect(list.scenes.at(-1)).toMatchObject({ name: 'Mine 8', user: true, cat: 'Mine' });
    expect(list.keyedScenes).toEqual([0, 1, 2, 5, 6, 7, 8, 9, 10, 11]);   // built-ins first, then yours
    expect(list.errors).toEqual([]);
  });

  // ADR 0001: no built-ins is a supported state. The app starts on index 0 when nothing is restored.
  it('with no built-ins, starts the list with My Shader and keys your scenes', () => {
    store.set(KEYS.userScenes, JSON.stringify(mine(2)));
    const list = buildSceneList([], compiles, []);
    expect(list.scenes[0]!.name).toBe('My Shader');
    expect(list.customIndex).toBe(0);
    expect(list.keyedScenes).toEqual([2, 3]);
  });

  it('plays Beam Fan on key 1, the first of the shipped laser-show set', () => {
    const list = buildSceneList([], compiles);
    expect(list.scenes[list.keyedScenes[0]!]).toMatchObject({ name: 'Beam Fan', cat: 'Beams' });
  });

  it('ignores stored edits for built-ins that no longer exist', () => {
    store.set(KEYS.sceneEdits, JSON.stringify({ 'Hyper Tunnel': 'void main(){}' }));
    const list = build();
    expect(list.errors).toEqual([]);
    expect(list.scenes.some((s) => s.edited)).toBe(false);
  });

  it('reports saved scenes that no longer compile instead of failing', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }]));
    const list = buildSceneList([], failing);
    expect(list.errors).toEqual(['Broken']);
    expect(list.scenes.some((s) => s.name === 'Broken')).toBe(false);
    expect(list.parked.userScenes).toEqual([{ name: 'Broken', body: 'nope' }]);
  });

  // An import from another GPU or app version must not lose scenes the first time anything is saved.
  it('keeps a scene that failed to compile stored when another scene is saved', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }, { name: 'Fine', body: 'void main(){}' }]));
    const list = buildSceneList([], failing);
    list.scenes.push(userScene('New', 'void main(){}'));
    saveUserScenes(list.scenes, list.parked);
    expect(loadUserScenes().map((s) => s.name)).toEqual(['Fine', 'New', 'Broken']);
  });

  it('un-parks a scene saved again under its name, and deletes one on request', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }, { name: 'Other', body: 'nope too' }]));
    const list = buildSceneList([], failing);
    list.scenes.push(userScene('Broken', 'void main(){}'));   // fixed in the editor, saved under the same name
    saveUserScenes(list.scenes, list.parked);
    expect(list.parked.userScenes.map((p) => p.name)).toEqual(['Other']);
    expect(loadUserScenes()).toEqual([{ name: 'Broken', body: 'void main(){}' }, { name: 'Other', body: 'nope too' }]);
    discardParked(list.parked, 'scene', 'Other', list.scenes);
    expect(loadUserScenes().map((s) => s.name)).toEqual(['Broken']);
  });

  it('keeps a built-in edit that failed to compile until that built-in is edited or the edit is discarded', () => {
    const [a, b] = ['Alpha', 'Beta'];
    store.set(KEYS.sceneEdits, JSON.stringify({ [a]: 'nope', [b]: 'nope' }));
    const list = build(failing);
    expect(list.parked.sceneEdits).toEqual({ [a]: 'nope', [b]: 'nope' });
    const other = list.scenes[2]!;
    other.body = 'changed';
    saveSceneEdit(other, list.scenes, list.parked);      // editing a third scene keeps both
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toEqual({ [a]: 'nope', [b]: 'nope', [other.name]: 'changed' });
    const sa = list.scenes[0]!;
    sa.body = 'mine now';
    saveSceneEdit(sa, list.scenes, list.parked);          // a new edit of A supersedes the parked one
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toMatchObject({ [a]: 'mine now', [b]: 'nope' });
    discardParked(list.parked, 'edit', b, list.scenes);
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).not.toHaveProperty(b);
  });

  it('soft-removes user scenes so every other index keeps its meaning', () => {
    const scenes = [userScene('A', 'void main(){}'), userScene('B', 'void main(){}'), userScene('C', 'void main(){}')];
    scenes[1]!.removed = true;
    saveUserScenes(scenes, noParked());
    expect(loadUserScenes().map((s) => s.name)).toEqual(['A', 'C']);
    expect(scenes[2]!.name).toBe('C');                 // index 2 still means C
    expect(sceneByName(scenes, 'B')).toBe(-1);         // removed scenes are not found by name
    expect(sceneByName(scenes, 'C')).toBe(2);
  });

  it('fills the array it is given and leaves the module\'s built-ins untouched', () => {
    store.set(KEYS.sceneEdits, JSON.stringify({ Alpha: 'void main() { fragColor = vec4(0.); }' }));
    const shared: Parameters<typeof buildSceneList>[0] = [];
    const list = buildSceneList(shared, compiles, BUILTINS);
    expect(list.scenes).toBe(shared);
    expect(list.scenes[0]!.edited).toBe(true);
    expect(BUILTINS[0]!.edited).toBeUndefined();
    expect(build().scenes[0]!.original).toBe(BUILTINS[0]!.body);   // a second build (StrictMode) sees the real original
  });

  it('stores built-in edits by name and clears them when the code matches the original', () => {
    const list = build();
    const s = list.scenes[0]!;
    s.body = 'changed';
    saveSceneEdit(s, list.scenes, list.parked);
    expect(s.edited).toBe(true);
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toEqual({ [s.name]: 'changed' });
    s.body = s.original!;
    saveSceneEdit(s, list.scenes, list.parked);
    expect(s.edited).toBe(false);
    expect(JSON.parse(store.get(KEYS.sceneEdits)!)).toEqual({});
  });

  it('keys parameter values per scene kind', () => {
    expect(paramKey({ kind: 'custom' } as never)).toBe('custom');
    expect(paramKey(userScene('X', ''))).toBe('user:X');
    expect(paramKey(BUILTINS[0]!)).toBe('scene:Alpha');
  });
});

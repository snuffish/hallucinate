import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scene } from '../scenes';
import { KEYS } from './persistence';
import { buildSceneList, type CompileCheck, discardParked, isBuiltin, loadUserScenes, paramKey, saveSceneEdit, saveUserScenes, sceneByName, stepScene, userScene, type ParkedScenes } from './scene-list';
import { takeRenameReport } from './scene-renames';

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

  it('plays the first built-in on key 1, in the order the set ships', () => {
    const list = build();
    expect(list.keyedScenes.slice(0, 3).map((i) => list.scenes[i]!.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  // ← / → walk the list in key order, wrap at both ends and skip deleted scenes.
  it('steps through the scenes in key order, wrapping and skipping removed ones', () => {
    store.set(KEYS.userScenes, JSON.stringify(mine(2)));
    const { scenes } = build();
    const names = (from: number, dir: number, n: number) =>
      Array.from({ length: n }, () => scenes[(from = stepScene(scenes, from, dir))]!.name);
    expect(names(0, 1, 3)).toEqual(['Beta', 'Gamma', 'My Shader']);
    expect(names(0, -1, 2)).toEqual(['Mine 2', 'Mine 1']);
    scenes[1]!.removed = true;
    expect(names(0, 1, 1)).toEqual(['Gamma']);
    expect(names(2, -1, 1)).toEqual(['Alpha']);
  });

  it('ignores stored edits for built-ins that no longer exist', () => {
    store.set(KEYS.sceneEdits, JSON.stringify({ 'Hyper Tunnel': 'void main(){}' }));
    const list = build();
    expect(list.errors).toEqual([]);
    expect(list.scenes.some((s) => s.edited)).toBe(false);
  });

  it('reports saved scenes that no longer compile instead of failing', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }]));
    const list = build(failing);
    expect(list.errors).toEqual(['Broken']);
    expect(list.scenes.some((s) => s.name === 'Broken')).toBe(false);
    expect(list.parked.userScenes).toEqual([{ name: 'Broken', body: 'nope' }]);
  });

  // An import from another GPU or app version must not lose scenes the first time anything is saved.
  it('keeps a scene that failed to compile stored when another scene is saved', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }, { name: 'Fine', body: 'void main(){}' }]));
    const list = build(failing);
    list.scenes.push(userScene('New', 'void main(){}'));
    saveUserScenes(list.scenes, list.parked);
    expect(loadUserScenes().map((s) => s.name)).toEqual(['Fine', 'New', 'Broken']);
  });

  it('un-parks a scene saved again under its name, and deletes one on request', () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Broken', body: 'nope' }, { name: 'Other', body: 'nope too' }]));
    const list = build(failing);
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

  // A user scene saved before a built-in of the same name shipped: both stay reachable (#26).
  describe('name clash on load', () => {
    const body = 'void main() { fragColor = vec4(1.); }';
    const save = (...names: string[]) => store.set(KEYS.userScenes, JSON.stringify(names.map((name) => ({ name, body }))));

    it('renames a user scene named like a built-in to "Name (mine)" and persists it', () => {
      save('Alpha', 'Other');
      const list = build();
      expect(list.scenes.filter((s) => s.user).map((s) => s.name)).toEqual(['Alpha (mine)', 'Other']);
      expect(list.scenes.find((s) => s.name === 'Alpha (mine)')).toMatchObject({ id: 'user:Alpha (mine)', user: true });
      expect(list.renamed).toEqual([{ from: 'Alpha', to: 'Alpha (mine)' }]);
      expect(loadUserScenes().map((s) => s.name)).toEqual(['Alpha (mine)', 'Other']);
      expect(build().renamed).toEqual([]);   // it doesn't rename again
    });

    it('moves its parameters, favourite, auto-switch exclusion and last-scene mark to the new name', () => {
      save('Alpha', 'Other');
      const glow = { GLOW: { v: 0.8, def: 0.5 } };
      store.set(KEYS.params, JSON.stringify({ 'user:Alpha': glow, 'user:Other': glow, 'scene:Beta': glow }));
      store.set(KEYS.library, JSON.stringify({ favs: ['Alpha', 'Other'], off: ['Beta', 'Alpha'] }));
      store.set(KEYS.lastScene, 'user:Alpha');
      build();
      expect(JSON.parse(store.get(KEYS.params)!)).toEqual({ 'user:Alpha (mine)': glow, 'user:Other': glow, 'scene:Beta': glow });
      expect(JSON.parse(store.get(KEYS.library)!)).toEqual({ favs: ['Alpha (mine)', 'Other'], off: ['Beta', 'Alpha (mine)'] });
      expect(store.get(KEYS.lastScene)).toBe('user:Alpha (mine)');
    });

    it('leaves saved settings alone when nothing clashes', () => {
      save('Other');
      store.set(KEYS.library, JSON.stringify({ favs: ['Alpha'], off: [] }));   // the built-in's own favourite
      store.set(KEYS.lastScene, 'scene:Alpha');
      build();
      expect(JSON.parse(store.get(KEYS.library)!)).toEqual({ favs: ['Alpha'], off: [] });
      expect(store.get(KEYS.lastScene)).toBe('scene:Alpha');
      expect(store.has(KEYS.params)).toBe(false);
    });

    // Shown once, even when the list is built twice (StrictMode) and only the first build renames.
    it('says in one toast what every rename on that load was, and nothing when no name clashed', () => {
      save('Alpha', 'Beta', 'Other');
      build();
      build();
      expect(takeRenameReport()).toBe('Renamed your scene(s) that share a built-in\'s name: Alpha → Alpha (mine), Beta → Beta (mine)');
      expect(takeRenameReport()).toBeNull();
      build();
      expect(takeRenameReport()).toBeNull();
    });

    it('numbers the new name when "Name (mine)" is taken too', () => {
      save('Beta (mine)', 'Beta', 'Gamma (mine)', 'Gamma (mine 2)', 'Gamma');
      const list = build();
      expect(list.renamed).toEqual([{ from: 'Beta', to: 'Beta (mine 2)' }, { from: 'Gamma', to: 'Gamma (mine 3)' }]);
      expect(loadUserScenes().map((s) => s.name)).toEqual(['Beta (mine)', 'Beta (mine 2)', 'Gamma (mine)', 'Gamma (mine 2)', 'Gamma (mine 3)']);
    });
  });

  it('tells the built-ins from your scenes and the editor slots', () => {
    store.set(KEYS.userScenes, JSON.stringify(mine(1)));
    const { scenes } = build();
    expect(scenes.filter(isBuiltin).map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('keys parameter values per scene kind', () => {
    expect(paramKey({ kind: 'custom' } as never)).toBe('custom');
    expect(paramKey(userScene('X', ''))).toBe('user:X');
    expect(paramKey(BUILTINS[0]!)).toBe('scene:Alpha');
  });
});

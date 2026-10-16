import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParamStore, parseParams } from '../engine/params';
import { COMMON, type Scene } from '../scenes';
import { KEYS, flushAll } from '../state/persistence';
import { userScene, type ParkedScenes } from '../state/scene-list';
import { SceneLibrary, SUPERSEDED, type Compiler, type SceneChange } from './scene-library';

const GLOW = 'uniform float uGlow; // @param min=0 max=3';
const code = (k: string, params = GLOW) => `${params}\nvoid main() { fragColor = vec4(${k}); }`;
const HEADER = COMMON.split('\n').length - 1;   // the lines every scene's code is compiled after

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
});
const stored = (key: string) => JSON.parse(storage.get(key) ?? 'null');

// A built-in, the "My Shader" slot and one of yours. `broken`: what the compiler refuses.
function library(o: { broken?: (frag: string) => boolean; compileAsync?: Compiler['compileAsync']; parked?: ParkedScenes } = {}) {
  const builtin: Scene = { id: 'tunnel', name: 'Tunnel', cat: 'Space', desc: '', body: code('1.'), frag: '', params: parseParams(code('1.')).params, original: code('1.') };
  const custom: Scene = { id: 'custom', name: 'My Shader', kind: 'custom', cat: '', desc: '', body: '', frag: '', params: [] };
  const scenes: Scene[] = [builtin, custom, userScene('Neon', code('.5'))];
  const released: string[] = [];
  const error = (frag: string) => (o.broken?.(frag) ? `ERROR: 0:${HEADER + 2}: 'k' : undeclared identifier` : null);
  const compiler: Compiler = {
    check: error,
    compileAsync: o.compileAsync ?? (async (frag) => error(frag)),
    release: (frag) => { released.push(frag); },
  };
  const changes: [number, SceneChange][] = [];
  const parked = o.parked ?? { userScenes: [], sceneEdits: {} };
  const lib = new SceneLibrary(scenes, parked, compiler, new ParamStore(), (i, what) => { changes.push([i, what]); });
  return { lib, scenes, changes, released, parked };
}

describe('SceneLibrary code', () => {
  it('compiles new code with the @params it declares, keeping the values those still fit', async () => {
    const { lib, scenes, changes } = library();
    lib.setValues(2, { uGlow: 2 });
    expect(await lib.compile(2, code('.2', `${GLOW}\nuniform bool uMirror; // @param`))).toBeNull();
    expect(scenes[2]!.body).toContain('vec4(.2)');
    expect(scenes[2]!.frag.startsWith(COMMON)).toBe(true);
    expect(lib.specs(2).map((s) => s.name)).toEqual(['uGlow', 'uMirror']);
    expect(lib.values(2)).toEqual({ uGlow: 2, uMirror: false });
    expect(changes).toContainEqual([2, 'code']);
    expect(stored(KEYS.userScenes)).toEqual([{ name: 'Neon', body: scenes[2]!.body }]);
  });

  it('keeps an edit of a built-in as yours, and leaves the editor slots to their editors', async () => {
    const { lib } = library();
    await lib.compile(0, code('.7'));
    expect(stored(KEYS.sceneEdits)).toEqual({ Tunnel: code('.7') });
    storage.clear();
    await lib.compile(1, code('.3'));
    expect(storage.size).toBe(0);
  });

  it('changes nothing when the code does not compile, and numbers the errors from its first line', async () => {
    const { lib, scenes, changes } = library({ broken: (f) => f.includes('vec4(k)') });
    const before = scenes[2]!.body;
    expect(await lib.compile(2, code('k'))).toBe("Line 2: 'k' : undeclared identifier");
    expect(scenes[2]!.body).toBe(before);
    expect(changes).toEqual([]);
  });

  it('lets a newer compile of the same scene supersede one still in flight, and frees its program', async () => {
    const pending: ((error: string | null) => void)[] = [];
    const { lib, scenes, released } = library({ compileAsync: () => new Promise((r) => { pending.push(r); }) });
    const first = lib.compile(2, code('.1'));
    const second = lib.compile(2, code('.9'));
    pending.forEach((answer) => answer(null));
    expect(await first).toBe(SUPERSEDED);
    expect(await second).toBeNull();
    expect(scenes[2]!.body).toContain('vec4(.9)');
    expect(released).toHaveLength(1);
    expect(released[0]).toContain('vec4(.1)');
  });
});

describe('SceneLibrary list', () => {
  it('adds a scene of yours at the end, stored, with its @params', () => {
    const { lib, scenes, changes } = library();
    const out = lib.add('Aurora', code('.4'));
    expect(out).toEqual({ index: 3 });
    expect(scenes[3]).toMatchObject({ name: 'Aurora', user: true, cat: 'Mine' });
    expect(lib.specs(3).map((s) => s.name)).toEqual(['uGlow']);
    expect(changes).toEqual([[3, 'code']]);
    expect(stored(KEYS.userScenes).map((s: { name: string }) => s.name)).toEqual(['Neon', 'Aurora']);
  });

  it('refuses a taken name, saying whose it is, and code that does not compile', () => {
    const { lib, scenes } = library({ broken: (f) => f.includes('vec4(k)'), parked: { userScenes: [{ name: 'Old', body: 'x' }], sceneEdits: {} } });
    expect(lib.add('Tunnel', code('1.'))).toMatchObject({ conflict: 'builtin' });
    expect(lib.add('Neon', code('1.'))).toMatchObject({ conflict: 'mine' });
    expect(lib.add('Old', code('1.'))).toMatchObject({ conflict: 'parked', error: expect.stringContaining("doesn't compile on this device") });
    expect(lib.add('Fresh', code('k'))).toEqual({ error: expect.stringContaining('undeclared') });
    expect(lib.add('Tunnel', code('1.'), { replace: true })).toMatchObject({ conflict: 'builtin' });   // never a built-in
    expect(scenes).toHaveLength(3);
  });

  it('replaces one of yours in place, or a parked one, and starts from the values you had', () => {
    const { lib, scenes, parked } = library({ parked: { userScenes: [{ name: 'Old', body: 'x' }], sceneEdits: {} } });
    lib.setValues(0, { uGlow: 2.5 });
    expect(lib.add('Neon', code('.8'), { replace: true, valuesFrom: 0 })).toEqual({ index: 2 });
    expect(scenes[2]!.body).toContain('vec4(.8)');
    expect(lib.values(2)).toEqual({ uGlow: 2.5 });
    expect(lib.add('Old', code('.6'), { replace: true })).toEqual({ index: 3 });
    expect(parked.userScenes).toEqual([]);   // fixed: no longer parked
    flushAll();
    expect(stored(KEYS.userScenes).map((s: { name: string }) => s.name)).toEqual(['Neon', 'Old']);
  });

  it('removes only scenes of yours, keeping every index', () => {
    const { lib, scenes, changes } = library();
    lib.remove(0);
    expect(scenes[0]!.removed).toBeUndefined();
    lib.remove(2);
    expect(scenes).toHaveLength(3);
    expect(scenes[2]!.removed).toBe(true);
    expect(lib.byName('Neon')).toBe(-1);
    expect(changes).toEqual([[2, 'list']]);
    expect(stored(KEYS.userScenes)).toEqual([]);
  });
});

describe('SceneLibrary values', () => {
  it('sets some values by name, replaces all of them, and resets them to the defaults', () => {
    const { lib, changes } = library();
    lib.setValues(2, { uGlow: 1.5, uNope: 3 });
    expect(lib.values(2)).toEqual({ uGlow: 1.5 });
    lib.replaceValues(2, {});
    expect(lib.values(2)).toEqual({ uGlow: 0 });
    lib.setValues(2, { uGlow: 2 });
    lib.resetValues(2);
    expect(lib.values(2)).toEqual({ uGlow: 0 });
    expect(changes.every(([i, what]) => i === 2 && what === 'values')).toBe(true);
  });
});

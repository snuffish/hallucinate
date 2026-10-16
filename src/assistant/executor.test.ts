import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../app/controller';
import { StudioSession } from '../app/studio';
import { parseParams } from '../engine/params';
import { SUPERSEDED } from '../app/editor';
import { applyEdits, createToolRunner, resolveParam, UndoConflict } from './executor';
import { UndoStack } from './undo';

const { params } = parseParams(`
uniform float uSpeed;         // @param label="Speed"
// @group Mushrooms
uniform float uMushSize;      // @param label="Size"
// @group Trees
uniform float uTreeSize;      // @param label="Size"
`);
const nameOf = (r: ReturnType<typeof resolveParam>) => (typeof r === 'string' ? r : r.name);

describe('resolveParam', () => {
  it('finds a param by exact name, by a label only one param has, and by Group/Label', () => {
    expect(nameOf(resolveParam(params, 'uTreeSize'))).toBe('uTreeSize');
    expect(nameOf(resolveParam(params, 'speed'))).toBe('uSpeed');
    expect(nameOf(resolveParam(params, 'Mushrooms/Size'))).toBe('uMushSize');
    expect(nameOf(resolveParam(params, 'trees / size'))).toBe('uTreeSize');
  });

  it('refuses a label that several groups share instead of picking the first', () => {
    const r = resolveParam(params, 'Size');
    expect(typeof r).toBe('string');
    expect(r).toContain('ambiguous');
    expect(r).toContain('"Mushrooms/Size"');
    expect(r).toContain('"Trees/Size"');
  });

  it('reports unknown keys', () => {
    expect(resolveParam(params, 'Glow')).toBe('"Glow" isn\'t a parameter of this scene');
    expect(typeof resolveParam(params, 'Bushes/Size')).toBe('string');
  });
});

describe('tool runner', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
  });

  function setup() {
    const scenes = [{ name: 'Alpha', cat: 'Fractal' }, { name: 'Beta', cat: 'Space' }];
    const app = {
      state: { scenes, clock: { clock: 0, scene: 0, huePhase: 0 }, look: { hue: 0, cycle: 0.6, trails: 0.86, speed: 1, reactivity: 1, aberration: 0.012 } },
      audio: { kind: null }, sceneParams: [[], []], sceneIndex: 0, tempo: { bpm: 120 },
      ui: { set: vi.fn() }, paramStore: { setAll: vi.fn() }, setScene: vi.fn(), setLook: vi.fn(), pushParams: vi.fn(), paramValues: vi.fn(() => ({})), showParams: vi.fn(), toast: vi.fn(),
      setHooks: vi.fn(() => () => {}),
      sceneByName: (name: string) => scenes.findIndex((s) => s.name === name),
    } as unknown as AppController;
    const studio = new StudioSession(app);
    const undo = new UndoStack();
    return { studio, undo, run: createToolRunner(app, undo, () => studio) };
  }

  it('checks the input against the tool\'s schema before running it', async () => {
    const { run, studio } = setup();
    await expect(run('set_transition', { seconds: 'slow' })).rejects.toThrow(/set_transition: seconds/);
    await expect(run('set_transition', { seconds: 30 })).rejects.toThrow(/seconds/);   // the schema's 0.2–8
    await expect(run('nope', {})).rejects.toThrow('Unknown tool "nope"');
    await run('set_transition', { mode: 'cut' });
    expect(studio.mode).toBe('cut');
  });

  it('undoes a show change, but not once something else changed the show after it', async () => {
    const { run, studio, undo } = setup();
    await run('add_show_scene', { scene: 'Alpha' });
    expect(studio.cues).toHaveLength(1);
    undo.pop()!.undo();
    expect(studio.cues).toHaveLength(0);

    await run('add_show_scene', { scene: 'Alpha' });
    studio.add({ name: 'Beta', scene: 'Beta', values: {}, look: {} });   // by hand, or the director
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(studio.cues.map((c) => c.name)).toEqual(['Alpha', 'Beta']);   // nothing silently lost
  });

  it('leaves nothing to undo when the change itself fails', async () => {
    const { run, undo } = setup();
    await run('add_show_scene', { scene: 'Alpha' });
    undo.clear();
    await expect(run('reorder_show', { order: ['not-an-id'] })).rejects.toThrow();
    expect(undo.last).toBeUndefined();
  });
});

describe('applyEdits', () => {
  const code = 'float a = 1.;\nfloat b = 2.;\nvoid main() {\n  fragColor = vec4(a, b, 0., 1.);\n}';

  it('replaces each find once, in order, each on the result of the one before', () => {
    expect(applyEdits(code, [{ find: 'float a = 1.;', replace: 'float a = 3.;' }, { find: 'a = 3.', replace: 'a = 4.' }])).toEqual({ code: code.replace('1.;', '4.;') });
    expect(applyEdits(code, [{ find: 'float b = 2.;\n', replace: '' }])).toEqual({ code: code.replace('float b = 2.;\n', '') });
  });

  it('refuses a find that matches several places', () => {
    const r = applyEdits(code, [{ find: 'float', replace: 'int' }]);
    expect(r).toEqual({ error: expect.stringContaining('matches 2 places') });
  });

  it('shows where a find nearly matched, so the model can fix it without reading the scene again', () => {
    const r = applyEdits(code, [{ find: 'void  main()  {\n  fragColor = vec4(b);', replace: '' }]);
    expect('error' in r && r.error).toMatch(/near line 3[\s\S]*3: void main\(\) \{/);
    const far = applyEdits(code, [{ find: 'mat2 rot', replace: '' }, { find: 'a', replace: 'b' }]);
    expect('error' in far && far.error).toMatch(/^Edit 1 didn't match the code\. Read the scene's code again/);
  });
});

describe('scene code and parameter tools', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }));

  const { params: specs } = parseParams('uniform float uGlow; // @param min=0 max=3 label="Glow"\nuniform bool uMirror; // @param label="Mirror"');

  function setup(compileError: string | null | typeof SUPERSEDED = null) {
    const scene = { name: 'Alpha', cat: 'Fractal', body: 'float k = 1.;\nvoid main() { fragColor = vec4(k); }', user: true };
    const scenes = [scene, { name: 'Beta', cat: 'Fractal', edited: true }, { name: 'Maker', cat: 'Mine', kind: 'nodes' }, { name: 'Gone', cat: 'Space', removed: true }];
    const values = { uGlow: 1.23456, uMirror: true };
    const app = {
      state: { scenes, clock: { scene: 0, bpm: 120, mood: 0.5, huePhase: 0 }, look: { hue: 0 }, activeSource: null },
      audio: { kind: null, features: { bright: 0.5 } }, media: { el: null }, overlay: null,
      sceneParams: [specs, [], [], []], sceneIndex: 0, currentScene: scene,
      sceneByName: (name: string) => scenes.findIndex((s) => s.name === name),
      setScene: vi.fn(), pushParams: vi.fn(), showParams: vi.fn(), paramValues: vi.fn(() => values),
      paramStore: { set: vi.fn() },
      editor: {
        target: (i: number) => ({ index: i, name: scenes[i]!.name, kind: (scenes[i] as { kind?: string }).kind === 'nodes' ? 'nodes' : 'user', body: (scenes[i] as { body?: string }).body ?? '' }),
        compileInto: vi.fn(async (_t: unknown, src: string) => { if (compileError) return compileError; scene.body = src; return null; }),
      },
    } as unknown as AppController & { editor: { compileInto: ReturnType<typeof vi.fn> } };
    const undo = new UndoStack();
    return { app, scene, undo, run: createToolRunner(app, undo) };
  }

  it('edit_scene_code compiles the edited code, returns the values only, and undoes to the old code', async () => {
    const { app, scene, undo, run } = setup();
    const before = scene.body;
    const out = await run('edit_scene_code', { edits: [{ find: 'float k = 1.;', replace: 'float k = .5;' }] });
    expect(scene.body).toBe(before.replace('1.;', '.5;'));
    expect(out).toEqual({ compiled: true, scene: 'Alpha', nowPlaying: true, parameters: { uGlow: 1.235, uMirror: true } });
    expect(undo.last).toBe('Edited Alpha');
    undo.pop()!.undo();
    expect(app.editor.compileInto).toHaveBeenLastCalledWith(expect.anything(), before);
  });

  it('edit_scene_code changes nothing when an edit misses or the result does not compile', async () => {
    const miss = setup();
    await expect(miss.run('edit_scene_code', { edits: [{ find: 'float q', replace: '' }] })).rejects.toThrow(/didn't match[\s\S]*Nothing was changed/);
    expect(miss.app.editor.compileInto).not.toHaveBeenCalled();
    expect(miss.undo.last).toBeUndefined();

    const broken = setup('ERROR: 0:2: syntax error');
    await expect(broken.run('edit_scene_code', { edits: [{ find: 'vec4(k)', replace: 'vec4(k' }] })).rejects.toThrow(/didn't compile.*scene's code/);
    expect(broken.undo.last).toBeUndefined();

    const raced = setup(SUPERSEDED);
    await expect(raced.run('edit_scene_code', { edits: [{ find: 'k', replace: 'j' }] })).rejects.toThrow(/matches 2 places/);
    await expect(raced.run('edit_scene_code', { edits: [{ find: 'float k', replace: 'float j' }] })).rejects.toThrow(/replaced your code[\s\S]*Read the scene's code again/);
    expect(raced.undo.last).toBeUndefined();
  });

  it('refuses to edit a visual-maker scene', async () => {
    const { run } = setup();
    await expect(run('edit_scene_code', { scene: 'Maker', edits: [{ find: 'x', replace: 'y' }] })).rejects.toThrow(/read-only/);
  });

  it('set_parameters answers with what it applied, not the whole parameter list', async () => {
    const { run } = setup();
    const out = await run('set_parameters', { values: { Glow: 2, Nope: 1 } });
    expect(out).toEqual({ applied: { uGlow: 2 }, problems: ['"Nope" isn\'t a parameter of this scene'] });
    expect(JSON.stringify(out).length).toBeLessThan(300);
  });

  it('get_app_state keeps the playing scene\'s parameters in full and lists the library compactly', async () => {
    const { run } = setup();
    const out = await run('get_app_state', {}) as { playing: { parameters: unknown[] }; scenes: unknown };
    expect(out.playing.parameters).toEqual([
      { name: 'uGlow', label: 'Glow', type: 'float', min: 0, max: 3, value: 1.23456 },
      { name: 'uMirror', label: 'Mirror', type: 'bool', value: true },
    ]);
    expect(out.scenes).toEqual({ Fractal: 'Alpha (mine), Beta*', Mine: 'Maker (visual maker)' });
  });
});

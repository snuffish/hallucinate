import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApp } from '../app/fake-app';
import type { Compiler } from '../app/scene-library';
import { StudioSession } from '../app/studio';
import { parseParams } from '../engine/params';
import { applyEdits, createToolRunner, fitCeilings, resolveParam, UndoConflict } from './executor';
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
    const app = fakeApp({ playing: false });
    const studio = new StudioSession(app);
    const undo = new UndoStack();
    return { app, studio, undo, run: createToolRunner(app, undo, () => studio) };
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

  it('writes show scenes without effects, and a change to one keeps the effects the user gave it', async () => {
    const { run, studio, app } = setup();
    const MIRRORED = [{ id: 'mirror' as const, on: true, settings: { axis: 2 } }];
    app.state.effects = MIRRORED;                    // the screen's effects don't ride along
    await run('add_show_scene', { scene: 'Alpha', look: { hue: 0.5 } });
    expect(studio.cues[0]!.effects).toEqual([]);
    const mine = studio.add({ name: 'Mine', scene: 'Alpha', values: {}, look: {}, effects: MIRRORED });
    await run('update_show_scene', { cue: mine.id, scene: 'Beta', look: { hue: 0.25 } });
    expect(studio.cueByRef(mine.id)!.effects).toEqual(MIRRORED);
  });

  it('leaves nothing to undo when the change itself fails', async () => {
    const { run, undo } = setup();
    await run('add_show_scene', { scene: 'Alpha' });
    undo.clear();
    await expect(run('reorder_show', { order: ['not-an-id'] })).rejects.toThrow();
    expect(undo.last).toBeUndefined();
  });

  it('undoes the transition and the autopilot under the same rule as the show', async () => {
    const { run, studio, undo } = setup();
    await run('set_transition', { mode: 'cut', seconds: 3 });
    undo.pop()!.undo();
    expect([studio.mode, studio.seconds]).toEqual(['fade', 1.5]);

    await run('set_transition', { seconds: 3 });
    studio.setSeconds(5);   // by hand
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(studio.seconds).toBe(5);

    await run('set_autopilot', { beats: 64 });
    studio.setAutoBeats(16);
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(studio.autopilot.beats).toBe(16);
  });

  it('undoes a plan together with the autopilot it switched on', async () => {
    const { run, studio, undo } = setup();
    await run('add_show_scene', { scene: 'Alpha' });
    await run('add_show_scene', { scene: 'Beta' });
    expect(studio.autopilot.on).toBe(false);
    await run('set_autopilot_plan', { plan: { steps: [{ cue: 'Alpha', beats: 32 }, { cue: 'Beta', beats: 32 }] } });
    expect([studio.plan?.steps.length, studio.autopilot.on]).toEqual([2, true]);
    undo.pop()!.undo();
    expect([studio.plan, studio.autopilot.on]).toEqual([null, false]);
  });

  it('raises a plan step\'s ceiling to fit its beats at the heard tempo, and says so', async () => {
    const { run, studio } = setup();   // the fake hears 120 BPM
    await run('add_show_scene', { scene: 'Alpha' });
    await run('add_show_scene', { scene: 'Beta' });
    const out = await run('set_autopilot_plan', { plan: { steps: [{ cue: 'Alpha', beats: 256 }, { cue: 'Beta', beats: 32, maxSeconds: 120 }] } }) as { note?: string };
    expect(studio.plan!.steps.map((st) => st.maxSeconds)).toEqual([160, 120]);   // 256 beats = 128 s, plus a quarter
    expect(out.note).toContain('Alpha');
    expect(out.note).not.toContain('Beta');
  });

  it('leaves ceilings alone without a tempo, and never raises one past the schema\'s 600 s', () => {
    const plan = { steps: [{ cue: 'a', beats: 512, maxSeconds: 90 }], note: '', loop: true };
    expect(fitCeilings(plan, null)).toEqual({ plan, raised: [] });
    expect(fitCeilings(plan, 40).plan.steps[0]!.maxSeconds).toBe(600);
  });

  it('shows each show scene\'s effects in get_show', async () => {
    const { run, studio } = setup();
    studio.add({ name: 'Mirrored', scene: 'Alpha', values: {}, look: {}, effects: [{ id: 'mirror', on: true, settings: { axis: 1 } }] });
    const show = await run('get_show', {}) as { cues: { effects: unknown }[] };
    expect(show.cues[0]!.effects).toEqual([{ id: 'mirror', on: true, settings: { axis: 1 } }]);
  });

  it('has nothing to do when what a change touched is already back as it was', async () => {
    const { run, studio, undo } = setup();
    await run('set_transition', { mode: 'cut' });
    studio.setMode('fade');   // put back by hand
    expect(() => undo.pop()!.undo()).not.toThrow();
    expect(studio.mode).toBe('fade');
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

  // Alpha's code declares its parameters, as a scene's code does: a compile reads them from it.
  const PARAMS = 'uniform float uGlow; // @param min=0 max=3 label="Glow"\nuniform bool uMirror; // @param label="Mirror"';
  const { params: specs } = parseParams(PARAMS);

  function setup(compiler: Partial<Compiler> = {}) {
    const app = fakeApp({
      scenes: [
        { name: 'Alpha', cat: 'Fractal', body: `${PARAMS}\nfloat k = 1.;\nvoid main() { fragColor = vec4(k); }`, user: true },
        { name: 'Beta', cat: 'Fractal', edited: true }, { name: 'Maker', cat: 'Mine', kind: 'nodes' }, { name: 'Gone', cat: 'Space', removed: true },
      ],
      params: [specs],
      playing: false,
      compiler,
    });
    app.library.setValues(0, { uGlow: 1.23456, uMirror: true });
    const undo = new UndoStack();
    return {
      app, scene: app.state.scenes[0]!, scenes: app.state.scenes, undo, run: createToolRunner(app, undo),
      compileInto: vi.spyOn(app.editor, 'compileInto'), remove: vi.spyOn(app.library, 'remove'),
    };
  }

  it('edit_scene_code compiles the edited code, returns the values only, and undoes to the old code', async () => {
    const { compileInto, scene, undo, run } = setup();
    const before = scene.body;
    const out = await run('edit_scene_code', { edits: [{ find: 'float k = 1.;', replace: 'float k = .5;' }] });
    expect(scene.body).toBe(before.replace('1.;', '.5;'));
    expect(out).toEqual({ compiled: true, scene: 'Alpha', nowPlaying: true, parameters: { uGlow: 1.235, uMirror: true } });
    expect(undo.last).toBe('Edited Alpha');
    undo.pop()!.undo();
    expect(compileInto).toHaveBeenLastCalledWith(expect.anything(), before);
  });

  it('does not undo a code change once the scene\'s code was changed after it', async () => {
    const { compileInto, scene, undo, run } = setup();
    await run('edit_scene_code', { edits: [{ find: 'float k = 1.;', replace: 'float k = .5;' }] });
    scene.body = 'void main() { fragColor = vec4(1.); }';   // the user's own edit
    compileInto.mockClear();
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(compileInto).not.toHaveBeenCalled();
  });

  it('undoes a new scene by removing it, but not once the user edited its code', async () => {
    const { remove, scenes, undo, run } = setup();
    await run('create_scene', { name: 'Neon Tide', code: 'void main() { fragColor = vec4(1.); }' });
    undo.pop()!.undo();
    expect(remove).toHaveBeenCalledWith(4);
    expect(scenes[4]!.removed).toBe(true);

    await run('create_scene', { name: 'Neon Tide 2', code: 'void main() { fragColor = vec4(1.); }' });
    scenes[5]!.body = 'void main() { fragColor = vec4(.5); }';
    remove.mockClear();
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(remove).not.toHaveBeenCalled();
  });

  it('create_scene refuses a name that is taken, and code that does not compile', async () => {
    const taken = setup();
    await expect(taken.run('create_scene', { name: 'Beta', code: 'void main() {}' })).rejects.toThrow(/already exists \(a built-in one\)\. Pick another name/);
    const broken = setup({ check: () => 'ERROR: 0:1: syntax error' });
    await expect(broken.run('create_scene', { name: 'New', code: 'void main( {}' })).rejects.toThrow(/didn't compile, so nothing was created/);
    expect(broken.scenes).toHaveLength(4);
  });

  it('edit_scene_code changes nothing when an edit misses or the result does not compile', async () => {
    const miss = setup();
    await expect(miss.run('edit_scene_code', { edits: [{ find: 'float q', replace: '' }] })).rejects.toThrow(/didn't match[\s\S]*Nothing was changed/);
    expect(miss.compileInto).not.toHaveBeenCalled();
    expect(miss.undo.last).toBeUndefined();

    const broken = setup({ compileAsync: async () => 'ERROR: 0:2: syntax error' });
    const before = broken.scene.body;
    await expect(broken.run('edit_scene_code', { edits: [{ find: 'vec4(k)', replace: 'vec4(k' }] })).rejects.toThrow(/didn't compile.*scene's code/);
    expect(broken.undo.last).toBeUndefined();
    expect(broken.scene.body).toBe(before);

    // The user's own edit of the scene starts while the assistant's is still compiling: theirs wins.
    const gates: (() => void)[] = [];
    const raced = setup({ compileAsync: () => new Promise((resolve) => { gates.push(() => resolve(null)); }) });
    await expect(raced.run('edit_scene_code', { edits: [{ find: 'k', replace: 'j' }] })).rejects.toThrow(/matches 2 places/);
    const edit = raced.run('edit_scene_code', { edits: [{ find: 'float k', replace: 'float j' }] });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const theirs = raced.app.editor.compileInto(raced.app.editor.target(0), `${PARAMS}\nvoid main() { fragColor = vec4(1.); }`);
    gates.forEach((open) => open());
    await expect(edit).rejects.toThrow(/replaced your code[\s\S]*Read the scene's code again/);
    await expect(theirs).resolves.toBeNull();
    expect(raced.undo.last).toBeUndefined();
    expect(raced.scene.body).toContain('vec4(1.)');
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

  it('set_parameters undoes only the parameters it set, and not after they were changed again', async () => {
    const { app, undo, run } = setup();
    await run('set_parameters', { values: { Glow: 2 } });
    app.library.setValues(0, { uMirror: false });   // another parameter, by hand: no conflict
    undo.pop()!.undo();
    expect(app.library.values(0)).toEqual({ uGlow: 1.23456, uMirror: false });

    await run('set_parameters', { values: { Glow: 2 } });
    app.library.setValues(0, { uGlow: 2.5 });   // the same one, by hand
    expect(() => undo.pop()!.undo()).toThrow(UndoConflict);
    expect(app.library.values(0).uGlow).toBe(2.5);
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

  it('get_app_state reports the switches, the effects and, while music plays, the live levels', async () => {
    const { run, app } = setup();
    app.state.effects = [{ id: 'mirror', on: true, settings: { axis: 0 } }];
    const out = await run('get_app_state', {}) as { look: Record<string, unknown>; effects: unknown; listening: unknown; livePinned?: unknown };
    expect(out.look).toMatchObject({ autoSwitch: true, drift: false, driftSpeed: 1, randomizePicksScene: false });
    expect(out.effects).toEqual([{ id: 'mirror', on: true, settings: { axis: 0 } }]);
    expect(out.listening).toBeNull();   // nothing plays
    expect(out.livePinned).toBeUndefined();
    app.music.playing = true;
    expect((await run('get_app_state', {}) as { listening: unknown }).listening).toEqual({ energy: 0.5, bass: 0.4, mid: 0.4, high: 0.4 });
  });

  it('find_scenes searches names, categories and descriptions, and skips removed scenes', async () => {
    const { run, scenes } = setup();
    scenes[1]!.desc = 'Rings of light that open with the bass';
    const names = async (input: object) => ((await run('find_scenes', input)) as { scenes: { name: string }[] }).scenes.map((x) => x.name);
    expect(await names({ query: 'rings' })).toEqual(['Beta']);
    expect(await names({ category: 'fractal' })).toEqual(['Alpha', 'Beta']);
    expect(await names({})).toEqual(['Alpha', 'Beta', 'Maker']);
    expect(await names({ query: 'gone' })).toEqual([]);
  });

  it('get_help lists the topics, reads one with its shortcuts, and names the topics for an unknown id', async () => {
    const { run } = setup();
    const list = await run('get_help', {}) as { topics: { id: string }[] };
    expect(list.topics.map((t) => t.id)).toContain('panel');
    const panel = await run('get_help', { topic: 'panel' }) as { title: string; text: string };
    expect(panel.title).toBe('Controls & layout');
    expect(panel.text).toContain('Randomize (R)');
    await expect(run('get_help', { topic: 'nope' })).rejects.toThrow(/no help topic "nope". Topics: panel/);
  });
});

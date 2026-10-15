import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../app/controller';
import { StudioSession } from '../app/studio';
import { parseParams } from '../engine/params';
import { createToolRunner, resolveParam, UndoConflict } from './executor';
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

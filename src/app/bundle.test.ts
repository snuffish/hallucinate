import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLES } from '../engine/nodes';
import { SCENES } from '../engine/scenes';
import { resetLayout } from '../state/layout';
import { KEY_CLASS, KEYS } from '../state/persistence';
import { BUNDLE_VERSION, MAX_BUNDLE_BYTES, SECTIONS, applyWrites, buildBundle, parseBundle } from './bundle';

const SHOW = { cues: [{ id: 'c1', name: 'Opener', scene: 'Mine', values: {}, look: {} }], mode: 'cut', seconds: 2, autoBeats: 32, autoUnit: 'beats', autoSeconds: 30, plan: null, directorBeats: 128, directorUnit: 'beats', directorSeconds: 120 };

describe('settings bundle', () => {
  let store: Map<string, string>;
  let failOn: string | null;
  beforeEach(() => {
    store = new Map();
    failOn = null;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { if (k === failOn) throw new DOMException('Storage is full.', 'QuotaExceededError'); store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const seed = () => {
    store.set(KEYS.userScenes, JSON.stringify([{ name: 'Mine', body: 'void main(){}' }, { name: 'Broken here', body: 'nope' }]));
    store.set(KEYS.sceneEdits, JSON.stringify({ [SCENES[0]!.name]: 'edited' }));
    store.set(KEYS.customShader, 'void main() { /* mine */ }');
    store.set(KEYS.nodeGraph, JSON.stringify(EXAMPLES[0]!.graph));
    store.set(KEYS.params, JSON.stringify({ 'user:Mine': { uGlow: { v: 2, def: 1 } } }));
    store.set(KEYS.show, JSON.stringify(SHOW));
    store.set(KEYS.library, JSON.stringify({ favs: ['Mine'], off: [] }));
    store.set(KEYS.player, JSON.stringify({ volume: 0.4, pitchFollows: true }));
    store.set(KEYS.layout, JSON.stringify(resetLayout()));
    store.set(KEYS.mediaSound, '1');
    store.set(KEYS.scRecent, '[]');      // history: never exported
    store.set(KEYS.helpHint, '1');
    store.set(KEYS.prefs, JSON.stringify({ v: 1, maxPixelRatio: 1 }));   // device preferences: never exported
  };
  const file = (data: unknown, extra: object = {}) => JSON.stringify({ format: 'hallucinate', version: BUNDLE_VERSION, data, ...extra });

  it('round-trips every section and leaves history and device preferences out', () => {
    seed();
    const exported = new Map(store);
    const bundle = buildBundle();
    expect(Object.keys(bundle.data).sort()).toEqual(['customShader', 'layout', 'library', 'mediaSound', 'nodeGraph', 'params', 'player', 'sceneEdits', 'show', 'userScenes']);
    expect(bundle.data.mediaSound).toBe(true);
    store.clear();
    const parsed = parseBundle(JSON.stringify(bundle));
    if (!parsed.ok) throw new Error(parsed.error);
    applyWrites(parsed.bundle.writes);
    const decode = (key: string, value: string | undefined) => (key === KEYS.customShader || key === KEYS.mediaSound ? value : JSON.parse(value!));
    for (const [key, value] of exported) {
      if (key === KEYS.scRecent || key === KEYS.helpHint || key === KEYS.prefs) expect(store.has(key)).toBe(false);
      else expect(decode(key, store.get(key))).toEqual(decode(key, value));
    }
    expect(parsed.bundle.summary).toBe('2 scenes, 1 edited built-in, My Shader, the visual maker graph, parameter values, a show with 1 cue, favourites, player settings, layout');
  });

  it('carries exactly the keys that hold setup; everything else stays on this computer', () => {
    const setup = (Object.keys(KEY_CLASS) as (keyof typeof KEYS)[]).filter((k) => KEY_CLASS[k] === 'setup').map((k) => KEYS[k]);
    expect(Object.values(SECTIONS).map((s) => s.key).sort()).toEqual(setup.sort());
  });

  it('exports what is stored, including scenes that do not compile on this device', () => {
    seed();
    expect((buildBundle().data.userScenes as { name: string }[]).map((s) => s.name)).toEqual(['Mine', 'Broken here']);
  });

  it('only replaces the sections the file has', () => {
    seed();
    const parsed = parseBundle(file({ library: { favs: ['Other'], off: [] } }));
    if (!parsed.ok) throw new Error(parsed.error);
    applyWrites(parsed.bundle.writes);
    expect(JSON.parse(store.get(KEYS.library)!)).toEqual({ favs: ['Other'], off: [] });
    expect(JSON.parse(store.get(KEYS.show)!)).toEqual(SHOW);
  });

  it('fills defaults and normalises the layout', () => {
    const parsed = parseBundle(file({ show: { cues: [] }, layout: { v: 1, widgets: {} } }));
    if (!parsed.ok) throw new Error(parsed.error);
    const written = Object.fromEntries(parsed.bundle.writes);
    expect(JSON.parse(written[KEYS.show]!)).toMatchObject({ mode: 'fade', seconds: 1.5 });
    expect(JSON.parse(written[KEYS.layout]!)).toEqual(resetLayout());
  });

  it.each([
    ['not JSON', '{oops', "isn't valid JSON"],
    ['another app\'s file', JSON.stringify({ hello: 1 }), "isn't a Hallucinate settings export"],
    ['a newer version', file({}, { version: BUNDLE_VERSION + 1 }), 'newer version'],
    ['an empty export', file({}), 'nothing to import'],
    ['a broken section', file({ userScenes: [{ name: 'X' }] }), 'The "userScenes" section is broken (0.body:'],
    ['a broken layout', file({ layout: { widgets: {} } }), 'The "layout" section is broken'],
    ['a built-in name', file({ userScenes: [{ name: SCENES[0]!.name, body: '' }] }), 'same name as a built-in'],
    ['an editor slot name', file({ userScenes: [{ name: 'My Shader', body: '' }] }), 'same name as a built-in'],
    ['duplicate names', file({ userScenes: [{ name: 'A', body: '' }, { name: 'A', body: '' }] }), 'two scenes called "A"'],
  ])('rejects %s', (_, text, message) => {
    const parsed = parseBundle(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it('rejects a file over the size limit', () => {
    expect(parseBundle(' '.repeat(MAX_BUNDLE_BYTES + 1))).toMatchObject({ ok: false });
  });

  it('puts every value back when a write fails part-way', () => {
    seed();
    const before = new Map(store);
    const parsed = parseBundle(file({ userScenes: [], customShader: 'new', show: { cues: [] } }));
    if (!parsed.ok) throw new Error(parsed.error);
    failOn = KEYS.show;
    expect(() => applyWrites(parsed.bundle.writes)).toThrow('Storage is full.');
    expect(store).toEqual(before);
  });

  it('removes a key on rollback when it did not exist before', () => {
    const parsed = parseBundle(file({ customShader: 'new', show: { cues: [] } }));
    if (!parsed.ok) throw new Error(parsed.error);
    failOn = KEYS.show;
    expect(() => applyWrites(parsed.bundle.writes)).toThrow();
    expect(store.has(KEYS.customShader)).toBe(false);
  });
});

// For tests: the app as the sessions see it (AppPort), in memory. Scenes, the clock, the look, the
// UI store, parameter values, scene code and hooks behave like the controller's; what needs a GPU,
// a window or real media (snapshots, projector windows) is a stub.

import type { AudioKind } from '../engine/audio';
import type { ParamSpec, ParamValues } from '../engine/params';
import type { Scene } from '../engine/scenes';
import { defaultClock, defaultLook, LOOK_KEYS, LOOK_RANGES, type LookKey } from '../state/app-state';
import { DEFAULT_PREFS } from '../state/prefs';
import { Store } from '../state/store';
import { initialUIState } from '../state/ui-state';
import type { AppPort } from './app-port';
import type { ControllerHooks } from './controller';
import type { CompileResult, EditorKind } from './editor';
import type { MediaLayer } from '../engine/media';

export interface FakeAppOptions {
  scenes?: (Partial<Scene> & { name: string })[];
  params?: ParamSpec[][];                              // per scene index
  audio?: AudioKind | null;                            // what is playing, or nothing (default: the demo)
  compile?: (source: string) => CompileResult;         // the compiler's answer (default: it compiles)
}

export type FakeApp = AppPort & {
  hooks: Partial<ControllerHooks>;
  toasts: string[];
  audio: { kind: AudioKind | null; features: AppPort['audio']['features'] };
  tempo: { bpm: number | null };
};

const kindOf = (s: Scene): EditorKind => (s.kind === 'custom' ? 'custom' : s.kind === 'nodes' ? 'nodes' : s.user ? 'user' : 'builtin');

export function fakeApp(opts: FakeAppOptions = {}): FakeApp {
  const scene = (s: Partial<Scene> & { name: string }, i: number): Scene => ({ id: `s${i}`, cat: '', desc: '', body: '', frag: '', params: [], ...s });
  const scenes: Scene[] = (opts.scenes ?? [{ name: 'Alpha', cat: 'Fractal' }, { name: 'Beta', cat: 'Space' }]).map(scene);
  const look = defaultLook();
  const state = { scenes, gameIndex: -1, customIndex: -1, nodesIndex: -1, keyedScenes: [], look, clock: defaultClock(), activeSource: null };
  const sceneParams: ParamSpec[][] = scenes.map((_, i) => opts.params?.[i] ?? []);
  const stored = new Map<number, ParamValues>();
  const hooks: Partial<ControllerHooks> = {};
  const toasts: string[] = [];

  const paramValues = (i: number): ParamValues => {
    const saved = stored.get(i) ?? {};
    return Object.fromEntries((sceneParams[i] ?? []).map((s) => [s.name, structuredClone(saved[s.name] ?? s.def)]));
  };
  const setValues = (i: number, values: ParamValues) => { stored.set(i, { ...stored.get(i), ...structuredClone(values) }); };
  const show = (i: number, fade: number) => {
    if (!scenes[i] || scenes[i]!.removed) return;
    state.clock.prevScene = state.clock.scene;
    state.clock.scene = i;
    state.clock.fade = fade;
  };
  const setLook = (k: LookKey, v: number) => { const r = LOOK_RANGES[k]; look[k] = Math.min(r.max, Math.max(r.min, v)); };

  const app: FakeApp = {
    state, sceneParams, hooks, toasts,
    ui: new Store(initialUIState(look)),
    audio: { kind: opts.audio === undefined ? 'demo' : opts.audio, features: { bass: 0.4, mid: 0.4, high: 0.4, level: 0.5, beat: 0, bright: 0.6, centroid: 0 } },
    tempo: { bpm: 120 },
    media: { el: null, name: '', kind: null } as unknown as MediaLayer,   // only the studio's Preview renderer uses it, and tests never open one
    renderer: { sceneParams: [], snapshotAsync: () => Promise.reject(new Error('No GPU in tests.')) },
    output: { screens: async () => [], open: () => { throw new Error('No projector windows in tests.'); } },
    prefs: { get: () => DEFAULT_PREFS },
    editor: {
      target: (i) => { const s = scenes[i]!; return { index: i, name: s.name, kind: kindOf(s), body: s.body, original: s.original }; },
      compileInto: async (target, source) => {
        const result = opts.compile?.(source) ?? null;
        if (result === null) scenes[target.index]!.body = source;
        return result;
      },
    },
    get sceneIndex() { return state.clock.scene; },
    get currentScene() { return scenes[state.clock.scene]!; },
    get overlay() { return app.ui.get().overlay; },
    toast: (text) => { toasts.push(text); },
    setHooks: (h) => {
      Object.assign(hooks, h);
      return () => { for (const k of Object.keys(h) as (keyof ControllerHooks)[]) if (hooks[k] === h[k]) delete hooks[k]; };
    },
    showParams: () => {},
    setScene: (i, fade = 0) => { hooks.onManualSceneChange?.(); show(i, fade); },
    sceneByName: (name) => scenes.findIndex((s) => s.name === name && !s.removed),
    setLook,
    paramValues,
    setParamValues: (i, specs, values) => setValues(i, Object.fromEntries(specs.filter((s) => values[s.name] !== undefined).map((s) => [s.name, values[s.name]!]))),
    captureScene: (i = state.clock.scene) => ({ scene: i, values: paramValues(i), look: Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])) }),
    applyScene: (snap, fade) => {
      for (const k of LOOK_KEYS) if (snap.look[k] !== undefined) setLook(k, snap.look[k]!);
      stored.set(snap.scene, structuredClone(snap.values));
      show(snap.scene, fade);
    },
    addUserScene: (name, body) => {
      if (scenes.some((s) => s.name === name && !s.removed)) return { error: `A scene called "${name}" already exists.` };
      return { index: scenes.push(scene({ name, cat: 'Mine', body, user: true }, scenes.length)) - 1 };
    },
    removeUserScene: (i) => { if (scenes[i]?.user) scenes[i]!.removed = true; },
  };
  return app;
}

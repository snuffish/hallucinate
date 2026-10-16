// For tests: the app as the sessions see it (AppPort), in memory. Scenes, the clock, the look, the
// UI store, parameter values, scene code, the pinned Live slot (the real one) and hooks behave like the
// controller's; what needs a GPU, a window or real media (snapshots, projector windows) is a stub.

import type { Hearing } from '../engine/listener';
import type { MediaLayer } from '../engine/media';
import { ParamStore, type ParamSpec } from '../engine/params';
import type { Scene } from '../engine/scenes';
import { defaultClock, defaultLook, LOOK_KEYS, LOOK_RANGES, type LookKey } from '../state/app-state';
import { DEFAULT_PREFS } from '../state/prefs';
import { Store } from '../state/store';
import { initialUIState } from '../state/ui-state';
import type { AppPort } from './app-port';
import type { ControllerHooks } from './controller';
import { EditorCore } from './editor';
import { LiveSlot } from './live-slot';
import { SceneLibrary, type Compiler } from './scene-library';

export interface FakeAppOptions {
  scenes?: (Partial<Scene> & { name: string })[];
  params?: ParamSpec[][];                              // per scene index: its @params
  playing?: boolean;                                   // whether music sounds (default: it does)
  compiler?: Partial<Compiler>;                        // the GPU's answers (default: everything compiles)
}

export type FakeApp = AppPort & {
  hooks: Partial<ControllerHooks>;
  toasts: string[];
  hearing: Hearing;
  music: { playing: boolean };
};

export function fakeApp(opts: FakeAppOptions = {}): FakeApp {
  const scene = (s: Partial<Scene> & { name: string }, i: number): Scene => ({ id: `s${i}`, cat: '', desc: '', body: '', frag: '', params: opts.params?.[i] ?? [], ...s });
  const scenes: Scene[] = (opts.scenes ?? [{ name: 'Alpha', cat: 'Fractal' }, { name: 'Beta', cat: 'Space' }]).map(scene);
  const look = defaultLook();
  const state = { scenes, gameIndex: -1, customIndex: -1, nodesIndex: -1, keyedScenes: [], look, clock: defaultClock(), activeSource: null };
  const hooks: Partial<ControllerHooks> = {};
  const toasts: string[] = [];
  const ui = new Store(initialUIState(look));
  const toast = (text: string) => { toasts.push(text); };
  const compiler: Compiler = { check: () => null, compileAsync: async () => null, release: () => {}, ...opts.compiler };
  const library = new SceneLibrary(scenes, { userScenes: [], sceneEdits: {} }, compiler, new ParamStore());

  const show = (i: number, fade: number) => {
    if (!scenes[i] || scenes[i]!.removed) return;
    state.clock.prevScene = state.clock.scene;
    state.clock.scene = i;
    state.clock.fade = fade;
  };
  const setLook = (k: LookKey, v: number) => { const r = LOOK_RANGES[k]; look[k] = Math.min(r.max, Math.max(r.min, v)); };

  const app: FakeApp = {
    state, library, hooks, toasts,
    ui,
    live: new LiveSlot({ state, specs: (i) => library.specs(i), stored: [], ui, toast }),
    hearing: { bass: 0.4, mid: 0.4, high: 0.4, level: 0.5, beat: 0, kick: false, tick: false, bpm: 120, bright: 0.6, centroid: 2500, energy: 0.5, mood: 0.5 },
    music: { playing: opts.playing ?? true },
    media: { el: null, name: '', kind: null } as unknown as MediaLayer,   // only the studio's Preview renderer uses it, and tests never open one
    renderer: { snapshotAsync: () => Promise.reject(new Error('No GPU in tests.')) },
    output: { screens: async () => [], open: () => { throw new Error('No projector windows in tests.'); } },
    prefs: { get: () => DEFAULT_PREFS },
    editor: new EditorCore({ state, library, toast }),
    get sceneIndex() { return state.clock.scene; },
    get currentScene() { return scenes[state.clock.scene]!; },
    get overlay() { return app.ui.get().overlay; },
    toast,
    setHooks: (h) => {
      Object.assign(hooks, h);
      return () => { for (const k of Object.keys(h) as (keyof ControllerHooks)[]) if (hooks[k] === h[k]) delete hooks[k]; };
    },
    showParams: () => {},
    setScene: (i, fade = 0) => { hooks.onManualSceneChange?.(); show(i, fade); },
    sceneByName: (name) => library.byName(name),
    setLook,
    captureScene: (i = state.clock.scene) => ({ scene: i, values: library.values(i), look: Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])) }),
    applyScene: (snap, fade) => {
      for (const k of LOOK_KEYS) if (snap.look[k] !== undefined) setLook(k, snap.look[k]!);
      library.replaceValues(snap.scene, snap.values);
      show(snap.scene, fade);
    },
  };
  return app;
}

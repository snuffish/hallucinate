// The scene library: each scene's code, its @params and their stored values, and the only code that
// compiles into a scene, adds one or removes one. The scene list itself is the shared array the
// renderer draws from (scene-list.ts: append or soft-remove, never splice); this keeps what belongs
// to each entry consistent: a scene's `params` are always the ones its code declares, its values
// are read through them, and its saved form follows every change.
//
// The controller says what a change means for the screen (onChange): new code reaches the renderer,
// the projector and the Parameters panel, new values the renderer and the panel. Compiling goes
// through a Compiler, the renderer or a test's fake. Every code change is noted in the scenes'
// history (scene-history.ts), with who made it.

import { parseParams, type ParamSpec, type ParamStore, type ParamValues } from '../engine/params';
import { COMMON, userSceneId, type Scene } from '../scenes';
import { appendScene, discardParked, paramKey, saveSceneEdit, saveUserScenes, sceneByName, userScene, type ParkedScenes } from '../state/scene-list';
import type { Origin, SceneHistory } from '../state/scene-history';

// What a scene's code compiles with (Renderer has these). Errors are the GLSL compiler's text.
export interface Compiler {
  check(frag: string, name: string): string | null;
  compileAsync(frag: string, name: string): Promise<string | null>;
  release(frag: string): void;   // a compiled program nobody will use
}

// What changed in scene `index`: its code (and so its @params), its values, or the list (a scene left
// it or a parked one was discarded; `index` is -1 for those).
export type SceneChange = 'code' | 'values' | 'list';

// What compile resolves with when a newer compile for the same scene started meanwhile: neither this
// source's success nor its error is current any more, so callers leave their status alone.
export const SUPERSEDED = Symbol('superseded');
export type CompileResult = string | null | typeof SUPERSEDED;

// Why a scene can't be added under a name: one of yours has it, a built-in has it, or one of yours
// that doesn't compile on this device (parked) has it. No conflict: the code doesn't compile.
export type NameConflict = 'mine' | 'builtin' | 'parked';
export type AddResult = { index: number } | { error: string; conflict?: NameConflict };

const HEADER_LINES = COMMON.split('\n').length - 1;
const NONE: readonly ParamSpec[] = [];

// "ERROR: 0:57: 'foo' : undeclared identifier" -> "Line 3: 'foo' : undeclared identifier"
export function formatError(message: string): string {
  return message
    .split('\n')
    .filter((l) => l.startsWith('ERROR'))
    .map((l) => l.replace(/^ERROR: \d+:(\d+): /, (_, n: string) => `Line ${Number(n) - HEADER_LINES}: `))
    .join('\n') || message;
}

export class SceneLibrary {
  private readonly seq = new Map<number, number>();

  constructor(
    private readonly scenes: Scene[],
    readonly parked: ParkedScenes,
    private readonly compiler: Compiler,
    private readonly store: ParamStore,
    private readonly onChange: (index: number, what: SceneChange) => void = () => {},
    private readonly history: Pick<SceneHistory, 'note' | 'drop'> | null = null,
  ) {}

  // ---------- Parameters ----------

  specs(i: number): readonly ParamSpec[] { return this.scenes[i]?.params ?? NONE; }

  // Every parameter's value: the stored one while it still fits the spec, else the default.
  values(i: number): ParamValues {
    const scene = this.scenes[i];
    return scene ? this.store.values(paramKey(scene), scene.params) : {};
  }

  // Some values, by parameter name; names the scene doesn't have are ignored.
  setValues(i: number, values: ParamValues): void {
    const scene = this.scenes[i];
    if (!scene) return;
    for (const s of scene.params) if (values[s.name] !== undefined) this.store.set(paramKey(scene), s, values[s.name]!);
    this.onChange(i, 'values');
  }

  // All of them at once (a show scene taken live); a missing one is its default.
  replaceValues(i: number, values: ParamValues): void {
    const scene = this.scenes[i];
    if (!scene) return;
    this.store.setAll(paramKey(scene), scene.params, values);
    this.onChange(i, 'values');
  }

  resetValues(i: number): void {
    const scene = this.scenes[i];
    if (!scene) return;
    this.store.reset(paramKey(scene));
    this.onChange(i, 'values');
  }

  // ---------- Code ----------

  // Compiles `source` into scene i, in the background (the old program keeps running). Resolves with
  // the error (line numbers count from `source`), or null once the new code and its @params are the
  // scene's and saved: your scenes and your edits of built-ins are stored here, the editor slots
  // ("My Shader", the visual maker's) by their editors. A newer compile for the same scene supersedes
  // one still in flight (SUPERSEDED; its program is released). `origin`: who made the change, for
  // the scene's history (the visual maker's generated code has none).
  async compile(i: number, source: string, origin: Origin = { by: 'you' }): Promise<CompileResult> {
    const scene = this.scenes[i];
    if (!scene) return 'No such scene.';
    const { code, params } = parseParams(source);
    const frag = COMMON + code;
    const n = (this.seq.get(i) ?? 0) + 1;
    this.seq.set(i, n);
    const error = await this.compiler.compileAsync(frag, scene.name);
    if (this.seq.get(i) !== n) {
      if (!error) this.compiler.release(frag);
      return SUPERSEDED;
    }
    if (error) return formatError(error);
    const before = scene.body;
    scene.frag = frag;
    scene.params = params;
    scene.body = source;
    if (scene.user) saveUserScenes(this.scenes, this.parked);
    else if (scene.kind !== 'custom' && scene.kind !== 'nodes') saveSceneEdit(scene, this.scenes, this.parked);
    if (scene.kind !== 'nodes') this.history?.note(paramKey(scene), source, origin, before);
    this.onChange(i, 'code');
    return null;
  }

  // ---------- The list ----------

  byName(name: string): number { return sceneByName(this.scenes, name); }

  // A new scene of yours (appended), or with `replace` one of yours under that name overwritten in
  // place, or a parked one of that name superseded. `valuesFrom`: the scene whose parameter values it
  // starts with (Save to library keeps what you tweaked). Nothing changes unless it compiles.
  add(name: string, body: string, { replace = false, valuesFrom, origin = { by: 'library' } }: { replace?: boolean; valuesFrom?: number; origin?: Origin } = {}): AddResult {
    const existing = this.byName(name);
    if (existing >= 0 && !this.scenes[existing]!.user) return { error: `A scene called "${name}" already exists (a built-in one).`, conflict: 'builtin' };
    if (existing >= 0 && !replace) return { error: `A scene called "${name}" already exists.`, conflict: 'mine' };
    if (existing < 0 && !replace && this.parked.userScenes.some((p) => p.name === name)) {
      return { error: `A scene called "${name}" already exists (it doesn't compile on this device).`, conflict: 'parked' };
    }
    const scene = userScene(name, body);
    const error = this.compiler.check(scene.frag, name);
    if (error) return { error };
    let index = existing;
    const before = existing >= 0 ? this.scenes[existing]!.body : this.parked.userScenes.find((p) => p.name === name)?.body;
    if (existing >= 0) Object.assign(this.scenes[existing]!, scene);
    else index = appendScene(this.scenes, scene);
    const from = valuesFrom === undefined ? undefined : this.scenes[valuesFrom];
    if (from && valuesFrom !== index) this.store.copy(paramKey(from), paramKey(this.scenes[index]!));
    saveUserScenes(this.scenes, this.parked);
    this.history?.note(paramKey(this.scenes[index]!), body, origin, before);
    this.onChange(index, 'code');
    return { index };
  }

  // One of yours leaves the library (soft-removed: indices stay valid). Built-ins can't.
  remove(i: number): void {
    const s = this.scenes[i];
    if (!s?.user || s.removed) return;
    s.removed = true;
    saveUserScenes(this.scenes, this.parked);
    this.onChange(i, 'list');
  }

  // A parked scene or edit (didn't compile here) is deleted for good.
  discardParked(kind: 'scene' | 'edit', name: string): void {
    discardParked(this.parked, kind, name, this.scenes);
    if (kind === 'scene' && this.byName(name) < 0) this.history?.drop(userSceneId(name));
    this.onChange(-1, 'list');
  }
}

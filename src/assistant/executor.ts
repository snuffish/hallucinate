// The assistant's tools, implemented against the app. Each returns its result (which goes back to
// the model) and may register an undo. Errors are thrown: TanStack turns them into error tool results.
// The input is parsed with the tool's own schema (tools.ts) before it gets here, and every tool name
// must have an implementation: a missing or misspelt one doesn't compile.

import type { AppPort } from '../app/app-port';
import { SUPERSEDED } from '../app/scene-library';
import type { Cue, ShowSnapshot, StudioSession } from '../app/studio';
import { blobToBase64, encodeJpeg } from '../engine/jpeg';
import type { ParamSpec, ParamValue, ParamValues } from '../engine/params';
import { stillUniforms } from '../engine/scene-inputs';
import type { Scene } from '../scenes';
import { soundNow } from '../engine/listener';
import { LOOK_KEYS, LOOK_RANGES, type LookKey } from '../state/app-state';
import { PlanSchema } from '../state/show-plan';
import type { z } from 'zod';
import type { UndoStack } from './undo';
import { TOOL_DEFINITIONS, type ContentParts, type ToolName } from './tools';

export interface AssistantContext { run: ToolRunner }
export type ToolRunner = (name: string, input: unknown) => Promise<unknown>;

type Definition = (typeof TOOL_DEFINITIONS)[number];
type InputOf<K extends ToolName> = z.output<NonNullable<Extract<Definition, { name: K }>['inputSchema']>>;
type Implementations = { [K in ToolName]: (input: InputOf<K>) => Promise<unknown> | unknown };
const DEFINITIONS = new Map<string, Definition>(TOOL_DEFINITIONS.map((d) => [d.name, d]));

// What an assistant change touched changed again since (by hand, by the director or another chat):
// undoing it by putting back the old state would silently undo those changes too.
export class UndoConflict extends Error {
  constructor(label: string) { super(`Something changed after "${label}", so it can't be undone without undoing that too.`); this.name = 'UndoConflict'; }
}

// What a change touches, for its undo: `read` captures it, `write` puts a captured value back.
interface Touched<S> { read: () => S; write: (before: S) => void }

const kindOf = (s: Scene) => (s.kind === 'custom' ? 'custom' : s.kind === 'nodes' ? 'visual maker' : s.user ? 'mine' : 'built-in');

// Parameter values from the model: numbers, true/false, "#rrggbb", or arrays.
function coerceParam(spec: ParamSpec, raw: unknown): ParamValue | undefined {
  if (spec.type === 'bool') return typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (spec.type === 'float') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  const size = spec.def.length;
  if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) {
    const n = parseInt(raw.slice(1), 16);
    const rgb = [n >> 16, n >> 8, n].map((c) => (c & 255) / 255);
    return size === 4 ? [...rgb, 1] : size === 3 ? rgb : undefined;
  }
  if (Array.isArray(raw) && raw.length === size && raw.every((x) => Number.isFinite(Number(x)))) return raw.map(Number);
  return undefined;
}

// The spec a key from the model means: its exact name, "Group/Label", or a label that only one param
// has. Groups make short labels repeat ("Size" under Mushrooms and under Trees); guessing the first
// would quietly move the wrong slider, so an ambiguous label is an error that names the candidates.
export function resolveParam(specs: readonly ParamSpec[], key: string): ParamSpec | string {
  const exact = specs.find((s) => s.name === key);
  if (exact) return exact;
  const k = key.trim().toLowerCase();
  const slash = k.lastIndexOf('/');
  if (slash > 0) {
    const group = k.slice(0, slash).trim(), label = k.slice(slash + 1).trim();
    const inGroup = specs.filter((s) => s.group.toLowerCase() === group && s.label.toLowerCase() === label);
    if (inGroup.length === 1) return inGroup[0]!;
  }
  const byLabel = specs.filter((s) => s.label.toLowerCase() === k);
  if (byLabel.length === 1) return byLabel[0]!;
  if (byLabel.length > 1) return `"${key}" is ambiguous: use ${byLabel.map((s) => (s.group ? `"${s.group}/${s.label}"` : `"${s.name}"`)).join(' or ')}`;
  return `"${key}" isn't a parameter of this scene`;
}

// A map of parameter name (or label) → raw value against a scene's specs.
function coerceValues(specs: readonly ParamSpec[], raw: unknown): { values: ParamValues; problems: string[] } {
  const values: ParamValues = {};
  const problems: string[] = [];
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const spec = resolveParam(specs, k);
    if (typeof spec === 'string') { problems.push(spec); continue; }
    const value = coerceParam(spec, v);
    if (value === undefined) { problems.push(`"${k}" needs ${spec.type === 'bool' ? 'true/false' : spec.color ? 'a "#rrggbb" colour' : spec.type === 'float' ? 'a number' : `an array of ${spec.def.length} numbers`}`); continue; }
    values[spec.name] = value;
  }
  return { values, problems };
}

// Look sliders stored with a show scene: only the keys a show scene holds, clamped to their ranges.
function coerceLook(raw: unknown): Record<string, number> {
  const look: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const key = k as LookKey;
    if (!LOOK_KEYS.includes(key) || !Number.isFinite(Number(v))) continue;
    const r = LOOK_RANGES[key];
    look[key] = Math.min(r.max, Math.max(r.min, Number(v)));
  }
  return look;
}

// edit_scene_code's replacements, applied in order to `code`. Each `find` must occur exactly once;
// a miss says where the text nearly matched (by its first line, whitespace aside), so the model can
// correct the edit without reading the whole scene again.
export function applyEdits(code: string, edits: readonly { find: string; replace: string }[]): { code: string } | { error: string } {
  let out = code;
  for (const [n, e] of edits.entries()) {
    const which = edits.length > 1 ? `Edit ${n + 1}` : 'The edit';
    const at = out.indexOf(e.find);
    if (at < 0) return { error: `${which} didn't match the code${nearMiss(out, e.find)}` };
    if (out.indexOf(e.find, at + 1) >= 0) return { error: `${which} matches ${out.split(e.find).length - 1} places; include more of the surrounding code so it matches one.` };
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return { code: out };
}

function nearMiss(code: string, find: string): string {
  const squash = (l: string) => l.replace(/\s+/g, ' ').trim();
  const first = find.split('\n').map(squash).find(Boolean);
  const lines = code.split('\n');
  const hit = first ? lines.findIndex((l) => squash(l).includes(first)) : -1;
  if (hit < 0) return '. Read the scene\'s code again for the exact text.';
  const excerpt = lines.slice(Math.max(0, hit - 1), hit + 3).map((l, k) => `${Math.max(0, hit - 1) + k + 1}: ${l}`).join('\n');
  return ` (its first line is near line ${hit + 1}; check the whitespace and the lines after it):\n${excerpt}`;
}

// Parameter values as the model gets them back after a change: name → value, numbers rounded.
const round = (v: ParamValue): ParamValue => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map((x) => Math.round(x * 1000) / 1000) : v);

// Every scene name, by category, in one string per category. A mark after a name says what a
// reply needs to know about it: * edited by the user, (mine), (visual maker), (custom).
function sceneList(list: readonly Scene[]): Record<string, string> {
  const out: Record<string, string[]> = {};
  for (const x of list) {
    if (x.removed) continue;
    const kind = kindOf(x);
    (out[x.cat || 'Other'] ??= []).push(`${x.name}${x.edited ? '*' : ''}${kind === 'built-in' ? '' : ` (${kind})`}`);
  }
  return Object.fromEntries(Object.entries(out).map(([cat, names]) => [cat, names.join(', ')]));
}

// `studio` is the show the studio tools act on (null where there is none, e.g. in tests).
export function createToolRunner(app: AppPort, undo: Pick<UndoStack, 'push'>, getStudio: () => StudioSession | null = () => null): ToolRunner {
  const scenes = () => app.state.scenes;
  const findScene = (name: unknown): number => (name == null ? app.sceneIndex : app.sceneByName(String(name)));
  const noScene = (name: unknown) => new Error(`There's no scene called "${String(name)}". Call get_app_state for the exact names.`);

  // ---------- The studio ----------
  const studio = (): StudioSession => {
    const s = getStudio();
    if (!s) throw new Error('The studio isn\'t available.');
    return s;
  };
  const findCue = (s: StudioSession, ref: unknown): Cue => {
    const cue = typeof ref === 'string' ? s.cueByRef(ref) : null;
    if (!cue) throw new Error(`There's no show scene "${String(ref)}". Call get_show for the ids and names.`);
    return cue;
  };
  const cueView = (s: StudioSession, c: Cue) => {
    const i = s.sceneIndex(c);
    return { id: c.id, name: c.name, scene: c.scene, category: i >= 0 ? scenes()[i]!.cat || null : null, missing: i < 0, hue: c.look.hue ?? null, values: c.values, look: c.look };
  };
  const showView = (s: StudioSession) => ({
    cues: s.cues.map((c) => cueView(s, c)),
    preview: s.previewId, live: s.liveId,
    transition: { mode: s.mode, seconds: s.seconds },
    autopilot: s.autopilot.unit === 'seconds'
      ? { on: s.autopilot.on, unit: 'seconds', seconds: s.autopilot.seconds, secondsElapsed: Math.round(s.secondsElapsed), bpm: app.hearing.bpm }
      : { on: s.autopilot.on, unit: 'beats', beats: s.autopilot.beats, beatsElapsed: s.beatsElapsed, beatsToGo: Math.max(0, s.beatsTarget - s.beatsElapsed), bpm: app.hearing.bpm },
    plan: s.plan, planStep: s.plan ? s.planIndex : null,
    studioOpen: s.isOpen, livePinned: s.isPinned,
    userTouched: s.userTouched,
  });
  // Every change a tool makes is one undo step, under one rule: the undo puts back what the change
  // touched only while that is still what the change left. If anything changed it since, the undo
  // refuses (UndoConflict) rather than silently undo that too; if it is already as it was, there is
  // nothing to do.
  const record = <S>(label: string, touched: Touched<S>, before: S): void => {
    const was = JSON.stringify(before), left = JSON.stringify(touched.read());
    undo.push({ label, undo: () => {
      const now = JSON.stringify(touched.read());
      if (now === was) return;
      if (now !== left) throw new UndoConflict(label);
      touched.write(before);
    } });
  };
  // Runs `change` and records it; a change that throws leaves nothing to undo.
  const undoable = <S, T>(label: string, touched: Touched<S>, change: () => T): T => {
    const before = touched.read();
    const result = change();
    record(label, touched, before);
    return result;
  };

  // What the tools touch.
  const show = (s: StudioSession): Touched<ShowSnapshot> => ({ read: () => s.snapshot(), write: (b) => s.restore(b) });
  const transition = (s: StudioSession): Touched<{ mode: 'cut' | 'fade'; seconds: number }> => ({
    read: () => ({ mode: s.mode, seconds: s.seconds }),
    write: (b) => { s.setMode(b.mode); s.setSeconds(b.seconds); },
  });
  const autopilot = (s: StudioSession): Touched<StudioSession['autopilot']> => ({
    read: () => ({ ...s.autopilot }),
    write: (b) => { s.setAutoBeats(b.beats); s.setAutoSeconds(b.seconds); s.setAutoUnit(b.unit); s.setAutopilot(b.on); },
  });
  // A plan comes with the autopilot switched on: one step, so undoing it switches it back off.
  const planning = (s: StudioSession): Touched<{ show: ShowSnapshot; on: boolean }> => ({
    read: () => ({ show: s.snapshot(), on: s.autopilot.on }),
    write: (b) => { s.restore(b.show); if (s.autopilot.on !== b.on) s.setAutopilot(b.on); },
  });
  const code = (i: number): Touched<string> => ({
    read: () => app.editor.target(i).body,
    write: (b) => { void app.editor.compileInto(app.editor.target(i), b); app.setScene(i); },
  });
  const params = (i: number, specs: readonly ParamSpec[]): Touched<ParamValues> => ({
    read: () => { const v = app.library.values(i); return Object.fromEntries(specs.map((s) => [s.name, structuredClone(v[s.name]!)])); },
    write: (b) => app.library.setValues(i, b),
  });
  const look = (keys: readonly LookKey[]): Touched<Partial<Record<LookKey, number>>> => ({
    read: () => Object.fromEntries(keys.map((k) => [k, app.state.look[k]])),
    write: (b) => { for (const k of keys) app.setLook(k, b[k]!); },
  });

  const paramSummary = (i: number) => {
    const specs = app.library.specs(i);
    const values = app.library.values(i);
    return specs.map((s) => ({ name: s.name, label: s.label, ...(s.group && { group: s.group }), type: s.color ? `${s.type} colour` : s.type, ...(s.type !== 'bool' && { min: s.min, max: s.max }), value: values[s.name] }));
  };
  // After a code change the model wrote the @param lines itself: their values are all it needs back.
  const valuesOf = (i: number) => Object.fromEntries(Object.entries(app.library.values(i)).map(([k, v]) => [k, round(v)]));

  // Compiles new code into a scene the model may edit, with one undo step. Shared by write and edit.
  const editable = (scene: unknown) => {
    const i = findScene(scene);
    if (i < 0) throw noScene(scene);
    const t = app.editor.target(i);
    if (t.kind === 'nodes') throw new Error('This scene is generated by the visual maker and is read-only. Use create_scene to make an editable copy.');
    return { i, t };
  };
  const compile = async ({ i, t }: ReturnType<typeof editable>, source: string, lines: string) => {
    const before = t.body;
    app.setScene(i);
    const error = await app.editor.compileInto(t, source);
    if (error === SUPERSEDED) throw new Error('Another edit to this scene replaced your code before it compiled. Read the scene\'s code again before changing it.');
    if (error) throw new Error(`It didn't compile; the previous version is still running. Errors (line numbers count from ${lines}):\n${error}`);
    record(`Edited ${t.name}`, code(i), before);
    return { compiled: true, scene: t.name, nowPlaying: true, parameters: valuesOf(i) };
  };

  const lookAt = async (i: number, times: number[]): Promise<string[]> => {
    const out: string[] = [];
    for (const t of times) {
      const uniforms = stillUniforms({ uTime: t, uHue: app.state.look.hue + app.state.clock.huePhase, uBright: app.hearing.bright, uMood: app.hearing.mood });
      const img = await app.renderer.snapshotAsync(i, uniforms, 512, 288);
      out.push(await blobToBase64(await encodeJpeg(img, 0.82)));
    }
    return out;
  };

  const tools: Implementations = {
    get_app_state() {
      const i = app.sceneIndex, s = app.currentScene;
      return {
        playing: { name: s.name, kind: kindOf(s), category: s.cat || null, editedByUser: !!s.edited, parameters: paramSummary(i) },
        look: Object.fromEntries([...LOOK_KEYS, 'synesthesia'].map((k) => [k, app.state.look[k as LookKey]])),
        audio: soundNow(app.hearing, app.music.playing, app.state.activeSource),
        media: app.media.el ? { name: app.media.name, kind: app.media.kind } : null,
        codeEditorOpen: app.overlay === 'editor',
        scenes: sceneList(scenes()),
      };
    },

    read_scene_code({ scene }) {
      const i = findScene(scene);
      if (i < 0) throw noScene(scene);
      const t = app.editor.target(i);
      const note = t.kind === 'nodes' ? 'Generated by the visual maker: read-only. Use create_scene to make an editable copy.' : t.kind === 'builtin' ? 'Built-in scene: edits are kept as the user\'s version and can be reverted.' : '';
      return `Scene "${t.name}" (${kindOf(scenes()[i]!)}). ${note}\n\n${t.body}`;
    },

    write_scene_code({ scene, code }) {
      return compile(editable(scene), String(code), 'the first line of your code');
    },

    edit_scene_code({ scene, edits }) {
      const target = editable(scene);
      const out = applyEdits(target.t.body, edits);
      if ('error' in out) throw new Error(`${out.error}\nNothing was changed.`);
      return compile(target, out.code, 'the first line of the scene\'s code');
    },

    create_scene({ name, code }) {
      const n = String(name).trim().slice(0, 60);
      const out = app.library.add(n, String(code));
      if ('error' in out) throw new Error(out.error.includes('exists') ? `${out.error} Pick another name, or edit it with write_scene_code.` : `It didn't compile, so nothing was created:\n${out.error}`);
      app.setScene(out.index);
      // Undo removes it again, unless the user has edited it since. (Deleted already: nothing to do.)
      const created: Touched<string | null> = {
        read: () => { const x = scenes()[out.index]; return x && !x.removed ? x.body : null; },
        write: () => app.library.remove(out.index),
      };
      record(`Created "${n}"`, created, null);
      return { created: true, scene: n, nowPlaying: true, parameters: valuesOf(out.index) };
    },

    set_parameters({ values }) {
      const i = app.sceneIndex;
      const specs = app.library.specs(i);
      const { values: applied, problems } = coerceValues(specs, values);
      const set = specs.filter((s) => s.name in applied);
      if (!set.length) throw new Error(problems.join('; ') || 'Nothing to set.');
      const touched = params(i, set);
      undoable(`Set ${set.length} parameter${set.length > 1 ? 's' : ''}`, touched, () => touched.write(applied));
      return { applied, ...(problems.length && { problems }) };
    },

    set_look(values) {
      const keys = Object.entries(values).filter(([k, v]) => k in LOOK_RANGES && Number.isFinite(v)).map(([k]) => k as LookKey);
      if (!keys.length) throw new Error('No look values given.');
      undoable('Adjusted the look', look(keys), () => { for (const k of keys) app.setLook(k, Number(values[k as keyof typeof values])); });
      return { applied: look(keys).read() };
    },

    switch_scene({ scene }) {
      const i = findScene(scene);
      if (i < 0) throw noScene(scene);
      app.setScene(i);
      return { nowPlaying: scenes()[i]!.name, kind: kindOf(scenes()[i]!), parameters: paramSummary(i) };
    },

    async look_at_scene({ scene, times }) {
      const i = findScene(scene);
      if (i < 0) throw noScene(scene);
      const list = Array.isArray(times) && times.length ? times : [14];
      const ts = list.slice(0, 3).map(Number).filter(Number.isFinite);
      const images = await lookAt(i, ts.length ? ts : [14]);
      const parts: ContentParts = [
        ...images.map((data) => ({ type: 'image' as const, source: { type: 'data' as const, value: data, mimeType: 'image/jpeg' } })),
        { type: 'text', content: `"${scenes()[i]!.name}" at t = ${ts.join(', ')} s, with stand-in audio. On screen it also gets the trails' afterglow and colour grading.` },
      ];
      return parts;
    },

    // ---------- The studio ----------

    get_show() { return showView(studio()); },

    add_show_scene({ scene, name, values, look }) {
      const s = studio();
      const i = app.sceneByName(String(scene));
      if (i < 0) throw noScene(scene);
      if (scenes()[i]!.kind) throw new Error(`"${String(scene)}" can't be a show scene (only visual scenes can).`);
      const coerced = coerceValues(app.library.specs(i), values);
      const cue = undoable(`Added "${String(name ?? scene)}" to the show`, show(s), () =>
        s.add({ name: String(name ?? scene).trim().slice(0, 60) || String(scene), scene: String(scene), values: coerced.values, look: coerceLook(look) }));
      return { added: cueView(s, cue), ...(coerced.problems.length && { problems: coerced.problems }), showScenes: s.cues.length };
    },

    update_show_scene({ cue: ref, name, scene, values, look }) {
      const s = studio();
      const cue = findCue(s, ref);
      const patch: Partial<Omit<Cue, 'id'>> = {};
      if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 60);
      let sceneIndex = s.sceneIndex(cue);
      if (typeof scene === 'string') {
        sceneIndex = app.sceneByName(scene);
        if (sceneIndex < 0) throw noScene(scene);
        if (scenes()[sceneIndex]!.kind) throw new Error(`"${scene}" can't be a show scene (only visual scenes can).`);
        patch.scene = scene;
        if (scene !== cue.scene) patch.values = {};   // another scene has other parameters
      }
      let problems: string[] = [];
      if (values !== undefined) {
        const coerced = coerceValues(app.library.specs(sceneIndex), values);
        problems = coerced.problems;
        patch.values = { ...(patch.values ?? cue.values), ...coerced.values };
      }
      if (look !== undefined) patch.look = { ...cue.look, ...coerceLook(look) };
      if (!Object.keys(patch).length) throw new Error(problems.join('; ') || 'Nothing to change.');
      const next = undoable(`Changed "${cue.name}"`, show(s), () => s.updateCue(cue, patch));
      return { updated: cueView(s, next), ...(problems.length && { problems }), note: s.liveId === cue.id ? 'This show scene is Live; the change shows at its next take.' : undefined };
    },

    reorder_show({ order }) {
      const s = studio();
      if (!Array.isArray(order)) throw new Error('Give the show scene ids as an array.');
      undoable('Reordered the show', show(s), () => s.reorder(order.map(String)));
      return { order: s.cues.map((c) => ({ id: c.id, name: c.name })) };
    },

    remove_show_scene({ cue: ref }) {
      const s = studio();
      const cue = findCue(s, ref);
      undoable(`Removed "${cue.name}" from the show`, show(s), () => s.removeCue(cue));
      return { removed: cue.name, showScenes: s.cues.length };
    },

    set_transition({ mode, seconds }) {
      const s = studio();
      undoable('Changed the transition', transition(s), () => {
        if (mode === 'cut' || mode === 'fade') s.setMode(mode);
        if (typeof seconds === 'number' && Number.isFinite(seconds)) s.setSeconds(Math.min(8, Math.max(0.2, seconds)));
      });
      return { transition: { mode: s.mode, seconds: s.seconds } };
    },

    set_autopilot({ on, unit, beats, seconds }) {
      const s = studio();
      undoable('Changed the autopilot', autopilot(s), () => {
        if (typeof beats === 'number' && [16, 32, 64, 128].includes(beats)) s.setAutoBeats(beats);
        if (typeof seconds === 'number' && Number.isFinite(seconds)) s.setAutoSeconds(seconds);
        if (unit === 'beats' || unit === 'seconds') s.setAutoUnit(unit);
        else if (typeof seconds === 'number' && typeof beats !== 'number' && s.autopilot.unit !== 'seconds') s.setAutoUnit('seconds');   // asking for seconds means the timer
        if (typeof on === 'boolean') s.setAutopilot(on);
      });
      const warn = s.autopilot.on && s.cues.length < 2 ? 'The autopilot needs at least two show scenes.' : s.autopilot.on && s.autopilot.unit === 'beats' && !app.music.playing ? 'Nothing is playing yet; the autopilot starts with the music.' : undefined;
      return { autopilot: showView(s).autopilot, ...(warn && { note: warn }) };
    },

    set_autopilot_plan({ plan: raw }) {
      const s = studio();
      if (raw === null || raw === undefined) {
        undoable('Dropped the plan', show(s), () => s.setPlan(null));
        return { plan: null, autopilot: showView(s).autopilot };
      }
      const parsed = PlanSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`The plan doesn't fit: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const unknown = parsed.data.steps.map((st) => st.cue).filter((ref) => !s.cueByRef(ref));
      if (unknown.length === parsed.data.steps.length) throw new Error(`None of the plan's show scenes exist: ${unknown.join(', ')}. Call get_show for the ids.`);
      // Store ids, so renames don't break the plan.
      const plan = { ...parsed.data, steps: parsed.data.steps.map((st) => ({ ...st, cue: s.cueByRef(st.cue)?.id ?? st.cue })) };
      undoable(`Planned ${parsed.data.steps.length} steps`, planning(s), () => {
        s.setPlan(plan);
        if (!s.autopilot.on) s.setAutopilot(true);
      });
      const v = showView(s);
      return { plan: v.plan, planStep: v.planStep, autopilot: v.autopilot, ...(unknown.length && { problems: unknown.map((ref) => `"${ref}" isn't a show scene; that step is skipped`) }) };
    },

    take_show_scene({ cue: ref }) {
      const s = studio();
      const cue = ref === undefined ? s.preview : findCue(s, ref);
      if (!cue) throw new Error('There is nothing in Preview; name a show scene or add one first.');
      if (s.sceneIndex(cue) < 0) throw new Error(`"${cue.name}" uses a scene that no longer exists.`);
      s.take(cue, 'tool');
      return { live: cue.name, preview: s.preview?.name ?? null };
    },
  };

  return async (name, input) => {
    const definition = DEFINITIONS.get(name);
    if (!definition) throw new Error(`Unknown tool "${name}".`);
    const parsed = (definition.inputSchema as z.ZodType).safeParse(input ?? {});
    if (!parsed.success) throw new Error(`The input doesn't fit ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
    const tool = tools[name as ToolName] as (input: unknown) => Promise<unknown> | unknown;
    try {
      return await tool(parsed.data);
    } catch (err) {
      throw err instanceof Error ? err : new Error(`The app hit an error: ${String(err)}`);
    }
  };
}

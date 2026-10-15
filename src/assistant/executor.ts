// The assistant's tools, implemented against the app. Each returns its result (which goes back to
// the model) and may register an undo. Errors are thrown: TanStack turns them into error tool results.

import type { AppController } from '../app/controller';
import type { Cue, StudioSession } from '../app/studio';
import { blobToBase64, encodeJpeg } from '../engine/jpeg';
import type { ParamSpec, ParamValue, ParamValues } from '../engine/params';
import type { SnapshotUniforms } from '../engine/renderer';
import type { Scene } from '../engine/scenes';
import { LOOK_KEYS, LOOK_RANGES, type LookKey } from '../state/app-state';
import { paramKey } from '../state/scene-list';
import { PlanSchema } from '../state/show-plan';
import type { UndoStack } from './undo';
import type { ContentParts } from './tools';

export interface AssistantContext { run: ToolRunner }
export type ToolRunner = (name: string, input: Record<string, unknown>) => Promise<unknown>;

const kindOf = (s: Scene) => (s.kind === 'game' ? 'game' : s.kind === 'custom' ? 'custom' : s.kind === 'nodes' ? 'visual maker' : s.user ? 'mine' : 'built-in');

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

// A map of parameter name (or label) → raw value against a scene's specs.
function coerceValues(specs: ParamSpec[], raw: unknown): { values: ParamValues; problems: string[] } {
  const values: ParamValues = {};
  const problems: string[] = [];
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const spec = specs.find((s) => s.name === k) ?? specs.find((s) => s.label.toLowerCase() === k.toLowerCase());
    if (!spec) { problems.push(`"${k}" isn't a parameter of this scene`); continue; }
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

export function createToolRunner(app: AppController, undo: Pick<UndoStack, 'push'>): ToolRunner {
  const scenes = () => app.state.scenes;
  const findScene = (name: unknown): number => (name == null ? app.sceneIndex : app.sceneByName(String(name)));
  const noScene = (name: unknown) => new Error(`There's no scene called "${String(name)}". Call get_app_state for the exact names.`);

  // ---------- The studio ----------
  const studio = (): StudioSession => {
    const s = app.studio();
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
      ? { on: s.autopilot.on, unit: 'seconds', seconds: s.autopilot.seconds, secondsElapsed: Math.round(s.secondsElapsed), bpm: app.tempo.bpm }
      : { on: s.autopilot.on, unit: 'beats', beats: s.autopilot.beats, beatsElapsed: s.beatsElapsed, beatsToGo: Math.max(0, s.beatsTarget - s.beatsElapsed), bpm: app.tempo.bpm },
    plan: s.plan, planStep: s.plan ? s.planIndex : null,
    studioOpen: s.isOpen, livePinned: s.isPinned,
    userTouched: s.userTouched,
  });
  // Every show change is one undo step: the show as it was before.
  const undoable = (s: StudioSession, label: string) => {
    const before = s.snapshot();
    undo.push({ label, undo: () => s.restore(before) });
  };

  const paramSummary = (i: number) => {
    const specs = app.sceneParams[i] ?? [];
    const values = app.paramValues(i);
    return specs.map((s) => ({ name: s.name, label: s.label, type: s.color ? `${s.type} colour` : s.type, ...(s.type !== 'bool' && { min: s.min, max: s.max }), value: values[s.name] }));
  };

  const lookAt = async (i: number, times: number[]): Promise<string[]> => {
    const out: string[] = [];
    for (const t of times) {
      const uniforms: SnapshotUniforms = { uTime: t, uBass: 0.5, uMid: 0.5, uHigh: 0.5, uLevel: 0.6, uBeat: 0.4, uHue: app.state.look.hue + app.state.clock.huePhase, uBright: app.audio.features.bright, uMood: app.state.clock.mood };
      const img = await app.renderer.snapshotAsync(i, uniforms, 512, 288);
      out.push(await blobToBase64(await encodeJpeg(img, 0.82)));
    }
    return out;
  };

  const tools: Record<string, (input: Record<string, unknown>) => Promise<unknown> | unknown> = {
    get_app_state() {
      const i = app.sceneIndex, s = app.currentScene;
      const c = app.state.clock;
      const bright = app.audio.features.bright;
      return {
        playing: { name: s.name, kind: kindOf(s), category: s.cat || null, editedByUser: !!s.edited, parameters: paramSummary(i) },
        look: Object.fromEntries([...LOOK_KEYS, 'synesthesia'].map((k) => [k, app.state.look[k as LookKey]])),
        audio: {
          source: app.state.activeSource ?? app.audio.kind ?? 'none',
          bpm: c.bpm,
          mood: !app.audio.kind ? null : c.mood < 0.35 ? 'calm' : c.mood > 0.65 ? 'energetic' : 'groovy',
          tone: app.audio.kind ? (bright < 0.35 ? 'dark' : bright > 0.65 ? 'bright' : 'balanced') : null,
        },
        media: app.media.el ? { name: app.media.name, kind: app.media.kind } : null,
        codeEditorOpen: app.overlay === 'editor',
        scenes: scenes().filter((x) => !x.removed).map((x) => ({ name: x.name, category: x.cat || null, kind: kindOf(x), parameters: x.params?.length ?? 0, ...(x.edited && { editedByUser: true }) })),
      };
    },

    read_scene_code({ scene }) {
      const i = findScene(scene);
      if (i < 0) throw noScene(scene);
      const t = app.editor.target(i);
      const note = t.kind === 'nodes' ? 'Generated by the visual maker: read-only. Use create_scene to make an editable copy.' : t.kind === 'builtin' ? 'Built-in scene: edits are kept as the user\'s version and can be reverted.' : '';
      return `Scene "${t.name}" (${kindOf(scenes()[i]!)}). ${note}\n\n${t.body}`;
    },

    async write_scene_code({ scene, code }) {
      const i = findScene(scene);
      if (i < 0) throw noScene(scene);
      const t = app.editor.target(i);
      if (t.kind === 'nodes') throw new Error('This scene is generated by the visual maker and is read-only. Use create_scene to make an editable copy.');
      if (scenes()[i]!.kind === 'game') throw new Error('Beat Racer is a game; its shader is tied to the game code. Create a new scene instead.');
      const before = t.body;
      app.setScene(i);
      const error = await app.editor.compileInto(t, String(code));
      if (error) throw new Error(`It didn't compile; the previous version is still running. Errors (line numbers count from the first line of your code):\n${error}`);
      undo.push({ label: `Edited ${t.name}`, undo: () => { void app.editor.compileInto(app.editor.target(i), before); app.setScene(i); } });
      return { compiled: true, scene: t.name, nowPlaying: true, parameters: paramSummary(i) };
    },

    create_scene({ name, code }) {
      const n = String(name).trim().slice(0, 60);
      const out = app.addUserScene(n, String(code));
      if ('error' in out) throw new Error(out.error.includes('exists') ? `${out.error} Pick another name, or edit it with write_scene_code.` : `It didn't compile, so nothing was created:\n${out.error}`);
      app.setScene(out.index);
      undo.push({ label: `Created "${n}"`, undo: () => app.removeUserScene(out.index) });
      return { created: true, scene: n, nowPlaying: true, parameters: paramSummary(out.index) };
    },

    set_parameters({ values }) {
      const i = app.sceneIndex;
      const specs = app.sceneParams[i] ?? [];
      const key = paramKey(app.currentScene);
      const before = app.paramValues(i);
      const applied: Record<string, ParamValue> = {};
      const problems: string[] = [];
      for (const [k, raw] of Object.entries((values ?? {}) as Record<string, unknown>)) {
        const spec = specs.find((s) => s.name === k) ?? specs.find((s) => s.label.toLowerCase() === k.toLowerCase());
        if (!spec) { problems.push(`"${k}" isn't a parameter of this scene`); continue; }
        const value = coerceParam(spec, raw);
        if (value === undefined) { problems.push(`"${k}" needs ${spec.type === 'bool' ? 'true/false' : spec.color ? 'a "#rrggbb" colour' : spec.type === 'float' ? 'a number' : `an array of ${spec.def.length} numbers`}`); continue; }
        app.paramStore.set(key, spec, value);
        applied[spec.name] = value;
      }
      app.pushParams(i);
      app.showParams();
      const count = Object.keys(applied).length;
      if (!count) throw new Error(problems.join('; ') || 'Nothing to set.');
      undo.push({ label: `Set ${count} parameter${count > 1 ? 's' : ''}`, undo: () => { specs.forEach((s) => app.paramStore.set(key, s, before[s.name]!)); app.pushParams(i); app.showParams(); } });
      return { applied, ...(problems.length && { problems }), parameters: paramSummary(i) };
    },

    set_look(values) {
      const before: Partial<Record<LookKey, number>> = {};
      const applied: Partial<Record<LookKey, number>> = {};
      for (const [k, v] of Object.entries(values)) {
        if (!(k in LOOK_RANGES) || !Number.isFinite(v)) continue;
        const key = k as LookKey;
        before[key] = app.state.look[key];
        app.setLook(key, Number(v));
        applied[key] = app.state.look[key];
      }
      if (!Object.keys(applied).length) throw new Error('No look values given.');
      undo.push({ label: 'Adjusted the look', undo: () => { for (const [k, v] of Object.entries(before)) app.setLook(k as LookKey, v!); } });
      return { applied };
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
        { type: 'text', content: `"${scenes()[i]!.name}" at t = ${ts.join(', ')} s, with stand-in audio. On screen it also gets motion trails and colour grading.` },
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
      const coerced = coerceValues(app.sceneParams[i] ?? [], values);
      undoable(s, `Added "${String(name ?? scene)}" to the show`);
      const cue = s.add({ name: String(name ?? scene).trim().slice(0, 60) || String(scene), scene: String(scene), values: coerced.values, look: coerceLook(look) });
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
        const coerced = coerceValues(sceneIndex >= 0 ? app.sceneParams[sceneIndex] ?? [] : [], values);
        problems = coerced.problems;
        patch.values = { ...(patch.values ?? cue.values), ...coerced.values };
      }
      if (look !== undefined) patch.look = { ...cue.look, ...coerceLook(look) };
      if (!Object.keys(patch).length) throw new Error(problems.join('; ') || 'Nothing to change.');
      undoable(s, `Changed "${cue.name}"`);
      const next = s.updateCue(cue, patch);
      return { updated: cueView(s, next), ...(problems.length && { problems }), note: s.liveId === cue.id ? 'This show scene is Live; the change shows at its next take.' : undefined };
    },

    reorder_show({ order }) {
      const s = studio();
      if (!Array.isArray(order)) throw new Error('Give the show scene ids as an array.');
      undoable(s, 'Reordered the show');
      s.reorder(order.map(String));
      return { order: s.cues.map((c) => ({ id: c.id, name: c.name })) };
    },

    remove_show_scene({ cue: ref }) {
      const s = studio();
      const cue = findCue(s, ref);
      undoable(s, `Removed "${cue.name}" from the show`);
      s.removeCue(cue);
      return { removed: cue.name, showScenes: s.cues.length };
    },

    set_transition({ mode, seconds }) {
      const s = studio();
      const before = { mode: s.mode, seconds: s.seconds };
      if (mode === 'cut' || mode === 'fade') s.setMode(mode);
      if (typeof seconds === 'number' && Number.isFinite(seconds)) s.setSeconds(Math.min(8, Math.max(0.2, seconds)));
      undo.push({ label: 'Changed the transition', undo: () => { s.setMode(before.mode); s.setSeconds(before.seconds); } });
      return { transition: { mode: s.mode, seconds: s.seconds } };
    },

    set_autopilot({ on, unit, beats, seconds }) {
      const s = studio();
      const before = { ...s.autopilot };
      if (typeof beats === 'number' && [16, 32, 64, 128].includes(beats)) s.setAutoBeats(beats);
      if (typeof seconds === 'number' && Number.isFinite(seconds)) s.setAutoSeconds(seconds);
      if (unit === 'beats' || unit === 'seconds') s.setAutoUnit(unit);
      else if (typeof seconds === 'number' && typeof beats !== 'number' && s.autopilot.unit !== 'seconds') s.setAutoUnit('seconds');   // asking for seconds means the timer
      if (typeof on === 'boolean') s.setAutopilot(on);
      undo.push({ label: 'Changed the autopilot', undo: () => { s.setAutoBeats(before.beats); s.setAutoSeconds(before.seconds); s.setAutoUnit(before.unit); s.setAutopilot(before.on); } });
      const warn = s.autopilot.on && s.cues.length < 2 ? 'The autopilot needs at least two show scenes.' : s.autopilot.on && s.autopilot.unit === 'beats' && !app.audio.kind ? 'Nothing is playing yet; the autopilot starts with the music.' : undefined;
      return { autopilot: showView(s).autopilot, ...(warn && { note: warn }) };
    },

    set_autopilot_plan({ plan: raw }) {
      const s = studio();
      if (raw === null || raw === undefined) {
        undoable(s, 'Dropped the plan');
        s.setPlan(null);
        return { plan: null, autopilot: showView(s).autopilot };
      }
      const parsed = PlanSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`The plan doesn't fit: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const unknown = parsed.data.steps.map((st) => st.cue).filter((ref) => !s.cueByRef(ref));
      if (unknown.length === parsed.data.steps.length) throw new Error(`None of the plan's show scenes exist: ${unknown.join(', ')}. Call get_show for the ids.`);
      undoable(s, `Planned ${parsed.data.steps.length} steps`);
      // Store ids, so renames don't break the plan.
      const plan = { ...parsed.data, steps: parsed.data.steps.map((st) => ({ ...st, cue: s.cueByRef(st.cue)?.id ?? st.cue })) };
      s.setPlan(plan);
      if (!s.autopilot.on) s.setAutopilot(true);
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
    const tool = tools[name];
    if (!tool) throw new Error(`Unknown tool "${name}".`);
    try {
      return await tool(input ?? {});
    } catch (err) {
      throw err instanceof Error ? err : new Error(`The app hit an error: ${String(err)}`);
    }
  };
}

import './style.css';
import { SCENES, COMMON, TEMPLATE } from './scenes.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { BeatRacer } from './game.js';
import { ShaderEditor, formatError } from './editor.js';
import { Assistant } from './assistant.js';
import { NodeEditor } from './node-editor.js';
import { RemotePicker, progressText } from './remote-picker.js';
import { SceneLibrary, loadUserScenes, saveUserScenes } from './library.js';
import { Player } from './player.js';
import { parseParams, ParamStore, toUniform } from './params.js';
import { ParamPanel } from './param-panel.js';
import { OutputLink } from './output-link.js';
import { Studio } from './studio.js';
import { MediaLayer, isMediaFile } from './media.js';

const $ = (id) => document.getElementById(id);
const BEATS_PER_SCENE = 32;
const MAX_SECONDS_PER_SCENE = 45;
const CROSSFADE_SECONDS = 1.5;

const ALL_SCENES = [
  ...SCENES,
  { name: 'My Shader', kind: 'custom', frag: COMMON + TEMPLATE },
  { name: 'Node Scene', kind: 'nodes', frag: COMMON + TEMPLATE },
];
const GAME_INDEX = ALL_SCENES.findIndex((s) => s.kind === 'game');
const CUSTOM_INDEX = ALL_SCENES.findIndex((s) => s.kind === 'custom');
const NODES_INDEX = ALL_SCENES.findIndex((s) => s.kind === 'nodes');
const KEYED_SCENES = ALL_SCENES.map((s, i) => (s.kind ? -1 : i)).filter((i) => i >= 0).slice(0, 10);   // keys 1–0

const audio = new AudioEngine();
const player = $('player');
let renderer;

try {
  renderer = new Renderer($('gl'), ALL_SCENES);
} catch (err) {
  document.body.innerHTML = `<pre style="padding:24px;color:#f88;white-space:pre-wrap">${err.message}</pre>`;
  throw err;
}

// The dropped image / video, sampled by scenes through media(p).
const media = new MediaLayer();
renderer.setMedia(media);

// Projector windows (output.html) mirror Program; see output-link.js.
const output = new OutputLink({ scenes: ALL_SCENES, onStatus: (outputs) => studio.showOutputs(outputs) });

// Your saved scenes from the library are compiled after the built-ins, so a broken one can't stop the app.
const userScenes = loadUserScenes();
const userSceneErrors = [];
for (const { name, body } of userScenes) {
  const scene = userScene(name, body);
  if (renderer.check(scene.frag, name)) userSceneErrors.push(name);
  else ALL_SCENES.push(scene);
}
function userScene(name, body) {
  const { code, params } = parseParams(body);
  return { name, body, frag: COMMON + code, params, cat: 'Mine', desc: 'Your shader', user: true };
}

// Your edits to built-in scenes (made in the code editor) replace their code; Revert restores `original`.
const SCENE_EDITS_KEY = 'hallucinate.sceneEdits';
let sceneEdits = {};
try { sceneEdits = JSON.parse(localStorage.getItem(SCENE_EDITS_KEY)) ?? {}; } catch { /* storage unavailable */ }
for (const s of SCENES) s.original = s.body;
for (const [name, body] of Object.entries(sceneEdits)) {
  const s = SCENES.find((x) => x.name === name);
  if (!s) continue;
  const { code, params } = parseParams(body);
  if (renderer.check(COMMON + code, name)) { userSceneErrors.push(`${name} (your edit)`); continue; }
  Object.assign(s, { body, frag: COMMON + code, params, edited: true });
}

function saveSceneEdit(s) {
  s.edited = s.body.trim() !== s.original.trim();
  if (s.edited) sceneEdits[s.name] = s.body;
  else delete sceneEdits[s.name];
  try { localStorage.setItem(SCENE_EDITS_KEY, JSON.stringify(sceneEdits)); } catch { /* storage unavailable */ }
}

const params = {
  reactivity: 1, speed: 1, trails: 0.86, hue: 0, cycle: 0.6, aberration: 0.012, resolution: 0.75,
  synesthesia: 0.7, mood: true, auto: true, spin: 1,
};

const state = {
  clock: 0, time: 0, timeRate: 1, huePhase: 0, mood: 0.5,
  scene: 0, prevScene: -1, transitionStart: -10, sceneStart: 0, fade: CROSSFADE_SECONDS,
  beatsInScene: 0, beatTimes: [],
};

// ---------- UI ----------

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const SCENE_KEYS = { game: 'G', custom: 'E', nodes: 'N' };
function keyFor(i) {
  const n = KEYED_SCENES.indexOf(i);
  return SCENE_KEYS[ALL_SCENES[i].kind] ?? (n >= 0 ? String((n + 1) % 10) : '');
}

function showSceneName() {
  const key = keyFor(state.scene);
  $('scene-name').textContent = `${key ? `${key} · ` : ''}${ALL_SCENES[state.scene].name}`;
}

// ← / → step through every scene, skipping deleted ones.
function stepScene(dir) {
  let i = state.scene;
  do i = (i + dir + ALL_SCENES.length) % ALL_SCENES.length; while (ALL_SCENES[i].removed);
  setScene(i);
}

// `fade` is the crossfade time (0 = cut). Changing scene outside the studio means Program no
// longer shows a show scene.
function setScene(i, fade = CROSSFADE_SECONDS, fromStudio = false) {
  if (!fromStudio && studio.programId) { studio.programId = null; studio.render(); }
  if (i === state.scene || !ALL_SCENES[i] || ALL_SCENES[i].removed) return;
  state.fade = fade;
  if (i === GAME_INDEX) { game.reset(); toast('Beat Racer: walls drop on the beat. ← → to steer, Enter to restart', 4500); }
  $('hud').hidden = i !== GAME_INDEX;
  state.prevScene = state.scene;
  state.scene = i;
  state.transitionStart = state.clock;
  state.sceneStart = state.clock;
  state.beatsInScene = 0;
  showSceneName();
  showParams();
  library.setCurrent(i);
  if (editor.isOpen) editor.retarget(editorTarget(i));   // the code editor follows the scene on screen
}

function nextRandomScene() {
  const choices = library.rotation().filter((i) => i !== state.scene);
  if (choices.length) setScene(choices[Math.floor(Math.random() * choices.length)]);
}

// Auto-switch only cycles the visual scenes; it never leaves the game or your own shader.
// It also holds still while you're editing the scene's code.
const autoSwitching = () => params.auto && !studio.autopilot.on && !editor.isOpen && !ALL_SCENES[state.scene].kind;

// ---------- Live parameters ----------
// `// @param` uniforms in a scene's code (or Slider / Colour picker blocks in the visual maker)
// show up as controls in the Parameters overlay. Values are pushed as uniforms every frame.

const paramStore = new ParamStore();
const sceneParams = [];
const paramKey = (i) => {
  const s = ALL_SCENES[i];
  return s.kind === 'custom' || s.kind === 'nodes' ? s.kind : `${s.user ? 'user' : 'scene'}:${s.name}`;
};

function setSceneParams(i, specs) {
  sceneParams[i] = specs;
  pushParams(i);
  output.sendScene(i);   // code edits reach the projector live
  if (i === state.scene) showParams();
}

function pushParams(i) {
  const specs = sceneParams[i] ?? [];
  const values = paramStore.values(paramKey(i), specs);
  renderer.setParams(i, Object.fromEntries(specs.map((s) => [s.name, toUniform(s, values[s.name])])));
}

// In the studio the Parameters dock edits the selected (Preview) show scene by default, like OBS's
// Studio Mode; its Program tab edits what's live. Kept up to date by the studio (see onDockChange).
const dock = { open: false, tab: 'preview', cue: null };
const editingPreview = () => dock.open && dock.tab === 'preview';

function showParams() {
  if (editingPreview()) {
    const cue = dock.cue;
    const i = cue ? ALL_SCENES.findIndex((s) => s.name === cue.scene && !s.removed) : -1;
    const specs = i >= 0 ? sceneParams[i] ?? [] : [];
    return paramPanel.show(cue ? `${cue.name} — preview` : 'Preview', specs, Object.fromEntries(specs.map((s) => [s.name, cue.values[s.name] ?? s.def])));
  }
  const i = state.scene;
  const specs = sceneParams[i] ?? [];
  paramPanel.show(dock.open ? `${ALL_SCENES[i].name} — live` : ALL_SCENES[i].name, specs, paramStore.values(paramKey(i), specs));
}

const paramPanel = new ParamPanel({
  onChange: (spec, value) => {
    if (editingPreview()) {   // stored in the show scene; the Preview monitor shows it at once, Take sends it live
      if (!dock.cue) return;
      dock.cue.values = { ...dock.cue.values, [spec.name]: value };
      return studio.save();
    }
    paramStore.set(paramKey(state.scene), spec, value);
    pushParams(state.scene);
  },
  onReset: () => {
    if (editingPreview()) {
      if (dock.cue) { dock.cue.values = {}; studio.save(); }
      return showParams();
    }
    paramStore.reset(paramKey(state.scene));
    pushParams(state.scene);
    showParams();
  },
});
ALL_SCENES.forEach((s, i) => setSceneParams(i, s.params ?? []));

// ---------- Game & editor ----------

const game = new BeatRacer({
  score: $('hud-score'), combo: $('hud-combo'), lives: $('hud-lives'), best: $('hud-best'), over: $('hud-over'),
});

// What the code editor shows for scene i: always the scene on screen, edited in place.
function editorTarget(i) {
  const s = ALL_SCENES[i];
  const kind = s.kind === 'custom' ? 'custom' : s.kind === 'nodes' ? 'nodes' : s.user ? 'user' : 'builtin';
  return { index: i, name: s.name, kind, body: kind === 'nodes' ? nodeEditor.code ?? '' : s.body, original: s.original };
}

const toggleEditor = () => (editor.isOpen ? editor.toggle(false) : editor.toggle(true, editorTarget(state.scene)));

const editor = new ShaderEditor({
  renderer,
  customIndex: CUSTOM_INDEX,
  templates: [{ name: 'Blank template', body: TEMPLATE }, ...SCENES.filter((s) => !s.kind).map((s) => ({ name: s.name, body: s.original }))],
  onOpen: () => nodeEditor.toggle(false),
  onCompiled: (target, source, params) => {
    const s = ALL_SCENES[target.index];
    s.params = params;
    if (target.kind === 'builtin') { s.body = source; saveSceneEdit(s); library.invalidate(s); }
    if (target.kind === 'user') { s.body = source; saveUserScenes(ALL_SCENES.filter((x) => x.user && !x.removed).map(({ name, body }) => ({ name, body }))); library.invalidate(s); }
    setSceneParams(target.index, params);
  },
  onCopyGenerated: (code) => {
    editor.setCustomCode(code);
    setScene(CUSTOM_INDEX);
    toast('Copied into My Shader — edit away');
  },
  onRevert: (target) => {
    if (!confirm(`Revert "${target.name}" to its original code? Your edits will be lost.`)) return;
    editor.code.value = target.original;
    editor.compile();
    toast(`"${target.name}" is back to the original`);
  },
});

const nodeEditor = new NodeEditor({
  renderer,
  sceneIndex: NODES_INDEX,
  onOpen: () => { editor.toggle(false); setScene(NODES_INDEX); },
  onParams: (specs) => setSceneParams(NODES_INDEX, specs),
  onSendToCode: (code) => {
    if (!confirm('Replace the code in "My Shader" with this graph\'s code?')) return;
    editor.setCustomCode(code);
    setScene(CUSTOM_INDEX);
    editor.toggle(true, editorTarget(CUSTOM_INDEX));
    toast('Graph copied into the code editor (My Shader)');
  },
});
$('code').onclick = toggleEditor;

// ---------- Scene library ----------

let libraryName = null;   // name the code editor's shader will be saved under

const library = new SceneLibrary({
  scenes: ALL_SCENES,
  renderer,
  keyFor,
  onPick: (i) => { setScene(i); library.toggle(false); },
  onEdit: (i) => {
    setScene(i);
    library.toggle(false);
    editor.toggle(true, editorTarget(i));
  },
  onDelete: (i) => {
    const s = ALL_SCENES[i];
    if (!confirm(`Delete "${s.name}" from the library?`)) return;
    s.removed = true;
    saveUserScenes(ALL_SCENES.filter((x) => x.user && !x.removed).map(({ name, body }) => ({ name, body })));
    if (state.scene === i) setScene(0);
    library.render();
  },
});

function saveToLibrary() {
  const body = editor.code.value;
  const from = editor.target ?? editor.customTarget();
  const suggestion = { custom: libraryName ?? 'My scene', builtin: `${from.name} remix`, user: from.name, nodes: from.name }[from.kind];
  const name = prompt('Name for this scene in the library:', suggestion)?.trim();
  if (!name) return;
  const existing = ALL_SCENES.findIndex((s) => s.name === name && !s.removed);
  if (existing >= 0 && !ALL_SCENES[existing].user) return toast(`"${name}" is a built-in scene — pick another name.`);
  if (existing >= 0 && !confirm(`Overwrite your scene "${name}"?`)) return;
  const scene = userScene(name, body);
  let index = existing;
  if (existing >= 0) {
    const error = renderer.replaceScene(existing, scene.frag);
    if (error) return toast('Fix the shader errors before saving.');
    Object.assign(ALL_SCENES[existing], scene);
    library.invalidate(ALL_SCENES[existing]);
  } else {
    if (renderer.check(scene.frag, name)) return toast('Fix the shader errors before saving.');
    index = ALL_SCENES.push(scene) - 1;
  }
  if (from.index !== index) paramStore.copy(paramKey(from.index), paramKey(index));   // keep the values you tweaked
  setSceneParams(index, scene.params);
  libraryName = name;
  saveUserScenes(ALL_SCENES.filter((s) => s.user && !s.removed).map(({ name, body }) => ({ name, body })));
  if (library.isOpen) library.render();
  toast(`Saved "${name}" to the library — it's now in the auto-switch rotation`);
  return index;
}

// ---------- Studio ----------
// A show scene ("cue") = a scene, its parameter values and the look sliders.

const LOOK_KEYS = ['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration'];
const sceneByName = (name) => ALL_SCENES.findIndex((s) => s.name === name && !s.removed);

function captureCue() {
  const i = state.scene;
  const { name } = ALL_SCENES[i];
  return { name, scene: name, values: paramStore.values(paramKey(i), sceneParams[i] ?? []), look: Object.fromEntries(LOOK_KEYS.map((k) => [k, params[k]])) };
}

function takeCue(cue, seconds) {
  const i = sceneByName(cue.scene);
  for (const k of LOOK_KEYS) if (cue.look[k] !== undefined) setControl(k, cue.look[k]);
  paramStore.setAll(paramKey(i), sceneParams[i] ?? [], cue.values);
  pushParams(i);
  setScene(i, seconds, true);
  showParams();
}

function cueUniforms(cue, i) {
  const specs = sceneParams[i] ?? [];
  return Object.fromEntries(specs.map((s) => [s.name, toUniform(s, cue.values[s.name] ?? s.def)]));
}

const studio = new Studio({
  scenes: ALL_SCENES,
  output,
  media,
  listScenes: () => library.listed().filter(({ s }) => !s.kind),
  capture: captureCue,
  take: takeCue,
  cueUniforms,
  programName: () => ALL_SCENES[state.scene].name,
  onDockChange: () => {
    Object.assign(dock, { open: studio.isOpen, tab: studio.paramTab, cue: studio.preview });
    showParams();
  },
  toast,
});
studio.showOutputs([]);
studio.showMaster();
$('studio-open').onclick = () => studio.toggle();

// ---------- AI assistant ----------
// The tools Claude can use (schemas in assistant-tools.js). Each returns { result } or { error },
// and changes come with an undo for the panel's Undo button.

const kindOf = (s) => (s.kind === 'game' ? 'game' : s.kind === 'custom' ? 'custom' : s.kind === 'nodes' ? 'visual maker' : s.user ? 'mine' : 'built-in');
const findScene = (name) => (name == null ? state.scene : sceneByName(name));
const noScene = (name) => ({ error: `There's no scene called "${name}". Call get_app_state for the exact names.` });

function paramSummary(i) {
  const specs = sceneParams[i] ?? [];
  const values = paramStore.values(paramKey(i), specs);
  return specs.map((s) => ({ name: s.name, label: s.label, type: s.color ? `${s.type} colour` : s.type, ...(s.min !== undefined && { min: s.min, max: s.max }), value: values[s.name] }));
}

function addUserScene(name, body) {
  if (sceneByName(name) >= 0) return { error: `A scene called "${name}" already exists. Pick another name, or edit it with write_scene_code.` };
  const scene = userScene(name, body);
  const err = renderer.check(scene.frag, name);
  if (err) return { error: `It didn't compile, so nothing was created:\n${formatError(err)}` };
  const index = ALL_SCENES.push(scene) - 1;
  setSceneParams(index, scene.params);
  saveUserScenes(ALL_SCENES.filter((s) => s.user && !s.removed).map(({ name: n, body: b }) => ({ name: n, body: b })));
  if (library.isOpen) library.render();
  return { index };
}

function lookAt(i, times) {
  const canvas = document.createElement('canvas');
  return times.map((t) => {
    const img = renderer.snapshot(i, {
      uTime: t, uBass: 0.5, uMid: 0.5, uHigh: 0.5, uLevel: 0.6, uBeat: 0.4,
      uHue: params.hue + state.huePhase, uBright: audio.features.bright, uMood: state.mood,
    }, 512, 288);
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
  });
}

const assistantTools = {
  get_app_state() {
    const i = state.scene, s = ALL_SCENES[i];
    const bpm = estimateBpm();
    return {
      result: {
        playing: { name: s.name, kind: kindOf(s), category: s.cat ?? null, editedByUser: !!s.edited, parameters: paramSummary(i) },
        look: Object.fromEntries([...LOOK_KEYS, 'synesthesia'].map((k) => [k, params[k]])),
        audio: { source: activeSource ?? audio.kind ?? 'none', bpm, mood: !audio.kind ? null : state.mood < 0.35 ? 'calm' : state.mood > 0.65 ? 'energetic' : 'groovy', tone: audio.kind ? (audio.features.bright < 0.35 ? 'dark' : audio.features.bright > 0.65 ? 'bright' : 'balanced') : null },
        media: media.el ? { name: media.name, kind: media.kind } : null,
        codeEditorOpen: editor.isOpen,
        scenes: ALL_SCENES.filter((x) => !x.removed).map((x) => ({ name: x.name, category: x.cat ?? null, kind: kindOf(x), parameters: x.params?.length ?? 0, ...(x.edited && { editedByUser: true }) })),
      },
    };
  },

  read_scene_code({ scene }) {
    const i = findScene(scene);
    if (i < 0) return noScene(scene);
    const t = editorTarget(i);
    const code = t.kind === 'custom' ? editor.customCode : t.body;
    const note = t.kind === 'nodes' ? 'Generated by the visual maker: read-only. Use create_scene to make an editable copy.' : t.kind === 'builtin' ? 'Built-in scene: edits are kept as the user\'s version and can be reverted.' : '';
    return { result: `Scene "${t.name}" (${kindOf(ALL_SCENES[i])}). ${note}\n\n${code}`, label: `Read ${t.name}` };
  },

  write_scene_code({ scene, code }) {
    const i = findScene(scene);
    if (i < 0) return noScene(scene);
    const t = editorTarget(i);
    if (t.kind === 'nodes') return { error: 'This scene is generated by the visual maker and is read-only. Use create_scene to make an editable copy.' };
    if (ALL_SCENES[i].kind === 'game') return { error: 'Beat Racer is a game; its shader is tied to the game code. Create a new scene instead.' };
    const before = t.kind === 'custom' ? editor.customCode : t.body;
    setScene(i);
    const error = editor.compileInto(t, code);
    if (error) return { error: `It didn't compile; the previous version is still running. Errors (line numbers count from the first line of your code):\n${error}`, label: `Edit to ${t.name} didn't compile` };
    if (editor.isOpen && editor.target?.index === i) editor.retarget(editorTarget(i));
    const restore = () => {
      editor.compileInto(editorTarget(i), before);
      if (editor.isOpen && editor.target?.index === i) editor.retarget(editorTarget(i));
      setScene(i);
    };
    return { result: { compiled: true, scene: t.name, nowPlaying: true, parameters: paramSummary(i) }, label: `Edited ${t.name}`, undo: restore };
  },

  create_scene({ name, code }) {
    name = name.trim().slice(0, 60);
    const out = addUserScene(name, code);
    if (out.error) return { error: out.error, label: `"${name}" didn't compile` };
    setScene(out.index);
    const remove = () => {
      ALL_SCENES[out.index].removed = true;
      saveUserScenes(ALL_SCENES.filter((s) => s.user && !s.removed).map(({ name: n, body: b }) => ({ name: n, body: b })));
      if (state.scene === out.index) setScene(0);
      if (library.isOpen) library.render();
    };
    return { result: { created: true, scene: name, nowPlaying: true, parameters: paramSummary(out.index) }, label: `Created "${name}"`, undo: remove };
  },

  set_parameters({ values }) {
    const i = state.scene;
    const specs = sceneParams[i] ?? [];
    const before = paramStore.values(paramKey(i), specs);
    const applied = {}, problems = [];
    for (const [key, raw] of Object.entries(values)) {
      const spec = specs.find((s) => s.name === key) ?? specs.find((s) => s.label.toLowerCase() === String(key).toLowerCase());
      if (!spec) { problems.push(`"${key}" isn't a parameter of this scene`); continue; }
      const value = coerceParam(spec, raw);
      if (value === undefined) { problems.push(`"${key}" needs ${spec.type === 'bool' ? 'true/false' : spec.color ? 'a "#rrggbb" colour' : spec.type === 'float' ? 'a number' : `an array of ${spec.def.length} numbers`}`); continue; }
      paramStore.set(paramKey(i), spec, value);
      applied[spec.name] = value;
    }
    pushParams(i);
    showParams();
    if (!Object.keys(applied).length) return { error: problems.join('; ') || 'Nothing to set.' };
    const restore = () => { specs.forEach((s) => paramStore.set(paramKey(i), s, before[s.name])); pushParams(i); showParams(); };
    return { result: { applied, ...(problems.length && { problems }), parameters: paramSummary(i) }, label: `Set ${Object.keys(applied).length} parameter${Object.keys(applied).length > 1 ? 's' : ''}`, undo: restore };
  },

  set_look(values) {
    const before = {}, applied = {};
    for (const [key, v] of Object.entries(values)) {
      const input = $(key);
      if (!input || !Number.isFinite(v)) continue;
      before[key] = params[key];
      const clamped = Math.min(Number(input.max), Math.max(Number(input.min), v));
      setControl(key, clamped);
      if (key === 'resolution') renderer.setScale(clamped);
      applied[key] = clamped;
    }
    if (!Object.keys(applied).length) return { error: 'No look values given.' };
    return { result: { applied }, label: 'Adjusted the look', undo: () => Object.entries(before).forEach(([k, v]) => setControl(k, v)) };
  },

  switch_scene({ scene }) {
    const i = findScene(scene);
    if (i < 0) return noScene(scene);
    setScene(i);
    return { result: { nowPlaying: ALL_SCENES[i].name, kind: kindOf(ALL_SCENES[i]), parameters: paramSummary(i) }, label: `Switched to ${ALL_SCENES[i].name}` };
  },

  look_at_scene({ scene, times }) {
    const i = findScene(scene);
    if (i < 0) return noScene(scene);
    const ts = (times?.length ? times : [14]).slice(0, 3).map(Number).filter(Number.isFinite);
    return { result: `"${ALL_SCENES[i].name}" at t = ${ts.join(', ')} s, with stand-in audio. On screen it also gets motion trails and colour grading.`, images: lookAt(i, ts.length ? ts : [14]), label: `Looked at ${ALL_SCENES[i].name}` };
  },
};

// Parameter values from the model: numbers, true/false, "#rrggbb", or arrays.
function coerceParam(spec, raw) {
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

const assistant = new Assistant({ app: assistantTools });
$('assistant-open').onclick = () => assistant.toggle();

$('ed-save').onclick = saveToLibrary;
$('open-library').onclick = () => library.toggle();
$('play-game').onclick = () => setScene(GAME_INDEX);
$('scene-prev').onclick = () => stepScene(-1);
$('scene-next').onclick = () => stepScene(1);
showSceneName();
if (userSceneErrors.length) setTimeout(() => toast(`Couldn't compile your saved scene(s): ${userSceneErrors.join(', ')}`, 6000), 500);
$('visual').onclick = () => nodeEditor.toggle();

for (const key of ['reactivity', 'speed', 'trails', 'hue', 'cycle', 'aberration', 'resolution', 'synesthesia']) {
  const input = $(key);
  input.value = params[key];
  input.addEventListener('input', () => {
    params[key] = parseFloat(input.value);
    if (key === 'resolution') renderer.setScale(params.resolution);
  });
}
renderer.setScale(params.resolution);

$('auto').addEventListener('change', (e) => { params.auto = e.target.checked; });
$('mood').addEventListener('change', (e) => { params.mood = e.target.checked; });

// ---------- Synesthesia ----------
// Crossmodal correspondences: dark/muffled sound reads as dim, cool and soft; bright/crisp sound
// as light, warm and sharp. Fast, energetic music reads as saturated and warm; slow as muted and cool.

const COOL = [0.7, 0.85, 1.35];
const WARM = [1.3, 1.05, 0.7];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function updateMood(dt) {
  const bpm = estimateBpm();
  const tempo = bpm ? clamp01((bpm - 80) / 80) : 0.5;   // 80 BPM calm … 160 BPM energetic
  const energy = clamp01((audio.avg.level - 0.15) / 0.4);
  const target = audio.kind ? tempo * 0.65 + energy * 0.35 : 0.5;
  state.mood += (target - state.mood) * (1 - Math.exp(-dt / 4));
}

function colourGrade(bright) {
  const A = params.synesthesia;
  const mood = params.mood ? state.mood : 0.5;
  const warmth = params.mood ? bright * 0.6 + mood * 0.4 : bright;
  const tint = COOL.map((c, i) => c + (WARM[i] - c) * warmth);
  const luma = tint[0] * 0.299 + tint[1] * 0.587 + tint[2] * 0.114;   // tint shifts colour, not brightness
  return {
    exposure: 1 + A * (bright - 0.5) * 0.9,
    contrast: 1 + A * (bright - 0.5) * 0.3,
    saturation: 1 + A * (mood - 0.5) * 0.8,
    tint: tint.map((c) => 1 + A * (c / luma - 1)),
  };
}

function setControl(key, v) {
  params[key] = v;
  $(key).value = v;
}

function randomize() {
  setControl('hue', Math.random());
  setControl('trails', 0.75 + Math.random() * 0.2);
  setControl('cycle', Math.random() * 1.5);
  setControl('aberration', Math.random() * 0.025);
  params.spin = Math.random() < 0.5 ? -1 : 1;
  nextRandomScene();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function togglePanel() {
  const collapsed = $('panel').classList.toggle('collapsed');
  if (collapsed) toast('Press H to show the controls again', 2000);
}

$('randomize').onclick = randomize;
$('fullscreen').onclick = toggleFullscreen;
$('collapse').onclick = togglePanel;
$('record').onclick = toggleRecording;

// ---------- Sources ----------

const SOURCE_LABELS = { mic: 'Microphone / line-in', display: 'Tab / system audio', demo: 'Demo beat (124 BPM)' };

async function startSource(kind) {
  try {
    if (kind === 'file') return $('file').click();
    if (kind === 'soundcloud') return soundcloud.toggle(true);
    player.pause();
    if (kind === 'mic') await audio.useMicrophone();
    if (kind === 'display') await audio.useDisplayAudio();
    if (kind === 'demo') await audio.useDemo();
    onSourceStarted(SOURCE_LABELS[kind], kind);
    transport.setMode(kind === 'demo' ? 'demo' : null);
    transport.setPlaying(true);
  } catch (err) {
    if (err.name === 'NotAllowedError') toast('Permission denied or capture cancelled.');
    else toast(err.message || String(err));
  }
}

async function playFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name)) {
    return toast(`"${file.name}" doesn't look like an audio file.`);
  }
  await playUrl(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''), 'file');
}

// Plays through the <audio> element (local files, SoundCloud tracks, a video's sound), so seeking works.
async function playUrl(src, label, sourceButton) {
  if (player.src.startsWith('blob:') && player.src !== media.url) URL.revokeObjectURL(player.src);
  player.src = src;
  try {
    await audio.useElement(player);
    await player.play();
    onSourceStarted(label, sourceButton);
    transport.setMode('element', { hasQueue: !!queueFor(sourceButton)?.hasQueue });
  } catch (err) {
    toast(`Couldn't play this: ${err.message}`);
  }
}

const soundcloud = new RemotePicker({
  id: 'sc', site: 'soundcloud', recentKey: 'hallucinate.scRecent', fetching: 'Fetching',
  emptyText: 'Search for a track, or paste a SoundCloud link. Tracks you play show up here.',
  onPlay: (src, label) => playUrl(src, label, 'soundcloud'),
  onProgress: (track, p) => showDownload('sc', track, p),
  onError: (msg) => toast(msg, 6000),
});
const youtube = new RemotePicker({
  id: 'yt', site: 'youtube', noun: 'video', recentKey: 'hallucinate.ytRecent', fetching: 'Downloading',
  emptyText: 'Search YouTube, or paste a video, playlist or Shorts link. Videos you use show up here.',
  onPlay: (src, label, track) => loadMedia({ url: src, name: track.title, kind: 'video', site: 'youtube' }),
  onProgress: (track, p) => showDownload('yt', track, p),
  onError: (msg) => toast(msg, 6000),
});

// Downloads in progress, shown at the top of the panel so you can follow them with the picker closed.
const downloadRows = new Map();
function showDownload(id, track, p) {
  let row = downloadRows.get(id);
  if (!track) { row?.remove(); downloadRows.delete(id); return; }
  if (!row) {
    row = document.createElement('div');
    row.className = `download ${id}`;
    row.innerHTML = '<div class="download-head"><b></b><span></span><button class="icon" title="Cancel the download">×</button></div><div class="dl-bar"><i></i></div>';
    row.querySelector('b').textContent = id === 'yt' ? 'YouTube' : 'SoundCloud';
    row.querySelector('button').onclick = () => (id === 'yt' ? youtube : soundcloud).cancel();
    row.querySelector('.download-head').onclick = (e) => { if (!e.target.closest('button')) (id === 'yt' ? youtube : soundcloud).toggle(true); };
    $('downloads').append(row);
    downloadRows.set(id, row);
  }
  row.title = track.title;
  row.querySelector('span').textContent = progressText(id === 'yt' ? 'Downloading' : 'Fetching', track, p);
  row.querySelector('.dl-bar i').style.width = `${p.percent}%`;
}
let activeSource = null;
// The picker whose results act as the queue for the current source.
const queueFor = (source) => (source === 'soundcloud' ? soundcloud : source === 'media' && media.source?.site === 'youtube' ? youtube : null);
player.addEventListener('ended', () => {
  if (queueFor(activeSource)?.playNext()) return;
  if (activeSource === 'media') { player.currentTime = 0; player.play(); }   // a video's sound loops like its picture
});

const transport = new Player({
  el: player,
  audio,
  onTogglePlay: togglePlay,
  onPrev: () => !!queueFor(activeSource)?.playPrev(),
  onNext: () => !!queueFor(activeSource)?.playNext(),
});

function togglePlay() {
  if (audio.kind === 'file') player.paused ? player.play() : player.pause();
  else if (audio.kind === 'demo') { audio.detach(); $('now').textContent = '❚❚ Demo beat paused'; transport.setPlaying(false); }
  else if (!audio.kind && $('now').textContent.includes('Demo')) startSource('demo');
}

function onSourceStarted(label, sourceButton = audio.kind) {
  activeSource = sourceButton;
  if (sourceButton !== 'media' && mediaSound) setMediaSound(false, { quiet: true });   // another source is the music now
  $('now').textContent = `▶ ${label}`;
  $('start').classList.add('hidden');
  document.body.classList.add('started');
  document.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('active', b.dataset.source === sourceButton));
  state.beatTimes = [];
}

document.querySelectorAll('[data-source]').forEach((b) => (b.onclick = () => startSource(b.dataset.source)));
$('file').addEventListener('change', (e) => { playFile(e.target.files[0]); e.target.value = ''; });

window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file && isMediaFile(file) && !file.type.startsWith('audio/')) loadMedia(file);
  else playFile(file);
});

// ---------- Media (image / video to distort) ----------

// `source`: a dropped File, or { url, name, kind, site } for a video fetched by the server (YouTube).
async function loadMedia(source) {
  try {
    await media.load(source);
  } catch (err) {
    return toast(err.message, 6000);
  }
  output.sendMedia(source);
  mediaChanged();
  if (mediaSound && media.kind === 'video') linkMediaSound();
  else if (activeSource === 'media') player.pause();
  if (!renderer.usesMedia(state.scene)) setScene(ALL_SCENES.findIndex((s) => s.cat === 'Media'));
  toast(`${media.kind === 'video' ? 'Video' : 'Image'} loaded — the Media scenes distort it (library → Media). In code, sample it with media(p).`, 5000);
}

function clearMedia() {
  if (activeSource === 'media') player.pause();
  media.clear();
  output.sendMedia(null);
  mediaChanged();
}

function mediaChanged() {
  ALL_SCENES.forEach((s, i) => { if (renderer.usesMedia(i)) library.invalidate(s); });   // previews show the new picture
  const [w, h] = media.size;
  $('media-preview').replaceChildren(...(media.el ? [media.el] : []));
  $('media-name').textContent = media.el ? `${media.name} · ${w}×${h}${media.kind === 'video' ? ' · video' : ''}` : 'Drop an image or video anywhere, or pick one from YouTube';
  $('media-clear').disabled = !media.el;
  $('media-sound-row').hidden = media.kind !== 'video';
}

// "Use the video's sound": the <audio> player plays the same file as the music (so the transport,
// tempo and volume work) and the picture follows it.
let mediaSound = false;
try { mediaSound = localStorage.getItem('hallucinate.mediaSound') === '1'; } catch { /* storage unavailable */ }

function setMediaSound(on, { quiet = false } = {}) {
  mediaSound = on;
  try { localStorage.setItem('hallucinate.mediaSound', on ? '1' : '0'); } catch { /* storage unavailable */ }
  $('media-sound').checked = $('yt-sound').checked = on;
  if (quiet) return;
  if (on && media.kind === 'video') linkMediaSound();
  else if (!on && activeSource === 'media') {
    player.pause();
    activeSource = null;
    $('now').textContent = '❚❚ Video sound off — pick a music source';
  }
}

async function linkMediaSound() {
  await playUrl(media.url, media.name, 'media');
  player.currentTime = media.time;
}

$('media-sound').checked = $('yt-sound').checked = mediaSound;
$('media-sound').onchange = (e) => setMediaSound(e.target.checked);
$('yt-sound').onchange = (e) => setMediaSound(e.target.checked, { quiet: !media.el });
$('media-youtube').onclick = () => youtube.toggle(true);

$('media-open').onclick = () => $('media-file').click();
$('media-clear').onclick = clearMedia;
$('media-file').addEventListener('change', (e) => { if (e.target.files[0]) loadMedia(e.target.files[0]); e.target.value = ''; });

// ---------- Beats ----------

audio.onBeat = () => {
  state.huePhase += 0.03 * params.reactivity;
  state.beatsInScene++;
  state.beatTimes.push(state.clock);
  if (state.beatTimes.length > 12) state.beatTimes.shift();
  if (state.scene === GAME_INDEX) game.onBeat();
  if (autoSwitching() && state.beatsInScene >= BEATS_PER_SCENE) nextRandomScene();
  studio.onBeat();
};

function estimateBpm() {
  const t = state.beatTimes;
  if (t.length < 5 || state.clock - t[t.length - 1] > 2) return null;
  const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
  return Math.round(60 / gaps[Math.floor(gaps.length / 2)]);
}

// ---------- Recording ----------

let recorder = null;

function toggleRecording() {
  if (recorder) return recorder.stop();
  const stream = $('gl').captureStream(60);
  if (audio.recordDest) audio.recordDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hallucinate-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    recorder = null;
    $('record').classList.remove('recording');
    $('record').textContent = 'Record';
    toast('Recording saved');
  };
  recorder.start(1000);
  $('record').classList.add('recording');
  $('record').textContent = 'Stop rec';
  toast('Recording… press C or click "Stop rec" to save');
}

// ---------- Keyboard & idle ----------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.key.startsWith('Arrow')) return;   // the slider uses them
  if (e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (nodeEditor.isOpen && !['n', 'e', ' ', 'f', 'p', 'escape'].includes(k)) return;   // keys belong to the graph while it's open
  if (k === 'escape' && library.isOpen) return library.toggle(false);
  if (k === 'escape' && studio.isOpen) return studio.toggle(false);
  if (k === 'escape' && assistant.isOpen) return assistant.toggle(false);
  const inGame = state.scene === GAME_INDEX;
  if (inGame && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); game.steer(k === 'arrowleft' ? -1 : 1); }
  else if (inGame && k === 'enter') game.reset();
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) transport.skip(k === 'arrowleft' ? -10 : 10);
  else if (k === 'arrowup' || k === 'arrowdown') { e.preventDefault(); toast(`Volume ${Math.round(transport.changeVolume(k === 'arrowup' ? 0.05 : -0.05) * 100)}%`, 900); }
  else if (k === 'm') toast(transport.toggleMute() ? 'Muted' : 'Sound on', 900);
  else if (k === '[' || k === ']') toast(`Tempo ${transport.changeRate(k === '[' ? -0.05 : 0.05).toFixed(2)}×`, 900);
  else if (studio.isOpen && (k === 'arrowleft' || k === 'arrowright')) studio.stepPreview(k === 'arrowleft' ? -1 : 1);
  else if (studio.isOpen && /^[1-9]$/.test(k)) studio.setPreview(studio.cues[Number(k) - 1]);
  else if (k === 'o') studio.toggle();
  else if (k === 't') studio.take();
  else if (k === 'b') { studio.blackout(); if (!studio.isOpen) toast(studio.masterTarget ? 'Back on' : 'Blackout — press B to restore', 1500); }
  else if (k === 'arrowright') stepScene(1);
  else if (k === 'arrowleft') stepScene(-1);
  else if (/^[0-9]$/.test(k) && KEYED_SCENES[(Number(k) + 9) % 10] !== undefined) setScene(KEYED_SCENES[(Number(k) + 9) % 10]);
  else if (k === 'l') library.toggle();
  else if (k === 'i') { e.preventDefault(); assistant.toggle(); }
  else if (k === 'p' && paramPanel.visible) paramPanel.toggleCollapsed();
  else if (k === 'g') setScene(GAME_INDEX);
  else if (k === 'e') { e.preventDefault(); toggleEditor(); }
  else if (k === 'n') nodeEditor.toggle();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') togglePanel();
  else if (k === 'r') randomize();
  else if (k === 'c') toggleRecording();
  else if (k === 'a') { params.auto = !params.auto; $('auto').checked = params.auto; toast(`Auto-switch ${params.auto ? 'on' : 'off'}`, 1500); }
  else return;
  if (e.target instanceof HTMLInputElement) e.target.blur();
});

let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (audio.kind && !editor.isOpen && !nodeEditor.isOpen && !soundcloud.isOpen && !youtube.isOpen && !soundcloud.busy && !youtube.busy && !assistant.isOpen && !library.isOpen && !studio.isOpen) document.body.classList.add('idle'); }, 3000);
}
['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
wake();

// ---------- Main loop ----------

const smoothstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
let last = performance.now();
let meterTick = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  state.clock += dt;

  const f = audio.update(dt, state.clock);
  const R = params.reactivity;
  const bass = Math.min(1.5, f.bass * R);
  const mid = Math.min(1.5, f.mid * R);
  const high = Math.min(1.5, f.high * R);
  const level = Math.min(1.5, f.level * R);
  const beat = Math.min(1.5, f.beat * R);

  // Ease the clock's speed instead of jumping it on every beat, so motion stays fluid.
  const targetRate = params.speed * (0.55 + level * 0.9 + beat * 0.35);
  state.timeRate += (targetRate - state.timeRate) * (1 - Math.exp(-dt * 3));
  state.time += dt * state.timeRate;
  state.huePhase += dt * params.cycle * 0.06;
  updateMood(dt);
  studio.update(dt);
  if (activeSource === 'media') media.follow(player);

  if (autoSwitching() && audio.kind && state.clock - state.sceneStart > MAX_SECONDS_PER_SCENE) nextRandomScene();
  const inGame = state.scene === GAME_INDEX;
  if (inGame) game.update(dt, level);
  const mix = state.fade > 0 ? smoothstep((state.clock - state.transitionStart) / state.fade) : 1;
  if (mix >= 1) state.prevScene = -1;

  const program = {
    scene: state.scene, prevScene: state.prevScene, mix,
    time: state.time, bass, mid, high, level, beat,
    hue: params.hue + state.huePhase,
    spectrum: audio.spectrum,
    extra: game.uniforms(),
    bright: f.bright, mood: state.mood,
    grade: colourGrade(f.bright),
    // dark sound lingers (longer trails), bright sound is crisp (shorter trails, more fringing)
    feedback: Math.min(0.97, params.trails * (ALL_SCENES[state.scene].trails ?? 1) * (1 + params.synesthesia * (0.5 - f.bright) * 0.12)),
    zoom: 1.006 + bass * 0.025,
    rotation: params.spin * (0.003 * Math.sin(state.time * 0.1) + mid * 0.01),
    hueDrift: 0.01 + high * 0.03,
    warp: bass,
    aberration: params.aberration * (1 + beat * 1.5) * (1 + params.synesthesia * (f.bright - 0.5) * 1.2),
    master: studio.master,
    mediaTime: media.time, mediaPaused: media.el?.paused ?? true, mediaRate: media.el?.playbackRate ?? 1,
  };
  renderer.render(program);
  if (output.connected) {
    const live = { [state.scene]: renderer.sceneParams[state.scene] };
    if (state.prevScene >= 0) live[state.prevScene] = renderer.sceneParams[state.prevScene];
    output.sendFrame(program, live, params.resolution);
  }
  studio.renderPreview(program, state.huePhase);

  if (++meterTick % 2 === 0) {
    $('m-bass').style.width = `${f.bass * 100}%`;
    $('m-mid').style.width = `${f.mid * 100}%`;
    $('m-high').style.width = `${f.high * 100}%`;
    $('m-tone').style.left = `${f.bright * 100}%`;
    $('tone-row').title = `Timbral brightness: ${f.bright < 0.35 ? 'dark' : f.bright > 0.65 ? 'bright' : 'balanced'} (spectral centroid ≈ ${(f.centroid / 1000).toFixed(1)} kHz)`;
    $('beat').style.opacity = 0.15 + f.beat * 0.85;
    const bpm = estimateBpm();
    $('bpm').textContent = bpm ? `~${bpm} BPM` : '— BPM';
    $('mood-label').textContent = !params.mood || !audio.kind ? '' : state.mood < 0.35 ? 'mood: calm' : state.mood > 0.65 ? 'mood: energetic' : 'mood: groovy';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

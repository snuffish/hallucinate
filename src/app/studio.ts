// Studio: run a show like OBS's Studio Mode. Build a list of show scenes (a library scene plus its
// parameter values and look), pick one into Preview, Take it live with a cut or a fade, and send
// Live to a projector window. Autopilot steps through the list on the beat.
//
// All state lives here (plain class); the component re-renders on `version` and mutates only
// through these methods, so the per-frame hooks always see the latest values.

import { z } from 'zod';
import { toUniform, type ParamSpec, type ParamValue, ParamValueSchema, type ParamValues } from '../engine/params';
import { Renderer, type ProgramState } from '../engine/renderer';
import type { ScreenDetailed } from '../engine/output-link';
import { LOOK_KEYS, type LookKey } from '../state/app-state';
import { listedScenes } from '../state/library-prefs';
import { KEYS, readJSON, writeJSON } from '../state/persistence';
import { paramKey } from '../state/scene-list';
import type { AppController } from './controller';

const CueSchema = z.object({
  id: z.string(),
  name: z.string(),
  scene: z.string(),
  values: z.record(z.string(), ParamValueSchema).default({}),
  look: z.record(z.string(), z.number()).default({}),
});
const ShowSchema = z.object({
  cues: z.array(CueSchema).default([]),
  mode: z.enum(['cut', 'fade']).default('fade'),
  seconds: z.number().default(1.5),
  autoBeats: z.number().default(32),
});
export type Cue = z.infer<typeof CueSchema>;
export type ParamTab = 'preview' | 'live';

export class StudioSession {
  cues: Cue[];
  mode: 'cut' | 'fade';
  seconds: number;
  autopilot: { on: boolean; beats: number };
  previewId: string | null;
  liveId: string | null = null;
  paramTab: ParamTab = 'preview';
  screens: ScreenDetailed[] = [];
  master = 1;
  masterTarget = 1;
  version = 0;
  private lastLevel = 1;
  private beatCount = 0;
  private previewRenderer: Renderer | null = null;
  private readonly previewState: ProgramState;
  private open = false;

  constructor(private readonly app: AppController, private readonly notify: () => void) {
    const saved = readJSON(KEYS.show, ShowSchema, { cues: [], mode: 'fade', seconds: 1.5, autoBeats: 32 });
    this.cues = saved.cues;
    this.mode = saved.mode;
    this.seconds = saved.seconds;
    this.autopilot = { on: false, beats: saved.autoBeats };   // never starts a show on its own after a reload
    this.previewId = this.cues[0]?.id ?? null;
    this.previewState = { scene: -1, prevScene: -1, mix: 1, time: 0, bass: 0, mid: 0, high: 0, level: 0, beat: 0, hue: 0, spectrum: new Uint8Array(512), extra: {}, bright: 0.5, mood: 0.5, grade: { exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] }, feedback: 0.86, zoom: 1, rotation: 0, hueDrift: 0, warp: 0, aberration: 0, master: 1 };
  }

  get preview(): Cue | null { return this.cues.find((c) => c.id === this.previewId) ?? null; }
  get live(): Cue | null { return this.cues.find((c) => c.id === this.liveId) ?? null; }
  get isOpen(): boolean { return this.open; }

  // ---------- Lifecycle ----------

  // The main window's hooks: Preview monitor + master fader every frame, autopilot on the beat,
  // the Parameters dock editing the selected show scene, and the global shortcuts.
  attach(): () => void {
    return this.app.setHooks({
      onFrame: (dt, program) => { this.update(dt); this.renderPreview(program); },
      onBeat: () => this.onBeat(),
      onManualSceneChange: () => { if (this.liveId) { this.liveId = null; this.changed(false); } },
      master: () => this.master,
      autopilot: () => this.autopilot.on,
      paramsOverride: () => this.paramsOverride(),
      take: () => this.take(),
      blackout: () => this.blackout(),
      studioStep: (dir) => { if (this.open) this.stepPreview(dir); },
      studioCue: (n) => { if (this.open) this.setPreview(this.cues[n] ?? null); },
    });
  }

  setOpen(open: boolean, previewCanvas: HTMLCanvasElement | null): void {
    this.open = open;
    if (open && previewCanvas && !this.previewRenderer) {
      this.previewRenderer = new Renderer(previewCanvas, this.app.state.scenes);
      this.previewRenderer.setMedia(this.app.media);
      this.previewRenderer.setScale(0.6);
    }
    this.app.showParams();
    this.changed(false);
  }

  dispose(): void {
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
  }

  private changed(save = true): void {
    if (save) this.save();
    this.version++;
    this.notify();
    this.app.showParams();
  }

  save(): void {
    writeJSON(KEYS.show, { cues: this.cues, mode: this.mode, seconds: this.seconds, autoBeats: this.autopilot.beats });
  }

  // ---------- Show scenes ----------

  sceneIndex(cue: Cue | null): number {
    return this.app.state.scenes.findIndex((s) => s.name === cue?.scene && !s.removed);
  }

  listScenes() {
    return listedScenes(this.app.state.scenes).filter(({ s }) => !s.kind);
  }

  // A show scene = a scene, its parameter values and the look sliders, as they are on Live now.
  capture(): Omit<Cue, 'id'> {
    const app = this.app;
    const i = app.sceneIndex;
    const { name } = app.state.scenes[i]!;
    const look: Record<string, number> = {};
    for (const k of LOOK_KEYS) look[k] = app.state.look[k];
    return { name, scene: name, values: app.paramValues(i), look };
  }

  addFromSelect(value: string): void {
    if (!value) return;
    const base = this.capture();
    this.add(value === '@live' ? base : { ...base, scene: value, name: value, values: {} });
  }

  add(cue: Omit<Cue, 'id'>): Cue {
    const full = { ...cue, id: crypto.randomUUID() };
    this.cues = [...this.cues, full];
    this.previewId = full.id;
    this.changed();
    return full;
  }

  move(cue: Cue, dir: number): void {
    const i = this.cues.indexOf(cue), j = i + dir;
    if (j < 0 || j >= this.cues.length) return;
    const next = [...this.cues];
    [next[i], next[j]] = [next[j]!, next[i]!];
    this.cues = next;
    this.changed();
  }

  rename(cue: Cue): void {
    const name = prompt('Name for this show scene:', cue.name)?.trim();
    if (name) { this.replace(cue, { ...cue, name }); }
  }

  updateFromLive(cue: Cue): void {
    const { scene, values, look } = this.capture();
    this.replace(cue, { ...cue, scene, values, look });
    this.app.toast(`"${cue.name}" now holds what's on Live`);
  }

  duplicate(cue: Cue): void {
    const copy: Cue = { ...structuredClone(cue), id: crypto.randomUUID(), name: `${cue.name} copy` };
    const next = [...this.cues];
    next.splice(this.cues.indexOf(cue) + 1, 0, copy);
    this.cues = next;
    this.changed();
  }

  remove(cue: Cue): void {
    if (!confirm(`Remove "${cue.name}" from the show?`)) return;
    this.cues = this.cues.filter((c) => c !== cue);
    if (this.previewId === cue.id) this.previewId = this.cues[0]?.id ?? null;
    if (this.liveId === cue.id) this.liveId = null;
    this.changed();
  }

  private replace(cue: Cue, next: Cue): void {
    this.cues = this.cues.map((c) => (c === cue ? next : c));
    this.changed();
  }

  setPreview(cue: Cue | null): void {
    if (!cue) return;
    this.previewId = cue.id;
    this.changed(false);
  }

  stepPreview(dir: number): void {
    if (!this.cues.length) return;
    const i = this.cues.indexOf(this.preview!);
    this.setPreview(this.cues[(i + dir + this.cues.length) % this.cues.length]!);
  }

  // Preview -> Live. Afterwards Preview moves on to the next scene, ready for the next take.
  take(cue: Cue | null = this.preview): void {
    if (!cue) { this.app.toast('Add a scene to the show first (+ Add scene…)'); return; }
    const i = this.sceneIndex(cue);
    if (i < 0) { this.app.toast(`"${cue.name}" uses a scene that no longer exists`); return; }
    const app = this.app;
    for (const k of LOOK_KEYS) if (cue.look[k] !== undefined) app.setLook(k as LookKey, cue.look[k]!);
    const scene = app.state.scenes[i]!;
    app.paramStore.setAll(paramKey(scene), app.sceneParams[i] ?? [], cue.values);
    app.pushParams(i);
    app.setScene(i, this.mode === 'cut' ? 0 : this.seconds, true);
    this.liveId = cue.id;
    this.beatCount = 0;
    const next = this.cues[(this.cues.indexOf(cue) + 1) % this.cues.length];
    if (next) this.previewId = next.id;
    this.changed(false);
  }

  onBeat(): void {
    if (!this.autopilot.on || this.cues.length < 2) return;
    if (++this.beatCount >= this.autopilot.beats) {
      const i = this.cues.indexOf(this.live!);
      this.take(this.cues[(i + 1) % this.cues.length]!);
    }
  }

  setAutopilot(on: boolean): void { this.autopilot.on = on; this.beatCount = 0; this.changed(false); }
  setAutoBeats(beats: number): void { this.autopilot.beats = beats; this.changed(); }
  setParamTab(tab: ParamTab): void { this.paramTab = tab; this.changed(false); }

  // ---------- Transition & master ----------

  setMode(mode: 'cut' | 'fade'): void { this.mode = mode; this.changed(); }
  setSeconds(seconds: number): void { this.seconds = seconds; this.changed(); }

  setMaster(level: number): void {
    this.masterTarget = level;
    if (level > 0) this.lastLevel = level;
    this.changed(false);
  }

  blackout(): void {
    this.setMaster(this.masterTarget > 0 ? 0 : this.lastLevel);
    if (!this.open) this.app.toast(this.masterTarget ? 'Back on' : 'Blackout — press B to restore', 1500);
  }

  // The master fader glides over the transition time (a cut still takes 0.1 s, to avoid a pop).
  private update(dt: number): void {
    const step = dt / Math.max(0.1, this.mode === 'cut' ? 0.1 : this.seconds);
    const d = this.masterTarget - this.master;
    this.master += Math.sign(d) * Math.min(Math.abs(d), step);
  }

  // ---------- Monitors ----------

  private cueUniforms(cue: Cue, i: number) {
    const specs = this.app.sceneParams[i] ?? [];
    return Object.fromEntries(specs.map((s) => [s.name, toUniform(s, cue.values[s.name] ?? s.def)]));
  }

  private renderPreview(base: ProgramState): void {
    const r = this.previewRenderer;
    if (!this.open || !r) return;
    const cue = this.preview;
    const index = this.sceneIndex(cue);
    const p = Object.assign(this.previewState, base);
    if (index < 0 || !cue) { p.scene = -1; p.prevScene = -1; p.mix = 1; p.master = 0; r.render(p); return; }
    r.setParams(index, this.cueUniforms(cue, index));
    const look = cue.look;
    p.scene = index; p.prevScene = -1; p.mix = 1; p.master = 1;
    p.hue = (look.hue ?? 0) + this.app.state.clock.huePhase;
    p.feedback = Math.min(0.97, (look.trails ?? 0.86) * (this.app.state.scenes[index]!.trails ?? 1));
    p.aberration = look.aberration ?? 0;
    r.render(p);
  }

  // The Parameters dock edits the selected (Preview) show scene by default, like OBS's Studio Mode:
  // tweaks show on the Preview monitor, are saved in that show scene and go live when you Take it.
  private paramsOverride() {
    if (!this.open || this.paramTab !== 'preview') return null;
    const cue = this.preview;
    const i = this.sceneIndex(cue);
    const specs: ParamSpec[] = i >= 0 ? this.app.sceneParams[i] ?? [] : [];
    const values: ParamValues = Object.fromEntries(specs.map((s) => [s.name, cue?.values[s.name] ?? s.def]));
    return {
      title: cue ? `${cue.name} — preview` : 'Preview',
      specs,
      values,
      onChange: (spec: ParamSpec, v: ParamValue) => { if (cue) this.replace(cue, { ...cue, values: { ...cue.values, [spec.name]: v } }); },
      onReset: () => { if (cue) this.replace(cue, { ...cue, values: {} }); },
    };
  }

  // ---------- Projector ----------

  async detectScreens(): Promise<void> {
    try {
      this.screens = await this.app.output.screens();
      this.changed(false);
      this.app.toast(`Found ${this.screens.length} display${this.screens.length > 1 ? 's' : ''}`);
    } catch (err) {
      const e = err as Error;
      this.app.toast(e.name === 'NotAllowedError' ? 'Display access was blocked — allow "Window management" for this site.' : e.message, 6000);
    }
  }

  openProjector(screenIndex: string): void {
    try {
      this.app.output.open(screenIndex === '' ? undefined : this.screens[Number(screenIndex)]);
      this.app.toast('Projector opened — double-click it (or press F there) for fullscreen', 5000);
    } catch (err) {
      this.app.toast((err as Error).message, 6000);
    }
  }
}

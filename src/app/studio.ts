// Studio: run a show like OBS's Studio Mode. Build a list of show scenes (a library scene plus its
// parameter values and look), pick one into Preview, Take it live with a cut or a fade, and send
// Live to a projector window. Autopilot steps through the list on the beat, or follows a plan (an
// ordered queue with beats per step) that the AI director or the assistant wrote.
//
// All state lives here (plain class, created by sessions.ts); the component re-renders on its
// `changed` events and mutates only through these methods, so the per-frame hooks always see the
// latest values. The assistant's tools and the director are handed this session.

import { z } from 'zod';
import { type ParamSpec, type ParamValue, ParamValueSchema, type ParamValues } from '../engine/params';
import { Renderer, type ProgramState } from '../engine/renderer';
import { applyRendererPrefs, type ScreenDetailed } from '../engine/output-link';
import { outputPrefs, type Prefs } from '../state/prefs';
import { listedScenes } from '../state/library-prefs';
import { KEYS, debouncedWriter, readWithDefaults } from '../state/persistence';
import { paramKey } from '../state/scene-list';
import { LIST_MAX_SECONDS, PlanSchema, type Plan, type PlanStep } from '../state/show-plan';
import type { AppPort } from './app-port';
import type { Shot } from './live-slot';

const CueSchema = z.object({
  id: z.string(),
  name: z.string(),
  scene: z.string(),
  values: z.record(z.string(), ParamValueSchema).default({}),
  look: z.record(z.string(), z.number()).default({}),
});
// A stored number, clamped to the range its control allows (an imported or hand-edited show can't, say,
// run the autopilot every frame); a missing or non-number value falls back to the default.
const bounded = (min: number, max: number, def: number) => z.number().catch(def).transform((v) => Math.min(max, Math.max(min, v)));
export const ShowSchema = z.object({
  cues: z.array(CueSchema).default([]),
  mode: z.enum(['cut', 'fade']).default('fade'),
  seconds: bounded(0.2, 8, 1.5),
  autoBeats: bounded(1, 1024, 32),
  autoUnit: z.enum(['beats', 'seconds']).default('beats'),
  autoSeconds: bounded(5, 600, 30),
  plan: PlanSchema.nullable().default(null),
  directorBeats: bounded(16, 1024, 128),
  directorUnit: z.enum(['beats', 'seconds']).default('beats'),
  directorSeconds: bounded(15, 3600, 120),
});
export type Cue = z.infer<typeof CueSchema>;
export type ParamTab = 'preview' | 'live';
// The autopilot counts tempo beats, or runs on a plain timer (seconds) when the music has no usable beat.
export type AutoUnit = 'beats' | 'seconds';
export const AUTO_BEATS = [16, 32, 64, 128] as const;
export const AUTO_SECONDS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 300] as const;
export type TakeSource = 'user' | 'tool' | 'auto';
// What the director and the UI listen for.
export type StudioEvent = { type: 'beat' } | { type: 'take'; cue: Cue; source: TakeSource } | { type: 'changed' };
export interface ShowSnapshot { cues: Cue[]; plan: Plan | null }

export class StudioSession {
  cues: Cue[];
  mode: 'cut' | 'fade';
  seconds: number;
  autopilot: { on: boolean; beats: number; unit: AutoUnit; seconds: number };
  // The plan the autopilot follows instead of list order; `planIndex` is the step playing now
  // (-1: the plan starts with the next take). `lastPlan` is what a new plan replaced.
  plan: Plan | null;
  planIndex = -1;
  lastPlan: Plan | null = null;
  // How often the director plans: every N beats, or every N seconds on a timer.
  directorBeats: number;
  directorUnit: AutoUnit;
  directorSeconds: number;
  // Set by hand-made takes and show edits, read and cleared by the director's next digest.
  userTouched = false;
  previewId: string | null;
  liveId: string | null = null;
  paramTab: ParamTab = 'preview';
  screens: ScreenDetailed[] = [];
  master = 1;
  masterTarget = 1;
  version = 0;
  // Bumps whenever the show itself (its scenes or its plan) changes, whoever changed it: an undo only
  // restores a snapshot when nothing changed the show after the step it undoes.
  revision = 0;
  private lastShow: { cues: Cue[]; plan: Plan | null } = { cues: [], plan: null };
  private lastLevel = 1;
  private beatCount = 0;
  private stepStart = 0;   // clock seconds when the current step began (the timer, and the wall-clock ceiling)
  private lastTimerTick = -1;
  private readonly listeners = new Set<(event: StudioEvent) => void>();
  private previewRenderer: Renderer | null = null;
  private previewResolution = 0;
  private readonly shots = new WeakMap<Cue, Shot>();   // the Preview monitor's, per cue
  private readonly writer = debouncedWriter(KEYS.show, () => this.serialised(), 300);
  private open = false;

  constructor(private readonly app: AppPort, private readonly notify: () => void = () => {}) {
    const saved = readWithDefaults(KEYS.show, ShowSchema);
    this.cues = saved.cues;
    this.mode = saved.mode;
    this.seconds = saved.seconds;
    this.autopilot = { on: false, beats: saved.autoBeats, unit: saved.autoUnit, seconds: saved.autoSeconds };   // never starts a show on its own after a reload
    this.plan = saved.plan;
    this.directorBeats = saved.directorBeats;
    this.directorUnit = saved.directorUnit;
    this.directorSeconds = saved.directorSeconds;
    this.previewId = this.cues[0]?.id ?? null;
    this.lastShow = { cues: this.cues, plan: this.plan };
  }

  // Beats counted towards the next autopilot take, and how many it waits for (the plan step's, or the dial's).
  get beatsElapsed(): number { return this.beatCount; }
  get beatsTarget(): number { return this.currentStep?.beats ?? this.autopilot.beats; }
  // On the timer: seconds into the current step.
  get secondsElapsed(): number { return Math.max(0, this.app.state.clock.clock - this.stepStart); }
  get currentStep(): PlanStep | null { return this.plan?.steps[this.planIndex] ?? null; }

  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(event: StudioEvent): void { for (const l of this.listeners) l(event); }
  // While the studio is closed and a cue is Live, the screen is only a preview.
  get isPinned(): boolean { return this.app.live.pinned; }

  get preview(): Cue | null { return this.cues.find((c) => c.id === this.previewId) ?? null; }
  get live(): Cue | null { return this.cues.find((c) => c.id === this.liveId) ?? null; }
  get isOpen(): boolean { return this.open; }

  // ---------- Lifecycle ----------

  // The main window's hooks: Preview monitor + master fader every frame, autopilot on the beat, the
  // Parameters dock editing the selected show scene, and the display settings for the monitor.
  attach(): () => void {
    return this.app.setHooks({
      onFrame: (dt, program) => { this.update(dt); this.renderPreview(program, dt); },
      onTempoBeat: () => this.onBeat(),   // the autopilot follows the tempo clock, not raw kicks
      // Changing scene by hand inside the studio means Live no longer shows a show scene. Outside the
      // studio the screen is a preview and Live stays pinned.
      onManualSceneChange: () => { if (this.open && this.liveId) { this.liveId = null; this.changed(false); } },
      master: () => this.master,
      autopilot: () => this.autopilot.on,
      paramsOverride: () => this.paramsOverride(),
      onPrefs: (prefs) => this.applyPreviewPrefs(prefs),
    });
  }

  // The monitor renders like Live: at the Resolution setting (so Preview shows how a show scene will
  // look) and the pixel density. A rescale restarts the trails, so only a changed Resolution does one.
  private applyPreviewPrefs(prefs: Prefs): void {
    const r = this.previewRenderer;
    if (!r) return;
    if (prefs.resolution !== this.previewResolution) r.setScale((this.previewResolution = prefs.resolution));
    applyRendererPrefs(r, outputPrefs(prefs));
  }

  // The studio's shortcuts: step Preview, pick a cue (only while the studio is open).
  stepPreviewKey(dir: number): void { if (this.open) this.stepPreview(dir); }
  cueKey(n: number): void { if (this.open) this.setPreview(this.cues[n] ?? null); }

  setOpen(open: boolean, previewCanvas: HTMLCanvasElement | null): void {
    if (open === this.open) return;
    this.open = open;
    if (open && previewCanvas && !this.previewRenderer) {
      this.previewRenderer = new Renderer(previewCanvas, this.app.state.scenes);
      this.previewRenderer.setMedia(this.app.media);
      this.applyPreviewPrefs(this.app.prefs.get());
    }
    // Closing with a cue Live pins the Live slot: projectors keep it while the screen is free to
    // browse. Reopening puts Live back on the screen (the main canvas is the Live monitor).
    if (!open && this.liveId) this.pin();
    if (open && this.app.live.pinned) this.unpin();
    this.app.showParams();
    this.changed(false);
  }

  // What is on screen stays Live for the projectors (the main canvas was the Live monitor).
  private pin(): void {
    const app = this.app;
    const i = app.state.clock.scene;
    app.live.take(app.captureScene(i), this.live?.name ?? app.state.scenes[i]?.name ?? 'Live');
  }

  private unpin(): void {
    const shot = this.app.live.unpin();
    if (shot) this.app.applyScene(shot, 0);
  }

  dispose(): void {
    this.writer.flush();   // the writer lives as long as the session (StrictMode re-attaches after a dispose)
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
  }

  private changed(save = true): void {
    if (this.cues !== this.lastShow.cues || this.plan !== this.lastShow.plan) {
      this.revision++;
      this.lastShow = { cues: this.cues, plan: this.plan };
    }
    if (save) this.save();
    this.version++;
    this.notify();
    this.app.showParams();
    this.emit({ type: 'changed' });
  }

  // A show edit made by hand (not by a tool): the director hears about it in its next digest.
  private touched(): void { this.userTouched = true; }

  // Saving is coalesced (a slider drag is many edits); it is flushed when the page is hidden and
  // before an export or import.
  save(): void { this.writer.schedule(); }

  private serialised() {
    return { cues: this.cues, mode: this.mode, seconds: this.seconds, autoBeats: this.autopilot.beats, autoUnit: this.autopilot.unit, autoSeconds: this.autopilot.seconds, plan: this.plan, directorBeats: this.directorBeats, directorUnit: this.directorUnit, directorSeconds: this.directorSeconds };
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
    const { scene, values, look } = app.captureScene();
    const { name } = app.state.scenes[scene]!;
    return { name, scene: name, values, look: { ...look } };
  }

  addFromSelect(value: string): void {
    if (!value) return;
    const base = this.capture();
    this.touched();
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
    this.touched();
    this.cues = next;
    this.changed();
  }

  // The whole list in a new order (every current id exactly once).
  reorder(ids: string[]): void {
    const byId = new Map(this.cues.map((c) => [c.id, c]));
    if (ids.length !== this.cues.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) throw new Error('The order must list every show scene id exactly once.');
    this.cues = ids.map((id) => byId.get(id)!);
    this.changed();
  }

  rename(cue: Cue): void {
    const name = prompt('Name for this show scene:', cue.name)?.trim();
    if (name) { this.touched(); this.renameTo(cue, name); }
  }

  renameTo(cue: Cue, name: string): Cue { return this.updateCue(cue, { name }); }

  updateCue(cue: Cue, patch: Partial<Omit<Cue, 'id'>>): Cue {
    const next = { ...cue, ...patch, id: cue.id };
    this.replace(cue, next);
    return next;
  }

  updateFromLive(cue: Cue): void {
    const { scene, values, look } = this.capture();
    this.touched();
    this.replace(cue, { ...cue, scene, values, look });
    this.app.toast(`"${cue.name}" now holds what's on Live`);
  }

  duplicate(cue: Cue): void {
    const copy: Cue = { ...structuredClone(cue), id: crypto.randomUUID(), name: `${cue.name} copy` };
    const next = [...this.cues];
    next.splice(this.cues.indexOf(cue) + 1, 0, copy);
    this.touched();
    this.cues = next;
    this.changed();
  }

  remove(cue: Cue): void {
    if (!confirm(`Remove "${cue.name}" from the show?`)) return;
    this.touched();
    this.removeCue(cue);
  }

  removeCue(cue: Cue): void {
    this.cues = this.cues.filter((c) => c !== cue);
    if (this.previewId === cue.id) this.previewId = this.cues[0]?.id ?? null;
    if (this.liveId === cue.id) this.liveId = null;
    this.changed();
  }

  // A show scene by id, or by exact name (first match).
  cueByRef(ref: string): Cue | null {
    return this.cues.find((c) => c.id === ref) ?? this.cues.find((c) => c.name === ref) ?? null;
  }

  // For the assistant's undo: the show as it was, and the way back.
  snapshot(): ShowSnapshot { return { cues: this.cues, plan: this.plan }; }
  restore(snap: ShowSnapshot): void {
    this.cues = snap.cues;
    if (this.previewId && !this.cues.some((c) => c.id === this.previewId)) this.previewId = this.cues[0]?.id ?? null;
    if (this.liveId && !this.cues.some((c) => c.id === this.liveId)) this.liveId = null;
    this.plan = snap.plan;
    this.planIndex = this.plan && this.liveId && this.plan.steps[0]?.cue === this.liveId ? 0 : -1;
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
  // With the studio open the screen is the Live monitor, so the take shows there; with it closed only
  // the pinned Live slot (what projectors get) changes and the screen stays a preview.
  // `source` says who took: the user (T, double-click), a tool, or the autopilot; a plan step may
  // bring its own transition.
  take(cue: Cue | null = this.preview, source: TakeSource = 'user', step: PlanStep | null = null): void {
    if (!cue) { this.app.toast('Add a scene to the show first (+ Add scene…)'); return; }
    const i = this.sceneIndex(cue);
    if (i < 0) { this.app.toast(`"${cue.name}" uses a scene that no longer exists`); return; }
    const app = this.app;
    const mode = step?.mode ?? this.mode;
    const fade = mode === 'cut' ? 0 : step?.seconds ?? this.seconds;
    if (source === 'user') this.touched();
    if (this.open) {
      app.applyScene({ scene: i, values: cue.values, look: cue.look }, fade);
    } else {
      app.live.take({ scene: i, values: cue.values, look: cue.look }, cue.name, fade);
      app.toast(`Live: ${cue.name}`, 1500);
    }
    this.liveId = cue.id;
    this.beatCount = 0;
    this.stepStart = app.state.clock.clock;
    // A take by hand or by a tool that lands on a plan step continues the plan from there.
    if (source !== 'auto' && this.plan) this.planIndex = this.plan.steps.findIndex((s) => this.cueByRef(s.cue)?.id === cue.id);
    const next = this.plannedNext() ?? this.cues[(this.cues.indexOf(cue) + 1) % this.cues.length];
    if (next) this.previewId = next.id;
    this.changed(false);
    this.emit({ type: 'take', cue, source });
  }

  // One tempo beat towards the next autopilot take (on the timer, beats are only counted for the director).
  onBeat(): void {
    if (!this.autopilot.on || this.cues.length < 2) return;
    this.emit({ type: 'beat' });
    if (this.autopilot.unit !== 'beats') return;
    if (++this.beatCount >= this.beatsTarget) this.advance();
    else if (this.open) this.changed(false);   // the beat indicator
  }

  // The next take: the plan's next playable step, or the next cue in list order.
  private advance(): void {
    const planned = this.plannedNextIndex();
    if (planned !== null) {
      const step = this.plan!.steps[planned]!;
      this.planIndex = planned;
      this.take(this.cueByRef(step.cue), 'auto', step);
      return;
    }
    if (this.plan) {   // exhausted (no loop) or nothing in it plays any more: back to list order
      this.app.toast(this.plan.loop ? 'The plan has no playable show scenes; following the list instead' : 'Plan finished; following the list', 2500);
      this.setPlan(null);
    }
    const i = this.cues.indexOf(this.live!);
    this.take(this.cues[(i + 1) % this.cues.length]!, 'auto');
  }

  // Index of the next plan step whose show scene still exists, or null when the plan can't go on.
  private plannedNextIndex(): number | null {
    const plan = this.plan;
    if (!plan) return null;
    const n = plan.steps.length;
    for (let k = 1; k <= n; k++) {
      const j = this.planIndex + k;
      if (j >= n && !plan.loop) return null;
      const idx = j % n;
      const cue = this.cueByRef(plan.steps[idx]!.cue);
      if (cue && this.sceneIndex(cue) >= 0) return idx;
    }
    return null;
  }
  private plannedNext(): Cue | null {
    const i = this.plannedNextIndex();
    return i === null ? null : this.cueByRef(this.plan!.steps[i]!.cue);
  }

  // Replace the plan atomically. If its first step is the Live scene, that step is already playing
  // and its beats count from now; otherwise the plan starts with the next take.
  setPlan(plan: Plan | null): void {
    if (this.plan) this.lastPlan = this.plan;
    this.plan = plan;
    this.planIndex = plan && this.liveId && this.cueByRef(plan.steps[0]!.cue)?.id === this.liveId ? 0 : -1;
    this.beatCount = 0;
    this.stepStart = this.app.state.clock.clock;
    const next = this.plannedNext();
    if (next && next.id !== this.liveId) this.previewId = next.id;
    this.changed();
  }

  restoreLastPlan(): void { if (this.lastPlan) this.setPlan(this.lastPlan); }

  setAutopilot(on: boolean): void { this.autopilot.on = on; this.beatCount = 0; this.stepStart = this.app.state.clock.clock; this.changed(false); }
  setAutoBeats(beats: number): void { this.autopilot.beats = Math.min(1024, Math.max(1, Math.round(beats))); this.changed(); }
  setAutoUnit(unit: AutoUnit): void { this.autopilot.unit = unit; this.beatCount = 0; this.stepStart = this.app.state.clock.clock; this.changed(); }
  setAutoSeconds(seconds: number): void { this.autopilot.seconds = Math.min(600, Math.max(5, seconds)); this.changed(); }
  setDirectorBeats(beats: number): void { this.directorBeats = Math.min(1024, Math.max(16, Math.round(beats))); this.changed(); }
  setDirectorUnit(unit: AutoUnit): void { this.directorUnit = unit; this.changed(); }
  setDirectorSeconds(seconds: number): void { this.directorSeconds = Math.min(3600, Math.max(15, seconds)); this.changed(); }
  setParamTab(tab: ParamTab): void { this.paramTab = tab; this.changed(false); }

  // ---------- Transition & master ----------

  setMode(mode: 'cut' | 'fade'): void { this.mode = mode; this.changed(); }
  setSeconds(seconds: number): void { this.seconds = Math.min(8, Math.max(0.2, seconds)); this.changed(); }

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
  // On the timer the autopilot moves on every N seconds; on beats it also moves on by wall clock
  // when the beats never come (no tempo yet, a breakdown).
  private update(dt: number): void {
    const step = dt / Math.max(0.1, this.mode === 'cut' ? 0.1 : this.seconds);
    const d = this.masterTarget - this.master;
    this.master += Math.sign(d) * Math.min(Math.abs(d), step);
    if (!this.autopilot.on || this.cues.length < 2) return;
    const elapsed = this.app.state.clock.clock - this.stepStart;
    if (this.autopilot.unit === 'seconds') {
      if (elapsed >= this.autopilot.seconds) { this.advance(); return; }
      const tick = Math.floor(elapsed * 2);   // the timer bar, a few times a second, not every frame
      if (tick !== this.lastTimerTick) { this.lastTimerTick = tick; if (this.open) this.changed(false); }
    } else if (this.app.music.playing && elapsed > (this.currentStep?.maxSeconds ?? LIST_MAX_SECONDS)) this.advance();
  }

  // ---------- Monitors ----------

  private renderPreview(base: ProgramState, dt: number): void {
    const r = this.previewRenderer;
    if (!this.open || !r) return;
    const cue = this.preview;
    const index = this.sceneIndex(cue);
    const f = this.app.live.preview(base, cue && index >= 0 ? this.shot(cue, index) : null, dt);
    r.render(f.program, f.params);
  }

  // A cue as a shot, reused while the cue is (a cue is replaced, never edited): no allocation per frame.
  private shot(cue: Cue, index: number): Shot {
    const hit = this.shots.get(cue);
    if (hit && hit.scene === index) return hit;
    const shot = { scene: index, values: cue.values, look: cue.look };
    this.shots.set(cue, shot);
    return shot;
  }

  // The Parameters dock edits the selected (Preview) show scene by default, like OBS's Studio Mode:
  // tweaks show on the Preview monitor, are saved in that show scene and go live when you Take it.
  private paramsOverride() {
    if (!this.open || this.paramTab !== 'preview') return null;
    const cue = this.preview;
    const i = this.sceneIndex(cue);
    const specs = this.app.library.specs(i);
    const values: ParamValues = Object.fromEntries(specs.map((s) => [s.name, cue?.values[s.name] ?? s.def]));
    return {
      title: cue ? `${cue.name} — preview` : 'Preview',
      key: i >= 0 ? paramKey(this.app.state.scenes[i]!) : '',
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

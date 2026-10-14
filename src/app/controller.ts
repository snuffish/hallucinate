// The app's brain: owns the engines, the shared scene list and the frame loop, and exposes the
// actions the UI calls. It is created once (outside React's render) and handed to the tree through
// AppContext. Panels that need deeper hooks (editor, studio, assistant) register them here.

import { AudioEngine } from '../engine/audio';
import { BeatRacer } from '../engine/game';
import { MediaLayer, isMediaFile, type MediaSource } from '../engine/media';
import { OutputLink } from '../engine/output-link';
import { ParamStore, toUniform, type ParamSpec, type ParamValue, type ParamValues } from '../engine/params';
import { Renderer, type ProgramState, type SceneUniforms } from '../engine/renderer';
import type { Scene } from '../engine/scenes';
import { BEATS_PER_SCENE, CROSSFADE_SECONDS, LOOK_RANGES, MAX_SECONDS_PER_SCENE, defaultClock, defaultLook, estimateBpm, type AppState, type LookKey, type SourceButton } from '../state/app-state';
import { loadLibraryPrefs, rotation, saveLibraryPrefs, type LibraryPrefs } from '../state/library-prefs';
import * as L from '../state/layout';
import { KEYS, debouncedWriter, readString, writeJSON, writeString } from '../state/persistence';
import { buildSceneList, discardParked, paramKey, saveUserScenes, userScene, type ParkedScenes } from '../state/scene-list';
import { Store } from '../state/store';
import { TempoClock } from '../state/tempo-clock';
import { initialUIState, type DownloadView, type DragId, type HelpId, type MoodLabel, type Overlay, type UIState } from '../state/ui-state';
import { EditorCore } from './editor';
import type { StudioSession } from './studio';
import { Transport } from './transport';

const SOURCE_LABELS: Record<string, string> = { mic: 'Microphone / line-in', display: 'Tab / system audio', demo: 'Demo beat (124 BPM)' };
const COOL = [0.7, 0.85, 1.35];
const WARM = [1.3, 1.05, 0.7];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const viewport = (): L.Size => ({ width: window.innerWidth, height: window.innerHeight });

// Hooks other panels plug in. All optional; the controller works without them.
export interface ControllerHooks {
  // The code editor follows the scene on screen while it's open.
  onSceneChanged?: (index: number) => void;
  // The studio draws its Preview monitor and glides its master fader every frame.
  onFrame?: (dt: number, program: ProgramState) => void;
  onBeat?: () => void;          // a detected bass hit
  onTempoBeat?: () => void;     // a tick of the tempo clock (keeps going through breakdowns)
  // Studio mode: Program no longer shows a show scene after a manual switch.
  onManualSceneChange?: () => void;
  // Studio dock: which parameters the overlay edits.
  paramsOverride?: () => { title: string; specs: ParamSpec[]; values: ParamValues; onChange: (spec: ParamSpec, v: ParamValue) => void; onReset: () => void } | null;
  master?: () => number;
  autopilot?: () => boolean;
  // Studio: while the Live slot is pinned (studio closed after a take), projectors get this instead
  // of what the main window shows.
  liveProgram?: (base: ProgramState) => { program: ProgramState; params: Record<number, SceneUniforms> } | null;
  // Studio actions reached from the global shortcuts.
  take?: () => void;
  blackout?: () => void;
  studioStep?: (dir: number) => void;
  studioCue?: (n: number) => void;
  // The studio session itself, for the assistant's show tools and the director.
  studio?: () => StudioSession;
  // Scene library keyboard navigation.
  librarySearch?: () => void;
  libraryMove?: (dx: number, dy: number) => void;
  libraryPick?: () => void;
  libraryTab?: (dir: number) => void;
  // First Escape inside an overlay may just leave a text field; returns true when it was consumed.
  escape?: () => boolean;
  // Visual maker: Delete removes the selected block.
  deleteNode?: () => void;
}

// What a SoundCloud / YouTube picker offers the rest of the app: its results double as the play queue.
export interface PickerApi {
  playNext(): boolean;
  playPrev(): boolean;
  readonly hasQueue: boolean;
  readonly busy: boolean;
  cancel(): void;
}

export class AppController {
  readonly audio = new AudioEngine();
  readonly media = new MediaLayer();
  readonly game = new BeatRacer();
  readonly paramStore = new ParamStore();
  readonly renderer: Renderer;
  readonly output: OutputLink;
  readonly state: AppState;
  readonly ui: Store<UIState>;
  // Where every control widget and the assistant bubble sit; persisted, see src/state/layout.ts.
  readonly layout = new Store<L.Layout>(this.initialLayout());
  readonly player: HTMLAudioElement;
  readonly transport: Transport;
  readonly sceneParams: ParamSpec[][] = [];
  // Saved scenes / edits that didn't compile on this device; kept stored, listed in the library.
  readonly parked: ParkedScenes;
  readonly tempo = new TempoClock();
  readonly editor: EditorCore;
  readonly pickers: Partial<Record<'sc' | 'yt', PickerApi>> = {};
  libraryPrefs: LibraryPrefs = loadLibraryPrefs();
  readonly hooks: ControllerHooks = {};
  mediaSound = readString(KEYS.mediaSound) === '1';

  private raf = 0;
  private last = 0;
  private meterTick = 0;
  private recorder: MediaRecorder | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private toastKey = 0;
  private readonly downloads = new Map<'sc' | 'yt', DownloadView>();
  private disposed = false;
  private readonly layoutWriter = debouncedWriter(KEYS.layout, () => this.layout.get());
  private readonly program: ProgramState;
  private readonly liveParams: Record<number, SceneUniforms> = {};
  private readonly wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const ui = this.ui.get();
      if (this.audio.kind && !ui.overlay && !ui.assistantOpen && !ui.help && !ui.dragging && !this.pickers.sc?.busy && !this.pickers.yt?.busy) document.body.classList.add('idle');
    }, 3000);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, []);   // the scene list is attached right below (same array)
    const list = buildSceneList(this.renderer);
    (this.renderer as unknown as { scenes: Scene[] }).scenes = list.scenes;
    this.parked = list.parked;
    this.state = {
      scenes: list.scenes, gameIndex: list.gameIndex, customIndex: list.customIndex, nodesIndex: list.nodesIndex, keyedScenes: list.keyedScenes,
      look: defaultLook(), clock: defaultClock(), activeSource: null,
    };
    this.ui = new Store(initialUIState(this.state.look));
    this.ui.set({ startupErrors: list.errors, mediaSound: this.mediaSound });
    this.renderer.setMedia(this.media);
    this.renderer.setScale(this.state.look.resolution);
    this.output = new OutputLink(list.scenes, (outputs) => this.ui.set({ outputs }));

    this.player = document.createElement('audio');
    this.player.hidden = true;
    this.player.addEventListener('ended', () => {
      if (this.queueFor(this.state.activeSource)?.playNext()) return;
      if (this.state.activeSource === 'media') { this.player.currentTime = 0; this.player.play().catch(() => {}); }   // a video's sound loops like its picture
    });
    this.transport = new Transport(this.player, this.audio, (transport) => this.ui.set({ transport }), {
      onPrev: () => !!this.queueFor(this.state.activeSource)?.playPrev(),
      onNext: () => !!this.queueFor(this.state.activeSource)?.playNext(),
    });

    list.scenes.forEach((s, i) => this.setSceneParams(i, s.params ?? []));
    this.editor = new EditorCore(this);
    this.audio.onBeat = () => this.beat();
    this.program = {
      scene: 0, prevScene: -1, mix: 1, time: 0, bass: 0, mid: 0, high: 0, level: 0, beat: 0, hue: 0,
      spectrum: this.audio.spectrum, extra: {}, bright: 0.5, mood: 0.5,
      grade: { exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
      feedback: 0.86, zoom: 1, rotation: 0, hueDrift: 0, warp: 0, aberration: 0, master: 1,
    };
    this.publishScene();
  }

  // ---------- Lifecycle ----------

  start(): void {
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(ev, this.wake, { passive: true });
    this.wake();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (this.ui.get().startupErrors.length) setTimeout(() => this.toast(`Couldn't compile your saved scene(s): ${this.ui.get().startupErrors.join(', ')} — kept in the library under "Doesn't compile here"`, 6000), 500);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.removeEventListener(ev, this.wake);
    clearTimeout(this.idleTimer);
    clearTimeout(this.toastTimer);
    this.recorder?.stop();
    this.layoutWriter.dispose();
    this.transport.dispose();
    this.output.dispose();
    this.paramStore.dispose();
    this.audio.dispose();
    this.media.dispose();
    this.renderer.dispose();
  }

  // Panels plug their hooks in while mounted; the returned function unplugs them.
  setHooks(hooks: Partial<ControllerHooks>): () => void {
    Object.assign(this.hooks, hooks);
    return () => { for (const k of Object.keys(hooks) as (keyof ControllerHooks)[]) if (this.hooks[k] === hooks[k]) delete this.hooks[k]; };
  }

  // The studio session (null until the Studio panel has mounted).
  studio(): StudioSession | null { return this.hooks.studio?.() ?? null; }

  // ---------- UI helpers ----------

  toast(text: string, ms = 3500): void {
    this.ui.set({ toast: { text, key: ++this.toastKey } });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.ui.set({ toast: null }), ms);
  }

  get overlay(): Overlay { return this.ui.get().overlay; }

  setOverlay(overlay: Overlay): void {
    if (this.ui.get().overlay === overlay) return;
    // Hand the keyboard back to the shortcuts: a text field inside the closing overlay keeps focus
    // otherwise (overlays slide out, they are not display:none).
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    this.ui.set({ overlay, help: null });
    this.showParams();
    this.wake();
  }

  toggleOverlay(overlay: Exclude<Overlay, null>): void {
    this.setOverlay(this.overlay === overlay ? null : overlay);
  }

  // The assistant floats in its own bubble and can stay open next to any overlay.
  toggleAssistant(open = !this.ui.get().assistantOpen): void {
    if (this.ui.get().assistantOpen === open) return;
    if (!open && document.activeElement instanceof HTMLElement && document.activeElement.closest('#ai')) document.activeElement.blur();
    this.ui.set({ assistantOpen: open, help: null });
    this.wake();
  }

  // Help lives in the store, not in the popover's own state: every action that shows or hides an area
  // (setOverlay, toggleAssistant, toggleWidgets, any layout change) closes it, so it can't outlive the
  // panel it explains.
  setHelp(help: HelpId | null): void {
    this.ui.set({ help });
    this.wake();
  }

  toggleHelp(help: HelpId): void {
    this.setHelp(this.ui.get().help === help ? null : help);
  }

  // H: hides every widget for this session. Deliberately not persisted, so a new session never
  // starts with all the controls invisible.
  toggleWidgets(): void {
    const hidden = !this.ui.get().widgetsHidden;
    this.ui.set({ widgetsHidden: hidden, help: null });
    if (hidden) this.toast('Press H to show the controls again', 2000);
  }

  // ---------- Layout ----------

  private initialLayout(): L.Layout {
    const { layout, migrated } = L.loadLayout();
    if (migrated) writeJSON(KEYS.layout, layout);
    return layout;
  }

  private setLayout(next: L.Layout): void {
    if (!this.layout.set(next)) return;
    this.ui.set({ help: null });
    this.layoutWriter.schedule();
  }

  dockWidget(id: L.WidgetId, zone: L.Zone, index: number): void { this.setLayout(L.dock(this.layout.get(), id, zone, index)); }
  floatWidget(id: L.WidgetId, rect: L.Rect): void { this.setLayout(L.float(this.layout.get(), id, rect, viewport())); }
  resetWidget(id: L.WidgetId): void { this.setLayout(L.resetWidget(this.layout.get(), id)); }
  setWidgetOpen(id: L.WidgetId, open: boolean): void { this.setLayout(L.setOpen(this.layout.get(), id, open)); }
  moveBubble(rect: L.Rect): void { this.setLayout(L.moveBubble(this.layout.get(), rect, viewport())); }
  // Hiding the assistant's bubble closes the chat too (I still opens it).
  setBubbleShown(shown: boolean): void {
    this.setLayout(L.setBubbleShown(this.layout.get(), shown));
    if (!shown) this.toggleAssistant(false);
  }

  setDockWidth(zone: L.SideZone, width: number): void { this.setLayout(L.setDockWidth(this.layout.get(), zone, width)); }

  // A resized floating widget is re-anchored from its new rectangle, so the corner it was dragged by
  // stays where it was let go.
  resizeWidget(id: L.WidgetId, size: Partial<L.WidgetSize>, rect?: L.Rect): void {
    let next = L.resize(this.layout.get(), id, size);
    if (rect && next.widgets[id].place.kind === 'float') next = L.float(next, id, rect, viewport());
    this.setLayout(next);
  }

  toggleWidgetCollapsed(id: L.WidgetId): void {
    const layout = this.layout.get();
    this.setLayout(L.setCollapsed(layout, id, !layout.widgets[id].collapsed));
  }

  resetLayout(): void {
    this.setLayout(L.resetLayout());
    this.ui.set({ widgetsHidden: false });
    this.toast('Layout reset', 1500);
  }

  // A widget or the bubble is being dragged (or a widget resized): the controls don't go idle.
  setDragging(dragging: DragId | null): void {
    this.ui.set({ dragging, ...(dragging && { help: null }) });
    this.wake();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------- Scenes ----------

  get scenes(): Scene[] { return this.state.scenes; }
  get sceneIndex(): number { return this.state.clock.scene; }
  get currentScene(): Scene { return this.state.scenes[this.state.clock.scene]!; }

  keyFor(i: number): string {
    const s = this.state.scenes[i];
    if (!s) return '';
    if (s.kind === 'game') return 'G';
    if (s.kind === 'custom') return 'E';
    if (s.kind === 'nodes') return 'N';
    const n = this.state.keyedScenes.indexOf(i);
    return n >= 0 ? String((n + 1) % 10) : '';
  }

  sceneByName(name: string): number { return this.state.scenes.findIndex((s) => s.name === name && !s.removed); }

  private publishScene(): void {
    const i = this.state.clock.scene;
    const key = this.keyFor(i);
    this.ui.set({ sceneIndex: i, sceneName: `${key ? `${key} · ` : ''}${this.state.scenes[i]?.name ?? ''}`, hud: i === this.state.gameIndex ? this.game.hud() : null });
  }

  bumpScenes(): void { this.ui.set({ sceneVersion: this.ui.get().sceneVersion + 1 }); }

  // ← / → step through every scene, skipping deleted ones.
  stepScene(dir: number): void {
    const scenes = this.state.scenes;
    let i = this.state.clock.scene;
    do i = (i + dir + scenes.length) % scenes.length; while (scenes[i]!.removed);
    this.setScene(i);
  }

  // `fade` is the crossfade time (0 = cut). Changing scene outside the studio means Program no
  // longer shows a show scene.
  setScene(i: number, fade = CROSSFADE_SECONDS, fromStudio = false): void {
    if (!fromStudio) this.hooks.onManualSceneChange?.();
    const c = this.state.clock;
    const scene = this.state.scenes[i];
    if (i === c.scene || !scene || scene.removed) return;
    c.fade = fade;
    if (i === this.state.gameIndex) { this.game.reset(); this.toast('Beat Racer: walls drop on the beat. ← → to steer, Enter to restart', 4500); }
    c.prevScene = c.scene;
    c.scene = i;
    c.transitionStart = c.clock;
    c.sceneStart = c.clock;
    c.beatsInScene = 0;
    this.publishScene();
    this.showParams();
    this.hooks.onSceneChanged?.(i);
  }

  nextRandomScene(): void {
    const choices = rotation(this.state.scenes, this.libraryPrefs).filter((i) => i !== this.state.clock.scene);
    if (choices.length) this.setScene(choices[Math.floor(Math.random() * choices.length)]!);
  }

  // Auto-switch only cycles the visual scenes; it never leaves the game or your own shader.
  // It also holds still while you're editing the scene's code.
  private autoSwitching(): boolean {
    return this.state.look.auto && !this.hooks.autopilot?.() && this.overlay !== 'editor' && !this.currentScene.kind;
  }

  setLibraryPrefs(prefs: LibraryPrefs): void {
    this.libraryPrefs = prefs;
    saveLibraryPrefs(prefs);
    this.bumpScenes();
  }

  // Appends a saved scene (editor "Save to library", assistant create_scene). Returns the index or an error.
  addUserScene(name: string, body: string): { index: number } | { error: string } {
    if (this.sceneByName(name) >= 0) return { error: `A scene called "${name}" already exists.` };
    if (this.parked.userScenes.some((p) => p.name === name)) return { error: `A scene called "${name}" already exists (it doesn't compile on this device).` };
    const scene = userScene(name, body);
    const error = this.renderer.check(scene.frag, name);
    if (error) return { error };
    const index = this.state.scenes.push(scene) - 1;
    this.setSceneParams(index, scene.params);
    saveUserScenes(this.state.scenes, this.parked);
    this.bumpScenes();
    return { index };
  }

  removeUserScene(index: number): void {
    const s = this.state.scenes[index];
    if (!s?.user) return;
    s.removed = true;
    saveUserScenes(this.state.scenes, this.parked);
    if (this.state.clock.scene === index) this.setScene(0);
    this.bumpScenes();
  }

  // A parked scene or edit (didn't compile here) is deleted for good.
  discardParked(kind: 'scene' | 'edit', name: string): void {
    discardParked(this.parked, kind, name, this.state.scenes);
    this.bumpScenes();
  }

  // Loads a parked scene into "My Shader" so it can be fixed; "Save to library" under the same name
  // then replaces the parked copy. Nothing is stored until it compiles.
  openParkedInEditor(name: string): void {
    const p = this.parked.userScenes.find((x) => x.name === name);
    if (!p) return;
    this.editor.customCode = p.body;
    this.editor.libraryName = name;
    this.setScene(this.state.customIndex);
    this.setOverlay('editor');
  }

  // ---------- Live parameters ----------

  setSceneParams(i: number, specs: ParamSpec[]): void {
    this.sceneParams[i] = specs;
    this.pushParams(i);
    this.output.sendScene(i);   // code edits reach the projector live
    if (i === this.state.clock.scene) this.showParams();
  }

  pushParams(i: number): void {
    const scene = this.state.scenes[i];
    if (!scene) return;
    const specs = this.sceneParams[i] ?? [];
    const values = this.paramStore.values(paramKey(scene), specs);
    this.renderer.setParams(i, Object.fromEntries(specs.map((s) => [s.name, toUniform(s, values[s.name]!)])));
  }

  paramValues(i: number): ParamValues {
    const scene = this.state.scenes[i];
    return scene ? this.paramStore.values(paramKey(scene), this.sceneParams[i] ?? []) : {};
  }

  showParams(): void {
    const override = this.hooks.paramsOverride?.();
    if (override) {
      this.ui.set({ params: { title: override.title, specs: override.specs, values: override.values, inStudio: true }, paramsVisible: override.specs.length > 0 });
      return;
    }
    const i = this.state.clock.scene;
    const specs = this.sceneParams[i] ?? [];
    const inStudio = this.overlay === 'studio';
    this.ui.set({ params: { title: inStudio ? `${this.currentScene.name} — live` : this.currentScene.name, specs, values: this.paramValues(i), inStudio }, paramsVisible: specs.length > 0 });
  }

  setParam(spec: ParamSpec, value: ParamValue): void {
    const override = this.hooks.paramsOverride?.();
    if (override) return override.onChange(spec, value);
    const i = this.state.clock.scene;
    this.paramStore.set(paramKey(this.currentScene), spec, value);
    this.pushParams(i);
    this.showParams();
  }

  resetParams(): void {
    const override = this.hooks.paramsOverride?.();
    if (override) return override.onReset();
    const i = this.state.clock.scene;
    this.paramStore.reset(paramKey(this.currentScene));
    this.pushParams(i);
    this.showParams();
  }

  // ---------- Look ----------

  setLook(key: LookKey, value: number): void {
    const r = LOOK_RANGES[key];
    const v = Math.min(r.max, Math.max(r.min, value));
    this.state.look[key] = v;
    if (key === 'resolution') this.renderer.setScale(v);
    this.ui.set({ look: { ...this.state.look } });
  }

  setLookFlag(key: 'mood' | 'auto', value: boolean): void {
    this.state.look[key] = value;
    this.ui.set({ look: { ...this.state.look } });
  }

  toggleAuto(): boolean {
    this.setLookFlag('auto', !this.state.look.auto);
    this.toast(`Auto-switch ${this.state.look.auto ? 'on' : 'off'}`, 1500);
    return this.state.look.auto;
  }

  randomize(): void {
    this.setLook('hue', Math.random());
    this.setLook('trails', 0.75 + Math.random() * 0.2);
    this.setLook('cycle', Math.random() * 1.5);
    this.setLook('aberration', Math.random() * 0.025);
    this.state.look.spin = Math.random() < 0.5 ? -1 : 1;
    this.nextRandomScene();
  }

  // Crossmodal correspondences: dark/muffled sound reads as dim, cool and soft; bright/crisp sound
  // as light, warm and sharp. Fast, energetic music reads as saturated and warm; slow as muted and cool.
  private colourGrade(bright: number): void {
    const look = this.state.look;
    const A = look.synesthesia;
    const mood = look.mood ? this.state.clock.mood : 0.5;
    const warmth = look.mood ? bright * 0.6 + mood * 0.4 : bright;
    const g = this.program.grade;
    const tint = g.tint;
    for (let i = 0; i < 3; i++) tint[i] = COOL[i]! + (WARM[i]! - COOL[i]!) * warmth;
    const luma = tint[0]! * 0.299 + tint[1]! * 0.587 + tint[2]! * 0.114;   // tint shifts colour, not brightness
    for (let i = 0; i < 3; i++) tint[i] = 1 + A * (tint[i]! / luma - 1);
    g.exposure = 1 + A * (bright - 0.5) * 0.9;
    g.contrast = 1 + A * (bright - 0.5) * 0.3;
    g.saturation = 1 + A * (mood - 0.5) * 0.8;
  }

  private updateMood(dt: number): void {
    const c = this.state.clock;
    const tempo = c.bpm ? clamp01((c.bpm - 80) / 80) : 0.5;   // 80 BPM calm … 160 BPM energetic
    const energy = clamp01((this.audio.avg.level - 0.15) / 0.4);
    const target = this.audio.kind ? tempo * 0.65 + energy * 0.35 : 0.5;
    c.mood += (target - c.mood) * (1 - Math.exp(-dt / 4));
  }

  // ---------- Sources ----------

  async startSource(kind: SourceButton, pickFile?: () => void, openSoundCloud?: () => void): Promise<void> {
    try {
      if (kind === 'file') return pickFile?.();
      if (kind === 'soundcloud') return openSoundCloud?.();
      this.player.pause();
      if (kind === 'mic') await this.audio.useMicrophone();
      if (kind === 'display') await this.audio.useDisplayAudio();
      if (kind === 'demo') await this.audio.useDemo();
      this.onSourceStarted(SOURCE_LABELS[kind] ?? kind, kind);
      this.transport.setMode(kind === 'demo' ? 'demo' : null);
    } catch (err) {
      const e = err as Error;
      if (e.name === 'NotAllowedError') this.toast('Permission denied or capture cancelled.');
      else this.toast(e.message || String(err));
    }
  }

  async playFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name)) {
      return this.toast(`"${file.name}" doesn't look like an audio file.`);
    }
    await this.playUrl(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''), 'file');
  }

  // Plays through the <audio> element (local files, SoundCloud tracks, a video's sound), so seeking works.
  async playUrl(src: string, label: string, sourceButton: SourceButton): Promise<void> {
    const player = this.player;
    if (player.src.startsWith('blob:') && player.src !== this.media.url) URL.revokeObjectURL(player.src);
    player.src = src;
    try {
      await this.audio.useElement(player);
      await player.play();
      this.onSourceStarted(label, sourceButton);
      this.transport.setMode('element', { hasQueue: !!this.queueFor(sourceButton)?.hasQueue });
    } catch (err) {
      this.toast(`Couldn't play this: ${(err as Error).message}`);
    }
  }

  togglePlay(): void {
    const kind = this.audio.kind;
    if (kind === 'file') { if (this.player.paused) this.player.play().catch(() => {}); else this.player.pause(); }
    else if (kind === 'demo') { this.audio.detach(); this.ui.set({ nowText: '❚❚ Demo beat paused' }); this.transport.setMode('demo'); }
    else if (!kind && this.ui.get().nowText.includes('Demo')) void this.startSource('demo');
  }

  private onSourceStarted(label: string, sourceButton: SourceButton): void {
    this.state.activeSource = sourceButton;
    if (sourceButton !== 'media' && this.mediaSound) this.setMediaSound(false, { quiet: true });   // another source is the music now
    this.ui.set({ nowText: `▶ ${label}`, started: true, activeSource: sourceButton });
    document.body.classList.add('started');
    if (readString(KEYS.helpHint) !== '1') { writeString(KEYS.helpHint, '1'); this.toast('Press ? for help & shortcuts', 4000); }
    this.state.clock.beatTimes = [];
    this.state.clock.bpm = null;
    this.tempo.reset();
  }

  // Dropped anywhere: audio plays, pictures and videos become the media.
  drop(file: File | undefined): void {
    if (!file) return;
    if (isMediaFile(file) && !file.type.startsWith('audio/')) void this.loadMedia(file);
    else void this.playFile(file);
  }

  // ---------- Media (image / video to distort) ----------

  async loadMedia(source: MediaSource): Promise<void> {
    try {
      await this.media.load(source);
    } catch (err) {
      return this.toast((err as Error).message, 6000);
    }
    this.output.sendMedia(source);
    this.mediaChanged();
    if (this.mediaSound && this.media.kind === 'video') await this.linkMediaSound();
    else if (this.state.activeSource === 'media') this.player.pause();
    if (!this.renderer.usesMedia(this.state.clock.scene)) this.setScene(this.state.scenes.findIndex((s) => s.cat === 'Media'));
    this.toast(`${this.media.kind === 'video' ? 'Video' : 'Image'} loaded — the Media scenes distort it (library → Media). In code, sample it with media(p).`, 5000);
  }

  clearMedia(): void {
    if (this.state.activeSource === 'media') this.player.pause();
    this.media.clear();
    this.output.sendMedia(null);
    this.mediaChanged();
  }

  private mediaChanged(): void {
    const [w, h] = this.media.size;
    this.ui.set({ media: { name: this.media.name, kind: this.media.kind, width: w, height: h, loaded: !!this.media.el } });
    this.bumpScenes();   // library previews show the new picture
  }

  // "Use the video's sound": the <audio> player plays the same file as the music (so the transport,
  // tempo and volume work) and the picture follows it.
  setMediaSound(on: boolean, { quiet = false } = {}): void {
    this.mediaSound = on;
    writeString(KEYS.mediaSound, on ? '1' : '0');
    this.ui.set({ mediaSound: on });
    if (quiet) return;
    if (on && this.media.kind === 'video') void this.linkMediaSound();
    else if (!on && this.state.activeSource === 'media') {
      this.player.pause();
      this.state.activeSource = null;
      this.ui.set({ nowText: '❚❚ Video sound off — pick a music source', activeSource: null });
    }
  }

  private async linkMediaSound(): Promise<void> {
    if (!this.media.url) return;
    await this.playUrl(this.media.url, this.media.name, 'media');
    this.player.currentTime = this.media.time;
  }

  // ---------- Pickers & downloads ----------

  // The picker whose results act as the queue for the current source.
  queueFor(source: SourceButton | null): PickerApi | null {
    if (source === 'soundcloud') return this.pickers.sc ?? null;
    if (source === 'media' && this.media.source && !(this.media.source instanceof Blob) && this.media.source.site === 'youtube') return this.pickers.yt ?? null;
    return null;
  }

  registerPicker(id: 'sc' | 'yt', api: PickerApi): () => void {
    this.pickers[id] = api;
    return () => { if (this.pickers[id] === api) delete this.pickers[id]; };
  }

  cancelDownload(id: 'sc' | 'yt'): void { this.pickers[id]?.cancel(); }

  // Downloads in progress are shown at the top of the panel so you can follow them with the picker closed.

  setDownload(id: 'sc' | 'yt', view: Omit<DownloadView, 'id'> | null): void {
    if (view) this.downloads.set(id, { id, ...view }); else this.downloads.delete(id);
    this.ui.set({ downloads: [...this.downloads.values()] });
  }

  // ---------- Beats ----------

  private beat(): void {
    const c = this.state.clock;
    c.huePhase += 0.03 * this.state.look.reactivity;
    c.beatsInScene++;
    c.beatTimes.push(c.clock);
    if (c.beatTimes.length > 12) c.beatTimes.shift();
    // The tempo is held once known (the raw estimate expires two seconds after the last hit).
    const bpm = estimateBpm(c.beatTimes, c.clock);
    if (bpm) { c.bpm = bpm; this.tempo.setBpm(bpm); }
    if (c.scene === this.state.gameIndex) this.game.onBeat();
    if (this.autoSwitching() && c.beatsInScene >= BEATS_PER_SCENE) this.nextRandomScene();
    this.hooks.onBeat?.();
    if (this.tempo.onDetectedBeat(c.clock)) this.hooks.onTempoBeat?.();
  }

  // ---------- Recording ----------

  toggleRecording(): void {
    if (this.recorder) return this.recorder.stop();
    const stream = this.renderer.canvas.captureStream(60);
    if (this.audio.recordDest) this.audio.recordDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    this.recorder = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hallucinate-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      this.recorder = null;
      this.ui.set({ recording: false });
      if (!this.disposed) this.toast('Recording saved');
    };
    recorder.start(1000);
    this.ui.set({ recording: true });
    this.toast('Recording… press C or click "Stop rec" to save');
  }

  // ---------- Main loop ----------

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const c = this.state.clock;
    const look = this.state.look;
    c.clock += dt;

    const f = this.audio.update(dt, c.clock);
    const R = look.reactivity;
    const bass = Math.min(1.5, f.bass * R);
    const mid = Math.min(1.5, f.mid * R);
    const high = Math.min(1.5, f.high * R);
    const level = Math.min(1.5, f.level * R);
    const beat = Math.min(1.5, f.beat * R);

    // Ease the clock's speed instead of jumping it on every beat, so motion stays fluid.
    const targetRate = look.speed * (0.55 + level * 0.9 + beat * 0.35);
    c.timeRate += (targetRate - c.timeRate) * (1 - Math.exp(-dt * 3));
    c.time += dt * c.timeRate;
    c.huePhase += dt * look.cycle * 0.06;
    this.updateMood(dt);
    if (this.state.activeSource === 'media') this.media.follow(this.player);

    if (this.autoSwitching() && this.audio.kind && c.clock - c.sceneStart > MAX_SECONDS_PER_SCENE) this.nextRandomScene();
    if (this.audio.kind && this.tempo.advance(c.clock)) this.hooks.onTempoBeat?.();   // scheduled tick (no kick needed)
    const inGame = c.scene === this.state.gameIndex;
    if (inGame) this.game.update(dt, level);
    const mix = c.fade > 0 ? smoothstep((c.clock - c.transitionStart) / c.fade) : 1;
    if (mix >= 1) c.prevScene = -1;

    const p = this.program;
    p.scene = c.scene; p.prevScene = c.prevScene; p.mix = mix;
    p.time = c.time; p.bass = bass; p.mid = mid; p.high = high; p.level = level; p.beat = beat;
    p.hue = look.hue + c.huePhase;
    p.extra = inGame ? this.game.uniforms() : p.extra;
    p.bright = f.bright; p.mood = c.mood;
    this.colourGrade(f.bright);
    // dark sound lingers (longer trails), bright sound is crisp (shorter trails, more fringing)
    p.feedback = Math.min(0.97, look.trails * (this.currentScene.trails ?? 1) * (1 + look.synesthesia * (0.5 - f.bright) * 0.12));
    p.zoom = 1.006 + bass * 0.025;
    p.rotation = look.spin * (0.003 * Math.sin(c.time * 0.1) + mid * 0.01);
    p.hueDrift = 0.01 + high * 0.03;
    p.warp = bass;
    p.aberration = look.aberration * (1 + beat * 1.5) * (1 + look.synesthesia * (f.bright - 0.5) * 1.2);
    p.master = this.hooks.master?.() ?? 1;
    p.mediaTime = this.media.time; p.mediaPaused = this.media.video?.paused ?? true; p.mediaRate = this.media.video?.playbackRate ?? 1;
    this.renderer.render(p);
    if (this.output.connected) {
      const pinned = this.hooks.liveProgram?.(p);
      if (pinned) this.output.sendFrame(pinned.program, pinned.params, look.resolution);
      else {
        const live = this.liveParams;
        for (const k in live) delete live[k];
        live[c.scene] = this.renderer.sceneParams[c.scene] ?? {};
        if (c.prevScene >= 0) live[c.prevScene] = this.renderer.sceneParams[c.prevScene] ?? {};
        this.output.sendFrame(p, live, look.resolution);
      }
    }
    this.hooks.onFrame?.(dt, p);

    if (++this.meterTick % 2 === 0) {
      const tone = f.bright < 0.35 ? 'dark' : f.bright > 0.65 ? 'bright' : 'balanced';
      const moodLabel: MoodLabel = !look.mood || !this.audio.kind ? '' : c.mood < 0.35 ? 'mood: calm' : c.mood > 0.65 ? 'mood: energetic' : 'mood: groovy';
      this.ui.set({
        meters: { bass: f.bass, mid: f.mid, high: f.high, bright: f.bright, centroid: f.centroid, beat: f.beat },
        bpm: c.bpm,
        moodLabel,
        toneTitle: `Timbral brightness: ${tone} (spectral centroid ≈ ${(f.centroid / 1000).toFixed(1)} kHz)`,
        ...(inGame && { hud: this.game.hud() }),
      });
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}

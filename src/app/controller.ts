// The app's brain: owns the engines, the shared scene list and the frame loop, and exposes the
// actions the UI calls. It is created once (outside React's render) and handed to the tree through
// AppContext. Panels that need deeper hooks (editor, studio, assistant) register them here.

import { AudioEngine } from '../engine/audio';
import * as Effects from '../engine/effects';
import { HearingRecorder } from '../engine/hearing-history';
import { Listener, moodWord, toneWord, type Hearing } from '../engine/listener';
import { systemLog } from '../log/system-log';
import { composeFrame, composeStill, crossfade, programState } from '../engine/look';
import { MediaLayer, StaleMediaLoad, isMediaFile, type MediaSource } from '../engine/media';
import { applyRendererPrefs, OutputLink } from '../engine/output-link';
import { ParamStore, toUniform, type ParamSpec, type ParamValue, type ParamValues } from '../engine/params';
import { FrameProfiler, Stage, installGlobal, uninstallGlobal, type FillResult, type PerfReport, type ProfilerApi } from '../engine/profiler';
import { Renderer, type ProgramState } from '../engine/renderer';
import { readInputs, silentSpectrum, stillSpectrum, stillUniforms } from '../engine/scene-inputs';
import { userSceneId, type Scene } from '../scenes';
import { BEATS_PER_SCENE, CROSSFADE_SECONDS, LOOK_KEYS, clampLook, MAX_SECONDS_PER_SCENE, PALETTE_MAX, SLIDER_KEYS, defaultClock, defaultLook, type AppState, type AutoSlots, type LookKey, type Palette, type SliderKey, type SourceButton, type XYAxes } from '../state/app-state';
import { DRIFT_KEYS, LookDrift, RANDOM_RANGES, type DriftKey } from '../state/look-drift';
import { loadLibraryPrefs, rotation, saveLibraryPrefs, type LibraryPrefs } from '../state/library-prefs';
import * as L from '../state/layout';
import { KEYS, QUICK_WRITE_MS, debouncedWriter, flushAll, freeze, readFlag, readString, remove, unfreeze, writeFlag, writeJSON, writeString } from '../state/persistence';
import { DEFAULT_PREFS, loadPrefs, micConstraints, outputPrefs, type PrefKey, type Prefs } from '../state/prefs';
import { SceneHistory } from '../state/scene-history';
import { buildSceneList, isBuiltin, paramKey, stepScene } from '../state/scene-list';
import { takeRenameReport } from '../state/scene-renames';
import { ROUTE_TARGETS, followed, type Route, type RouteTarget } from '../engine/look-routes';
import { loadLook, lookWriter } from '../state/look-store';
import { LookGlide, SLOT_NAMES, applyIntensity, loadLookSlots, lookSlotsWriter, nextSlot, slotOf, slotWithRoutes, type LookSlots } from '../state/look-slots';
import { loadScreenEffects, screenEffectsWriter } from '../state/screen-effects';
import { Store } from '../state/store';
import { initialUIState, type DownloadView, type DragId, type HearingView, type HelpId, type MoodLabel, type Overlay, type UIState } from '../state/ui-state';
import { applyWrites, buildBundle, parseBundle } from './bundle';
import { downloadFile, fileStamp } from './download';
import { EditorCore } from './editor';
import { LiveSlot, type Shot } from './live-slot';
import { MusicSource } from './music-source';
import { SceneLibrary, type SceneChange } from './scene-library';
import { Transport } from './transport';
import { fract } from '../engine/math';

const RANDOM_HISTORY = 20;   // how many Randomize presses Shift+R can step back through
const LOOK_PUBLISH_FRAMES = 6;
const NOT_FOLLOWED = {};   // no slider follows the music   // the Look widget follows Drift and the hue on screen at ~10 Hz
const PERF_PUBLISH_MS = 500;   // the performance overlay updates twice a second, however slow the frames
const HEARING_PUBLISH_FRAMES = 4;   // the Hearing monitor follows at ~15 Hz: its lights and traces move

const viewport = (): L.Size => ({ width: window.innerWidth, height: window.innerHeight });

// Hooks other panels plug in. All optional; the controller works without them.
export interface ControllerHooks {
  // The studio draws its Preview monitor and glides its master fader every frame.
  onFrame?: (dt: number, program: ProgramState) => void;
  onTempoBeat?: () => void;     // a tick of the tempo clock (keeps going through breakdowns)
  // Studio mode: Program no longer shows a show scene after a manual switch.
  onManualSceneChange?: () => void;
  // Studio dock: which parameters the overlay edits.
  paramsOverride?: () => { title: string; key: string; specs: readonly ParamSpec[]; values: ParamValues; onChange: (spec: ParamSpec, v: ParamValue) => void; onReset: () => void } | null;
  master?: () => number;
  autopilot?: () => boolean;
  // First Escape inside an overlay may just leave a text field; returns true when it was consumed.
  escape?: () => boolean;
  // A device preference changed (the studio's Preview renderer follows the pixel density).
  onPrefs?: (prefs: Prefs) => void;
}

// What a SoundCloud / YouTube picker offers the rest of the app: its results double as the play queue.
export interface PickerApi {
  playNext(): boolean;
  playPrev(): boolean;
  readonly hasQueue: boolean;
  readonly busy: boolean;
  cancel(): void;
  clearRecent(): void;   // forgets the "Recently played" list
}

export class AppController {
  readonly audio = new AudioEngine();
  readonly media = new MediaLayer();
  readonly renderer: Renderer;
  readonly output: OutputLink;
  // The pinned Live slot (studio closed after a take): what projectors and the screen show, see live-slot.ts.
  readonly live: LiveSlot;
  readonly state: AppState;
  readonly ui: Store<UIState>;
  // Where every control widget and the assistant bubble sit; persisted, see src/state/layout.ts.
  readonly layout = new Store<L.Layout>(this.initialLayout());
  readonly player: HTMLAudioElement;
  readonly transport: Transport;
  // What the music is: the source playing, the "now playing" line, play / pause (music-source.ts).
  readonly music: MusicSource;
  // Each scene's code, @params and stored values; adding, compiling and removing scenes (scene-library.ts).
  readonly library: SceneLibrary;
  readonly history = new SceneHistory();   // every scene's versions (scene-history.ts)
  // What the music sounds like this frame: bands, kicks, tempo, tone, mood (listener.ts).
  readonly listener = new Listener();
  private readonly hearingRecorder = new HearingRecorder();   // the Hearing monitor's last minute, while it is open
  readonly editor: EditorCore;
  readonly pickers: Partial<Record<'sc' | 'yt', PickerApi>> = {};
  libraryPrefs: LibraryPrefs;   // read after the scene list is built: a rename on load moves entries in it
  readonly hooks: ControllerHooks = {};
  mediaSound = readFlag(KEYS.mediaSound);
  // Device preferences (Settings overlay, src/state/prefs.ts).
  readonly prefs = new Store<Prefs>(loadPrefs());
  // Where each frame's time goes (Shift+P, or ?perf / ?perf=trace in the URL). Off: one flag check per stage.
  readonly profiler = new FrameProfiler();
  // What the app, the console and the server have said (Shift+S); the app's own events are written here.
  readonly log = systemLog;

  private raf = 0;
  private frameError: string | null = null;   // the last per-frame error reported (each is logged once)
  private loggedBpm: number | null = null;    // the tempo the System log last reported (it logs a lock and a loss, not every frame)
  private loggedOutputs = 0;
  private last = 0;
  private meterTick = 0;
  private perfPublishedAt = 0;
  private recorder: MediaRecorder | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly drift = new LookDrift();
  private lookFrames = 0;
  private readonly beforeRandom: { look: Record<DriftKey, number>; scene: number }[] = [];   // Shift+R steps back through these
  private toastKey = 0;
  private readonly downloads = new Map<'sc' | 'yt', DownloadView>();
  private disposed = false;
  private readonly layoutWriter = debouncedWriter(KEYS.layout, () => this.layout.get());
  private readonly prefsWriter = debouncedWriter(KEYS.prefs, () => this.prefs.get(), QUICK_WRITE_MS);
  private readonly effectsWriter = screenEffectsWriter(() => this.state.effects);
  private readonly lookWriter = lookWriter(() => this.state.look);
  private lookSlots: LookSlots = loadLookSlots();
  private readonly lookSlotsWriter = lookSlotsWriter(() => this.lookSlots);
  private readonly glide = new LookGlide();   // a slot being recalled
  private slotAt = -1;      // the slot last recalled or stored, where auto-change goes on from
  private slotBeats = 0;    // kicks since the last slot change, for auto-change
  // While a show scene crossfades in on the main screen, the stack the outgoing picture keeps; null once the
  // crossfade ends (or on a manual scene change), when the outgoing picture draws with the screen's own.
  private outgoingEffects: Effects.EffectStack | null = null;
  private readonly program: ProgramState;
  private readonly paramStore: ParamStore;   // likewise
  private readonly profilerApi: ProfilerApi = {
    report: () => (this.profiler.on ? this.perfReport() : null),
    fillTest: () => this.runFillTest(),
    reset: () => this.profiler.reset(),
    scenes: () => this.state.scenes.flatMap((s, index) => (s.removed ? [] : [{ index, name: s.name, cat: s.cat, params: s.params.length, builtin: isBuiltin(s) }])),
    setScene: (index) => this.setScene(index),
    still: async (index, { inputs = {}, silent = false, look, effects } = {}) => {
      const s = this.state.scenes[index];
      const error = s ? this.renderer.check(s.frag, s.name) : `No scene at ${index}`;
      if (error) return { error, image: null };
      const spectrum = silent ? silentSpectrum() : undefined;
      const shaped = effects?.some((e) => e.on) ?? false;   // a stack with nothing switched on is no effects
      if (!look && !shaped) return { error: null, image: await this.renderer.snapshotAsync(index, stillUniforms(inputs), 1280, 720, spectrum) };
      const frames = composeStill(index, stillUniforms(inputs), look ?? defaultLook(), s!.trails ?? 1, spectrum ?? stillSpectrum(), undefined, effects);
      return { error: null, image: await this.renderer.stillAsync(frames, 1280, 720) };
    },
    stillChange: async (index, { from, to, look, effects }) => {
      const s = this.state.scenes[index];
      const error = s ? this.renderer.check(s.frag, s.name) : `No scene at ${index}`;
      if (error) return { error, images: null };
      const frames = composeStill(index, stillUniforms(from), look, s!.trails ?? 1, stillSpectrum(), stillUniforms(to), effects);
      return { error: null, images: await this.renderer.stillPairAsync(frames, 1280, 720) };
    },
    effectsCost: async (effects, { size = this.renderer.size, frames = 30, rounds = 5 } = {}) => {
      const scale = this.renderer.scale;
      const [w, h] = size.map((x) => Math.max(1, Math.round(x * scale))) as [number, number];
      // The frame on screen now, held still, without a crossfade.
      const burst = (stack: Effects.EffectStack) => Array.from({ length: frames }, (): ProgramState => ({ ...this.program, prevScene: -1, mix: 1, effects: stack, prevEffects: Effects.NO_EFFECTS }));
      const none: number[] = [], shaped: number[] = [];
      for (let i = 0; i < rounds; i++) {   // in turns, so a slower moment weighs on both alike
        none.push(await this.renderer.timeFramesAsync(burst(Effects.NO_EFFECTS), w, h));
        shaped.push(await this.renderer.timeFramesAsync(burst(effects), w, h));
      }
      const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const cost = { none: median(none), with: median(shaped) };
      return { ...cost, extra: cost.with - cost.none, size: [w, h], scale, frames, rounds };
    },
  };
  // Another tab imported settings: this one's state is stale, so it must not write, and reloads.
  // Another tab changed a preference: take it over, so this tab's next write doesn't undo it.
  private readonly onStorage = (e: StorageEvent) => {
    if (e.key === KEYS.prefs) {
      if (this.prefs.set(loadPrefs())) this.applyPrefs();
      return;
    }
    if (e.key !== KEYS.importedAt) return;
    freeze();
    location.reload();
  };
  private readonly wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(this.idleTimer);
    const seconds = this.prefs.get().idleHideSeconds;
    if (seconds === null) return;   // Settings → Interface: the controls never fade
    this.idleTimer = setTimeout(() => {
      const ui = this.ui.get();
      if (this.music.playing && !ui.overlay && !ui.assistantOpen && !ui.assistantPeek && !ui.help && !ui.dragging && !this.pickers.sc?.busy && !this.pickers.yt?.busy) document.body.classList.add('idle');
    }, seconds * 1000);
  };

  constructor(canvas: HTMLCanvasElement) {
    const scenes: Scene[] = [];   // the one shared list: the renderer holds it, buildSceneList fills it
    this.renderer = new Renderer(canvas, scenes);
    const list = buildSceneList(scenes, (frag, name) => this.renderer.check(frag, name));
    this.libraryPrefs = loadLibraryPrefs();
    this.paramStore = new ParamStore();
    this.state = {
      scenes: list.scenes, customIndex: list.customIndex, nodesIndex: list.nodesIndex, keyedScenes: list.keyedScenes,
      look: loadLook(), effects: loadScreenEffects(), clock: defaultClock(), activeSource: null,
    };
    this.ui = new Store(initialUIState(this.state.look));
    this.ui.set({ startupErrors: list.errors, mediaSound: this.mediaSound, effects: this.state.effects, lookSlots: this.lookSlots });
    this.renderer.setMedia(this.media);
    this.output = new OutputLink(list.scenes, (outputs) => { this.ui.set({ outputs }); this.logOutputs(outputs.length); }, outputPrefs(this.prefs.get()));
    for (const r of list.renamed) this.history.rename(userSceneId(r.from), userSceneId(r.to));
    this.library = new SceneLibrary(list.scenes, list.parked, this.renderer, this.paramStore, (i, what) => this.sceneChanged(i, what), this.history);
    this.live = new LiveSlot({ state: this.state, hearing: this.listener.hearing, specs: (i) => this.library.specs(i), stored: this.renderer.sceneParams, ui: this.ui, toast: (text, ms) => this.toast(text, ms) });
    this.applyPrefs();

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
    this.music = new MusicSource({
      audio: this.audio, player: this.player, state: this.state, transport: this.transport,
      publish: (view) => this.ui.set(view),
      started: (source) => this.sourceStarted(source),
    });

    this.state.clock.scene = this.lastScene();   // before the params below, which publish the scene on screen's
    list.scenes.forEach((_, i) => this.pushParams(i));
    this.showParams();
    this.editor = new EditorCore(this);
    this.program = { ...programState(this.listener.spectrum), scene: this.state.clock.scene };
    this.publishScene();
    const perf = new URLSearchParams(location.search).get('perf');
    if (perf !== null) this.setPerf(true, perf === 'trace');
  }

  // ---------- Lifecycle ----------

  start(): void {
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(ev, this.wake, { passive: true });
    this.wake();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    window.addEventListener('storage', this.onStorage);
    setTimeout(() => { if (!this.disposed) this.startupNotice(); }, 500);
  }

  // What happened at startup, in one toast: an import that just finished (its report is shown once),
  // your scenes renamed because a built-in has their name, and saved scenes that don't compile here.
  // Read late, so a controller disposed right away (StrictMode) doesn't swallow a report.
  private startupNotice(): void {
    const imported = readString(KEYS.importReport);
    if (imported !== null) remove(KEYS.importReport);
    const errors = this.ui.get().startupErrors;
    const broken = errors.length ? `Couldn't compile your saved scene(s): ${errors.join(', ')} — kept in the library under "Doesn't compile here"` : '';
    if (errors.length) this.log.app('error', `Couldn't compile your saved scene(s): ${errors.join(', ')}`);
    const notes = [takeRenameReport(), broken].filter(Boolean).map((n) => `${n}.`).join(' ');
    if (imported !== null) this.toast(`Imported ${imported}.${notes ? ` ${notes}` : ''}`, notes ? 9000 : 5000);
    else if (notes) this.toast(notes, 6000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.setPerf(false);   // restores the resolution if a GPU test is running
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.removeEventListener(ev, this.wake);
    window.removeEventListener('storage', this.onStorage);
    clearTimeout(this.idleTimer);
    clearTimeout(this.toastTimer);
    this.recorder?.stop();
    this.layoutWriter.dispose();
    this.prefsWriter.dispose();
    this.effectsWriter.dispose();
    this.lookWriter.dispose();
    this.lookSlotsWriter.dispose();
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

  // The assistant floats in its own bubble and can stay open next to any overlay. `chatId` opens it on
  // that conversation (the bubble's peek card was clicked). The session clears the peek once it's open.
  toggleAssistant(open = !this.ui.get().assistantOpen, chatId?: string): void {
    if (chatId) this.ui.set({ assistantFocus: chatId });
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

  // ---------- Device preferences (Settings overlay) ----------

  setPref<K extends PrefKey>(key: K, value: Prefs[K]): void {
    if (!this.prefs.set({ [key]: value } as Partial<Prefs>)) return;
    this.prefsWriter.schedule();
    this.applyPrefs();
  }

  resetPrefs(): void {
    if (!this.prefs.set(DEFAULT_PREFS)) return;
    this.prefsWriter.schedule();
    this.applyPrefs();
  }

  // Pushes the preferences to whatever uses them: this renderer, the projectors, the studio's Preview
  // monitor (its hook), the Listener, the badges and the idle timer. Resolution reaches the
  // projectors with each frame.
  private applyPrefs(): void {
    const p = this.prefs.get();
    if (p.resolution !== this.renderer.scale) this.profiler.cancelFill();   // a GPU test measures one resolution: any other ends it
    this.renderer.setScale(p.resolution);
    applyRendererPrefs(this.renderer, outputPrefs(p));
    this.output.sendPrefs(outputPrefs(p));
    this.hooks.onPrefs?.(p);
    this.listener.setSmoothing(p.audioSmoothing);
    if (p.showKeyBadges) delete document.body.dataset.kbd; else document.body.dataset.kbd = 'off';
    this.wake();   // the idle delay may have changed
  }

  // Settings → Assistant saved: the assistant's panel asks the server for the backend and model again.
  assistantConfigChanged(): void { this.ui.set({ assistantConfig: this.ui.get().assistantConfig + 1 }); }

  // The "Press ? for help" toast shows again at the next sound source.
  resetHelpHint(): void { remove(KEYS.helpHint); }

  clearRecentTracks(): void {
    for (const id of ['sc', 'yt'] as const) this.pickers[id]?.clearRecent();
    remove(KEYS.scRecent);
    remove(KEYS.ytRecent);
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
  // A monitor (the performance overlay, the Hearing monitor, the System log) floats where it was dropped; reset puts it back
  // in the monitors' corner at its natural size. Resizing re-anchors a moved one from its new rectangle, like a widget.
  moveMonitor(id: L.MonitorId, rect: L.Rect): void { this.setLayout(L.moveMonitor(this.layout.get(), id, rect, viewport())); }
  resetMonitor(id: L.MonitorId): void { this.setLayout(L.resetMonitor(this.layout.get(), id)); }
  resizeMonitor(id: L.MonitorId, size: Partial<L.WidgetSize>, rect?: L.Rect): void {
    let next = L.resizeMonitor(this.layout.get(), id, size);
    if (rect && next[id].kind === 'float') next = L.moveMonitor(next, id, rect, viewport());
    this.setLayout(next);
  }
  // The chat window floats where it was dropped; reset puts it back beside the bubble.
  moveChat(rect: L.Rect): void { this.setLayout(L.moveChat(this.layout.get(), rect, viewport())); }
  resetChat(): void { this.setLayout(L.resetChat(this.layout.get())); }
  // Hiding the assistant's bubble closes the chat too (I still opens it).
  setBubbleShown(shown: boolean): void {
    this.setLayout(L.setBubbleShown(this.layout.get(), shown));
    if (!shown) this.toggleAssistant(false);
  }

  setDockWidth(zone: L.SideZone, width: number): void { this.setLayout(L.setDockWidth(this.layout.get(), zone, width)); }
  resizeChat(size: Partial<L.WidgetSize>): void { this.setLayout(L.resizeChat(this.layout.get(), size)); }

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

  get scenes(): readonly Scene[] { return this.state.scenes; }
  get sceneIndex(): number { return this.state.clock.scene; }
  get currentScene(): Scene { return this.state.scenes[this.state.clock.scene]!; }

  keyFor(i: number): string {
    const s = this.state.scenes[i];
    if (!s) return '';
    if (s.kind === 'custom') return 'E';
    if (s.kind === 'nodes') return 'N';
    const n = this.state.keyedScenes.indexOf(i);
    return n >= 0 ? String((n + 1) % 10) : '';
  }

  sceneByName(name: string): number { return this.state.scenes.findIndex((s) => s.name === name && !s.removed); }

  private publishScene(): void {
    const i = this.state.clock.scene;
    const key = this.keyFor(i);
    this.ui.set({ sceneIndex: i, sceneName: `${key ? `${key} · ` : ''}${this.state.scenes[i]?.name ?? ''}` });
  }

  bumpScenes(): void { this.ui.set({ sceneVersion: this.ui.get().sceneVersion + 1 }); }

  // ← / → step through every scene, skipping deleted ones.
  stepScene(dir: number): void {
    this.setScene(stepScene(this.state.scenes, this.state.clock.scene, dir));
  }

  // `fade` is the crossfade time (0 = cut). Changing scene this way (not as a show scene, see
  // applyScene) means Program no longer shows a show scene.
  setScene(i: number, fade = CROSSFADE_SECONDS): void {
    this.hooks.onManualSceneChange?.();
    this.showScene(i, fade);
  }

  private showScene(i: number, fade: number): void {
    const c = this.state.clock;
    const scene = this.state.scenes[i];
    if (i === c.scene || !scene || scene.removed) return;
    if (this.profiler.fillRunning) {   // a GPU test measures one scene
      this.profiler.cancelFill();
      this.toast('GPU test stopped: the scene changed. Turn auto-switch off (A) to test one scene.', 4500);
    }
    c.fade = fade;
    c.prevScene = c.scene;
    c.scene = i;
    this.outgoingEffects = null;
    writeString(KEYS.lastScene, paramKey(scene));
    c.transitionStart = c.clock;
    c.sceneStart = c.clock;
    c.beatsInScene = 0;
    this.log.app('info', `Scene: ${scene.name}${fade ? '' : ' (cut)'}`);
    this.publishScene();
    this.showParams();
  }

  // The scene that was on screen when the page closed (by name, not index: the list can change in
  // between), or the first one.
  private lastScene(): number {
    const key = readString(KEYS.lastScene);
    const i = key ? this.state.scenes.findIndex((s) => !s.removed && paramKey(s) === key) : -1;
    return i >= 0 ? i : 0;
  }

  nextRandomScene(): void {
    const choices = rotation(this.state.scenes, this.libraryPrefs).filter((i) => i !== this.state.clock.scene);
    if (choices.length) this.setScene(choices[Math.floor(Math.random() * choices.length)]!);
  }

  // Auto-switch only cycles the visual scenes; it never leaves your own shader.
  // It also holds still while you're editing the scene's code.
  private autoSwitching(): boolean {
    return this.state.look.auto && !this.hooks.autopilot?.() && this.overlay !== 'editor' && !this.currentScene.kind;
  }

  setLibraryPrefs(prefs: LibraryPrefs): void {
    this.libraryPrefs = prefs;
    saveLibraryPrefs(prefs);
    this.bumpScenes();
  }

  // What a change in the library means on screen: new code reaches the renderer, the projector
  // and the library list, new values the renderer; the Parameters panel follows the scene on screen.
  private sceneChanged(i: number, what: SceneChange): void {
    if (what === 'list') {
      if (i === this.state.clock.scene && this.state.scenes[i]?.removed) this.setScene(0);
      this.bumpScenes();
      return;
    }
    this.pushParams(i);
    if (what === 'code') { this.output.sendScene(i); this.bumpScenes(); }   // code edits reach the projector live
    if (i === this.state.clock.scene) this.showParams();
  }

  // Loads a parked scene into "My Shader" so it can be fixed; "Save to library" under the same name
  // then replaces the parked copy. Nothing is stored until it compiles.
  openParkedInEditor(name: string): void {
    const p = this.library.parked.userScenes.find((x) => x.name === name);
    if (!p) return;
    this.editor.customCode = p.body;
    this.editor.libraryName = name;
    this.setScene(this.state.customIndex);
    this.setOverlay('editor');
  }

  // ---------- A scene as a whole: which one, its parameter values, the look ----------

  // A scene as a show scene keeps it: its parameter values, the look sliders, the palette and the screen's
  // effects, as they are now.
  captureScene(i = this.state.clock.scene): Shot {
    const look: Record<string, number> = {};
    for (const k of LOOK_KEYS) look[k] = this.state.look[k];
    return { scene: i, values: this.library.values(i), look, palette: this.state.look.palette, effects: this.state.effects };
  }

  // Puts a scene on screen in one step, as the studio takes it: the look sliders it has, its values, its
  // effects (replacing the screen's), then the scene, crossfading for `fade` seconds. Not a manual scene
  // change. The outgoing picture keeps the effects it had through the crossfade; a show scene of the
  // scene already on screen takes over at once.
  applyScene(snap: Shot, fade: number): void {
    const scene = this.state.scenes[snap.scene];
    if (!scene || scene.removed) return;
    for (const k of LOOK_KEYS) if (snap.look[k] !== undefined) this.setLook(k, snap.look[k]!);
    if (snap.palette) this.setPalette(snap.palette);
    this.library.replaceValues(snap.scene, snap.values);
    const outgoing = this.state.effects, before = this.state.clock.scene;
    this.setEffects(snap.effects);
    this.showScene(snap.scene, fade);
    if (this.state.clock.scene !== before) this.outgoingEffects = outgoing;
  }

  // ---------- Live parameters ----------

  // A scene's values as the renderer's uniforms.
  private pushParams(i: number): void {
    if (!this.state.scenes[i]) return;
    const values = this.library.values(i);
    this.renderer.setParams(i, Object.fromEntries(this.library.specs(i).map((s) => [s.name, toUniform(s, values[s.name]!)])));
  }

  // Publishes what the Parameters panel edits: the studio's choice while it has one (it calls this
  // when that changes), else the scene on screen. Every change made through the controller calls it.
  showParams(): void {
    const override = this.hooks.paramsOverride?.();
    if (override) {
      this.ui.set({ params: { title: override.title, key: override.key, specs: override.specs, values: override.values, inStudio: true }, paramsVisible: override.specs.length > 0 });
      return;
    }
    const i = this.state.clock.scene;
    const specs = this.library.specs(i);
    const inStudio = this.overlay === 'studio';
    this.ui.set({ params: { title: inStudio ? `${this.currentScene.name} — live` : this.currentScene.name, key: paramKey(this.currentScene), specs, values: this.library.values(i), inStudio }, paramsVisible: specs.length > 0 });
  }

  setParam(spec: ParamSpec, value: ParamValue): void {
    const override = this.hooks.paramsOverride?.();
    if (override) return override.onChange(spec, value);
    this.library.setValues(this.state.clock.scene, { [spec.name]: value });
  }

  resetParams(): void {
    const override = this.hooks.paramsOverride?.();
    if (override) return override.onReset();
    this.library.resetValues(this.state.clock.scene);
  }

  // ---------- Look ----------

  // Any change to a slider (a hand, a take, the assistant) ends a slot's glide there.
  setLook(key: LookKey, value: number): void {
    this.glide.stop();
    this.state.look[key] = clampLook(key, value);
    this.publishLook();
  }

  setLookFlag(key: 'auto' | 'randomScene' | 'drift' | 'xyOpen', value: boolean): void {
    if (key === 'drift' && value) this.drift.reset();   // start from the sliders as they are
    this.state.look[key] = value;
    this.publishLook();
  }

  // A locked slider is left alone by Randomize (and Shift+R) and Drift; a Take, the assistant and a hand
  // still move it.
  setLookLock(key: SliderKey, locked: boolean): void {
    const now = this.state.look.locked;
    this.state.look.locked = SLIDER_KEYS.filter((k) => (k === key ? locked : now.includes(k)));
    this.publishLook();
  }

  // The palette every scene draws through laser() (ADR 0004): 2–5 hues on the wheel, or none for the whole
  // wheel. Randomize and Drift leave it alone.
  setPalette(palette: Readonly<Palette>): void {
    const hues = palette.hues.length >= 2 ? palette.hues.slice(0, PALETTE_MAX).map(fract) : [];
    this.state.look.palette = { hues, steps: palette.steps };
    this.publishLook();
  }

  // Makes a slider follow the music (ADR 0005), or stop (null).
  setRoute(target: RouteTarget, route: Readonly<Route> | null): void {
    const routes = { ...this.state.look.routes };
    if (route) routes[target] = { ...route }; else delete routes[target];
    this.state.look.routes = routes;
    this.publishLook();
  }

  // Where each slider that follows the music sits on the main screen now, for the widget's marks.
  private followedNow(): Partial<Record<RouteTarget, number>> {
    const { routes } = this.state.look, env = this.state.clock.routeEnv;
    if (!env || !Object.keys(routes).length) return NOT_FOLLOWED;
    const out: Partial<Record<RouteTarget, number>> = {};
    ROUTE_TARGETS.forEach((t, i) => { const r = routes[t]; if (r) out[t] = followed(t, this.state.look[t], r, env[i]!); });
    return out;
  }

  // What XY pad `i` moves across and up.
  setXYAxes(i: number, axes: XYAxes): void {
    if (!this.state.look.xy[i] || axes.x === axes.y) return;
    this.state.look.xy = this.state.look.xy.map((a, j) => (j === i ? { ...axes } : a));
    this.publishLook();
  }

  // Intensity: Reactivity, Trails and Fringing together, inside the Randomize ranges; locked ones stay.
  setIntensity(x: number): void {
    const look = this.state.look;
    this.glide.stop();
    applyIntensity(look, x);
    this.publishLook();
  }

  // Stores the look now in slot `i` (A–D).
  saveLookSlot(i: number): void {
    if (i < 0 || i >= SLOT_NAMES.length) return;
    this.lookSlots = this.lookSlots.map((s, j) => (j === i ? slotWithRoutes(this.state.look) : s));
    this.slotAt = i;
    this.ui.set({ lookSlots: this.lookSlots, lookSlotAt: i });
    this.lookSlotsWriter.schedule();
    this.toast(`Look stored in slot ${SLOT_NAMES[i]}`, 1200);
  }

  // Empties slot `i`.
  clearLookSlot(i: number): void {
    if (!this.lookSlots[i]) return;
    this.lookSlots = this.lookSlots.map((s, j) => (j === i ? null : s));
    this.ui.set({ lookSlots: this.lookSlots });
    this.lookSlotsWriter.schedule();
    this.toast(`Slot ${SLOT_NAMES[i]} emptied`, 1200);
  }

  // Glides to the look in slot `i` over a second. Shift+R comes back from it, as from a Randomize.
  recallLookSlot(i: number): void {
    if (!this.lookSlots[i]) { if (SLOT_NAMES[i]) this.toast(`Slot ${SLOT_NAMES[i]} is empty: Shift+click it to store the look`, 1800); return; }
    this.rememberForBack();
    this.slotBeats = 0;   // auto-change counts on from here
    this.goToSlot(i, false);
  }

  // Goes to slot `i`'s look: gliding over a second, or at once. The routes switch at once either way.
  private goToSlot(i: number, instant: boolean): void {
    const slot = this.lookSlots[i];
    if (!slot) return;
    const look = this.state.look;
    if (slot.routes) look.routes = structuredClone(slot.routes);
    this.slotAt = i;
    if (instant) {
      this.glide.stop();
      for (const k of SLIDER_KEYS) look[k] = slot[k];
    } else {
      this.glide.start(slotOf(look), slot);
    }
    this.publishLook();
  }

  // The slot auto-change's settings: on or off, every how many kicks, in which order, gliding or switching.
  setAutoSlots(change: Partial<AutoSlots>): void {
    const look = this.state.look;
    if (change.on && !look.autoSlots.on) this.slotBeats = 0;
    look.autoSlots = { ...look.autoSlots, ...change };
    this.publishLook();
  }

  // A kick while auto-change is on: every `beats` of them, the next slot. Not one Shift+R comes back from.
  private autoSlotOnKick(): void {
    const auto = this.state.look.autoSlots;
    if (!auto.on || ++this.slotBeats < auto.beats) return;
    this.slotBeats = 0;
    const next = nextSlot(this.lookSlots, this.slotAt, auto.order);
    if (next !== null) this.goToSlot(next, auto.transition === 'hard');
  }

  // The Look changed: the widget shows it, and it's kept for the next start.
  private publishLook(): void {
    this.ui.set({ look: { ...this.state.look }, liveHue: fract(this.state.look.hue + this.state.clock.huePhase), lookSlotAt: this.slotAt });
    this.lookWriter.schedule();
  }

  // ---------- Effects (the main screen's: they stay through scene changes, like the Look) ----------

  addEffect(id: Effects.EffectId): void { this.setEffects(Effects.addEffect(this.state.effects, id)); }
  removeEffect(id: Effects.EffectId): void { this.setEffects(Effects.removeEffect(this.state.effects, id)); }
  moveEffect(id: Effects.EffectId, to: number): void { this.setEffects(Effects.moveEffect(this.state.effects, id, to)); }
  setEffectOn(id: Effects.EffectId, on: boolean): void { this.setEffects(Effects.setEffectOn(this.state.effects, id, on)); }
  setEffectSetting(id: Effects.EffectId, key: string, value: number): void { this.setEffects(Effects.setEffectSetting(this.state.effects, id, key, value)); }

  // A new stack (never edited in place, so whatever holds the old one keeps it): drawn from the next
  // frame, published to the widget and kept for the next start.
  private setEffects(stack: Effects.EffectStack): void {
    if (stack === this.state.effects) return;
    this.state.effects = stack;
    this.ui.set({ effects: stack });
    this.effectsWriter.schedule();
  }

  toggleAuto(): boolean {
    this.setLookFlag('auto', !this.state.look.auto);
    this.toast(`Auto-switch ${this.state.look.auto ? 'on' : 'off'}`, 1500);
    return this.state.look.auto;
  }

  // Rolls the Look widget's values, within ranges that stay watchable, except the locked ones. The scene
  // only changes when "Also pick a random scene" is on.
  randomize(): void {
    const look = this.state.look;
    this.rememberForBack();
    this.glide.stop();
    for (const key of DRIFT_KEYS) if (!look.locked.includes(key)) { const [min, max] = RANDOM_RANGES[key]; this.setLook(key, min + Math.random() * (max - min)); }
    if (this.state.look.randomScene) this.nextRandomScene();
  }

  // What Shift+R comes back to: the look and the scene before a Randomize or a slot recall.
  private rememberForBack(): void {
    this.beforeRandom.push({ look: slotOf(this.state.look), scene: this.state.clock.scene });
    if (this.beforeRandom.length > RANDOM_HISTORY) this.beforeRandom.shift();
  }

  // Shift+R: the look (and scene, if Randomize changed it) from before the last Randomize or slot recall,
  // locked sliders aside. Again for the one before that.
  randomizeBack(): void {
    const prev = this.beforeRandom.pop();
    if (!prev) { this.toast('No earlier random look to go back to', 1500); return; }
    this.glide.stop();
    for (const key of DRIFT_KEYS) if (!this.state.look.locked.includes(key)) this.setLook(key, prev.look[key]);
    if (prev.scene !== this.state.clock.scene) this.setScene(prev.scene);
    const left = this.beforeRandom.length;
    this.toast(`Back to the previous look${left ? ` (${left} more)` : ''}`, 1500);
  }

  // ---------- Sources ----------

  // A source button: a file and SoundCloud open their pickers; a video's sound starts from the media panel.
  async startSource(kind: SourceButton, pickFile?: () => void, openSoundCloud?: () => void): Promise<void> {
    if (kind === 'file') return pickFile?.();
    if (kind === 'soundcloud') return openSoundCloud?.();
    if (kind === 'media') return;
    await this.music.start(kind, micConstraints(this.prefs.get())).catch((err) => this.sourceFailed(err));
  }

  private sourceFailed(err: unknown): void {
    const e = err as Error;
    this.log.app('warn', `The music didn't start: ${e.name}: ${e.message || String(err)}`);
    if (e.name === 'NotAllowedError') this.toast('Permission denied or capture cancelled.');
    else this.toast(e.message || String(err));
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
    try {
      await this.music.play(src, label, sourceButton, { hasQueue: !!this.queueFor(sourceButton)?.hasQueue });
    } catch (err) {
      this.log.app('error', `Couldn't play "${label}": ${(err as Error).message}`);
      this.toast(`Couldn't play this: ${(err as Error).message}`);
    }
  }

  togglePlay(): void { this.music.toggle().catch((err) => this.sourceFailed(err)); }

  // A source began playing (MusicSource): the tempo starts over.
  private sourceStarted(source: SourceButton): void {
    if (source !== 'media' && this.mediaSound) this.setMediaSound(false, { quiet: true });   // another source is the music now
    this.ui.set({ started: true });
    this.log.app('info', `Music: ${source} · ${this.ui.get().nowText}`);
    document.body.classList.add('started');
    if (!readFlag(KEYS.helpHint)) { writeFlag(KEYS.helpHint, true); this.toast('Press ? for help & shortcuts', 4000); }
    this.listener.reset();
  }

  // Dropped anywhere: audio plays, pictures and videos become the media, a settings export is imported.
  drop(file: File | undefined): void {
    if (!file) return;
    if (file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')) return void this.importSettings(file);
    if (isMediaFile(file) && !file.type.startsWith('audio/')) void this.loadMedia(file);
    else void this.playFile(file);
  }

  // ---------- Media (image / video to distort) ----------

  async loadMedia(source: MediaSource): Promise<void> {
    try {
      await this.media.load(source);
    } catch (err) {
      if (err instanceof StaleMediaLoad) return;   // the user picked something else (or cleared) meanwhile
      this.log.app('error', `Couldn't load the media: ${(err as Error).message}`);
      return this.toast((err as Error).message, 6000);
    }
    this.output.sendMedia(source);
    this.mediaChanged();
    if (this.mediaSound && this.media.kind === 'video') await this.linkMediaSound();
    else if (this.state.activeSource === 'media') this.player.pause();
    const mediaScene = this.state.scenes.findIndex((s) => s.cat === 'Media' && !s.removed);
    if (!this.renderer.usesMedia(this.state.clock.scene)) this.setScene(mediaScene);
    const what = this.media.kind === 'video' ? 'Video' : 'Image';
    this.log.app('info', `${what} loaded: ${this.media.size.join('×')}`);
    this.toast(mediaScene >= 0
      ? `${what} loaded — ${this.state.scenes[mediaScene]!.name} draws it (library → Media). In code, sample it with media(p).`
      : `${what} loaded. In a scene's code, sample it with media(p).`, 5000);
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
    writeFlag(KEYS.mediaSound, on);
    this.ui.set({ mediaSound: on });
    if (quiet) return;
    if (on && this.media.kind === 'video') void this.linkMediaSound();
    else if (!on && this.music.active === 'media') this.music.stop('❚❚ Video sound off — pick a music source');
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

  // What a kick and a tick do, in this order, once the frame's sound is heard and before the frame is
  // composed: a kick counts towards auto-switch (kicks, not ticks: a breakdown
  // holds the scene; each output's hue jumps in composeFrame); a tick is the studio's and the director's beat.
  private onBeats(h: Readonly<Hearing>): void {
    const c = this.state.clock;
    if (h.kick) {
      c.beatsInScene++;
      if (this.autoSwitching() && c.beatsInScene >= BEATS_PER_SCENE) this.nextRandomScene();
      this.autoSlotOnKick();
    }
    if (h.tick) this.hooks.onTempoBeat?.();
  }

  // ---------- Settings export / import (src/app/bundle.ts) ----------

  exportSettings(): void {
    this.downloadSettings(`hallucinate-${fileStamp()}.json`);
    this.log.app('info', 'Exported your scenes & settings');
    this.toast('Exported your scenes & settings');
  }

  private downloadSettings(name: string): void {
    flushAll();   // the latest slider drag / graph edit belongs in the file
    downloadFile(new Blob([JSON.stringify(buildBundle(), null, 2)], { type: 'application/json' }), name);
  }

  // Replaces the stored state with the file's and reloads, so every panel starts from it. The
  // current state is downloaded first as a backup. Nothing is written unless the whole file is
  // valid, and while it is written nothing else may write (a stale debounced writer would
  // overwrite it on the way out).
  async importSettings(file: File): Promise<void> {
    let text: string;
    try { text = await file.text(); } catch { return this.toast(`Couldn't read "${file.name}".`); }
    const parsed = parseBundle(text);
    if (!parsed.ok) { this.log.app('error', `Import of "${file.name}" refused: ${parsed.error}`); return this.toast(parsed.error, 7000); }
    const { writes, summary } = parsed.bundle;
    if (!confirm(`Import "${file.name}"?\n\nIt replaces your ${summary}.\n\nYour current setup is downloaded first as a backup. The app reloads, and other open Hallucinate tabs reload too.`)) return;
    this.downloadSettings(`hallucinate-before-import-${fileStamp()}.json`);
    freeze();
    try {
      applyWrites([...writes, [KEYS.importReport, summary], [KEYS.importedAt, String(Date.now())]]);
    } catch (err) {
      unfreeze();
      this.log.app('error', `Import failed: ${(err as Error).message}`);
      return this.toast(`Import failed: ${(err as Error).message} Nothing was changed.`, 7000);
    }
    location.reload();
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
      downloadFile(blob, `hallucinate-${fileStamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      this.recorder = null;
      this.ui.set({ recording: false });
      if (!this.disposed) { this.toast('Recording saved'); this.log.app('info', `Recording saved (${(blob.size / 1e6).toFixed(1)} MB)`); }
    };
    recorder.start(1000);
    this.ui.set({ recording: true });
    this.toast('Recording… press C or click "Stop rec" to save');
  }

  // ---------- System log ----------

  // Shift+S: the System log. Opening it sees the errors the badge counted.
  toggleSystemLog(on = !this.ui.get().systemLog): void {
    this.log.watch(on);
    this.ui.set({ systemLog: on });
  }

  private logOutputs(n: number): void {
    if (n === this.loggedOutputs) return;
    this.log.app('info', n > this.loggedOutputs ? `Projector connected (${n} open)` : `Projector closed (${n} open)`);
    this.loggedOutputs = n;
  }

  // A tempo heard after none, and a tempo forgotten: the System log's tempo lines.
  private logTempo(bpm: number | null): void {
    if ((bpm === null) === (this.loggedBpm === null)) return;
    this.log.app('info', bpm === null ? 'Tempo lost: no kicks for a long while' : `Tempo: ${bpm.toFixed(1)} BPM`);
    this.loggedBpm = bpm;
  }

  // ---------- Performance ----------

  togglePerf(): void { this.setPerf(!this.profiler.on); }

  // Shift+L: the Hearing monitor. The Listener keeps what it shows only while it is open.
  toggleHearingMonitor(): void {
    const on = !this.ui.get().hearingMonitor;
    this.listener.watch(on);
    this.hearingRecorder.clear();
    this.ui.set({ hearingMonitor: on ? this.hearingView() : null });
  }

  private hearingView(): HearingView | null {
    const diagnostics = this.listener.diagnostics();
    if (!diagnostics) return null;
    const h = this.listener.hearing, inputs = readInputs(this.program);
    const history = this.hearingRecorder.record(diagnostics, inputs);
    return { diagnostics, latency: this.audio.latency(), beat: h.beat, tickPhase: h.tickPhase, centroid: h.centroid, energy: h.energy, mood: h.mood, inputs, history };
  }

  setPerf(on: boolean, trace = false): void {
    this.profiler.setOn(on, trace);
    if (on) {
      installGlobal(this.profilerApi);
      this.ui.set({ perf: this.perfReport() });   // show it now ("Collecting frames…"), not at the first update
    } else {
      uninstallGlobal(this.profilerApi);
      this.ui.set({ perf: null });
    }
  }

  // The GPU test: about 1.5 s at the current resolution, then 1.5 s at half of it (visible: softer,
  // the trails restart), then back. Resolves with null if it was cut short.
  runFillTest(): Promise<FillResult | null> {
    if (!this.profiler.on) this.setPerf(true);
    const done = this.profiler.startFill((s) => this.renderer.setScale(s), () => this.prefs.get().resolution, this.state.clock.scene);
    this.ui.set({ perf: this.perfReport() });
    return done;
  }

  private perfReport(): PerfReport {
    return this.profiler.report({
      size: this.renderer.size,
      scale: this.renderer.scale,
      resolution: this.prefs.get().resolution,
      scene: this.state.clock.scene,
      projectors: this.ui.get().outputs.length,
      preview: this.ui.get().overlay === 'studio',
    });
  }

  // ---------- Main loop ----------

  // The loop re-arms first, so one frame that throws (a hook, a scene) can't stop the show for good.
  get hearing(): Readonly<Hearing> { return this.listener.hearing; }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.profiler.frameStart(now);
    try {
      this.step(now);
    } catch (err) {
      if (this.frameError === (err as Error).message) return;   // report each new problem once, not every frame
      this.frameError = (err as Error).message;
      console.error(err);
    } finally {
      this.profiler.frameEnd();
    }
  };

  // `dt` is capped for the show (a stall must not jump the motion); the listener hears on real time, so
  // the tempo reads right at any frame rate.
  private step(now: number): void {
    const elapsed = (now - this.last) / 1000;
    const dt = Math.min(0.1, elapsed);
    this.last = now;
    const c = this.state.clock;
    const look = this.state.look;
    c.clock += dt;

    const f = this.listener.hear(this.audio.read(), this.music.playing, elapsed, now / 1000);
    this.onBeats(f);
    this.profiler.lap(Stage.audio);
    if (look.drift) this.drift.step(look, dt, look.driftSpeed, look.locked);
    const gliding = this.glide.active;
    this.glide.step(look, dt);
    if (++this.lookFrames % LOOK_PUBLISH_FRAMES === 0 || (gliding && !this.glide.active)) {
      const liveHue = fract(look.hue + c.huePhase);
      const followed = this.followedNow();
      if (look.drift || gliding) { this.ui.set({ look: { ...look }, liveHue, followed }); this.lookWriter.schedule(); }
      else if (liveHue !== this.ui.get().liveHue || followed !== this.ui.get().followed) this.ui.set({ liveHue, followed });
    }
    if (this.state.activeSource === 'media') this.media.follow(this.player);

    if (this.autoSwitching() && this.music.playing && c.clock - c.sceneStart > MAX_SECONDS_PER_SCENE) this.nextRandomScene();
    const p = this.program;
    composeFrame(p, c, f, look, this.currentScene.trails ?? 1, dt);   // the main screen's motion is the clock's
    p.scene = c.scene; p.prevScene = c.prevScene; p.mix = crossfade(c, c.clock);
    if (c.prevScene < 0) this.outgoingEffects = null;   // the crossfade has ended (crossfade() let prevScene go)
    // On the main screen effects belong to what is on screen, not to the scene: both pictures draw with
    // the screen's, except that a show scene taken here leaves the outgoing picture its own.
    p.effects = this.state.effects;
    p.prevEffects = this.outgoingEffects ?? this.state.effects;
    p.master = this.hooks.master?.() ?? 1;
    p.mediaTime = this.media.time; p.mediaPaused = this.media.video?.paused ?? true; p.mediaRate = this.media.video?.playbackRate ?? 1;
    this.profiler.lap(Stage.logic);
    // Live pinned (studio closed after a take): projectors get it, and the screen too when set to Live.
    const out = this.live.route(p, this.output.connected, dt);
    this.renderer.render(out.screen.program, out.screen.params);
    this.profiler.lap(Stage.render);
    if (out.projector) this.output.sendFrame(out.projector.program, out.projector.params, this.prefs.get().resolution);
    this.profiler.lap(Stage.output);
    this.hooks.onFrame?.(dt, p);
    this.profiler.lap(Stage.studio);

    this.logTempo(f.bpm);
    if (++this.meterTick % 2 === 0) {
      const tone = toneWord(f.bright);
      const moodLabel: MoodLabel = !this.music.playing ? '' : `mood: ${moodWord(f.mood)}`;
      this.ui.set({
        meters: { bass: f.bass, mid: f.mid, high: f.high, bright: f.bright, beat: f.beat },
        bpm: f.bpm,
        moodLabel,
        toneTitle: `Timbral brightness: ${tone} (spectral centroid ≈ ${(f.centroid / 1000).toFixed(1)} kHz)`,
      });
    }
    if (this.ui.get().hearingMonitor && this.meterTick % HEARING_PUBLISH_FRAMES === 0) this.ui.set({ hearingMonitor: this.hearingView() });
    this.profiler.lap(Stage.ui);
    if (this.profiler.on && now - this.perfPublishedAt >= PERF_PUBLISH_MS) {
      this.perfPublishedAt = now;
      this.ui.set({ perf: this.perfReport() });
    }
  }
}

// The projector output, both ends. Projector windows (output.html) render the show themselves at their
// own resolution: the main window's OutputLink sends them the scene shaders once (and whenever one
// changes), the render state every frame, the media, and the device preferences that reach every
// renderer (on connect and when one changes, never per frame); each window's ProjectorView draws what
// it receives and reports back. They talk through an OutputPort: a BroadcastChannel between windows,
// an in-memory one in the tests.
//
// Scenes are addressed by INDEX in the shared scene list, so that list must never be filtered or
// re-ordered (soft-delete only).

import type { MediaClock, MediaLayer, RemoteMediaSource } from './media';
import type { ProgramState, Renderer, SceneSource, SceneUniforms } from './renderer';

export type { SceneSource };
export const CHANNEL = 'hallucinate-output';
export const STALE_MS = 3000;          // a projector that hasn't reported for this long is gone
export const WAITING_MS = 2000;        // a projector that hasn't had a frame for this long says it's waiting

// Where the messages go: every other end on the channel (never back to the sender).
export interface OutputPort {
  post(message: OutputMessage): void;
  onMessage: ((message: OutputMessage) => void) | null;
  close(): void;
}

export function broadcastPort(name = CHANNEL): OutputPort {
  const channel = new BroadcastChannel(name);
  const port: OutputPort = {
    post: (m) => channel.postMessage(m),
    onMessage: null,
    close: () => channel.close(),
  };
  channel.onmessage = ({ data }: MessageEvent<OutputMessage>) => port.onMessage?.(data);
  return port;
}
// The device preferences (src/state/prefs.ts) that reach every renderer: the main canvas, the studio's
// Preview monitor and each projector window. All of them apply them with applyRendererPrefs, and
// each one has its applier here (a field without one doesn't compile).
export interface OutputPrefs { maxPixelRatio: number }
type PrefTarget = Pick<Renderer, 'setMaxPixelRatio'>;
const APPLIERS: { [K in keyof OutputPrefs]: (r: PrefTarget, value: OutputPrefs[K]) => void } = {
  maxPixelRatio: (r, v) => r.setMaxPixelRatio(v),
};
export function applyRendererPrefs(renderer: PrefTarget, prefs: OutputPrefs): void {
  for (const k of Object.keys(APPLIERS) as (keyof OutputPrefs)[]) APPLIERS[k](renderer, prefs[k]);
}
export interface OutputStatus { id: string; w: number; h: number; fullscreen: boolean; fps: number }
interface SeenStatus extends OutputStatus { seen: number }

export type OutputMessage =
  | { type: 'scenes'; scenes: SceneSource[] }
  | { type: 'scene'; index: number; scene: SceneSource }
  | { type: 'frame'; state: ProgramState; params: Record<number, SceneUniforms>; resolution: number }
  | { type: 'media'; source: File | RemoteMediaSource | null }
  | { type: 'prefs'; prefs: OutputPrefs }
  | { type: 'identify' }
  | { type: 'hello'; id: string }
  | { type: 'status'; id: string; w: number; h: number; fullscreen: boolean; fps: number }
  | { type: 'bye'; id: string };

export interface OutputLinkOptions {
  port?: OutputPort;
  now?: () => number;
}

// The main window's end. A projector that says hello gets everything it needs to draw: the scenes, the
// media and the preferences as they are now.
export class OutputLink {
  private readonly outputs = new Map<string, SeenStatus>();
  private readonly port: OutputPort;
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private mediaSource: File | RemoteMediaSource | null = null;

  constructor(private readonly scenes: readonly SceneSource[], private readonly onStatus: (outputs: OutputStatus[]) => void, private prefs: OutputPrefs, o: OutputLinkOptions = {}) {
    this.port = o.port ?? broadcastPort();
    this.now = o.now ?? (() => performance.now());
    this.port.onMessage = (m) => {
      if (m.type === 'hello') { this.sendScenes(); this.sendMedia(this.mediaSource); this.post({ type: 'prefs', prefs: this.prefs }); }
      if (m.type === 'status') this.outputs.set(m.id, { ...m, seen: this.now() });
      if (m.type === 'bye') this.outputs.delete(m.id);
      this.onStatus(this.status());
    };
    this.timer = setInterval(() => this.onStatus(this.status()), 1000);   // notice projectors that went away
  }

  status(): OutputStatus[] {
    const now = this.now();
    for (const [id, o] of this.outputs) if (now - o.seen > STALE_MS) this.outputs.delete(id);
    return [...this.outputs.values()];
  }

  get connected(): boolean { return this.outputs.size > 0; }

  private post(message: OutputMessage): void { this.port.post(message); }

  sendScenes(): void {
    this.post({ type: 'scenes', scenes: this.scenes.map(({ name, frag }) => ({ name, frag })) });
  }

  // A dropped File is shared as is (Blobs aren't copied between windows); a server file goes as its URL.
  // Either way projectors load the original, at full quality.
  sendMedia(source: File | RemoteMediaSource | null): void {
    this.mediaSource = source;
    this.post({ type: 'media', source });
  }

  sendPrefs(prefs: OutputPrefs): void {
    this.prefs = prefs;
    this.post({ type: 'prefs', prefs });
  }

  sendScene(index: number): void {
    if (!this.connected) return;
    const scene = this.scenes[index];
    if (!scene) return;
    this.post({ type: 'scene', index, scene: { name: scene.name, frag: scene.frag } });
  }

  // `params` holds the @param uniforms of the scenes on screen: { [sceneIndex]: uniforms }.
  sendFrame(state: ProgramState, params: Record<number, SceneUniforms>, resolution: number): void {
    if (this.connected) this.post({ type: 'frame', state, params, resolution });
  }

  identify(): void {
    this.post({ type: 'identify' });
  }

  // Displays from the Window Management API (Chrome / Edge). Asks for permission the first time.
  async screens(): Promise<ScreenDetailed[]> {
    if (!('getScreenDetails' in window)) throw new Error('This browser can\'t list displays — open the projector window and drag it to the projector.');
    const details = await (window as Window & { getScreenDetails(): Promise<{ screens: ScreenDetailed[] }> }).getScreenDetails();
    return details.screens;
  }

  open(screen?: ScreenDetailed): Window {
    const size = screen
      ? `left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
      : 'width=1280,height=720';
    const win = window.open('output.html', 'hallucinate-output', `popup,${size}`);
    if (!win) throw new Error('The projector window was blocked. Allow pop-ups for this site and try again.');
    if (screen) { win.moveTo(screen.availLeft, screen.availTop); win.resizeTo(screen.availWidth, screen.availHeight); }
    win.focus();
    return win;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.port.close();
  }
}

// What a projector draws with (Renderer, MediaLayer).
export type ProjectorRenderer = PrefTarget & Pick<Renderer, 'setParams' | 'setScale' | 'render' | 'size'>;
export type ProjectorMedia = Pick<MediaLayer, 'load' | 'clear' | 'follow'>;

type FrameMessage = Extract<OutputMessage, { type: 'frame' }>;

// A projector window's end: keeps `scenes` (the list its renderer draws from) as the main window
// sends it, draws each frame once as it arrives (so trails advance at the main window's pace), and
// reports what it is. `onIdentify`: the main window asked it to show itself.
export class ProjectorView {
  private pending: FrameMessage | null = null;   // the newest frame not yet drawn
  private lastFrameAt = -Infinity;
  private frames = 0;
  private statusAt: number;

  constructor(
    private readonly port: OutputPort,
    private readonly renderer: ProjectorRenderer,
    private readonly media: ProjectorMedia,
    private readonly scenes: SceneSource[],
    private readonly o: { id: string; now?: () => number; onIdentify?: () => void; onError?: (err: unknown) => void },
  ) {
    this.statusAt = this.now();
    port.onMessage = (m) => this.handle(m);
  }

  // Says hello: the main window answers with the scenes, the media and the preferences.
  start(): void { this.port.post({ type: 'hello', id: this.o.id }); }

  // Draws the newest frame, once. False when none came since the last draw.
  draw(): boolean {
    const m = this.pending;
    if (!m) return false;
    this.pending = null;
    for (const [index, uniforms] of Object.entries(m.params)) this.renderer.setParams(Number(index), uniforms);
    this.renderer.setScale(m.resolution);   // a no-op unless it changed
    this.media.follow({ currentTime: m.state.mediaTime ?? 0, paused: m.state.mediaPaused ?? false, playbackRate: m.state.mediaRate ?? 1 } satisfies MediaClock);
    this.renderer.render(m.state);
    this.frames++;
    return true;
  }

  // No frame for a while: the main window is closed, or Live isn't sent here.
  get waiting(): boolean { return this.now() - this.lastFrameAt >= WAITING_MS; }

  // Tells the main window its size, whether it is fullscreen and how many frames a second it drew.
  report(fullscreen: boolean): void {
    const now = this.now();
    const fps = Math.round((this.frames * 1000) / Math.max(1, now - this.statusAt));
    this.frames = 0;
    this.statusAt = now;
    this.port.post({ type: 'status', id: this.o.id, w: this.renderer.size[0], h: this.renderer.size[1], fullscreen, fps });
  }

  // The window closes.
  bye(): void { this.port.post({ type: 'bye', id: this.o.id }); }

  private handle(m: OutputMessage): void {
    if (m.type === 'scenes') this.scenes.splice(0, this.scenes.length, ...m.scenes);
    else if (m.type === 'scene') this.scenes[m.index] = m.scene;
    else if (m.type === 'frame') { this.pending = m; this.lastFrameAt = this.now(); }
    else if (m.type === 'identify') this.o.onIdentify?.();
    else if (m.type === 'prefs') applyRendererPrefs(this.renderer, m.prefs);
    else if (m.type === 'media') {
      if (m.source) this.media.load(m.source).catch((err) => this.o.onError?.(err));
      else this.media.clear();
    }
  }

  private now(): number { return (this.o.now ?? (() => performance.now()))(); }
}

// Window Management API (not in lib.dom yet).
export interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  width: number;
  height: number;
  isPrimary: boolean;
  label: string;
}

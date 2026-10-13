// Main-window side of the projector output. Projector windows (output.html) render the show
// themselves at their own resolution; this sends them the scene shaders once (and whenever one
// changes) and the render state every frame, over a BroadcastChannel.
//
// The message shapes are a contract with src/output.ts; scenes are addressed by INDEX in the
// shared scene list, so that list must never be filtered or re-ordered (soft-delete only).

import type { RemoteMediaSource } from './media';
import type { ProgramState, SceneUniforms } from './renderer';

export const CHANNEL = 'hallucinate-output';
const STALE_MS = 3000;

export interface SceneSource { name: string; frag: string }
export interface OutputStatus { id: string; w: number; h: number; fullscreen: boolean; fps: number }
interface SeenStatus extends OutputStatus { seen: number }

export type OutputMessage =
  | { type: 'scenes'; scenes: SceneSource[] }
  | { type: 'scene'; index: number; scene: SceneSource }
  | { type: 'frame'; state: ProgramState; params: Record<number, SceneUniforms>; resolution: number }
  | { type: 'media'; source: File | RemoteMediaSource | null }
  | { type: 'identify' }
  | { type: 'hello'; id: string }
  | { type: 'status'; id: string; w: number; h: number; fullscreen: boolean; fps: number }
  | { type: 'bye'; id: string };

export class OutputLink {
  private readonly outputs = new Map<string, SeenStatus>();
  private readonly channel: BroadcastChannel;
  private readonly timer: ReturnType<typeof setInterval>;
  private mediaSource: File | RemoteMediaSource | null = null;

  constructor(private readonly scenes: readonly SceneSource[], private readonly onStatus: (outputs: OutputStatus[]) => void) {
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = ({ data }: MessageEvent<OutputMessage>) => {
      const m = data;
      if (m.type === 'hello') { this.sendScenes(); this.sendMedia(this.mediaSource); }
      if (m.type === 'status') this.outputs.set(m.id, { ...m, seen: performance.now() });
      if (m.type === 'bye') this.outputs.delete(m.id);
      this.onStatus(this.status());
    };
    this.timer = setInterval(() => this.onStatus(this.status()), 1000);   // notice projectors that went away
  }

  status(): OutputStatus[] {
    const now = performance.now();
    for (const [id, o] of this.outputs) if (now - o.seen > STALE_MS) this.outputs.delete(id);
    return [...this.outputs.values()];
  }

  get connected(): boolean { return this.outputs.size > 0; }

  private post(message: OutputMessage): void { this.channel.postMessage(message); }

  sendScenes(): void {
    this.post({ type: 'scenes', scenes: this.scenes.map(({ name, frag }) => ({ name, frag })) });
  }

  // A dropped File is shared as is (Blobs aren't copied between windows); a server file goes as its URL.
  // Either way projectors load the original, at full quality.
  sendMedia(source: File | RemoteMediaSource | null): void {
    this.mediaSource = source;
    this.post({ type: 'media', source });
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
    this.channel.close();
  }
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

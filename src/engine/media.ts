// The image or video you drop in (or fetch from YouTube). Scenes sample it as a texture (media(p) in
// the shaders); videos play muted and loop, or follow the music player when their sound is the music.
// The projector window loads its own copy of the same file.

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

export const isMediaFile = (file: File): boolean =>
  /^(image|video)\//.test(file.type) || VIDEO_EXT.test(file.name) || IMAGE_EXT.test(file.name);

export type MediaKind = 'image' | 'video';
// A file served by the local server (YouTube) — shared with projector windows as plain data.
export interface RemoteMediaSource { url: string; name: string; kind: MediaKind; site?: string }
export type MediaSource = File | RemoteMediaSource;
export type MediaElement = HTMLImageElement | HTMLVideoElement;

// What a video follows: the <audio> player, or the main window's clock on a projector.
export interface MediaClock { currentTime: number; paused: boolean; playbackRate: number }

// A load that a newer load or a clear() overtook while it was still opening. Callers ignore it.
export class StaleMediaLoad extends Error {
  constructor() { super('Superseded by a newer media change.'); this.name = 'StaleMediaLoad'; }
}

export class MediaLayer {
  el: MediaElement | null = null;
  kind: MediaKind | null = null;
  source: MediaSource | null = null;
  name = '';
  url: string | null = null;
  version = 0;      // bumps on every change so renderers re-upload
  private lastJump = -1e9;
  private generation = 0;   // bumps on every load() and clear(): only the newest change may land

  // Opens `source` and makes it the media. Rejects with StaleMediaLoad when a newer load or a clear()
  // came in while it was opening; the last change the user made always wins.
  async load(source: MediaSource): Promise<this> {
    const generation = ++this.generation;
    const isFile = source instanceof Blob;
    const name = source.name ?? 'media';
    const url = isFile ? URL.createObjectURL(source) : source.url;
    const kind: MediaKind = !isFile ? source.kind : (source.type.startsWith('video/') || VIDEO_EXT.test(name) ? 'video' : 'image');
    let el: MediaElement;
    try {
      if (kind === 'image') {
        const img = new Image();
        img.src = url;
        await img.decode();
        el = img;
      } else {
        const video = Object.assign(document.createElement('video'), { src: url, muted: true, loop: true, playsInline: true });
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('This video format isn\'t supported by the browser.'));
        });
        await video.play().catch(() => {});
        el = video;
      }
    } catch (err) {
      if (isFile) URL.revokeObjectURL(url);
      if (generation !== this.generation) throw new StaleMediaLoad();
      throw new Error(`Couldn't open "${name}": ${(err as Error).message}`);
    }
    if (generation !== this.generation) {
      if (el instanceof HTMLVideoElement) { el.pause(); el.removeAttribute('src'); el.load(); }
      if (isFile) URL.revokeObjectURL(url);
      throw new StaleMediaLoad();
    }
    this.release();
    this.el = el;
    this.kind = kind;
    this.source = source;
    this.name = name;
    this.url = url;
    this.version++;
    return this;
  }

  clear(): void {
    this.generation++;
    this.release();
  }

  private release(): void {
    if (!this.el) return;
    if (this.kind === 'video') (this.el as HTMLVideoElement).pause();
    if (this.source instanceof Blob && this.url) URL.revokeObjectURL(this.url);
    this.el = null;
    this.kind = null;
    this.source = null;
    this.url = null;
    this.name = '';
    this.version++;
  }

  dispose(): void { this.clear(); }

  get video(): HTMLVideoElement | null { return this.kind === 'video' ? (this.el as HTMLVideoElement) : null; }
  get ready(): boolean { return !!this.el && (this.kind === 'image' || (this.el as HTMLVideoElement).readyState >= 2); }
  get size(): [number, number] {
    if (!this.el) return [1, 1];
    return this.kind === 'video'
      ? [(this.el as HTMLVideoElement).videoWidth, (this.el as HTMLVideoElement).videoHeight]
      : [(this.el as HTMLImageElement).naturalWidth, (this.el as HTMLImageElement).naturalHeight];
  }
  get time(): number { return this.video?.currentTime ?? 0; }

  // Keeps this video in step with another clock: the <audio> player when the video's sound is the
  // music, or the main window's video for a projector. Small drift is corrected by playing up to 10 %
  // faster or slower; only a big gap (a seek, a loop) jumps, and never while a jump is still
  // decoding. Jumping on every small drift kept stalling the decoder: the video froze.
  follow(target: MediaClock): void {
    const v = this.video;
    if (!v) return;
    if (target.paused !== v.paused) { if (target.paused) v.pause(); else v.play().catch(() => {}); }
    if (v.seeking) return;
    const drift = target.currentTime - v.currentTime;   // > 0: the video is behind
    const now = performance.now();
    if (Math.abs(drift) > 1.5 && (target.paused || now - this.lastJump > 2000)) {
      v.currentTime = target.currentTime;
      v.playbackRate = target.playbackRate;
      this.lastJump = now;
      return;
    }
    const nudge = Math.abs(drift) < 0.04 ? 0 : Math.max(-0.1, Math.min(0.1, drift * 0.5));
    const rate = target.playbackRate * (1 + nudge);
    if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
  }
}

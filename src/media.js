// The image or video you drop in (or fetch from YouTube). Scenes sample it as a texture (media(p) in
// the shaders); videos play muted and loop, or follow the music player when their sound is the music.
// The projector window loads its own copy of the same file.

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

export const isMediaFile = (file) =>
  /^(image|video)\//.test(file.type) || VIDEO_EXT.test(file.name) || IMAGE_EXT.test(file.name);

export class MediaLayer {
  constructor() {
    this.el = null;
    this.kind = null;      // 'image' | 'video'
    this.source = null;    // a File, or { url, name, kind } for a file served by the local server
    this.name = '';
    this.url = null;
    this.version = 0;      // bumps on every change so renderers re-upload
    this.lastJump = -1e9;
  }

  async load(source) {
    const isFile = source instanceof Blob;
    const name = source.name ?? 'media';
    const url = isFile ? URL.createObjectURL(source) : source.url;
    const kind = source.kind ?? ((source.type ?? '').startsWith('video/') || VIDEO_EXT.test(name) ? 'video' : 'image');
    let el;
    try {
      if (kind === 'image') {
        el = new Image();
        el.src = url;
        await el.decode();
      } else {
        el = Object.assign(document.createElement('video'), { src: url, muted: true, loop: true, playsInline: true });
        await new Promise((resolve, reject) => {
          el.onloadeddata = resolve;
          el.onerror = () => reject(new Error('This video format isn\'t supported by the browser.'));
        });
        await el.play().catch(() => {});
      }
    } catch (err) {
      if (isFile) URL.revokeObjectURL(url);
      throw new Error(`Couldn't open "${name}": ${err.message}`);
    }
    this.clear();
    Object.assign(this, { el, kind, source, name, url });
    this.version++;
    return this;
  }

  clear() {
    if (!this.el) return;
    if (this.kind === 'video') this.el.pause();
    if (this.source instanceof Blob) URL.revokeObjectURL(this.url);
    this.el = this.kind = this.source = this.url = null;
    this.name = '';
    this.version++;
  }

  get ready() { return !!this.el && (this.kind === 'image' || this.el.readyState >= 2); }
  get size() {
    if (!this.el) return [1, 1];
    return this.kind === 'video' ? [this.el.videoWidth, this.el.videoHeight] : [this.el.naturalWidth, this.el.naturalHeight];
  }
  get time() { return this.kind === 'video' ? this.el.currentTime : 0; }

  // Keeps this video in step with another clock: the <audio> player when the video's sound is the
  // music, or the main window's video for a projector. Small drift is corrected by playing up to 10 %
  // faster or slower; only a big gap (a seek, a loop) jumps, and never while a jump is still
  // decoding. Jumping on every small drift kept stalling the decoder: the video froze.
  follow(target) {
    if (this.kind !== 'video') return;
    const v = this.el;
    if (target.paused !== v.paused) target.paused ? v.pause() : v.play().catch(() => {});
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

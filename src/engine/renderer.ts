// WebGL2 pipeline:
//   1. scene shader(s)  -> scene targets (two while crossfading)
//   2. feedback pass    -> the previous frame, faded in place by the trails amount, and the scene:
//                          the brighter of the two wins per channel (ping-pong). That is the
//                          trails' afterglow, where each line was drawn
//   3. display pass     -> tonemap, chromatic aberration, vignette, grain (not on black) -> canvas
//
// Programs compile in the background (KHR_parallel_shader_compile) so typing in the editor never
// stalls the show; the previous program keeps running until the new one is ready. Media uploads go
// through immutable storage + texSubImage2D, once per decoded video frame. Snapshots read back
// asynchronously through a pixel buffer and a fence, so thumbnails don't stall the GPU.

import { COMMON } from '../scenes';
import type { MediaLayer } from './media';
import type { UniformValue } from './params';
import { stillSpectrum, writeInputs, type SnapshotUniforms } from './scene-inputs';

const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}
`;

const FEEDBACK = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSceneA, uSceneB, uPrev;
uniform float uMix, uFeedback;

void main() {
  vec3 scene = mix(texture(uSceneB, vUv).rgb, texture(uSceneA, vUv).rgb, uMix);
  // The previous frame, at the same pixel (it never moves or spins), faded by the trails amount; the
  // brighter of the scene and that afterglow wins, per channel. Capped so it can never run away.
  vec3 prev = texture(uPrev, vUv).rgb * uFeedback;
  fragColor = vec4(min(max(scene, prev), vec3(8.)), 1.);
}
`;

const DISPLAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uAberr, uTime;
uniform float uExposure, uContrast, uSat;   // synesthesia grading, all 1.0 = neutral
uniform vec3 uTint;
uniform float uMaster;                      // master fader: 0 = blackout

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec2 c = vUv - .5;
  vec2 off = c * uAberr;
  vec3 col = vec3(texture(uTex, vUv + off).r, texture(uTex, vUv).g, texture(uTex, vUv - off).b);
  col *= uExposure * uTint;
  col = 1. - exp(-col * 1.3);
  col = pow(col, vec3(uContrast));            // >1 crisper darks, <1 hazy and soft
  float l = dot(col, vec3(.299, .587, .114));
  col = mix(vec3(l), col, uSat);
  col *= 1. - dot(c, c) * .6;
  // Grain fades out below a low brightness, so black stays exactly black on a projector.
  float lit = smoothstep(0., .05, max(col.r, max(col.g, col.b)));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.) - .5) * .015 * lit;
  fragColor = vec4(clamp(col, 0., 1.) * uMaster, 1.);
}
`;

export type SceneUniforms = Record<string, UniformValue | WebGLTexture>;
export interface SceneSource { name: string; frag: string }

export interface Grade { exposure: number; contrast: number; saturation: number; tint: number[] }

// Everything the pipeline needs for one frame. Plain data: it also travels to projector windows.
export interface ProgramState {
  scene: number;
  prevScene: number;
  mix: number;
  time: number;
  bass: number;
  mid: number;
  high: number;
  level: number;
  beat: number;
  tickPhase: number;
  ticks: number;
  hue: number;
  spectrum: Uint8Array;
  bright: number;
  mood: number;
  grade: Grade;
  feedback: number;
  aberration: number;
  master?: number;
  mediaTime?: number;
  mediaPaused?: boolean;
  mediaRate?: number;
}


interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Targets { sceneA: Target; sceneB: Target; read: Target; write: Target }
type Locations = Map<string, WebGLUniformLocation | null>;
interface Pending { prog: WebGLProgram; fs: WebGLShader; name: string; promise: Promise<string | null>; resolve: (error: string | null) => void; settled: boolean }

const ONE_ONE = [1, 1];
const MAX_REMEMBERED = 64;   // failed sources kept, so a broken scene isn't recompiled every frame

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  scale = 0.75;
  size: [number, number] = [0, 0];
  readonly sceneParams: SceneUniforms[] = [];   // per scene index: live @param values as uniforms
  private paramsOverride: Record<number, SceneUniforms> | null = null;   // see render()

  private floatTargets: boolean;
  private readonly parallel: { COMPLETION_STATUS_KHR: number } | null;
  private vao!: WebGLVertexArrayObject;
  private vert!: WebGLShader;
  private readonly uniformCache = new Map<WebGLProgram, Locations>();
  private readonly programs = new Map<string, WebGLProgram>();     // frag source -> program
  private readonly failed = new Set<string>();                     // sources that didn't compile (not retried every frame)
  private readonly pending = new Map<string, Pending>();           // sources compiling in the background
  private readonly inUse: (string | undefined)[] = [];             // per scene index: the source currently compiled for it
  private feedbackProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;

  private media: MediaLayer | null = null;
  private mediaVersion = -1;
  private mediaTex!: WebGLTexture;
  private mediaTexSize: [number, number] = [0, 0];
  private readonly mediaUse = new Map<string, boolean>();          // frag source -> does it sample the media?
  private readonly mediaUniformValues: { uMedia: WebGLTexture | null; uMediaSize: number[]; uHasMedia: number } = { uMedia: null, uMediaSize: ONE_ONE, uHasMedia: 0 };
  private watchedVideo: HTMLVideoElement | null = null;
  private videoCallback = 0;
  private videoFrameDirty = false;
  private lastVideoTime = -1;

  private specTex!: WebGLTexture;
  private targets: Targets | null = null;
  private pendingSize: [number, number] | null = null;
  private cssSize: [number, number] | null = null;   // the canvas's size as the observer last reported it
  private maxPixelRatio = 2;   // Settings → Display (src/state/prefs.ts)
  private readonly observer: ResizeObserver | null;
  private thumb: { scene: Target; out: Target } | null = null;
  private burst: { targets: Targets; out: Target } | null = null;   // still frames with a Look (stillAsync)
  private fakeSpectrum: Uint8Array | null = null;
  private pbo: WebGLBuffer | null = null;
  private pboSize = 0;
  private snapshotQueue: Promise<unknown> = Promise.resolve();
  private readonly sceneUniforms: SceneUniforms = {};
  private readonly feedbackUniforms: SceneUniforms = {};
  private readonly displayUniforms: SceneUniforms = {};
  private lost = false;
  private disposed = false;
  private readonly onLost = (e: Event) => { e.preventDefault(); this.lost = true; };
  private readonly onRestored = () => this.rebuild();

  // `scenes` is a shared list of { name, frag }. Programs compile on first use and are cached by
  // source, so several renderers (main, studio preview, projector) can share one list.
  constructor(readonly canvas: HTMLCanvasElement, private readonly scenes: readonly SceneSource[]) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported in this browser.');
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
    this.setup();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    // Size changes arrive from the observer, so no frame has to read layout (P1).
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      this.cssSize = [rect.width, rect.height];
      this.pendingSize = this.pixels(rect.width, rect.height);
    });
    this.observer?.observe(canvas);
  }

  private setup(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray()!;
    this.vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(this.vert, VERT);
    gl.compileShader(this.vert);
    this.feedbackProgram = this.compileSync(FEEDBACK, 'feedback');
    this.displayProgram = this.compileSync(DISPLAY, 'display');

    this.mediaTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    this.setSampling(gl.LINEAR);
    this.mediaTexSize = [1, 1];
    this.mediaUniformValues.uMedia = this.mediaTex;
    this.mediaVersion = -1;

    this.specTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 256, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(512));
    this.setSampling(gl.LINEAR);
  }

  // After a context restore every GPU object is gone: forget them all and start over.
  private rebuild(): void {
    this.programs.clear();
    this.uniformCache.clear();
    this.failed.clear();
    for (const p of this.pending.values()) if (!p.settled) { p.settled = true; p.resolve('The graphics context was reset. Try again.'); }
    this.pending.clear();
    this.inUse.length = 0;
    this.targets = null;
    this.thumb = null;
    this.burst = null;
    this.pbo = null;
    this.pboSize = 0;
    this.size = [0, 0];
    this.floatTargets = !!this.gl.getExtension('EXT_color_buffer_float');
    this.setup();
    this.lost = false;
  }

  // ---------- Programs ----------

  private compileSync(fragSrc: string, name: string): WebGLProgram {
    const { prog, fs } = this.link(fragSrc);
    const error = this.finishLink(prog, fs, name);
    if (error) throw new Error(error);
    return prog;
  }

  private link(fragSrc: string): { prog: WebGLProgram; fs: WebGLShader } {
    const gl = this.gl;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.vert);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return { prog, fs };
  }

  // Blocks until the link is done (so call it only when COMPLETION_STATUS_KHR says it is, or on purpose).
  private finishLink(prog: WebGLProgram, fs: WebGLShader, name: string): string | null {
    const gl = this.gl;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const error = gl.getShaderParameter(fs, gl.COMPILE_STATUS)
        ? `Program "${name}" failed:\n${gl.getProgramInfoLog(prog)}`
        : `Shader "${name}" failed:\n${gl.getShaderInfoLog(fs)}`;
      gl.deleteProgram(prog);
      gl.deleteShader(fs);
      return error;
    }
    gl.deleteShader(fs);
    this.uniformCache.set(prog, new Map());
    return null;
  }

  // Remembers a source that doesn't compile (so a scene using it isn't recompiled every frame). Typing
  // produces a broken source per keystroke, so only the newest few are kept.
  private markFailed(fragSrc: string): void {
    this.failed.delete(fragSrc);
    this.failed.add(fragSrc);
    if (this.failed.size > MAX_REMEMBERED) this.failed.delete(this.failed.values().next().value!);
  }

  private settle(fragSrc: string, p: Pending): string | null {
    if (p.settled) return null;
    p.settled = true;
    this.pending.delete(fragSrc);
    const error = this.finishLink(p.prog, p.fs, p.name);
    if (error) this.markFailed(fragSrc);
    else { this.programs.set(fragSrc, p.prog); this.failed.delete(fragSrc); }
    p.resolve(error);
    return error;
  }

  // Compiles (or reuses) the program for a shader source without blocking the frame. Resolves with
  // the compile error, or null. Repeated calls for the same source share one compile.
  compileAsync(fragSrc: string, name = 'scene'): Promise<string | null> {
    if (this.programs.has(fragSrc)) return Promise.resolve(null);
    const existing = this.pending.get(fragSrc);
    if (existing) return existing.promise;
    const { prog, fs } = this.link(fragSrc);
    let resolve!: (error: string | null) => void;
    const promise = new Promise<string | null>((r) => { resolve = r; });
    const p: Pending = { prog, fs, name, promise, resolve, settled: false };
    this.pending.set(fragSrc, p);
    if (!this.parallel) {
      this.settle(fragSrc, p);
    } else {
      const ext = this.parallel;
      const poll = () => {
        if (p.settled) return;
        if (this.disposed) { p.settled = true; this.pending.delete(fragSrc); resolve('Renderer disposed'); return; }
        if (this.gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) this.settle(fragSrc, p);
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
    return promise;
  }

  // Synchronous version for startup validation and saving: returns the compile error, or null.
  check(fragSrc: string, name = 'scene'): string | null {
    if (this.programs.has(fragSrc)) return null;
    const existing = this.pending.get(fragSrc);
    if (existing) return this.settle(fragSrc, existing);
    const { prog, fs } = this.link(fragSrc);
    const error = this.finishLink(prog, fs, name);
    if (error) this.markFailed(fragSrc);
    else this.programs.set(fragSrc, prog);
    return error;
  }

  private program(index: number, sync = false): WebGLProgram | null {
    const scene = this.scenes[index];
    if (!scene) return null;
    const frag = scene.frag;
    if (!this.programs.has(frag) && !this.failed.has(frag)) {
      if (sync) {
        const error = this.check(frag, scene.name);
        if (error) console.error(error);
      } else if (!this.pending.has(frag)) {
        this.compileAsync(frag, scene.name).then((error) => { if (error) console.error(error); });
      }
    }
    const old = this.inUse[index];
    this.inUse[index] = frag;
    if (old && old !== frag && !this.inUse.includes(old)) this.drop(old);   // free code you edited away
    return this.programs.get(frag) ?? null;
  }

  // Frees a program compiled for code that never went live (a superseded editor compile).
  release(frag: string): void {
    if (!this.inUse.includes(frag)) this.drop(frag);
  }

  private drop(frag: string): void {
    const prog = this.programs.get(frag);
    if (!prog) return;
    this.gl.deleteProgram(prog);
    this.uniformCache.delete(prog);
    this.programs.delete(frag);
    this.mediaUse.delete(frag);
  }

  // ---------- Media ----------

  setMedia(layer: MediaLayer | null): void {
    this.media = layer;
  }

  usesMedia(index: number): boolean {
    const frag = this.scenes[index]?.frag;
    if (!frag) return false;
    let uses = this.mediaUse.get(frag);
    if (uses === undefined) { uses = /\b(media|uMedia)\b/.test(frag.slice(COMMON.length)); this.mediaUse.set(frag, uses); }
    return uses;
  }

  // Uploads the media when it changed and once per new video frame, but only while a scene on
  // screen samples it. Returns the media uniforms (one reused object).
  private mediaUniforms(indexA: number, indexB: number): SceneUniforms {
    const m = this.media;
    const u = this.mediaUniformValues;
    const ready = !!m?.ready;
    if (m && ready && ((indexA >= 0 && this.usesMedia(indexA)) || (indexB >= 0 && this.usesMedia(indexB)))) {
      const video = m.video;
      if (m.version !== this.mediaVersion) { this.watchVideo(video); this.upload(m); }
      else if (video && !video.paused && this.videoFrameReady(video)) this.upload(m);
    }
    u.uMediaSize = ready ? this.mediaTexSize : ONE_ONE;
    u.uHasMedia = m && ready && this.mediaVersion === m.version ? 1 : 0;
    return u as SceneUniforms;
  }

  private upload(m: MediaLayer): void {
    const gl = this.gl;
    const [w, h] = m.size;
    if (w !== this.mediaTexSize[0] || h !== this.mediaTexSize[1]) {   // immutable storage: reallocate on a size change
      gl.deleteTexture(this.mediaTex);
      this.mediaTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      this.setSampling(gl.LINEAR);
      this.mediaTexSize = [w, h];
      this.mediaUniformValues.uMedia = this.mediaTex;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, m.el!);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.mediaVersion = m.version;
    this.videoFrameDirty = false;
    this.lastVideoTime = m.video?.currentTime ?? -1;
  }

  // A decoded frame is what makes an upload worth it: requestVideoFrameCallback where it exists,
  // otherwise a change of currentTime.
  private videoFrameReady(video: HTMLVideoElement): boolean {
    if (typeof video.requestVideoFrameCallback === 'function') return this.videoFrameDirty;
    return video.currentTime !== this.lastVideoTime;
  }

  private watchVideo(video: HTMLVideoElement | null): void {
    if (this.watchedVideo && this.videoCallback) this.watchedVideo.cancelVideoFrameCallback?.(this.videoCallback);
    this.watchedVideo = video;
    this.videoCallback = 0;
    this.videoFrameDirty = true;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    const tick = () => {
      this.videoFrameDirty = true;
      if (this.watchedVideo === video && !this.disposed) this.videoCallback = video.requestVideoFrameCallback(tick);
    };
    this.videoCallback = video.requestVideoFrameCallback(tick);
  }

  // ---------- Parameters ----------

  // Values for a scene's @param uniforms; applied every frame, no recompiling.
  setParams(index: number, uniforms: SceneUniforms): void {
    this.sceneParams[index] = uniforms;
  }

  // ---------- Snapshots ----------

  private renderThumb(index: number, uniforms: SnapshotUniforms, w: number, h: number, spectrum?: Uint8Array): Target {
    const gl = this.gl;
    if (this.thumb && (this.thumb.out.w !== w || this.thumb.out.h !== h)) {   // previews and assistant frames differ in size
      for (const t of [this.thumb.scene, this.thumb.out]) this.deleteTarget(t);
      this.thumb = null;
    }
    if (!this.thumb) this.thumb = { scene: this.createTarget(w, h), out: this.createTarget(w, h, true) };
    this.fakeSpectrum ??= stillSpectrum();
    const t = this.thumb;
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RG, gl.UNSIGNED_BYTE, spectrum ?? this.fakeSpectrum);
    const prog = this.program(index, true);
    if (prog) {
      this.use(prog, uniforms as unknown as SceneUniforms, this.mediaUniforms(index, -1), { uRes: [w, h], uSpec: this.specTex }, this.sceneParams[index]);
      this.draw(t.scene);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.scene.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.use(this.displayProgram, { uTex: t.scene.tex, uAberr: 0, uTime: 0, uExposure: 1, uContrast: 1, uSat: 1, uTint: [1, 1, 1], uMaster: 1 });
    this.draw(t.out);
    return t.out;
  }

  // Render one still frame of a scene (scene + display pass, no trails) with stand-in audio.
  // Synchronous readback: use snapshotAsync() from the UI.
  snapshot(index: number, uniforms: SnapshotUniforms, w = 320, h = 180): ImageData {
    const gl = this.gl;
    const out = this.renderThumb(index, uniforms, w, h);
    const px = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return new ImageData(flipRows(px, w, h), w, h);
  }

  // Same picture, but the GPU is never stalled (see readbackAsync). `spectrum` (256 × RG bytes)
  // replaces the stand-in one, e.g. with silence.
  snapshotAsync(index: number, uniforms: SnapshotUniforms, w = 320, h = 180, spectrum?: Uint8Array): Promise<ImageData> {
    return this.readbackAsync(() => this.renderThumb(index, uniforms, w, h, spectrum), w, h);
  }

  // A still frame through the whole pipeline (scene, trails, fringing, grade): draws `frames` in order
  // into targets of its own, starting from black, and returns the last. composeStill() (look.ts) makes them.
  stillAsync(frames: readonly ProgramState[], w = 320, h = 180): Promise<ImageData> {
    return this.readbackAsync(() => this.renderBurst(frames, w, h), w, h);
  }

  private renderBurst(frames: readonly ProgramState[], w: number, h: number): Target {
    const gl = this.gl;
    if (this.burst && (this.burst.out.w !== w || this.burst.out.h !== h)) this.deleteBurst();
    this.burst ??= {
      targets: { sceneA: this.createTarget(w, h), sceneB: this.createTarget(w, h), read: this.createTarget(w, h), write: this.createTarget(w, h) },
      out: this.createTarget(w, h, true),
    };
    const { targets, out } = this.burst;
    for (const t of [targets.read, targets.write]) {   // no afterglow from the last burst
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const s of frames) {
      this.program(s.scene, true);   // compiled now, or the burst would draw black while it compiles
      this.pipeline(s, targets, out);
    }
    return out;
  }

  private deleteBurst(): void {
    if (!this.burst) return;
    for (const t of [...Object.values(this.burst.targets), this.burst.out]) this.deleteTarget(t);
    this.burst = null;
  }

  private deleteTarget(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  // Reads back what `render()` drew without stalling the GPU: the pixels come through a pixel buffer
  // once a fence says the frame is done. Calls are queued, so they share one set of targets.
  private readbackAsync(render: () => Target, w: number, h: number): Promise<ImageData> {
    const run = async (): Promise<ImageData> => {
      const gl = this.gl;
      if (this.disposed || this.lost) throw new Error('Renderer unavailable');
      const out = render();
      const bytes = w * h * 4;
      this.pbo ??= gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      if (this.pboSize !== bytes) { gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ); this.pboSize = bytes; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      await new Promise<void>((resolve, reject) => {
        const poll = () => {
          if (this.disposed || this.lost) return reject(new Error('Renderer unavailable'));
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) resolve();
          else if (status === gl.WAIT_FAILED) reject(new Error('GPU readback failed'));
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      gl.deleteSync(sync);
      const px = new Uint8ClampedArray(bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return new ImageData(flipRows(px, w, h), w, h);
    };
    const next = this.snapshotQueue.then(run, run);
    this.snapshotQueue = next.catch(() => {});
    return next;
  }

  // ---------- Targets ----------

  private setSampling(filter: number): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private createTarget(w: number, h: number, bytes = false): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatTargets && !bytes) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setSampling(gl.LINEAR);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.floatTargets) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      this.floatTargets = false;
      return this.createTarget(w, h);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }

  private resize(force = false): void {
    if (!force && !this.pendingSize && this.targets) return;
    let [w, h] = this.pendingSize ?? [0, 0];
    if (!this.pendingSize) [w, h] = this.pixels(this.canvas.clientWidth, this.canvas.clientHeight);   // before the observer has reported: one layout read
    this.pendingSize = null;
    if (!force && w === this.size[0] && h === this.size[1] && this.targets) return;
    this.size = [w, h];
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.targets) for (const t of Object.values(this.targets)) this.deleteTarget(t);
    const iw = Math.max(1, Math.round(w * this.scale));
    const ih = Math.max(1, Math.round(h * this.scale));
    this.targets = {
      sceneA: this.createTarget(iw, ih),
      sceneB: this.createTarget(iw, ih),
      read: this.createTarget(iw, ih),
      write: this.createTarget(iw, ih),
    };
  }

  // The share of the canvas the scenes render at. A rescale restarts the trails, so the same scale
  // again does nothing: callers can pass the Resolution setting every time preferences apply.
  setScale(scale: number): void {
    if (scale === this.scale && this.targets) return;
    this.scale = scale;
    this.resize(true);
  }

  // Caps the device pixel ratio the canvas renders at (a HiDPI screen at 2 draws four times the
  // pixels of 1). Applied at the next frame, from the size the observer last reported.
  setMaxPixelRatio(ratio: number): void {
    if (ratio === this.maxPixelRatio) return;
    this.maxPixelRatio = ratio;
    if (this.cssSize) this.pendingSize = this.pixels(...this.cssSize);
  }

  private pixels(cssWidth: number, cssHeight: number): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    return [Math.max(1, Math.floor(cssWidth * dpr)), Math.max(1, Math.floor(cssHeight * dpr))];
  }

  // ---------- Drawing ----------

  // Binds the program and uploads every uniform set in order; texture units are shared across sets.
  private use(prog: WebGLProgram, ...sets: (SceneUniforms | undefined)[]): void {
    const gl = this.gl;
    const cache = this.uniformCache.get(prog)!;
    gl.useProgram(prog);
    let unit = 0;
    for (const uniforms of sets) {
      if (!uniforms) continue;
      for (const name in uniforms) {
        const value = uniforms[name];
        if (value == null) continue;
        let loc = cache.get(name);
        if (loc === undefined) { loc = gl.getUniformLocation(prog, name); cache.set(name, loc); }
        if (loc === null) continue;
        if (typeof value === 'number') gl.uniform1f(loc, value);
        else if (value instanceof WebGLTexture) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, value);
          gl.uniform1i(loc, unit++);
        } else if (value instanceof Float32Array) gl.uniform4fv(loc, value);
        else if (value.length === 4) gl.uniform4f(loc, value[0]!, value[1]!, value[2]!, value[3]!);
        else if (value.length === 3) gl.uniform3f(loc, value[0]!, value[1]!, value[2]!);
        else gl.uniform2f(loc, value[0]!, value[1]!);
      }
    }
  }

  // A scene that failed to compile (or is still compiling) renders black instead of stopping the show.
  private drawScene(index: number, target: Target, ...sets: (SceneUniforms | undefined)[]): void {
    const prog = this.program(index);
    if (prog) {
      this.use(prog, ...sets, this.paramsOverride?.[index] ?? this.sceneParams[index]);
      this.draw(target);
      return;
    }
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private draw(target: Target | null): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.size[0], target ? target.h : this.size[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // `params` replaces the stored @param values of the scenes it lists, for this frame only: the main
  // window showing the Studio's Live slot draws it with Live's values, like a projector does.
  render(s: ProgramState, params?: Record<number, SceneUniforms>): void {
    if (this.lost || this.disposed) return;
    this.paramsOverride = params ?? null;
    try { this.renderFrame(s); } finally { this.paramsOverride = null; }
  }

  private renderFrame(s: ProgramState): void {
    this.resize();
    this.pipeline(s, this.targets!, null);
  }

  // One frame from the scene(s) to `out` (null: the canvas), keeping the trails in `t`.
  private pipeline(s: ProgramState, t: Targets, out: Target | null): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RG, gl.UNSIGNED_BYTE, s.spectrum);

    const u = this.sceneUniforms;
    u.uRes = [t.sceneA.w, t.sceneA.h];
    writeInputs(u, s);
    u.uSpec = this.specTex;
    const media = this.mediaUniforms(s.scene, s.prevScene);
    this.drawScene(s.scene, t.sceneA, u, media);
    const crossfading = s.prevScene >= 0 && s.mix < 1;
    if (crossfading) this.drawScene(s.prevScene, t.sceneB, u, media);

    const f = this.feedbackUniforms;
    f.uSceneA = t.sceneA.tex; f.uSceneB = crossfading ? t.sceneB.tex : t.sceneA.tex; f.uPrev = t.read.tex;
    f.uMix = crossfading ? s.mix : 1; f.uFeedback = s.feedback;
    this.use(this.feedbackProgram, f);
    this.draw(t.write);
    [t.read, t.write] = [t.write, t.read];

    const g = s.grade;
    const d = this.displayUniforms;
    d.uTex = t.read.tex; d.uAberr = s.aberration; d.uTime = s.time;
    d.uExposure = g.exposure; d.uContrast = g.contrast; d.uSat = g.saturation; d.uTint = g.tint; d.uMaster = s.master ?? 1;
    this.use(this.displayProgram, d);
    this.draw(out);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    this.watchVideo(null);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    for (const p of this.pending.values()) if (!p.settled) { p.settled = true; p.resolve('Renderer disposed'); gl.deleteProgram(p.prog); gl.deleteShader(p.fs); }
    this.pending.clear();
    for (const prog of this.programs.values()) gl.deleteProgram(prog);
    this.programs.clear();
    gl.deleteProgram(this.feedbackProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteShader(this.vert);
    if (this.targets) for (const t of Object.values(this.targets)) this.deleteTarget(t);
    if (this.thumb) for (const t of [this.thumb.scene, this.thumb.out]) this.deleteTarget(t);
    this.deleteBurst();
    gl.deleteTexture(this.mediaTex);
    gl.deleteTexture(this.specTex);
    if (this.pbo) gl.deleteBuffer(this.pbo);
    gl.deleteVertexArray(this.vao);
    this.targets = null;
    this.thumb = null;
  }
}

// GL rows run bottom-up.
function flipRows(px: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const flipped = new Uint8ClampedArray(new ArrayBuffer(px.length));
  for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return flipped;
}

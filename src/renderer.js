// WebGL2 pipeline:
//   1. scene shader(s)  -> scene targets (two while crossfading)
//   2. feedback pass    -> mixes scene with a zoomed/rotated/hue-shifted copy of the
//                          previous frame (ping-pong), giving Milkdrop-style trails
//   3. display pass     -> tonemap, chromatic aberration, vignette, grain -> canvas

import { COMMON } from './scenes.js';

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
uniform float uMix, uFeedback, uZoom, uRot, uHueDrift, uWarp, uTime, uAspect;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca);
}

void main() {
  vec3 scene = mix(texture(uSceneB, vUv).rgb, texture(uSceneA, vUv).rgb, uMix);

  vec2 c = vUv - .5;
  c.x *= uAspect;

  c *= rot(uRot);
  c /= uZoom;
  float r = length(c);
  c += c / max(r, 1e-4) * sin(r * 18. - uTime * 2.) * .003 * uWarp;
  c.x /= uAspect;

  vec3 prev = texture(uPrev, c + .5).rgb;
  prev = max(hueShift(prev, uHueDrift), 0.) * uFeedback;
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
  col = mix(vec3(l), col, 1.15 * uSat);
  col *= 1. - dot(c, c) * .6;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.) - .5) * .015;
  fragColor = vec4(clamp(col, 0., 1.) * uMaster, 1.);
}
`;

export class Renderer {
  // `scenes` is a shared list of { name, frag }. Programs compile on first use and are cached by
  // source, so several renderers (main, studio preview, projector) can share one list.
  constructor(canvas, scenes) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.scale = 0.75;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.vao = gl.createVertexArray();
    this.uniformCache = new Map();
    this.sceneParams = [];   // per scene: live @param values as uniforms

    this.scenes = scenes;
    this.programs = new Map();     // frag source -> program
    this.failed = new Set();       // sources that didn't compile (not retried every frame)
    this.inUse = [];               // per scene index: the source currently compiled for it
    this.feedbackProgram = this.compile(FEEDBACK, 'feedback');
    this.displayProgram = this.compile(DISPLAY, 'display');

    this.media = null;             // MediaLayer (dropped image / video)
    this.mediaVersion = -1;
    this.mediaUse = new Map();     // frag source -> does it sample the media?
    this.mediaTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.setSampling(gl.LINEAR);

    this.specTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 256, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(512));
    this.setSampling(gl.LINEAR);

    this.size = [0, 0];
    this.targets = null;
  }

  compile(fragSrc, name) {
    const gl = this.gl;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader "${name}" failed:\n${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Program "${name}" failed:\n${gl.getProgramInfoLog(prog)}`);
    this.uniformCache.set(prog, new Map());
    return prog;
  }

  // Compiles (or reuses) the program for a shader source. Returns the compile error, or null.
  check(fragSrc, name = 'scene') {
    if (this.programs.has(fragSrc)) return null;
    try {
      this.programs.set(fragSrc, this.compile(fragSrc, name));
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // Hot-swap a scene's shader (used by the editors). Returns the compile error, or null;
  // on success the shared scene list gets the new source.
  replaceScene(index, fragSrc) {
    const error = this.check(fragSrc, this.scenes[index]?.name);
    if (!error) this.scenes[index].frag = fragSrc;
    return error;
  }

  program(index) {
    const scene = this.scenes[index];
    if (!scene) return null;
    const frag = scene.frag;
    if (!this.programs.has(frag) && !this.failed.has(frag)) {
      const error = this.check(frag, scene.name);
      if (error) { this.failed.add(frag); console.error(error); }
    }
    const old = this.inUse[index];
    this.inUse[index] = frag;
    if (old && old !== frag && !this.inUse.includes(old)) this.drop(old);   // free code you edited away
    return this.programs.get(frag) ?? null;
  }

  drop(frag) {
    const prog = this.programs.get(frag);
    if (!prog) return;
    this.gl.deleteProgram(prog);
    this.uniformCache.delete(prog);
    this.programs.delete(frag);
  }

  setMedia(layer) {
    this.media = layer;
  }

  usesMedia(index) {
    const frag = this.scenes[index]?.frag;
    if (!frag) return false;
    if (!this.mediaUse.has(frag)) this.mediaUse.set(frag, /\b(media|uMedia)\b/.test(frag.slice(COMMON.length)));
    return this.mediaUse.get(frag);
  }

  // Uploads the media when it changed, and every frame for a playing video, but only while a
  // scene on screen samples it. Returns the media uniforms.
  mediaUniforms(...indices) {
    const m = this.media;
    const ready = !!m?.ready;
    if (ready && indices.some((i) => i >= 0 && this.usesMedia(i)) && (m.version !== this.mediaVersion || (m.kind === 'video' && !m.el.paused))) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, m.el);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.mediaVersion = m.version;
    }
    return { uMedia: this.mediaTex, uMediaSize: ready ? m.size : [1, 1], uHasMedia: ready && this.mediaVersion === m.version ? 1 : 0 };
  }

  // Values for a scene's @param uniforms; applied every frame, no recompiling.
  setParams(index, uniforms) {
    this.sceneParams[index] = uniforms;
  }

  // Render one still frame of a scene (scene + display pass, no trails) with stand-in audio,
  // for the library thumbnails. Returns ImageData.
  snapshot(index, uniforms, w = 320, h = 180) {
    const gl = this.gl;
    if (this.thumb && (this.thumb.out.w !== w || this.thumb.out.h !== h)) {   // previews and assistant frames differ in size
      for (const t of [this.thumb.scene, this.thumb.out]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
      this.thumb = null;
    }
    if (!this.thumb) {
      this.thumb = { scene: this.createTarget(w, h), out: this.createTarget(w, h, true) };
      this.fakeSpectrum = new Uint8Array(512);
      for (let i = 0; i < 256; i++) {
        const x = i / 255;
        this.fakeSpectrum[i * 2] = 255 * Math.min(1, Math.max(0, 0.85 - x * 0.55 + 0.15 * Math.sin(i * 0.21)));
        this.fakeSpectrum[i * 2 + 1] = 128 + 90 * Math.sin(x * 25) * Math.cos(x * 7);
      }
    }
    const t = this.thumb;
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RG, gl.UNSIGNED_BYTE, this.fakeSpectrum);
    this.drawScene(index, { ...uniforms, ...this.mediaUniforms(index), uRes: [w, h], uSpec: this.specTex }, t.scene);
    this.use(this.displayProgram, {
      uTex: t.scene.tex, uAberr: 0, uTime: 0, uExposure: 1, uContrast: 1, uSat: 1, uTint: [1, 1, 1], uMaster: 1,
    });
    this.draw(t.out);
    const px = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const flipped = new Uint8ClampedArray(px.length);   // GL rows run bottom-up
    for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return new ImageData(flipped, w, h);
  }

  setSampling(filter) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  createTarget(w, h, bytes = false) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatTargets && !bytes) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setSampling(gl.LINEAR);
    const fbo = gl.createFramebuffer();
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

  resize(force = false) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (!force && w === this.size[0] && h === this.size[1]) return;
    this.size = [w, h];
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.targets) for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    const iw = Math.max(1, Math.round(w * this.scale));
    const ih = Math.max(1, Math.round(h * this.scale));
    this.targets = {
      sceneA: this.createTarget(iw, ih),
      sceneB: this.createTarget(iw, ih),
      read: this.createTarget(iw, ih),
      write: this.createTarget(iw, ih),
    };
  }

  setScale(scale) {
    this.scale = scale;
    this.resize(true);
  }

  use(prog, uniforms) {
    const gl = this.gl;
    const cache = this.uniformCache.get(prog);
    gl.useProgram(prog);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
      const loc = cache.get(name);
      if (loc === null) continue;
      if (typeof value === 'number') gl.uniform1f(loc, value);
      else if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(loc, unit++);
      } else if (value instanceof Float32Array) gl.uniform4fv(loc, value);
      else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
      else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      else gl.uniform2f(loc, value[0], value[1]);
    }
  }

  // A scene that failed to compile renders black instead of stopping the show.
  drawScene(index, uniforms, target) {
    const prog = this.program(index);
    if (prog) {
      this.use(prog, { ...uniforms, ...this.sceneParams[index] });
      return this.draw(target);
    }
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.size[0], target ? target.h : this.size[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(s) {
    const gl = this.gl;
    this.resize();
    const t = this.targets;
    gl.bindVertexArray(this.vao);

    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RG, gl.UNSIGNED_BYTE, s.spectrum);

    const sceneUniforms = {
      uRes: [t.sceneA.w, t.sceneA.h],
      uTime: s.time, uBass: s.bass, uMid: s.mid, uHigh: s.high, uLevel: s.level, uBeat: s.beat, uHue: s.hue,
      uBright: s.bright, uMood: s.mood,
      uSpec: this.specTex, ...this.mediaUniforms(s.scene, s.prevScene), ...s.extra,
    };
    this.drawScene(s.scene, sceneUniforms, t.sceneA);
    const crossfading = s.prevScene >= 0 && s.mix < 1;
    if (crossfading) {
      this.drawScene(s.prevScene, sceneUniforms, t.sceneB);
    }

    this.use(this.feedbackProgram, {
      uSceneA: t.sceneA.tex, uSceneB: crossfading ? t.sceneB.tex : t.sceneA.tex, uPrev: t.read.tex,
      uMix: crossfading ? s.mix : 1, uFeedback: s.feedback, uZoom: s.zoom, uRot: s.rotation,
      uHueDrift: s.hueDrift, uWarp: s.warp, uTime: s.time, uAspect: t.read.w / t.read.h,
    });
    this.draw(t.write);
    [t.read, t.write] = [t.write, t.read];

    const g = s.grade;
    this.use(this.displayProgram, {
      uTex: t.read.tex, uAberr: s.aberration, uTime: s.time,
      uExposure: g.exposure, uContrast: g.contrast, uSat: g.saturation, uTint: g.tint, uMaster: s.master ?? 1,
    });
    this.draw(null);
  }
}

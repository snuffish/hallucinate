// Projector window: renders the show it receives from the main window (see engine/output-link.ts)
// at this window's own resolution. Put it on the projector and go fullscreen.
// Plain TypeScript on purpose: two overlays and a canvas don't need a framework.

import { Renderer, type SceneSource, type SceneUniforms } from './engine/renderer';
import { CHANNEL, type OutputMessage } from './engine/output-link';
import { MediaLayer } from './engine/media';

const $ = (id: string) => document.getElementById(id)!;
const id = crypto.randomUUID();
const channel = new BroadcastChannel(CHANNEL);
const scenes: SceneSource[] = [];
const media = new MediaLayer();
let renderer: Renderer;
try {
  renderer = new Renderer($('out') as HTMLCanvasElement, scenes);
} catch (err) {
  document.body.innerHTML = `<pre style="padding:24px;color:#f88;white-space:pre-wrap">${(err as Error).message}</pre>`;
  throw err;
}
renderer.setMedia(media);

let pending: Extract<OutputMessage, { type: 'frame' }> | null = null;   // newest frame not yet drawn
let lastFrameAt = -1e9;
let resolution = 0;
let frames = 0, fps = 0;

channel.onmessage = ({ data: m }: MessageEvent<OutputMessage>) => {
  if (m.type === 'scenes') scenes.splice(0, scenes.length, ...m.scenes);
  if (m.type === 'scene') scenes[m.index] = m.scene;
  if (m.type === 'frame') { pending = m; lastFrameAt = performance.now(); }
  if (m.type === 'identify') identify();
  if (m.type === 'media') { if (m.source) media.load(m.source).catch((err) => console.error(err)); else media.clear(); }
};
channel.postMessage({ type: 'hello', id } satisfies OutputMessage);

// Draw each frame once as it arrives, so trails advance at the main window's pace.
function loop(): void {
  if (pending) {
    const m = pending;
    pending = null;
    for (const [index, uniforms] of Object.entries(m.params)) renderer.setParams(Number(index), uniforms as SceneUniforms);
    if (m.resolution !== resolution) renderer.setScale((resolution = m.resolution));
    media.follow({ currentTime: m.state.mediaTime ?? 0, paused: m.state.mediaPaused ?? false, playbackRate: m.state.mediaRate ?? 1 });
    renderer.render(m.state);
    frames++;
  }
  $('waiting').hidden = performance.now() - lastFrameAt < 2000;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

setInterval(() => {
  fps = frames;
  frames = 0;
  channel.postMessage({ type: 'status', id, w: renderer.size[0], h: renderer.size[1], fullscreen: !!document.fullscreenElement, fps } satisfies OutputMessage);
}, 1000);
window.addEventListener('pagehide', () => channel.postMessage({ type: 'bye', id } satisfies OutputMessage));

let identifyTimer: ReturnType<typeof setTimeout> | undefined;
function identify(): void {
  const el = $('identify');
  el.textContent = '';
  el.append('Projector', Object.assign(document.createElement('small'), { textContent: `${renderer.size[0]} × ${renderer.size[1]}${document.fullscreenElement ? ' · fullscreen' : ''}` }));
  el.hidden = false;
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
window.addEventListener('dblclick', toggleFullscreen);
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f') toggleFullscreen(); });

let idleTimer: ReturnType<typeof setTimeout> | undefined;
function wake(): void {
  document.body.classList.remove('idle');
  $('hint').hidden = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { document.body.classList.add('idle'); $('hint').hidden = true; }, 2500);
}
window.addEventListener('mousemove', wake);
wake();

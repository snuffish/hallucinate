// Projector window: renders the show it receives from the main window (see engine/output-link.ts)
// at this window's own resolution. Put it on the projector and go fullscreen.
// Plain TypeScript on purpose: two overlays and a canvas don't need a framework.

import { Renderer, type SceneSource } from './engine/renderer';
import { broadcastPort, ProjectorView } from './engine/output-link';
import { MediaLayer, StaleMediaLoad } from './engine/media';

const $ = (id: string) => document.getElementById(id)!;
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

const view = new ProjectorView(broadcastPort(), renderer, media, scenes, {
  id: crypto.randomUUID(),
  onIdentify: () => identify(),
  onError: (err) => { if (!(err instanceof StaleMediaLoad)) console.error(err); },
});
view.start();

function loop(): void {
  view.draw();
  $('waiting').hidden = !view.waiting;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

setInterval(() => view.report(!!document.fullscreenElement), 1000);
window.addEventListener('pagehide', () => view.bye());

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

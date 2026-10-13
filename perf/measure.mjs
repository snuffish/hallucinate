// Baseline / after-port performance probe. Run with the dev server up:
//   node perf/measure.mjs http://localhost:5199/ perf/results/<name>.json
// Headless Chromium with SwiftShader: GPU numbers are not representative, main-thread
// numbers (long tasks, layouts, style recalcs, localStorage writes, frame cadence) are.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'perf/results/result.json';
const results = {};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__perf = { lsWrites: 0, longTasks: [] };
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__perf.lsWrites++; return orig.call(this, k, v); };
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function sample(name, ms) {
  const m0 = await metrics();
  await page.evaluate(() => { window.__perf.longTasks = []; window.__perf.lsWrites = 0; });
  const frames = await page.evaluate((ms) => new Promise((res) => {
    const d = []; let last = performance.now(); const t0 = last;
    const f = (n) => { d.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else res(d); };
    requestAnimationFrame(f);
  }), ms);
  const m1 = await metrics();
  const p = await page.evaluate(() => window.__perf);
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))];
  results[name] = {
    seconds: ms / 1000, frames: frames.length, frameMsP50: +q(0.5).toFixed(2), frameMsP95: +q(0.95).toFixed(2), frameMsMax: +sorted.at(-1).toFixed(2),
    longTasks: p.longTasks.length, longTaskMaxMs: +Math.max(0, ...p.longTasks).toFixed(1),
    layouts: m1.LayoutCount - m0.LayoutCount, styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
    lsWrites: p.lsWrites, heapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1),
  };
  console.log(name, JSON.stringify(results[name]));
}

page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.click('#start [data-source="demo"]');
await page.waitForTimeout(1500);
await sample('demo-first-scene', 8000);

for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(50); }   // Star Nest (index 10)
await page.waitForTimeout(2500);
await sample('star-nest', 8000);

await page.keyboard.press('l');
await page.waitForTimeout(100);
await sample('library-open', 6000);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

results['look-slider-300-inputs'] = await page.evaluate(async () => {
  window.__perf.lsWrites = 0; window.__perf.longTasks = [];
  const el = document.getElementById('hue');
  for (let i = 0; i < 300; i++) { el.value = String((i % 100) / 100); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); }
  return { lsWrites: window.__perf.lsWrites, longTasks: window.__perf.longTasks.length };
});
results['param-slider-200-inputs'] = await page.evaluate(async () => {
  window.__perf.lsWrites = 0; window.__perf.longTasks = [];
  const el = document.querySelector('#params-list input[type=range]');
  if (!el) return { skipped: 'no params on this scene' };
  const lo = Number(el.min), hi = Number(el.max);
  for (let i = 0; i < 200; i++) { el.value = String(lo + (hi - lo) * ((i % 50) / 50)); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); }
  return { lsWrites: window.__perf.lsWrites, longTasks: window.__perf.longTasks.length };
});
console.log('sliders', JSON.stringify(results['look-slider-300-inputs']), JSON.stringify(results['param-slider-200-inputs']));

await page.keyboard.press('e');
await page.waitForTimeout(400);
await page.evaluate(() => { window.__perf.longTasks = []; });
await page.evaluate(() => { const ta = document.getElementById('ed-code'); ta.value += '\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1500);
results['editor-keystroke-compile'] = await page.evaluate(() => ({ longTasks: window.__perf.longTasks.length, longTaskMaxMs: +Math.max(0, ...window.__perf.longTasks).toFixed(1) }));
console.log('editor', JSON.stringify(results['editor-keystroke-compile']));
await page.keyboard.press('Escape');

await fs.writeFile(out, JSON.stringify({ date: new Date().toISOString(), url, results }, null, 2));
await browser.close();

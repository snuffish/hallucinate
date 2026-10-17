// Baseline / after-port performance probe. Run with the dev server up:
//   node perf/measure.mjs http://localhost:5199/ perf/results/<name>.json [--gpu]
// Default: headless Chromium with SwiftShader. GPU numbers are not representative, main-thread
// numbers (long tasks, layouts, style recalcs, localStorage writes, frame cadence) are.
// --gpu: a visible window on the real GPU (headless Chromium falls back to SwiftShader), the app's
// own profiler (?perf) per scenario, and a GPU test of every scene, ranked slowest first.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const gpu = process.argv.includes('--gpu');
const [url = 'http://localhost:5199/', out = 'perf/results/result.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = {};

const autoplay = '--autoplay-policy=no-user-gesture-required';
const browser = await chromium.launch(gpu
  ? { headless: false, args: [autoplay] }
  : { args: [autoplay, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
  if (gpu) {
    const r = await page.evaluate(() => window.__profiler?.report());
    results[name].profiler = r;
    if (r) console.log('  profiler', r.verdict.kind, '·', r.verdict.text);
  }
}

page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(gpu ? `${url}${url.includes('?') ? '&' : '?'}perf` : url);
await page.click('#start [data-source="demo"]');
await page.waitForTimeout(1500);
await sample('demo-first-scene', 8000);

await page.keyboard.press('7');   // Point Storm (the slider scenarios below drag its parameters)
await page.waitForTimeout(2500);
await sample('point-storm', 8000);

// What effects cost per frame at the default resolution, against none: the app's profiler times the
// pipeline on the scene on screen (Point Storm) at the canvas's size and at 1920×1080 (a projector's
// load), with and without each stack. Settings as the catalogue has them (src/engine/effects.ts).
const EFFECT_STACKS = {
  'glow-default': [{ id: 'glow', on: true, settings: { strength: 0.8, radius: 10 } }],
  'glow-strongest': [{ id: 'glow', on: true, settings: { strength: 1.5, radius: 24 } }],
};
if (!gpu) await page.keyboard.press('Shift+P');   // installs window.__profiler
results['effects-cost'] = {};
for (const [name, effects] of Object.entries(EFFECT_STACKS)) for (const size of [undefined, [1920, 1080]]) {
  const cost = await page.evaluate(([effects, size]) => window.__profiler.effectsCost(effects, size ? { size } : {}), [effects, size]);
  const row = { none: +cost.none.toFixed(2), with: +cost.with.toFixed(2), extra: +cost.extra.toFixed(2), size: cost.size, scale: cost.scale };
  results['effects-cost'][`${name} @ ${cost.size.join('x')}`] = row;
  console.log('effects', name, JSON.stringify(row));
}
if (!gpu) await page.keyboard.press('Shift+P');

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

// Every scene at full and half resolution on a 4K canvas (a projector-sized load: at laptop sizes most
// scenes sit at the display's refresh, and a capped frame rate can't get faster). Slowest first.
if (gpu) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const stress = await ctx.newPage();
  await stress.goto(`${url}${url.includes('?') ? '&' : '?'}perf`);
  await stress.click('#start [data-source="demo"]');
  await stress.waitForTimeout(1500);
  // A scene change cuts a GPU test short. A DOM click: the idle fade may have made the widgets unclickable.
  await stress.evaluate(() => { const auto = document.getElementById('auto'); if (auto.checked) auto.click(); });
  console.log('ranking on', JSON.stringify(await stress.evaluate(() => { const r = window.__profiler.report(); return { canvas: r.size, scale: r.scale }; })));
  const ranking = [];
  for (const { index, name } of await stress.evaluate(() => window.__profiler.scenes())) {
    await stress.evaluate((i) => window.__profiler.setScene(i), index);
    await stress.waitForTimeout(2500);   // past the crossfade and the background compile
    const fill = await stress.evaluate(() => window.__profiler.fillTest());
    const r = await stress.evaluate(() => window.__profiler.report());
    const row = { index, name, baseFps: fill && +fill.baseFps.toFixed(1), halfFps: fill && +fill.reducedFps.toFixed(1), gain: fill && +fill.gain.toFixed(2), cpuMs: +r.cpuMean.toFixed(2) };
    ranking.push(row);
    console.log('fill', JSON.stringify(row));
  }
  ranking.sort((a, b) => (a.baseFps ?? Infinity) - (b.baseFps ?? Infinity));
  results['scene-fill-ranking'] = { ...(await stress.evaluate(() => { const r = window.__profiler.report(); return { canvas: r.size, scale: r.scale }; })), scenes: ranking };
  await ctx.close();
}

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ date: new Date().toISOString(), url, results }, null, 2));
await browser.close();

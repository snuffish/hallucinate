import { chromium } from '@playwright/test';
import { SOFTWARE_GL_ARGS } from '../scripts/chromium-args.mjs';
const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); });
await page.goto(process.argv[2] ?? 'http://localhost:5199/');
await page.click('#start [data-source="demo"]');
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.keyboard.press('l');
await page.waitForTimeout(6000);
const { profile } = await cdp.send('Profiler.stop');
const lt = await page.evaluate(() => window.__lt);
console.log('long tasks:', JSON.stringify(lt));
// Aggregate self time per function.
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let t = 0;
const counts = new Map();
for (let i = 0; i < profile.samples.length; i++) { counts.set(profile.samples[i], (counts.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0)); }
for (const [id, us] of counts) { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber}`; self.set(key, (self.get(key) ?? 0) + us); }
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 14);
for (const [k, us] of top) console.log(`${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
await browser.close();

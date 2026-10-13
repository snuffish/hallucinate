// Takes the README screenshots. Run with the dev server up:
//   node scripts/screenshots.mjs http://localhost:5199/
// Headless Chromium renders WebGL with SwiftShader, so give scenes a moment to build up trails.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = 'docs/screenshots';
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86, ...opts });
const settle = (ms) => page.waitForTimeout(ms);
const press = async (key, ms = 400) => { await page.keyboard.press(key); await settle(ms); };
// The panel auto-hides after 3 s without mouse movement: wake it before UI shots.
const wake = async () => { await page.mouse.move(700, 450); await page.mouse.move(720, 460); await settle(250); };

await page.goto(url);
await settle(2500);                                   // the start screen, with the background scene behind it
await shot('start');

await page.getByRole('button', { name: 'Play demo beat' }).click();
await press('2', 3500);                               // Hyper Tunnel
await wake();
await shot('main');                                   // panel + scene + parameters overlay

// Gallery: a few scenes, controls hidden, trails built up.
await page.addStyleTag({ content: '#params, .panel, #toast { display: none !important; }' });
const gallery = [['2', 'hyper-tunnel'], ['3', 'mandala-bloom'], ['8', 'voronoi-glass'], ['0', 'neon-loop']];
for (const [key, name] of gallery) { await press(key, 3500); await shot(name); }
await press('ArrowRight', 4500); await shot('star-nest');   // index 10, after Neon Loop
await press('ArrowRight', 300); await press('ArrowRight', 3500); await shot('liquid-blobs');
await page.addStyleTag({ content: '#params, .panel, #toast { display: revert !important; }' });

await press('2', 2500);
await wake();
await press('l', 100);
// Previews render a couple per frame; wait until the cards have their pictures.
await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('#lib-grid img')]; return imgs.length > 0 && imgs.every((i) => i.src); }, null, { timeout: 60_000 }).catch(() => {});
await settle(500);
await shot('library');
await press('Escape');

await wake(); await press('e', 600); await shot('editor'); await press('Escape');
await wake(); await press('n', 1200); await shot('visual-maker'); await press('Escape');
await press('2', 2500); await wake();                 // back to Hyper Tunnel (the visual maker switched to the Node Scene)
await press('o', 600);
await page.selectOption('#st-add', '@live'); await settle(300);
await page.selectOption('#st-add', 'Star Nest'); await settle(300);
await page.selectOption('#st-add', 'Neon Loop'); await settle(1500);
await wake();
await shot('studio');
await press('Escape');
await wake(); await press('i', 600); await shot('assistant'); await press('Escape');
await press('g', 4000); await shot('beat-racer'); await press('2');

await browser.close();
console.log('done:', (await fs.readdir(out)).join(' '));

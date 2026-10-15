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
// The controls auto-hide after 3 s without mouse movement: wake them before UI shots.
const wake = async () => { await page.mouse.move(700, 450); await page.mouse.move(720, 460); await settle(250); };

await page.goto(url);
await settle(2500);                                   // the start screen, cropped to a banner around the title
await shot('start', { clip: { x: 0, y: 250, width: 1440, height: 400 } });

await page.getByRole('button', { name: 'Play demo beat' }).click();
await press('2', 3500);                               // Hyper Tunnel
await wake();
await shot('main');                                   // widgets + scene + parameters

// The Look widget with Drift on, cropped to the widget.
await page.check('#drift'); await settle(1500); await wake();
await page.locator('[data-widget="look"]').screenshot({ path: `${out}/look-drift.jpg`, type: 'jpeg', quality: 86 });
await page.uncheck('#drift');
await page.evaluate(() => {
  document.activeElement?.blur();                     // hotkeys ignore keys while a checkbox has focus
  for (let el = document.querySelector('#drift'); el; el = el.parentElement) el.scrollTop = 0;   // checking it scrolled the panel
});

// Parameter groups: Aurora Veil, with two of its groups unfolded.
await press('l', 600); await press('/', 200);
await page.keyboard.type('Aurora'); await settle(300); await press('Enter', 3500);
await wake();
for (const g of ['Curtains', 'Colour']) await page.click(`.param-group[data-group="${g}"] .param-group-head`);
await settle(300); await wake();
await shot('params-groups');

// Gallery: a few scenes, controls hidden, trails built up.
await page.addStyleTag({ content: '#widgets, #toast { display: none !important; }' });
const gallery = [['2', 'hyper-tunnel'], ['3', 'mandala-bloom'], ['8', 'voronoi-glass'], ['0', 'neon-loop']];
for (const [key, name] of gallery) { await press(key, 3500); await shot(name); }
await press('ArrowRight', 4500); await shot('star-nest');   // index 10, after Neon Loop
await press('ArrowRight', 300); await press('ArrowRight', 3500); await shot('liquid-blobs');
await page.addStyleTag({ content: '#widgets, #toast { display: revert !important; }' });

await press('2', 2500);
await wake();
await press('l', 100);
// Previews render a couple per frame; wait until the cards have their pictures.
await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('#lib-grid img')]; return imgs.length > 0 && imgs.every((i) => i.src); }, null, { timeout: 60_000 }).catch(() => {});
await settle(500);
await shot('library');
await press('Escape');

// Shoot with some UI hidden: the Parameters overlay covers the editor's toolbar, the panel covers the block list.
const hidden = async (selector, fn) => {
  const tag = await page.addStyleTag({ content: `${selector} { display: none !important; }` });
  await fn(); await tag.evaluate((el) => el.remove());
};
await wake(); await press('e', 600); await hidden('#params', () => shot('editor')); await press('Escape');
await wake(); await press('n', 1200); await hidden('#widgets, #assistant-bubble', () => shot('visual-maker')); await press('Escape');
await press('2', 2500); await wake();                 // back to Hyper Tunnel (the visual maker switched to the Node Scene)
await press('o', 600);
await page.selectOption('#st-add', '@live'); await settle(300);
await page.selectOption('#st-add', 'Star Nest'); await settle(300);
await page.selectOption('#st-add', 'Neon Loop'); await settle(1500);
await wake();
await hidden('#assistant-bubble', () => shot('studio'));
await press('Escape');
await wake(); await press('i', 800); await wake(); await shot('assistant'); await press('Escape');   // the bubble opens beside the panel
await press('g', 4000); await shot('beat-racer'); await press('2');

await browser.close();
console.log('done:', (await fs.readdir(out)).join(' '));

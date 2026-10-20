// Takes the README and docs/ screenshots. Run with the dev server up:
//   node scripts/screenshots.mjs http://localhost:5199/
// Headless Chromium renders WebGL with SwiftShader, so give scenes a moment to build up trails.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { SOFTWARE_GL_ARGS } from './chromium-args.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = 'docs/screenshots';
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86, ...opts });
const settle = (ms) => page.waitForTimeout(ms);
const press = async (key, ms = 400) => { await page.keyboard.press(key); await settle(ms); };
// The controls auto-hide after 3 s without mouse movement: wake them before UI shots.
const wake = async () => { await page.mouse.move(700, 450); await page.mouse.move(720, 460); await settle(250); };

await page.goto(url);
await settle(2500);
await page.getByRole('button', { name: 'Play demo beat' }).click();
await press('1', 3500);                               // Beam Fan
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

// Parameter groups: Ring Run, with both of its groups unfolded.
await press('l', 600); await press('/', 200);
await page.keyboard.type('Ring Run'); await settle(300); await press('Enter', 3500);
await wake();
for (const g of ['Rings', 'Look']) await page.click(`.param-group[data-group="${g}"] .param-group-head`);
await settle(300); await wake();
await shot('params-groups');

// Gallery: every built-in scene, in key order, controls hidden. Scan Trace last, with a picture loaded
// (with nothing loaded its lines lie flat): a soft bright disc and a ring, made in the page.
await page.addStyleTag({ content: '#widgets, #toast { display: none !important; }' });
const gallery = [['1', 'beam-fan'], ['2', 'light-sheet'], ['3', 'ring-run'], ['4', 'wire-solid'], ['5', 'spectrum-rays'], ['6', 'contour-lines'], ['7', 'point-storm']];
for (const [key, name] of gallery) { await press(key, 3500); await shot(name); }
for (const [key, name] of [['9', 'lissajous'], ['0', 'scope-ring']]) { await press(key, 3500); await shot(name); }
for (const [scene, name] of [['Constellation', 'constellation'], ['Vortex', 'vortex']]) {   // past the number keys: from the library
  await press('l', 600); await press('/', 200);
  await page.fill('#lib-search', scene); await settle(300); await press('Enter', 3500);
  await shot(name);
}
const picture = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  const disc = g.createRadialGradient(320, 200, 10, 320, 200, 190);
  disc.addColorStop(0, '#fff'); disc.addColorStop(1, '#000');
  g.fillStyle = disc; g.fillRect(0, 0, 640, 400);
  g.strokeStyle = '#fff'; g.lineWidth = 18; g.beginPath(); g.arc(320, 200, 150, 0, Math.PI * 2); g.stroke();
  return c.toDataURL('image/png').split(',')[1];
});
await page.locator('#media-file').setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
await settle(3500); await shot('scan-trace');      // loading a picture plays Scan Trace
await page.addStyleTag({ content: '#widgets, #toast { display: revert !important; }' });

await press('1', 2500);
await wake();
await press('l', 100);
await page.fill('#lib-search', ''); await page.evaluate(() => document.activeElement?.blur());   // the Ring Run search above sticks
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
await press('1', 2500); await wake();                 // back to Beam Fan (the visual maker switched to the Node Scene)
await press('o', 600);
await page.selectOption('#st-add', '@live'); await settle(300);
await page.selectOption('#st-add', 'Wire Solid'); await settle(300);
await page.selectOption('#st-add', 'Point Storm'); await settle(1500);
await wake();
await hidden('#assistant-bubble', () => shot('studio'));
await press('Escape');
await wake(); await press('i', 800); await wake(); await shot('assistant'); await press('Escape');   // the bubble opens beside the panel

await browser.close();
console.log('done:', (await fs.readdir(out)).join(' '));

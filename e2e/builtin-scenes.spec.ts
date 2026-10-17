import { expect, seedScenes, test, type Page } from './fixtures';
import type { ListedScene, ProfilerApi } from '../src/engine/profiler';
import { EDGE_BAND, EDGE_CLEAR, EDGE_FADE, EFFECTS, strongest, type EffectStack } from '../src/engine/effects';
import type { FrameLook } from '../src/engine/look';
import { SCENES } from '../src/scenes';
import { defaultLook } from '../src/state/app-state';
import { STRONGEST_LOOK } from '../src/state/look-drift';

// The checklist every built-in scene is written to (#23, ADR 0001), checked for each one in the scene
// list: a scene joins this spec just by being listed in src/scenes/index.ts. It renders still frames
// through `window.__profiler` with inputs it chooses, so the music can be silent or kick on cue.
// The safety rules (black edges, strobe) are checked with the Look applied, as the audience sees it
// (ADR 0002): once at the default Look and once at the strongest one Randomize or Drift can reach.
// Each scene and Look is a test of its own: every still with a Look is a burst of frames at 1280×720,
// which under software WebGL takes a minute or so per pair, so they get a timeout each and share the
// workers. CI runs this spec in a job of its own (e2e-scenes), off the runner the timing specs use.
// Every effect in the catalogue (src/engine/effects.ts) joins the same way: alone, at its strongest, on
// every scene at the strongest Look (ADR 0003). The edges these rules measure are the border band the
// effects' edge fade leaves to the scene alone, defined once in the catalogue (EDGE_BAND).

interface Verdict { error: string | null; edgeBlack: number; kick: number; tick: number }
type Hook = { __profiler?: Pick<ProfilerApi, 'scenes' | 'still' | 'stillChange'> };

const SILENCE = { uBass: 0, uMid: 0, uHigh: 0, uLevel: 0, uBeat: 0 };
const CALM = { uBeat: 0 };                // the stand-in music, between kicks
const KICK = { uBeat: 1, uBass: 1 };      // the same music, on a kick
// Either side of a tick: the last frame of one and the first of the next, no kick. Whatever a scene
// does on the tick happens at every tempo, so it must pass the strobe rule on its own too.
const TICK_END = { uBeat: 0, uTick: 0.99, uTicks: 6 };
const TICK_START = { uBeat: 0, uTick: 0, uTicks: 7 };

const MIRROR_SCENE = 'Light Sheet';   // a scene that isn't symmetric left to right on its own
// Thin lines that hold still whatever the music does, for watching an effect's own movement.
const STILL_GRID = { name: 'Still grid', body: 'void main() { vec2 g = abs(fract(centered() * 8.) - .5); fragColor = vec4(vec3(smoothstep(.03, .0, min(g.x, g.y))), 1.); }' };

const LOOKS: { name: string; look: FrameLook }[] = [
  { name: 'default Look', look: defaultLook() },
  { name: 'strongest Look', look: STRONGEST_LOOK },
];

test.describe.configure({ mode: 'parallel' });   // the scene × Look tests share the workers

async function openProfiler(page: Page): Promise<ListedScene[]> {
  await page.goto('/?perf');
  // The app can take a while to start while the other workers render bursts.
  await expect.poll(() => page.evaluate(() => typeof (window as Hook).__profiler?.stillChange), { timeout: 30_000 }).toBe('function');
  return (await page.evaluate(() => (window as Hook).__profiler!.scenes())).filter((s) => s.builtin);
}

// Whether each one compiles is checked by its scene × Look tests below: a still renders it. Rendering
// all eight here too took over a minute under software WebGL.
test('every built-in scene is listed, has a tab and 3–8 parameters', async ({ page }) => {
  const builtins = await openProfiler(page);
  expect(builtins.map((s) => s.name), 'the app lists the scenes this spec checks').toEqual(SCENES.map((s) => s.name));

  await page.keyboard.press('l');
  const tabs = await page.locator('#lib-filters button').allTextContents();
  await page.keyboard.press('Escape');

  for (const scene of builtins) {
    expect.soft(tabs, `${scene.name}'s category has a tab`).toContain(scene.cat);
    expect.soft(scene.params, `${scene.name} has at least 3 parameters`).toBeGreaterThanOrEqual(3);
    expect.soft(scene.params, `${scene.name} has at most 8 parameters`).toBeLessThanOrEqual(8);
  }
});

// The safety rules for one scene with `look` (and `effects`): the share of the border band that is pure
// black in silence, and the share of the frame a kick and a tick make more than twice as bright.
async function verdict(page: Page, index: number, look: FrameLook, effects: EffectStack = []): Promise<Verdict> {
  return page.evaluate(async ({ index, look, effects, band, SILENCE, CALM, KICK, TICK_END, TICK_START }) => {
    const { still, stillChange } = (window as Hook).__profiler!;
    const lum = (d: Uint8ClampedArray, i: number) => (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
    const silent = await still(index, { inputs: SILENCE, silent: true, look, effects });
    if (!silent.image) return { error: silent.error, edgeBlack: 0, kick: 1, tick: 1 };
    // The frame's border band: the share of its pixels that are exactly black. Not all of it: lines and
    // their halos may run off an edge (Beam Fan's beams rise from the bottom one, Light Sheet's lines
    // cross both sides), so a quarter is left for them. The rest is background and must be pure
    // black: a glow fill, haze, a smeared afterglow or the display's grain would leave next to none
    // of it black.
    const { width: w, height: h, data } = silent.image;
    const reach = band * Math.min(w, h);
    let edge = 0, black = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.min(x, w - 1 - x, y, h - 1 - y) >= reach) continue;
      const i = (y * w + x) * 4;
      edge++;
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) black++;
    }
    // The strobe rule: the share of pixels a change from one frame to the next makes more than twice
    // as bright. A change smaller than a tenth of full brightness isn't a flash (WCAG's threshold),
    // so near-black halos don't count. The two frames are the end of one burst: `from`'s sound
    // settled, then the next frame with `to`'s.
    const doubled = async (from: Record<string, number>, to: Record<string, number>) => {
      const [a, b] = (await stillChange(index, { from, to, look, effects })).images!.map((image) => image.data);
      let n = 0;
      for (let i = 0; i < a!.length; i += 4) {
        const la = lum(a!, i), lb = lum(b!, i);
        if (lb > 2 * la && lb - la > 0.1) n++;
      }
      return n / (a!.length / 4);
    };
    return { error: null, edgeBlack: black / edge, kick: await doubled(CALM, KICK), tick: await doubled(TICK_END, TICK_START) };
  }, { index, look, effects, band: EDGE_BAND, SILENCE, CALM, KICK, TICK_END, TICK_START }) as Promise<Verdict>;
}

function judge(v: Verdict, what: string): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`${what}: a kick doubles ${pct(v.kick)} of the frame, a tick ${pct(v.tick)}, and ${pct(v.edgeBlack)} of the edge is black in silence`);
  expect(v.error, `${what} compiles`).toBeNull();
  expect.soft(v.edgeBlack, `${what}: the edges are pure black in silence`).toBeGreaterThanOrEqual(0.75);
  expect.soft(v.kick, `${what}: a kick doubles under 25% of the frame`).toBeLessThan(0.25);
  expect.soft(v.tick, `${what}: a tick doubles under 25% of the frame`).toBeLessThan(0.25);
}

for (const { name: sceneName } of SCENES) for (const { name, look } of LOOKS) {
  test(`${sceneName} at the ${name}: black edges in silence, and a strobe-safe kick and tick`, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const scene = (await openProfiler(page)).find((s) => s.name === sceneName)!;
    judge(await verdict(page, scene.index, look), `${sceneName} at the ${name}`);
  });
}

// Each effect alone at its strongest: it may reshape the picture, but never light the edges or make a
// kick or a tick strobe. Only at the strongest Look, where it reacts the most.
for (const effect of EFFECTS) for (const { name: sceneName } of SCENES) {
  test(`${sceneName} with ${effect.label} at its strongest, at the strongest Look: black edges in silence, and a strobe-safe kick and tick`, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const scene = (await openProfiler(page)).find((s) => s.name === sceneName)!;
    judge(await verdict(page, scene.index, STRONGEST_LOOK, strongest(effect.id)), `${sceneName} with ${effect.label} at the strongest Look`);
  });
}

// The rules above only mean something if the Look reaches the picture: trails leave an afterglow and
// fringing splits the colours in the frame still() returns.
test("a still frame shows the Look's trails and fringing", async ({ page }) => {
  await openProfiler(page);
  const plain: FrameLook = { ...STRONGEST_LOOK, trails: 0, aberration: 0, synesthesia: 0 };
  const changed = await page.evaluate(async ({ plain }) => {
    const p = (window as Hook).__profiler!;
    const index = p.scenes().find((s) => s.builtin)!.index;
    const frame = async (look: typeof plain) => (await p.still(index, { look })).image!.data;
    const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 6) n++;
      return n / (a.length / 4);
    };
    const base = await frame(plain);
    return {
      again: differs(base, await frame(plain)),
      trails: differs(base, await frame({ ...plain, trails: 0.9 })),
      fringing: differs(base, await frame({ ...plain, aberration: 0.02 })),
    };
  }, { plain });
  expect(changed.again, 'the same Look renders the same frame').toBe(0);
  expect(changed.trails, 'trails leave an afterglow').toBeGreaterThan(0.001);
  expect(changed.fringing, 'fringing splits the colours').toBeGreaterThan(0.001);
});

// The share of pixels where two frames differ by more than `tolerance` levels in some channel, counting
// only those further than `inner` (a share of the short side) from every edge, where effects run at full
// strength. Passed into the page as source.
const DIFFERS = `(a, b, w, h, inner, tolerance) => {
  const reach = inner * Math.min(w, h);
  let n = 0, all = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.min(x, w - 1 - x, y, h - 1 - y) < reach) continue;
    const i = (y * w + x) * 4;
    all++;
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > tolerance) n++;
  }
  return n / all;
}`;
type Differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, inner: number, tolerance: number) => number;
const INNER = EDGE_CLEAR + EDGE_FADE;

// Each effect does something: at its strongest the picture differs from the same still without it.
for (const effect of EFFECTS) {
  test(`${effect.label} at its strongest changes the picture`, async ({ page }) => {
    test.setTimeout(2 * 60_000);
    await openProfiler(page);
    const changed = await page.evaluate(async ({ effects, look, source, inner }) => {
      const p = (window as Hook).__profiler!;
      const differs = (0, eval)(source) as Differs;
      const index = p.scenes().find((s) => s.builtin)!.index;
      const plain = (await p.still(index, { look })).image!;
      const shaped = (await p.still(index, { look, effects })).image!;
      return differs(plain.data, shaped.data, plain.width, plain.height, inner, 2);
    }, { effects: strongest(effect.id), look: defaultLook(), source: DIFFERS, inner: INNER });
    expect(changed).toBeGreaterThan(0.001);
  });
}

// A Wave's ripple starts at the centre on a kick. Watched on a grid that ignores the music, so whatever
// a kick changes the Wave changed: near the centre it moves the lines, further out, where the ripple
// hasn't reached yet, next to nothing changes. It reads the kick the scene reads (uBeat), scaled by
// Reactivity: at Reactivity 0 a kick moves nothing.
test('a kick sends a Wave ripple out from the centre', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await seedScenes(page, [STILL_GRID]);
  await openProfiler(page);
  const moved = await page.evaluate(async ({ look, sceneName, effects, CALM, KICK }) => {
    const p = (window as Hook).__profiler!;
    const index = p.scenes().find((s) => s.name === sceneName)!.index;
    // The share of pixels inside a disc around the centre and outside a wider one that the kick changes
    // by more than a quarter of full brightness: a line moved, not its edge sliding a fraction of a
    // pixel as the bend drifts on by a frame.
    const kickChanges = async (look: FrameLook, effects: EffectStack) => {
      const [a, b] = (await p.stillChange(index, { from: CALM, to: KICK, look, effects })).images!;
      const { width: w, height: h } = a!;
      const disc = 0.2 * Math.min(w, h), beyond = 0.45 * Math.min(w, h);
      const n = { centre: 0, out: 0 }, all = { centre: 0, out: 0 };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - w / 2, y - h / 2);
        const where = r < disc ? 'centre' : r > beyond ? 'out' : null;
        if (!where) continue;
        const i = (y * w + x) * 4;
        all[where]++;
        if (Math.max(Math.abs(a!.data[i]! - b!.data[i]!), Math.abs(a!.data[i + 1]! - b!.data[i + 1]!), Math.abs(a!.data[i + 2]! - b!.data[i + 2]!)) > 64) n[where]++;
      }
      return { centre: n.centre / all.centre, out: n.out / all.out };
    };
    return {
      plain: await kickChanges(look, []),
      wave: await kickChanges(look, effects),
      still: await kickChanges({ ...look, reactivity: 0 }, effects),
    };
  }, { look: defaultLook(), sceneName: STILL_GRID.name, effects: [{ id: 'wave', on: true, settings: { amount: 1, wavelength: 0.4 } }] as EffectStack, CALM, KICK });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`a kick changes ${pct(moved.plain.centre)} of the centre without a Wave; with one ${pct(moved.wave.centre)} of the centre and ${pct(moved.wave.out)} further out; at Reactivity 0 ${pct(moved.still.centre)}`);
  expect(moved.plain.centre, 'the grid ignores the kick').toBeLessThan(0.001);
  expect(moved.wave.centre, 'a kick ripples the centre').toBeGreaterThan(0.05);
  expect(moved.wave.out, 'the ripple starts at the centre').toBeLessThan(moved.wave.centre / 2);
  expect(moved.still.centre, 'at Reactivity 0 the kick adds nothing to the bend').toBeLessThan(moved.wave.centre / 2);
});

// A left↔right Mirror makes the picture symmetric across its middle, away from the edges, where the
// scene's own picture shows through.
test('a still with a left↔right Mirror is symmetric across its axis', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await openProfiler(page);
  const asymmetry = await page.evaluate(async ({ look, sceneName, source, inner }) => {
    const p = (window as Hook).__profiler!;
    const differs = (0, eval)(source) as Differs;
    const index = p.scenes().find((s) => s.name === sceneName)!.index;
    const flipped = ({ data, width: w, height: h }: ImageData) => {
      const out = new Uint8ClampedArray(data.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
      return out;
    };
    // The display's grain differs by up to ±2 levels per pixel, which no mirror can match.
    const across = (image: ImageData) => differs(image.data, flipped(image), image.width, image.height, inner, 5);
    const plain = (await p.still(index, { look })).image!;
    const mirrored = (await p.still(index, { look, effects: [{ id: 'mirror', on: true, settings: { axis: 0 } }] })).image!;
    return { plain: across(plain), mirrored: across(mirrored) };
  }, { look: defaultLook(), sceneName: MIRROR_SCENE, source: DIFFERS, inner: INNER });
  expect(asymmetry.plain, `${MIRROR_SCENE} isn't symmetric on its own`).toBeGreaterThan(0.001);
  expect(asymmetry.mirrored, 'mirrored, it is').toBe(0);
});

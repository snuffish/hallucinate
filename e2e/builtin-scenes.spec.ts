import { expect, test } from './fixtures';

// The checklist every built-in scene is written to (#23, ADR 0001), checked for each one in the scene
// list: a scene joins this spec just by being listed in src/scenes/index.ts. It renders still frames
// through `window.__profiler.still()` (scene + display pass, no trails) with inputs it chooses, so the
// music can be silent or kick on cue.

interface Listed { index: number; name: string; cat: string; params: number; builtin: boolean }
interface Verdict { error: string | null; edgeBlack: number; doubled: number }
type Still = (index: number, sound: { inputs?: Record<string, number>; silent?: boolean }) => Promise<{ error: string | null; image: ImageData | null }>;
type Hook = { __profiler?: { scenes(): Listed[]; still: Still } };

const SILENCE = { uBass: 0, uMid: 0, uHigh: 0, uLevel: 0, uBeat: 0 };
const CALM = { uBeat: 0 };                // the stand-in music, between kicks
const KICK = { uBeat: 1, uBass: 1 };      // the same music, on a kick

test('every built-in scene compiles, has a tab, 3–8 parameters, black edges in silence, and a strobe-safe kick', async ({ page }) => {
  test.slow();
  await page.goto('/?perf');
  await expect.poll(() => page.evaluate(() => typeof (window as Hook).__profiler?.still)).toBe('function');
  const builtins = (await page.evaluate(() => (window as Hook).__profiler!.scenes())).filter((s) => s.builtin);

  await page.keyboard.press('l');
  const tabs = await page.locator('#lib-filters button').allTextContents();
  await page.keyboard.press('Escape');

  for (const scene of builtins) {
    const verdict = await page.evaluate(async ({ index, SILENCE, CALM, KICK }) => {
      const still = (window as Hook).__profiler!.still;
      const lum = (d: Uint8ClampedArray, i: number) => (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
      const silent = await still(index, { inputs: SILENCE, silent: true });
      if (!silent.image) return { error: silent.error, edgeBlack: 0, doubled: 1 };
      // The frame's border: the share of its pixels that are exactly black. Lines and their halos may
      // cross an edge, but most of it is background, and that must be pure black: a glow fill, haze
      // or the display's grain would leave next to none of it black.
      const { width: w, height: h, data } = silent.image;
      let edge = 0, black = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x > 0 && x < w - 1 && y > 0 && y < h - 1) continue;
        const i = (y * w + x) * 4;
        edge++;
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) black++;
      }
      // The strobe rule: the share of pixels a kick makes more than twice as bright. A change smaller
      // than a tenth of full brightness isn't a flash (WCAG's threshold), so near-black halos don't count.
      const calm = (await still(index, { inputs: CALM })).image!.data;
      const kick = (await still(index, { inputs: KICK })).image!.data;
      let doubled = 0;
      for (let i = 0; i < calm.length; i += 4) {
        const a = lum(calm, i), b = lum(kick, i);
        if (b > 2 * a && b - a > 0.1) doubled++;
      }
      return { error: null, edgeBlack: black / edge, doubled: doubled / (calm.length / 4) };
    }, { index: scene.index, SILENCE, CALM, KICK }) as Verdict;

    console.log(`${scene.name}: ${(verdict.doubled * 100).toFixed(1)}% of the frame doubles on a kick, ${(verdict.edgeBlack * 100).toFixed(1)}% of the edge is black in silence`);
    expect.soft(verdict.error, `${scene.name} compiles`).toBeNull();
    expect.soft(tabs, `${scene.name}'s category has a tab`).toContain(scene.cat);
    expect.soft(scene.params, `${scene.name} has at least 3 parameters`).toBeGreaterThanOrEqual(3);
    expect.soft(scene.params, `${scene.name} has at most 8 parameters`).toBeLessThanOrEqual(8);
    expect.soft(verdict.edgeBlack, `${scene.name}'s edges are pure black in silence`).toBeGreaterThanOrEqual(0.5);
    expect.soft(verdict.doubled, `${scene.name}'s kick doubles under 25% of the frame`).toBeLessThan(0.25);
  }
});

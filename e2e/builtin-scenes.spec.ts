import { expect, test } from './fixtures';
import type { ListedScene, ProfilerApi } from '../src/engine/profiler';

// The checklist every built-in scene is written to (#23, ADR 0001), checked for each one in the scene
// list: a scene joins this spec just by being listed in src/scenes/index.ts. It renders still frames
// through `window.__profiler.still()` (scene + display pass, no trails) with inputs it chooses, so the
// music can be silent or kick on cue.

interface Verdict { error: string | null; edgeBlack: number; kick: number; tick: number }
type Hook = { __profiler?: Pick<ProfilerApi, 'scenes' | 'still'> };

const SILENCE = { uBass: 0, uMid: 0, uHigh: 0, uLevel: 0, uBeat: 0 };
const CALM = { uBeat: 0 };                // the stand-in music, between kicks
const KICK = { uBeat: 1, uBass: 1 };      // the same music, on a kick
// Either side of a tick: the last frame of one and the first of the next, no kick. Whatever a scene
// does on the tick happens at every tempo, so it must pass the strobe rule on its own too.
const TICK_END = { uBeat: 0, uTick: 0.99, uTicks: 6 };
const TICK_START = { uBeat: 0, uTick: 0, uTicks: 7 };

test('every built-in scene compiles, has a tab, 3–8 parameters, black edges in silence, and a strobe-safe kick and tick', async ({ page }) => {
  test.slow();
  await page.goto('/?perf');
  await expect.poll(() => page.evaluate(() => typeof (window as Hook).__profiler?.still)).toBe('function');
  const builtins: ListedScene[] = (await page.evaluate(() => (window as Hook).__profiler!.scenes())).filter((s) => s.builtin);

  await page.keyboard.press('l');
  const tabs = await page.locator('#lib-filters button').allTextContents();
  await page.keyboard.press('Escape');

  for (const scene of builtins) {
    const verdict = await page.evaluate(async ({ index, SILENCE, CALM, KICK, TICK_END, TICK_START }) => {
      const still = (window as Hook).__profiler!.still;
      const lum = (d: Uint8ClampedArray, i: number) => (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
      const silent = await still(index, { inputs: SILENCE, silent: true });
      if (!silent.image) return { error: silent.error, edgeBlack: 0, kick: 1, tick: 1 };
      // The frame's border: the share of its pixels that are exactly black. Not all of it: lines and
      // their halos may run off an edge (Beam Fan's beams rise from the bottom one, Light Sheet's lines
      // cross both sides), so a quarter is left for them. The rest is background and must be pure
      // black: a glow fill, haze or the display's grain would leave next to none of it black.
      const { width: w, height: h, data } = silent.image;
      let edge = 0, black = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x > 0 && x < w - 1 && y > 0 && y < h - 1) continue;
        const i = (y * w + x) * 4;
        edge++;
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) black++;
      }
      // The strobe rule: the share of pixels a change from one frame to the next makes more than twice
      // as bright. A change smaller than a tenth of full brightness isn't a flash (WCAG's threshold),
      // so near-black halos don't count.
      const doubled = async (before: Record<string, number>, after: Record<string, number>) => {
        const a = (await still(index, { inputs: before })).image!.data;
        const b = (await still(index, { inputs: after })).image!.data;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          const la = lum(a, i), lb = lum(b, i);
          if (lb > 2 * la && lb - la > 0.1) n++;
        }
        return n / (a.length / 4);
      };
      return { error: null, edgeBlack: black / edge, kick: await doubled(CALM, KICK), tick: await doubled(TICK_END, TICK_START) };
    }, { index: scene.index, SILENCE, CALM, KICK, TICK_END, TICK_START }) as Verdict;

    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(`${scene.name}: a kick doubles ${pct(verdict.kick)} of the frame, a tick ${pct(verdict.tick)}; ${pct(verdict.edgeBlack)} of the edge is black in silence`);
    expect.soft(verdict.error, `${scene.name} compiles`).toBeNull();
    expect.soft(tabs, `${scene.name}'s category has a tab`).toContain(scene.cat);
    expect.soft(scene.params, `${scene.name} has at least 3 parameters`).toBeGreaterThanOrEqual(3);
    expect.soft(scene.params, `${scene.name} has at most 8 parameters`).toBeLessThanOrEqual(8);
    expect.soft(verdict.edgeBlack, `${scene.name}'s edges are pure black in silence`).toBeGreaterThanOrEqual(0.75);
    expect.soft(verdict.kick, `${scene.name}'s kick doubles under 25% of the frame`).toBeLessThan(0.25);
    expect.soft(verdict.tick, `${scene.name}'s tick doubles under 25% of the frame`).toBeLessThan(0.25);
  }
});

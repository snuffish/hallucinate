import { expect, test } from './fixtures';
import type { ListedScene, ProfilerApi } from '../src/engine/profiler';
import type { FrameLook } from '../src/engine/look';
import { defaultLook } from '../src/state/app-state';
import { STRONGEST_LOOK } from '../src/state/look-drift';

// The checklist every built-in scene is written to (#23, ADR 0001), checked for each one in the scene
// list: a scene joins this spec just by being listed in src/scenes/index.ts. It renders still frames
// through `window.__profiler.still()` with inputs it chooses, so the music can be silent or kick on cue.
// The safety rules (black edges, strobe) are checked with the Look applied, as the audience sees it
// (ADR 0002): once at the default Look and once at the strongest one Randomize or Drift can reach.

interface Verdict { error: string | null; edgeBlack: number; kick: number; tick: number }
type Hook = { __profiler?: Pick<ProfilerApi, 'scenes' | 'still'> };

const SILENCE = { uBass: 0, uMid: 0, uHigh: 0, uLevel: 0, uBeat: 0 };
const CALM = { uBeat: 0 };                // the stand-in music, between kicks
const KICK = { uBeat: 1, uBass: 1 };      // the same music, on a kick
// Either side of a tick: the last frame of one and the first of the next, no kick. Whatever a scene
// does on the tick happens at every tempo, so it must pass the strobe rule on its own too.
const TICK_END = { uBeat: 0, uTick: 0.99, uTicks: 6 };
const TICK_START = { uBeat: 0, uTick: 0, uTicks: 7 };

const LOOKS: { name: string; look: FrameLook }[] = [
  { name: 'default Look', look: defaultLook() },
  { name: 'strongest Look', look: STRONGEST_LOOK },
];

test('every built-in scene compiles, has a tab, 3–8 parameters, black edges in silence, and a strobe-safe kick and tick at the default and the strongest Look', async ({ page }) => {
  // Every still with a Look is a burst of frames at 1280×720; under software WebGL that takes minutes.
  test.setTimeout(10 * 60_000);
  await page.goto('/?perf');
  await expect.poll(() => page.evaluate(() => typeof (window as Hook).__profiler?.still)).toBe('function');
  const builtins: ListedScene[] = (await page.evaluate(() => (window as Hook).__profiler!.scenes())).filter((s) => s.builtin);

  await page.keyboard.press('l');
  const tabs = await page.locator('#lib-filters button').allTextContents();
  await page.keyboard.press('Escape');

  for (const scene of builtins) {
    expect.soft(tabs, `${scene.name}'s category has a tab`).toContain(scene.cat);
    expect.soft(scene.params, `${scene.name} has at least 3 parameters`).toBeGreaterThanOrEqual(3);
    expect.soft(scene.params, `${scene.name} has at most 8 parameters`).toBeLessThanOrEqual(8);
    const runs: string[] = [];
    for (const { name, look } of LOOKS) {
      const verdict = await page.evaluate(async ({ index, look, SILENCE, CALM, KICK, TICK_END, TICK_START }) => {
        const still = (window as Hook).__profiler!.still;
        const lum = (d: Uint8ClampedArray, i: number) => (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
        const silent = await still(index, { inputs: SILENCE, silent: true, look });
        if (!silent.image) return { error: silent.error, edgeBlack: 0, kick: 1, tick: 1 };
        // The frame's border: the share of its pixels that are exactly black. Not all of it: lines and
        // their halos may run off an edge (Beam Fan's beams rise from the bottom one, Light Sheet's lines
        // cross both sides), so a quarter is left for them. The rest is background and must be pure
        // black: a glow fill, haze, a smeared afterglow or the display's grain would leave next to none
        // of it black.
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
          const a = (await still(index, { inputs: before, look })).image!.data;
          const b = (await still(index, { inputs: after, look })).image!.data;
          let n = 0;
          for (let i = 0; i < a.length; i += 4) {
            const la = lum(a, i), lb = lum(b, i);
            if (lb > 2 * la && lb - la > 0.1) n++;
          }
          return n / (a.length / 4);
        };
        return { error: null, edgeBlack: black / edge, kick: await doubled(CALM, KICK), tick: await doubled(TICK_END, TICK_START) };
      }, { index: scene.index, look, SILENCE, CALM, KICK, TICK_END, TICK_START }) as Verdict;

      const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
      runs.push(`at the ${name} a kick doubles ${pct(verdict.kick)} of the frame, a tick ${pct(verdict.tick)}, and ${pct(verdict.edgeBlack)} of the edge is black in silence`);
      expect.soft(verdict.error, `${scene.name} compiles`).toBeNull();
      expect.soft(verdict.edgeBlack, `${scene.name}'s edges are pure black in silence at the ${name}`).toBeGreaterThanOrEqual(0.75);
      expect.soft(verdict.kick, `${scene.name}'s kick doubles under 25% of the frame at the ${name}`).toBeLessThan(0.25);
      expect.soft(verdict.tick, `${scene.name}'s tick doubles under 25% of the frame at the ${name}`).toBeLessThan(0.25);
    }
    console.log(`${scene.name}: ${runs.join('; ')}`);
  }
});

// The rules above only mean something if the Look reaches the picture: trails leave an afterglow and
// fringing splits the colours in the frame still() returns.
test("a still frame shows the Look's trails and fringing", async ({ page }) => {
  await page.goto('/?perf');
  await expect.poll(() => page.evaluate(() => typeof (window as Hook).__profiler?.still)).toBe('function');
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

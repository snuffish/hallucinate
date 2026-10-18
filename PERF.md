# Performance notes

What the React + TypeScript port changed in the hot paths, and what `perf/measure.mjs` measured before and
after. Numbers come from headless Chromium with SwiftShader (software WebGL) on the same machine, 2026-10-13,
so GPU-bound figures are not representative; main-thread figures (long tasks, layouts, storage writes, frame
cadence) are what the probe is for.

```sh
npm run dev -- --port 5199 &
node perf/measure.mjs http://localhost:5199/ perf/results/<name>.json
```

## Finding the bottleneck on your machine

Press **Shift+P** (or open the app with `?perf`) for the performance monitor. It shows the frame rate against the
display's refresh budget, the main thread's time per stage of the frame, and one sentence on what is holding the
frame rate back. The numbers cover the last 3 s, so they follow a scene change within a few seconds. The refresh budget
is the fastest display rate the frames have reached since the monitor was switched on (60 Hz or faster assumed), so on
a 120 Hz screen it reads 60 Hz until the app has run faster than that once.

| Verdict | Means | Do |
| --- | --- | --- |
| *Keeping up with the display* | Frames arrive at the refresh rate; the share shown is how much of the budget the main thread uses | Nothing |
| *Smooth on average, but 1 frame in 20…* | The typical frame is on time, but regular hitches aren't (frame p95 over 2.5× the budget) | Record a DevTools Performance trace: GC, thumbnails, timers and events run outside the frame loop |
| *Main thread: …* | The stages fill the frame; the heaviest is named | Profile that stage (`?perf=trace`, below) |
| *Probably the GPU…* | Frames are slow but the main thread is nearly idle | Press **Test GPU** |
| *GPU fill rate: a → b fps* | Half the pixels ran clearly faster (×1.3 or more) | Lower *Resolution*, or simplify the scene's shader |
| *Not the main window's pixels* | Half the pixels changed nothing | Projector windows, the studio's Preview monitor, or a DevTools recording (GC, compositor, other tabs) |

The main-thread stages are: audio analysis, clock and look, draw calls (WebGL submission only, not GPU time), the
projector link, the studio (incl. its Preview monitor), publishing to the UI store, and React's render. React renders
in a microtask after the frame loop returns, so it is timed as a stage of its own, together with any other microtask
the frame queued. Pages that aren't cross-origin isolated get
`performance.now()` in 0.1 ms steps, so stages are shown as a mean (and p95), never a median.

**Test GPU** runs the current scene for about 1.5 s at its resolution and about 1.5 s at half of it, then puts it back.
That's visible: the picture softens and the trails restart. It stops if the scene or the resolution changes meanwhile,
so turn auto-switch off (A) first. It replaces GPU timer queries, which can't be trusted on Apple silicon:
under ANGLE → Metal (Chromium 156, M2), `EXT_disjoint_timer_query_webgl2` gives every pass of a frame the same duration,
and a whole-frame query reads about twice the real frame interval:

| Scene loop iterations (1600×900) | fps | Timer query per pass: scene / copy / copy | Whole frame | Real interval |
| --- | --- | --- | --- | --- |
| 20 | 58 | 4.8 / 4.9 / 5.0 ms | 6.4 ms | 16.7 ms |
| 1000 | 40 | 46.8 / 47.0 / 47.3 ms | 53 ms | ~26 ms |
| 3000 | 17 | 135.4 / 135.4 / 135.6 ms | 134 ms | ~67 ms |

For exact GPU timing per draw, use the GPU track of a DevTools Performance recording. `?perf=trace` adds the
frame's stages to the same recording as spans on a "Hallucinate" track, so the two line up.

```sh
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json --gpu
```

`--gpu` runs the probe in a visible window on the real GPU (headless Chromium falls back to SwiftShader), stores the
monitor's report with each scenario, and runs Test GPU on every scene on a 4K canvas at full resolution, the load
of a 4K projector, ranked slowest first. At laptop sizes most scenes sit at the refresh rate, which can't get
faster, so the ranking would be a tie. On an M2 MacBook (2026-10-16), the main thread used about 1 ms per frame
everywhere, and these scenes fell below 60 fps at 3840×2160. This ranking predates the laser-show set: these were
the old built-in scenes, all since replaced ([ADR 0001](docs/adr/0001-replace-all-built-in-scenes.md)), and the
eight new scenes have not been ranked yet:

| Scene | fps | at half resolution | gain |
| --- | --- | --- | --- |
| Spirograph | 6.7 | 23.5 | ×3.5 |
| Lissajous Knot | 9.6 | 32.6 | ×3.4 |
| Tesseract | 10.5 | 35.3 | ×3.4 |
| Neon Jacks | 15.5 | 49.3 | ×3.2 |
| Liquid Blobs | 24.8 | 60 | ×2.4 |
| Star Nest | 29.7 | 60 | ×2.0 |
| Gyroid Cave | 32.6 | 60 | ×1.8 |
| Menger Halls | 34.3 | 60 | ×1.8 |
| Aurora Veil | 40.2 | 60 | ×1.5 |
| Oscilloscope | 41.3 | 60 | ×1.5 |
| Liquid Plasma | 56.7 | 60 | ×1.1 |

A gain close to ×4 (a quarter of the pixels) means the scene's cost is almost all per-pixel shader work. The other 31
scenes held 60 fps.

## What effects cost

An effect runs on every output that draws its show scene: the main screen, the studio's Preview and every projector.
`__profiler.effectsCost(stack, { size? })` (with `?perf` or Shift+P) times it: the scene on screen through the whole
pipeline at the size the screen renders at (`size`, default the canvas, × the Resolution setting), with no effects and
with the stack, in turns, waiting for the GPU each time (a one-pixel read). It reports the median milliseconds per
frame of each and the difference. `perf/measure.mjs` reports it for Glow and for all four effects stacked, each at its
defaults and at its strongest, on the canvas and at 1920×1080; `e2e/perf.spec.ts` checks it reports for a Glow and for
all four stacked (a 480×270 picture at the default Resolution, 4 frames × 3 rounds, to stay within seconds
under software WebGL).

**Glow** (2026-10-17, default Resolution 1). Its blur is two passes at half size (a Gaussian across, then down, a tap
every 2 pixels of a 720-high picture, out to 2.5 sigma), then its picture step at full size, so it adds three passes.
On an M2 (ANGLE → Metal, Chromium headless with `channel: 'chromium'`, which uses the GPU), the same on every built-in
scene within 0.05 ms:

| Render size | No effects (cheapest – heaviest scene) | Glow at its defaults (0.8, radius 10) | Glow at its strongest (1.5, radius 24) |
| --- | --- | --- | --- |
| 1280×720 | 0.6 – 2.8 ms | +0.6 ms | +0.8 ms |
| 1920×1080 | 1.2 – 6.1 ms | +1.2 ms | +1.7 ms |
| 3840×2160 | 4.5 – 23.9 ms | +4.2 ms | +6.3 ms |

The cost scales with the pixels and barely with the scene. At 4K the strongest Glow alone takes over a third of a
60 Hz frame, so a 4K projector with a Glow wants Resolution below 1 (at 0.5 it renders 1920×1080: +1.7 ms). Under
SwiftShader (headless Chromium's software WebGL, as `e2e/perf.spec.ts` and `node perf/measure.mjs` without `--gpu`
run) the same Glow at 1280×720 adds 33 ms (defaults) and 61 ms (strongest) to 94 ms on Point Storm: software
rendering pays for every blur tap on the CPU, so those numbers say nothing about a GPU.

**All four stacked** (2026-10-17, default Resolution 1, Mirror → Kaleidoscope → Glow → Wave). Mirror, Kaleidoscope
and Wave are one full-size pass each, so the stack is six passes. Same M2 and browser as above, on Beam Fan, each
number from a fresh browser after a 20 s rest:

| Render size | No effects | Glow at its strongest | All four at their defaults | All four at their strongest |
| --- | --- | --- | --- | --- |
| 1280×720 | 0.7 ms | +0.9 ms | +1.3 ms | +1.6 ms |
| 1920×1080 | 1.4 ms | +1.8 ms | +2.8 ms | +3.4 ms |

So the three single-pass effects together cost less than the Glow alone (about +0.5 ms at 720p, +1.1 ms at 1080p),
and a show scene with everything on stays well inside a 60 Hz frame up to 1080p. 4K didn't measure steadily: the M2
throttles under a sustained GPU load, and in the same run the Glow alone read +13 ms (the table above has +6.3 ms),
all four at their defaults +15 ms and at their strongest +42 ms while "no effects" crept from 5.7 to 7.1 ms. A run
of `effectsCost` calls on one page without rests drifted the same way at every size, "no effects" included,
several-fold within minutes, so compare numbers from a rested run only. Under SwiftShader the four at their strongest add
about 80 ms a frame to 31 ms at 640×360.

## What hearing the kicks costs

The kicks are heard against the pulse of the low end's rises over the last 6 s (600 cells of 10 ms), read four
times a second: an autocorrelation at every lag from 0.3 s out to three pulses (about 450 lags over up to 600 cells,
~170 000 multiply-adds), then a comb over every phase of the pulse. Replaying three reference clips (230 s at
60 fps, `Listener.hear` on Node 22, Ryzen 7 3700X, 2026-10-18), a reading took 0.19 ms (median; p95 0.34 ms,
the first few up to 6 ms before the JIT warms up), about 0.9 ms a second, a quarter of all the Listener's time;
a frame's `hear` took 0.05 ms (median; p95 0.24 ms, a frame with a reading). Well inside a frame on a desktop;
on a slow machine the readings are the spikes to look at first (fewer lags, or a coarser cell, would cut them).

## Before → after

| Scenario | Metric | Before (vanilla JS) | After (React port) |
| --- | --- | --- | --- |
| First scene, demo beat, 8 s | frame time p50 / p95 | 33 ms / 100 ms | 33 ms / 100 ms |
| | layouts / style recalcs | 96 / 292 | 87 / 175 |
| Star Nest (raymarch, an old scene), 8 s | frame time p50 / p95 | 83 ms / 217 ms | 83 ms / 183 ms |
| Library open (40 previews), 6 s | long tasks (count / longest) | 19 / 236 ms | 2 / 225 ms |
| | frame time p50 | 50 ms | 17 ms |
| | layouts | 20 | 1 |
| 200 parameter-slider inputs | `localStorage` writes | 200 | 0 (coalesced, flushed later) |
| 300 look-slider inputs | `localStorage` writes | 0 | 0 |
| One editor keystroke (recompile) | long tasks (count / longest) | 1 / 214 ms | 0 / 0 ms |

Raw results: `perf/results/baseline.json` (old app) and `perf/results/after-port.json`.

## What changed

- **Shader compilation off the frame** (`src/engine/renderer.ts`, `compileAsync`): programs link with
  `KHR_parallel_shader_compile` and are polled for completion each frame; the previous program keeps running
  until the new one is ready. Typing in the editor no longer blocks (214 ms → 0).
- **Resize without layout reads**: the canvas size comes from a `ResizeObserver`; `render()` never reads
  `clientWidth`. Per-frame layouts on the first scene dropped from 96 to 87 over 8 s; what remains is the panel's
  tone marker (positioned with `left`) and React's own commits.
- **Video media upload once per decoded frame**: immutable `texStorage2D` plus `texSubImage2D`, driven by
  `requestVideoFrameCallback` where available. Not measured by the probe (it has no video source); it removes
  a full-texture reallocation per frame on video scenes.
- **Async snapshot readback** (`snapshotAsync`): a pixel buffer and a fence instead of a blocking `readPixels`,
  and JPEG encoding in a Web Worker (`src/engine/jpeg.worker.ts`). Opening the library went from nineteen
  long tasks to two, and the show keeps running at the previous frame rate (p50 50 ms → 17 ms).
- **Coalesced persistence** (`src/state/persistence.ts`, `debouncedWriter`): parameter and graph writes are
  batched and flushed on `visibilitychange` / `pagehide`.
- **No per-frame allocation in the pipeline**: the frame state, uniform sets and the media uniforms are reused
  objects. The Listener too: its kick hearing (`src/engine/kick-hearer.ts`) keeps the kick's bins of the last
  frames, the rises, the autocorrelation and its scratch in buffers made once (again only if the analyser's size
  changes), and the last kick and the frame being judged in reused records; the tempo sorts the kick gaps in a
  reused array.
- **Studio monitors reuse their state** (2026-10-15): the Preview monitor and the pinned Live slot refill reused
  frame states through the same `applyLook` as the main output, and cache each show scene's uniforms, so they no
  longer allocate every frame. Slider drags on a show scene are coalesced like the other parameter writes.
- **Meters on the compositor**: `transform: scaleX()` instead of `width`.
- **UI updates at UI rate**: the frame loop publishes meters, BPM and mood every second frame; everything
  else in the React tree only re-renders when its selected slice changes.

## Known remaining

- Under SwiftShader a single frame gap of up to ~2.2 s can still appear while the library's previews are made
  (the software rasteriser and the encoding worker compete for CPU). No long task accompanies it; on a GPU the
  previews render in a few milliseconds each. Measure on real hardware before chasing it.
- The studio renders a second full pipeline for the Preview monitor every frame (as before).
- The projector protocol still posts the whole frame state over the `BroadcastChannel` every frame (as before).
- All the built-in GLSL sources ship in the main bundle (as before).
- At 4K, the heaviest of the old scenes were far below 60 fps on an M2 (table above): their shaders were the cost,
  not the pipeline. Rank the laser-show set with `--gpu` before chasing any one of its scenes.

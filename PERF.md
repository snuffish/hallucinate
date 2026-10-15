# Performance notes

What the React + TypeScript port changed in the hot paths, and what `perf/measure.mjs` measured before and
after. Numbers come from headless Chromium with SwiftShader (software WebGL) on the same machine, 2026-10-13,
so GPU-bound figures are not representative; main-thread figures (long tasks, layouts, storage writes, frame
cadence) are what the probe is for.

```sh
npm run dev -- --port 5199 &
node perf/measure.mjs http://localhost:5199/ perf/results/<name>.json
```

## Before → after

| Scenario | Metric | Before (vanilla JS) | After (React port) |
| --- | --- | --- | --- |
| First scene, demo beat, 8 s | frame time p50 / p95 | 33 ms / 100 ms | 33 ms / 100 ms |
| | layouts / style recalcs | 96 / 292 | 87 / 175 |
| Star Nest (raymarch), 8 s | frame time p50 / p95 | 83 ms / 217 ms | 83 ms / 183 ms |
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
  objects; the game's uniform arrays are reused too.
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
- All forty GLSL sources ship in the main bundle (as before).

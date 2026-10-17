// Frame profiler: where each frame's main-thread time goes, and a fill-rate test for the GPU.
//
// The CPU side laps `performance.now()` between the stages of the frame loop (plus React's render,
// which runs in a microtask after the loop returns). The GPU side is not timed with
// EXT_disjoint_timer_query: under ANGLE/Metal (Apple silicon) every pass of a frame reads the same
// duration, so per-pass numbers would point at the wrong shader (PERF.md). Instead `FillTest` renders
// at half scale for a moment and compares frame rates. Plain TypeScript, no DOM: unit-tested.

import type { FrameLook } from './look';
import type { SnapshotUniforms } from './scene-inputs';

export const STAGES = ['audio', 'logic', 'render', 'output', 'studio', 'ui', 'react'] as const;
export type StageName = (typeof STAGES)[number];
// Laps take an index, so the frame loop never looks a stage up by name.
export const Stage = { audio: 0, logic: 1, render: 2, output: 3, studio: 4, ui: 5, react: 6 } as const satisfies Record<StageName, number>;

export const STAGE_LABELS: Record<StageName, string> = {
  audio: 'Audio analysis',
  logic: 'Clock & look',
  render: 'Draw calls',
  output: 'Projector link',
  studio: 'Studio & Preview',
  ui: 'Publish to UI',
  react: 'React & microtasks',
};

const CAPACITY = 512;               // samples kept per series: 3 s even at 165 Hz
const WINDOW_MS = 3000;             // reports cover the frames of the last 3 s (at least MIN_FRAMES), however slow they are
const MAX_INTERVAL_MS = 1000;       // longer gaps are a background tab or a debugger, not a frame
const MIN_FRAMES = 10;              // before this, the report says it's still warming up
// Display refresh periods, longest first. The budget is the longest one the fastest frames fit in,
// so a show stuck at 30 fps on a 60 Hz screen still reads as short. Assumes a display of 60 Hz or
// faster, and can only see a refresh rate the app has reached at least once since switching on.
const REFRESH_MS = [1000 / 60, 1000 / 75, 1000 / 90, 1000 / 100, 1000 / 120, 1000 / 144, 1000 / 165, 1000 / 240];
const SHORT = 1.2;                  // a frame interval above budget × this is a missed refresh
const HITCH = 2.5;                  // a p95 above budget × this: regular frames are fine, 1 in 20 isn't
const CPU_BOUND = 0.6;              // main-thread share of the interval that makes it the bottleneck
const FILL_GAIN = 1.3;              // half the pixels speeding up by this much means GPU fill rate

// A fixed-size ring of samples. Pushing never allocates; statistics are computed on demand (at UI rate),
// over the newest `n` samples (default: all kept).
export class Samples {
  private readonly data: Float32Array;
  private readonly scratch: Float32Array;
  private count = 0;
  private next = 0;

  constructor(readonly capacity = CAPACITY) {
    this.data = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  get size(): number { return this.count; }

  push(v: number): void {
    this.data[this.next] = v;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  // The k-th newest sample (0 = the last one pushed).
  private recent(k: number): number {
    return this.data[(this.next - 1 - k + this.capacity) % this.capacity]!;
  }

  // How many of the newest samples add up to `ms` (for frame intervals: the frames of the last `ms`).
  newestSpanning(ms: number): number {
    let sum = 0;
    let n = 0;
    while (n < this.count && sum < ms) sum += this.recent(n++);
    return n;
  }

  mean(n = this.count): number {
    n = Math.min(n, this.count);
    if (!n) return 0;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.recent(k);
    return sum / n;
  }

  percentile(q: number, n = this.count): number {
    n = Math.min(n, this.count);
    if (!n) return 0;
    const sorted = this.scratch.subarray(0, n);
    for (let k = 0; k < n; k++) sorted[k] = this.recent(k);
    sorted.sort();
    return sorted[Math.min(n - 1, Math.floor(q * n))]!;
  }

  clear(): void { this.count = 0; this.next = 0; }
}

export interface FillResult {
  baseFps: number;
  reducedFps: number;
  gain: number;          // reducedFps / baseFps
  scene: number;         // what was on screen, and at which resolution: a result only explains that
  scale: number;
}

interface FillOptions { warmup: number; measureMs: number; minFrames: number; factor: number }
const FILL_DEFAULTS: FillOptions = { warmup: 10, measureMs: 1500, minFrames: 10, factor: 0.5 };

// Measures the frame rate at the current scale, then at half of it, then restores. Driven by the
// frame intervals (no timers), skipping the frames right after each switch (new targets, compiles).
// Restores to `scale()` as it is at the end, so a slider moved meanwhile is respected.
export class FillTest {
  private phase: 'base' | 'reduced' | 'done' = 'base';
  private frames = 0;
  private measured = 0;
  private sum = 0;
  private baseFps = 0;
  private readonly opts: FillOptions;

  constructor(
    private readonly setScale: (scale: number) => void,
    private readonly scale: () => number,
    private readonly scene: number,
    private readonly done: (result: FillResult | null) => void,
    opts: Partial<FillOptions> = {},
  ) {
    this.opts = { ...FILL_DEFAULTS, ...opts };
  }

  get running(): boolean { return this.phase !== 'done'; }

  frame(interval: number): void {
    if (this.phase === 'done') return;
    if (++this.frames <= this.opts.warmup) return;
    this.sum += interval;
    this.measured++;
    if (this.sum < this.opts.measureMs || this.measured < this.opts.minFrames) return;
    const fps = (1000 * this.measured) / this.sum;
    if (this.phase === 'base') {
      this.baseFps = fps;
      this.phase = 'reduced';
      this.frames = this.measured = this.sum = 0;
      this.setScale(this.scale() * this.opts.factor);
      return;
    }
    const scale = this.scale();
    this.finish();
    this.done({ baseFps: this.baseFps, reducedFps: fps, gain: fps / this.baseFps, scene: this.scene, scale });
  }

  // Stop early (profiler off, slider moved, app closing): the screen goes back to full resolution.
  cancel(): void {
    if (this.phase === 'done') return;
    this.finish();
    this.done(null);
  }

  private finish(): void {
    if (this.phase === 'reduced') this.setScale(this.scale());
    this.phase = 'done';
  }
}

export type VerdictKind = 'warming-up' | 'smooth' | 'stutter' | 'cpu' | 'gpu-suspected' | 'gpu' | 'elsewhere';
export interface Verdict { kind: VerdictKind; text: string }
export interface StageStat { stage: StageName; mean: number; p95: number }

export interface DiagnoseInput {
  frames: number;
  frameP50: number;
  frameP95: number;
  budget: number;
  cpuMean: number;
  cpu: readonly StageStat[];          // heaviest first
  fill: FillResult | null;            // only a result for the scene and resolution on screen now
  projectors: number;
  preview: boolean;
}

const ms = (v: number) => `${v.toFixed(1)} ms`;
const fpsOf = (frameMs: number) => (frameMs > 0 ? 1000 / frameMs : 0);

// Turns the numbers into one sentence. Compares with the refresh budget, not the measured interval:
// the interval is capped at the display's refresh, so it can't show spare time. Never says "GPU"
// without a fill test behind it — a slow frame with an idle main thread can also be projectors, GC,
// the compositor or another tab.
export function diagnose(d: DiagnoseInput): Verdict {
  if (d.frames < MIN_FRAMES) return { kind: 'warming-up', text: 'Collecting frames…' };
  const share = Math.round((100 * d.cpuMean) / d.budget);
  // Hitches don't move the median: GC, long tasks outside the frame loop (thumbnails, timers, events).
  if (d.frameP50 <= d.budget * SHORT && d.frameP95 > d.budget * HITCH) {
    return { kind: 'stutter', text: `Smooth on average, but 1 frame in 20 takes ${ms(d.frameP95)} or more — hitches outside the frame loop (GC, thumbnails, timers). Record a DevTools Performance trace.` };
  }
  if (d.frameP50 <= d.budget * SHORT) {
    return { kind: 'smooth', text: `Keeping up with the display (${Math.round(fpsOf(d.budget))} Hz). The main thread uses ${share}% of the ${ms(d.budget)} budget.` };
  }
  const top = d.cpu[0];
  if (d.cpuMean >= d.frameP50 * CPU_BOUND && top) {
    return { kind: 'cpu', text: `Main thread: ${STAGE_LABELS[top.stage]} takes ${ms(top.mean)} of ${ms(d.cpuMean)} per frame.` };
  }
  if (!d.fill) {
    return { kind: 'gpu-suspected', text: `The main thread only uses ${ms(d.cpuMean)} of each ${ms(d.frameP50)} frame — probably the GPU, or work outside the frame loop. Run Test GPU.` };
  }
  const change = `${Math.round(d.fill.baseFps)} → ${Math.round(d.fill.reducedFps)} fps at half resolution`;
  if (d.fill.gain >= FILL_GAIN) return { kind: 'gpu', text: `GPU fill rate: ${change}. The scene and feedback passes are the cost — lower Resolution or simplify the scene.` };
  const others = [
    d.projectors > 0 && `${d.projectors} projector window${d.projectors === 1 ? '' : 's'} render${d.projectors === 1 ? 's' : ''} too`,
    d.preview && "the studio's Preview monitor renders too",
  ].filter(Boolean);
  return {
    kind: 'elsewhere',
    text: `Not the main window's pixels (${change}). ${others.length ? `Look at the other renderers: ${others.join(', ')}.` : 'Record a DevTools Performance trace (GC, compositor, other tabs).'}`,
  };
}

export interface PerfReport {
  fps: number;
  frameP50: number;
  frameP95: number;
  budget: number;
  cpu: StageStat[];        // heaviest first
  cpuMean: number;
  cpuP95: number;
  size: [number, number];  // canvas pixels
  scale: number;           // the scene and feedback passes render at size × scale
  projectors: number;
  preview: boolean;
  fill: FillResult | null; // the last test, whatever it was run on
  fillCurrent: boolean;    // …and whether that was this scene at this resolution
  fillRunning: boolean;
  trace: boolean;
  verdict: Verdict;
}

export interface ReportContext {
  size: readonly [number, number];
  scale: number;
  resolution: number;      // the look's resolution: a fill result only counts at the one it ran at
  scene: number;
  projectors: number;
  preview: boolean;
}

// Where `performance.measure` spans go in trace mode. Injected so tests can watch it.
export interface Timeline {
  measure(name: string, start: number, end: number): void;
  clear(): void;
}

const DEVTOOLS_TRACK = { devtools: { dataType: 'track-entry', track: 'Hallucinate', color: 'tertiary' } };
const browserTimeline: Timeline = {
  measure: (name, start, end) => { performance.measure(name, { start, end, detail: DEVTOOLS_TRACK }); },
  clear: () => performance.clearMeasures(),
};

export class FrameProfiler {
  on = false;
  trace = false;
  readonly intervals = new Samples();
  readonly stages = STAGES.map(() => new Samples());
  readonly cpuTotal = new Samples();
  fill: FillResult | null = null;

  private lastFrame = -1;
  private lapAt = 0;
  private frameCpu = 0;
  private budget = Infinity;          // shortest refresh period seen since switching on
  private fillTest: FillTest | null = null;
  // Queued after the loop: React renders store updates in a microtask queued during ui.set, which
  // runs first, so this lap covers React's render and commit (react-dom: scheduleImmediateRootScheduleTask).
  private readonly reactLap = (): void => {
    if (!this.on) return;
    this.lap(Stage.react);
    this.cpuTotal.push(this.frameCpu);
  };

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly timeline: Timeline = browserTimeline,
  ) {}

  setOn(on: boolean, trace = false): void {
    if (!on) this.cancelFill();
    if (on && !this.on) this.reset();
    this.on = on;
    this.trace = on && trace;
    if (!this.trace) this.timeline.clear();
  }

  reset(): void {
    this.intervals.clear();
    for (const s of this.stages) s.clear();
    this.cpuTotal.clear();
    this.lastFrame = -1;
    this.budget = Infinity;
  }

  // `t` is the requestAnimationFrame timestamp: frame-aligned, so intervals are clean.
  frameStart(t: number): void {
    if (!this.on) return;
    if (this.lastFrame >= 0) {
      const interval = t - this.lastFrame;
      if (interval > 0 && interval <= MAX_INTERVAL_MS) {
        this.intervals.push(interval);
        this.fillTest?.frame(interval);
      }
    }
    this.lastFrame = t;
    this.frameCpu = 0;
    this.lapAt = this.now();
  }

  // Time since the previous lap (or the frame's start) goes to `stage`.
  lap(stage: number): void {
    if (!this.on) return;
    const t = this.now();
    const d = t - this.lapAt;
    this.stages[stage]!.push(d);
    this.frameCpu += d;
    if (this.trace) this.timeline.measure(STAGES[stage]!, this.lapAt, t);
    this.lapAt = t;
  }

  frameEnd(): void {
    if (this.on) queueMicrotask(this.reactLap);
  }

  startFill(setScale: (scale: number) => void, scale: () => number, scene: number): Promise<FillResult | null> {
    this.cancelFill();
    return new Promise((resolve) => {
      this.fillTest = new FillTest(setScale, scale, scene, (result) => {
        this.fillTest = null;
        if (result) this.fill = result;
        resolve(result);
      });
    });
  }

  cancelFill(): void { this.fillTest?.cancel(); }

  get fillRunning(): boolean { return !!this.fillTest?.running; }

  // Allocates: call at UI rate.
  report(c: ReportContext): PerfReport {
    if (this.trace) this.timeline.clear();   // the spans live on in a recording; don't let the buffer grow
    // Each frame pushes about one sample to every series (not quite: the first frame after switching on,
    // or after a long gap, has stages but no interval), so the newest n of each cover about the same frames.
    // Never fewer than MIN_FRAMES: below ~3 fps the window holds fewer, and the report would never warm up.
    const n = Math.max(this.intervals.newestSpanning(WINDOW_MS), Math.min(MIN_FRAMES, this.intervals.size));
    const p10 = this.intervals.percentile(0.1, n);
    if (n >= MIN_FRAMES && p10 > 0) this.budget = Math.min(this.budget, REFRESH_MS.find((r) => r <= p10 * 1.1) ?? p10);
    const budget = Number.isFinite(this.budget) ? this.budget : REFRESH_MS[0]!;
    const cpu = STAGES.map((stage, i): StageStat => ({ stage, mean: this.stages[i]!.mean(n), p95: this.stages[i]!.percentile(0.95, n) }))
      .sort((a, b) => b.mean - a.mean);
    const frameP50 = this.intervals.percentile(0.5, n);
    const frameP95 = this.intervals.percentile(0.95, n);
    const cpuMean = this.cpuTotal.mean(n);
    const fill = this.fill && this.fill.scene === c.scene && this.fill.scale === c.resolution && !this.fillRunning ? this.fill : null;
    return {
      fps: fpsOf(this.intervals.mean(n)),
      frameP50,
      frameP95,
      budget,
      cpu,
      cpuMean,
      cpuP95: this.cpuTotal.percentile(0.95, n),
      size: [c.size[0], c.size[1]],
      scale: c.scale,
      projectors: c.projectors,
      preview: c.preview,
      fill: this.fill,
      fillCurrent: fill !== null,
      fillRunning: this.fillRunning,
      trace: this.trace,
      verdict: diagnose({ frames: n, frameP50, frameP95, budget, cpuMean, cpu, fill, projectors: c.projectors, preview: c.preview }),
    };
  }
}

// What `window.__profiler` offers scripts (perf/measure.mjs) and the console. Not `__perf`: the
// probe uses that name for its own counters.
export interface ProfilerApi {
  report(): PerfReport | null;
  fillTest(): Promise<FillResult | null>;
  reset(): void;
  scenes(): ListedScene[];
  setScene(index: number): void;
  // One still frame of a scene (1280×720: lines drawn in pixels look as they do on a screen) with the
  // inputs you give on top of the stand-in ones; `silent` swaps the stand-in spectrum for silence.
  // Without `look`: the scene and the display pass, no trails, a neutral grade. With one: a short burst
  // of frames through the whole pipeline (trails, fringing, grade) with that Look, ending on the
  // returned one, as the audience would see it. The built-in conformance spec uses it to hear silence
  // and kicks on cue. An image, or why the scene doesn't compile.
  still(index: number, sound?: { inputs?: Partial<SnapshotUniforms>; silent?: boolean; look?: FrameLook }): Promise<{ error: string | null; image: ImageData | null }>;
}

// A scene as scripts see it: its category, how many parameters it has, and whether it ships with the app.
export interface ListedScene { index: number; name: string; cat: string; params: number; builtin: boolean }

type GlobalTarget = { __profiler?: ProfilerApi };

export function installGlobal(api: ProfilerApi, target: GlobalTarget = globalThis as GlobalTarget): void {
  target.__profiler = api;
}

// Only the owner removes it: under StrictMode a disposed first controller must not take the
// second one's hook away.
export function uninstallGlobal(api: ProfilerApi, target: GlobalTarget = globalThis as GlobalTarget): void {
  if (target.__profiler === api) delete target.__profiler;
}

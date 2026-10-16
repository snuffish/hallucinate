import { describe, expect, it, vi } from 'vitest';
import { FillTest, FrameProfiler, Samples, Stage, diagnose, installGlobal, uninstallGlobal, type DiagnoseInput, type FillResult, type ProfilerApi, type Timeline } from './profiler';

// A clock the test moves by hand.
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
const quietTimeline = () => ({ measure: vi.fn<Timeline['measure']>(), clear: vi.fn<Timeline['clear']>() });
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Samples', () => {
  it('keeps the newest samples once the ring wraps', () => {
    const s = new Samples(4);
    for (const v of [100, 100, 1, 2, 3, 4]) s.push(v);
    expect(s.size).toBe(4);
    expect(s.mean()).toBe(2.5);
    expect(s.percentile(0)).toBe(1);
    expect(s.percentile(0.95)).toBe(4);
  });

  it('computes over the newest samples, and finds how many span a stretch of time', () => {
    const s = new Samples(8);
    for (const v of [16, 16, 16, 16, 16, 16, 100, 100]) s.push(v);
    expect(s.newestSpanning(150)).toBe(2);
    expect(s.mean(2)).toBe(100);
    expect(s.percentile(0.5, 2)).toBe(100);
    expect(s.percentile(0.5)).toBe(16);
  });

  it('reads percentiles before the ring is full and is empty after clear()', () => {
    const s = new Samples(10);
    for (const v of [5, 1, 3]) s.push(v);
    expect(s.percentile(0.5)).toBe(3);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.mean()).toBe(0);
  });
});

describe('FrameProfiler', () => {
  it('splits a frame into its stages, and the stages add up to the frame', async () => {
    const clock = fakeClock();
    const p = new FrameProfiler(clock.now, quietTimeline());
    p.setOn(true);
    p.frameStart(0);
    clock.advance(2); p.lap(Stage.audio);
    clock.advance(1); p.lap(Stage.logic);
    clock.advance(3); p.lap(Stage.render);
    p.frameEnd();
    await flushMicrotasks();
    expect(p.stages[Stage.audio]!.mean()).toBe(2);
    expect(p.stages[Stage.logic]!.mean()).toBe(1);
    expect(p.stages[Stage.render]!.mean()).toBe(3);
    expect(p.cpuTotal.mean()).toBe(6);
  });

  // React renders a store update in a microtask queued during ui.set, so after the loop returns.
  it('counts React work that runs in a microtask queued before frameEnd()', async () => {
    const clock = fakeClock();
    const p = new FrameProfiler(clock.now, quietTimeline());
    p.setOn(true);
    p.frameStart(0);
    clock.advance(1); p.lap(Stage.ui);
    queueMicrotask(() => clock.advance(5));   // what React's scheduled render does
    p.frameEnd();
    await flushMicrotasks();
    expect(p.stages[Stage.react]!.mean()).toBe(5);
    expect(p.cpuTotal.mean()).toBe(6);
  });

  it('records nothing while off', async () => {
    const clock = fakeClock();
    const p = new FrameProfiler(clock.now, quietTimeline());
    p.frameStart(0);
    clock.advance(4); p.lap(Stage.audio);
    p.frameEnd();
    p.frameStart(16);
    await flushMicrotasks();
    expect(p.intervals.size).toBe(0);
    expect(p.stages[Stage.audio]!.size).toBe(0);
    expect(p.cpuTotal.size).toBe(0);
  });

  it('ignores the gap after a background tab or a pause', () => {
    const p = new FrameProfiler(fakeClock().now, quietTimeline());
    p.setOn(true);
    p.frameStart(0);
    p.frameStart(16);
    p.frameStart(30_016);
    p.frameStart(30_032);
    expect(p.intervals.size).toBe(2);
    expect(p.intervals.percentile(0.95)).toBe(16);
  });

  it('writes DevTools spans only in trace mode, and clears them when it reports', () => {
    const clock = fakeClock();
    const timeline = quietTimeline();
    const p = new FrameProfiler(clock.now, timeline);
    p.setOn(true);
    p.frameStart(0); clock.advance(1); p.lap(Stage.audio);
    expect(timeline.measure).not.toHaveBeenCalled();
    p.setOn(true, true);
    p.frameStart(16); clock.advance(2); p.lap(Stage.audio);
    expect(timeline.measure).toHaveBeenCalledWith('audio', 1, 3);
    timeline.clear.mockClear();
    p.report({ size: [100, 100], scale: 1, resolution: 1, scene: 0, projectors: 0, preview: false });
    expect(timeline.clear).toHaveBeenCalled();
  });

  it('estimates the refresh budget from the fastest frames, so a steady 30 fps still reads as short', () => {
    const p = new FrameProfiler(fakeClock().now, quietTimeline());
    p.setOn(true);
    let t = 0;
    for (let i = 0; i < 120; i++) p.frameStart((t += 33.3));
    const r = p.report({ size: [1920, 1080], scale: 0.75, resolution: 0.75, scene: 0, projectors: 0, preview: false });
    expect(r.budget).toBeCloseTo(1000 / 60);
    expect(r.verdict.kind).not.toBe('smooth');
  });

  // Found on real hardware: a 7 fps scene after a 60 fps one read "smooth" while the window was
  // counted in frames (240 frames are 4 s at 60 fps but 34 s at 7 fps).
  it('follows a scene that turns slow within a few seconds', () => {
    const p = new FrameProfiler(fakeClock().now, quietTimeline());
    p.setOn(true);
    let t = 0;
    for (let i = 0; i < 400; i++) p.frameStart((t += 1000 / 60));
    for (let i = 0; i < 25; i++) p.frameStart((t += 140));   // 3.5 s at ~7 fps
    const r = p.report({ size: [3840, 2160], scale: 1, resolution: 1, scene: 0, projectors: 0, preview: false });
    expect(r.frameP50).toBeCloseTo(140);
    expect(Math.round(r.fps)).toBe(7);
    expect(r.budget).toBeCloseTo(1000 / 60);
    expect(r.verdict.kind).toBe('gpu-suspected');
  });

  // Found on the CI runner (software WebGL): at 2-3 fps the last 3 s never held 10 frames, so the
  // overlay said "Collecting frames…" for good — on exactly the machine that needs it.
  it('warms up below 3 fps too', () => {
    const p = new FrameProfiler(fakeClock().now, quietTimeline());
    p.setOn(true);
    let t = 0;
    for (let i = 0; i < 30; i++) p.frameStart((t += 400));   // 2.5 fps
    const r = p.report({ size: [1280, 720], scale: 1, resolution: 1, scene: 0, projectors: 0, preview: false });
    expect(r.frameP50).toBeCloseTo(400);
    expect(r.verdict.kind).toBe('gpu-suspected');
  });

  it('only uses a fill result for the scene and resolution it ran on', async () => {
    const clock = fakeClock();
    const p = new FrameProfiler(clock.now, quietTimeline());
    p.setOn(true);
    let scale = 1;
    const done = p.startFill((s) => { scale = s; }, () => 1, 3);
    let t = 0;
    // Slow at full scale, fast at half: a GPU-bound scene. The main thread does almost nothing.
    for (let i = 0; i < 400 && p.fillRunning; i++) {
      p.frameStart((t += scale === 1 ? 50 : 17));
      clock.advance(1); p.lap(Stage.render); p.frameEnd();
    }
    await flushMicrotasks();
    for (let i = 0; i < 60; i++) { p.frameStart((t += 50)); clock.advance(1); p.lap(Stage.render); p.frameEnd(); }
    await flushMicrotasks();
    expect((await done)?.gain).toBeGreaterThan(2);
    const ctx = { size: [1920, 1080] as const, scale: 1, resolution: 1, projectors: 0, preview: false };
    expect(p.report({ ...ctx, scene: 3 }).verdict.kind).toBe('gpu');
    expect(p.report({ ...ctx, scene: 3 }).fillCurrent).toBe(true);
    const other = p.report({ ...ctx, scene: 4 });
    expect(other.verdict.kind).toBe('gpu-suspected');
    expect(other.fill?.scene).toBe(3);   // still shown, but marked as not about this scene
    expect(other.fillCurrent).toBe(false);
    expect(p.report({ ...ctx, scene: 3, resolution: 0.5 }).verdict.kind).toBe('gpu-suspected');
  });

  it('cancels a running fill test when switched off', async () => {
    const p = new FrameProfiler(fakeClock().now, quietTimeline());
    p.setOn(true);
    const setScale = vi.fn();
    const done = p.startFill(setScale, () => 0.75, 0);
    p.setOn(false);
    expect(await done).toBeNull();
    expect(p.fillRunning).toBe(false);
  });
});

describe('FillTest', () => {
  // Runs frames at `ms(scale)` until the test is done; returns the scale changes it made.
  function run(test: FillTest, scaleNow: () => number, ms: (scale: number) => number, maxFrames = 1000) {
    for (let i = 0; i < maxFrames && test.running; i++) test.frame(ms(scaleNow()));
  }

  it('measures at full and half scale, skipping warm-up frames, and restores', () => {
    let scale = 0.75;
    const scales: number[] = [];
    let result: FillResult | null = null;
    const test = new FillTest((s) => { scale = s; scales.push(s); }, () => 0.75, 2, (r) => { result = r; }, { warmup: 5, measureMs: 500 });
    // The first frames after each switch are slow (new targets); the warm-up hides them.
    let sinceSwitch = 0;
    let last = scale;
    run(test, () => scale, (s) => { if (s !== last) { last = s; sinceSwitch = 0; } return ++sinceSwitch <= 5 ? 500 : s < 0.5 ? 10 : 40; });
    expect(scales).toEqual([0.375, 0.75]);
    expect(result).toMatchObject({ baseFps: 25, reducedFps: 100, gain: 4, scene: 2, scale: 0.75 });
  });

  it('restores to the resolution set at the end, not the one it started with', () => {
    let resolution = 0.75;
    let scale = resolution;
    const test = new FillTest((s) => { scale = s; }, () => resolution, 0, () => {}, { warmup: 0, measureMs: 100, minFrames: 1 });
    run(test, () => scale, () => 20, 6);   // into the reduced phase
    expect(scale).toBe(0.375);
    resolution = 1;                         // the slider moved meanwhile
    test.cancel();
    expect(scale).toBe(1);
  });

  it('cancel() before the switch leaves the scale alone', () => {
    const setScale = vi.fn();
    const done = vi.fn();
    const test = new FillTest(setScale, () => 1, 0, done);
    test.frame(16);
    test.cancel();
    expect(setScale).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null);
    expect(test.running).toBe(false);
  });
});

describe('diagnose', () => {
  const base: DiagnoseInput = {
    frames: 240, frameP50: 16.7, frameP95: 17.4, budget: 1000 / 60, cpuMean: 3,
    cpu: [{ stage: 'render', mean: 2, p95: 3 }, { stage: 'audio', mean: 1, p95: 1 }],
    fill: null, projectors: 0, preview: false,
  };
  const fill = (gain: number): FillResult => ({ baseFps: 20, reducedFps: 20 * gain, gain, scene: 0, scale: 1 });

  it('waits for enough frames', () => {
    expect(diagnose({ ...base, frames: 5 }).kind).toBe('warming-up');
  });

  it('is smooth while frames keep up with the display, and says how much room the main thread leaves', () => {
    const v = diagnose(base);
    expect(v.kind).toBe('smooth');
    expect(v.text).toContain('18%');
  });

  // Found on real hardware: opening the library made 30 long tasks (up to 217 ms) in 6 s, frame p95
  // 67.7 ms, and the median-only check still said "Keeping up".
  it('reports hitches that leave the median alone as stutter', () => {
    const v = diagnose({ ...base, frameP95: 67.7 });
    expect(v.kind).toBe('stutter');
    expect(v.text).toContain('67.7 ms');
    expect(diagnose({ ...base, frameP95: 33.4 }).kind).toBe('smooth');   // one missed refresh now and then is fine
  });

  it('blames the main thread, naming its heaviest stage, when it fills the frame', () => {
    const v = diagnose({ ...base, frameP50: 33, cpuMean: 28, cpu: [{ stage: 'react', mean: 20, p95: 30 }, { stage: 'render', mean: 8, p95: 9 }] });
    expect(v.kind).toBe('cpu');
    expect(v.text).toContain('React & microtasks');
  });

  // The #1 finding of the blind-spot pass: a slow frame with an idle main thread is not proof of a
  // GPU bottleneck, and GPU timer queries can't be trusted to prove it.
  it('never says GPU without a fill test behind it', () => {
    const v = diagnose({ ...base, frameP50: 50, cpuMean: 2 });
    expect(v.kind).toBe('gpu-suspected');
    expect(v.text).toContain('Test GPU');
  });

  it('says GPU fill rate when half the pixels run clearly faster', () => {
    expect(diagnose({ ...base, frameP50: 50, cpuMean: 2, fill: fill(2.9) }).kind).toBe('gpu');
  });

  it('points at the other renderers when half the pixels change nothing', () => {
    const v = diagnose({ ...base, frameP50: 50, cpuMean: 2, fill: fill(1.05), projectors: 2, preview: true });
    expect(v.kind).toBe('elsewhere');
    expect(v.text).toContain('2 projector windows');
    expect(v.text).toContain('Preview');
    expect(diagnose({ ...base, frameP50: 50, cpuMean: 2, fill: fill(1.05) }).text).toContain('DevTools');
  });
});

describe('window.__profiler', () => {
  const api = (): ProfilerApi => ({ report: () => null, fillTest: async () => null, reset: () => {}, scenes: () => [], setScene: () => {}, still: async () => ({ error: null, image: null }) });

  it('is removed only by the controller that installed it (StrictMode makes two)', () => {
    const target: { __profiler?: ProfilerApi } = {};
    const first = api();
    const second = api();
    installGlobal(first, target);
    installGlobal(second, target);
    uninstallGlobal(first, target);   // the first controller's dispose()
    expect(target.__profiler).toBe(second);
    uninstallGlobal(second, target);
    expect(target.__profiler).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseParams } from '../engine/params';
import { programState } from '../engine/look';
import { fakeApp, type FakeApp } from './fake-app';
import { StudioSession } from './studio';
import { KEYS, flushAll } from '../state/persistence';
import type { Plan } from '../state/show-plan';

// The app in memory (fake-app.ts): the preview renderer is never created because setOpen() is not called.
const app3 = () => fakeApp({ scenes: [{ name: 'Alpha', cat: 'Fractal', trails: 1 }, { name: 'Beta', cat: 'Tunnel & 3D', trails: 1 }, { name: 'Gamma', cat: 'Organic', trails: 1 }] });
type Fake = FakeApp;

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
});

function session(app: Fake, show?: object): StudioSession {
  if (show) storage.set(KEYS.show, JSON.stringify(show));
  const s = new StudioSession(app, () => {});
  s.attach();
  return s;
}
const cue = (name: string, scene = name) => ({ id: `id-${name}`, name, scene, values: {}, look: {} });
const beats = (s: StudioSession, n: number) => { for (let i = 0; i < n; i++) s.onBeat(); };
// A frame: the clock moves and the studio's per-frame hook runs (the wall-clock ceiling lives there).
const seconds = (app: Fake, s: StudioSession, n: number) => { app.state.clock.clock += n; (s as unknown as { update(dt: number): void }).update(n); };

describe('StudioSession plan executor', () => {
  it('follows the plan instead of list order, with each step\'s own beat count', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta'), cue('Gamma')], autoBeats: 16 });
    s.setAutopilot(true);
    s.setPlan({ steps: [{ cue: 'id-Gamma', beats: 8, maxSeconds: 90 }, { cue: 'id-Alpha', beats: 16, maxSeconds: 90 }], note: 'test', loop: true });
    expect(s.beatsTarget).toBe(16);          // the plan starts at the next take: the dial's count until then
    expect(s.preview?.name).toBe('Gamma');   // Preview shows what comes next
    beats(s, 16);
    expect(s.live?.name).toBe('Gamma');
    expect(s.beatsTarget).toBe(8);
    beats(s, 8);
    expect(s.live?.name).toBe('Alpha');
    beats(s, 16);
    expect(s.live?.name).toBe('Gamma');      // looped
  });

  it('continues a step that is already Live when the plan starts with it', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta')], autoBeats: 32 });
    s.setAutopilot(true);
    s.take(s.cues[1]!, 'tool');
    s.setPlan({ steps: [{ cue: 'Beta', beats: 8, maxSeconds: 90 }, { cue: 'Alpha', beats: 8, maxSeconds: 90 }], note: '', loop: false });
    expect(s.planIndex).toBe(0);
    expect(s.beatsTarget).toBe(8);
    beats(s, 8);
    expect(s.live?.name).toBe('Alpha');
    beats(s, 8);                              // no loop: back to list order, the plan is gone
    expect(s.plan).toBeNull();
    expect(s.live?.name).toBe('Beta');
    expect(app.toasts).toContainEqual(expect.stringContaining('Plan finished'));
  });

  it('skips steps whose show scene is gone and drops a plan nothing in it can play', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta'), cue('Gamma')], autoBeats: 8 });
    s.setAutopilot(true);
    s.setPlan({ steps: [{ cue: 'nope', beats: 8, maxSeconds: 90 }, { cue: 'id-Beta', beats: 8, maxSeconds: 90 }], note: '', loop: true });
    beats(s, 8);
    expect(s.live?.name).toBe('Beta');        // "nope" was skipped
    s.removeCue(s.cues[1]!);                  // Beta leaves the show: the plan can't go on
    beats(s, 8);
    expect(s.plan).toBeNull();
    expect(s.live?.name).toBe('Alpha');       // list order from the top
    expect(app.toasts).toContainEqual(expect.stringContaining('no playable'));
  });

  it('moves on by wall clock when the beats never come', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta')], autoBeats: 32 });
    s.setAutopilot(true);
    s.setPlan({ steps: [{ cue: 'id-Beta', beats: 64, maxSeconds: 15 }, { cue: 'id-Alpha', beats: 64, maxSeconds: 15 }], note: '', loop: true });
    seconds(app, s, 60);                      // nothing yet: the plan starts at the next take (list ceiling 90 s)
    expect(s.live).toBeNull();
    seconds(app, s, 31);
    expect(s.live?.name).toBe('Beta');
    seconds(app, s, 10);
    expect(s.live?.name).toBe('Beta');
    seconds(app, s, 6);
    expect(s.live?.name).toBe('Alpha');
    app.audio.kind = null;                    // no music: nothing moves
    seconds(app, s, 100);
    expect(s.live?.name).toBe('Alpha');
  });

  it('on the timer, every show scene and every plan step gets the dial\'s seconds, music or not', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta'), cue('Gamma')], autoBeats: 16 });
    s.setAutoUnit('seconds');
    s.setAutoSeconds(20);
    s.setAutopilot(true);
    beats(s, 40);                             // beats don't count on the timer
    expect(s.live).toBeNull();
    seconds(app, s, 19);
    expect(s.live).toBeNull();
    seconds(app, s, 1.5);
    expect(s.live?.name).toBe('Alpha');       // list order
    expect(s.secondsElapsed).toBeCloseTo(0, 5);
    s.setPlan({ steps: [{ cue: 'id-Gamma', beats: 16, maxSeconds: 600 }, { cue: 'id-Beta', beats: 16, maxSeconds: 600 }], note: '', loop: true });
    app.audio.kind = null;                    // the timer runs without music too
    seconds(app, s, 20.5);
    expect(s.live?.name).toBe('Gamma');       // the plan's step, after the timer's 20 s, not its beats
    seconds(app, s, 20.5);
    expect(s.live?.name).toBe('Beta');
    flushAll();                               // saves are coalesced
    expect(JSON.parse(storage.get(KEYS.show)!)).toMatchObject({ autoUnit: 'seconds', autoSeconds: 20 });
    s.setAutoUnit('beats');
    beats(s, 16);
    expect(s.live?.name).toBe('Gamma');       // back on beats: wrapped to step 1
  });

  it('a hand-made take lands on its plan step and marks the show as touched', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta'), cue('Gamma')], autoBeats: 32 });
    s.setAutopilot(true);
    s.setPlan({ steps: [{ cue: 'id-Alpha', beats: 8, maxSeconds: 90 }, { cue: 'id-Beta', beats: 8, maxSeconds: 90 }, { cue: 'id-Gamma', beats: 8, maxSeconds: 90 }], note: '', loop: true });
    expect(s.userTouched).toBe(false);
    s.take(s.cues[2]!);                       // the user takes Gamma (step 3)
    expect(s.userTouched).toBe(true);
    expect(s.planIndex).toBe(2);
    beats(s, 8);
    expect(s.live?.name).toBe('Alpha');       // wrapped to step 1
    s.take(s.cues[1]!, 'tool');
    expect(s.userTouched).toBe(true);         // tools don't clear it, only the director does
  });

  it('replaces the plan atomically, remembers the previous one and restores it', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta')], autoBeats: 32 });
    const one: Plan = { steps: [{ cue: 'id-Alpha', beats: 8, maxSeconds: 90 }], note: 'one', loop: true };
    const two: Plan = { steps: [{ cue: 'id-Beta', beats: 8, maxSeconds: 90 }], note: 'two', loop: true };
    s.setPlan(one);
    s.setPlan(two);
    expect(s.plan?.note).toBe('two');
    expect(s.lastPlan?.note).toBe('one');
    s.restoreLastPlan();
    expect(s.plan?.note).toBe('one');
    flushAll();
    expect(JSON.parse(storage.get(KEYS.show)!).plan.note).toBe('one');   // persisted
  });

  it('coalesces a burst of edits into one write', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha')] });
    const writes = vi.spyOn(localStorage, 'setItem');
    for (let i = 0; i < 50; i++) s.updateCue(s.cues[0]!, { values: { amount: i } });
    expect(writes).not.toHaveBeenCalled();
    flushAll();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(KEYS.show)!).cues[0].values).toEqual({ amount: 49 });
  });

  it('clamps imported autopilot and fade values to what the controls allow', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha')], autoSeconds: 0, seconds: 99, autoBeats: 'x' });
    expect(s.autopilot.seconds).toBe(5);
    expect(s.seconds).toBe(8);
    expect(s.autopilot.beats).toBe(32);   // not a number: the default
    expect(s.cues).toHaveLength(1);       // the rest of the show is kept
  });

  it('reorders only with every id exactly once', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta'), cue('Gamma')] });
    s.reorder(['id-Gamma', 'id-Alpha', 'id-Beta']);
    expect(s.cues.map((c) => c.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(() => s.reorder(['id-Gamma', 'id-Alpha'])).toThrow();
    expect(() => s.reorder(['id-Gamma', 'id-Alpha', 'id-Alpha'])).toThrow();
    expect(() => s.reorder(['id-Gamma', 'id-Alpha', 'id-Nope'])).toThrow();
  });

  it('snapshot and restore bring the show and the plan back', () => {
    const app = app3();
    const s = session(app, { cues: [cue('Alpha'), cue('Beta')] });
    const before = s.snapshot();
    s.add({ name: 'Gamma', scene: 'Gamma', values: {}, look: {} });
    s.setPlan({ steps: [{ cue: 'id-Alpha', beats: 8, maxSeconds: 90 }], note: '', loop: true });
    s.restore(before);
    expect(s.cues.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    expect(s.plan).toBeNull();
  });

  it('reads an old show without a plan, and a saved plan with defaults', () => {
    const app = app3();
    const old = session(app, { cues: [cue('Alpha')], mode: 'cut', seconds: 2, autoBeats: 64 });
    expect(old.plan).toBeNull();
    expect(old.directorBeats).toBe(128);
    const saved = session(app, { cues: [cue('Alpha')], plan: { steps: [{ cue: 'id-Alpha', beats: 16 }] }, directorBeats: 64 });
    expect(saved.plan?.steps[0]?.maxSeconds).toBe(90);
    expect(saved.plan?.loop).toBe(true);
    expect(saved.directorBeats).toBe(64);
  });
});

describe('StudioSession pinned Live', () => {
  const { params: GLOW } = parseParams('uniform float uGlow; // @param min=0 max=3');
  const glowing = (name: string, v: number) => ({ ...cue(name), values: { uGlow: v } });
  const projector = (app: Fake) => app.live.route({ ...programState(), scene: app.state.clock.scene }, true).projector!;

  it('keeps Live for the projectors when the studio closes, and crossfades a take from it', () => {
    const app = fakeApp({ scenes: [{ name: 'Alpha', trails: 1 }, { name: 'Beta', trails: 1 }], params: [GLOW, GLOW] });
    const s = session(app, { cues: [glowing('Alpha', 2), glowing('Beta', 1)], mode: 'fade', seconds: 2 });
    s.setOpen(true, null);
    s.take(s.cues[0]!);                        // open: on the main screen
    s.setOpen(false, null);
    expect(s.isPinned).toBe(true);
    expect(app.ui.get().liveName).toBe('Alpha');
    app.setScene(1);                            // browsing: the screen moves on, Live doesn't
    expect(projector(app).program.scene).toBe(0);

    s.take(s.cues[1]!);
    app.state.clock.clock += 1;
    const out = projector(app);
    expect(out.program).toMatchObject({ scene: 1, prevScene: 0, mix: 0.5 });
    expect(out.params).toEqual({ 1: { uGlow: 1 }, 0: { uGlow: 2 } });
    expect(app.toasts).toContain('Live: Beta');

    s.setOpen(true, null);                      // reopening puts Live back on the screen
    expect(s.isPinned).toBe(false);
    expect(app.ui.get().liveName).toBeNull();
    expect(app.state.clock.scene).toBe(1);
    expect(app.library.values(1)).toEqual({ uGlow: 1 });
  });
});

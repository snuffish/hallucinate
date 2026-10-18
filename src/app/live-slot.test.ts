import { describe, expect, it } from 'vitest';
import { NO_BACKGROUND, type Background } from '../engine/background';
import type { EffectStack } from '../engine/effects';
import type { Hearing } from '../engine/listener';
import { parseParams, type ParamValues } from '../engine/params';
import { programState } from '../engine/look';
import type { SceneUniforms } from '../engine/renderer';
import type { Scene } from '../scenes';
import { defaultClock, defaultLook } from '../state/app-state';
import { Store } from '../state/store';
import { initialUIState } from '../state/ui-state';
import { LiveSlot } from './live-slot';

const { params: GLOW } = parseParams('uniform float uGlow; // @param min=0 max=3');

// Three scenes with a uGlow parameter; the main canvas holds `stored` for each.
function slot() {
  const scenes = ['Alpha', 'Beta', 'Gamma'].map((name, i): Scene => ({ id: `s${i}`, name, cat: '', desc: '', body: '', frag: '', params: GLOW, trails: 1 }));
  const look = defaultLook();
  const state = { scenes, look, clock: defaultClock() };
  const stored: SceneUniforms[] = [{ uGlow: 0.1 }, { uGlow: 0.2 }, { uGlow: 0.3 }];
  const ui = new Store(initialUIState(look));
  const toasts: string[] = [];
  const hearing: Hearing = { bass: 0.8, mid: 0.4, high: 0.2, level: 0.6, beat: 0, kick: false, tick: false, tickPhase: 0, ticks: 0, bpm: 120, bright: 0.5, centroid: 2500, energy: 0.5, mood: 0.5 };
  const live = new LiveSlot({ state, hearing, specs: () => GLOW, stored, ui, toast: (t) => { toasts.push(t); } });
  // The main program this frame: scene 0, crossfading from nothing.
  const base = { ...programState(), scene: 0, master: 0.8 };
  const at = (t: number) => { state.clock.clock = t; };
  return { live, state, ui, toasts, base, at, hearing };
}
const glow = (v: number): ParamValues => ({ uGlow: v });
const MIRRORED: EffectStack = [{ id: 'mirror', on: true, settings: { axis: 0 } }];
const FLIPPED: EffectStack = [{ id: 'mirror', on: true, settings: { axis: 1 } }];

describe('LiveSlot', () => {
  it('with nothing pinned, the screen and the projectors show the main program', () => {
    const { live, base } = slot();
    base.prevScene = 2;
    const out = live.route(base, true, 0);
    expect(out.screen.program).toBe(base);
    expect(out.screen.params).toBeUndefined();
    expect(out.projector!.program).toBe(base);
    expect(out.projector!.params).toEqual({ 0: { uGlow: 0.1 }, 2: { uGlow: 0.3 } });   // projectors store no values
    expect(live.route(base, false, 0).projector).toBeNull();
  });

  it('pinned, projectors get Live while the screen stays the preview', () => {
    const { live, base, ui } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta warm');
    expect(ui.get().liveName).toBe('Beta warm');
    const out = live.route(base, true, 0);
    expect(out.screen.program).toBe(base);
    expect(out.projector!.program).toMatchObject({ scene: 1, prevScene: -1, mix: 1, master: 0.8 });
    expect(out.projector!.params).toEqual({ 1: { uGlow: 2 } });
  });

  it('crossfades a take from the show scene Live had, with its own values', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    at(10);
    live.take({ scene: 2, values: glow(1.5), look: {}, effects: [], background: NO_BACKGROUND }, 'Gamma', 2);
    at(11);
    const mid = live.route(base, true, 0).projector!;
    expect(mid.program).toMatchObject({ scene: 2, prevScene: 1, mix: 0.5 });
    expect(mid.params).toEqual({ 2: { uGlow: 1.5 }, 1: { uGlow: 2 } });   // not the main canvas's 0.2
    at(12);
    const done = live.route(base, true, 0).projector!;
    expect(done.program).toMatchObject({ scene: 2, prevScene: -1, mix: 1 });
    expect(done.params).toEqual({ 2: { uGlow: 1.5 } });
  });

  it('a take of the same scene shows its values at once', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    at(10);
    live.take({ scene: 1, values: glow(0.5), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta dim', 2);
    const out = live.route(base, true, 0).projector!;
    expect(out.program).toMatchObject({ scene: 1, prevScene: -1, mix: 1 });
    expect(out.params).toEqual({ 1: { uGlow: 0.5 } });
  });

  it('shows Live on the screen too when the Screen widget says so', () => {
    const { live, base, ui, toasts } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    live.setScreenMode('live');
    expect(ui.get().screenMode).toBe('live');
    expect(toasts).toEqual(['Screen shows Live: Beta']);
    const out = live.route(base, false, 0);
    expect(out.screen.program).toMatchObject({ scene: 1 });
    expect(out.screen.params).toEqual({ 1: { uGlow: 2 } });
    expect(out.projector).toBeNull();
    live.setScreenMode('live');
    expect(toasts).toHaveLength(1);   // no change, no toast
  });

  it("keeps the look sliders a show scene doesn't store as they were at the take", () => {
    const { live, base, state } = slot();
    state.look.hue = 0.25;
    state.look.trails = 0.5;
    live.take({ scene: 1, values: glow(2), look: { hue: 0.75 }, effects: [], background: NO_BACKGROUND }, 'Beta');
    state.look.trails = 0.9;   // a later slider move doesn't reach Live
    const p = live.route(base, true, 0).projector!.program;
    expect(p.hue).toBeCloseTo(0.75);
    expect(p.feedback).toBeCloseTo(0.5);
    expect(live.unpin()).toEqual({ scene: 1, values: glow(2), look: expect.objectContaining({ hue: 0.75, trails: 0.5 }), effects: [], background: NO_BACKGROUND });
  });

  it('unpinning hands back what was pinned and the main program returns everywhere', () => {
    const { live, base, ui } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    live.setScreenMode('live');
    expect(live.unpin()?.scene).toBe(1);
    expect(ui.get().liveName).toBeNull();
    expect(live.pinned).toBe(false);
    const out = live.route(base, true, 0);
    expect(out.screen.program).toBe(base);
    expect(out.projector!.program).toBe(base);
    expect(live.unpin()).toBeNull();
  });

  it('composes the Preview monitor the way it composes Live', () => {
    const { live, base } = slot();
    const shot = { scene: 2, values: glow(1), look: { hue: 0.5 }, effects: [], background: NO_BACKGROUND };
    const f = live.preview(base, shot, 0);
    expect(f.program).toMatchObject({ scene: 2, prevScene: -1, mix: 1, master: 1 });
    expect(f.params).toEqual({ 2: { uGlow: 1 } });
    live.take(shot, 'Gamma');
    expect(live.route(base, true, 0).projector!.program.hue).toBe(f.program.hue);
    expect(live.preview(base, null, 0).program).toMatchObject({ scene: -1, master: 0 });
  });

  it("keeps a show scene's reactivity and speed on Live while the main sliders move", () => {
    const { live, base, state } = slot();
    live.take({ scene: 1, values: glow(2), look: { reactivity: 0.5, speed: 0 }, effects: [], background: NO_BACKGROUND }, 'Beta still');
    state.look.reactivity = 2;
    state.look.speed = 2.5;
    let p = live.route(base, true, 1 / 60).projector!.program;
    expect(p.bass).toBeCloseTo(0.4);                  // the hearing's 0.8 at Live's reactivity 0.5, not 1.5 (2 × 0.8)
    for (let i = 0; i < 600; i++) p = live.route(base, true, 1 / 60).projector!.program;
    const t = p.time;
    for (let i = 0; i < 600; i++) p = live.route(base, true, 1 / 60).projector!.program;
    expect(p.time - t).toBeLessThan(0.01);            // speed 0: Live stands still, whatever the main speed
  });

  it('Live goes on from the screen when pinned, runs while unseen, and hands its motion back when let go', () => {
    const { live, base, state } = slot();
    Object.assign(state.clock, { time: 42, timeRate: 1, huePhase: 0.3 });
    live.take({ scene: 1, values: glow(2), look: { speed: 1 }, effects: [], background: NO_BACKGROUND }, 'Beta');
    state.clock.time = 0;                             // the screen browses on with its own motion
    expect(live.route(base, true, 0).projector!.program.time).toBeCloseTo(42);
    for (let i = 0; i < 60; i++) live.route(base, false, 1 / 60);   // no projector, screen not on Live
    const time = live.route(base, true, 0).projector!.program.time;
    expect(time).toBeGreaterThan(42.5);
    live.unpin();
    expect(state.clock.time).toBeCloseTo(time);       // the screen takes over without a jump
  });

  it('Preview shows a cue with its own reactivity, as Take will put it on Live', () => {
    const { live, base, state } = slot();
    state.look.reactivity = 2;
    const shot = { scene: 2, values: glow(1), look: { reactivity: 0.25 }, effects: [], background: NO_BACKGROUND };
    expect(live.preview(base, shot, 1 / 60).program.bass).toBeCloseTo(0.2);
    live.take(shot, 'Gamma');
    expect(live.route(base, true, 1 / 60).projector!.program.bass).toBeCloseTo(0.2);
  });

  it('grades each output on its own: Live never writes into the main frame', () => {
    const { live, base, hearing } = slot();
    hearing.bright = 1;
    const tint = [...base.grade.tint];
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    const p = live.route(base, true, 0).projector!.program;
    expect(p.grade).not.toBe(base.grade);
    expect(p.grade.tint[0]).toBeGreaterThan(1);       // bright sound warms Live
    expect(base.grade.tint).toEqual(tint);
  });

  it("carries the main screen's effects on both pictures to the screen and the projectors", () => {
    const { live, base } = slot();
    base.effects = base.prevEffects = MIRRORED;
    const out = live.route(base, true, 0);
    expect(out.screen.program).toMatchObject({ effects: MIRRORED, prevEffects: MIRRORED });
    expect(out.projector!.program).toMatchObject({ effects: MIRRORED, prevEffects: MIRRORED });
  });

  it("draws Live and Preview with their own show scene's effects, never the main screen's", () => {
    const { live, base, at } = slot();
    base.effects = base.prevEffects = MIRRORED;
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ effects: [], prevEffects: [] });
    at(10);
    live.take({ scene: 2, values: glow(1), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 'Gamma flipped', 2);
    at(11);
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ scene: 2, prevScene: 1, effects: FLIPPED, prevEffects: [] });
    expect(live.preview(base, { scene: 0, values: glow(1), look: {}, effects: [], background: NO_BACKGROUND }, 0).program).toMatchObject({ effects: [], prevEffects: [] });
    expect(live.preview(base, { scene: 0, values: glow(1), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 0).program).toMatchObject({ effects: FLIPPED, background: NO_BACKGROUND });
    expect(live.preview(base, null, 0).program).toMatchObject({ effects: [], prevEffects: [] });
  });

  it("crossfades each picture with its own show scene's effects: the outgoing one never borrows the incoming one's", () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 'Beta flipped');
    at(10);
    live.take({ scene: 2, values: glow(1), look: {}, effects: MIRRORED, background: NO_BACKGROUND }, 'Gamma mirrored', 2);
    at(11);
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ scene: 2, prevScene: 1, mix: 0.5, effects: MIRRORED, prevEffects: FLIPPED });
    at(12);
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ scene: 2, prevScene: -1, effects: MIRRORED, prevEffects: [] });
  });

  it("crossfades each picture with its own show scene's background, and never shows the main screen's", () => {
    const { live, base, at } = slot();
    const blue: Background = { ...NO_BACKGROUND, kind: 'colour', colour: '#0000ff' };
    const fade: Background = { ...NO_BACKGROUND, kind: 'gradient' };
    base.background = base.prevBackground = blue;
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ background: NO_BACKGROUND, prevBackground: NO_BACKGROUND });
    at(10);
    live.take({ scene: 2, values: glow(1), look: {}, effects: [], background: fade }, 'Gamma', 2);
    at(11);
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ scene: 2, prevScene: 1, background: fade, prevBackground: NO_BACKGROUND });
    expect(live.preview(base, { scene: 0, values: glow(1), look: {}, effects: [], background: blue }, 0).program).toMatchObject({ background: blue });
    expect(live.preview(base, null, 0).program).toMatchObject({ background: NO_BACKGROUND, prevBackground: NO_BACKGROUND });
  });

  it('a cut switches effects in the same frame as the scene', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 'Beta flipped');
    at(10);
    live.take({ scene: 2, values: glow(1), look: {}, effects: [], background: NO_BACKGROUND }, 'Gamma', 0);
    expect(live.route(base, true, 0).projector!.program).toMatchObject({ scene: 2, prevScene: -1, mix: 1, effects: [], prevEffects: [] });
  });

  it('two show scenes of one scene switch their effects at once, with their values, even in a fade', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 'Beta flipped');
    at(10);
    live.take({ scene: 1, values: glow(0.5), look: {}, effects: MIRRORED, background: NO_BACKGROUND }, 'Beta mirrored', 2);
    const out = live.route(base, true, 0).projector!;
    expect(out.program).toMatchObject({ scene: 1, prevScene: -1, mix: 1, effects: MIRRORED, prevEffects: [] });
    expect(out.params).toEqual({ 1: { uGlow: 0.5 } });
  });

  it("shows Live's effects on the screen when set to Live, and hands them back on unpin", () => {
    const { live, base } = slot();
    base.effects = base.prevEffects = MIRRORED;
    live.take({ scene: 1, values: glow(2), look: {}, effects: FLIPPED, background: NO_BACKGROUND }, 'Beta flipped');
    live.setScreenMode('live');
    expect(live.route(base, false, 0).screen.program).toMatchObject({ effects: FLIPPED, prevEffects: [] });
    expect(live.unpin()?.effects).toBe(FLIPPED);
  });

  it('reuses its frames and uniforms from frame to frame', () => {
    const { live, base } = slot();
    live.take({ scene: 1, values: glow(2), look: {}, effects: [], background: NO_BACKGROUND }, 'Beta');
    const a = live.route(base, true, 0).projector!;
    const uniforms = a.params[1];
    const b = live.route(base, true, 0).projector!;
    expect(b).toBe(a);
    expect(b.params[1]).toBe(uniforms);
  });
});

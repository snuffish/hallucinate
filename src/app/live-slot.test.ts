import { describe, expect, it } from 'vitest';
import { parseParams, type ParamValues } from '../engine/params';
import { programState } from '../engine/look';
import type { SceneUniforms } from '../engine/renderer';
import type { Scene } from '../engine/scenes';
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
  const live = new LiveSlot({ state, specs: [GLOW, GLOW, GLOW], stored, ui, toast: (t) => { toasts.push(t); } });
  // The main program this frame: scene 0, crossfading from nothing.
  const base = { ...programState(), scene: 0, master: 0.8 };
  const at = (t: number) => { state.clock.clock = t; };
  return { live, state, ui, toasts, base, at };
}
const glow = (v: number): ParamValues => ({ uGlow: v });

describe('LiveSlot', () => {
  it('with nothing pinned, the screen and the projectors show the main program', () => {
    const { live, base } = slot();
    base.prevScene = 2;
    const out = live.route(base, true);
    expect(out.screen.program).toBe(base);
    expect(out.screen.params).toBeUndefined();
    expect(out.projector!.program).toBe(base);
    expect(out.projector!.params).toEqual({ 0: { uGlow: 0.1 }, 2: { uGlow: 0.3 } });   // projectors store no values
    expect(live.route(base, false).projector).toBeNull();
  });

  it('pinned, projectors get Live while the screen stays the preview', () => {
    const { live, base, ui } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta warm');
    expect(ui.get().liveName).toBe('Beta warm');
    const out = live.route(base, true);
    expect(out.screen.program).toBe(base);
    expect(out.projector!.program).toMatchObject({ scene: 1, prevScene: -1, mix: 1, master: 0.8 });
    expect(out.projector!.params).toEqual({ 1: { uGlow: 2 } });
  });

  it('crossfades a take from the show scene Live had, with its own values', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta');
    at(10);
    live.take({ scene: 2, values: glow(1.5), look: {} }, 'Gamma', 2);
    at(11);
    const mid = live.route(base, true).projector!;
    expect(mid.program).toMatchObject({ scene: 2, prevScene: 1, mix: 0.5 });
    expect(mid.params).toEqual({ 2: { uGlow: 1.5 }, 1: { uGlow: 2 } });   // not the main canvas's 0.2
    at(12);
    const done = live.route(base, true).projector!;
    expect(done.program).toMatchObject({ scene: 2, prevScene: -1, mix: 1 });
    expect(done.params).toEqual({ 2: { uGlow: 1.5 } });
  });

  it('a take of the same scene shows its values at once', () => {
    const { live, base, at } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta');
    at(10);
    live.take({ scene: 1, values: glow(0.5), look: {} }, 'Beta dim', 2);
    const out = live.route(base, true).projector!;
    expect(out.program).toMatchObject({ scene: 1, prevScene: -1, mix: 1 });
    expect(out.params).toEqual({ 1: { uGlow: 0.5 } });
  });

  it('shows Live on the screen too when the Screen widget says so', () => {
    const { live, base, ui, toasts } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta');
    live.setScreenMode('live');
    expect(ui.get().screenMode).toBe('live');
    expect(toasts).toEqual(['Screen shows Live: Beta']);
    const out = live.route(base, false);
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
    live.take({ scene: 1, values: glow(2), look: { hue: 0.75 } }, 'Beta');
    state.look.trails = 0.9;   // a later slider move doesn't reach Live
    const p = live.route(base, true).projector!.program;
    expect(p.hue).toBeCloseTo(0.75);
    expect(p.feedback).toBeCloseTo(0.5);
    expect(live.unpin()).toEqual({ scene: 1, values: glow(2), look: expect.objectContaining({ hue: 0.75, trails: 0.5 }) });
  });

  it('unpinning hands back what was pinned and the main program returns everywhere', () => {
    const { live, base, ui } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta');
    live.setScreenMode('live');
    expect(live.unpin()?.scene).toBe(1);
    expect(ui.get().liveName).toBeNull();
    expect(live.pinned).toBe(false);
    const out = live.route(base, true);
    expect(out.screen.program).toBe(base);
    expect(out.projector!.program).toBe(base);
    expect(live.unpin()).toBeNull();
  });

  it('composes the Preview monitor the way it composes Live', () => {
    const { live, base } = slot();
    const shot = { scene: 2, values: glow(1), look: { hue: 0.5 } };
    const f = live.preview(base, shot);
    expect(f.program).toMatchObject({ scene: 2, prevScene: -1, mix: 1, master: 1 });
    expect(f.params).toEqual({ 2: { uGlow: 1 } });
    live.take(shot, 'Gamma');
    expect(live.route(base, true).projector!.program.hue).toBe(f.program.hue);
    expect(live.preview(base, null).program).toMatchObject({ scene: -1, master: 0 });
  });

  it('reuses its frames and uniforms from frame to frame', () => {
    const { live, base } = slot();
    live.take({ scene: 1, values: glow(2), look: {} }, 'Beta');
    const a = live.route(base, true).projector!;
    const uniforms = a.params[1];
    const b = live.route(base, true).projector!;
    expect(b).toBe(a);
    expect(b.params[1]).toBe(uniforms);
  });
});

// The pinned Live slot, and how a show scene becomes a frame.
//
// Closing the studio with a show scene Live pins it here: projectors keep showing it (and crossfade on
// the next take) while the main screen is free to browse, or shows Live too when the Screen widget is
// set to Live. route() decides, every frame, what the main canvas and the projectors draw. The studio's
// Preview monitor composes its show scene here as well, so Preview shows exactly what Take puts on Live.
// Created by the controller; publishes `liveName` and `screenMode`. Nothing per frame allocates.

import { toUniform, type ParamSpec, type ParamValues } from '../engine/params';
import { applyLook, crossfade, programState, type FrameLook, type Transition } from '../engine/look';
import type { ProgramState, SceneUniforms } from '../engine/renderer';
import { LOOK_KEYS, type AppState } from '../state/app-state';
import type { Store } from '../state/store';
import type { ScreenMode, UIState } from '../state/ui-state';

// A show scene on an output: a scene, its parameter values and its look sliders.
export interface Shot { scene: number; values: ParamValues; look: Readonly<Record<string, number>> }

// What one renderer draws this frame. `params` stands in for the stored @param values of the scenes it
// lists (Renderer.render's second argument).
export interface Frame { program: ProgramState; params: Record<number, SceneUniforms> | undefined }
// A frame with every scene's values: projectors keep none of their own.
export interface FullFrame extends Frame { params: Record<number, SceneUniforms> }
export interface Routed { screen: Frame; projector: FullFrame | null }

export interface LiveSlotDeps {
  readonly state: Pick<AppState, 'scenes' | 'look' | 'clock'>;
  specs(i: number): readonly ParamSpec[];                           // each scene's @params (SceneLibrary.specs)
  readonly stored: readonly (SceneUniforms | undefined)[];          // each scene's values on the main canvas, as uniforms
  readonly ui: Store<UIState>;
  toast(text: string, ms?: number): void;
}

// A frame state and its params table: one per output, refilled every frame.
const output = (): FullFrame => ({ program: programState(), params: {} });

export class LiveSlot {
  // What is pinned, and the show scene it crossfades from (`prevScene` is released when the fade ends).
  private pin: (Transition & { shot: Shot; from: Shot | null }) | null = null;
  private readonly live = output();
  private readonly previewFrame = output();
  private readonly mainScreen: Frame = { program: programState(), params: undefined };
  private readonly mainProjector = output();
  private readonly routed: Routed = { screen: this.mainScreen, projector: null };
  private readonly look: FrameLook = { hue: 0, trails: 0.86, aberration: 0, synesthesia: 0 };
  // A show scene's uniforms, per values object (a show scene's values are replaced, never edited, so the
  // object names one set of values): the outputs reuse them instead of rebuilding them every frame.
  private readonly uniformCache = new WeakMap<ParamValues, { index: number; specs: readonly ParamSpec[]; uniforms: SceneUniforms }>();

  constructor(private readonly deps: LiveSlotDeps) {}

  get pinned(): boolean { return this.pin !== null; }

  // Pins `shot` as Live, shown as `name`. The look sliders it doesn't store are kept as they are now.
  // With a fade it crossfades from what was pinned; a show scene of the same scene takes over at once
  // (one scene draws with one set of values).
  take(shot: Shot, name: string, fade = 0): void {
    const now = this.deps.state.look;
    const look = Object.fromEntries(LOOK_KEYS.map((k) => [k, shot.look[k] ?? now[k]]));
    const from = this.pin && this.pin.shot.scene !== shot.scene ? this.pin.shot : null;
    this.pin = {
      shot: { scene: shot.scene, values: shot.values, look },
      from,
      prevScene: from?.scene ?? -1,
      transitionStart: this.deps.state.clock.clock,
      fade: from ? fade : 0,
    };
    this.deps.ui.set({ liveName: name });
  }

  // Lets go of Live and returns what was pinned (for the main screen to take over).
  unpin(): Shot | null {
    const shot = this.pin?.shot ?? null;
    this.pin = null;
    this.deps.ui.set({ liveName: null });
    return shot;
  }

  // While Live is pinned, whether the main screen shows the preview (browse freely) or Live too.
  setScreenMode(mode: ScreenMode): void {
    const ui = this.deps.ui;
    if (mode === ui.get().screenMode) return;
    ui.set({ screenMode: mode });
    const name = ui.get().liveName;
    if (name) this.deps.toast(mode === 'live' ? `Screen shows Live: ${name}` : 'Screen shows your preview', 1500);
  }

  // This frame's outputs, from `base` (the main program: the sound, the clock, the motion, the master).
  // With nothing pinned both show the main program; projectors also get each scene's values, which they
  // don't store. Pinned, projectors show Live, and the screen does too when set to Live. `projector` is
  // whether one is connected (null then). The result is reused: read it before the next call.
  route(base: ProgramState, projector: boolean): Routed {
    const showLive = this.deps.ui.get().screenMode === 'live';
    const live = this.pin && (projector || showLive) ? this.liveFrame(base) : null;
    this.mainScreen.program = base;
    this.routed.screen = live && showLive ? live : this.mainScreen;
    this.routed.projector = !projector ? null : live ?? this.mainForProjector(base);
    return this.routed;
  }

  // The studio's Preview monitor: `shot` on its own with `base`'s sound and motion, or black for none.
  preview(base: ProgramState, shot: Shot | null): Frame {
    const f = this.previewFrame;
    if (!shot) {
      const p = Object.assign(f.program, base);
      p.scene = -1; p.prevScene = -1; p.mix = 1; p.master = 0;
      return f;
    }
    this.compose(f, base, shot, null, 1);
    f.program.master = 1;
    return f;
  }

  private liveFrame(base: ProgramState): FullFrame {
    const pin = this.pin!;
    const mix = crossfade(pin, this.deps.state.clock.clock);
    if (pin.prevScene < 0) pin.from = null;
    return this.compose(this.live, base, pin.shot, pin.from, mix);
  }

  private mainForProjector(base: ProgramState): FullFrame {
    const f = this.mainProjector, stored = this.deps.stored;
    f.program = base;
    for (const k in f.params) delete f.params[k];
    f.params[base.scene] = stored[base.scene] ?? {};
    if (base.prevScene >= 0) f.params[base.prevScene] = stored[base.prevScene] ?? {};
    return f;
  }

  // `shot` (crossfading from `from` at `mix`) onto `base`: its scene, its values, its look.
  private compose(f: FullFrame, base: ProgramState, shot: Shot, from: Shot | null, mix: number): FullFrame {
    const p = Object.assign(f.program, base);
    const { scenes, clock } = this.deps.state;
    p.scene = shot.scene; p.prevScene = from?.scene ?? -1; p.mix = mix;
    applyLook(p, this.frameLook(shot.look), clock.huePhase, scenes[shot.scene]?.trails ?? 1);
    const params = f.params;
    for (const k in params) delete params[k];
    params[shot.scene] = this.uniforms(shot.scene, shot.values);
    if (from) params[from.scene] = this.uniforms(from.scene, from.values);
    return f;
  }

  // A show scene's look, with the app's sliders for what it doesn't store (as Take does). Reused object.
  private frameLook(look: Readonly<Record<string, number>>): FrameLook {
    const app = this.deps.state.look, l = this.look;
    l.hue = look.hue ?? app.hue;
    l.trails = look.trails ?? app.trails;
    l.aberration = look.aberration ?? app.aberration;
    l.synesthesia = app.synesthesia;
    return l;
  }

  private uniforms(i: number, values: ParamValues): SceneUniforms {
    const specs = this.deps.specs(i);
    const hit = this.uniformCache.get(values);
    if (hit && hit.index === i && hit.specs === specs) return hit.uniforms;
    const uniforms: SceneUniforms = Object.fromEntries(specs.map((s) => [s.name, toUniform(s, values[s.name] ?? s.def)]));
    this.uniformCache.set(values, { index: i, specs, uniforms });
    return uniforms;
  }
}

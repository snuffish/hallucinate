// How the look sliders and the sound shape one frame. The main output, the studio's Preview monitor
// and the pinned Live slot all go through here, so Preview shows exactly what Take puts on screen.

import type { ProgramState } from './renderer';

// The sliders that change a frame's colour and trails (a show scene stores its own; synesthesia is global).
export interface FrameLook { hue: number; trails: number; aberration: number; synesthesia: number }

export const smoothstep = (x: number): number => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// A crossfade from `prevScene`, `fade` seconds long from `transitionStart`.
export interface Transition { prevScene: number; transitionStart: number; fade: number }

// How far the crossfade is at `now` (eased, 1 when done or a cut). Once it is done the previous scene
// is let go (`prevScene` -1), so the renderer stops drawing it.
export function crossfade(t: Transition, now: number): number {
  const mix = t.fade > 0 ? smoothstep((now - t.transitionStart) / t.fade) : 1;
  if (mix >= 1) t.prevScene = -1;
  return mix;
}

// A new, neutral frame state. Each pipeline keeps one and refills it every frame.
export function programState(spectrum: Uint8Array = new Uint8Array(512)): ProgramState {
  return {
    scene: -1, prevScene: -1, mix: 1, time: 0, bass: 0, mid: 0, high: 0, level: 0, beat: 0, hue: 0,
    spectrum, extra: {}, bright: 0.5, mood: 0.5,
    grade: { exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
    feedback: 0.86, zoom: 1, rotation: 0, hueDrift: 0, warp: 0, aberration: 0, master: 1,
  };
}

// Writes the look into `p`. `p.beat` and `p.bright` must already hold this frame's sound.
// Dark sound lingers (longer trails), bright sound is crisp (shorter trails, more fringing).
export function applyLook(p: ProgramState, look: FrameLook, huePhase: number, sceneTrails: number): void {
  const s = look.synesthesia;
  p.hue = look.hue + huePhase;
  p.feedback = Math.min(0.97, look.trails * sceneTrails * (1 + s * (0.5 - p.bright) * 0.12));
  p.aberration = look.aberration * (1 + p.beat * 1.5) * (1 + s * (p.bright - 0.5) * 1.2);
}

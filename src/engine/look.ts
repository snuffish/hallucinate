// How the sound and a look become one output's frame. The main screen, the pinned Live slot and the
// studio's Preview monitor each compose their frame here, with their own look and their own motion, so
// Preview shows exactly what Take puts on Live, and Live keeps a show scene's look while the main sliders
// move. Every rule from the sound to the picture lives here: reactivity, the clock's pace, the hue's walk,
// the synesthesia grade, trails, fringing, zoom, spin and warp.

import type { Hearing } from './listener';
import type { ProgramState } from './renderer';

// The sliders a frame is composed with: a show scene stores the numbers it keeps (LOOK_KEYS), the rest
// (synesthesia, mood, spin) are the app's.
export interface FrameLook {
  reactivity: number; speed: number; cycle: number; spin: number;
  hue: number; trails: number; aberration: number; synesthesia: number;
  mood: boolean;   // "Mood from tempo": off, the mood reads neutral to the grade and the shaders
}

// Where an output's picture is in its own time: the clock the shaders see, how fast it runs (it eases
// with the music) and how far the hue has walked. Each output keeps one.
export interface Motion { time: number; timeRate: number; huePhase: number }

export const copyMotion = (to: Motion, from: Readonly<Motion>): void => { to.time = from.time; to.timeRate = from.timeRate; to.huePhase = from.huePhase; };

const COOL = [0.7, 0.85, 1.35];
const WARM = [1.3, 1.05, 0.7];

// Moves `motion` on by `dt` (the show's seconds) and writes this frame's sound, grade and look into `p`.
// Leaves the scene, the crossfade, the master and the media to the caller.
export function composeFrame(p: ProgramState, motion: Motion, h: Readonly<Hearing>, look: Readonly<FrameLook>, sceneTrails: number, dt: number): void {
  const R = look.reactivity;
  const bass = Math.min(1.5, h.bass * R);
  const mid = Math.min(1.5, h.mid * R);
  const high = Math.min(1.5, h.high * R);
  const level = Math.min(1.5, h.level * R);
  const beat = Math.min(1, h.beat * R);   // the kick flash: never brighter than the strobe rule was checked at

  // Ease the clock's pace instead of jumping it on every beat, so motion stays fluid.
  const targetRate = look.speed * (0.55 + level * 0.9 + beat * 0.35);
  motion.timeRate += (targetRate - motion.timeRate) * (1 - Math.exp(-dt * 3));
  motion.time += dt * motion.timeRate;
  // Colour cycling sets both the hue's walk and how far a kick jumps it, so at 0 the colour holds.
  motion.huePhase += look.cycle * (dt * 0.06 + (h.kick ? 0.05 : 0));

  p.time = motion.time;
  p.bass = bass; p.mid = mid; p.high = high; p.level = level; p.beat = beat;
  p.tickPhase = h.tickPhase; p.ticks = h.ticks;
  p.bright = h.bright;
  p.mood = look.mood ? h.mood : 0.5;
  grade(p, look);
  // Dark sound lingers (longer trails), bright sound is crisp (shorter trails, more fringing).
  const s = look.synesthesia;
  p.hue = look.hue + motion.huePhase;
  p.feedback = Math.min(0.97, look.trails * sceneTrails * (1 + s * (0.5 - p.bright) * 0.12));
  p.aberration = look.aberration * (1 + p.beat * 1.5) * (1 + s * (p.bright - 0.5) * 1.2);
  p.zoom = 1.006 + bass * 0.025;
  p.rotation = look.spin * (0.003 * Math.sin(motion.time * 0.1) + mid * 0.01);
  p.hueDrift = 0.01 + high * 0.03;
  p.warp = bass;
}

// Crossmodal correspondences: dark/muffled sound reads as dim, cool and soft; bright/crisp sound
// as light, warm and sharp. Fast, energetic music reads as saturated and warm; slow as muted and cool.
function grade(p: ProgramState, look: Readonly<FrameLook>): void {
  const A = look.synesthesia, bright = p.bright, mood = p.mood;
  const warmth = look.mood ? bright * 0.6 + mood * 0.4 : bright;
  const g = p.grade, tint = g.tint;
  for (let i = 0; i < 3; i++) tint[i] = COOL[i]! + (WARM[i]! - COOL[i]!) * warmth;
  const luma = tint[0]! * 0.299 + tint[1]! * 0.587 + tint[2]! * 0.114;   // tint shifts colour, not brightness
  for (let i = 0; i < 3; i++) tint[i] = 1 + A * (tint[i]! / luma - 1);
  g.exposure = 1 + A * (bright - 0.5) * 0.9;
  g.contrast = 1 + A * (bright - 0.5) * 0.3;
  g.saturation = 1 + A * (mood - 0.5) * 0.8;
}

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
    scene: -1, prevScene: -1, mix: 1, time: 0, bass: 0, mid: 0, high: 0, level: 0, beat: 0, tickPhase: 0, ticks: 0, hue: 0,
    spectrum, bright: 0.5, mood: 0.5,
    grade: { exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
    feedback: 0.86, zoom: 1, rotation: 0, hueDrift: 0, warp: 0, aberration: 0, master: 1,
  };
}

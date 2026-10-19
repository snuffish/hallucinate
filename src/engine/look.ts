// How the sound and a look become one output's frame. The main screen, the pinned Live slot and the
// studio's Preview monitor each compose their frame here, with their own look and their own motion, so
// Preview shows exactly what Take puts on Live, and Live keeps a show scene's look while the main sliders
// move. Every rule from the sound to the picture lives here: reactivity, the clock's pace, the hue's walk,
// the synesthesia grade, the trails' afterglow and fringing.

import { WHEEL, type Palette } from '../state/app-state';
import { NO_EFFECTS, type EffectStack } from './effects';
import { PALETTE_FLOATS, packPalette } from './laser-colour';
import type { Hearing } from './listener';
import type { ProgramState } from './renderer';
import { stillHearing, type SnapshotUniforms } from './scene-inputs';

// The sliders a frame is composed with: a show scene stores them (LOOK_KEYS); one saved before it kept
// synesthesia takes the app's.
export interface FrameLook {
  reactivity: number; speed: number; cycle: number;
  hue: number; trails: number; aberration: number; synesthesia: number;
  palette?: Readonly<Palette>;   // none: the whole laser wheel
}

// Where an output's picture is in its own time: the clock the shaders see, how fast it runs (it eases
// with the music), how far the hue has walked (and how much further the kicks still move it) and how far
// the effects have turned. Each output keeps one.
export interface Motion { time: number; timeRate: number; huePhase: number; hueKick: number; turn: number }

export const copyMotion = (to: Motion, from: Readonly<Motion>): void => { to.time = from.time; to.timeRate = from.timeRate; to.huePhase = from.huePhase; to.hueKick = from.hueKick; to.turn = from.turn; };

// The effects' turn (uTurn, radians at an effect's full spin): it only ever runs on, at a steady pace
// plus the bass, plus the beat, so each kick leaves it a step further on (the beat fades out within half
// a second: about a fifth of a radian a kick) and nothing it hears can turn it back. Speed scales it all,
// Reactivity the bass's and the kick's share (they arrive scaled).
const TURN = { pace: 0.15, bass: 0.2, beat: 1 } as const;

// How far a kick moves the hue at Colour cycling 1, and how it gets there: eased in with this time constant
// (about 95% within 150 ms), so a kick never changes the colour in one frame.
const KICK_HUE = 0.05;
const KICK_HUE_SECONDS = 0.05;

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
  // Colour cycling sets both the hue's walk and how far a kick moves it, so at 0 the colour holds.
  if (h.kick) motion.hueKick += look.cycle * KICK_HUE;
  const kicked = motion.hueKick * (1 - Math.exp(-dt / KICK_HUE_SECONDS));
  motion.hueKick -= kicked;
  motion.huePhase += look.cycle * dt * 0.06 + kicked;
  motion.turn += dt * look.speed * (TURN.pace + TURN.bass * bass + TURN.beat * beat);

  p.time = motion.time;
  p.turn = motion.turn;
  p.bass = bass; p.mid = mid; p.high = high; p.level = level; p.beat = beat;
  p.tickPhase = h.tickPhase; p.ticks = h.ticks;
  p.bright = h.bright;
  p.mood = h.mood;
  grade(p, look);
  // Trails are an afterglow: the previous frame fades in place by this much. Dark sound lingers (longer
  // trails), bright sound is crisp (shorter trails, more fringing).
  const s = look.synesthesia;
  p.hue = look.hue + motion.huePhase;
  packPalette(p.palette, look.palette ?? WHEEL);
  p.feedback = Math.min(0.97, look.trails * sceneTrails * (1 + s * (0.5 - p.bright) * 0.12));
  p.aberration = look.aberration * (1 + p.beat * 1.5) * (1 + s * (p.bright - 0.5) * 1.2);
}

// Crossmodal correspondences: dark/muffled sound reads as dim, cool and soft; bright/crisp sound
// as light, warm and sharp. Fast, energetic music reads as saturated and warm; slow as muted and cool.
function grade(p: ProgramState, look: Readonly<FrameLook>): void {
  const A = look.synesthesia, bright = p.bright, mood = p.mood;
  const warmth = bright * 0.6 + mood * 0.4;
  const g = p.grade, tint = g.tint;
  for (let i = 0; i < 3; i++) tint[i] = COOL[i]! + (WARM[i]! - COOL[i]!) * warmth;
  const luma = tint[0]! * 0.299 + tint[1]! * 0.587 + tint[2]! * 0.114;   // tint shifts colour, not brightness
  for (let i = 0; i < 3; i++) tint[i] = 1 + A * (tint[i]! / luma - 1);
  g.exposure = 1 + A * (bright - 0.5) * 0.9;
  g.contrast = 1 + A * (bright - 0.5) * 0.3;
  g.saturation = 1 + A * (mood - 0.5) * 0.8;
}

// A still frame with a Look applied, as the audience would see it: a short burst of frames with the same
// sound, so the afterglow builds up as it does on screen. The burst ends at the inputs' time, and the
// effects' turn there too (so a still turns an effect only as far as uTime says); the hue
// starts at theirs and walks as Colour cycling says. A kick (uBeat 1) lands on the last frame, as the
// moment it happens. With `then`, one more frame follows with those inputs: the change from the burst's
// last frame to it is one frame's change on screen (the strobe rule's). Every frame is drawn with
// `effects`. The renderer draws the frames in order and keeps the last.
export const BURST_FRAMES = 20;   // a third of a second: long enough for the strongest Look's afterglow to settle
const BURST_DT = 1 / 60;

export function composeStill(scene: number, inputs: Readonly<SnapshotUniforms>, look: Readonly<FrameLook>, sceneTrails: number, spectrum: Uint8Array, then?: Readonly<SnapshotUniforms>, effects: EffectStack = NO_EFFECTS): ProgramState[] {
  const sounds = Array.from({ length: BURST_FRAMES }, (_, i) => stillHearing(inputs, !then && i === BURST_FRAMES - 1 && inputs.uBeat >= 1));
  if (then) sounds.push(stillHearing(then, then.uBeat >= 1));
  const play = (motion: Motion): ProgramState[] => sounds.map((h) => {
    const p = { ...programState(spectrum), scene, prevScene: -1, mix: 1, effects };
    composeFrame(p, motion, h, look, sceneTrails, BURST_DT);
    return p;
  });
  const start = (): Motion => ({ time: 0, timeRate: look.speed, huePhase: inputs.uHue, hueKick: 0, turn: 0 });
  const elapsed = play(start()).at(-1)!;   // the clock's pace eases with the sound: measure it, then start early by that much
  const end = (then ?? inputs).uTime;
  return play({ ...start(), time: end - elapsed.time, turn: end - elapsed.turn });
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
    scene: -1, prevScene: -1, effects: NO_EFFECTS, prevEffects: NO_EFFECTS, mix: 1, time: 0, turn: 0, bass: 0, mid: 0, high: 0, level: 0, beat: 0, tickPhase: 0, ticks: 0, hue: 0,
    palette: new Float32Array(PALETTE_FLOATS), spectrum, bright: 0.5, mood: 0.5,
    grade: { exposure: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
    feedback: 0.86, aberration: 0, master: 1,
  };
}

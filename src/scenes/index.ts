// The built-in scenes. Each lives in its own module in this folder and is listed here, in key order:
// the first ten scenes in the list get the number keys 1–0. Adding a scene is its module plus one line
// here; e2e/builtin-scenes.spec.ts then checks it against the laser-show checklist (ADR 0001).

import type { Scene } from './scene';
import { BEAM_FAN } from './beam-fan';
import { SPECTRUM_RAYS } from './spectrum-rays';

export { COMMON } from './header';
export { TEMPLATE } from './template';
export { CATEGORIES, scene, type Scene, type SceneExtra, type SceneKind } from './scene';

export const SCENES: readonly Scene[] = [
  BEAM_FAN,      // 1
  SPECTRUM_RAYS, // 5
];

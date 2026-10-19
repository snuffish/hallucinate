// The built-in scenes. Each lives in its own module in this folder and is listed here, in key order:
// the first ten scenes in the list get the number keys 1–0. Adding a scene is its module plus one line
// here; e2e/builtin-scenes.spec.ts then checks it against the laser-show checklist (ADR 0001).

import type { Scene } from './scene';
import { BEAM_FAN } from './beam-fan';
import { LIGHT_SHEET } from './light-sheet';
import { RING_RUN } from './ring-run';
import { WIRE_SOLID } from './wire-solid';
import { SPECTRUM_RAYS } from './spectrum-rays';
import { CONTOUR_LINES } from './contour-lines';
import { POINT_STORM } from './point-storm';
import { SCAN_TRACE } from './scan-trace';
import { LISSAJOUS } from './lissajous';
import { SCOPE_RING } from './scope-ring';
import { CONSTELLATION } from './constellation';
import { VORTEX } from './vortex';

export { COMMON } from './header';
export { TEMPLATE } from './template';
export { CATEGORIES, scene, userSceneId, type Scene, type SceneExtra, type SceneKind } from './scene';

export const SCENES: readonly Scene[] = [
  WIRE_SOLID,    // 1
  BEAM_FAN,      // 2
  LIGHT_SHEET,   // 3
  RING_RUN,      // 4
  SPECTRUM_RAYS, // 5
  CONTOUR_LINES, // 6
  POINT_STORM,   // 7
  SCAN_TRACE,    // 8
  LISSAJOUS,     // 9
  SCOPE_RING,    // 0
  CONSTELLATION,
  VORTEX,
];

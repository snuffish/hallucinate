// The built-in scenes. Each lives in its own module in this folder and is listed here, in key order:
// the first ten scenes in the list get the number keys 1–0. There are none yet (ADR 0001).

import type { Scene } from './scene';

export { COMMON } from './header';
export { TEMPLATE } from './template';
export { CATEGORIES, scene, type Scene, type SceneExtra, type SceneKind } from './scene';

export const SCENES: readonly Scene[] = [];

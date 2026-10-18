import { parseParams, type ParamSpec } from '../engine/params';
import { COMMON } from './header';

export type SceneKind = 'custom' | 'nodes';

// One entry of the shared scene list. Scenes are addressed by their INDEX in that list everywhere
// (renderer, projector protocol, number keys), so entries are soft-removed with `removed`, never spliced.
export interface Scene {
  id: string;          // stable key for React lists
  name: string;
  cat: string;
  desc: string;
  body: string;        // the editable code (after the shared header)
  frag: string;        // COMMON + code, with @param lines rewritten to uniforms
  params: ParamSpec[];
  kind?: SceneKind;
  trails?: number;     // per-scene cap on the trails slider
  original?: string;   // built-in scenes: the shipped code, for Revert
  edited?: boolean;    // built-in scenes: the user replaced the code
  user?: boolean;      // saved from the editor / assistant
  removed?: boolean;   // soft-deleted from the library
}

export interface SceneExtra { kind?: SceneKind; trails?: number }

// The library's category tabs, in order. A tab shows only when it has scenes.
export const CATEGORIES: readonly string[] = ['Beams', 'Geometry', 'Fields', 'Signals', 'Media'];

// The id of one of your saved scenes (also its `paramKey`, so stored values and the last-scene mark use it).
export const userSceneId = (name: string): string => `user:${name}`;

// A built-in scene from its shader body. cat/desc are shown in the scene library.
export function scene(name: string, cat: string, desc: string, body: string, extra: SceneExtra = {}): Scene {
  const { code, params } = parseParams(body);
  return { id: `builtin:${name}`, name, cat, desc, body: body.trim() + '\n', frag: COMMON + code, params, ...extra };
}

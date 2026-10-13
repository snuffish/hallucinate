// Browser implementations of the shared tool definitions (API-key backend): TanStack runs these in
// the browser when the model calls them and resumes the server with the result.

import type { AssistantContext } from './executor';
import { createScene, getAppState, lookAtScene, readSceneCode, setLook, setParameters, switchScene, writeSceneCode } from './tools';

type Ctx = { context: AssistantContext };
const run = (name: string) => async (input: unknown, ctx?: Ctx) => ctx!.context.run(name, (input ?? {}) as Record<string, unknown>);

export const clientTools = [
  getAppState.client<AssistantContext>(async (input, ctx) => run('get_app_state')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  readSceneCode.client<AssistantContext>(async (input, ctx) => run('read_scene_code')(input, ctx as Ctx) as Promise<string>),
  writeSceneCode.client<AssistantContext>(async (input, ctx) => run('write_scene_code')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  createScene.client<AssistantContext>(async (input, ctx) => run('create_scene')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  setParameters.client<AssistantContext>(async (input, ctx) => run('set_parameters')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  setLook.client<AssistantContext>(async (input, ctx) => run('set_look')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  switchScene.client<AssistantContext>(async (input, ctx) => run('switch_scene')(input, ctx as Ctx) as Promise<Record<string, unknown>>),
  lookAtScene.client<AssistantContext>(async (input, ctx) => run('look_at_scene')(input, ctx as Ctx) as Promise<never>),
];

// Browser implementations of the shared tool definitions (API-key backend): TanStack runs these in
// the browser when the model calls them and resumes the server with the result.

import type { AssistantContext } from './executor';
import { addShowScene, createScene, getAppState, getShow, lookAtScene, readSceneCode, removeShowScene, reorderShow, setAutopilot, setAutopilotPlan, setLook, setParameters, setTransition, switchScene, takeShowScene, updateShowScene, writeSceneCode } from './tools';

type Ctx = { context: AssistantContext };
type Out = Promise<Record<string, unknown>>;
const run = (name: string) => async (input: unknown, ctx?: Ctx) => ctx!.context.run(name, (input ?? {}) as Record<string, unknown>);

export const clientTools = [
  getAppState.client<AssistantContext>(async (input, ctx) => run('get_app_state')(input, ctx as Ctx) as Out),
  readSceneCode.client<AssistantContext>(async (input, ctx) => run('read_scene_code')(input, ctx as Ctx) as Promise<string>),
  writeSceneCode.client<AssistantContext>(async (input, ctx) => run('write_scene_code')(input, ctx as Ctx) as Out),
  createScene.client<AssistantContext>(async (input, ctx) => run('create_scene')(input, ctx as Ctx) as Out),
  setParameters.client<AssistantContext>(async (input, ctx) => run('set_parameters')(input, ctx as Ctx) as Out),
  setLook.client<AssistantContext>(async (input, ctx) => run('set_look')(input, ctx as Ctx) as Out),
  switchScene.client<AssistantContext>(async (input, ctx) => run('switch_scene')(input, ctx as Ctx) as Out),
  lookAtScene.client<AssistantContext>(async (input, ctx) => run('look_at_scene')(input, ctx as Ctx) as Promise<never>),
  getShow.client<AssistantContext>(async (input, ctx) => run('get_show')(input, ctx as Ctx) as Out),
  addShowScene.client<AssistantContext>(async (input, ctx) => run('add_show_scene')(input, ctx as Ctx) as Out),
  updateShowScene.client<AssistantContext>(async (input, ctx) => run('update_show_scene')(input, ctx as Ctx) as Out),
  reorderShow.client<AssistantContext>(async (input, ctx) => run('reorder_show')(input, ctx as Ctx) as Out),
  removeShowScene.client<AssistantContext>(async (input, ctx) => run('remove_show_scene')(input, ctx as Ctx) as Out),
  setTransition.client<AssistantContext>(async (input, ctx) => run('set_transition')(input, ctx as Ctx) as Out),
  setAutopilot.client<AssistantContext>(async (input, ctx) => run('set_autopilot')(input, ctx as Ctx) as Out),
  setAutopilotPlan.client<AssistantContext>(async (input, ctx) => run('set_autopilot_plan')(input, ctx as Ctx) as Out),
  takeShowScene.client<AssistantContext>(async (input, ctx) => run('take_show_scene')(input, ctx as Ctx) as Out),
];

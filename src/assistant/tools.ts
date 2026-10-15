// Tools the in-app assistant can use, defined once with zod and shared by the server (which hands
// the schemas to Claude) and the browser (which runs them against the renderer, editors and library).

import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { PlanSchema } from '../state/show-plan';

const sceneName = z.string().describe('Exact scene name. Omit for the scene on screen.');
const record = z.record(z.string(), z.unknown());
const cueRef = z.string().describe('A show scene: its id, or its exact name (get_show lists both).');
const cueValues = z.record(z.string(), z.unknown()).describe('Parameter values for the show scene\'s scene (name or label → number, true/false, "#rrggbb", or an array). Omitted parameters keep the scene\'s defaults.');
const cueLook = z.record(z.string(), z.number()).describe('Look sliders stored with the show scene: hue 0-1, cycle 0-2, trails 0-0.97, speed 0-2.5, reactivity 0-2, aberration 0-0.04.');

// A picture the tool hands back to the model, in TanStack's content-part shape.
export const ImagePartSchema = z.object({
  type: z.literal('image'),
  source: z.object({ type: z.literal('data'), value: z.string(), mimeType: z.string() }),
});
export const TextPartSchema = z.object({ type: z.literal('text'), content: z.string() });
export const ContentPartsSchema = z.array(z.union([TextPartSchema, ImagePartSchema]));
export type ContentParts = z.infer<typeof ContentPartsSchema>;

export const getAppState = toolDefinition({
  name: 'get_app_state',
  description: 'Get what is on screen now: the playing scene (name, kind, live parameters and their values), the look sliders, the audio source, BPM and mood, whether media is loaded, and the list of every scene (name, category, kind, number of parameters, whether the user edited it). Call this when you need to know the current situation or the exact scene names.',
  inputSchema: z.object({}),
  outputSchema: record,
});

export const readSceneCode = toolDefinition({
  name: 'read_scene_code',
  description: 'Read the GLSL code of a scene (the body after the shared header). Defaults to the scene on screen. Always read a scene before editing it.',
  inputSchema: z.object({ scene: sceneName.optional() }),
  outputSchema: z.string(),
});

export const writeSceneCode = toolDefinition({
  name: 'write_scene_code',
  description: 'Replace the code of an existing scene and show it. The code compiles immediately: on success it runs live and is saved (edits to built-in scenes are kept as the user\'s version and can be reverted; the user can also undo your change from the assistant panel); on failure the previous version keeps running and the compile errors are returned with line numbers so you can fix them. Send the complete code, never a fragment. Scenes made in the visual maker are read-only here.',
  inputSchema: z.object({
    scene: sceneName.optional(),
    code: z.string().describe('The complete scene code: optional top-level declarations (constants, @param and // @group lines, functions), then void main() writing fragColor.'),
  }),
  outputSchema: record,
});

export const createScene = toolDefinition({
  name: 'create_scene',
  description: 'Create a new scene in the user\'s library (category "Mine") and play it. Use this for new ideas instead of overwriting an existing scene. Returns compile errors with line numbers if the code does not compile (nothing is created then).',
  inputSchema: z.object({
    name: z.string().describe('A short, unique scene name, e.g. "Neon Tide".'),
    code: z.string().describe('The complete scene code.'),
  }),
  outputSchema: record,
});

export const setParameters = toolDefinition({
  name: 'set_parameters',
  description: 'Set live parameters (the scene\'s @param controls) of the scene on screen. Keys are parameter names, labels, or "Group/Label" when a label repeats across groups. Numbers for sliders, true/false for checkboxes, "#rrggbb" for colours, arrays of numbers for vec2/vec3/vec4. Returns the values now in effect.',
  inputSchema: z.object({ values: z.record(z.string(), z.unknown()).describe('Map of parameter name (or label, or "Group/Label") to value.') }),
  outputSchema: record,
});

const lookKeys = ['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration', 'synesthesia'] as const;
export const setLook = toolDefinition({
  name: 'set_look',
  description: 'Adjust the global look sliders that apply to every scene. hue 0-1 (colour shift), cycle 0-2 (colour cycling speed), trails 0-0.97 (motion trails), speed 0-2.5 (animation speed), reactivity 0-2 (how strongly visuals follow the music), aberration 0-0.04 (colour fringing), synesthesia 0-1 (how much the sound\'s tone tints the colours).',
  inputSchema: z.object(Object.fromEntries(lookKeys.map((k) => [k, z.number().optional()])) as Record<(typeof lookKeys)[number], z.ZodOptional<z.ZodNumber>>),
  outputSchema: record,
});

export const switchScene = toolDefinition({
  name: 'switch_scene',
  description: 'Play another scene by its exact name (crossfades to it).',
  inputSchema: z.object({ scene: z.string().describe('Exact scene name.') }),
  outputSchema: record,
});

export const lookAtScene = toolDefinition({
  name: 'look_at_scene',
  description: 'Render a still frame of a scene and see it as an image, to check your work. It uses the scene\'s current parameter values and stand-in audio (moderate bass/mid/high, a soft beat), so audio-driven detail shows. Use it after creating or changing a scene. Several times show motion.',
  inputSchema: z.object({
    scene: sceneName.optional(),
    times: z.array(z.number()).optional().describe('Clock values in seconds to render (1-3 frames, default [14]).'),
  }),
  outputSchema: ContentPartsSchema,
});

// ---------- The Studio (show scenes, Take, autopilot) ----------

export const getShow = toolDefinition({
  name: 'get_show',
  description: 'Get the show in the studio: every show scene (id, name, which scene, category, whether its scene still exists), which one is in Preview and which is Live, the transition (cut/fade, seconds), the autopilot (on/off, beats per scene, beats gone and to go) and the current plan, plus whether the user changed the show by hand recently. Call this before editing the show or writing a plan.',
  inputSchema: z.object({}),
  outputSchema: record,
});

export const addShowScene = toolDefinition({
  name: 'add_show_scene',
  description: 'Add a show scene to the show: a library scene plus optional parameter values and look sliders. It becomes the Preview. Returns the new show scene with its id.',
  inputSchema: z.object({
    scene: z.string().describe('Exact library scene name (get_app_state lists them).'),
    name: z.string().optional().describe('Name shown in the show list; defaults to the scene name.'),
    values: cueValues.optional(),
    look: cueLook.optional(),
  }),
  outputSchema: record,
});

export const updateShowScene = toolDefinition({
  name: 'update_show_scene',
  description: 'Change a show scene: its name, which library scene it plays, its parameter values (merged into the stored ones) or its look sliders (merged). What is Live changes at the next take, not immediately.',
  inputSchema: z.object({
    cue: cueRef,
    name: z.string().optional(),
    scene: z.string().optional().describe('Exact library scene name.'),
    values: cueValues.optional(),
    look: cueLook.optional(),
  }),
  outputSchema: record,
});

export const reorderShow = toolDefinition({
  name: 'reorder_show',
  description: 'Put the show scenes in a new order. List every show scene id exactly once, in the order they should play. The list-order autopilot follows this order; a plan does not need it.',
  inputSchema: z.object({ order: z.array(z.string()).min(1).describe('All show scene ids, in the new order.') }),
  outputSchema: record,
});

export const removeShowScene = toolDefinition({
  name: 'remove_show_scene',
  description: 'Remove a show scene from the show (the library scene itself stays).',
  inputSchema: z.object({ cue: cueRef }),
  outputSchema: record,
});

export const setTransition = toolDefinition({
  name: 'set_transition',
  description: 'Set how takes transition: a cut or a fade, and the fade length in seconds (0.2-8).',
  inputSchema: z.object({ mode: z.enum(['cut', 'fade']).optional(), seconds: z.number().min(0.2).max(8).optional() }),
  outputSchema: record,
});

export const setAutopilot = toolDefinition({
  name: 'set_autopilot',
  description: 'Turn the autopilot on or off, and set its clock: "beats" counts tempo beats (16, 32, 64 or 128 per show scene when there is no plan; plan steps bring their own counts) on a tempo clock that keeps going through breakdowns; "seconds" is a plain timer (every N seconds per show scene, plan steps included), for music without a usable beat. The autopilot needs at least two show scenes.',
  inputSchema: z.object({
    on: z.boolean().optional(),
    unit: z.enum(['beats', 'seconds']).optional().describe('What the autopilot counts.'),
    beats: z.union([z.literal(16), z.literal(32), z.literal(64), z.literal(128)]).optional().describe('Beats per show scene in list order (unit "beats").'),
    seconds: z.number().min(5).max(600).optional().describe('Seconds per show scene on the timer (unit "seconds").'),
  }),
  outputSchema: record,
});

export const setAutopilotPlan = toolDefinition({
  name: 'set_autopilot_plan',
  description: 'Replace the autopilot\'s plan: the ordered steps it plays next, each a show scene with how many beats it gets and optionally its own transition. The whole plan is replaced (never appended); if the first step is the show scene that is Live, that step is already playing and its beats count from now, otherwise the plan starts at the next take. The autopilot is turned on. Pass null to drop the plan and follow list order again. Steps whose show scene no longer exists are skipped.',
  inputSchema: z.object({ plan: PlanSchema.nullable() }),
  outputSchema: record,
});

export const takeShowScene = toolDefinition({
  name: 'take_show_scene',
  description: 'Take a show scene live now (Preview → Live with the show\'s transition). Omit the show scene to take what is in Preview. If it is a step of the current plan, the plan continues from there.',
  inputSchema: z.object({ cue: cueRef.optional() }),
  outputSchema: record,
});

export const TOOL_DEFINITIONS = [
  getAppState, readSceneCode, writeSceneCode, createScene, setParameters, setLook, switchScene, lookAtScene,
  getShow, addShowScene, updateShowScene, reorderShow, removeShowScene, setTransition, setAutopilot, setAutopilotPlan, takeShowScene,
] as const;
// What the director gets in its cycles: read the show, write the plan, tweak a show scene's look. It
// never edits code, creates scenes or takes Live by itself.
export const DIRECTOR_TOOLS = [getShow, setAutopilotPlan, updateShowScene] as const;
export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

const cueLabel = (i: Record<string, unknown>) => (typeof i.cue === 'string' ? `"${i.cue}"` : 'a show scene');

// What the panel shows once a tool has run.
export const DONE_VERBS: Record<ToolName, (input: Record<string, unknown>) => string> = {
  get_app_state: () => 'Looked around',
  read_scene_code: (i) => `Read ${(i.scene as string | undefined) ?? 'the scene'}`,
  write_scene_code: (i) => `Edited ${(i.scene as string | undefined) ?? 'the scene'}`,
  create_scene: (i) => `Created "${(i.name as string | undefined) ?? 'a scene'}"`,
  set_parameters: (i) => { const n = Object.keys((i.values as object | undefined) ?? {}).length; return `Set ${n || ''} parameter${n === 1 ? '' : 's'}`.replace('  ', ' '); },
  set_look: () => 'Adjusted the look',
  switch_scene: (i) => `Switched to ${(i.scene as string | undefined) ?? 'a scene'}`,
  look_at_scene: (i) => `Looked at ${(i.scene as string | undefined) ?? 'the scene'}`,
  get_show: () => 'Read the show',
  add_show_scene: (i) => `Added ${(i.name as string | undefined) ?? (i.scene as string | undefined) ?? 'a show scene'} to the show`,
  update_show_scene: (i) => `Changed ${cueLabel(i)}`,
  reorder_show: () => 'Reordered the show',
  remove_show_scene: (i) => `Removed ${cueLabel(i)}`,
  set_transition: (i) => `Transition: ${(i.mode as string | undefined) ?? 'fade'}${typeof i.seconds === 'number' ? ` ${i.seconds} s` : ''}`,
  set_autopilot: (i) => (i.on === false ? 'Autopilot off' : `Autopilot on${i.unit === 'seconds' || typeof i.seconds === 'number' ? `, every ${typeof i.seconds === 'number' ? i.seconds : '…'} s` : typeof i.beats === 'number' ? `, every ${i.beats} beats` : ''}`),
  set_autopilot_plan: (i) => (i.plan ? `Planned ${((i.plan as { steps?: unknown[] }).steps?.length ?? 0)} steps` : 'Dropped the plan'),
  take_show_scene: (i) => `Took ${typeof i.cue === 'string' ? `"${i.cue}"` : 'Preview'} live`,
};

// What the panel shows while a tool runs.
export const VERBS: Record<ToolName, (input: Record<string, unknown>) => string> = {
  get_app_state: () => 'Looking around',
  read_scene_code: (i) => `Reading ${(i.scene as string | undefined) ?? 'the scene'}`,
  write_scene_code: (i) => `Editing ${(i.scene as string | undefined) ?? 'the scene'}`,
  create_scene: (i) => `Creating "${(i.name as string | undefined) ?? 'a scene'}"`,
  set_parameters: () => 'Setting parameters',
  set_look: () => 'Adjusting the look',
  switch_scene: (i) => `Switching to ${(i.scene as string | undefined) ?? 'a scene'}`,
  look_at_scene: (i) => `Looking at ${(i.scene as string | undefined) ?? 'the scene'}`,
  get_show: () => 'Reading the show',
  add_show_scene: () => 'Adding a show scene',
  update_show_scene: (i) => `Changing ${cueLabel(i)}`,
  reorder_show: () => 'Reordering the show',
  remove_show_scene: (i) => `Removing ${cueLabel(i)}`,
  set_transition: () => 'Setting the transition',
  set_autopilot: () => 'Setting the autopilot',
  set_autopilot_plan: () => 'Planning the show',
  take_show_scene: () => 'Taking',
};

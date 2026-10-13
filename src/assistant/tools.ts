// Tools the in-app assistant can use, defined once with zod and shared by the server (which hands
// the schemas to Claude) and the browser (which runs them against the renderer, editors and library).

import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';

const sceneName = z.string().describe('Exact scene name. Omit for the scene on screen.');
const record = z.record(z.string(), z.unknown());

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
    code: z.string().describe('The complete scene code: optional top-level declarations (constants, @param lines, functions), then void main() writing fragColor.'),
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
  description: 'Set live parameters (the scene\'s @param controls) of the scene on screen. Keys are parameter names or labels. Numbers for sliders, true/false for checkboxes, "#rrggbb" for colours, arrays of numbers for vec2/vec3/vec4. Returns the values now in effect.',
  inputSchema: z.object({ values: z.record(z.string(), z.unknown()).describe('Map of parameter name (or label) to value.') }),
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

export const TOOL_DEFINITIONS = [getAppState, readSceneCode, writeSceneCode, createScene, setParameters, setLook, switchScene, lookAtScene] as const;
export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

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
};

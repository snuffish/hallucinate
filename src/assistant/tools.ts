// Tools the in-app assistant can use, each declared once (schema, description, the panel's labels,
// whether the director gets it) and shared by the server (which hands the schemas to Claude) and the
// browser (which runs them against the renderer, editors and library, and labels the calls).

import { toolDefinition, type SchemaInput } from '@tanstack/ai';
import { z } from 'zod';
import { PlanSchema } from '../state/show-plan';

const sceneName = z.string().describe('Exact scene name. Omit for the scene on screen.');
const record = z.record(z.string(), z.unknown());
const cueRef = z.string().describe('A show scene: its id, or its exact name (get_show lists both).');
const cueValues = z.record(z.string(), z.unknown()).describe('Parameter values for the show scene\'s scene (name or label → number, true/false, "#rrggbb", or an array). Omitted parameters keep the scene\'s defaults.');
const cueLook = z.record(z.string(), z.number()).describe('Look sliders stored with the show scene: hue 0-1, cycle 0-2, trails 0-0.97 (afterglow), speed 0-2.5, reactivity 0-2, aberration 0-0.04 (fringing).');

// A picture the tool hands back to the model, in TanStack's content-part shape.
export const ImagePartSchema = z.object({
  type: z.literal('image'),
  source: z.object({ type: z.literal('data'), value: z.string(), mimeType: z.string() }),
});
export const TextPartSchema = z.object({ type: z.literal('text'), content: z.string() });
export const ContentPartsSchema = z.array(z.union([TextPartSchema, ImagePartSchema]));
export type ContentParts = z.infer<typeof ContentPartsSchema>;

// What the panel shows for a call: while it runs, and once it's done. It gets the input as the model
// sent it, which may still be streaming in, so every field may be missing.
type Label = (input: Record<string, unknown>) => string;
const cueLabel = (i: Record<string, unknown>) => (typeof i.cue === 'string' ? `"${i.cue}"` : 'a show scene');
const sceneLabel = (i: Record<string, unknown>) => (i.scene as string | undefined) ?? 'the scene';

// One tool, declared once: its definition for the model, its labels, and whether the director may use
// it. The implementation is in executor.ts (it runs against the app, which the server never loads).
function tool<TInput extends SchemaInput, TOutput extends SchemaInput, TName extends string>(config: {
  name: TName; description: string; inputSchema: TInput; outputSchema: TOutput; running: Label; done: Label; director?: true;
}) {
  const { running, done, director = false, ...definition } = config;
  return { definition: toolDefinition(definition), running, done, director };
}

const lookKeys = ['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration', 'synesthesia'] as const;

export const TOOLS = [
  tool({
    name: 'get_app_state',
    description: 'Get what is on screen now: the playing scene (name, kind, description, live parameters with their ranges and values), the look sliders and switches (autoSwitch: whether the screen moves to another scene by itself; drift: whether the sliders wander; locked: the sliders Randomize and Drift leave alone), the main screen\'s effects (in the order they run), the audio source, BPM, mood and tone, the live levels while music plays (energy, bass, mid, high, 0-1), whether media is loaded, whether Live is pinned and what the screen shows then, and every scene name by category (a mark after a name: * edited by the user, (mine), (visual maker); unmarked ones are built-in). Call this when you need to know the current situation or the exact scene names.',
    inputSchema: z.object({}),
    outputSchema: record,
    running: () => 'Looking around',
    done: () => 'Looked around',
  }),
  tool({
    name: 'read_scene_code',
    description: 'Read the GLSL code of a scene (the body after the shared header). Defaults to the scene on screen. Always read a scene before editing it.',
    inputSchema: z.object({ scene: sceneName.optional() }),
    outputSchema: z.string(),
    running: (i) => `Reading ${sceneLabel(i)}`,
    done: (i) => `Read ${sceneLabel(i)}`,
  }),
  tool({
    name: 'write_scene_code',
    description: 'Replace the code of an existing scene and show it. The code compiles immediately: on success it runs live and is saved (edits to built-in scenes are kept as the user\'s version and can be reverted; the user can also undo your change from the assistant panel); on failure the previous version keeps running and the compile errors are returned with line numbers so you can fix them. Send the complete code, never a fragment. Scenes made in the visual maker are read-only here.',
    inputSchema: z.object({
      scene: sceneName.optional(),
      code: z.string().describe('The complete scene code: optional top-level declarations (constants, @param and // @group lines, functions), then void main() writing fragColor.'),
    }),
    outputSchema: record,
    running: (i) => `Editing ${sceneLabel(i)}`,
    done: (i) => `Edited ${sceneLabel(i)}`,
  }),
  tool({
    name: 'edit_scene_code',
    description: 'Change part of an existing scene\'s code by exact text replacement, and show it. Prefer this over write_scene_code for any change smaller than a rewrite: it costs a fraction of resending the whole scene. Each edit replaces `find`, which must occur exactly once in the code (include enough surrounding text to make it unique), with `replace`; the edits apply in order, each to the result of the one before. Then the code compiles like write_scene_code: on success it runs live and is saved, with the same undo; if an edit doesn\'t match or the result doesn\'t compile, nothing changes and the problem is returned. Scenes made in the visual maker are read-only here.',
    inputSchema: z.object({
      scene: sceneName.optional(),
      edits: z.array(z.object({
        find: z.string().min(1).describe('Exact text from the current code, whitespace included.'),
        replace: z.string().describe('What replaces it (empty deletes it).'),
      })).min(1).describe('Replacements, applied in order.'),
    }),
    outputSchema: record,
    running: (i) => `Editing ${sceneLabel(i)}`,
    done: (i) => { const n = Array.isArray(i.edits) ? i.edits.length : 0; return `Edited ${sceneLabel(i)}${n ? ` (${n} change${n === 1 ? '' : 's'})` : ''}`; },
  }),
  tool({
    name: 'create_scene',
    description: 'Create a new scene in the user\'s library (category "Mine") and play it. Use this for new ideas instead of overwriting an existing scene. Returns compile errors with line numbers if the code does not compile (nothing is created then).',
    inputSchema: z.object({
      name: z.string().describe('A short, unique scene name, e.g. "Neon Tide".'),
      code: z.string().describe('The complete scene code.'),
    }),
    outputSchema: record,
    running: (i) => `Creating "${(i.name as string | undefined) ?? 'a scene'}"`,
    done: (i) => `Created "${(i.name as string | undefined) ?? 'a scene'}"`,
  }),
  tool({
    name: 'set_parameters',
    description: 'Set live parameters (the scene\'s @param controls) of the scene on screen. Keys are parameter names, labels, or "Group/Label" when a label repeats across groups. Numbers for sliders, true/false for checkboxes, "#rrggbb" for colours, arrays of numbers for vec2/vec3/vec4. Returns the values it applied and any keys it couldn\'t.',
    inputSchema: z.object({ values: z.record(z.string(), z.unknown()).describe('Map of parameter name (or label, or "Group/Label") to value.') }),
    outputSchema: record,
    running: () => 'Setting parameters',
    done: (i) => { const n = Object.keys((i.values as object | undefined) ?? {}).length; return `Set ${n || ''} parameter${n === 1 ? '' : 's'}`.replace('  ', ' '); },
  }),
  tool({
    name: 'set_look',
    description: 'Adjust the global look sliders that apply to every scene. hue 0-1 (colour shift), cycle 0-2 (colour cycling speed), trails 0-0.97 (afterglow: how long a line keeps glowing where it was drawn, fading in place; 0 = none), speed 0-2.5 (animation speed), reactivity 0-2 (how strongly visuals follow the music), aberration 0-0.04 (fringing: how far each line splits into red, green and blue copies; 0 = none), synesthesia 0-1 (how much the music tints the colours: the sound\'s tone warms or cools them and the music\'s mood is always part of it; 0 = off).',
    inputSchema: z.object(Object.fromEntries(lookKeys.map((k) => [k, z.number().optional()])) as Record<(typeof lookKeys)[number], z.ZodOptional<z.ZodNumber>>),
    outputSchema: record,
    running: () => 'Adjusting the look',
    done: () => 'Adjusted the look',
  }),
  tool({
    name: 'switch_scene',
    description: 'Play another scene by its exact name (crossfades to it).',
    inputSchema: z.object({ scene: z.string().describe('Exact scene name.') }),
    outputSchema: record,
    running: (i) => `Switching to ${(i.scene as string | undefined) ?? 'a scene'}`,
    done: (i) => `Switched to ${(i.scene as string | undefined) ?? 'a scene'}`,
  }),
  tool({
    name: 'find_scenes',
    description: 'Search the scene library by name, category or description, the way the library\'s search box does. Returns each match\'s name, category, kind, description and number of live parameters. Omit both to list every scene with its description. Use it to pick a scene that fits a request ("something with rings", "a calm one").',
    inputSchema: z.object({
      query: z.string().optional().describe('Words to look for in the name, category or description (case-insensitive).'),
      category: z.string().optional().describe('Only this category, e.g. "Beams".'),
    }),
    outputSchema: record,
    running: (i) => (typeof i.query === 'string' ? `Searching for "${i.query}"` : 'Browsing the library'),
    done: (i) => (typeof i.query === 'string' ? `Searched for "${i.query}"` : 'Browsed the library'),
  }),
  tool({
    name: 'get_help',
    description: 'Read the app\'s own help, the text its ? buttons show, with the keyboard shortcuts for that area. Omit the topic to list the topics. Use it when the user asks how something in the app works, rather than guessing.',
    inputSchema: z.object({ topic: z.string().optional().describe('A topic id from the list (omit to get the list).') }),
    outputSchema: record,
    running: (i) => (typeof i.topic === 'string' ? `Reading the help on ${i.topic}` : 'Opening the help'),
    done: (i) => (typeof i.topic === 'string' ? `Read the help on ${i.topic}` : 'Opened the help'),
  }),
  tool({
    name: 'look_at_scene',
    description: 'Render a still frame of a scene and see it as an image, to check your work. It uses the scene\'s current parameter values and stand-in audio (moderate bass/mid/high, a soft beat), so audio-driven detail shows. Use it after creating or changing a scene. Several times show motion.',
    inputSchema: z.object({
      scene: sceneName.optional(),
      times: z.array(z.number()).optional().describe('Clock values in seconds to render (1-3 frames, default [14]).'),
    }),
    outputSchema: ContentPartsSchema,
    running: (i) => `Looking at ${sceneLabel(i)}`,
    done: (i) => `Looked at ${sceneLabel(i)}`,
  }),
  // ---------- The Studio (show scenes, Take, autopilot) ----------
  tool({
    name: 'get_show',
    description: 'Get the show in the studio: every show scene (id, name, which scene, category, whether its scene still exists, its parameter values, look sliders and effects; you can read effects but not set them yet), which one is in Preview and which is Live, the transition (cut/fade, seconds), the autopilot (on/off, beats per scene, beats gone and to go) and the current plan, plus whether the user changed the show by hand recently. Call this before editing the show or writing a plan.',
    inputSchema: z.object({}),
    outputSchema: record,
    running: () => 'Reading the show',
    done: () => 'Read the show',
    director: true,
  }),
  tool({
    name: 'add_show_scene',
    description: 'Add a show scene to the show: a library scene plus optional parameter values and look sliders. It becomes the Preview. Returns the new show scene with its id.',
    inputSchema: z.object({
      scene: z.string().describe('Exact library scene name (get_app_state lists them).'),
      name: z.string().optional().describe('Name shown in the show list; defaults to the scene name.'),
      values: cueValues.optional(),
      look: cueLook.optional(),
    }),
    outputSchema: record,
    running: () => 'Adding a show scene',
    done: (i) => `Added ${(i.name as string | undefined) ?? (i.scene as string | undefined) ?? 'a show scene'} to the show`,
  }),
  tool({
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
    running: (i) => `Changing ${cueLabel(i)}`,
    done: (i) => `Changed ${cueLabel(i)}`,
    director: true,
  }),
  tool({
    name: 'reorder_show',
    description: 'Put the show scenes in a new order. List every show scene id exactly once, in the order they should play. The list-order autopilot follows this order; a plan does not need it.',
    inputSchema: z.object({ order: z.array(z.string()).min(1).describe('All show scene ids, in the new order.') }),
    outputSchema: record,
    running: () => 'Reordering the show',
    done: () => 'Reordered the show',
  }),
  tool({
    name: 'remove_show_scene',
    description: 'Remove a show scene from the show (the library scene itself stays).',
    inputSchema: z.object({ cue: cueRef }),
    outputSchema: record,
    running: (i) => `Removing ${cueLabel(i)}`,
    done: (i) => `Removed ${cueLabel(i)}`,
  }),
  tool({
    name: 'set_transition',
    description: 'Set how takes transition: a cut or a fade, and the fade length in seconds (0.2-8).',
    inputSchema: z.object({ mode: z.enum(['cut', 'fade']).optional(), seconds: z.number().min(0.2).max(8).optional() }),
    outputSchema: record,
    running: () => 'Setting the transition',
    done: (i) => `Transition: ${(i.mode as string | undefined) ?? 'fade'}${typeof i.seconds === 'number' ? ` ${i.seconds} s` : ''}`,
  }),
  tool({
    name: 'set_autopilot',
    description: 'Turn the autopilot on or off, and set its clock: "beats" counts tempo beats (16, 32, 64 or 128 per show scene when there is no plan; plan steps bring their own counts) on a tempo clock that keeps going through breakdowns; "seconds" is a plain timer (every N seconds per show scene, plan steps included), for music without a usable beat. The autopilot needs at least two show scenes.',
    inputSchema: z.object({
      on: z.boolean().optional(),
      unit: z.enum(['beats', 'seconds']).optional().describe('What the autopilot counts.'),
      beats: z.union([z.literal(16), z.literal(32), z.literal(64), z.literal(128)]).optional().describe('Beats per show scene in list order (unit "beats").'),
      seconds: z.number().min(5).max(600).optional().describe('Seconds per show scene on the timer (unit "seconds").'),
    }),
    outputSchema: record,
    running: () => 'Setting the autopilot',
    done: (i) => (i.on === false ? 'Autopilot off' : `Autopilot on${i.unit === 'seconds' || typeof i.seconds === 'number' ? `, every ${typeof i.seconds === 'number' ? i.seconds : '…'} s` : typeof i.beats === 'number' ? `, every ${i.beats} beats` : ''}`),
  }),
  tool({
    name: 'set_autopilot_plan',
    description: 'Replace the autopilot\'s plan: the ordered steps it plays next, each a show scene with how many beats it gets and optionally its own transition. The whole plan is replaced (never appended); if the first step is the show scene that is Live, that step is already playing and its beats count from now, otherwise the plan starts at the next take. The autopilot is turned on. Pass null to drop the plan and follow list order again. Steps whose show scene no longer exists are skipped. While the tempo is known, a step\'s maxSeconds is raised to fit its beats.',
    inputSchema: z.object({ plan: PlanSchema.nullable() }),
    outputSchema: record,
    running: () => 'Planning the show',
    done: (i) => (i.plan ? `Planned ${((i.plan as { steps?: unknown[] }).steps?.length ?? 0)} steps` : 'Dropped the plan'),
    director: true,
  }),
  tool({
    name: 'take_show_scene',
    description: 'Take a show scene live now (Preview → Live with the show\'s transition). Omit the show scene to take what is in Preview. If it is a step of the current plan, the plan continues from there.',
    inputSchema: z.object({ cue: cueRef.optional() }),
    outputSchema: record,
    running: () => 'Taking',
    done: (i) => `Took ${typeof i.cue === 'string' ? `"${i.cue}"` : 'Preview'} live`,
  }),
] as const;

type Tools = typeof TOOLS;
export type ToolName = Tools[number]['definition']['name'];
type Definitions<T extends readonly unknown[]> = { readonly [K in keyof T]: T[K] extends { definition: infer D } ? D : never };
export const TOOL_DEFINITIONS = TOOLS.map((t) => t.definition) as unknown as Definitions<Tools>;
// What the director gets in its cycles: read the show, write the plan, tweak a show scene's look. It
// never edits code, creates scenes or takes Live by itself.
export const DIRECTOR_TOOLS = TOOLS.filter((t) => t.director).map((t) => t.definition);

const LABELS = new Map<string, Tools[number]>(TOOLS.map((t) => [t.definition.name, t]));
// The panel's label for a call, while it runs or once it's done; an unknown tool shows its name.
export function toolLabel(name: string, input: Record<string, unknown>, done: boolean): string {
  const t = LABELS.get(name);
  return t ? (done ? t.done : t.running)(input) : name;
}

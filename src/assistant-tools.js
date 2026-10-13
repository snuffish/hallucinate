// Tools the in-app assistant can use. Plain data, shared by the server (which sends the schemas to
// Claude) and the browser (which runs the tools and checks each call against its schema first).
// eager_input_streaming lets long inputs like shader code stream as they're written; the server
// then no longer validates them, which is why the browser does.

const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'get_app_state',
    description: 'Get what is on screen now: the playing scene (name, kind, live parameters and their values), the look sliders, the audio source, BPM and mood, whether media is loaded, and the list of every scene (name, category, kind, number of parameters, whether the user edited it). Call this when you need to know the current situation or the exact scene names.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_scene_code',
    description: 'Read the GLSL code of a scene (the body after the shared header). Defaults to the scene on screen. Always read a scene before editing it.',
    input_schema: {
      type: 'object',
      properties: { scene: str('Exact scene name. Omit for the scene on screen.') },
      additionalProperties: false,
    },
  },
  {
    name: 'write_scene_code',
    description: 'Replace the code of an existing scene and show it. The code compiles immediately: on success it runs live and is saved (edits to built-in scenes are kept as the user\'s version and can be reverted; the user can also undo your change from the assistant panel); on failure the previous version keeps running and the compile errors are returned with line numbers so you can fix them. Send the complete code, never a fragment. Scenes made in the visual maker are read-only here.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        scene: str('Exact scene name. Omit for the scene on screen.'),
        code: str('The complete scene code: optional top-level declarations (constants, @param lines, functions), then void main() writing fragColor.'),
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_scene',
    description: 'Create a new scene in the user\'s library (category "Mine") and play it. Use this for new ideas instead of overwriting an existing scene. Returns compile errors with line numbers if the code does not compile (nothing is created then).',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        name: str('A short, unique scene name, e.g. "Neon Tide".'),
        code: str('The complete scene code.'),
      },
      required: ['name', 'code'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_parameters',
    description: 'Set live parameters (the scene\'s @param controls) of the scene on screen. Keys are parameter names or labels. Numbers for sliders, true/false for checkboxes, "#rrggbb" for colours, arrays of numbers for vec2/vec3/vec4. Returns the values now in effect.',
    input_schema: {
      type: 'object',
      properties: { values: { type: 'object', description: 'Map of parameter name (or label) to value.' } },
      required: ['values'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_look',
    description: 'Adjust the global look sliders that apply to every scene. hue 0-1 (colour shift), cycle 0-2 (colour cycling speed), trails 0-0.97 (motion trails), speed 0-2.5 (animation speed), reactivity 0-2 (how strongly visuals follow the music), aberration 0-0.04 (colour fringing), synesthesia 0-1 (how much the sound\'s tone tints the colours).',
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(['hue', 'cycle', 'trails', 'speed', 'reactivity', 'aberration', 'synesthesia'].map((k) => [k, { type: 'number' }])),
      additionalProperties: false,
    },
  },
  {
    name: 'switch_scene',
    description: 'Play another scene by its exact name (crossfades to it).',
    input_schema: { type: 'object', properties: { scene: str('Exact scene name.') }, required: ['scene'], additionalProperties: false },
  },
  {
    name: 'look_at_scene',
    description: 'Render a still frame of a scene and see it as an image, to check your work. It uses the scene\'s current parameter values and stand-in audio (moderate bass/mid/high, a soft beat), so audio-driven detail shows. Use it after creating or changing a scene. Several times show motion.',
    input_schema: {
      type: 'object',
      properties: {
        scene: str('Exact scene name. Omit for the scene on screen.'),
        times: { type: 'array', items: { type: 'number' }, description: 'Clock values in seconds to render (1-3 frames, default [14]).' },
      },
      additionalProperties: false,
    },
  },
];

// Small schema check for the browser: types of known properties, required ones present, no extras.
export function validateInput(name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Unknown tool "${name}".`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'The input must be an object.';
  const { properties = {}, required = [] } = tool.input_schema;
  for (const key of required) if (!(key in input)) return `Missing required field "${key}".`;
  for (const [key, value] of Object.entries(input)) {
    const prop = properties[key];
    if (!prop) return `Unknown field "${key}".`;
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (prop.type !== type) return `Field "${key}" must be ${prop.type}, got ${type}.`;
  }
  return null;
}

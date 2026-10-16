// The values every scene's shader reads each frame, one row each: its uniform, where the frame keeps it,
// its name on the visual maker's Audio block, its range, what it means, and the value still frames use.
// Everything that lists them is made from this table: the shader header's declarations (COMMON, which the
// assistant's prompt embeds), the renderer's per-frame values, the Audio block, the editor's cheat sheet,
// the new-scene template and the stand-ins for library thumbnails and the assistant's screenshots.
// Adding an input is one row here, plus its field on ProgramState and the code that fills it.

const BAND = '0…1, up to 1.5 at high reactivity';
const SLOW = '0…1, changes over seconds, not scaled by reactivity';

export const SCENE_INPUTS = [
  { uniform: 'uTime', field: 'time', node: null, range: 'seconds', help: "the music's clock: runs faster when the music is loud", still: 14 },
  { uniform: 'uBass', field: 'bass', node: 'bass', range: BAND, help: 'loudness of the bass; jumps with every hit', still: 0.5 },
  { uniform: 'uMid', field: 'mid', node: 'mid', range: BAND, help: 'loudness of the mids', still: 0.5 },
  { uniform: 'uHigh', field: 'high', node: 'high', range: BAND, help: 'loudness of the highs', still: 0.5 },
  { uniform: 'uLevel', field: 'level', node: 'level', range: BAND, help: 'loudness of the three bands together', still: 0.6 },
  { uniform: 'uBeat', field: 'beat', node: 'beat', range: BAND, help: '1 on each kick, fading out within half a second', still: 0.4 },
  { uniform: 'uTick', field: 'tickPhase', node: 'tick', range: '0…1, back to 0 on each tick', help: "how far through the current tick (one beat of the music's tempo); keeps going through breakdowns, holds still while nothing plays", still: 0.3 },
  { uniform: 'uTicks', field: 'ticks', node: 'ticks', range: 'whole ticks, counting up', help: 'how many ticks so far; mod() it to change things every few beats', still: 6 },
  { uniform: 'uHue', field: 'hue', node: null, range: '0…1, wraps', help: 'the colour slider plus colour cycling', still: 0 },
  { uniform: 'uBright', field: 'bright', node: 'tone', range: SLOW, help: 'the tone: 0 dark, muffled sound … 1 bright, crisp', still: 0.5 },
  { uniform: 'uMood', field: 'mood', node: 'mood', range: SLOW, help: 'the mood: 0 calm … 1 energetic', still: 0.5 },
] as const satisfies readonly { uniform: `u${string}`; field: string; node: string | null; range: string; help: string; still: number }[];

export type SceneInput = (typeof SCENE_INPUTS)[number];
export type InputUniform = SceneInput['uniform'];
export type InputField = SceneInput['field'];

// Stand-in values for still frames (library thumbnails, assistant screenshots), with `over` on top.
export type SnapshotUniforms = Record<InputUniform, number>;
export const stillUniforms = (over: Partial<SnapshotUniforms> = {}): SnapshotUniforms =>
  ({ ...Object.fromEntries(SCENE_INPUTS.map((i) => [i.uniform, i.still])), ...over }) as SnapshotUniforms;

// Writes a frame's inputs into a uniform table (the renderer's, once a frame; no allocation).
export function writeInputs(to: Record<string, unknown>, frame: Readonly<Record<InputField, number>>): void {
  for (const i of SCENE_INPUTS) to[i.uniform] = frame[i.field];
}

// The header's declarations, each with what it means, for the shader and for whoever reads it.
export const INPUT_DECLARATIONS = SCENE_INPUTS.map((i) => `${`uniform float ${i.uniform};`.padEnd(24)}// ${i.help} (${i.range})`).join('\n');

export const INPUT_NAMES = SCENE_INPUTS.map((i) => i.uniform).join(' ');

// The visual maker's Audio block: the inputs that come from the sound, and its help (the outputs that
// share a range say it once).
export const AUDIO_OUTPUTS = SCENE_INPUTS.flatMap((i) => (i.node ? [{ name: i.node, uniform: i.uniform, range: i.range, help: i.help }] : []));
export const AUDIO_HELP = AUDIO_OUTPUTS
  .reduce<(typeof AUDIO_OUTPUTS)[]>((runs, o) => { const run = runs.at(-1); if (run?.[0]!.range === o.range) run.push(o); else runs.push([o]); return runs; }, [])
  .map((run) => `${run.map((o) => `${o.name}: ${o.help}`).join('; ')} (${run[0]!.range})`)
  .join('. ');

// A stand-in spectrum for still frames: falling off towards the treble, and a wavy waveform.
export function stillSpectrum(): Uint8Array {
  const spectrum = new Uint8Array(512);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    spectrum[i * 2] = 255 * Math.min(1, Math.max(0, 0.85 - x * 0.55 + 0.15 * Math.sin(i * 0.21)));
    spectrum[i * 2 + 1] = 128 + 90 * Math.sin(x * 25) * Math.cos(x * 7);
  }
  return spectrum;
}

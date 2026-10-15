// Node types for the visual maker, and the compiler that turns a node graph into GLSL.
// Every node emits one GLSL variable per output: `<type> n<id>_<output> = <expr>;`

import { z } from 'zod';

export type PortType = 'float' | 'vec2' | 'vec3';
export interface NodeInput { name: string; type: PortType; def: number | number[] | string }
export interface NodeOutput { name: string; type: PortType }
export type NodeParamDef =
  | { name: string; kind: 'select'; options: string[]; def: string }
  | { name: string; kind: 'text' | 'color'; def: string }
  | { name: string; kind: 'number'; def: number };
export type NodeParams = Record<string, string | number>;
type Args = Record<string, string>;

export interface NodeType {
  title: string;
  cat: string;
  help?: string;
  lib?: string[];
  params?: NodeParamDef[];
  inputs: NodeInput[];
  outputs: NodeOutput[];
  emit: (args: Args, params: NodeParams, id: number) => Record<string, string>;
  uniform?: (id: number, params: NodeParams) => string;
}

const f = (name: string, def: number): NodeInput => ({ name, type: 'float', def });
const v2 = (name: string): NodeInput => ({ name, type: 'vec2', def: 'uv' });
const v3 = (name: string, def: number[] = [0, 0, 0]): NodeInput => ({ name, type: 'vec3', def });
const out = (name: string, type: PortType): NodeOutput => ({ name, type });
const select = (name: string, options: string[], def: string = options[0]!): NodeParamDef => ({ name, kind: 'select', options, def });
const field = (name: string, kind: 'text' | 'color', def: string): NodeParamDef => ({ name, kind, def });
const numberField = (name: string, def: number): NodeParamDef => ({ name, kind: 'number', def });
const label = (text: string | number | undefined) => String(text ?? '').replace(/["\n]/g, '').trim() || 'Value';

export const CATEGORIES: readonly string[] = ['Input', 'Coordinates', 'Pattern', 'Math', 'Color'];

type Unary = (x: string) => string;
type Binary = (a: string, b: string) => string;
const PALETTES: Record<string, Unary> = {
  rainbow: (t) => `rainbow(${t} + uHue)`,
  neon: (t) => `neon(${t} + uHue)`,
  fire: (t) => `pal(${t} + uHue, vec3(.6, .3, .1), vec3(.5, .35, .2), vec3(1.), vec3(0., .15, .25))`,
  ice: (t) => `pal(${t} + uHue, vec3(.4, .6, .8), vec3(.3), vec3(1.), vec3(.5, .55, .6))`,
  acid: (t) => `pal(${t} + uHue, vec3(.5), vec3(.5), vec3(2., 1., 0.), vec3(.5, .2, .25))`,
};
const MATH: Record<string, Binary> = {
  add: (a, b) => `${a} + ${b}`,
  subtract: (a, b) => `${a} - ${b}`,
  multiply: (a, b) => `${a} * ${b}`,
  divide: (a, b) => `${a} / ${b}`,
  min: (a, b) => `min(${a}, ${b})`,
  max: (a, b) => `max(${a}, ${b})`,
  power: (a, b) => `pow(abs(${a}), ${b})`,
  modulo: (a, b) => `mod(${a}, ${b})`,
};
const FUNCS: Record<string, Unary> = {
  sin: (x) => `sin(${x})`,
  cos: (x) => `cos(${x})`,
  abs: (x) => `abs(${x})`,
  fract: (x) => `fract(${x})`,
  'one minus': (x) => `1. - ${x}`,
  square: (x) => `${x} * ${x}`,
  sqrt: (x) => `sqrt(abs(${x}))`,
  'fade (exp)': (x) => `exp(-${x})`,
  'neon glow': (x) => `pow(.01 / max(abs(${x}), 1e-4), 1.2)`,
};
const BLENDS: Record<string, Binary> = {
  add: (a, b) => `${a} + ${b}`,
  multiply: (a, b) => `${a} * ${b}`,
  screen: (a, b) => `1. - (1. - ${a}) * (1. - ${b})`,
  difference: (a, b) => `abs(${a} - ${b})`,
  lighten: (a, b) => `max(${a}, ${b})`,
};
const pick = <T>(table: Record<string, T>, key: string | number | undefined): T => table[String(key)] ?? Object.values(table)[0]!;

export const NODE_TYPES: Record<string, NodeType> = {
  // ----- Input
  uv: { title: 'UV', cat: 'Input', help: 'Pixel position. (0,0) is the centre.', inputs: [], outputs: [out('p', 'vec2')], emit: () => ({ p: 'centered()' }) },
  time: { title: 'Time', cat: 'Input', help: 'Clock that runs faster when the music is loud.', inputs: [f('speed', 1)], outputs: [out('t', 'float')], emit: (a) => ({ t: `uTime * ${a.speed}` }) },
  audio: {
    title: 'Audio', cat: 'Input', inputs: [],
    help: 'Loudness per band (0 → ~1), a pulse on each beat, tone (0 dark … 1 bright sound) and mood (0 calm … 1 energetic).',
    outputs: ['bass', 'mid', 'high', 'level', 'beat', 'tone', 'mood'].map((n) => out(n, 'float')),
    emit: () => ({ bass: 'uBass', mid: 'uMid', high: 'uHigh', level: 'uLevel', beat: 'uBeat', tone: 'uBright', mood: 'uMood' }),
  },
  number: { title: 'Number', cat: 'Input', inputs: [f('value', 1)], outputs: [out('out', 'float')], emit: (a) => ({ out: a.value! }) },
  spectrum: { title: 'Spectrum', cat: 'Input', help: 'Loudness at x (0 = bass … 1 = treble).', inputs: [f('x', 0.1)], outputs: [out('out', 'float')], emit: (a) => ({ out: `spec(${a.x})` }) },
  slider: {
    title: 'Slider', cat: 'Input',
    help: 'A value you can tweak live from the Parameters overlay while the scene runs.',
    params: [field('label', 'text', 'Amount'), numberField('min', 0), numberField('max', 1), numberField('value', 0.5)],
    inputs: [], outputs: [out('out', 'float')],
    uniform: (id, p) => `uniform float p${id}; // @param min=${glslFloat(p.min)} max=${glslFloat(p.max)} default=${glslFloat(p.value)} label="${label(p.label)}"`,
    emit: (_a, _p, id) => ({ out: `p${id}` }),
  },
  media: {
    title: 'Media', cat: 'Input', help: 'The image or video you dropped in, at position p (a test pattern until you drop one).',
    inputs: [v2('p')], outputs: [out('color', 'vec3'), out('brightness', 'float')],
    emit: (a) => ({ color: `media(${a.p})`, brightness: `luma(media(${a.p}))` }),
  },
  waveform: { title: 'Waveform', cat: 'Input', help: 'Audio waveform at x (0 … 1), −1 … 1.', inputs: [f('x', 0.5)], outputs: [out('out', 'float')], emit: (a) => ({ out: `wave(${a.x})` }) },

  // ----- Coordinates (vec2 -> vec2)
  rotate: { title: 'Rotate', cat: 'Coordinates', inputs: [v2('p'), f('angle', 0)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `rot(${a.angle}) * ${a.p}` }) },
  scale: { title: 'Zoom', cat: 'Coordinates', help: 'Bigger = more zoomed out.', inputs: [v2('p'), f('zoom', 2)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `${a.p} * ${a.zoom}` }) },
  offset: { title: 'Move', cat: 'Coordinates', inputs: [v2('p'), f('x', 0), f('y', 0)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `${a.p} + vec2(${a.x}, ${a.y})` }) },
  kaleido: { title: 'Kaleidoscope', cat: 'Coordinates', lib: ['kaleido'], inputs: [v2('p'), f('segments', 8)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `nk_kaleido(${a.p}, ${a.segments})` }) },
  mirror: { title: 'Mirror', cat: 'Coordinates', inputs: [v2('p')], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `abs(${a.p})` }) },
  repeat: { title: 'Repeat / Tile', cat: 'Coordinates', inputs: [v2('p'), f('count', 4)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `fract(${a.p} * ${a.count} + .5) - .5` }) },
  swirl: { title: 'Swirl', cat: 'Coordinates', lib: ['swirl'], inputs: [v2('p'), f('amount', 3)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `nk_swirl(${a.p}, ${a.amount})` }) },
  warp: { title: 'Liquid warp', cat: 'Coordinates', lib: ['warp'], inputs: [v2('p'), f('amount', 0.3)], outputs: [out('p', 'vec2')], emit: (a) => ({ p: `nk_warp(${a.p}, ${a.amount})` }) },
  kaliFold: {
    title: 'Fractal fold', cat: 'Coordinates', lib: ['kali'],
    help: 'Kali fold p = abs(p)/dot(p,p) − c, six times. Small changes to x/y give wildly different fractals.',
    inputs: [v2('p'), f('x', 0.8), f('y', 0.6)], outputs: [out('p', 'vec2')],
    emit: (a) => ({ p: `nk_kali(${a.p}, vec2(${a.x}, ${a.y}))` }),
  },
  polar: {
    title: 'Polar', cat: 'Coordinates', help: 'Distance from centre and angle (0 … 1 around).', inputs: [v2('p')],
    outputs: [out('radius', 'float'), out('angle', 'float')],
    emit: (a) => ({ radius: `length(${a.p})`, angle: `atan(${a.p}.y, ${a.p}.x) / TAU + .5` }),
  },

  // ----- Pattern (-> float, mostly 0 … 1)
  circle: { title: 'Circle', cat: 'Pattern', inputs: [v2('p'), f('radius', 0.3), f('softness', 0.01)], outputs: [out('out', 'float')], emit: (a) => ({ out: `1. - smoothstep(${a.radius} - ${a.softness}, ${a.radius} + ${a.softness}, length(${a.p}))` }) },
  ring: { title: 'Glow ring', cat: 'Pattern', inputs: [v2('p'), f('radius', 0.3), f('width', 0.01)], outputs: [out('out', 'float')], emit: (a) => ({ out: `${a.width} / (abs(length(${a.p}) - ${a.radius}) + ${a.width})` }) },
  wave: { title: 'Wave', cat: 'Pattern', help: 'Turns a value into repeating bands. Feed it Polar → radius for rings.', inputs: [f('x', 0), f('frequency', 10), f('phase', 0)], outputs: [out('out', 'float')], emit: (a) => ({ out: `sin(${a.x} * ${a.frequency} - ${a.phase}) * .5 + .5` }) },
  stripes: { title: 'Stripes', cat: 'Pattern', inputs: [v2('p'), f('frequency', 20), f('angle', 0)], outputs: [out('out', 'float')], emit: (a) => ({ out: `sin((rot(${a.angle}) * ${a.p}).x * ${a.frequency}) * .5 + .5` }) },
  noise: { title: 'Noise', cat: 'Pattern', inputs: [v2('p'), f('scale', 3)], outputs: [out('out', 'float')], emit: (a) => ({ out: `fbm(${a.p} * ${a.scale})` }) },
  cells: { title: 'Cells', cat: 'Pattern', lib: ['cells'], help: 'Glowing edges of moving cells.', inputs: [v2('p'), f('scale', 4)], outputs: [out('out', 'float')], emit: (a) => ({ out: `nk_cells(${a.p} * ${a.scale})` }) },
  neonFractal: {
    title: 'Neon fractal', cat: 'Pattern', lib: ['neonFractal'],
    help: 'Repeated fract() folding with neon glow rings (kishimisu-style). Outputs a colour.',
    inputs: [v2('p'), f('zoom', 1.5), f('phase', 0)], outputs: [out('color', 'vec3')],
    emit: (a) => ({ color: `nk_neonFractal(${a.p}, ${a.zoom}, ${a.phase})` }),
  },
  checker: { title: 'Checker', cat: 'Pattern', inputs: [v2('p'), f('scale', 6)], outputs: [out('out', 'float')], emit: (a) => ({ out: `mod(floor(${a.p}.x * ${a.scale}) + floor(${a.p}.y * ${a.scale}), 2.)` }) },

  // ----- Math
  math: { title: 'Math', cat: 'Math', params: [select('op', Object.keys(MATH))], inputs: [f('a', 0), f('b', 1)], outputs: [out('out', 'float')], emit: (a, p) => ({ out: pick(MATH, p.op)(a.a!, a.b!) }) },
  func: { title: 'Function', cat: 'Math', params: [select('fn', Object.keys(FUNCS))], inputs: [f('x', 0)], outputs: [out('out', 'float')], emit: (a, p) => ({ out: pick(FUNCS, p.fn)(a.x!) }) },
  threshold: { title: 'Smooth step', cat: 'Math', help: 'Soft 0 → 1 as x goes from "from" to "to".', inputs: [f('x', 0), f('from', 0), f('to', 1)], outputs: [out('out', 'float')], emit: (a) => ({ out: `smoothstep(${a.from}, ${a.to}, ${a.x})` }) },

  // ----- Color
  palette: { title: 'Palette', cat: 'Color', params: [select('preset', Object.keys(PALETTES))], help: 'Turns a number into a colour (repeats every 1.0).', inputs: [f('t', 0)], outputs: [out('color', 'vec3')], emit: (a, p) => ({ color: pick(PALETTES, p.preset)(a.t!) }) },
  colorPicker: {
    title: 'Colour picker', cat: 'Color',
    help: 'A colour you can change live from the Parameters overlay while the scene runs.',
    params: [field('label', 'text', 'Colour'), field('color', 'color', '#4fe3ff')],
    inputs: [], outputs: [out('color', 'vec3')],
    uniform: (id, p) => `uniform vec3 p${id}; // @param color default=${p.color} label="${label(p.label)}"`,
    emit: (_a, _p, id) => ({ color: `p${id}` }),
  },
  color: { title: 'Colour', cat: 'Color', params: [field('color', 'color', '#ff4fd8')], inputs: [], outputs: [out('color', 'vec3')], emit: (_a, p) => ({ color: hexToVec3(String(p.color)) }) },
  brightness: { title: 'Brightness', cat: 'Color', inputs: [v3('color', [1, 1, 1]), f('amount', 1)], outputs: [out('color', 'vec3')], emit: (a) => ({ color: `${a.color} * ${a.amount}` }) },
  mixColor: { title: 'Mix colours', cat: 'Color', inputs: [v3('a'), v3('b', [1, 1, 1]), f('t', 0.5)], outputs: [out('color', 'vec3')], emit: (a) => ({ color: `mix(${a.a}, ${a.b}, ${a.t})` }) },
  blend: { title: 'Blend', cat: 'Color', params: [select('mode', Object.keys(BLENDS))], inputs: [v3('a'), v3('b')], outputs: [out('color', 'vec3')], emit: (a, p) => ({ color: pick(BLENDS, p.mode)(a.a!, a.b!) }) },
  hue: { title: 'Hue shift', cat: 'Color', lib: ['hue'], inputs: [v3('color', [1, 0, 0]), f('shift', 0.1)], outputs: [out('color', 'vec3')], emit: (a) => ({ color: `nk_hue(${a.color}, ${a.shift})` }) },

  // ----- Output
  output: { title: 'Output', cat: 'Output', help: 'The final colour on screen.', inputs: [v3('color')], outputs: [], emit: () => ({}) },
};

const LIBS: Record<string, string> = {
  kaleido: `vec2 nk_kaleido(vec2 p, float n) {
  float s = TAU / max(n, 1.);
  float a = mod(atan(p.y, p.x), s);
  a = abs(a - s * .5);
  return vec2(cos(a), sin(a)) * length(p);
}`,
  swirl: `vec2 nk_swirl(vec2 p, float k) { return rot(k * length(p)) * p; }`,
  warp: `vec2 nk_warp(vec2 p, float k) {
  return p + k * (vec2(fbm(p * 2. + uTime * .1), fbm(p * 2. + 7.3 - uTime * .1)) - .5) * 2.;
}`,
  cells: `float nk_cells(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8., d2 = 8.;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = .5 + .4 * sin(uTime * .5 + TAU * vec2(hash(ip + g), hash(ip + g + 17.)));
      float d = length(g + o - fp);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  return 1. - smoothstep(0., .1, d2 - d1);
}`,
  kali: `vec2 nk_kali(vec2 p, vec2 c) {
  for (int i = 0; i < 6; i++) p = abs(p) / max(dot(p, p), 1e-3) - c;
  return p;
}`,
  neonFractal: `vec3 nk_neonFractal(vec2 uv, float zoom, float phase) {
  vec2 uv0 = uv;
  vec3 col = vec3(0.);
  for (int i = 0; i < 4; i++) {
    uv = fract(uv * zoom) - .5;
    float d = abs(sin(length(uv) * exp(-length(uv0)) * 8. + phase) / 8.);
    col += rainbow(length(uv0) + float(i) * .4 + phase * .4 + uHue) * pow(.01 / max(d, 1e-4), 1.2);
  }
  return min(col * .5, vec3(4.));
}`,
  hue: `vec3 nk_hue(vec3 c, float a) {
  const vec3 k = vec3(.57735);
  float ca = cos(a * TAU);
  return c * ca + cross(k, c) * sin(a * TAU) + k * dot(k, c) * (1. - ca);
}`,
};

// ---------- Graph data ----------

export const GraphNodeSchema = z.object({
  id: z.number(),
  type: z.string().refine((t) => Object.hasOwn(NODE_TYPES, t), { message: 'unknown node type' }),
  x: z.number(),
  y: z.number(),
  values: z.record(z.string(), z.number()).default({}),
  params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export const GraphLinkSchema = z.object({ from: z.number(), out: z.string(), to: z.number(), in: z.string() });
// Wires whose ends don't exist (a block or port that isn't there) are dropped rather than refusing the graph.
export const GraphSchema = z.object({ nodes: z.array(GraphNodeSchema), links: z.array(GraphLinkSchema) }).transform((g) => {
  const types = new Map(g.nodes.map((n) => [n.id, NODE_TYPES[n.type]!]));
  const links = g.links.filter((l) =>
    types.get(l.from)?.outputs.some((o) => o.name === l.out) && types.get(l.to)?.inputs.some((i) => i.name === l.in));
  return links.length === g.links.length ? g : { ...g, links };
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphLink = z.infer<typeof GraphLinkSchema>;
export type Graph = z.infer<typeof GraphSchema>;

export function defaultParams(type: string): NodeParams {
  return Object.fromEntries((NODE_TYPES[type]?.params ?? []).map((p) => [p.name, p.def]));
}

// Mismatched types are converted instead of refused, so any wire "just works".
const CONVERT: Record<string, Unary> = {
  'float>vec2': (x) => `vec2(${x})`,
  'float>vec3': (x) => `vec3(${x})`,
  'vec2>float': (x) => `length(${x})`,
  'vec2>vec3': (x) => `vec3(${x}, 0.)`,
  'vec3>float': (x) => `dot(${x}, vec3(.299, .587, .114))`,
  'vec3>vec2': (x) => `${x}.xy`,
};

function glslFloat(v: string | number | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.';
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.`;
}

function hexToVec3(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `vec3(${[16, 8, 0].map((sh) => glslFloat(((n >> sh) & 255) / 255).slice(0, 5)).join(', ')})`;
}

function literal(input: NodeInput, value: number | undefined): string {
  if (input.type === 'vec2') return 'centered()';
  if (input.type === 'vec3') return `vec3(${(input.def as number[]).map(glslFloat).join(', ')})`;
  return glslFloat(value ?? (input.def as number));
}

// Wrap anything that isn't a plain identifier/number so operator precedence stays right.
const wrap = (expr: string) => (/^[\w.]+$/.test(expr) ? expr : `(${expr})`);

export function compileGraph(graph: Graph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const output = graph.nodes.find((n) => n.type === 'output');
  if (!output) throw new Error('The graph needs an Output node.');

  const lines: string[] = [];
  const uniforms: string[] = [];
  const libs = new Set<string>();
  const done = new Set<number>();
  const visiting = new Set<number>();

  const visit = (node: GraphNode): void => {
    if (done.has(node.id)) return;
    const def = NODE_TYPES[node.type];
    if (!def) throw new Error(`Unknown block type "${node.type}".`);
    if (visiting.has(node.id)) throw new Error(`Loop detected at "${def.title}". Wires can't go in a circle.`);
    visiting.add(node.id);
    const args: Args = {};
    for (const input of def.inputs) {
      const link = graph.links.find((l) => l.to === node.id && l.in === input.name);
      const src = link && byId.get(link.from);
      const srcOut = src && NODE_TYPES[src.type]?.outputs.find((o) => o.name === link.out);
      if (src && link && srcOut) {
        visit(src);
        const name = `n${src.id}_${link.out}`;
        args[input.name] = wrap(srcOut.type === input.type ? name : CONVERT[`${srcOut.type}>${input.type}`]!(name));
      } else {
        args[input.name] = wrap(literal(input, node.values[input.name]));
      }
    }
    const params = { ...defaultParams(node.type), ...node.params };
    const exprs = def.emit(args, params, node.id);
    if (def.uniform) uniforms.push(def.uniform(node.id, params));
    for (const o of def.outputs) lines.push(`  ${o.type} n${node.id}_${o.name} = ${exprs[o.name]};`);
    if (node.type === 'output') lines.push(`  fragColor = vec4(${args.color}, 1.);`);
    def.lib?.forEach((l) => libs.add(l));
    visiting.delete(node.id);
    done.add(node.id);
  };
  visit(output);

  const header = '// Generated by the visual maker\n';
  const live = uniforms.length ? uniforms.join('\n') + '\n\n' : '';   // tweakable in the Parameters overlay
  return header + live + [...libs].map((l) => LIBS[l] + '\n\n').join('') + `void main() {\n${lines.join('\n')}\n}\n`;
}

export function emptyGraph(): Graph {
  return {
    nodes: [
      { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
      { id: 2, type: 'output', x: 500, y: 0, values: {}, params: {} },
    ],
    links: [],
  };
}

// ---------- Example graphs ----------
// links: [fromId, output, toId, input]

type NodeTuple = [id: number, type: string, x: number, y: number, values?: Record<string, number>, params?: NodeParams];
type LinkTuple = [from: number, out: string, to: number, input: string];
export interface Example { name: string; graph: Graph }

const example = (name: string, nodes: NodeTuple[], links: LinkTuple[]): Example => ({
  name,
  graph: {
    nodes: nodes.map(([id, type, x, y, values = {}, params = {}]) => ({ id, type, x, y, values, params: { ...defaultParams(type), ...params } })),
    links: links.map(([from, out, to, input]) => ({ from, out, to, in: input })),
  },
});

export const EXAMPLES: Example[] = [
  example('Kaleido star', [
    [1, 'uv', 0, 0],
    [2, 'kaleido', 220, 0, { segments: 8 }],
    [3, 'time', 220, 200, { speed: 0.5 }],
    [4, 'stripes', 440, 0, { frequency: 30 }],
    [5, 'polar', 220, 360],
    [6, 'time', 440, 420, { speed: 3 }],
    [7, 'wave', 660, 300, { frequency: 30 }],
    [8, 'math', 880, 0, {}, { op: 'multiply' }],
    [9, 'audio', 660, 520],
    [10, 'math', 880, 520, { b: 0.6 }, { op: 'add' }],
    [11, 'math', 1100, 220, {}, { op: 'multiply' }],
    [12, 'palette', 880, 300, {}, { preset: 'rainbow' }],
    [13, 'brightness', 1320, 0],
    [14, 'output', 1540, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'p', 4, 'p'], [3, 't', 4, 'angle'], [1, 'p', 5, 'p'], [5, 'radius', 7, 'x'],
    [6, 't', 7, 'phase'], [4, 'out', 8, 'a'], [7, 'out', 8, 'b'], [9, 'bass', 10, 'a'], [8, 'out', 11, 'a'],
    [10, 'out', 11, 'b'], [5, 'radius', 12, 't'], [12, 'color', 13, 'color'], [11, 'out', 13, 'amount'],
    [13, 'color', 14, 'color'],
  ]),
  example('Lava lamp', [
    [1, 'uv', 0, 0],
    [2, 'warp', 220, 0, { amount: 0.5 }],
    [3, 'noise', 440, 0, { scale: 2.5 }],
    [4, 'math', 660, 0, { b: 2 }, { op: 'multiply' }],
    [5, 'palette', 880, 0, {}, { preset: 'fire' }],
    [6, 'audio', 660, 240],
    [7, 'math', 880, 220, { b: 0.7 }, { op: 'add' }],
    [8, 'brightness', 1100, 0],
    [9, 'output', 1320, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'p', 3, 'p'], [3, 'out', 4, 'a'], [4, 'out', 5, 't'], [6, 'bass', 7, 'a'],
    [5, 'color', 8, 'color'], [7, 'out', 8, 'amount'], [8, 'color', 9, 'color'],
  ]),
  example('Beat grid', [
    [1, 'uv', 0, 0],
    [2, 'time', 0, 160, { speed: 0.3 }],
    [3, 'rotate', 220, 0],
    [4, 'repeat', 440, 0, { count: 5 }],
    [5, 'audio', 220, 220],
    [6, 'math', 440, 220, { b: 0.25 }, { op: 'multiply' }],
    [7, 'math', 660, 240, { b: 0.2 }, { op: 'add' }],
    [8, 'ring', 660, 0, { width: 0.02 }],
    [9, 'polar', 440, 460],
    [10, 'palette', 660, 460, {}, { preset: 'neon' }],
    [11, 'brightness', 880, 0],
    [12, 'output', 1100, 0],
  ], [
    [1, 'p', 3, 'p'], [2, 't', 3, 'angle'], [3, 'p', 4, 'p'], [5, 'beat', 6, 'a'], [6, 'out', 7, 'a'],
    [4, 'p', 8, 'p'], [7, 'out', 8, 'radius'], [1, 'p', 9, 'p'], [9, 'radius', 10, 't'],
    [10, 'color', 11, 'color'], [8, 'out', 11, 'amount'], [11, 'color', 12, 'color'],
  ]),
  example('Hypno spiral', [
    [1, 'uv', 0, 0],
    [2, 'audio', 0, 140],
    [3, 'math', 220, 140, { b: 4 }, { op: 'multiply' }],
    [4, 'math', 440, 140, { b: 6 }, { op: 'add' }],
    [5, 'swirl', 660, 0],
    [6, 'time', 660, 160, { speed: 1 }],
    [7, 'stripes', 880, 0, { frequency: 25 }],
    [8, 'polar', 660, 300],
    [9, 'palette', 880, 300, {}, { preset: 'neon' }],
    [10, 'brightness', 1100, 0],
    [11, 'output', 1320, 0],
  ], [
    [2, 'bass', 3, 'a'], [3, 'out', 4, 'a'], [1, 'p', 5, 'p'], [4, 'out', 5, 'amount'], [5, 'p', 7, 'p'],
    [6, 't', 7, 'angle'], [1, 'p', 8, 'p'], [8, 'radius', 9, 't'], [9, 'color', 10, 'color'], [7, 'out', 10, 'amount'],
    [10, 'color', 11, 'color'],
  ]),
  example('Spectrum halo', [
    [1, 'uv', 0, 0],
    [2, 'polar', 220, 0],
    [3, 'wave', 440, 0, { frequency: 6.283 }],
    [4, 'spectrum', 660, 0],
    [5, 'math', 880, 0, { b: 0.35 }, { op: 'multiply' }],
    [6, 'math', 1100, 0, { b: 0.15 }, { op: 'add' }],
    [7, 'ring', 1320, 0, { width: 0.006 }],
    [8, 'palette', 1100, 200, {}, { preset: 'acid' }],
    [9, 'brightness', 1540, 0],
    [10, 'audio', 660, 200],
    [11, 'math', 880, 260, { b: 0.45 }, { op: 'multiply' }],
    [12, 'ring', 1320, 260, { width: 0.01 }],
    [13, 'blend', 1760, 0, {}, { mode: 'add' }],
    [14, 'output', 1980, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'angle', 3, 'x'], [3, 'out', 4, 'x'], [4, 'out', 5, 'a'], [5, 'out', 6, 'a'],
    [1, 'p', 7, 'p'], [6, 'out', 7, 'radius'], [2, 'angle', 8, 't'], [8, 'color', 9, 'color'], [7, 'out', 9, 'amount'],
    [10, 'beat', 11, 'a'], [1, 'p', 12, 'p'], [11, 'out', 12, 'radius'], [9, 'color', 13, 'a'], [12, 'out', 13, 'b'],
    [13, 'color', 14, 'color'],
  ]),
  example('Disco floor', [
    [1, 'uv', 0, 0],
    [2, 'time', 0, 140, { speed: 0.2 }],
    [3, 'rotate', 220, 0],
    [4, 'checker', 440, 0, { scale: 6 }],
    [5, 'color', 440, 160, {}, { color: '#ff2fa0' }],
    [6, 'color', 440, 280, {}, { color: '#2fe0ff' }],
    [7, 'mixColor', 660, 0],
    [8, 'time', 660, 240, { speed: 0.05 }],
    [9, 'hue', 880, 0],
    [10, 'audio', 660, 380],
    [11, 'math', 880, 380, { b: 0.4 }, { op: 'add' }],
    [12, 'brightness', 1100, 0],
    [13, 'output', 1320, 0],
  ], [
    [1, 'p', 3, 'p'], [2, 't', 3, 'angle'], [3, 'p', 4, 'p'], [5, 'color', 7, 'a'], [6, 'color', 7, 'b'],
    [4, 'out', 7, 't'], [7, 'color', 9, 'color'], [8, 't', 9, 'shift'], [10, 'beat', 11, 'a'],
    [9, 'color', 12, 'color'], [11, 'out', 12, 'amount'], [12, 'color', 13, 'color'],
  ]),
  example('Living cells', [
    [1, 'uv', 0, 0],
    [2, 'warp', 220, 0, { amount: 0.25 }],
    [3, 'cells', 440, 0, { scale: 5 }],
    [4, 'noise', 220, 160, { scale: 2 }],
    [5, 'palette', 440, 160, {}, { preset: 'ice' }],
    [6, 'audio', 440, 300],
    [7, 'math', 660, 300, { b: 0.5 }, { op: 'add' }],
    [8, 'math', 660, 0, {}, { op: 'multiply' }],
    [9, 'brightness', 880, 0],
    [10, 'brightness', 880, 200, { amount: 0.25 }],
    [11, 'blend', 1100, 0, {}, { mode: 'add' }],
    [12, 'output', 1320, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'p', 3, 'p'], [1, 'p', 4, 'p'], [4, 'out', 5, 't'], [6, 'high', 7, 'a'],
    [3, 'out', 8, 'a'], [7, 'out', 8, 'b'], [5, 'color', 9, 'color'], [8, 'out', 9, 'amount'],
    [5, 'color', 10, 'color'], [9, 'color', 11, 'a'], [10, 'color', 11, 'b'], [11, 'color', 12, 'color'],
  ]),
  example('Starburst', [
    [1, 'uv', 0, 0],
    [2, 'polar', 220, 0],
    [3, 'time', 220, 160, { speed: 2 }],
    [4, 'wave', 440, 0, { frequency: 75.4 }],
    [5, 'math', 440, 200, { b: 2.5 }, { op: 'multiply' }],
    [6, 'func', 660, 200, {}, { fn: 'fade (exp)' }],
    [7, 'math', 660, 0, {}, { op: 'multiply' }],
    [8, 'audio', 660, 360],
    [9, 'math', 880, 360, { b: 0.6 }, { op: 'add' }],
    [10, 'math', 880, 0, {}, { op: 'multiply' }],
    [11, 'palette', 880, 180, {}, { preset: 'rainbow' }],
    [12, 'brightness', 1100, 0],
    [13, 'output', 1320, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'angle', 4, 'x'], [3, 't', 4, 'phase'], [2, 'radius', 5, 'a'], [5, 'out', 6, 'x'],
    [4, 'out', 7, 'a'], [6, 'out', 7, 'b'], [8, 'beat', 9, 'a'], [7, 'out', 10, 'a'], [9, 'out', 10, 'b'],
    [2, 'angle', 11, 't'], [11, 'color', 12, 'color'], [10, 'out', 12, 'amount'], [12, 'color', 13, 'color'],
  ]),
  example('Neon fractal', [
    [1, 'uv', 0, 0],
    [2, 'scale', 220, 0, { zoom: 2 }],
    [3, 'time', 220, 160, { speed: 1 }],
    [4, 'neonFractal', 440, 0],
    [5, 'audio', 220, 300],
    [6, 'math', 440, 300, { b: 0.5 }, { op: 'add' }],
    [7, 'brightness', 660, 0],
    [8, 'output', 880, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'p', 4, 'p'], [3, 't', 4, 'phase'], [5, 'level', 6, 'a'],
    [4, 'color', 7, 'color'], [6, 'out', 7, 'amount'], [7, 'color', 8, 'color'],
  ]),
  example('Fractal flower', [
    [1, 'uv', 0, 0],
    [2, 'time', 0, 160, { speed: 0.1 }],
    [3, 'rotate', 220, 0],
    [4, 'kaleido', 440, 0, { segments: 6 }],
    [5, 'audio', 220, 200],
    [6, 'math', 440, 200, { b: 0.1 }, { op: 'multiply' }],
    [7, 'math', 660, 220, { b: 0.75 }, { op: 'add' }],
    [8, 'kaliFold', 660, 0, { y: 0.55 }],
    [9, 'polar', 880, 0],
    [10, 'math', 1100, 180, { b: 2 }, { op: 'multiply' }],
    [11, 'func', 1320, 180, {}, { fn: 'fade (exp)' }],
    [12, 'palette', 1100, 0, {}, { preset: 'rainbow' }],
    [13, 'brightness', 1540, 0],
    [14, 'output', 1760, 0],
  ], [
    [1, 'p', 3, 'p'], [2, 't', 3, 'angle'], [3, 'p', 4, 'p'], [5, 'bass', 6, 'a'], [6, 'out', 7, 'a'],
    [4, 'p', 8, 'p'], [7, 'out', 8, 'x'], [8, 'p', 9, 'p'], [9, 'radius', 10, 'a'], [10, 'out', 11, 'x'],
    [9, 'radius', 12, 't'], [12, 'color', 13, 'color'], [11, 'out', 13, 'amount'], [13, 'color', 14, 'color'],
  ]),
  example('Media warp', [
    [1, 'uv', 0, 0],
    [2, 'kaleido', 220, 0, { segments: 6 }],
    [3, 'slider', 220, 160, {}, { label: 'Warp', min: 0, max: 0.5, value: 0.15 }],
    [4, 'warp', 460, 0],
    [5, 'media', 680, 0],
    [6, 'output', 900, 0],
  ], [
    [1, 'p', 2, 'p'], [2, 'p', 4, 'p'], [3, 'out', 4, 'amount'], [4, 'p', 5, 'p'], [5, 'color', 6, 'color'],
  ]),
];

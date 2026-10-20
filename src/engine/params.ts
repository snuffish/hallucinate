// Live parameters: tag a top-level uniform or constant with `// @param` and it gets a control in the
// Parameters overlay, so it can be tweaked while the scene runs (no recompiling).
//
//   uniform float uGlow;              // @param min=0 max=3 default=1 label="Glow"
//   const float RINGS = 12.;          // @param min=1 max=40 int
//   const vec3 TINT = vec3(1., .3, .8);  // @param color
//   uniform bool uMirror;             // @param default=true
//   uniform vec2 uCentre;             // @param min=-.5 max=.5
//
// Types: float, bool, vec2, vec3, vec4. Options: min, max, step, default, label, int (whole numbers),
// color (vec3 / vec4 as a colour picker), group. Constants are rewritten to uniforms on the same line,
// so compiler error line numbers stay correct.
//
// Groups: a `// @group Name` line puts the params after it under a collapsible heading, until the next
// `@group` (a bare `// @group` ends grouping). `group="Name"` on one `@param` line overrides it.

import { z } from 'zod';
import { KEYS, debouncedWriter, readJSON, type DebouncedWriter } from '../state/persistence';
import { hexToRgb } from './math';

export const ParamTypeSchema = z.enum(['float', 'bool', 'vec2', 'vec3', 'vec4']);
export type ParamType = z.infer<typeof ParamTypeSchema>;

export const ParamValueSchema = z.union([z.number(), z.boolean(), z.array(z.number())]);
export type ParamValue = z.infer<typeof ParamValueSchema>;
export type ParamValues = Record<string, ParamValue>;

const SpecBase = z.object({ name: z.string(), type: ParamTypeSchema, color: z.boolean(), label: z.string(), group: z.string() });   // group '' = ungrouped
const NumericSpec = z.object({ min: z.number(), max: z.number(), step: z.number(), int: z.boolean() });
export const ParamSpecSchema = z.discriminatedUnion('type', [
  SpecBase.extend({ type: z.literal('bool'), def: z.boolean() }),
  SpecBase.extend({ type: z.literal('float'), def: z.number() }).extend(NumericSpec.shape),
  SpecBase.extend({ type: z.literal('vec2'), def: z.array(z.number()).length(2) }).extend(NumericSpec.shape),
  SpecBase.extend({ type: z.literal('vec3'), def: z.array(z.number()).length(3) }).extend(NumericSpec.shape),
  SpecBase.extend({ type: z.literal('vec4'), def: z.array(z.number()).length(4) }).extend(NumericSpec.shape),
]);
export type ParamSpec = z.infer<typeof ParamSpecSchema>;
export type FloatParamSpec = Extract<ParamSpec, { type: 'float' }>;
export type VecParamSpec = Extract<ParamSpec, { type: 'vec2' | 'vec3' | 'vec4' }>;

const DECL = /^(\s*)(uniform|const)\s+(float|bool|vec2|vec3|vec4)\s+(\w+)\s*(?:=\s*([^;]+?))?\s*;\s*\/\/\s*@param\b(.*)$/;
const GROUP = /^\s*\/\/\s*@group\b(.*)$/;
const OPTION = /(\w+)(?:=("[^"]*"|\S+))?/g;
const SIZES: Record<ParamType, number> = { float: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };

export function parseParams(code: string): { code: string; params: ParamSpec[] } {
  const params: ParamSpec[] = [];
  let group = '';
  const lines = code.split('\n').map((line) => {
    const g = GROUP.exec(line);
    if (g) { group = g[1]!.trim(); return line; }
    const m = DECL.exec(line);
    if (!m) return line;
    const indent = m[1]!, kind = m[2]!, type = m[3] as ParamType, name = m[4]!, init = m[5], opts = m[6]!;
    if ((kind === 'uniform') === Boolean(init) || params.some((p) => p.name === name)) return line;   // let the compiler complain
    params.push(makeSpec(type, name, parseOptions(opts), init, group));
    return `${indent}uniform ${type} ${name};`;
  });
  return { code: lines.join('\n'), params };
}

type Options = Record<string, string | true>;

function parseOptions(text: string): Options {
  const o: Options = {};
  for (const [, key, value] of text.matchAll(OPTION)) o[key!] = value === undefined ? true : value.replace(/^"|"$/g, '');
  return o;
}

function makeSpec(type: ParamType, name: string, o: Options, init: string | undefined, current: string): ParamSpec {
  const color = (type === 'vec3' || type === 'vec4') && (o.color === true || String(o.default ?? '').startsWith('#'));
  const label = typeof o.label === 'string' ? o.label : prettify(name);
  const group = typeof o.group === 'string' ? o.group.trim() : current;
  const raw = o.default ?? init;
  if (type === 'bool') return { name, type, color, label, group, def: /^(true|1)$/.test(String(raw ?? '').trim()) };

  const size = SIZES[type];
  const def = parseVector(raw, size) ?? Array<number>(size).fill(color ? 1 : 0);
  const min = num(o.min) ?? Math.min(0, ...def);
  const max = num(o.max) ?? Math.max(1, ...def.map((v) => (v > 1 ? v * 2 : v)));
  const step = num(o.step) ?? (o.int ? 1 : niceStep((max - min) / 200));
  const int = Boolean(o.int);
  if (type === 'float') return { name, type, color, label, group, def: def[0]!, min, max, step, int };
  return { name, type, color, label, group, def, min, max, step, int } as VecParamSpec;
}

// "1.5" · "vec3(1., .3, .8)" · "vec3(.5)" · "1,0.3,0.8" · "#ff4fd8"
function parseVector(raw: string | true | undefined, size: number): number[] | null {
  if (raw == null || raw === true) return null;
  const text = String(raw).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return [...hexToRgb(text), ...(size === 4 ? [1] : [])];
  }
  const nums = text.replace(/^\w*\(|\)$/g, '').split(',').map(num);
  if (nums.some((n) => n === null)) return null;
  const values = nums as number[];
  if (values.length === 1) return Array<number>(size).fill(values[0]!);
  if (values.length !== size) return null;
  return values;
}

function num(v: string | true | undefined | null): number | null {
  if (v == null || v === true) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x) ?? p;
}

// uGlowSize -> "Glow size", RING_COUNT -> "Ring count", p12 -> "p12"
function prettify(name: string): string {
  const words = name.replace(/^u(?=[A-Z])/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The specs as the Parameters list shows them: the ungrouped ones first (no heading), then each group in
// the order it first appears. Groups that share a name are merged.
export interface ParamGroup { name: string; specs: ParamSpec[] }
export function groupParams(specs: readonly ParamSpec[]): ParamGroup[] {
  const groups = new Map<string, ParamSpec[]>([['', []]]);
  for (const s of specs) {
    const list = groups.get(s.group);
    if (list) list.push(s); else groups.set(s.group, [s]);
  }
  return [...groups].filter(([, list]) => list.length).map(([name, list]) => ({ name, specs: list }));
}

// Value as the renderer wants it: number for float/bool, array for vectors.
export type UniformValue = number | number[] | Float32Array;
export function toUniform(spec: ParamSpec, value: ParamValue): UniformValue {
  if (spec.type === 'bool') return value ? 1 : 0;
  return value as number | number[];
}

// The value shape a spec accepts: a stored or incoming value that doesn't fit is replaced by the default.
export function valueSchema(spec: ParamSpec): z.ZodType<ParamValue> {
  if (spec.type === 'bool') return z.boolean();
  if (spec.type === 'float') return z.number();
  return z.array(z.number()).length(SIZES[spec.type]);
}

// Remembers tweaked values per scene. When the code changes a parameter's default, the new default wins.
// Writes are coalesced (a slider drag is hundreds of events) and flushed when the page hides.
const EntrySchema = z.object({ v: ParamValueSchema, def: ParamValueSchema });
export const ParamDataSchema = z.record(z.string(), z.record(z.string(), EntrySchema));
type Data = z.infer<typeof ParamDataSchema>;

export class ParamStore {
  private data: Data;
  private readonly writer: DebouncedWriter;

  constructor() {
    this.data = readJSON(KEYS.params, ParamDataSchema, {});
    this.writer = debouncedWriter(KEYS.params, () => this.data);
  }

  values(key: string, specs: readonly ParamSpec[]): ParamValues {
    const saved = this.data[key] ?? {};
    return Object.fromEntries(specs.map((s) => {
      const entry = saved[s.name];
      const fresh = !entry || JSON.stringify(entry.def) !== JSON.stringify(s.def) || !valueSchema(s).safeParse(entry.v).success;
      return [s.name, fresh ? s.def : entry!.v];
    }));
  }

  set(key: string, spec: ParamSpec, value: ParamValue): void {
    (this.data[key] ??= {})[spec.name] = { v: value, def: spec.def };
    this.writer.schedule();
  }

  // Replace a scene's values (taking a show scene live). Missing values fall back to the defaults.
  setAll(key: string, specs: readonly ParamSpec[], values: ParamValues = {}): void {
    this.data[key] = Object.fromEntries(specs.map((s) => [s.name, { v: values[s.name] ?? s.def, def: s.def }]));
    this.writer.schedule();
  }

  copy(from: string, to: string): void {
    this.data[to] = structuredClone(this.data[from] ?? {});
    this.writer.schedule();
  }

  reset(key: string): void {
    delete this.data[key];
    this.writer.schedule();
  }

  flush(): void { this.writer.flush(); }
  dispose(): void { this.writer.dispose(); }
}

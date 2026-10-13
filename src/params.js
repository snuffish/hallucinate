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
// color (vec3 / vec4 as a colour picker). Constants are rewritten to uniforms on the same line,
// so compiler error line numbers stay correct.

const DECL = /^(\s*)(uniform|const)\s+(float|bool|vec2|vec3|vec4)\s+(\w+)\s*(?:=\s*([^;]+?))?\s*;\s*\/\/\s*@param\b(.*)$/;
const OPTION = /(\w+)(?:=("[^"]*"|\S+))?/g;
const STORAGE_KEY = 'hallucinate.params';
const SIZES = { float: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };

export function parseParams(code) {
  const params = [];
  const lines = code.split('\n').map((line) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const [, indent, kind, type, name, init, opts] = m;
    if ((kind === 'uniform') === Boolean(init) || params.some((p) => p.name === name)) return line;   // let the compiler complain
    params.push(makeSpec(type, name, parseOptions(opts), init));
    return `${indent}uniform ${type} ${name};`;
  });
  return { code: lines.join('\n'), params };
}

function parseOptions(text) {
  const o = {};
  for (const [, key, value] of text.matchAll(OPTION)) o[key] = value === undefined ? true : value.replace(/^"|"$/g, '');
  return o;
}

function makeSpec(type, name, o, init) {
  const color = (type === 'vec3' || type === 'vec4') && (o.color === true || String(o.default ?? '').startsWith('#'));
  const spec = { name, type, color, label: o.label ?? prettify(name) };
  const raw = o.default ?? init;
  if (type === 'bool') return { ...spec, def: /^(true|1)$/.test(String(raw ?? '').trim()) };

  const size = SIZES[type];
  const def = parseVector(raw, size) ?? Array(size).fill(color ? 1 : 0);
  const min = num(o.min) ?? Math.min(0, ...def);
  const max = num(o.max) ?? Math.max(1, ...def.map((v) => (v > 1 ? v * 2 : v)));
  const step = num(o.step) ?? (o.int ? 1 : niceStep((max - min) / 200));
  return { ...spec, def: size === 1 ? def[0] : def, min, max, step, int: Boolean(o.int) };
}

// "1.5" · "vec3(1., .3, .8)" · "vec3(.5)" · "1,0.3,0.8" · "#ff4fd8"
function parseVector(raw, size) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    const n = parseInt(text.slice(1), 16);
    return [n >> 16, n >> 8, n].map((c) => (c & 255) / 255).concat(size === 4 ? [1] : []);
  }
  const nums = text.replace(/^\w*\(|\)$/g, '').split(',').map(num);
  if (nums.some((n) => n === null)) return null;
  if (nums.length === 1) return Array(size).fill(nums[0]);
  if (nums.length !== size) return null;
  return nums;
}

function num(v) {
  if (v == null || v === true) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x) ?? p;
}

// uGlowSize -> "Glow size", RING_COUNT -> "Ring count", p12 -> "p12"
function prettify(name) {
  const words = name.replace(/^u(?=[A-Z])/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Value as the renderer wants it: number for float/bool, array for vectors.
export function toUniform(spec, value) {
  if (spec.type === 'bool') return value ? 1 : 0;
  return value;
}

// Remembers tweaked values per scene. When the code changes a parameter's default, the new default wins.
export class ParamStore {
  constructor() {
    try { this.data = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { this.data = {}; }
  }

  values(key, specs) {
    const saved = this.data[key] ?? {};
    return Object.fromEntries(specs.map((s) => {
      const entry = saved[s.name];
      const fresh = !entry || JSON.stringify(entry.def) !== JSON.stringify(s.def) || !compatible(s, entry.v);
      return [s.name, fresh ? s.def : entry.v];
    }));
  }

  set(key, spec, value) {
    (this.data[key] ??= {})[spec.name] = { v: value, def: spec.def };
    this.save();
  }

  // Replace a scene's values (taking a show scene live). Missing values fall back to the defaults.
  setAll(key, specs, values = {}) {
    this.data[key] = Object.fromEntries(specs.map((s) => [s.name, { v: values[s.name] ?? s.def, def: s.def }]));
    this.save();
  }

  copy(from, to) {
    this.data[to] = structuredClone(this.data[from] ?? {});
    this.save();
  }

  reset(key) {
    delete this.data[key];
    this.save();
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }
}

function compatible(spec, v) {
  if (spec.type === 'bool') return typeof v === 'boolean';
  return SIZES[spec.type] === 1 ? typeof v === 'number' : Array.isArray(v) && v.length === SIZES[spec.type];
}

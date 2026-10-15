import { describe, expect, it } from 'vitest';
import { ParamStore, groupParams, parseParams, toUniform, valueSchema, type FloatParamSpec, type VecParamSpec } from './params';

const README_EXAMPLES = `
uniform float uGlow;                 // @param min=0 max=3 default=1 label="Glow"
const float RINGS = 30.;             // @param min=5 max=80 int
const vec3 TINT = vec3(1., .3, .8);  // @param color
uniform bool uMirror;                // @param default=true
uniform vec2 uCentre;                // @param min=-.5 max=.5
void main() { fragColor = vec4(1.); }
`;

describe('parseParams', () => {
  it('parses every README example into a spec and rewrites constants to uniforms', () => {
    const { code, params } = parseParams(README_EXAMPLES);
    expect(params.map((p) => p.name)).toEqual(['uGlow', 'RINGS', 'TINT', 'uMirror', 'uCentre']);
    expect(code).toContain('uniform float RINGS;');
    expect(code).toContain('uniform vec3 TINT;');
    expect(code.split('\n').length).toBe(README_EXAMPLES.split('\n').length);   // line numbers stay valid

    const [glow, rings, tint, mirror, centre] = params;
    expect(glow).toMatchObject({ type: 'float', def: 1, min: 0, max: 3, label: 'Glow', int: false });
    expect(rings).toMatchObject({ type: 'float', def: 30, min: 5, max: 80, int: true, step: 1, label: 'Ring count'.replace('Ring count', 'Rings') });
    expect(tint).toMatchObject({ type: 'vec3', color: true, def: [1, 0.3, 0.8] });
    expect(mirror).toMatchObject({ type: 'bool', def: true });
    expect(centre).toMatchObject({ type: 'vec2', min: -0.5, max: 0.5, def: [0, 0] });
  });

  it('parses hex colour defaults and leaves malformed declarations to the compiler', () => {
    const { params } = parseParams('uniform vec3 uTint; // @param color default=#ff0080\nuniform float uBad = 1.; // @param\n');
    expect(params).toHaveLength(1);
    expect(params[0]!.def).toEqual([1, 0x00 / 255, 0x80 / 255]);
  });

  it('prettifies names', () => {
    const { params } = parseParams('uniform float uGlowSize; // @param\nconst float RING_COUNT = 1.; // @param\n');
    expect(params.map((p) => p.label)).toEqual(['Glow size', 'Ring count']);
  });
});

describe('param groups', () => {
  const CODE = `
uniform float uLoose;                 // @param
// @group Network
uniform float uDensity;               // @param label="Density"
uniform float uSize;                  // @param label="Size" group=Mushrooms
uniform float uWarp;                  // @param label="Warp"
//   @group   Mushrooms
uniform bool uSpots;                  // @param
// @group
uniform float uAfter;                 // @param
// @group Network
uniform float uThread;                // @param
void main() { fragColor = vec4(1.); }
`;

  it('takes the group from the last @group line, overridden by group= on the line', () => {
    const { code, params } = parseParams(CODE);
    expect(Object.fromEntries(params.map((p) => [p.name, p.group]))).toEqual({
      uLoose: '', uDensity: 'Network', uSize: 'Mushrooms', uWarp: 'Network', uSpots: 'Mushrooms', uAfter: '', uThread: 'Network',
    });
    expect(code.split('\n').length).toBe(CODE.split('\n').length);   // @group lines stay, line numbers stay valid
    expect(code).toContain('// @group Network');
  });

  it('lists the ungrouped params first, then groups in first-appearance order, merging repeated names', () => {
    const groups = groupParams(parseParams(CODE).params);
    expect(groups.map((g) => [g.name, g.specs.map((s) => s.name)])).toEqual([
      ['', ['uLoose', 'uAfter']],
      ['Network', ['uDensity', 'uWarp', 'uThread']],
      ['Mushrooms', ['uSize', 'uSpots']],
    ]);
  });

  it('keeps a scene without groups as one unnamed group, and an empty scene as none', () => {
    const groups = groupParams(parseParams(README_EXAMPLES).params);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('');
    expect(groupParams([])).toEqual([]);
  });
});

describe('ParamStore', () => {
  const specs = parseParams(README_EXAMPLES).params;

  it('returns defaults, remembers values and drops them when the default or shape changes', () => {
    const store = new ParamStore();
    const glow = specs[0]!, tint = specs[2]!;
    expect(store.values('k', specs).uGlow).toBe(1);
    store.set('k', glow, 2.5);
    store.set('k', tint, [0, 0, 1]);
    expect(store.values('k', specs)).toMatchObject({ uGlow: 2.5, TINT: [0, 0, 1] });
    const changed: FloatParamSpec = { ...(glow as FloatParamSpec), def: 7 };
    expect(store.values('k', [changed]).uGlow).toBe(7);           // new default wins
    const asVec: VecParamSpec = { ...(tint as VecParamSpec), type: 'vec4', def: [1, 1, 1, 1] };
    expect(store.values('k', [asVec]).TINT).toEqual([1, 1, 1, 1]);  // incompatible shape → default
    store.dispose();
  });

  it('copies and resets per key', () => {
    const store = new ParamStore();
    store.set('a', specs[0]!, 3);
    store.copy('a', 'b');
    expect(store.values('b', specs).uGlow).toBe(3);
    store.reset('b');
    expect(store.values('b', specs).uGlow).toBe(1);
    store.dispose();
  });
});

describe('uniform helpers', () => {
  it('turns bools into 0/1 and validates shapes per spec', () => {
    const [glow, , tint, mirror] = parseParams(README_EXAMPLES).params;
    expect(toUniform(mirror!, true)).toBe(1);
    expect(toUniform(glow!, 0.5)).toBe(0.5);
    expect(valueSchema(tint!).safeParse([1, 2]).success).toBe(false);
    expect(valueSchema(tint!).safeParse([1, 2, 3]).success).toBe(true);
    expect(valueSchema(mirror!).safeParse('true').success).toBe(false);
  });
});

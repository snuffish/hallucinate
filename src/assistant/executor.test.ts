import { describe, expect, it } from 'vitest';
import { parseParams } from '../engine/params';
import { resolveParam } from './executor';

const { params } = parseParams(`
uniform float uSpeed;         // @param label="Speed"
// @group Mushrooms
uniform float uMushSize;      // @param label="Size"
// @group Trees
uniform float uTreeSize;      // @param label="Size"
`);
const nameOf = (r: ReturnType<typeof resolveParam>) => (typeof r === 'string' ? r : r.name);

describe('resolveParam', () => {
  it('finds a param by exact name, by a label only one param has, and by Group/Label', () => {
    expect(nameOf(resolveParam(params, 'uTreeSize'))).toBe('uTreeSize');
    expect(nameOf(resolveParam(params, 'speed'))).toBe('uSpeed');
    expect(nameOf(resolveParam(params, 'Mushrooms/Size'))).toBe('uMushSize');
    expect(nameOf(resolveParam(params, 'trees / size'))).toBe('uTreeSize');
  });

  it('refuses a label that several groups share instead of picking the first', () => {
    const r = resolveParam(params, 'Size');
    expect(typeof r).toBe('string');
    expect(r).toContain('ambiguous');
    expect(r).toContain('"Mushrooms/Size"');
    expect(r).toContain('"Trees/Size"');
  });

  it('reports unknown keys', () => {
    expect(resolveParam(params, 'Glow')).toBe('"Glow" isn\'t a parameter of this scene');
    expect(typeof resolveParam(params, 'Bushes/Size')).toBe('string');
  });
});

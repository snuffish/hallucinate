import { describe, expect, it } from 'vitest';
import { EXAMPLES, GraphSchema, NODE_TYPES, compileGraph, emptyGraph } from './nodes';
import { parseParams } from './params';

describe('compileGraph', () => {
  it('compiles every example graph into a main() with live parameters where sliders are used', () => {
    for (const ex of EXAMPLES) {
      const code = compileGraph(ex.graph);
      expect(code, ex.name).toContain('void main() {');
      expect(code, ex.name).toContain('fragColor = vec4(');
      const { params } = parseParams(code);
      const sliders = ex.graph.nodes.filter((n) => n.type === 'slider' || n.type === 'colorPicker').length;
      expect(params.length, ex.name).toBe(sliders);
    }
  });

  it('includes helper libraries once and converts mismatched wire types', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
        { id: 2, type: 'kaleido', x: 0, y: 0, values: {}, params: {} },
        { id: 3, type: 'kaleido', x: 0, y: 0, values: {}, params: {} },
        { id: 4, type: 'output', x: 0, y: 0, values: {}, params: {} },
      ],
      links: [
        { from: 1, out: 'p', to: 2, in: 'p' },
        { from: 2, out: 'p', to: 3, in: 'p' },
        { from: 3, out: 'p', to: 4, in: 'color' },   // vec2 -> vec3 conversion
      ],
    };
    const code = compileGraph(graph);
    expect(code.match(/vec2 nk_kaleido\(/g)).toHaveLength(1);
    expect(code).toContain('vec3(n3_p, 0.)');
  });

  it('rejects loops and graphs without an output', () => {
    expect(() => compileGraph({ nodes: [{ id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} }], links: [] })).toThrow(/Output/);
    const loop = {
      nodes: [
        { id: 1, type: 'rotate', x: 0, y: 0, values: {}, params: {} },
        { id: 2, type: 'rotate', x: 0, y: 0, values: {}, params: {} },
        { id: 3, type: 'output', x: 0, y: 0, values: {}, params: {} },
      ],
      links: [
        { from: 1, out: 'p', to: 2, in: 'p' },
        { from: 2, out: 'p', to: 1, in: 'p' },
        { from: 2, out: 'p', to: 3, in: 'color' },
      ],
    };
    expect(() => compileGraph(loop)).toThrow(/Loop/);
  });
});

describe('GraphSchema', () => {
  it('accepts the examples and the empty graph, rejects unknown block types', () => {
    for (const ex of EXAMPLES) expect(GraphSchema.safeParse(ex.graph).success, ex.name).toBe(true);
    expect(GraphSchema.safeParse(emptyGraph()).success).toBe(true);
    expect(GraphSchema.safeParse({ nodes: [{ id: 1, type: 'nope', x: 0, y: 0 }], links: [] }).success).toBe(false);
  });

  it('rejects names inherited from Object (an imported graph must not reach the view with them)', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(GraphSchema.safeParse({ nodes: [{ id: 1, type, x: 0, y: 0 }], links: [] }).success, type).toBe(false);
    }
  });

  it('drops wires whose block or port does not exist', () => {
    const g = GraphSchema.parse({
      nodes: [{ id: 1, type: 'uv', x: 0, y: 0 }, { id: 2, type: 'output', x: 0, y: 0 }],
      links: [{ from: 9, out: 'p', to: 2, in: 'color' }, { from: 1, out: 'nope', to: 2, in: 'color' }, { from: 1, out: 'p', to: 2, in: 'nope' }],
    });
    expect(g.nodes).toHaveLength(2);
    expect(g.links).toEqual([]);
  });

  it('every node type lists a category the palette knows, except Output', () => {
    for (const [name, def] of Object.entries(NODE_TYPES)) {
      if (name === 'output') continue;
      expect(['Input', 'Coordinates', 'Pattern', 'Math', 'Color'], name).toContain(def.cat);
    }
  });
});

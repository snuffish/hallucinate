import { describe, expect, it } from 'vitest';
import { programState } from './look';
import { NODE_TYPES } from './nodes';
import { SCENE_INPUTS, stillUniforms, writeInputs } from './scene-inputs';
import { COMMON, TEMPLATE } from './scenes';

describe('the scene inputs', () => {
  it('declares every input in the shader header, with what it means', () => {
    for (const i of SCENE_INPUTS) {
      const line = COMMON.split('\n').find((l) => l.startsWith(`uniform float ${i.uniform};`));
      expect(line, i.uniform).toContain(i.range);
      expect(TEMPLATE).toContain(i.uniform);
    }
  });

  it('fills every input from the frame', () => {
    const p = programState();
    SCENE_INPUTS.forEach((i, n) => { p[i.field] = n + 0.5; });
    const u: Record<string, unknown> = {};
    writeInputs(u, p);
    expect(u).toEqual(Object.fromEntries(SCENE_INPUTS.map((i, n) => [i.uniform, n + 0.5])));
  });

  it('offers every input from the sound on the Audio block, and nothing else', () => {
    const audio = NODE_TYPES.audio!;
    const fromSound = SCENE_INPUTS.filter((i) => i.node);
    expect(audio.outputs.map((o) => o.name)).toEqual(fromSound.map((i) => i.node));
    expect(audio.emit({}, {}, 0)).toEqual(Object.fromEntries(fromSound.map((i) => [i.node, i.uniform])));
    expect(audio.help).toContain('tone: the tone');
  });

  it('gives still frames a value for every input', () => {
    expect(Object.keys(stillUniforms()).sort()).toEqual(SCENE_INPUTS.map((i) => i.uniform).sort());
    expect(stillUniforms({ uTime: 3 })).toMatchObject({ uTime: 3, uBass: 0.5 });
  });
});

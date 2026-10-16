import { describe, expect, it } from 'vitest';
import type { Overlay } from '../state/ui-state';
import { CUE_DIGITS, CUE_DIGITS_WHEN, HOTKEYS, isEnabled, SCENE_DIGITS, SCENE_DIGITS_WHEN, type HotkeyContext, type HotkeyWhen } from './registry';

// Every overlay (a missing one is a type error here), plus none.
const OVERLAY_SET: Record<Exclude<Overlay, null>, true> = { library: true, editor: true, nodes: true, studio: true, soundcloud: true, youtube: true, settings: true };
const OVERLAYS: Overlay[] = [null, ...(Object.keys(OVERLAY_SET) as Exclude<Overlay, null>[])];

function* contexts(): Generator<HotkeyContext> {
  const flags = [false, true];
  for (const overlay of OVERLAYS) for (const assistantOpen of flags)
    for (const helpOpen of flags) for (const paramsVisible of flags) yield { overlay, assistantOpen, helpOpen, paramsVisible };
}

const bindings: { id: string; keys: string; when: HotkeyWhen }[] = [
  ...Object.values(HOTKEYS),
  ...SCENE_DIGITS.map((d) => ({ id: `scene ${d}`, keys: d, when: SCENE_DIGITS_WHEN })),
  ...CUE_DIGITS.map((d) => ({ id: `cue ${d}`, keys: d, when: CUE_DIGITS_WHEN })),
];

describe('hotkey registry', () => {
  it('never has two bindings live on the same key, in any UI state', () => {
    for (const c of contexts()) {
      const live = new Map<string, string>();
      for (const b of bindings) {
        if (!isEnabled(b.when, c)) continue;
        const other = live.get(b.keys);
        expect(other, `${other} and ${b.id} both live on ${b.keys} in ${JSON.stringify(c)}`).toBeUndefined();
        live.set(b.keys, b.id);
      }
    }
  });

  // G once played a removed scene (ADR 0001); it stays free rather than quietly doing something else.
  it('leaves G unbound', () => {
    expect(bindings.filter((b) => b.keys.toUpperCase() === 'G').map((b) => b.id)).toEqual([]);
  });

  it('changes scene with the arrows while the code editor is open', () => {
    const editor: HotkeyContext = { overlay: 'editor', assistantOpen: false, helpOpen: false, paramsVisible: true };
    expect(isEnabled(HOTKEYS.scenePrev.when, editor)).toBe(true);
    expect(isEnabled(HOTKEYS.sceneNext.when, editor)).toBe(true);
  });

  it('uses ids that match their keys in the table', () => {
    for (const [key, def] of Object.entries(HOTKEYS)) expect(def.id).toBe(key);
  });
});

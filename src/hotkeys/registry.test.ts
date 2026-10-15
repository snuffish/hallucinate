import { describe, expect, it } from 'vitest';
import { HOTKEYS, type HotkeyWhen } from './registry';

// Two bindings on the same key may coexist only when their `when` conditions can't both hold.
const EXCLUSIVE: [HotkeyWhen, HotkeyWhen][] = [
  ['noOverlay', 'game'], ['noOverlay', 'studio'], ['noOverlay', 'library'], ['noOverlay', 'nodesOpen'], ['noOverlay', 'overlayOpen'],
  ['game', 'studio'], ['game', 'library'], ['game', 'nodesOpen'],
  ['studio', 'library'], ['studio', 'nodesOpen'], ['library', 'nodesOpen'], ['library', 'noLibrary'],
  ['notGame', 'game'], ['notStudio', 'studio'], ['noNodes', 'nodesOpen'], ['noLibrary', 'nodesOpen'], ['always', 'never' as HotkeyWhen],
];
const exclusive = (a: HotkeyWhen, b: HotkeyWhen) => EXCLUSIVE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

describe('hotkey registry', () => {
  it('has no two bindings that can be enabled at the same time on the same key', () => {
    const defs = Object.values(HOTKEYS);
    for (const a of defs) for (const b of defs) {
      if (a === b || a.keys !== b.keys) continue;
      expect(exclusive(a.when, b.when), `${a.id} and ${b.id} both bind ${a.keys}`).toBe(true);
    }
  });

  it('uses ids that match their keys in the table', () => {
    for (const [key, def] of Object.entries(HOTKEYS)) expect(def.id).toBe(key);
  });
});

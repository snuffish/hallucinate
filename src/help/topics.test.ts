import { describe, expect, it } from 'vitest';
import { HOTKEYS, type HotkeyDef, type HotkeyId } from '../hotkeys/registry';
import { HELP_TOPICS, SHEET_GROUPS, groupRows, shortcutRows } from './topics';

describe('help topics', () => {
  it('uses ids that match their keys in the table', () => {
    for (const [key, topic] of Object.entries(HELP_TOPICS)) expect(topic.id).toBe(key);
  });

  it('has a title and text for every topic', () => {
    for (const topic of Object.values(HELP_TOPICS)) {
      expect(topic.title.trim(), topic.id).not.toBe('');
      expect(topic.body.length, topic.id).toBeGreaterThan(0);
      for (const p of topic.body) expect(p.trim(), topic.id).not.toBe('');
    }
  });

  it('lists only known shortcuts', () => {
    for (const topic of Object.values(HELP_TOPICS)) for (const id of topic.hotkeys) expect(HOTKEYS[id as HotkeyId], `${topic.id}: ${id}`).toBeDefined();
  });

  it('puts every shortcut group on the sheet', () => {
    const groups = new Set(Object.values(HOTKEYS).map((d: HotkeyDef) => d.group));
    for (const g of groups) expect(SHEET_GROUPS).toContain(g);
    // …and every shortcut shows up on it exactly once.
    const shown = SHEET_GROUPS.flatMap((g) => groupRows(g).flatMap((r) => r.keys.map((k) => k.id)));
    expect(shown.sort()).toEqual(Object.keys(HOTKEYS).sort());
  });

  it('shows keys that share a label on one row', () => {
    const rows = shortcutRows(['deleteNode', 'deleteNodeBackspace']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keys.map((k) => k.keys)).toEqual(['Delete', 'Backspace']);
    expect(rows[0]!.note).toBe('in the visual maker');
  });
});

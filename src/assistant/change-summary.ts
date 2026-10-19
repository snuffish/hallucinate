// A change record (change-log.ts) in words: which values went from what to what, and which show
// scenes were added, removed or changed. The chat's tool chips and the studio show these.

import type { Cue, ShowSnapshot } from '../app/studio';
import type { Plan } from '../state/show-plan';

export interface ValueRow { key: string; before: unknown; after: unknown }

// The keys whose value differs, in the order they were given.
export function valueRows(before: unknown, after: unknown): ValueRow[] {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((key) => ({ key, before: b[key], after: a[key] }));
}

const round = (x: number) => Math.round(x * 1000) / 1000;
export function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return String(round(v));
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return `(${v.map((x) => (typeof x === 'number' ? round(x) : String(x))).join(', ')})`;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

// An array of 3 or 4 numbers 0–1 could be a colour: the chip shows a swatch beside it.
export function colourOf(v: unknown): string | null {
  if (!Array.isArray(v) || (v.length !== 3 && v.length !== 4) || !v.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) return null;
  const [r, g, b] = (v as number[]).map((x) => Math.round(x * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

const quoted = (s: string) => `“${s}”`;

function cueChanges(was: Cue, now: Cue): string[] {
  const out: string[] = [];
  if (was.name !== now.name) out.push(`renamed to ${quoted(now.name)}`);
  if (was.scene !== now.scene) out.push(`scene ${was.scene} → ${now.scene}`);
  const values = valueRows(was.values, now.values);
  if (values.length) out.push(`parameters ${values.map((r) => `${r.key} ${formatValue(r.before)} → ${formatValue(r.after)}`).join(', ')}`);
  const look = valueRows(was.look, now.look);
  if (look.length) out.push(`look ${look.map((r) => `${r.key} ${formatValue(r.before)} → ${formatValue(r.after)}`).join(', ')}`);
  if (JSON.stringify(was.effects) !== JSON.stringify(now.effects)) out.push('effects changed');
  return out;
}

function planLine(plan: Plan | null, names: Map<string, string>): string {
  if (!plan) return 'none';
  const steps = plan.steps.map((s) => `${names.get(s.cue) ?? s.cue} ${s.beats}`).join(' · ');
  return `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}${plan.loop ? ', looping' : ''}: ${steps}`;
}

// What happened to the show, one line each.
export function showLines(before: ShowSnapshot | null, after: ShowSnapshot | null): string[] {
  const b = before?.cues ?? [], a = after?.cues ?? [];
  const was = new Map(b.map((c) => [c.id, c])), now = new Map(a.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const c of a) if (!was.has(c.id)) out.push(`+ Added ${quoted(c.name)}${c.name !== c.scene ? ` (${c.scene})` : ''}`);
  for (const c of b) if (!now.has(c.id)) out.push(`− Removed ${quoted(c.name)}`);
  for (const c of a) {
    const old = was.get(c.id);
    const changes = old ? cueChanges(old, c) : [];
    if (changes.length) out.push(`~ ${quoted(old!.name)}: ${changes.join('; ')}`);
  }
  const kept = (list: Cue[], other: Map<string, Cue>) => list.filter((c) => other.has(c.id)).map((c) => c.id).join();
  if (kept(b, now) !== kept(a, was)) out.push(`↕ New order: ${a.map((c) => c.name).join(', ')}`);
  if (JSON.stringify(before?.plan ?? null) !== JSON.stringify(after?.plan ?? null)) {
    const names = new Map([...b, ...a].map((c) => [c.id, c.name]));
    out.push(`Plan: ${planLine(before?.plan ?? null, names)} → ${planLine(after?.plan ?? null, names)}`);
    const note = after?.plan?.note;
    if (note) out.push(`  “${note}”`);
  }
  return out;
}

// The Effects widget's body: the main screen's effect stack, made from the catalogue (src/engine/effects.ts).
// An "Add effect" menu offering the effects not yet added, then one row per effect, in the order they run:
// a handle to drag it to another place (or move it with ↑ / ↓ when the handle has the focus), its on/off
// checkbox, a remove button and its settings (a choice as a menu, a number as a slider). Inputs are
// prefixed `fx-<effect>-`: the Look's sliders already use bare ids such as #speed.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { effectDef, effectsToAdd, type EffectEntry, type EffectId, type EffectSetting, type EffectStack } from '../../engine/effects';
import { usePointerDrag } from './usePointerDrag';

// Where a dragged effect would land: its place in the stack once it is taken out (moveEffect's `to`).
interface Drop { id: EffectId; to: number }

export function EffectsBody() {
  const app = useApp();
  const stack = useUI((ui) => ui.effects);
  const addable = effectsToAdd(stack);
  const list = useRef<HTMLOListElement>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  // The place under the pointer: how many of the other rows have their middle above it.
  const placeAt = (id: EffectId, y: number): number => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(':scope > [data-effect]') ?? [])].filter((el) => el.dataset.effect !== id);
    return rows.filter((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
  };
  const drag = {
    move: (id: EffectId, y: number) => setDrop({ id, to: placeAt(id, y) }),
    end: (id: EffectId, y: number) => { setDrop(null); app.moveEffect(id, placeAt(id, y)); },
    cancel: () => setDrop(null),
  };

  return (
    <>
      <select id="fx-add" aria-label="Add effect" value="" disabled={addable.length === 0}
        onChange={(e) => { if (e.target.value) app.addEffect(e.target.value as EffectId); }}>
        <option value="">{addable.length ? 'Add effect…' : 'Every effect is added'}</option>
        {addable.map((e) => <option key={e.id} value={e.id} title={e.help}>{e.label}</option>)}
      </select>
      {stack.length > 0 && (
        <ol className="fx-stack" ref={list}>
          {stack.map((entry, i) => <EffectRow key={entry.id} entry={entry} index={i} marker={dropMarker(stack, drop, entry.id)} drag={drag} />)}
        </ol>
      )}
    </>
  );
}

// How a row shows a drag in progress: the dragged row, and the line where it would land.
type Marker = 'dragging' | 'drop-before' | 'drop-after' | null;
function dropMarker(stack: EffectStack, drop: Drop | null, id: EffectId): Marker {
  if (!drop) return null;
  if (drop.id === id) return 'dragging';
  const rest = stack.filter((e) => e.id !== drop.id);
  if (rest[drop.to]?.id === id) return 'drop-before';
  return drop.to >= rest.length && rest.at(-1)?.id === id ? 'drop-after' : null;
}

interface RowDrag { move: (id: EffectId, y: number) => void; end: (id: EffectId, y: number) => void; cancel: () => void }

function EffectRow({ entry, index, marker, drag }: { entry: EffectEntry; index: number; marker: Marker; drag: RowDrag }) {
  const app = useApp();
  const def = effectDef(entry.id);
  const handle = useRef<HTMLButtonElement>(null);
  // A move from the keyboard re-orders the rows, which can take the focus from the handle: give it back.
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    handle.current?.focus();
  });
  const { onPointerDown, onClickCapture } = usePointerDrag({
    onStart: () => {},
    onMove: (e) => drag.move(entry.id, e.clientY),
    onEnd: (e) => drag.end(entry.id, e.clientY),
    onCancel: drag.cancel,
  });
  if (!def) return null;
  const id = `fx-${entry.id}`;
  const onKeyDown = (e: KeyboardEvent) => {
    const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!by) return;
    e.preventDefault();
    e.stopPropagation();   // ↑ / ↓ are the volume shortcuts elsewhere
    refocus.current = true;
    app.moveEffect(entry.id, Math.max(0, index + by));
  };
  return (
    <li className={['fx', entry.on ? null : 'off', marker].filter(Boolean).join(' ')} data-effect={entry.id}>
      <div className="fx-head">
        <button ref={handle} type="button" id={`${id}-move`} className="icon fx-move" aria-label={`Move ${def.label}`}
          title="Drag to change the order (or ↑ / ↓)" onPointerDown={onPointerDown} onClickCapture={onClickCapture} onKeyDown={onKeyDown}>⠿</button>
        <label className="toggle" title={`${def.help} ${def.music}`}>
          <input type="checkbox" id={`${id}-on`} checked={entry.on} onChange={(e) => app.setEffectOn(entry.id, e.target.checked)} /> {def.label}
        </label>
        <button className="icon fx-remove" aria-label={`Remove ${def.label}`} title={`Remove ${def.label}`} onClick={() => app.removeEffect(entry.id)}>×</button>
      </div>
      {def.settings.map((s) => <Setting key={s.key} id={`${id}-${s.key}`} setting={s} value={entry.settings[s.key] ?? s.default}
        onChange={(v) => app.setEffectSetting(entry.id, s.key, v)} />)}
    </li>
  );
}

function Setting({ id, setting: s, value, onChange }: { id: string; setting: EffectSetting; value: number; onChange: (v: number) => void }) {
  if (s.options) {
    return (
      <label>{s.label}
        <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {s.options.map((label, i) => <option key={label} value={s.min + i * s.step}>{label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label>{s.label}
      <input type="range" id={id} min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(s.default)} title="Double-click to reset" />
    </label>
  );
}

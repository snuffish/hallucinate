// One Look slider as a row: lock · label · slider · the value, which takes a typed one. Double-click resets.
// Fine tuning is the same on every Look control (here and on the XY pads): a drag is relative, so pressing
// Shift mid-drag (ten times finer) never jumps; the wheel steps a focused slider (Shift: one step); the
// arrow keys step it.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { LASER_GRADIENT, laserCss } from '../../engine/laser-colour';
import { LOOK_RANGES, defaultLook, type LookKey, type SliderKey } from '../../state/app-state';

// How each Look value reads: shown as value × scale, typed back in the same units.
export const LOOK_DISPLAY: Record<LookKey, { label: string; scale: number; unit: string; digits: number; hint: string }> = {
  reactivity: { label: 'Reactivity', scale: 100, unit: '%', digits: 0, hint: 'How strongly the picture follows the music’s bands and kicks' },
  speed: { label: 'Speed', scale: 1, unit: '×', digits: 2, hint: 'How fast the scene moves (it also eases with the music)' },
  trails: { label: 'Trails', scale: 100, unit: '%', digits: 0, hint: 'How long a line keeps glowing where it was drawn' },
  hue: { label: 'Colour', scale: 360, unit: '°', digits: 0, hint: 'Where on the laser wheel the colours sit' },
  cycle: { label: 'Colour cycling', scale: 1, unit: '×', digits: 2, hint: 'How fast the colour walks, and how far a kick moves it' },
  synesthesia: { label: 'Synesthesia', scale: 100, unit: '%', digits: 0, hint: 'dark sound → dim & cool · bright sound → light & warm · energetic mood → vivid & warm' },
  aberration: { label: 'Fringing', scale: 100, unit: '%', digits: 1, hint: 'How far each line splits into red, green and blue' },
  driftSpeed: { label: 'Drift speed', scale: 1, unit: '×', digits: 2, hint: 'How fast the sliders drift' },
};

export const FINE = 0.1;   // Shift: how much finer a drag goes
const THUMB = 8;           // half a range input's thumb, in px: where its track starts and ends

export const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const snap = (v: number, step: number): number => Math.round(v / step) * step;

// Wheel steps: ten a notch, Shift one (macOS turns Shift+wheel sideways, so either axis counts). Only while
// `active` says so, so scrolling the panel doesn't catch on a slider passing under the pointer.
export function useWheelStep<E extends HTMLElement>(step: (by: number) => void, active: (el: E) => boolean = () => true) {
  const ref = useRef<E>(null);
  const latest = useRef({ step, active });
  useEffect(() => { latest.current = { step, active }; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaY || e.deltaX;
      if (!d || !latest.current.active(el)) return;
      e.preventDefault();
      latest.current.step((d < 0 ? 1 : -1) * (e.shiftKey ? 1 : 10));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return ref;
}

export interface Display { label: string; scale: number; unit: string; digits: number }
export interface Range { min: number; max: number; step: number }

// A value as an editable number in its display units. Enter or leaving the field sets it, Escape
// cancels; keys stay in the field (no hotkeys while typing).
export function NumberField({ d, value, onSet }: { d: Display; value: number; onSet: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = (value * d.scale).toFixed(d.digits);
  return (
    <span className="look-value">
      <input type="text" inputMode="decimal" aria-label={`${d.label} value`} value={text ?? shown}
        onFocus={(e) => { setText(shown); e.target.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number((text ?? '').replace(',', '.'));
          if (!cancelled.current && text !== null && text.trim() !== '' && Number.isFinite(v)) onSet(v / d.scale);
          cancelled.current = false;
          setText(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
        }} />
      <i>{d.unit}</i>
    </span>
  );
}

// A range input with fine tuning. A press on the track jumps there (on the thumb it doesn't); from
// then on the drag is relative.
export function FineRange({ id, label, value, r, onSet, onReset, hue }: {
  id: string; label: string; value: number; r: Range; onSet: (v: number) => void; onReset?: () => void; hue?: boolean;
}) {
  const span = r.max - r.min;
  const drag = useRef<{ x: number; v: number } | null>(null);
  const set = (v: number) => onSet(snap(clampTo(v, r.min, r.max), r.step));
  const wheel = useWheelStep<HTMLInputElement>((by) => set(value + by * r.step), (el) => document.activeElement === el);
  const at = (b: DOMRect, x: number) => r.min + clampTo((x - b.left - THUMB) / (b.width - 2 * THUMB), 0, 1) * span;
  return (
    <input ref={wheel} type="range" id={id} className={hue ? 'look-hue-track' : undefined} min={r.min} max={r.max} step={r.step} value={value}
      aria-label={label} title={`${onReset ? 'Double-click to reset · ' : ''}Shift-drag: finer · wheel steps once it has focus`}
      style={{ '--p': `${((value - r.min) / span) * 100}%`, ...(hue && { background: LASER_GRADIENT('90deg') }) } as CSSProperties}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.focus();
        el.setPointerCapture(e.pointerId);
        const b = el.getBoundingClientRect();
        const thumbX = b.left + THUMB + ((value - r.min) / span) * (b.width - 2 * THUMB);
        const onThumb = Math.abs(e.clientX - thumbX) <= THUMB;
        const v = onThumb || e.shiftKey ? value : at(b, e.clientX);
        drag.current = { x: e.clientX, v };
        if (v !== value) set(v);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const b = e.currentTarget.getBoundingClientRect();
        d.v = clampTo(d.v + ((e.clientX - d.x) / (b.width - 2 * THUMB)) * span * (e.shiftKey ? FINE : 1), r.min, r.max);
        d.x = e.clientX;
        set(d.v);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onChange={(e) => { if (!drag.current) onSet(Number(e.target.value)); }}   // the arrow keys
      onDoubleClick={onReset} />
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1'} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function LookLock({ k, locked }: { k: SliderKey; locked: boolean }) {
  const app = useApp();
  const label = LOOK_DISPLAY[k].label;
  return (
    <button type="button" className={`look-lock${locked ? ' on' : ''}`} aria-pressed={locked} aria-label={`Lock ${label}`}
      title={locked ? `${label} is locked: Randomize and Drift leave it alone` : `Lock ${label}: Randomize and Drift leave it alone`}
      onClick={() => app.setLookLock(k, !locked)}><LockIcon locked={locked} /></button>
  );
}

// The hue on screen now: Colour plus how far cycling has walked.
export function LiveSwatch() {
  const hue = useUI((ui) => ui.liveHue);
  return <i className="look-swatch" style={{ '--c': laserCss(hue) } as CSSProperties} title={`On screen now: ${Math.round(hue * 360)}°`} />;
}

// A row. `lock` is whether it is locked (undefined: it can't be, like Drift speed); `tag` names the XY pad
// axis it is also on.
export function LookSlider({ k, value, lock, tag }: { k: LookKey; value: number; lock?: boolean; tag?: ReactNode }) {
  const app = useApp();
  const d = LOOK_DISPLAY[k];
  const set = (v: number) => app.setLook(k, v);
  return (
    <div className={`look-row${lock ? ' locked' : ''}`}>
      {lock === undefined ? <span /> : <LookLock k={k as SliderKey} locked={lock} />}
      <label htmlFor={k} title={d.hint}>{k === 'hue' && <LiveSwatch />}{d.label}{tag}</label>
      <FineRange id={k} label={d.label} value={value} r={LOOK_RANGES[k]} onSet={set} onReset={() => set(defaultLook()[k])} hue={k === 'hue'} />
      <NumberField d={d} value={value} onSet={set} />
    </div>
  );
}

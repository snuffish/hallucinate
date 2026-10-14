// The Parameters overlay: one control per `@param` of the scene on screen. Sliders for numbers
// (with an editable value), checkboxes for bools, colour pickers for colours. Drag it by its header;
// it remembers the spot. Inside the studio it's a dock and stays put.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { z } from 'zod';
import { useApp, useUI } from '../app/AppContext';
import type { ParamSpec, ParamValue, VecParamSpec, FloatParamSpec } from '../engine/params';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { KEYS, readJSON, remove, writeJSON } from '../state/persistence';
import { HelpButton } from './Help';

const AXES = ['x', 'y', 'z', 'w'];
const PosSchema = z.object({ x: z.number(), y: z.number() });
type Pos = z.infer<typeof PosSchema>;

const fmt = (v: number, spec: { int: boolean; step: number }) => {
  if (spec.int) return String(Math.round(v));
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(spec.step || 0.01))));
  return v.toFixed(decimals);
};
const toHex = (rgb: number[]) => '#' + rgb.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// Keeps at least the header on screen.
function clampPos(x: number, y: number, width: number): Pos {
  return {
    x: Math.min(Math.max(0, x), window.innerWidth - Math.min(width, 120)),
    y: Math.min(Math.max(0, y), window.innerHeight - 40),
  };
}

export function ParamOverlay({ docked }: { docked?: boolean }) {
  const app = useApp();
  const paramsVisible = useUI((ui) => ui.paramsVisible);
  const started = useUI((ui) => ui.started);
  const studioOpen = useUI((ui) => ui.overlay === 'studio');
  // Only once a source plays (not over the start screen); while the studio is open the dock
  // instance shows the controls and the floating one hides.
  const visible = paramsVisible && started && (docked ? studioOpen : !studioOpen);
  const collapsed = useUI((ui) => ui.paramsCollapsed);
  const params = useUI((ui) => ui.params);
  const root = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => readJSON<Pos | null>(KEYS.paramsPos, PosSchema.nullable(), null));
  const [dragging, setDragging] = useState(false);
  const isDocked = docked ?? params.docked;

  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clampPos(p.x, p.y, root.current?.offsetWidth || 270) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || isDocked || !root.current) return;
    const r = root.current.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const header = e.currentTarget;
    header.setPointerCapture(e.pointerId);
    setDragging(true);
    let last: Pos | null = null;
    const move = (ev: PointerEvent) => { last = clampPos(ev.clientX - dx, ev.clientY - dy, root.current?.offsetWidth || 270); setPos(last); };
    const up = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      setDragging(false);
      if (last) writeJSON(KEYS.paramsPos, last);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  };
  const resetPosition = () => { setPos(null); remove(KEYS.paramsPos); };

  const style: CSSProperties | undefined = pos && !isDocked ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;
  return (
    <aside id={docked ? undefined : 'params'} ref={root} className={`params${collapsed && !isDocked ? ' collapsed' : ''}${pos && !isDocked ? ' moved' : ''}${dragging ? ' dragging' : ''}`} hidden={!visible} style={style}>
      <header title="Drag to move · double-click to put it back" onPointerDown={startDrag} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button') && !isDocked) resetPosition(); }}>
        <strong id="params-title">{params.title}</strong>
        <button id="params-reset" title="Reset every value to the default in the code" onClick={() => app.resetParams()}>Reset</button>
        <HelpButton topic="params" />
        <button id="params-collapse" className="icon" title="Collapse / expand (P)" onClick={() => app.toggleParamsCollapsed()}>–<Kbd hotkey={HOTKEYS.params} /></button>
      </header>
      <div id="params-list" className="params-list">
        {params.specs.map((spec) => <ParamRow key={spec.name} spec={spec} value={params.values[spec.name] ?? spec.def} onChange={(v) => app.setParam(spec, v)} />)}
      </div>
    </aside>
  );
}

export function ParamRow({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }) {
  if (spec.type === 'bool') {
    return (
      <div className="param param-bool">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span className="param-label" title={spec.name}>{spec.label}</span>
      </div>
    );
  }
  if (spec.color) {
    const current = value as number[];
    const hex = toHex(current);
    return (
      <div className="param">
        <div className="param-head">
          <span className="param-label" title={spec.name}>{spec.label}</span>
          <code>{hex}</code>
          <input type="color" value={hex} onChange={(e) => onChange([...fromHex(e.target.value), ...current.slice(3)])} />
        </div>
        {spec.type === 'vec4' && (
          <Slider spec={{ ...(spec as VecParamSpec), min: 0, max: 1, step: 0.01 }} value={current[3] ?? 1} axis="alpha" onInput={(a) => onChange([...current.slice(0, 3), a])} />
        )}
      </div>
    );
  }
  if (spec.type === 'float') {
    return (
      <div className="param">
        <Slider spec={spec} value={value as number} axis={null} onInput={onChange} withLabel />
      </div>
    );
  }
  const current = value as number[];   // vec2 / vec3 / vec4: one slider per component
  return (
    <div className="param">
      {current.map((v, i) => (
        <Slider key={AXES[i]} spec={spec} value={v} axis={AXES[i]!} onInput={(x) => onChange(current.map((c, j) => (j === i ? x : c)))} />
      ))}
    </div>
  );
}

// A range slider plus an editable number. Double-click resets to the default.
function Slider({ spec, value, axis, onInput, withLabel }: { spec: FloatParamSpec | VecParamSpec; value: number; axis: string | null; onInput: (v: number) => void; withLabel?: boolean }) {
  const [text, setText] = useState<string | null>(null);   // while typing a value
  const field = (
    <input type="number" step={spec.step} value={text ?? fmt(value, spec)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== null) { const v = Number(text); if (Number.isFinite(v)) onInput(spec.int ? Math.round(v) : v); } setText(null); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
  const def = Array.isArray(spec.def) ? spec.def[AXES.indexOf(axis ?? '')] ?? 1 : spec.def;
  const range = (
    <input type="range" min={spec.min} max={spec.max} step={spec.step} value={value} title="Double-click to reset"
      style={{ '--p': `${((value - spec.min) / (spec.max - spec.min || 1)) * 100}%` } as CSSProperties}
      onChange={(e) => onInput(Number(e.target.value))}
      onDoubleClick={() => onInput(def)} />
  );
  if (withLabel) {
    return (
      <>
        <div className="param-head"><span className="param-label" title={spec.name}>{spec.label}</span>{field}</div>
        <div className="param-slider">{range}</div>
      </>
    );
  }
  return <div className="param-slider"><em>{axis}</em>{range}{field}</div>;
}

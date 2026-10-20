// The Parameters: one control per `@param` of the scene on screen. Sliders for numbers (with an
// editable value), checkboxes for bools, colour pickers for colours. Params under a `// @group`
// sit in a section that starts folded; which ones you open is remembered per scene. Outside the studio it is a
// widget (drag it, dock it, collapse it with P); inside the studio the same list sits in the
// studio's parameters dock.

import { useState, type CSSProperties } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { groupParams, type ParamSpec, type ParamValue, type ParamValues, type VecParamSpec, type FloatParamSpec } from '../engine/params';
import { HOTKEYS } from '../hotkeys/registry';
import type { WidgetLayout } from '../state/layout';
import { setOpen, toggleGroup, useOpenGroups } from '../state/param-groups';
import { HelpButton } from './Help';
import { Widget } from './widgets/Widget';
import { clamp01, hexToRgb } from '../engine/math';

const AXES = ['x', 'y', 'z', 'w'];

const fmt = (v: number, spec: { int: boolean; step: number }) => {
  if (spec.int) return String(Math.round(v));
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(spec.step || 0.01))));
  return v.toFixed(decimals);
};
const toHex = (rgb: number[]) => '#' + rgb.slice(0, 3).map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');

function ParamsList() {
  const app = useApp();
  const params = useUI((ui) => ui.params);
  const opened = useOpenGroups(params.key);
  const groups = groupParams(params.specs);
  const names = groups.map((g) => g.name).filter(Boolean);
  const rows = (specs: ParamSpec[], values: ParamValues) =>
    specs.map((spec) => <ParamRow key={spec.name} spec={spec} value={values[spec.name] ?? spec.def} onChange={(v) => app.setParam(spec, v)} />);
  return (
    <div id="params-list" className="params-list">
      {groups.map(({ name, specs }) => {
        if (!name) return rows(specs, params.values);
        const open = opened.includes(name);
        return (
          <section key={`group:${name}`} className="param-group" data-group={name}>
            <button type="button" className="param-group-head" aria-expanded={open} title={open ? 'Fold this group' : 'Show this group'}
              onClick={() => toggleGroup(params.key, name, names)}>
              <span className="chevron" aria-hidden="true">▸</span>{name}<em>{specs.length}</em>
            </button>
            {open && <div className="param-group-body">{rows(specs, params.values)}</div>}
          </section>
        );
      })}
    </div>
  );
}

const ResetButton = () => {
  const app = useApp();
  return <button id="params-reset" title="Reset every value to the default in the code" onClick={() => app.resetParams()}>Reset</button>;
};

// Opens every group while they're all folded, otherwise folds them all. Only for scenes with groups.
function FoldAllButton() {
  const key = useUI((ui) => ui.params.key);
  const specs = useUI((ui) => ui.params.specs);
  const open = useOpenGroups(key);
  const names = groupParams(specs).map((g) => g.name).filter(Boolean);
  if (!names.length) return null;
  const allFolded = !names.some((n) => open.includes(n));
  return (
    <button className="params-fold-all" aria-label={allFolded ? 'Expand all groups' : 'Collapse all groups'} title={allFolded ? 'Expand all groups' : 'Collapse all groups'}
      onClick={() => setOpen(key, allFolded ? names : [])}>{allFolded ? '⊞' : '⊟'}</button>
  );
}

// Only once a source plays (not over the start screen) and not while the studio shows its own copy.
export function ParamsWidget({ entry }: { entry: WidgetLayout }) {
  const paramsVisible = useUI((ui) => ui.paramsVisible);
  const studioOpen = useUI((ui) => ui.overlay === 'studio');
  const title = useUI((ui) => ui.params.title);
  return (
    <Widget id="params" domId="params" entry={entry} title={<span id="params-title">{title}</span>} help="params"
      tools={<><FoldAllButton /><ResetButton /></>} collapse={{ id: 'params-collapse', hotkey: HOTKEYS.params }} hidden={!paramsVisible || studioOpen}>
      <ParamsList />
    </Widget>
  );
}

// The studio's parameters dock.
export function StudioParams() {
  const paramsVisible = useUI((ui) => ui.paramsVisible);
  const title = useUI((ui) => ui.params.title);
  return (
    <aside className="params" hidden={!paramsVisible}>
      <header>
        <strong>{title}</strong>
        <FoldAllButton />
        <ResetButton />
        <HelpButton topic="params" />
      </header>
      <ParamsList />
    </aside>
  );
}

function ParamRow({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }) {
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
          <input type="color" value={hex} onChange={(e) => onChange([...hexToRgb(e.target.value), ...current.slice(3)])} />
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

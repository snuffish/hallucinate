// The Hearing monitor's plot (see hearing-workbench.ts): the signals picked, on one time axis 6, 20 or 60 s back, a
// lane per group. Hovering reads the values at a moment, Pause holds the plot still, and the what-if line shows which
// rises a different threshold would let through. It only shows: nothing here changes what the Listener hears.

import { useState } from 'react';
import type { HearingSample } from '../engine/hearing-history';
import type { HearingView } from '../state/ui-state';
import { Plot, type Draw } from './HearingPlot';
import {
  AXIS_HEIGHT, COLOURS, GROUPS, PRESETS, SIGNALS, SPANS, lanesFor, loadWorkbench, peaksOver, presetOf, sampleAt, saveWorkbench, toggleSignal,
  type Lane, type Signal, type WorkbenchSettings,
} from './hearing-workbench';
import { clamp01 } from '../engine/math';

const WATCH = 6;          // seconds of rises, due windows and threshold the Listener keeps
const KICK_NEAR = 0.06;   // seconds: a kick this close to the hovered moment is "here"
const WHAT_IF = [0.4, 2] as const;

const formatValue = (s: Signal, v: number | null) => (v === null ? '—' : s.id === 'bpm' ? v.toFixed(1) : Number.isInteger(v) ? String(v) : v.toFixed(2));

// A signal's values over the shown samples, between its range (or its lowest and highest shown).
function drawLine(c: CanvasRenderingContext2D, samples: readonly HearingSample[], s: Signal, x: (t: number) => number, lane: Lane) {
  const values = samples.map((m) => s.value!(m));
  let [lo, hi] = s.range ?? [Infinity, -Infinity];
  if (!s.range) for (const v of values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) hi = lo + 1;
  const y = (v: number) => lane.top + lane.height - 1 - clamp01((v - lo) / (hi - lo)) * (lane.height - 2);
  c.strokeStyle = s.colour;
  c.beginPath();
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null) { drawing = false; return; }
    const px = x(samples[i]!.at);
    if (drawing) c.lineTo(px, y(v)); else c.moveTo(px, y(v));
    drawing = true;
  });
  c.stroke();
}

// The kick lane: the rises (the Listener's own 6 s at full resolution, or the samples' highest when looking further
// back), the threshold, the what-if line and the rise peaks it lets through, and the kicks (top) and ticks (bottom).
function drawKickLane(c: CanvasRenderingContext2D, view: HearingView, samples: readonly HearingSample[], on: Set<string>, span: number, x: (t: number) => number, lane: Lane, whatIf: number) {
  const k = view.diagnostics.kicks, end = view.diagnostics.at, { top, height } = lane;
  const rises: [number, number][] = span <= WATCH
    ? Array.from(k.rises, (r, i) => [end - (k.rises.length - 1 - i) * k.cell, r])
    : samples.map((s) => [s.at, s.rise]);
  const peak = Math.max(k.threshold * 2.5, ...rises.map(([, r]) => r), 1);
  const y = (r: number) => top + height - 8 - Math.min(1, r / peak) * (height - 20);
  if (on.has('threshold')) {
    c.strokeStyle = COLOURS.threshold;
    c.setLineDash([3, 3]);
    c.beginPath();
    if (span <= WATCH || samples.length < 2) { c.moveTo(0, y(k.threshold)); c.lineTo(c.canvas.clientWidth, y(k.threshold)); }
    else samples.forEach((s, i) => (i ? c.lineTo(x(s.at), y(s.threshold)) : c.moveTo(x(s.at), y(s.threshold))));
    c.stroke();
    c.setLineDash([]);
  }
  if (on.has('rise')) {
    c.strokeStyle = COLOURS.line;
    c.beginPath();
    rises.forEach(([t, r], i) => (i ? c.lineTo(x(t), y(r)) : c.moveTo(x(t), y(r))));
    c.stroke();
  }
  if (whatIf !== 1) {
    const line = k.threshold * whatIf;
    c.strokeStyle = c.fillStyle = COLOURS.whatIf;
    c.setLineDash([6, 3]);
    c.beginPath(); c.moveTo(Math.max(0, x(end - WATCH)), y(line)); c.lineTo(x(end), y(line)); c.stroke();
    c.setLineDash([]);
    for (const ago of peaksOver(k.rises, k.cell, line)) {
      const px = x(end - ago);
      c.beginPath(); c.moveTo(px - 4, top + 11); c.lineTo(px + 4, top + 11); c.lineTo(px, top + 17); c.fill();
    }
  }
  const { kicks, ticks } = view.history;
  if (on.has('kicks')) { c.fillStyle = COLOURS.kick; for (const t of kicks) if (end - t <= span) c.fillRect(x(t) - 1, top + 1, 2, 9); }
  if (on.has('ticks')) { c.fillStyle = COLOURS.tick; for (const t of ticks) if (end - t <= span) c.fillRect(x(t) - 1, top + height - 7, 2, 6); }
}

function drawWorkbench(view: HearingView, signals: readonly string[], span: number, hover: number | null, whatIf: number): Draw {
  return (c, w, h) => {
    const on = new Set(signals), { lanes } = lanesFor(signals), d = view.diagnostics, k = d.kicks, end = d.at;
    const samples = view.history.samples.filter((s) => end - s.at <= span), plotH = h - AXIS_HEIGHT;
    const x = (t: number) => w - ((end - t) / span) * w;
    if (on.has('due')) {
      c.fillStyle = COLOURS.due;
      for (const ago of k.due) { const t = end - ago; c.fillRect(x(t - k.window), 0, Math.max(1, x(t + k.window) - x(t - k.window)), plotH); }
    }
    c.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const lane of lanes) {
      c.fillStyle = 'rgba(255, 255, 255, 0.03)';
      c.fillRect(0, lane.top, w, lane.height);
      if (lane.group === 'kicks') drawKickLane(c, view, samples, on, span, x, lane, whatIf);
      else for (const s of SIGNALS) if (s.group === lane.group && s.value && on.has(s.id)) drawLine(c, samples, s, x, lane);
      const name = lane.group;
      c.fillStyle = 'rgba(14, 10, 24, 0.75)';
      c.fillRect(2, lane.top + 2, c.measureText(name).width + 8, 13);
      c.fillStyle = COLOURS.muted;
      c.fillText(name, 6, lane.top + 12);
    }
    c.fillStyle = COLOURS.muted;
    const every = span <= WATCH ? 1 : span <= 20 ? 5 : 10;
    for (let s = every; s < span; s += every) c.fillText(`−${s}s`, x(end - s) + 2, h - 2);
    if (hover !== null) { c.fillStyle = 'rgba(255, 255, 255, 0.7)'; c.fillRect(Math.round(hover * w), 0, 1, plotH); }
  };
}

export function HearingWorkbench({ view }: { view: HearingView }) {
  const [settings, setSettings] = useState(loadWorkbench);
  const [frozen, setFrozen] = useState<HearingView | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [whatIf, setWhatIf] = useState(1);
  const pick = (next: WorkbenchSettings) => { setSettings(next); saveWorkbench(next); };

  const shown = frozen ?? view, { signals, span } = settings, on = new Set(signals);
  const k = shown.diagnostics.kicks, end = shown.diagnostics.at, latest = shown.history.samples.at(-1) ?? null;
  const preset = presetOf(signals), { height } = lanesFor(signals);
  const hoverAt = hover === null ? null : end - (1 - hover) * span;
  const hovered = hoverAt === null ? null : sampleAt(shown.history.samples, hoverAt);
  const kickHere = hoverAt !== null && shown.history.kicks.some((t) => Math.abs(t - hoverAt) < KICK_NEAR);

  return (
    <div className="hearing-bench">
      <div className="hearing-bench-bar">
        <span className="hearing-presets">
          {Object.entries(PRESETS).map(([name, ids]) => (
            <button key={name} type="button" aria-pressed={name === preset} onClick={() => pick({ ...settings, signals: [...ids] })}>{name}</button>
          ))}
        </span>
        <span className="hearing-bench-tools">
          <span className="hearing-seg" role="group" aria-label="How far back">
            {SPANS.map((s) => <button key={s} type="button" aria-pressed={s === span} onClick={() => pick({ ...settings, span: s })}>{s} s</button>)}
          </span>
          <button type="button" className="hearing-pause" aria-pressed={!!frozen} onClick={() => setFrozen(frozen ? null : view)}>{frozen ? '▶ Resume' : '❚❚ Pause'}</button>
        </span>
      </div>

      <div className="hearing-chips" id="hearing-inputs">
        {GROUPS.map((g) => (
          <span key={g} className="hearing-chip-group">
            <small>{g}</small>
            {SIGNALS.filter((s) => s.group === g).map((s) => (
              <button key={s.id} type="button" className="hearing-chip" aria-pressed={on.has(s.id)} data-signal={s.id}
                data-input={s.group === 'scene' ? s.id : undefined} style={{ '--chip': s.colour } as React.CSSProperties}
                title={`${s.help}. Click to show or hide; double-click to show only this.`}
                onClick={() => pick({ ...settings, signals: toggleSignal(signals, s.id) })}
                onDoubleClick={() => pick({ ...settings, signals: toggleSignal(signals, s.id, true) })}>
                {s.id}{s.value && s.group !== 'kicks' && latest && <output>{formatValue(s, s.value(latest))}</output>}
              </button>
            ))}
          </span>
        ))}
      </div>

      <div className="hearing-bench-plot" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(clamp01((e.clientX - r.left) / r.width)); }} onPointerLeave={() => setHover(null)}>
        {height
          ? <Plot label="Signals" height={height} draw={drawWorkbench(shown, signals, span, hover, whatIf)} />
          : <div className="hearing-meta">Pick a signal or a preset above</div>}
        {hover !== null && hovered && height > 0 && (
          <div className="hearing-tip" style={{ left: `${hover * 100}%`, transform: hover > 0.6 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}>
            <b>−{(end - hoverAt!).toFixed(2)} s</b>
            {kickHere && <div className="kick">kick</div>}
            {SIGNALS.filter((s) => s.value && on.has(s.id)).map((s) => <div key={s.id}><span style={{ color: s.colour }}>{s.id}</span> {formatValue(s, s.value!(hovered))}</div>)}
            {on.has('threshold') && <div><span className="average">threshold</span> {hovered.threshold.toFixed(1)}</div>}
          </div>
        )}
      </div>

      <div className="hearing-whatif">
        <label>
          <span>What if the threshold were</span>
          <input type="range" min={WHAT_IF[0]} max={WHAT_IF[1]} step={0.05} value={whatIf} onChange={(e) => setWhatIf(Number(e.target.value))} aria-label="What-if threshold" />
          <b>×{whatIf.toFixed(2)}</b>
        </label>
        {whatIf !== 1
          ? <span><span className="whatif">▼ {peaksOver(k.rises, k.cell, k.threshold * whatIf).length} rise peaks</span> would pass it in the last {WATCH} s; the Listener heard <span className="kick">{k.kicks.length} kicks</span>. <button type="button" onClick={() => setWhatIf(1)}>reset</button></span>
          : <span className="hearing-meta">Only shown: the Listener keeps its own threshold.</span>}
      </div>
    </div>
  );
}

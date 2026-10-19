// PROTOTYPE, throwaway (branch prototype/hearing-monitor-variants).
// Round four of "what should the Hearing monitor look like?": monitors you work with, not just watch.
//   K  Workbench  pick the signals to plot (chips, presets, double-click to solo), zoom 6/20/60 s, hover to read
//                 values, pause, and a what-if threshold (display only: the Listener is never changed)
//   L  Event log  what the Listener did, as a feed: kicks with their timing, tempo and state changes, warnings.
//                 Filter by kind, search, pause; click the timing histogram to filter kicks; open a row for its moment
//   M  Build your own  cards you add, hide, reorder (drag), size and collapse; narrow or wide; presets; remembered

import { useMemo, useState } from 'react';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { SCENE_INPUTS } from '../engine/scene-inputs';
import type { HearingView } from '../state/ui-state';
import { HelpButton } from './Help';
import { bar, COLOURS, drawKicks, drawSpectrum, frameRateLabel, InputRow, Plot, tempoLabel } from './HearingMonitor';
import { BAND_COLOURS, drawRadar, HEADLINES, hz, type Kicks, kicksOnTime, reasons, SPAN } from './HearingMonitor.prototype';
import {
  BANDS, bpmOf, confidenceOf, type Draw, drawCandidatesAxis, drawOffsets, drawSeries, drawSpectrumAxis, drawWaterfall, KEEP, kickOffsets, KickTable,
  LATELY, type Moment, Spark, useMoments,
} from './HearingMonitor.prototype-views';
import './HearingMonitor.prototype-interactive.css';

type Tone = 'good' | 'warn' | 'bad' | 'info';
// HearingMonitor's colours, copied: this module is loaded while HearingMonitor.tsx is still loading (it imports this
// one), so its COLOURS can't be read at the top level here.
const PALETTE = { line: '#4fe3ff', kick: '#ff4fd8', tick: '#4fffa0', threshold: '#ffd84f' } as const;
const KICK_GAP = 0.28;   // seconds between kicks, at least (as the KickHearer has it)

const nearestMoment = (moments: Moment[], at: number) =>
  moments.length ? moments.reduce((best, m) => (Math.abs(m.at - at) < Math.abs(best.at - at) ? m : best)) : null;

// Every kick or tick once, as a time on the moments' clock, from the moments that saw it.
function hitTimes(moments: Moment[], which: 'kicks' | 'ticks'): number[] {
  const seen = new Set<number>(), out: number[] = [];
  for (const m of moments) for (const ago of m.view.diagnostics.kicks[which]) {
    const at = m.at - ago, key = Math.round(at * 25);
    if (!seen.has(key) && !seen.has(key - 1) && !seen.has(key + 1)) { seen.add(key); out.push(at); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// K. Workbench

type Group = 'kick' | 'bands' | 'scene' | 'tempo';
interface Signal { key: string; group: Group; colour: string; pick?: (v: HearingView) => number | null; range?: [number, number] }

const SIGNALS: Signal[] = [
  { key: 'rise', group: 'kick', colour: PALETTE.line },
  { key: 'threshold', group: 'kick', colour: PALETTE.threshold },
  { key: 'due', group: 'kick', colour: 'rgba(255, 255, 255, 0.55)' },
  { key: 'kicks', group: 'kick', colour: PALETTE.kick },
  { key: 'ticks', group: 'kick', colour: PALETTE.tick },
  ...BANDS.map((b): Signal => ({ key: b, group: 'bands', colour: BAND_COLOURS[b], pick: (v) => v.diagnostics.bands[b].level, range: [0, 1] })),
  { key: 'uBeat', group: 'scene', colour: PALETTE.kick, pick: (v) => v.inputs.uBeat, range: [0, 1.5] },
  { key: 'uTick', group: 'scene', colour: PALETTE.tick, pick: (v) => v.inputs.uTick, range: [0, 1] },
  { key: 'uBass', group: 'scene', colour: '#4fe3ff', pick: (v) => v.inputs.uBass, range: [0, 1.5] },
  { key: 'uMood', group: 'scene', colour: '#ffd84f', pick: (v) => v.inputs.uMood, range: [0, 1] },
  { key: 'bpm', group: 'tempo', colour: PALETTE.line, pick: bpmOf, range: [60, 200] },
  { key: 'confidence', group: 'tempo', colour: PALETTE.tick, pick: confidenceOf, range: [0, 1] },
];
const GROUPS: Group[] = ['kick', 'bands', 'scene', 'tempo'];
const LANE_H: Record<Group, number> = { kick: 100, bands: 64, scene: 64, tempo: 52 };
const PRESETS: Record<string, string[]> = {
  'Kick debug': ['rise', 'threshold', 'due', 'kicks', 'ticks'],
  'Kick → scene': ['rise', 'kicks', 'ticks', 'uBeat', 'uTick'],
  Bands: ['bass', 'mid', 'high', 'level', 'uBass'],
  Tempo: ['kicks', 'ticks', 'bpm', 'confidence'],
  All: SIGNALS.map((s) => s.key),
};
const SPANS = [SPAN, LATELY, KEEP] as const;
const AXIS_H = 14, LANE_GAP = 6;

function laneLayout(enabled: Set<string>) {
  let y = 0;
  return GROUPS.filter((g) => SIGNALS.some((s) => s.group === g && enabled.has(s.key))).map((group) => {
    const lane = { group, top: y, h: LANE_H[group] };
    y += LANE_H[group] + LANE_GAP;
    return lane;
  });
}
const laneHeight = (enabled: Set<string>) => laneLayout(enabled).reduce((n, l) => n + l.h + LANE_GAP, 0) + AXIS_H;

// The rise peaks of the last 6 s over `line`, a kick's gap apart at least: what a different threshold would pick.
function peaksOver(k: Kicks, line: number): number[] {
  const r = k.rises, n = r.length, out: number[] = [];
  let last = Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (r[i]! < line || r[i]! < r[i - 1]! || r[i]! < r[i + 1]!) continue;
    const ago = (n - 1 - i) * k.cell;
    if (last - ago < KICK_GAP) continue;
    out.push(ago); last = ago;
  }
  return out;
}

function drawWorkbench(moments: Moment[], span: number, enabled: Set<string>, hover: number | null, whatIf: number): Draw {
  return (c, w, h) => {
    if (!moments.length) return;
    const last = moments[moments.length - 1]!, end = last.at, k = last.view.diagnostics.kicks;
    const shown = moments.filter((m) => end - m.at <= span), plotH = h - AXIS_H;
    const x = (at: number) => w - ((end - at) / span) * w;

    if (enabled.has('due')) {
      c.fillStyle = COLOURS.due;
      for (const due of k.due) { const at = end - due; c.fillRect(x(at - k.window), 0, Math.max(1, x(at + k.window) - x(at - k.window)), plotH); }
    }

    c.font = '10px ui-monospace, monospace';
    for (const lane of laneLayout(enabled)) {
      const { top, h: lh } = lane;
      c.fillStyle = 'rgba(255, 255, 255, 0.03)'; c.fillRect(0, top, w, lh);
      if (lane.group === 'kick') {
        // The rises: the current 6 s at full resolution, or each moment's newest when zoomed out.
        const rises: [number, number][] = span <= SPAN
          ? Array.from(k.rises, (v, i) => [end - (k.rises.length - 1 - i) * k.cell, v])
          : shown.map((m, i) => {
            const r = m.view.diagnostics.kicks.rises, dt = i ? m.at - shown[i - 1]!.at : 0.07;
            const n = Math.min(r.length, Math.max(1, Math.ceil(dt / k.cell)));
            let peak = 0;
            for (let j = r.length - n; j < r.length; j++) peak = Math.max(peak, r[j]!);
            return [m.at, peak];
          });
        const peak = Math.max(k.threshold * 2.5, ...rises.map(([, v]) => v), 1), y = (v: number) => top + lh - Math.min(1, v / peak) * (lh - 12);
        if (enabled.has('threshold')) {
          c.strokeStyle = COLOURS.threshold; c.setLineDash([3, 3]); c.beginPath();
          shown.forEach((m, i) => { const ty = y(m.view.diagnostics.kicks.threshold); if (i) c.lineTo(x(m.at), ty); else c.moveTo(x(m.at), ty); });
          c.stroke(); c.setLineDash([]);
        }
        if (enabled.has('rise')) {
          c.strokeStyle = COLOURS.line; c.beginPath();
          rises.forEach(([at, v], i) => (i ? c.lineTo(x(at), y(v)) : c.moveTo(x(at), y(v))));
          c.stroke();
        }
        if (whatIf !== 1) {
          const line = k.threshold * whatIf;
          c.strokeStyle = '#ff9f4f'; c.setLineDash([6, 3]);
          c.beginPath(); c.moveTo(x(end - SPAN), y(line)); c.lineTo(w, y(line)); c.stroke(); c.setLineDash([]);
          c.fillStyle = '#ff9f4f';
          for (const ago of peaksOver(k, line)) { const px = x(end - ago); c.beginPath(); c.moveTo(px - 4, top + 12); c.lineTo(px + 4, top + 12); c.lineTo(px, top + 18); c.fill(); }
        }
        if (enabled.has('kicks')) { c.fillStyle = COLOURS.kick; for (const at of hitTimes(shown, 'kicks')) c.fillRect(x(at) - 1, top + 1, 2, 9); }
        if (enabled.has('ticks')) { c.fillStyle = COLOURS.tick; for (const at of hitTimes(shown, 'ticks')) c.fillRect(x(at) - 1, top + lh - 7, 2, 6); }
      } else {
        for (const s of SIGNALS) {
          if (s.group !== lane.group || !s.pick || !enabled.has(s.key)) continue;
          const [lo, hi] = s.range!, y = (v: number) => top + lh - 1 - Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (lh - 2);
          c.strokeStyle = s.colour; c.beginPath();
          let on = false;
          for (const m of shown) {
            const v = s.pick(m.view);
            if (v === null) { on = false; continue; }
            if (on) c.lineTo(x(m.at), y(v)); else { c.moveTo(x(m.at), y(v)); on = true; }
          }
          c.stroke();
        }
      }
      c.fillStyle = 'rgba(14, 10, 24, 0.75)'; c.fillRect(2, top + 2, c.measureText(lane.group).width + 8, 13);
      c.fillStyle = COLOURS.muted; c.fillText(lane.group, 6, top + 12);
    }

    c.fillStyle = COLOURS.muted;
    const every = span <= SPAN ? 1 : span <= LATELY ? 5 : 10;
    for (let s = every; s < span; s += every) c.fillText(`-${s}s`, x(end - s) + 2, h - 2);
    if (hover !== null) { c.fillStyle = 'rgba(255, 255, 255, 0.7)'; c.fillRect(hover * w, 0, 1, plotH); }
  };
}

export function VariantK({ view }: { view: HearingView }) {
  const live = useMoments(view);
  const [enabled, setEnabled] = useState(() => new Set(PRESETS['Kick debug']));
  const [span, setSpan] = useState<number>(SPAN);
  const [paused, setPaused] = useState<Moment[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [whatIf, setWhatIf] = useState(1);
  const moments = paused ?? live, last = moments[moments.length - 1];
  const k = (last?.view ?? view).diagnostics.kicks;

  const toggle = (key: string) => setEnabled((on) => { const next = new Set(on); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const hoverAt = hover !== null && last ? last.at - (1 - hover) * span : null;
  const hovered = hoverAt !== null ? nearestMoment(moments, hoverAt) : null;
  const kicksNear = hoverAt !== null ? hitTimes(moments, 'kicks').filter((at) => Math.abs(at - hoverAt) < 0.06).length : 0;
  const peaks = whatIf !== 1 ? peaksOver(k, k.threshold * whatIf).length : 0;
  const preset = Object.entries(PRESETS).find(([, keys]) => keys.length === enabled.size && keys.every((key) => enabled.has(key)))?.[0];

  return (
    <div id="hearing" className="hearing pv-k">
      <header className="pv-k-head">
        <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
        <b id="hearing-tempo">{tempoLabel(view.diagnostics.tempo)}</b>
        <span id="hearing-state" data-state={view.diagnostics.tempo.state}>{HEADLINES[view.diagnostics.tempo.state]}</span>
        <span className="pv-k-tools">
          <span className="pv-seg">{SPANS.map((s) => <button key={s} type="button" aria-pressed={s === span} onClick={() => setSpan(s)}>{s} s</button>)}</span>
          <button type="button" aria-pressed={!!paused} onClick={() => setPaused(paused ? null : live)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>
          <HelpButton topic="hearing" />
        </span>
      </header>

      <div className="pv-k-presets">
        {Object.keys(PRESETS).map((name) => <button key={name} type="button" aria-pressed={name === preset} onClick={() => setEnabled(new Set(PRESETS[name]))}>{name}</button>)}
      </div>
      <div className="pv-k-chips">
        {GROUPS.map((g) => (
          <span key={g}>
            <small>{g}</small>
            {SIGNALS.filter((s) => s.group === g).map((s) => (
              <button key={s.key} type="button" aria-pressed={enabled.has(s.key)} style={{ '--chip': s.colour } as React.CSSProperties}
                onClick={() => toggle(s.key)} onDoubleClick={() => setEnabled(new Set([s.key]))} title="Click to show or hide; double-click to show only this">
                {s.key}
              </button>
            ))}
          </span>
        ))}
      </div>

      <div className="pv-k-plot" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }} onPointerLeave={() => setHover(null)}>
        {enabled.size
          ? <Plot label="Signals" height={laneHeight(enabled)} draw={drawWorkbench(moments, span, enabled, hover, whatIf)} />
          : <div className="hearing-meta">Pick a signal or a preset above</div>}
        {hovered && hover !== null && (
          <div className="pv-k-tip" style={{ left: `${hover * 100}%`, transform: `translateX(${hover > 0.6 ? 'calc(-100% - 8px)' : '8px'})` }}>
            <b>−{(last!.at - hoverAt!).toFixed(2)} s</b>
            {kicksNear > 0 && <div className="kick">kick here</div>}
            {SIGNALS.filter((s) => s.pick && enabled.has(s.key)).map((s) => {
              const v = s.pick!(hovered.view);
              return <div key={s.key}><span style={{ color: s.colour }}>{s.key}</span> {v === null ? '—' : v.toFixed(2)}</div>;
            })}
            {enabled.has('threshold') && <div><span className="average">threshold</span> {hovered.view.diagnostics.kicks.threshold.toFixed(1)}</div>}
          </div>
        )}
      </div>

      <div className="pv-k-whatif">
        <label>
          <span>What if the threshold were</span>
          <input type="range" min={0.4} max={2} step={0.05} value={whatIf} onChange={(e) => setWhatIf(Number(e.target.value))} />
          <b>×{whatIf.toFixed(2)}</b>
        </label>
        {whatIf !== 1
          ? <span><span style={{ color: '#ff9f4f' }}>▼ {peaks} rise peaks</span> would cross it in the last {SPAN} s; the Listener heard <span className="kick">{k.kicks.filter((a) => a <= SPAN).length} kicks</span>. <button type="button" onClick={() => setWhatIf(1)}>reset</button></span>
          : <span className="hearing-meta">Drag to see which rises a different threshold would pick. Display only: the Listener is not changed.</span>}
      </div>
      <div className="perf-hint">{paused ? 'Paused: hover to read the values' : 'Hover the plot to read values'} · close <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// L. Event log: the Listener's doings since the monitor opened, read off the views as they come.

type EventKind = 'kick' | 'tick' | 'tempo' | 'state' | 'warning';
interface HearingEvent { id: number; at: number; kind: EventKind; text: string; tone: Tone; offsetMs?: number }

const EVENTS: HearingEvent[] = [];
const SEEN_HITS = new Map<number, number>();   // a kick's or tick's time key → its time, to log each once
let lastLogged: { view: HearingView; bpm: number | null; state: string; confidence: number; slow: boolean; clipping: boolean } | null = null;
let nextEventId = 1;
const MAX_EVENTS = 600;

const confidenceBand = (c: number) => (c < 0.3 ? 0 : c < 0.6 ? 1 : 2);
const clippingOf = (v: HearingView) => { const s = v.diagnostics.spectrum; return !!s && s.bins.reduce((n, b) => n + (b >= 250 ? 1 : 0), 0) / s.bins.length > 0.05; };

function logMoment(m: Moment) {
  const v = m.view, d = v.diagnostics, t = d.tempo, slow = frameRateLabel(d.frameRate).slow, clipping = clippingOf(v);
  const add = (kind: EventKind, text: string, tone: Tone, at = m.at, offsetMs?: number) => EVENTS.push({ id: nextEventId++, at, kind, text, tone, offsetMs });
  if (!lastLogged) {
    add('state', `Monitor opened: ${HEADLINES[t.state].toLowerCase()}`, 'info');
  } else {
    const offsets = kickOffsets(d.kicks);
    for (const which of ['kicks', 'ticks'] as const) {
      for (const ago of d.kicks[which]) {
        const at = m.at - ago, key = Math.round(at * 25);
        if (SEEN_HITS.has(key) || SEEN_HITS.has(key - 1) || SEEN_HITS.has(key + 1)) continue;
        SEEN_HITS.set(key, at);
        if (which === 'ticks') { add('tick', `Tick ${v.inputs.uTicks}`, 'info', at); continue; }
        const o = offsets.find((x) => x.ago === ago);
        if (!o) add('kick', 'Kick, with no pulse to measure it against', 'info', at);
        else add('kick', `Kick ${o.ms >= 0 ? '+' : '−'}${Math.abs(Math.round(o.ms))} ms, ${o.onTime ? 'on time' : o.ms < 0 ? 'early' : 'late'}`, o.onTime ? 'good' : 'warn', at, o.ms);
      }
    }
    const was = lastLogged;
    if (was.bpm === null && t.bpm !== null) add('tempo', `Tempo found: ${t.bpm.toFixed(1)} BPM`, 'good');
    else if (was.bpm !== null && t.bpm === null) add('tempo', 'Tempo lost', 'bad');
    else if (was.bpm !== null && t.bpm !== null && Math.abs(t.bpm - was.bpm) >= 0.5) add('tempo', `Tempo ${was.bpm.toFixed(1)} → ${t.bpm.toFixed(1)} BPM`, 'info');
    if (was.state !== t.state) add('state', HEADLINES[t.state], t.state === 'hearing' ? 'good' : t.state === 'holding' ? 'warn' : 'bad');
    if (confidenceBand(was.confidence) !== confidenceBand(t.confidence)) {
      add('state', `Confidence ${t.confidence > was.confidence ? 'rose' : 'fell'} to ${Math.round(t.confidence * 100)} %`, t.confidence > was.confidence ? 'good' : 'warn');
    }
    if (slow !== was.slow) add('warning', slow ? `Frame rate fell to ${Math.round(d.frameRate)} fps: kicks slip through` : `Frame rate back to ${Math.round(d.frameRate)} fps`, slow ? 'bad' : 'good');
    if (clipping !== was.clipping) add('warning', clipping ? 'The spectrum started clipping' : 'The spectrum stopped clipping', clipping ? 'warn' : 'good');
  }
  const bpm = lastLogged && t.bpm !== null && lastLogged.bpm !== null && Math.abs(t.bpm - lastLogged.bpm) < 0.5 ? lastLogged.bpm : t.bpm;
  lastLogged = { view: v, bpm, state: t.state, confidence: t.confidence, slow, clipping };
  EVENTS.sort((a, b) => a.at - b.at);
  while (EVENTS.length > MAX_EVENTS) EVENTS.shift();
  for (const [key, at] of SEEN_HITS) if (m.at - at > KEEP + 10) SEEN_HITS.delete(key);
}

function useEvents(moments: Moment[]): HearingEvent[] {
  return useMemo(() => {
    const m = moments[moments.length - 1];
    if (m && lastLogged?.view !== m.view) logMoment(m);
    return EVENTS.slice();
  }, [moments]);
}

const KINDS: { kind: EventKind; label: string; colour: string }[] = [
  { kind: 'kick', label: 'Kicks', colour: PALETTE.kick },
  { kind: 'tick', label: 'Ticks', colour: PALETTE.tick },
  { kind: 'tempo', label: 'Tempo', colour: PALETTE.line },
  { kind: 'state', label: 'State', colour: '#ffd84f' },
  { kind: 'warning', label: 'Warnings', colour: '#ff4f7b' },
];
const KIND_COLOUR = Object.fromEntries(KINDS.map((k) => [k.kind, k.colour])) as Record<EventKind, string>;
const HIST_BINS = 15, HIST_MS = 150;   // bins across −150 … +150 ms
const binOf = (ms: number) => Math.min(HIST_BINS - 1, Math.max(0, Math.floor(((ms + HIST_MS) / (2 * HIST_MS)) * HIST_BINS)));

export function VariantL({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const all = useEvents(moments);
  const [kinds, setKinds] = useState<Set<EventKind>>(() => new Set(['kick', 'tempo', 'state', 'warning']));
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [bin, setBin] = useState<number | null>(null);
  const [paused, setPaused] = useState<HearingEvent[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const events = paused ?? all, now = moments[moments.length - 1]?.at ?? 0;

  const counts = Object.fromEntries(KINDS.map(({ kind }) => [kind, events.filter((e) => e.kind === kind).length])) as Record<EventKind, number>;
  const hist = new Array<number>(HIST_BINS).fill(0);
  for (const e of events) if (e.offsetMs !== undefined) hist[binOf(e.offsetMs)]!++;
  const histTop = Math.max(1, ...hist);
  const q = query.trim().toLowerCase();
  const shown = events.filter((e) =>
    kinds.has(e.kind)
    && (!problemsOnly || e.tone === 'warn' || e.tone === 'bad')
    && (!q || e.text.toLowerCase().includes(q))
    && (bin === null || (e.offsetMs !== undefined && binOf(e.offsetMs) === bin))).reverse().slice(0, 200);
  const toggle = (kind: EventKind) => setKinds((on) => { const next = new Set(on); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; });

  return (
    <div id="hearing" className="hearing pv-l">
      <header className="pv-k-head">
        <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
        <b id="hearing-tempo">{tempoLabel(view.diagnostics.tempo)}</b>
        <span className="pv-k-tools">
          <button type="button" aria-pressed={!!paused} onClick={() => setPaused(paused ? null : all)}>
            {paused ? `▶ Resume${all.length > paused.length ? ` (${all.length - paused.length} new)` : ''}` : '❚❚ Pause'}
          </button>
          <HelpButton topic="hearing" />
        </span>
      </header>

      <div className="pv-l-hist">
        <div className="pv-l-hist-bars">
          {hist.map((n, i) => {
            const mid = -HIST_MS + ((i + 0.5) / HIST_BINS) * 2 * HIST_MS, onTime = Math.abs(mid) <= (view.diagnostics.kicks.window * 1000 || 40);
            return (
              <button key={i} type="button" aria-pressed={bin === i} onClick={() => setBin(bin === i ? null : i)} title={`${Math.round(mid - HIST_MS / HIST_BINS)} … ${Math.round(mid + HIST_MS / HIST_BINS)} ms: ${n} kicks`}>
                <i style={{ height: `${(n / histTop) * 100}%`, background: onTime ? COLOURS.kick : '#ff9f4f' }} />
              </button>
            );
          })}
        </div>
        <div className="pv-l-hist-axis"><span>early {HIST_MS} ms</span><span>where the kicks landed{bin !== null ? ' · filtered, click again to clear' : ' · click a bar to filter'}</span><span>late {HIST_MS} ms</span></div>
      </div>

      <div className="pv-l-filters">
        {KINDS.map(({ kind, label, colour }) => (
          <button key={kind} type="button" aria-pressed={kinds.has(kind)} style={{ '--chip': colour } as React.CSSProperties} onClick={() => toggle(kind)} onDoubleClick={() => setKinds(new Set([kind]))}>
            {label} <small>{counts[kind]}</small>
          </button>
        ))}
        <button type="button" aria-pressed={problemsOnly} style={{ '--chip': '#ff4f7b' } as React.CSSProperties} onClick={() => setProblemsOnly(!problemsOnly)}>only problems</button>
      </div>
      <input className="pv-l-search" type="search" placeholder="Search: early, tempo, fps…" value={query} onChange={(e) => setQuery(e.target.value)} />

      <ol className="pv-l-list">
        {shown.length === 0 && <li className="hearing-meta">Nothing matches the filters</li>}
        {shown.map((e) => {
          const m = open === e.id ? nearestMoment(moments, e.at + 0.15) : null;
          return (
            <li key={e.id} data-tone={e.tone} data-open={open === e.id || undefined}>
              <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <time>−{Math.max(0, now - e.at).toFixed(1)} s</time>
                <i style={{ background: KIND_COLOUR[e.kind] }} />
                <span>{e.text}</span>
              </button>
              {open === e.id && (m
                ? <div className="pv-l-moment">
                  <Plot label="The kicks at that moment" height={60} draw={drawKicks(m.view.diagnostics.kicks)} />
                  <div className="pv-legend">the {SPAN} s up to then · {tempoLabel(m.view.diagnostics.tempo)} · {Math.round(m.view.diagnostics.tempo.confidence * 100)} % · uBeat {m.view.inputs.uBeat.toFixed(2)} · uTick {m.view.inputs.uTick.toFixed(2)}</div>
                </div>
                : <div className="hearing-meta">Too long ago: only the last {KEEP} s are kept</div>)}
            </li>
          );
        })}
      </ol>
      <div className="perf-hint">{shown.length} of {events.length} events · double-click a kind to show only it · close <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// M. Build your own: a stack (or, wide, a grid) of cards.

type CardId = 'tempo' | 'reasons' | 'kicks' | 'radar' | 'offsets' | 'spectrum' | 'waterfall' | 'bands' | 'candidates' | 'history' | 'inputs';
type Size = 's' | 'm' | 'l';
interface CardSlot { id: CardId; size: Size; collapsed?: boolean }
interface Layout { cards: CardSlot[]; wide: boolean }

const CARD_NAMES: Record<CardId, string> = {
  tempo: 'Tempo', reasons: 'Verdict', kicks: 'Kicks', radar: 'Radar', offsets: 'Kick timing', spectrum: 'Spectrum',
  waterfall: 'Waterfall', bands: 'Bands', candidates: 'Tempo candidates', history: 'Tempo history', inputs: 'Scene inputs',
};
const LAYOUT_PRESETS: Record<string, Layout> = {
  Performer: { wide: false, cards: [{ id: 'tempo', size: 'm' }, { id: 'kicks', size: 's' }, { id: 'inputs', size: 's' }] },
  'Kick doctor': { wide: true, cards: [{ id: 'tempo', size: 's' }, { id: 'reasons', size: 'm' }, { id: 'kicks', size: 'l' }, { id: 'radar', size: 'm' }, { id: 'offsets', size: 'l' }] },
  Sound: { wide: false, cards: [{ id: 'spectrum', size: 'l' }, { id: 'waterfall', size: 'm' }, { id: 'bands', size: 'm' }] },
  Everything: { wide: true, cards: (Object.keys(CARD_NAMES) as CardId[]).map((id) => ({ id, size: 'm' })) },
};
const LAYOUT_KEY = 'prototype-hearing-layout';
const H: Record<Size, number> = { s: 36, m: 80, l: 140 };

function loadLayout(): Layout {
  try { const saved = localStorage.getItem(LAYOUT_KEY); if (saved) return JSON.parse(saved) as Layout; } catch { /* no storage: the default */ }
  return LAYOUT_PRESETS['Kick doctor']!;
}
function saveLayout(layout: Layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* fine: not remembered */ }
}

function CardBody({ id, size, view, moments }: { id: CardId; size: Size; view: HearingView; moments: Moment[] }) {
  const d = view.diagnostics, t = d.tempo;
  switch (id) {
    case 'tempo': return (
      <div className={`pv-m-tempo pv-m-${size}`}>
        <b>{t.bpm === null ? '—' : t.bpm.toFixed(1)}<small> BPM</small></b>
        <span id="hearing-state" data-state={t.state}>{HEADLINES[t.state]}</span>
        <b className="hearing-bar"><i style={bar(t.confidence)} /></b>
      </div>
    );
    case 'reasons': {
      const all = reasons(view), list = size === 's' ? all.filter((r) => r.tone === 'bad' || r.tone === 'warn') : all;
      return <ul className="pv-b-reasons">{list.length ? list.map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>) : <li data-tone="good">Nothing wrong</li>}</ul>;
    }
    case 'kicks': return <Plot label="Kick signal" height={H[size] + 10} draw={drawKicks(d.kicks)} />;
    case 'radar': return <Plot label="Kicks folded onto the pulse" height={{ s: 150, m: 220, l: 300 }[size]} draw={drawRadar(view)} />;
    case 'offsets': {
      const offsets = kickOffsets(d.kicks), onTime = kicksOnTime(d.kicks);
      return <>
        <Plot label="How early or late each kick landed" height={size === 's' ? 40 : 56} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
        {onTime && <div className="pv-legend">{onTime.hit} of {onTime.of} on time</div>}
        {size === 'l' && <KickTable offsets={offsets} rows={5} />}
      </>;
    }
    case 'spectrum': return d.spectrum
      ? <Plot label="Spectrum" height={H[size]} draw={size === 's' ? drawSpectrum(d.spectrum) : drawSpectrumAxis(d.spectrum)} />
      : <div className="hearing-meta">Nothing connected</div>;
    case 'waterfall': return <Plot label="Spectrum lately" height={H[size]} draw={drawWaterfall(moments, LATELY)} />;
    case 'bands': return size === 'l'
      ? <Plot label="Bands lately" height={H.l} draw={drawSeries(moments, SPAN, BANDS.map((b) => ({ pick: (v: HearingView) => v.diagnostics.bands[b].level, colour: BAND_COLOURS[b] })), [0, 1])} />
      : <>{BANDS.map((b) => (
        <div key={b} className="hearing-row"><span>{b}</span><b className="hearing-bar"><i style={{ ...bar(d.bands[b].level), background: BAND_COLOURS[b] }} /><u style={{ left: `${Math.min(1, d.bands[b].average) * 100}%` }} /></b></div>
      ))}</>;
    case 'candidates': return <Plot label="Tempo candidates" height={H[size] + 14} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />;
    case 'history': return <Plot label="Tempo and confidence lately" height={H[size]} draw={drawSeries(moments, LATELY, [{ pick: (v) => (bpmOf(v) ?? 0) / 200, colour: COLOURS.line }, { pick: confidenceOf, colour: COLOURS.tick }], [0, 1])} />;
    case 'inputs':
      if (size === 's') return <div className="pv-m-numbers">{(['uBeat', 'uTick', 'uBass', 'uTicks'] as const).map((u) => <span key={u}>{u} <b>{u === 'uTicks' ? view.inputs[u] : view.inputs[u].toFixed(2)}</b></span>)}</div>;
      if (size === 'm') return <>{SCENE_INPUTS.map((input) => <InputRow key={input.uniform} input={input} value={view.inputs[input.uniform]} />)}</>;
      return <>{SCENE_INPUTS.map((input) => (
        <div key={input.uniform} className="pv-spark-row"><span>{input.uniform}</span><Spark moments={moments} pick={(v) => v.inputs[input.uniform]} label={input.uniform} /><output>{view.inputs[input.uniform].toFixed(2)}</output></div>
      ))}</>;
  }
}

export function VariantM({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const [layout, setLayoutState] = useState(loadLayout);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<CardId | null>(null);
  const setLayout = (next: Layout) => { setLayoutState(next); saveLayout(next); };
  const update = (id: CardId, change: Partial<CardSlot>) => setLayout({ ...layout, cards: layout.cards.map((c) => (c.id === id ? { ...c, ...change } : c)) });
  const move = (id: CardId, to: number) => {
    const cards = layout.cards.filter((c) => c.id !== id), card = layout.cards.find((c) => c.id === id)!;
    cards.splice(Math.max(0, Math.min(cards.length, to)), 0, card);
    setLayout({ ...layout, cards });
  };
  const hidden = (Object.keys(CARD_NAMES) as CardId[]).filter((id) => !layout.cards.some((c) => c.id === id));
  const preset = Object.entries(LAYOUT_PRESETS).find(([, p]) => JSON.stringify(p) === JSON.stringify(layout))?.[0];

  return (
    <div id="hearing" className="hearing pv-m" data-wide={layout.wide || undefined} data-editing={editing || undefined}>
      <header className="pv-k-head">
        <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
        <b>Hearing</b>
        <span className="pv-k-tools">
          <span className="pv-seg">
            <button type="button" aria-pressed={!layout.wide} onClick={() => setLayout({ ...layout, wide: false })}>Narrow</button>
            <button type="button" aria-pressed={layout.wide} onClick={() => setLayout({ ...layout, wide: true })}>Wide</button>
          </span>
          <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? '✓ Done' : '✎ Edit'}</button>
          <HelpButton topic="hearing" />
        </span>
      </header>

      {editing && (
        <div className="pv-m-edit">
          <div><small>Start from</small>{Object.keys(LAYOUT_PRESETS).map((name) => <button key={name} type="button" aria-pressed={name === preset} onClick={() => setLayout(LAYOUT_PRESETS[name]!)}>{name}</button>)}</div>
          {hidden.length > 0 && <div><small>Add</small>{hidden.map((id) => <button key={id} type="button" onClick={() => setLayout({ ...layout, cards: [...layout.cards, { id, size: 'm' }] })}>+ {CARD_NAMES[id]}</button>)}</div>}
          <div className="hearing-meta">Drag a card by its title to move it.</div>
        </div>
      )}

      <div className="pv-m-cards">
        {layout.cards.map((slot, i) => (
          <section key={slot.id} className="pv-m-card" data-size={slot.size} data-dragging={dragging === slot.id || undefined}
            onDragOver={(e) => { if (dragging) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== slot.id) move(dragging, i); setDragging(null); }}>
            <h4 draggable={editing} onDragStart={() => setDragging(slot.id)} onDragEnd={() => setDragging(null)}>
              {editing && <span className="pv-m-grip" aria-hidden>⠿</span>}
              <button type="button" className="pv-m-title" onClick={() => update(slot.id, { collapsed: !slot.collapsed })}>{slot.collapsed ? '▸' : '▾'} {CARD_NAMES[slot.id]}</button>
              {editing && (
                <span className="pv-m-card-tools">
                  <span className="pv-seg">{(['s', 'm', 'l'] as const).map((s) => <button key={s} type="button" aria-pressed={slot.size === s} onClick={() => update(slot.id, { size: s })}>{s.toUpperCase()}</button>)}</span>
                  <button type="button" onClick={() => move(slot.id, i - 1)} disabled={i === 0} title="Move up">↑</button>
                  <button type="button" onClick={() => move(slot.id, i + 1)} disabled={i === layout.cards.length - 1} title="Move down">↓</button>
                  <button type="button" onClick={() => setLayout({ ...layout, cards: layout.cards.filter((c) => c.id !== slot.id) })} title="Hide">×</button>
                </span>
              )}
            </h4>
            {!slot.collapsed && <CardBody id={slot.id} size={slot.size} view={view} moments={moments} />}
          </section>
        ))}
        {layout.cards.length === 0 && <div className="hearing-meta">No cards: press ✎ Edit to add some</div>}
      </div>
      <div className="perf-hint">tone {hz(view.centroid)} · {frameRateLabel(view.diagnostics.frameRate).text} · close <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

// PROTOTYPE, throwaway (branch prototype/hearing-monitor-variants).
// Round two of "what should the Hearing monitor look like?": each variant splits the monitor into views and moves
// between them its own way. In all of them Alt+↑/↓ step through the views and ?view= keeps the one shown.
//   E  Tabs       the compact corner panel with a tab per question: overview, kicks, tempo, sound, scene
//   F  Flow       the hearing as a pipeline (sound → bands → kicks → tempo → Look → scene); open a stage to see inside
//   G  Inspector  a big window over the visuals, a rail of views, each drawn at full size
// The views also show history (sparklines, the tempo over 20 s, a waterfall), kept here in memory while open.

import { useMemo } from 'react';
import type { HearingDiagnostics } from '../engine/listener';
import { SCENE_INPUTS, type InputUniform } from '../engine/scene-inputs';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import type { HearingView } from '../state/ui-state';
import { HelpButton } from './Help';
import {
  bar, COLOURS, drawCandidates, drawKicks, drawSpectrum, frameRateLabel, InputRow, latencyLabel, logX, Plot, tempoLabel, tickLagLabel,
} from './HearingMonitor';
import {
  BAND_COLOURS, drawRadar, foldSpectrum, HEADLINES, heat, hz, type Kicks, kicksOnTime, pulsePeriod, reasons, SPAN, SPEC_ROWS, Timeline,
} from './HearingMonitor.prototype';
import { usePrototypeView } from './PrototypeSwitcher';
import './HearingMonitor.prototype-views.css';

export type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;
export const BANDS = ['bass', 'mid', 'high', 'level'] as const;
export const SCENE_OF = { bass: 'uBass', mid: 'uMid', high: 'uHigh', level: 'uLevel' } as const satisfies Record<(typeof BANDS)[number], InputUniform>;

// ------------------------------------------------------------------------------------------------------------------
// History: every HearingView the monitor got in the last minute (~15 a second), shared by the variants.

export interface Moment { at: number; view: HearingView; spec: Uint8Array }
const MOMENTS: Moment[] = [];
export const KEEP = 60;          // seconds of history kept (the Tape variant scrubs all of it) ...
export const LATELY = 20;  // ... and shown by the views that look back

export function useMoments(view: HearingView): Moment[] {
  return useMemo(() => {
    if (MOMENTS[MOMENTS.length - 1]?.view !== view) {
      const at = performance.now() / 1000;   // eslint-disable-line react-hooks/purity -- PROTOTYPE: the history is kept outside React
      MOMENTS.push({ at, view, spec: foldSpectrum(view.diagnostics.spectrum) });
      while (at - MOMENTS[0]!.at > KEEP) MOMENTS.shift();
    }
    return MOMENTS.slice();
  }, [view]);
}

export interface Series { pick: (v: HearingView) => number | null; colour: string; fill?: boolean }

// Values over the last `span` seconds, newest at the right, between `bottom` and `top` (both found when left out).
export function drawSeries(moments: Moment[], span: number, series: Series[], range?: [number, number]): Draw {
  return (c, w, h) => {
    if (moments.length < 2) return;
    const latest = moments[moments.length - 1]!.at, shown = moments.filter((m) => latest - m.at <= span);
    let [bottom, top] = range ?? [Infinity, -Infinity];
    if (!range) for (const s of series) for (const m of shown) { const v = s.pick(m.view); if (v !== null) { bottom = Math.min(bottom, v); top = Math.max(top, v); } }
    if (!(top > bottom)) { top = bottom + 1; }
    const x = (at: number) => w - ((latest - at) / span) * w, y = (v: number) => h - 1 - Math.min(1, Math.max(0, (v - bottom) / (top - bottom))) * (h - 2);
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
    for (const s of series) {
      const points = shown.flatMap((m) => { const v = s.pick(m.view); return v === null ? [] : [[x(m.at), y(v)] as const]; });
      if (points.length < 2) continue;
      c.beginPath();
      points.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.strokeStyle = s.colour; c.stroke();
      if (s.fill) {
        c.lineTo(points[points.length - 1]![0], h); c.lineTo(points[0]![0], h); c.closePath();
        c.globalAlpha = 0.18; c.fillStyle = s.colour; c.fill(); c.globalAlpha = 1;
      }
    }
  };
}

export function Spark({ moments, pick, colour = COLOURS.line, span = SPAN, range, height = 22, label }: { moments: Moment[]; pick: Series['pick']; colour?: string; span?: number; range?: [number, number]; height?: number; label: string }) {
  return <Plot label={label} height={height} draw={drawSeries(moments, span, [{ pick, colour, fill: true }], range)} />;
}

export const bpmOf = (v: HearingView) => v.diagnostics.tempo.bpm;
export const confidenceOf = (v: HearingView) => v.diagnostics.tempo.confidence;

// ------------------------------------------------------------------------------------------------------------------
// Kicks against the pulse: how early or late each one landed.

export interface Offset { ago: number; ms: number; onTime: boolean }

export function kickOffsets(k: Kicks): Offset[] {
  if (!k.due.length) return [];
  const reach = Math.max(...k.due) + pulsePeriod(k) / 2;
  return k.kicks.filter((ago) => ago <= reach).map((ago) => {
    const due = k.due.reduce((best, d) => (Math.abs(d - ago) < Math.abs(best - ago) ? d : best));
    return { ago, ms: (due - ago) * 1000, onTime: Math.abs(due - ago) <= k.window };
  });
}

// Each kick on a line from early to late, the window where it counts as on time shaded.
export function drawOffsets(offsets: Offset[], windowMs: number): Draw {
  return (c, w, h) => {
    const plot = h - 12, range = Math.max(100, windowMs * 3);
    const x = (ms: number) => w / 2 + (Math.max(-range, Math.min(range, ms)) / range) * (w / 2 - 5);
    c.fillStyle = COLOURS.due; c.fillRect(x(-windowMs), 0, x(windowMs) - x(-windowMs), plot);
    c.strokeStyle = COLOURS.grid; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, plot); c.stroke();
    offsets.forEach((o, i) => {
      c.globalAlpha = 1 - (Math.min(o.ago, SPAN) / SPAN) * 0.7;
      c.fillStyle = o.onTime ? COLOURS.kick : '#ff9f4f';
      c.beginPath(); c.arc(x(o.ms), 5 + ((i * 7) % Math.max(1, plot - 10)), 3.5, 0, Math.PI * 2); c.fill();
    });
    c.globalAlpha = 1;
    c.fillStyle = COLOURS.muted; c.font = '10px ui-monospace, monospace';
    c.fillText(`early ${range} ms`, 0, h - 1);
    c.textAlign = 'center'; c.fillText('due', w / 2, h - 1);
    c.textAlign = 'right'; c.fillText(`late ${range} ms`, w, h - 1);
    c.textAlign = 'start';
  };
}

export function KickTable({ offsets, rows = 8 }: { offsets: Offset[]; rows?: number }) {
  const latest = [...offsets].sort((a, b) => a.ago - b.ago).slice(0, rows);
  if (!latest.length) return <div className="hearing-meta">No kicks near a due pulse yet</div>;
  return (
    <table className="pv-kick-table">
      <thead><tr><th>kick</th><th>when</th><th>against the pulse</th></tr></thead>
      <tbody>
        {latest.map((o, i) => (
          <tr key={o.ago} data-on={o.onTime || undefined}>
            <td>{i === 0 ? 'latest' : `−${i}`}</td>
            <td>{o.ago.toFixed(2)} s ago</td>
            <td>{o.ms >= 0 ? '+' : '−'}{Math.abs(Math.round(o.ms))} ms {o.onTime ? 'on time' : o.ms < 0 ? 'early' : 'late'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Bigger plots, with axes, for the views that have room.

export function drawCandidatesAxis(cand: HearingDiagnostics['candidates'], heard: number | null): Draw {
  const inner = drawCandidates(cand, heard);
  return (c, w, h) => {
    inner(c, w, h - 14);
    if (cand.bpm.length < 2) return;
    const lo = cand.bpm[0]!, hi = cand.bpm[cand.bpm.length - 1]!;
    c.fillStyle = COLOURS.muted; c.font = '10px ui-monospace, monospace'; c.textAlign = 'center';
    for (let b = Math.ceil(lo / 20) * 20; b <= hi; b += 20) {
      const px = ((b - lo) / (hi - lo)) * w;
      c.fillRect(px, h - 14, 1, 3);
      c.fillText(String(b), Math.min(w - 10, Math.max(10, px)), h - 2);
    }
    c.textAlign = 'start';
  };
}

const BAND_SPANS = [['bass', 25, 140], ['mid', 140, 2000], ['high', 2000, 12000]] as const;
const HZ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

export function drawSpectrumAxis(s: NonNullable<HearingDiagnostics['spectrum']>): Draw {
  const inner = drawSpectrum(s);
  return (c, w, h) => {
    const plot = h - 14;
    c.font = '10px ui-monospace, monospace';
    for (const [name, lo, hi] of BAND_SPANS) {
      c.globalAlpha = 0.1; c.fillStyle = BAND_COLOURS[name]; c.fillRect(logX(lo, w), 0, logX(hi, w) - logX(lo, w), plot);
      c.globalAlpha = 1; c.fillText(name, logX(lo, w) + 4, 11);
    }
    inner(c, w, plot);
    c.fillStyle = COLOURS.muted; c.textAlign = 'center';
    for (const f of HZ_TICKS) { const px = logX(f, w); c.fillRect(px, plot, 1, 3); c.fillText(f >= 1000 ? `${f / 1000}k` : String(f), px, h - 2); }
    c.textAlign = 'start';
  };
}

// The spectrum over the last seconds: frequency up, time along, loudness as heat.
export function drawWaterfall(moments: Moment[], span: number): Draw {
  return (c, w, h) => {
    if (!moments.length) return;
    const latest = moments[moments.length - 1]!.at, x = (at: number) => w - ((latest - at) / span) * w, rh = h / SPEC_ROWS;
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]!, x0 = x(m.at), x1 = i + 1 < moments.length ? x(moments[i + 1]!.at) : w;
      if (x1 < 0) continue;
      for (let r = 0; r < SPEC_ROWS; r++) {
        if (m.spec[r]! < 30) continue;
        c.fillStyle = heat(m.spec[r]!);
        c.fillRect(x0, h - (r + 1) * rh, Math.max(1, x1 - x0 + 0.5), rh + 0.5);
      }
    }
  };
}

function Head({ view }: { view: HearingView }) {
  const t = view.diagnostics.tempo;
  return (
    <div className="hearing-head">
      <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
      <b id="hearing-tempo">{tempoLabel(t)}</b>
      <span id="hearing-state" data-state={t.state}>{HEADLINES[t.state]}</span>
      <HelpButton topic="hearing" />
    </div>
  );
}

export const KeyHint = ({ what }: { what: string }) => (
  <div className="perf-hint pv-hint"><span><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> {what}</span><span>close <Kbd hotkey={HOTKEYS.hearingMonitor} /></span></div>
);

// ------------------------------------------------------------------------------------------------------------------
// E. Tabs: the corner panel, one question a tab. The overview's cards open the other tabs.

const E_TABS = ['overview', 'kicks', 'tempo', 'sound', 'scene'] as const;
type ETab = (typeof E_TABS)[number];

function Card({ to, open, title, summary, children }: { to: ETab; open: (tab: ETab) => void; title: string; summary: string; children: React.ReactNode }) {
  return (
    <button type="button" className="pv-e-card" onClick={() => open(to)}>
      <span>{title} →</span><small>{summary}</small>{children}
    </button>
  );
}

export function VariantE({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const [tab, setTab] = usePrototypeView(E_TABS);
  const d = view.diagnostics, t = d.tempo, offsets = kickOffsets(d.kicks), onTime = kicksOnTime(d.kicks);

  return (
    <div id="hearing" className="hearing pv-e">
      <Head view={view} />
      <nav className="pv-tabs" role="tablist">
        {E_TABS.map((v) => <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => setTab(v)}>{v}</button>)}
      </nav>
      <div className="pv-e-body">
        {tab === 'overview' && <>
          <div className="hearing-row" title="Confidence"><span>Confidence</span><b className="hearing-bar"><i style={bar(t.confidence)} /></b></div>
          <ul className="pv-b-reasons">{reasons(view).map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}</ul>
          <div className="pv-e-cards">
            <Card open={setTab} to="kicks" title="Kicks" summary={onTime ? `${onTime.hit}/${onTime.of} on time` : 'none heard'}>
              <Plot label="Kick signal" height={30} draw={drawKicks(d.kicks)} />
            </Card>
            <Card open={setTab} to="tempo" title="Tempo" summary={`${Math.round(t.confidence * 100)} % sure`}>
              <Spark moments={moments} pick={confidenceOf} span={LATELY} range={[0, 1]} height={30} label="Confidence lately" />
            </Card>
            <Card open={setTab} to="sound" title="Sound" summary={`tone ${hz(view.centroid)}`}>
              {d.spectrum ? <Plot label="Spectrum" height={30} draw={drawSpectrum(d.spectrum)} /> : <i />}
            </Card>
            <Card open={setTab} to="scene" title="Scene" summary={`uBeat ${view.inputs.uBeat.toFixed(2)}`}>
              <Spark moments={moments} pick={(v) => v.inputs.uBeat} colour={COLOURS.kick} range={[0, 1.5]} height={30} label="uBeat lately" />
            </Card>
          </div>
        </>}

        {tab === 'kicks' && <>
          <Plot label="Kick signal" height={120} draw={drawKicks(d.kicks)} />
          <div className="pv-legend">rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span></div>
          <h4>Against the pulse <small>{onTime ? `${onTime.hit} of ${onTime.of} on time` : ''} · window ±{Math.round(d.kicks.window * 1000)} ms</small></h4>
          <Plot label="How early or late each kick landed" height={52} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
          <KickTable offsets={offsets} rows={6} />
          <div className="hearing-meta">{tickLagLabel(d.tickLag)}</div>
        </>}

        {tab === 'tempo' && <>
          <h4>Tempo <small>last {LATELY} s, 60–200 BPM</small></h4>
          <Spark moments={moments} pick={bpmOf} span={LATELY} range={[60, 200]} height={48} label="Tempo lately" />
          <h4>Confidence <small>last {LATELY} s</small></h4>
          <Spark moments={moments} pick={confidenceOf} span={LATELY} range={[0, 1]} height={32} colour={COLOURS.tick} label="Confidence lately" />
          <h4>Candidates <small>strength · <span className="average">clear enough</span> · preference</small></h4>
          <Plot label="Tempo candidates" height={84} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />
          {t.heardBpm !== null && t.bpm !== null && Math.abs(t.heardBpm - t.bpm) > 0.5 && <div className="hearing-meta">The kicks gave {Math.round(t.heardBpm)} BPM; folded into the tempo range it is {t.bpm.toFixed(1)}</div>}
        </>}

        {tab === 'sound' && <>
          {d.spectrum ? <Plot label="Spectrum" height={84} draw={drawSpectrumAxis(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}
          <h4>Bands <small>last {SPAN} s · now</small></h4>
          {BANDS.map((b) => (
            <div key={b} className="pv-spark-row"><span>{b}</span><Spark moments={moments} pick={(v) => v.diagnostics.bands[b].level} colour={BAND_COLOURS[b]} range={[0, 1]} label={`${b} lately`} /><output>{d.bands[b].level.toFixed(2)}</output></div>
          ))}
          <h4>Character <small>changes over seconds</small></h4>
          <div className="pv-spark-row"><span>tone</span><Spark moments={moments} pick={(v) => v.centroid} span={LATELY} label="Tone lately" /><output>{hz(view.centroid)}</output></div>
          <div className="pv-spark-row"><span>energy</span><Spark moments={moments} pick={(v) => v.energy} span={LATELY} range={[0, 1]} label="Energy lately" /><output>{view.energy.toFixed(2)}</output></div>
          <div className="pv-spark-row"><span>mood</span><Spark moments={moments} pick={(v) => v.mood} span={LATELY} range={[0, 1]} label="Mood lately" /><output>{view.mood.toFixed(2)}</output></div>
        </>}

        {tab === 'scene' && <>
          <h4>Scene inputs <small>last {SPAN} s, after the Look</small></h4>
          {SCENE_INPUTS.map((input) => {
            const v = view.inputs[input.uniform];
            return (
              <div key={input.uniform} className="pv-spark-row" title={input.help}>
                <span>{input.uniform}</span>
                <Spark moments={moments} pick={(m) => m.inputs[input.uniform]} label={`${input.uniform} lately`} />
                <output>{Number.isInteger(v) ? v : v.toFixed(2)}</output>
              </div>
            );
          })}
        </>}
      </div>
      <KeyHint what="tabs" />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// F. Flow: the stages the sound goes through, in order. The map opens a stage; a stage steps to its neighbours.

const STAGES = ['sound', 'bands', 'kicks', 'tempo', 'look', 'scene'] as const;
type Stage = (typeof STAGES)[number];
const F_VIEWS = ['flow', ...STAGES] as const;

const STAGE_INFO: Record<Stage, { name: string; what: string; from: Stage[]; into: Stage[] }> = {
  sound: { name: 'Sound', what: 'What the analyser hears: how loud each frequency is, this frame.', from: [], into: ['bands', 'kicks'] },
  bands: { name: 'Bands', what: 'Bass 25–140 Hz, mid 140 Hz–2 kHz, high 2–12 kHz and all of them, each against its own running average.', from: ['sound'], into: ['look'] },
  kicks: { name: 'Kicks', what: 'How much the kick’s bins (20–280 Hz) rose in each 10 ms. A kick is a rise over the threshold; near a due pulse it counts toward the tempo.', from: ['sound'], into: ['tempo', 'look'] },
  tempo: { name: 'Tempo', what: 'Which pulse the rises repeat at, folded into the tempo range. The ticks run on it, through breakdowns too.', from: ['kicks'], into: ['scene'] },
  look: { name: 'Look', what: 'The Look’s reactivity and settings scale what was heard before the scene gets it.', from: ['bands', 'kicks'], into: ['scene'] },
  scene: { name: 'Scene', what: 'The uniforms every scene’s shader reads, this frame.', from: ['look', 'tempo'], into: [] },
};

function stageSummary(stage: Stage, view: HearingView): string {
  const d = view.diagnostics, t = d.tempo, onTime = kicksOnTime(d.kicks);
  switch (stage) {
    case 'sound': {
      if (!d.spectrum) return 'nothing connected';
      const clipped = d.spectrum.bins.reduce((n, b) => n + (b >= 250 ? 1 : 0), 0) / d.spectrum.bins.length;
      return `tone ${hz(view.centroid)}${clipped > 0.05 ? ` · ${Math.round(clipped * 100)} % clips` : ''}`;
    }
    case 'bands': return BANDS.slice(0, 3).map((b) => `${b} ${d.bands[b].level.toFixed(2)}`).join(' · ');
    case 'kicks': return onTime ? `${onTime.hit} of ${onTime.of} on time` : 'no kicks near a pulse';
    case 'tempo': return `${tempoLabel(t)} · ${Math.round(t.confidence * 100)} %`;
    case 'look': return `bass ×${(view.inputs.uBass / Math.max(0.01, d.bands.bass.shown)).toFixed(2)} on the way to the scene`;
    case 'scene': return `uBeat ${view.inputs.uBeat.toFixed(2)} · uTick ${view.inputs.uTick.toFixed(2)} · uTicks ${view.inputs.uTicks}`;
  }
}

function StageMini({ stage, view, moments }: { stage: Stage; view: HearingView; moments: Moment[] }) {
  const d = view.diagnostics;
  switch (stage) {
    case 'sound': return d.spectrum ? <Plot label="Spectrum" height={30} draw={drawSpectrum(d.spectrum)} /> : null;
    case 'bands': return <div className="pv-f-minibars">{BANDS.map((b) => <i key={b} style={{ transform: `scaleY(${Math.min(1, d.bands[b].level)})`, background: BAND_COLOURS[b] }} />)}</div>;
    case 'kicks': return <Plot label="Kick signal" height={30} draw={drawKicks(d.kicks)} />;
    case 'tempo': return <Spark moments={moments} pick={bpmOf} span={LATELY} range={[60, 200]} height={30} label="Tempo lately" />;
    case 'look': return <div className="pv-f-minibars">{BANDS.map((b) => <i key={b} style={{ transform: `scaleY(${Math.min(1, view.inputs[SCENE_OF[b]] / 1.5)})`, background: 'var(--accent2)' }} />)}</div>;
    case 'scene': return <Spark moments={moments} pick={(v) => v.inputs.uBeat} colour={COLOURS.kick} range={[0, 1.5]} height={30} label="uBeat lately" />;
  }
}

function StageDetail({ stage, view, moments }: { stage: Stage; view: HearingView; moments: Moment[] }) {
  const d = view.diagnostics, t = d.tempo;
  switch (stage) {
    case 'sound': return d.spectrum ? <>
      <Plot label="Spectrum" height={110} draw={drawSpectrumAxis(d.spectrum)} />
      <div className="pv-legend">the top is where it clips · tone {hz(view.centroid)} · energy {view.energy.toFixed(2)}</div>
      <h4>Lately <small>last {LATELY} s</small></h4>
      <Plot label="Spectrum lately" height={80} draw={drawWaterfall(moments, LATELY)} />
    </> : <div className="hearing-meta">Nothing connected</div>;
    case 'bands': return <>
      <Plot label="Bands lately" height={80} draw={drawSeries(moments, SPAN, BANDS.map((b) => ({ pick: (v: HearingView) => v.diagnostics.bands[b].level, colour: BAND_COLOURS[b] })), [0, 1])} />
      <div className="pv-legend">{BANDS.map((b) => <span key={b} style={{ color: BAND_COLOURS[b] }}>{b} </span>)}· last {SPAN} s</div>
      <h4>Now <small>level · <span className="average">running average</span></small></h4>
      {BANDS.map((b) => (
        <div key={b} className="hearing-row"><span>{b}</span><b className="hearing-bar"><i style={bar(d.bands[b].level)} /><u style={{ left: `${Math.min(1, d.bands[b].average) * 100}%` }} /></b></div>
      ))}
    </>;
    case 'kicks': {
      const offsets = kickOffsets(d.kicks);
      return <>
        <Plot label="Kick signal" height={110} draw={drawKicks(d.kicks)} />
        <div className="pv-legend">rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span></div>
        <h4>Against the pulse <small>window ±{Math.round(d.kicks.window * 1000)} ms</small></h4>
        <Plot label="How early or late each kick landed" height={52} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
        <KickTable offsets={offsets} rows={5} />
      </>;
    }
    case 'tempo': return <>
      <Plot label="Tempo candidates" height={96} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />
      <div className="pv-legend">strength · <span className="average">clear enough</span> · preference · <span className="kick">heard</span></div>
      <h4>Tempo and confidence <small>last {LATELY} s</small></h4>
      <Plot label="Tempo and confidence lately" height={60} draw={drawSeries(moments, LATELY, [{ pick: (v) => (bpmOf(v) ?? 0) / 200, colour: COLOURS.line }, { pick: confidenceOf, colour: COLOURS.tick }], [0, 1])} />
      <div className="hearing-meta">{tickLagLabel(d.tickLag)} · {frameRateLabel(d.frameRate).text}</div>
    </>;
    case 'look': return <>
      <table className="pv-f-look">
        <thead><tr><th /><th>heard</th><th>hearing gives</th><th>scene gets</th><th /></tr></thead>
        <tbody>
          {BANDS.map((b) => {
            const scene = view.inputs[SCENE_OF[b]];
            return (
              <tr key={b}>
                <td>{b}</td>
                <td><b className="hearing-bar"><i style={bar(d.bands[b].level)} /></b></td>
                <td><b className="hearing-bar"><i style={bar(d.bands[b].shown)} /></b></td>
                <td><b className="hearing-bar"><i style={bar(scene / 1.5)} /><u style={{ left: `${100 / 1.5}%` }} /></b></td>
                <td>×{(scene / Math.max(0.01, d.bands[b].shown)).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="pv-legend">scene bars reach 1.5 at high reactivity; <span className="average">the mark</span> is 1</div>
      <h4>Kick to uBeat <small>last {SPAN} s</small></h4>
      <Plot label="uBeat lately, with the kicks" height={50} draw={drawSeries(moments, SPAN, [{ pick: (v) => v.inputs.uBeat, colour: COLOURS.kick, fill: true }], [0, 1.5])} />
    </>;
    case 'scene': return <>{SCENE_INPUTS.map((input) => <InputRow key={input.uniform} input={input} value={view.inputs[input.uniform]} />)}</>;
  }
}

export function VariantF({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const [at, go] = usePrototypeView(F_VIEWS);

  if (at === 'flow') {
    return (
      <div id="hearing" className="hearing pv-f">
        <Head view={view} />
        <div className="pv-f-map">
          {STAGES.map((s, i) => (
            <div key={s}>
              {i > 0 && <div className="pv-f-arrow" aria-hidden>↓</div>}
              <button type="button" className="pv-f-node" onClick={() => go(s)}>
                <i>{i + 1}</i>
                <span><b>{STAGE_INFO[s].name}</b><small>{stageSummary(s, view)}</small></span>
                <span className="pv-f-mini"><StageMini stage={s} view={view} moments={moments} /></span>
              </button>
            </div>
          ))}
        </div>
        <KeyHint what="stages" />
      </div>
    );
  }

  const info = STAGE_INFO[at], i = STAGES.indexOf(at), prev = STAGES[i - 1], next = STAGES[i + 1];
  return (
    <div id="hearing" className="hearing pv-f">
      <div className="pv-f-crumbs">
        <button type="button" onClick={() => go('flow')}>Flow</button><span>›</span><b>{i + 1}. {info.name}</b>
        <span className="pv-f-sum">{stageSummary(at, view)}</span>
      </div>
      <p className="pv-f-what">{info.what}</p>
      <div className="pv-f-links">
        {info.from.length > 0 && <span>from {info.from.map((s) => <button key={s} type="button" onClick={() => go(s)}>{STAGE_INFO[s].name}</button>)}</span>}
        {info.into.length > 0 && <span>into {info.into.map((s) => <button key={s} type="button" onClick={() => go(s)}>{STAGE_INFO[s].name}</button>)}</span>}
      </div>
      <StageDetail stage={at} view={view} moments={moments} />
      <div className="pv-f-steps">
        {prev ? <button type="button" onClick={() => go(prev)}>← {STAGE_INFO[prev].name}</button> : <span />}
        {next ? <button type="button" onClick={() => go(next)}>{STAGE_INFO[next].name} →</button> : <button type="button" onClick={() => go('flow')}>Back to the flow</button>}
      </div>
      <KeyHint what="stages" />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// G. Inspector: a big window over the visuals. A rail of views on the left, each with its live headline.

const G_VIEWS = ['live', 'kicks', 'tempo', 'spectrum', 'scene'] as const;
const G_NAMES = { live: 'Live', kicks: 'Kick lab', tempo: 'Tempo', spectrum: 'Spectrum', scene: 'Scene inputs' } as const;

export function VariantG({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const [at, go] = usePrototypeView(G_VIEWS);
  const d = view.diagnostics, t = d.tempo, onTime = kicksOnTime(d.kicks), offsets = kickOffsets(d.kicks);
  const rail: Record<(typeof G_VIEWS)[number], string> = {
    live: HEADLINES[t.state],
    kicks: onTime ? `${onTime.hit}/${onTime.of} on time` : 'no kicks',
    tempo: `${Math.round(t.confidence * 100)} % sure`,
    spectrum: d.spectrum ? `tone ${hz(view.centroid)}` : 'nothing connected',
    scene: `uBeat ${view.inputs.uBeat.toFixed(2)}`,
  };

  return (
    <div id="hearing" className="hearing pv-g">
      <nav className="pv-g-rail">
        <div className="pv-g-title">
          <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
          <b id="hearing-tempo">{t.bpm === null ? '—' : t.bpm.toFixed(1)}</b><small>BPM</small>
        </div>
        <div id="hearing-state" data-state={t.state}>{t.state === 'hearing' ? 'locked on' : t.state}</div>
        {G_VIEWS.map((v, i) => (
          <button key={v} type="button" aria-current={v === at || undefined} onClick={() => go(v)}>
            <span>{i + 1}. {G_NAMES[v]}</span><small>{rail[v]}</small>
          </button>
        ))}
        <div className="pv-g-foot">
          <span><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd></span>
          <span><Kbd hotkey={HOTKEYS.hearingMonitor} /> <HelpButton topic="hearing" /></span>
        </div>
      </nav>

      <main className="pv-g-main">
        <h3>{G_NAMES[at]}</h3>
        {at === 'live' && <>
          <div className="pv-g-split">
            <div><Plot label="Kicks folded onto the pulse" height={250} draw={drawRadar(view)} /></div>
            <div>
              <ul className="pv-b-reasons">{reasons(view).map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}</ul>
            </div>
          </div>
          <Timeline view={view} />
        </>}

        {at === 'kicks' && <>
          <Plot label="Kick signal" height={170} draw={drawKicks(d.kicks)} />
          <div className="pv-legend">last {SPAN} s · rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span> · {tickLagLabel(d.tickLag)}</div>
          <div className="pv-g-split">
            <div>
              <Plot label="Kicks folded onto the pulse" height={240} draw={drawRadar(view)} />
              <div className="pv-legend">one turn is one pulse; 12 o'clock is due; newest outside</div>
            </div>
            <div>
              <h4>Against the pulse <small>window ±{Math.round(d.kicks.window * 1000)} ms</small></h4>
              <Plot label="How early or late each kick landed" height={60} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
              <KickTable offsets={offsets} />
            </div>
          </div>
        </>}

        {at === 'tempo' && <>
          <Plot label="Tempo candidates" height={200} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />
          <div className="pv-legend">strength · <span className="average">clear enough</span> · preference (dashed) · <span className="kick">heard {t.heardBpm === null ? '—' : Math.round(t.heardBpm)}</span>{t.bpm !== null && <> → folded to {t.bpm.toFixed(1)}</>}</div>
          <h4>Tempo <small>last {LATELY} s, 60–200 BPM</small></h4>
          <Spark moments={moments} pick={bpmOf} span={LATELY} range={[60, 200]} height={70} label="Tempo lately" />
          <h4>Confidence <small>last {LATELY} s</small></h4>
          <Spark moments={moments} pick={confidenceOf} span={LATELY} range={[0, 1]} height={50} colour={COLOURS.tick} label="Confidence lately" />
          <div className="hearing-meta">{latencyLabel(view.latency)} · {frameRateLabel(d.frameRate).text}</div>
        </>}

        {at === 'spectrum' && <>
          {d.spectrum ? <Plot label="Spectrum" height={200} draw={drawSpectrumAxis(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}
          <div className="pv-legend">as heard; the top is where it clips · tone {hz(view.centroid)} · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}</div>
          <h4>Waterfall <small>last {LATELY} s, low frequencies at the bottom</small></h4>
          <Plot label="Spectrum lately" height={170} draw={drawWaterfall(moments, LATELY)} />
        </>}

        {at === 'scene' && (
          <div className="pv-g-cards">
            {SCENE_INPUTS.map((input) => {
              const v = view.inputs[input.uniform];
              return (
                <div key={input.uniform} className="pv-g-card">
                  <div><b>{input.uniform}</b><output>{Number.isInteger(v) ? v : v.toFixed(2)}</output></div>
                  <Spark moments={moments} pick={(m) => m.inputs[input.uniform]} height={36} label={`${input.uniform} lately`} />
                  <small>{input.help}</small>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

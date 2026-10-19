// PROTOTYPE, throwaway (branch prototype/hearing-monitor-variants).
// Round three of "what should the Hearing monitor look like?": room to spread out.
//   H  Expand  a tiny HUD in the corner that expands into a fullscreen dashboard (⤢, Alt+↑/↓, Esc to go back)
//   I  HUD     no panel at all: the hearing drawn straight over the visuals, so you see both at once
//   J  Tape    a full-width sheet with the last minute on a tape: click or drag it to freeze and look back

import { useEffect, useState } from 'react';
import { SCENE_INPUTS } from '../engine/scene-inputs';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import type { HearingView } from '../state/ui-state';
import { HelpButton } from './Help';
import { bar, COLOURS, drawKicks, drawSpectrum, frameRateLabel, latencyLabel, Plot, tempoLabel, tickLagLabel } from './HearingMonitor';
import { BAND_COLOURS, drawRadar, HEADLINES, hz, kicksOnTime, reasons, SPAN, Timeline } from './HearingMonitor.prototype';
import {
  BANDS, bpmOf, confidenceOf, type Draw, drawCandidatesAxis, drawOffsets, drawSeries, drawSpectrumAxis, drawWaterfall, kickOffsets, KickTable,
  LATELY, type Moment, SCENE_OF, Spark, useMoments,
} from './HearingMonitor.prototype-views';
import { usePrototypeView } from './PrototypeSwitcher';
import './HearingMonitor.prototype-wide.css';

const inputValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

// ------------------------------------------------------------------------------------------------------------------
// H. Expand: mini ↔ full. The mini is what you leave open while playing; the full one is for working out why.

const H_VIEWS = ['mini', 'full'] as const;

export function VariantH({ view }: { view: HearingView }) {
  const moments = useMoments(view);
  const [mode, setMode] = usePrototypeView(H_VIEWS);
  const d = view.diagnostics, t = d.tempo, offsets = kickOffsets(d.kicks), onTime = kicksOnTime(d.kicks);

  useEffect(() => {
    if (mode !== 'full') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setMode('mini'); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (mode === 'mini') {
    return (
      <div id="hearing" className="hearing pv-h-mini">
        <div className="pv-h-row">
          <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
          <b id="hearing-tempo">{t.bpm === null ? '—' : t.bpm.toFixed(1)}</b>
          <span id="hearing-state" data-state={t.state}>{t.state === 'hearing' ? 'locked' : t.state}</span>
          <button type="button" className="pv-h-expand" title="Expand (Alt+↓)" onClick={() => setMode('full')}>⤢</button>
        </div>
        <b className="hearing-bar" title="Confidence"><i style={bar(t.confidence)} /></b>
        <Plot label="Kick signal" height={34} draw={drawKicks(d.kicks)} />
        <div className="pv-h-bands">
          {BANDS.map((b) => <i key={b} title={b} style={{ transform: `scaleY(${Math.min(1, d.bands[b].level)})`, background: BAND_COLOURS[b] }} />)}
          <span>{onTime ? `${onTime.hit}/${onTime.of}` : '–'} on time</span>
        </div>
      </div>
    );
  }

  return (
    <div id="hearing" className="hearing pv-h-full">
      <header className="pv-h-head">
        <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
        <b id="hearing-tempo">{tempoLabel(t)}</b>
        <span id="hearing-state" data-state={t.state}>{HEADLINES[t.state]}</span>
        <b className="hearing-bar pv-h-conf" title="Confidence"><i style={bar(t.confidence)} /></b>
        <ul className="pv-h-chips">{reasons(view).map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}</ul>
        <span className="pv-h-tools">
          <button type="button" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())} title="The browser's fullscreen">⛶</button>
          <HelpButton topic="hearing" />
          <button type="button" onClick={() => setMode('mini')} title="Back to the mini (Esc)">⤡</button>
        </span>
      </header>

      <section className="pv-h-tile pv-h-radar">
        <h4>On the pulse <small>12 o'clock is due · newest outside</small></h4>
        <Plot label="Kicks folded onto the pulse" height={260} draw={drawRadar(view)} />
        <Plot label="How early or late each kick landed" height={54} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
        <KickTable offsets={offsets} rows={5} />
      </section>
      <section className="pv-h-tile pv-h-time">
        <h4>Kicks <small>rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span> · {tickLagLabel(d.tickLag)}</small></h4>
        <Plot label="Kick signal" height={130} draw={drawKicks(d.kicks)} />
        <h4>Everything, last {SPAN} s</h4>
        <Timeline view={view} />
      </section>
      <section className="pv-h-tile pv-h-inputs">
        <h4>Scene inputs <small>last {SPAN} s</small></h4>
        {SCENE_INPUTS.map((input) => (
          <div key={input.uniform} className="pv-spark-row" title={input.help}>
            <span>{input.uniform}</span>
            <Spark moments={moments} pick={(m) => m.inputs[input.uniform]} height={20} label={`${input.uniform} lately`} />
            <output>{inputValue(view.inputs[input.uniform])}</output>
          </div>
        ))}
      </section>
      <section className="pv-h-tile">
        <h4>Spectrum <small>tone {hz(view.centroid)} · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}</small></h4>
        {d.spectrum ? <Plot label="Spectrum" height={120} draw={drawSpectrumAxis(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}
      </section>
      <section className="pv-h-tile">
        <h4>Waterfall <small>last {LATELY} s</small></h4>
        <Plot label="Spectrum lately" height={120} draw={drawWaterfall(moments, LATELY)} />
      </section>
      <section className="pv-h-tile">
        <h4>Tempo <small>candidates · BPM and <span className="tick">confidence</span> over {LATELY} s</small></h4>
        <Plot label="Tempo candidates" height={70} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />
        <Plot label="Tempo and confidence lately" height={46} draw={drawSeries(moments, LATELY, [{ pick: (v) => (bpmOf(v) ?? 0) / 200, colour: COLOURS.line }, { pick: confidenceOf, colour: COLOURS.tick }], [0, 1])} />
      </section>
      <footer className="pv-h-foot">{latencyLabel(view.latency)} · {frameRateLabel(d.frameRate).text} · <kbd>Esc</kbd> or <kbd>Alt</kbd>+<kbd>↑</kbd> back to the mini · close <Kbd hotkey={HOTKEYS.hearingMonitor} /></footer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// I. HUD: over the visuals, nothing behind it. The screen's edge flashes on each kick (magenta) and tick (green).

function VMeter({ label, value, mark, top = 1, colour }: { label: string; value: number; mark?: number; top?: number; colour: string }) {
  return (
    <div className="pv-i-meter" title={`${label} ${value.toFixed(2)}`}>
      <b><i style={{ transform: `scaleY(${Math.min(1, Math.max(0, value / top))})`, background: colour }} />{mark !== undefined && <u style={{ bottom: `${Math.min(1, mark / top) * 100}%` }} />}</b>
      <span>{label}</span>
    </div>
  );
}

export function VariantI({ view }: { view: HearingView }) {
  const d = view.diagnostics, t = d.tempo, i = view.inputs;
  const tick = t.bpm === null ? 0 : Math.max(0, 1 - view.tickPhase * 4);
  const problems = reasons(view).filter((r) => r.tone === 'bad' || r.tone === 'warn');
  return (
    <div id="hearing" className="pv-i">
      <div className="pv-i-flash" style={{ boxShadow: `inset 0 0 ${20 + view.beat * 60}px rgba(255, 79, 216, ${view.beat * 0.7}), inset 0 0 0 ${tick * 3}px rgba(79, 255, 160, ${tick * 0.8})` }} />

      <div className="pv-i-top">
        <b id="hearing-tempo">{t.bpm === null ? '—' : t.bpm.toFixed(1)}</b><small>BPM</small>
        <div id="hearing-state" data-state={t.state}>{HEADLINES[t.state]}</div>
        <b className="hearing-bar"><i style={bar(t.confidence)} /></b>
        {problems.length > 0 && <ul>{problems.map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}</ul>}
      </div>

      <div className="pv-i-bottom">
        <div className="pv-i-meters">
          {BANDS.map((b) => <VMeter key={b} label={b} value={d.bands[b].level} mark={d.bands[b].average} colour={BAND_COLOURS[b]} />)}
        </div>
        <div className="pv-i-strip">
          <Plot label="Kick signal" height={70} draw={drawKicks(d.kicks)} />
          <div className="pv-i-numbers">
            <span>uTime {i.uTime.toFixed(1)}</span><span>uTicks {i.uTicks}</span><span>{tickLagLabel(d.tickLag)}</span>
            <span>{frameRateLabel(d.frameRate).text}</span><span>{latencyLabel(view.latency)}</span>
            <span className="pv-i-keys"><Kbd hotkey={HOTKEYS.hearingMonitor} /> <HelpButton topic="hearing" /></span>
          </div>
        </div>
        <div className="pv-i-meters">
          {BANDS.map((b) => <VMeter key={b} label={SCENE_OF[b]} value={i[SCENE_OF[b]]} mark={1} top={1.5} colour="var(--accent2)" />)}
          <VMeter label="uBeat" value={i.uBeat} mark={1} top={1.5} colour={COLOURS.kick} />
          <VMeter label="uTick" value={i.uTick} colour={COLOURS.tick} />
          <VMeter label="uMood" value={i.uMood} colour="#ffd84f" />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// J. Tape: the last minute, scrubbable. Live, the details show now; frozen, they show the moment under the playhead,
// with its own 6 s of kicks — the way a rewound Kicks plot would look.

const TAPE_SPAN = 60;

function drawTape(moments: Moment[], end: number, playhead: number | null): Draw {
  return (c, w, h) => {
    if (!moments.length) return;
    const x = (at: number) => w - ((end - at) / TAPE_SPAN) * w;
    const lanes = { tempo: [0, 46], bands: [50, 40], hits: [94, 22] } as const, axis = h - 2;

    // Tempo (line) and confidence (filled) together.
    const [tt, th] = lanes.tempo;
    c.fillStyle = 'rgba(79, 255, 160, 0.16)'; c.beginPath(); c.moveTo(x(moments[0]!.at), tt + th);
    for (const m of moments) c.lineTo(x(m.at), tt + th - confidenceOf(m.view) * th);
    c.lineTo(x(moments[moments.length - 1]!.at), tt + th); c.fill();
    c.strokeStyle = COLOURS.line; c.beginPath();
    let started = false;
    for (const m of moments) {
      const bpm = bpmOf(m.view);
      if (bpm === null) { started = false; continue; }
      const py = tt + th - ((bpm - 60) / 140) * th;
      if (started) c.lineTo(x(m.at), py); else { c.moveTo(x(m.at), py); started = true; }
    }
    c.stroke();

    const [bt, bh] = lanes.bands;
    for (const b of ['high', 'mid', 'bass'] as const) {
      c.strokeStyle = BAND_COLOURS[b]; c.beginPath();
      moments.forEach((m, i) => { const px = x(m.at), py = bt + bh - Math.min(1, m.view.diagnostics.bands[b].level) * bh; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
      c.stroke();
    }

    // Each kick and tick once, from where the moments place them.
    const [ht, hh] = lanes.hits, seen = new Set<number>();
    const mark = (at: number, colour: string, y: number) => { const key = Math.round(at * 25) + (colour === COLOURS.kick ? 0 : 1e9); if (seen.has(key)) return; seen.add(key); c.fillStyle = colour; c.fillRect(x(at) - 1, y, 2, hh / 2 - 2); };
    for (const m of moments) {
      for (const ago of m.view.diagnostics.kicks.kicks) mark(m.at - ago, COLOURS.kick, ht);
      for (const ago of m.view.diagnostics.kicks.ticks) mark(m.at - ago, COLOURS.tick, ht + hh / 2);
    }

    c.fillStyle = COLOURS.muted; c.font = '10px ui-monospace, monospace';
    for (let s = 10; s < TAPE_SPAN; s += 10) { c.fillRect(x(end - s), 0, 1, axis - 10); c.fillText(`-${s}s`, x(end - s) + 3, axis); }
    for (const [name, [top]] of Object.entries(lanes)) c.fillText(name, 3, top + 10);

    if (playhead !== null) {
      c.fillStyle = 'rgba(255, 216, 79, 0.9)'; c.fillRect(x(playhead) - 1, 0, 2, axis - 10);
      c.fillStyle = 'rgba(0, 0, 0, 0.35)'; c.fillRect(x(playhead) + 1, 0, w - x(playhead), axis - 10);
    }
  };
}

const TAPE_H = 132;
const nearest = (moments: Moment[], at: number) => moments.reduce((best, m) => (Math.abs(m.at - at) < Math.abs(best.at - at) ? m : best));

export function VariantJ({ view }: { view: HearingView }) {
  const live = useMoments(view);
  const [frozen, setFrozen] = useState<{ moments: Moment[]; at: number } | null>(null);
  const moments = frozen?.moments ?? live, end = moments[moments.length - 1]?.at ?? 0;
  const shown = frozen && moments.length ? nearest(moments, frozen.at) : null;
  const v = shown?.view ?? view, d = v.diagnostics, t = d.tempo, offsets = kickOffsets(d.kicks);

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && !e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect(), at = end - (1 - (e.clientX - r.left) / r.width) * TAPE_SPAN;
    setFrozen({ moments, at: Math.min(end, Math.max(moments[0]?.at ?? end, at)) });
  };
  const step = (by: number) => {
    if (!shown) return;
    const i = moments.indexOf(shown), next = moments[Math.min(moments.length - 1, Math.max(0, i + by))]!;
    setFrozen({ moments, at: next.at });
  };

  return (
    <div id="hearing" className="hearing pv-j" data-frozen={frozen ? '' : undefined}>
      <header className="pv-j-head">
        {frozen
          ? <b className="pv-j-badge frozen">❚❚ FROZEN at −{(end - shown!.at).toFixed(1)} s</b>
          : <b className="pv-j-badge"><span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} /> LIVE</b>}
        <span>{frozen ? 'Drag along the tape, or step a moment at a time' : 'Click or drag the tape to freeze it and look back'}</span>
        <span className="pv-j-tools">
          {frozen && <><button type="button" onClick={() => step(-1)}>‹ moment</button><button type="button" onClick={() => step(1)}>moment ›</button></>}
          {frozen
            ? <button type="button" className="pv-j-live" onClick={() => setFrozen(null)}>● Back to live</button>
            : <button type="button" onClick={() => setFrozen({ moments: live, at: end })}>❚❚ Freeze</button>}
          <HelpButton topic="hearing" />
        </span>
      </header>

      <div className="pv-j-tape" onPointerDown={seek} onPointerMove={seek}>
        <Plot label="The last minute" height={TAPE_H} draw={drawTape(moments, end, frozen && shown ? shown.at : null)} />
      </div>
      <div className="pv-legend">last {TAPE_SPAN} s · tempo 60–200 BPM, <span className="tick">confidence</span> · <span style={{ color: BAND_COLOURS.bass }}>bass</span> <span style={{ color: BAND_COLOURS.mid }}>mid</span> <span style={{ color: BAND_COLOURS.high }}>high</span> · <span className="kick">kicks</span> / <span className="tick">ticks</span></div>

      <div className="pv-j-detail">
        <section>
          <h4>{tempoLabel(t)} <small>{HEADLINES[t.state]} · {Math.round(t.confidence * 100)} %</small></h4>
          <ul className="pv-b-reasons">{reasons(v).slice(0, 5).map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}</ul>
        </section>
        <section>
          <h4>Kicks <small>the {SPAN} s before {frozen ? 'this moment' : 'now'}</small></h4>
          <Plot label="Kick signal" height={90} draw={drawKicks(d.kicks)} />
          <Plot label="How early or late each kick landed" height={44} draw={drawOffsets(offsets, d.kicks.window * 1000)} />
        </section>
        <section>
          <h4>Tempo candidates</h4>
          <Plot label="Tempo candidates" height={70} draw={drawCandidatesAxis(d.candidates, t.heardBpm)} />
          <h4>Spectrum</h4>
          {d.spectrum ? <Plot label="Spectrum" height={50} draw={drawSpectrum(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}
        </section>
        <section className="pv-j-inputs">
          <h4>Scene inputs</h4>
          {SCENE_INPUTS.map((input) => <div key={input.uniform}><span>{input.uniform}</span><output>{inputValue(v.inputs[input.uniform])}</output></div>)}
        </section>
      </div>
      <div className="perf-hint">close <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

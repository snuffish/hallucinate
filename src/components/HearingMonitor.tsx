import { useRef } from 'react';
import { useApp, useLayout, useUI } from '../app/AppContext';
import type { HearingDiagnostics, TempoState } from '../engine/listener';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { effective } from '../state/layout';
import type { HearingView, Latency } from '../state/ui-state';
import { HelpButton } from './Help';
import { HearingWorkbench } from './HearingWorkbench';
import { Plot, type Draw } from './HearingPlot';
import { COLOURS } from './hearing-workbench';
import { rectOf } from './widgets/drop';
import { usePointerDrag } from './widgets/usePointerDrag';
import { useFloatPlacement, useNarrow } from './widgets/Widget';

const BAND_EDGES_HZ = [25, 140, 2000, 12000];   // the Listener's bands: bass, mid, high
const BAND_NAMES = ['bass', 'mid', 'high'];       // between those edges
const SPECTRUM_HZ = [20, 20000] as const;
const HZ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const AXIS = 12;   // px under a plot for its axis labels

// The tempo to a tenth, with what the kicks gave when folding into the tempo range changed it.
export function tempoLabel({ bpm, heardBpm }: Pick<HearingDiagnostics['tempo'], 'bpm' | 'heardBpm'>): string {
  if (bpm === null) return '— BPM';
  const folded = heardBpm !== null && Math.abs(heardBpm - bpm) > 0.5;
  return `${bpm.toFixed(1)} BPM${folded ? ` (heard ${Math.round(heardBpm)})` : ''}`;
}

const STATE_WORDS: Record<TempoState, string> = { hearing: 'hearing kicks', holding: 'holding', none: 'no tempo' };
export const stateLabel = (state: TempoState): string => STATE_WORDS[state];

export function latencyLabel(latency: Latency): string {
  if (latency === null) return '—';
  if (latency === 'outside') return 'heard outside the app';
  return `${Math.round(latency)} ms to the speakers`;
}

// Below this many frames a second a beat is only a few frames long, and kicks go unheard (the tempo wanders).
const SLOW_FPS = 30;

export function frameRateLabel(fps: number): { text: string; slow: boolean } {
  if (fps <= 0) return { text: 'hears no frames', slow: false };
  const slow = fps < SLOW_FPS - 0.5;
  return { text: `hears ${Math.round(fps)} fps${slow ? ': too few to hear every kick' : ''}`, slow };
}

export function tickLagLabel(ms: number | null): string {
  if (ms === null) return '—';
  return `ticks ${Math.round(Math.abs(ms))} ms ${ms < 0 ? 'before' : 'after'} the kicks`;
}

const logX = (hz: number, w: number) => (Math.log(hz / SPECTRUM_HZ[0]) / Math.log(SPECTRUM_HZ[1] / SPECTRUM_HZ[0])) * w;

const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

// The analyser's bins on a log-frequency axis, as heard (the top of the plot is where they clip), with the band
// edges and names, and the frequencies along the bottom.
function drawSpectrum(s: NonNullable<HearingDiagnostics['spectrum']>): Draw {
  return (c, w, h) => {
    const plot = h - AXIS;
    c.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.strokeStyle = COLOURS.grid;
    for (const hz of BAND_EDGES_HZ) { const x = logX(hz, w); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, plot); c.stroke(); }
    c.fillStyle = COLOURS.muted;
    BAND_NAMES.forEach((name, i) => c.fillText(name, logX(BAND_EDGES_HZ[i]!, w) + 3, 10));
    c.strokeStyle = COLOURS.line;
    c.beginPath();
    for (let i = 1; i < s.bins.length; i++) {
      const x = logX(i * s.binHz, w), y = plot - (s.bins[i]! / 255) * plot;
      if (i === 1) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = COLOURS.muted;
    c.textAlign = 'center';
    for (const hz of HZ_TICKS) { const x = logX(hz, w); c.fillRect(x, plot, 1, 3); c.fillText(hzLabel(hz), x, h - 1); }
    c.textAlign = 'start';
  };
}

// How strongly the kick signal repeats at each tempo, scaled to its peak (but never past the strength it takes to
// hear a pulse, dashed yellow, so noise stays flat), the Listener's preference dashed, and the tempo heard marked.
function drawCandidates(cand: HearingDiagnostics['candidates'], heard: number | null): Draw {
  return (c, w, h) => {
    if (cand.bpm.length < 2) return;
    const lo = cand.bpm[0]!, hi = cand.bpm[cand.bpm.length - 1]!;
    const x = (bpm: number) => ((bpm - lo) / (hi - lo)) * w;
    const top = Math.max(cand.clear, ...cand.strength);
    const curve = (values: number[], scale: number, colour: string, dash: number[]) => {
      c.strokeStyle = colour;
      c.setLineDash(dash);
      c.beginPath();
      values.forEach((v, i) => (i ? c.lineTo(x(cand.bpm[i]!), h - (v / scale) * h) : c.moveTo(x(cand.bpm[i]!), h - (v / scale) * h)));
      c.stroke();
    };
    curve(cand.preference, 1, COLOURS.muted, [3, 3]);
    curve(cand.bpm.map(() => cand.clear), top, COLOURS.threshold, [3, 3]);
    curve(cand.strength, top, COLOURS.line, []);
    c.setLineDash([]);
    if (heard !== null) { c.fillStyle = COLOURS.kick; c.fillRect(x(heard) - 1, 0, 2, h); }
  };
}

const bar = (v: number) => ({ transform: `scaleX(${Math.min(1, Math.max(0, v))})` });

// Shift+L: what the Listener hears and why, and what the scene gets from it, ~15 Hz while open (see docs/audio.md).
export function HearingMonitor() {
  const view = useUI((ui) => ui.hearingMonitor);
  if (!view) return <div id="hearing" className="hearing" hidden />;
  return <HearingPanel view={view} />;
}

// What takes a press itself instead of moving the monitor: its buttons and chips, the what-if slider, a link.
const OWN_PRESS = 'button, input, select, a';
const ownsPress = (e: React.MouseEvent) => !!(e.target as HTMLElement).closest(OWN_PRESS);
// A press on the monitor's scrollbar (when it scrolls) drags the scrollbar, not the monitor.
const onScrollbar = (e: React.PointerEvent<HTMLElement>) => e.clientX >= e.currentTarget.getBoundingClientRect().left + e.currentTarget.clientLeft + e.currentTarget.clientWidth;

// In the monitors' corner until dragged, by any part that doesn't take the press itself; then where it was dropped
// (stored in the layout), until a double-click on such a part puts it back. Phones keep it in the corner.
function useDragToMove() {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const place = useLayout((l) => effective(l, narrow).hearing);
  useFloatPlacement(root, place.kind === 'float' ? place : null);
  const drag = useRef<{ dx: number; dy: number; style: string } | null>(null);
  const restore = () => {
    const el = root.current;
    if (el && drag.current) el.style.cssText = drag.current.style;
    drag.current = null;
    app.setDragging(null);
  };
  const handlers = usePointerDrag({
    onStart: (_e, grab) => {
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      drag.current = { dx: grab.x, dy: grab.y, style: el.style.cssText };   // `grab`: where it was pressed
      Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, maxHeight: `${r.height}px` });
      app.setDragging('hearing');
    },
    onMove: (e) => {
      const el = root.current, d = drag.current;
      if (!el || !d) return;
      el.style.left = `${Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - el.offsetHeight)}px`;
    },
    onEnd: () => {
      const el = root.current;
      if (!el || !drag.current) return restore();
      const rect = rectOf(el);
      restore();
      app.moveHearingMonitor(rect);
    },
    onCancel: restore,
  }, { enabled: !narrow });
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { if (!onScrollbar(e)) handlers.onPointerDown(e); };
  const onDoubleClick = (e: React.MouseEvent) => { if (place.kind === 'float' && !ownsPress(e)) app.resetHearingMonitor(); };
  return { root, moved: place.kind === 'float', narrow, onPointerDown, onClickCapture: handlers.onClickCapture, onDoubleClick };
}

function HearingPanel({ view }: { view: HearingView }) {
  const { root, moved, narrow, ...drag } = useDragToMove();
  const dragging = useUI((ui) => ui.dragging === 'hearing');
  const { diagnostics: d } = view;
  const t = d.tempo, fps = frameRateLabel(d.frameRate);
  return (
    <div id="hearing" ref={root} className={`hearing${moved ? ' moved' : ''}${dragging ? ' dragging' : ''}`} data-draggable={!narrow || undefined} {...drag}>
      <div className="hearing-head">
        <b id="hearing-tempo">{tempoLabel(t)}</b>
        <span className="hearing-light kick" title="Kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
        <span className="hearing-light tick" title="Tick" style={{ opacity: 0.15 + (t.bpm === null ? 0 : Math.max(0, 1 - view.tickPhase * 4) * 0.85) }} />
        <span id="hearing-state" data-state={t.state}>{stateLabel(t.state)}</span>
        <HelpButton topic="hearing" />
      </div>
      <div className="hearing-row" title="Confidence: how clearly the kicks repeat at the tempo">
        <span>Confidence</span><b className="hearing-bar"><i id="hearing-confidence" style={bar(t.confidence)} /></b>
      </div>
      <div className="hearing-meta hearing-readouts">
        <span id="hearing-latency">{latencyLabel(view.latency)}</span>
        <span id="hearing-fps" data-slow={fps.slow || undefined}>{fps.text}</span>
        <span id="hearing-tick-lag">{tickLagLabel(d.tickLag)}</span>
      </div>

      <HearingWorkbench view={view} />

      <div className="hearing-pair">
        <section>
          <h4>Spectrum <small>Hz, as heard; the top clips</small></h4>
          {d.spectrum ? <Plot label="Spectrum" height={56 + AXIS} draw={drawSpectrum(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}
        </section>
        <section>
          <h4>Tempo candidates <small>strength · <span className="average">clear enough</span> · preference</small></h4>
          <Plot label="Tempo candidates" draw={drawCandidates(d.candidates, t.heardBpm)} />
        </section>
      </div>
      <div className="hearing-meta">
        tone {(view.centroid / 1000).toFixed(1)} kHz · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}
      </div>
      <div className="perf-hint">{narrow ? '' : moved ? 'Double-click it to put it back · ' : 'Drag it to move it · '}Close with <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

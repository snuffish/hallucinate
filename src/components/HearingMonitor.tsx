import { useEffect, useRef } from 'react';
import { useUI } from '../app/AppContext';
import type { HearingDiagnostics, TempoState } from '../engine/listener';
import type { HearingView, Latency } from '../state/ui-state';
import { SCENE_INPUTS, type SceneInput } from '../engine/scene-inputs';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { HelpButton } from './Help';
import { HEARING_VARIANTS, VariantB, VariantC, VariantD } from './HearingMonitor.prototype';
import { VariantE, VariantF, VariantG } from './HearingMonitor.prototype-views';
import { VariantH, VariantI, VariantJ } from './HearingMonitor.prototype-wide';
import { VariantK, VariantL, VariantM } from './HearingMonitor.prototype-interactive';
import { PrototypeSwitcher, usePrototypeVariant } from './PrototypeSwitcher';

export const BAND_EDGES_HZ = [25, 140, 2000, 12000];   // the Listener's bands: bass, mid, high
const SPECTRUM_HZ = [20, 20000] as const;
export const COLOURS = { line: '#4fe3ff', kick: '#ff4fd8', tick: '#4fffa0', threshold: '#ffd84f', due: 'rgba(255, 255, 255, 0.1)', grid: 'rgba(255, 255, 255, 0.25)', muted: '#a99fc4' };

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

// Draws on a canvas at the device's pixel ratio whenever `draw` changes.
export function Plot({ draw, label, height = 56 }: { draw: (c: CanvasRenderingContext2D, w: number, h: number) => void; label: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const c = canvas?.getContext('2d');
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = height;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    draw(c, w, h);
  }, [draw, height]);
  return <canvas ref={ref} className="hearing-plot" style={{ height }} role="img" aria-label={label} />;
}

export const logX = (hz: number, w: number) => (Math.log(hz / SPECTRUM_HZ[0]) / Math.log(SPECTRUM_HZ[1] / SPECTRUM_HZ[0])) * w;

// The analyser's bins on a log-frequency axis, as heard (the top of the plot is where they clip), with the band edges.
export function drawSpectrum(s: NonNullable<HearingDiagnostics['spectrum']>) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.strokeStyle = COLOURS.grid;
    for (const hz of BAND_EDGES_HZ) { const x = logX(hz, w); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    c.strokeStyle = COLOURS.line;
    c.beginPath();
    for (let i = 1; i < s.bins.length; i++) {
      const x = logX(i * s.binHz, w), y = h - (s.bins[i]! / 255) * h;
      if (i === 1) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  };
}

// The kick signal over the last seconds, newest at the right: the windows where a kick was due shaded, the
// threshold, the rises, and below them the kicks (top) against the ticks (bottom).
export function drawKicks(k: HearingDiagnostics['kicks']) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const span = k.rises.length * k.cell, x = (ago: number) => w - (ago / span) * w;
    const lanes = 14, plot = h - lanes * 2, top = Math.max(k.threshold * 2.5, ...k.rises, 1);
    c.fillStyle = COLOURS.due;
    for (const due of k.due) c.fillRect(x(due + k.window), 0, Math.max(1, x(due - k.window) - x(due + k.window)), plot);
    c.strokeStyle = COLOURS.threshold;
    c.setLineDash([3, 3]);
    const ty = plot - (k.threshold / top) * plot;
    c.beginPath(); c.moveTo(0, ty); c.lineTo(w, ty); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = COLOURS.line;
    c.beginPath();
    for (let i = 0; i < k.rises.length; i++) {
      const px = (i / (k.rises.length - 1)) * w, py = plot - (k.rises[i]! / top) * plot;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    c.fillStyle = COLOURS.kick;
    for (const ago of k.kicks) c.fillRect(x(ago) - 1, plot + 2, 2, lanes - 4);
    c.fillStyle = COLOURS.tick;
    for (const ago of k.ticks) c.fillRect(x(ago) - 1, plot + lanes + 2, 2, lanes - 4);
  };
}

// How strongly the kick signal repeats at each tempo, scaled to its peak (but never past the strength it takes to
// hear a pulse, dashed yellow, so noise stays flat), the Listener's preference dashed, and the tempo heard marked.
export function drawCandidates(cand: HearingDiagnostics['candidates'], heard: number | null) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
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

export const bar = (v: number) => ({ transform: `scaleX(${Math.min(1, Math.max(0, v))})` });

// A scene input as a bar over its range (the bands and the kick reach 1.5 at high reactivity: the mark is 1), or
// as a number where it has no top (the clock, the tick count).
const INPUT_TOP: Partial<Record<SceneInput['uniform'], number>> = { uBass: 1.5, uMid: 1.5, uHigh: 1.5, uLevel: 1.5, uBeat: 1.5, uTick: 1, uHue: 1, uBright: 1, uMood: 1 };

export function InputRow({ input, value }: { input: SceneInput; value: number }) {
  const top = INPUT_TOP[input.uniform];
  return (
    <div className="hearing-row" data-input={input.uniform} title={`${input.help} (${input.range})`}>
      <span>{input.uniform}</span>
      {top
        ? <b className="hearing-bar"><i style={bar(value / top)} />{top > 1 && <u style={{ left: `${(1 / top) * 100}%` }} />}<output hidden>{value.toFixed(2)}</output></b>
        : <output>{Number.isInteger(value) ? value : value.toFixed(1)}</output>}
    </div>
  );
}

// Shift+L: what the Listener hears and why, and what the scene gets from it, ~15 Hz while open (see docs/audio.md).
export function HearingMonitor() {
  const view = useUI((ui) => ui.hearingMonitor);
  const [variant, setVariant] = usePrototypeVariant(HEARING_VARIANTS);   // PROTOTYPE: ?variant=A…M, and ?view= inside E, F, G, H
  if (!view) return <div id="hearing" className="hearing" hidden />;
  return (
    <>
      {variant === 'A' && <HearingPanel view={view} />}
      {variant === 'B' && <VariantB view={view} />}
      {variant === 'C' && <VariantC view={view} />}
      {variant === 'D' && <VariantD view={view} />}
      {variant === 'E' && <VariantE view={view} />}
      {variant === 'F' && <VariantF view={view} />}
      {variant === 'G' && <VariantG view={view} />}
      {variant === 'H' && <VariantH view={view} />}
      {variant === 'I' && <VariantI view={view} />}
      {variant === 'J' && <VariantJ view={view} />}
      {variant === 'K' && <VariantK view={view} />}
      {variant === 'L' && <VariantL view={view} />}
      {variant === 'M' && <VariantM view={view} />}
      <PrototypeSwitcher variants={HEARING_VARIANTS} current={variant} onChange={setVariant} />
    </>
  );
}

function HearingPanel({ view }: { view: HearingView }) {
  const { diagnostics: d } = view;
  const t = d.tempo, fps = frameRateLabel(d.frameRate);
  return (
    <div id="hearing" className="hearing">
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
      <div className="hearing-meta" id="hearing-latency">{latencyLabel(view.latency)}</div>
      <div className="hearing-meta" id="hearing-fps" data-slow={fps.slow || undefined}>{fps.text}</div>
      <div className="hearing-meta" id="hearing-tick-lag">{tickLagLabel(d.tickLag)}</div>

      <h4>Spectrum <small>as heard; the top is where it clips</small></h4>
      {d.spectrum ? <Plot label="Spectrum" draw={drawSpectrum(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}

      <h4>Bands <small>level · <span className="average">running average</span></small></h4>
      {(['bass', 'mid', 'high', 'level'] as const).map((k) => (
        <div key={k} className="hearing-row" data-band={k}>
          <span>{k}</span>
          <b className="hearing-bar"><i style={bar(d.bands[k].level)} /><u style={{ left: `${Math.min(1, d.bands[k].average) * 100}%` }} /></b>
        </div>
      ))}

      <h4>Kicks <small>rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span></small></h4>
      <Plot label="Kick signal" height={84} draw={drawKicks(d.kicks)} />

      <h4>Tempo candidates <small>strength · <span className="average">clear enough</span> · preference</small></h4>
      <Plot label="Tempo candidates" height={64} draw={drawCandidates(d.candidates, t.heardBpm)} />

      <div className="hearing-meta">
        tone {(view.centroid / 1000).toFixed(1)} kHz · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}
      </div>

      <h4>Scene inputs <small>what the scene's shader reads, after the Look</small></h4>
      <div id="hearing-inputs">
        {SCENE_INPUTS.map((input) => <InputRow key={input.uniform} input={input} value={view.inputs[input.uniform]} />)}
      </div>
      <div className="perf-hint">Close with <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

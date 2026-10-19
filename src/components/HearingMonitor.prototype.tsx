// PROTOTYPE, throwaway (branch prototype/hearing-monitor-variants).
// Question: what should the Hearing monitor (Shift+L) look like? Three structurally different takes on the same
// HearingView, next to today's panel (A), switchable with ?variant=A|B|C|D and the floating bar (Alt+←/→):
//   B  Verdict   the answer first ("is it locked on?"), the reasons as a checklist, the plots folded away as evidence
//   C  Timeline  a wide strip along the bottom: every signal on one shared 6 s time axis, the beat grid across all
//   D  Radar     the beat folded into a circle (kicks and ticks by phase: a tight cluster at 12 o'clock is locked),
//                and a mixer of what is heard against what the scene gets
// No tests, no polish. The winner gets rewritten properly into HearingMonitor.tsx.

import { useEffect, useRef } from 'react';
import type { HearingDiagnostics } from '../engine/listener';
import { SCENE_INPUTS } from '../engine/scene-inputs';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import type { HearingView } from '../state/ui-state';
import { HelpButton } from './Help';
import {
  bar, COLOURS, drawCandidates, drawKicks, drawSpectrum, frameRateLabel, InputRow, latencyLabel, Plot, tempoLabel, tickLagLabel,
} from './HearingMonitor';
import './HearingMonitor.prototype.css';

export const HEARING_VARIANTS = [
  { key: 'A', name: 'Today' },
  { key: 'B', name: 'Verdict' },
  { key: 'C', name: 'Timeline' },
  { key: 'D', name: 'Radar' },
  { key: 'E', name: 'Tabs' },
  { key: 'F', name: 'Flow' },
  { key: 'G', name: 'Inspector' },
  { key: 'H', name: 'Expand' },
  { key: 'I', name: 'HUD' },
  { key: 'J', name: 'Tape' },
  { key: 'K', name: 'Workbench' },
  { key: 'L', name: 'Event log' },
  { key: 'M', name: 'Build your own' },
] as const;

export type Kicks = HearingDiagnostics['kicks'];
export const SPAN = 6;   // seconds the kick signal covers
export const BAND_COLOURS = { bass: '#ff4fd8', mid: '#ffd84f', high: '#4fe3ff', level: 'rgba(255, 255, 255, 0.5)' } as const;

// The pulse period, from the gap between two due pulses (0 while no pulse is heard).
export const pulsePeriod = (k: Kicks) => (k.due.length >= 2 ? k.due[1]! - k.due[0]! : 0);

// How many of the recent kicks landed inside a window where a pulse was due.
export function kicksOnTime(k: Kicks): { hit: number; of: number } | null {
  if (!k.due.length || !k.kicks.length) return null;
  const oldest = Math.max(...k.due) + k.window;
  const recent = k.kicks.filter((ago) => ago <= oldest);
  if (!recent.length) return null;
  const hit = recent.filter((ago) => k.due.some((due) => Math.abs(ago - due) <= k.window)).length;
  return { hit, of: recent.length };
}

// ------------------------------------------------------------------------------------------------------------------
// B. Verdict: answer → reasons → evidence on demand.

type Tone = 'good' | 'warn' | 'bad' | 'info';
interface Reason { tone: Tone; text: string }

export const HEADLINES = {
  hearing: 'Locked on the kicks',
  holding: 'Holding the tempo through a gap in the kicks',
  none: 'Listening for a tempo…',
} as const;

export function reasons(view: HearingView): Reason[] {
  const d = view.diagnostics, t = d.tempo;
  if (!d.spectrum) return [{ tone: 'bad', text: 'Nothing is connected: play a song, the demo beat or the microphone' }];
  const out: Reason[] = [];
  const pct = Math.round(t.confidence * 100);
  out.push(t.confidence > 0.6 ? { tone: 'good', text: `The kicks repeat clearly (${pct} %)` }
    : t.confidence > 0.3 ? { tone: 'warn', text: `The kicks repeat, but not clearly (${pct} %)` }
      : { tone: 'bad', text: `No clear repeat in the kicks (${pct} %)` });
  const onTime = kicksOnTime(d.kicks);
  if (onTime) {
    const share = onTime.hit / onTime.of;
    out.push({ tone: share >= 0.75 ? 'good' : share >= 0.4 ? 'warn' : 'bad', text: `${onTime.hit} of ${onTime.of} kicks landed when one was due` });
  }
  if (t.bpm !== null && t.heardBpm !== null && Math.abs(t.heardBpm - t.bpm) > 0.5) {
    out.push({ tone: 'info', text: `The kicks gave ${Math.round(t.heardBpm)} BPM, folded to ${t.bpm.toFixed(1)}` });
  }
  if (d.tickLag !== null) {
    const ms = Math.abs(d.tickLag);
    out.push({ tone: ms < 30 ? 'good' : ms < 80 ? 'warn' : 'bad', text: tickLagLabel(d.tickLag).replace(/^ticks/, 'The ticks land') });
  }
  const fps = frameRateLabel(d.frameRate);
  out.push({ tone: fps.slow ? 'bad' : 'good', text: fps.text.replace(/^hears/, 'Hears') });
  const bins = d.spectrum.bins, clipped = bins.reduce((n, b) => n + (b >= 250 ? 1 : 0), 0) / bins.length;
  if (clipped > 0.05) out.push({ tone: 'warn', text: `${Math.round(clipped * 100)} % of the spectrum clips: kicks rise less than they could` });
  if (d.bands.level.average < 0.08) out.push({ tone: 'warn', text: 'The music is very quiet' });
  out.push({ tone: 'info', text: latencyLabel(view.latency) });
  return out;
}

function loudestHz(s: NonNullable<HearingDiagnostics['spectrum']>): number {
  let best = 1;
  for (let i = 2; i < s.bins.length; i++) if (s.bins[i]! > s.bins[best]!) best = i;
  return best * s.binHz;
}

export const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);

function Evidence({ title, summary, open, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="pv-evidence" open={open}>
      <summary><span>{title}</span><small>{summary}</small></summary>
      <div className="pv-evidence-body">{children}</div>
    </details>
  );
}

export function VariantB({ view }: { view: HearingView }) {
  const d = view.diagnostics, t = d.tempo;
  const bands = (['bass', 'mid', 'high', 'level'] as const);
  const hottest = bands.reduce((a, b) => (d.bands[b].level / Math.max(0.01, d.bands[b].average) > d.bands[a].level / Math.max(0.01, d.bands[a].average) ? b : a));
  const best = d.candidates.strength.reduce((bi, v, i, all) => (v > all[bi]! ? i : bi), 0);
  return (
    <div id="hearing" className="hearing pv-b">
      <div className="pv-b-hero" data-state={t.state}>
        <div>
          <div className="pv-b-bpm">{t.bpm === null ? '—' : t.bpm.toFixed(1)}<small> BPM</small></div>
          <div className="pv-b-headline">{HEADLINES[t.state]}</div>
        </div>
        <div className="pv-b-orb" style={{ '--beat': view.beat, '--tick': t.bpm === null ? 0 : Math.max(0, 1 - view.tickPhase * 4) } as React.CSSProperties}>
          <i /><u />
        </div>
        <HelpButton topic="hearing" />
      </div>
      <div className="pv-b-confidence"><b className="hearing-bar"><i style={bar(t.confidence)} /></b></div>

      <ul className="pv-b-reasons">
        {reasons(view).map((r) => <li key={r.text} data-tone={r.tone}>{r.text}</li>)}
      </ul>

      <Evidence title="Kicks" summary={`${d.kicks.kicks.length} kicks · ${d.kicks.ticks.length} ticks in ${SPAN} s`} open>
        <Plot label="Kick signal" height={84} draw={drawKicks(d.kicks)} />
        <div className="pv-legend">rise · <span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span></div>
      </Evidence>
      <Evidence title="Tempo candidates" summary={d.candidates.bpm.length ? `strongest at ${Math.round(d.candidates.bpm[best]!)} BPM` : '—'}>
        <Plot label="Tempo candidates" height={64} draw={drawCandidates(d.candidates, t.heardBpm)} />
      </Evidence>
      <Evidence title="Spectrum" summary={d.spectrum ? `loudest at ${hz(loudestHz(d.spectrum))}` : 'nothing connected'}>
        {d.spectrum && <Plot label="Spectrum" draw={drawSpectrum(d.spectrum)} />}
        <div className="pv-legend">tone {hz(view.centroid)} · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}</div>
      </Evidence>
      <Evidence title="Bands" summary={`${hottest} is ${(d.bands[hottest].level / Math.max(0.01, d.bands[hottest].average)).toFixed(1)}× its average`}>
        {bands.map((k) => (
          <div key={k} className="hearing-row"><span>{k}</span>
            <b className="hearing-bar"><i style={bar(d.bands[k].level)} /><u style={{ left: `${Math.min(1, d.bands[k].average) * 100}%` }} /></b>
          </div>
        ))}
      </Evidence>
      <Evidence title="Scene inputs" summary={`uBeat ${view.inputs.uBeat.toFixed(2)} · uTick ${view.inputs.uTick.toFixed(2)} · uTicks ${view.inputs.uTicks}`}>
        {SCENE_INPUTS.map((input) => <InputRow key={input.uniform} input={input} value={view.inputs[input.uniform]} />)}
      </Evidence>
      <div className="perf-hint">Close with <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// C. Timeline: one shared time axis, newest at the right; the due pulses drawn as a beat grid through every lane.

export const SPEC_ROWS = 40, SPEC_HZ = [30, 16000] as const;
interface Sample { at: number; bass: number; mid: number; high: number; level: number; beat: number; tick: number; spec: Uint8Array }

export function foldSpectrum(s: HearingDiagnostics['spectrum']): Uint8Array {
  const out = new Uint8Array(SPEC_ROWS);
  if (!s) return out;
  for (let r = 0; r < SPEC_ROWS; r++) {
    const lo = SPEC_HZ[0] * (SPEC_HZ[1] / SPEC_HZ[0]) ** (r / SPEC_ROWS), hi = SPEC_HZ[0] * (SPEC_HZ[1] / SPEC_HZ[0]) ** ((r + 1) / SPEC_ROWS);
    const a = Math.max(1, Math.floor(lo / s.binHz)), b = Math.min(s.bins.length - 1, Math.max(a, Math.ceil(hi / s.binHz)));
    let m = 0;
    for (let i = a; i <= b; i++) m = Math.max(m, s.bins[i]!);
    out[r] = m;
  }
  return out;
}

// Magma-ish: black → purple → magenta → yellow.
export function heat(v: number): string {
  const t = v / 255;
  const r = Math.round(255 * Math.min(1, t * 1.6)), g = Math.round(255 * Math.max(0, t - 0.55) * 2.2), b = Math.round(255 * (t < 0.5 ? t * 1.4 : Math.max(0, 0.7 - (t - 0.5) * 1.4)));
  return `rgb(${r},${g},${b})`;
}

const LANES = [
  { id: 'spectrum', label: 'spectrum', h: 52 },
  { id: 'bands', label: 'bands', h: 44 },
  { id: 'rises', label: 'kick rise', h: 48 },
  { id: 'hits', label: 'kicks / ticks', h: 22 },
  { id: 'inputs', label: 'uBeat · uTick', h: 34 },
] as const;
const LANE_GAP = 4, TIMELINE_H = LANES.reduce((n, l) => n + l.h + LANE_GAP, 0) + 12;

export function Timeline({ view }: { view: HearingView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const history = useRef<Sample[]>([]);
  useEffect(() => {
    const d = view.diagnostics, now = performance.now() / 1000, h = history.current;
    h.push({ at: now, bass: d.bands.bass.level, mid: d.bands.mid.level, high: d.bands.high.level, level: d.bands.level.level, beat: view.inputs.uBeat, tick: view.inputs.uTick, spec: foldSpectrum(d.spectrum) });
    while (h.length && now - h[0]!.at > SPAN + 0.5) h.shift();

    const canvas = ref.current, c = canvas?.getContext('2d');
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, H = TIMELINE_H;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, H);
    const x = (ago: number) => w - (ago / SPAN) * w;
    const k = d.kicks;

    // The beat grid, through every lane, and the seconds along the bottom.
    c.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (const due of k.due) c.fillRect(x(due + k.window), 0, Math.max(1, x(due - k.window) - x(due + k.window)), H - 12);
    c.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    for (const due of k.due) { c.beginPath(); c.moveTo(x(due), 0); c.lineTo(x(due), H - 12); c.stroke(); }
    c.fillStyle = COLOURS.muted;
    c.font = '10px ui-monospace, monospace';
    for (let s = 1; s <= SPAN; s++) c.fillText(`-${s}s`, x(s) + 2, H - 2);
    c.fillText('now', w - 22, H - 2);

    let y = 0;
    for (const lane of LANES) {
      const top = y, lh = lane.h;
      c.fillStyle = 'rgba(255, 255, 255, 0.03)';
      c.fillRect(0, top, w, lh);
      if (lane.id === 'spectrum') {
        const rh = lh / SPEC_ROWS;
        for (let i = 0; i < h.length; i++) {
          const s = h[i]!, x0 = x(now - s.at), x1 = i + 1 < h.length ? x(now - h[i + 1]!.at) : w;
          for (let r = 0; r < SPEC_ROWS; r++) {
            if (s.spec[r]! < 30) continue;
            c.fillStyle = heat(s.spec[r]!);
            c.fillRect(x0, top + lh - (r + 1) * rh, Math.max(1, x1 - x0 + 0.5), rh + 0.5);
          }
        }
      } else if (lane.id === 'bands') {
        const trace = (key: 'bass' | 'mid' | 'high' | 'level', fill: boolean) => {
          c.beginPath();
          h.forEach((s, i) => { const px = x(now - s.at), py = top + lh - Math.min(1, s[key]) * lh; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
          if (fill && h.length) { c.lineTo(x(now - h[h.length - 1]!.at), top + lh); c.lineTo(x(now - h[0]!.at), top + lh); c.fillStyle = 'rgba(255, 255, 255, 0.1)'; c.fill(); }
          else { c.strokeStyle = BAND_COLOURS[key]; c.stroke(); }
        };
        trace('level', true);
        trace('high', false); trace('mid', false); trace('bass', false);
      } else if (lane.id === 'rises') {
        const peak = Math.max(k.threshold * 2.5, ...k.rises, 1), ty = top + lh - (k.threshold / peak) * lh;
        c.strokeStyle = COLOURS.threshold; c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(0, ty); c.lineTo(w, ty); c.stroke(); c.setLineDash([]);
        c.strokeStyle = COLOURS.line; c.beginPath();
        for (let i = 0; i < k.rises.length; i++) {
          const px = (i / (k.rises.length - 1)) * w, py = top + lh - (k.rises[i]! / peak) * lh;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.stroke();
      } else if (lane.id === 'hits') {
        c.fillStyle = COLOURS.kick;
        for (const ago of k.kicks) c.fillRect(x(ago) - 1.5, top + 2, 3, lh / 2 - 3);
        c.fillStyle = COLOURS.tick;
        for (const ago of k.ticks) c.fillRect(x(ago) - 1.5, top + lh / 2 + 1, 3, lh / 2 - 3);
      } else {
        const trace = (key: 'beat' | 'tick', colour: string, scale: number) => {
          c.strokeStyle = colour; c.beginPath();
          h.forEach((s, i) => { const px = x(now - s.at), py = top + lh - Math.min(1, s[key] / scale) * lh; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
          c.stroke();
        };
        trace('tick', COLOURS.tick, 1);
        trace('beat', COLOURS.kick, 1.5);
      }
      // The lane's name, on a plate so it reads over the traces.
      c.font = '10px ui-monospace, monospace';
      const tw = c.measureText(lane.label).width;
      c.fillStyle = 'rgba(14, 10, 24, 0.75)'; c.fillRect(2, top + 2, tw + 8, 14);
      c.fillStyle = COLOURS.muted; c.fillText(lane.label, 6, top + 12);
      y += lh + LANE_GAP;
    }
  }, [view]);
  return <canvas ref={ref} className="pv-c-timeline" style={{ height: TIMELINE_H }} role="img" aria-label="Everything the Listener heard over the last seconds" />;
}

export function VariantC({ view }: { view: HearingView }) {
  const d = view.diagnostics, t = d.tempo, fps = frameRateLabel(d.frameRate);
  return (
    <div id="hearing" className="hearing pv-c">
      <div className="pv-c-now">
        <div className="pv-c-bpm">
          <span className="hearing-light kick" style={{ opacity: 0.15 + view.beat * 0.85 }} />
          <b id="hearing-tempo">{tempoLabel(t)}</b>
        </div>
        <div id="hearing-state" data-state={t.state}>{HEADLINES[t.state]}</div>
        <b className="hearing-bar" title="Confidence"><i style={bar(t.confidence)} /></b>
        <div className="hearing-meta">{latencyLabel(view.latency)}</div>
        <div className="hearing-meta" data-slow={fps.slow || undefined}>{fps.text}</div>
        <div className="hearing-meta">{tickLagLabel(d.tickLag)}</div>
        <div className="pv-c-cand"><Plot label="Tempo candidates" height={44} draw={drawCandidates(d.candidates, t.heardBpm)} /></div>
        <div className="pv-c-foot"><HelpButton topic="hearing" /> <Kbd hotkey={HOTKEYS.hearingMonitor} /></div>
      </div>
      <div className="pv-c-axis">
        <div className="pv-legend">
          <span style={{ color: BAND_COLOURS.bass }}>bass</span> · <span style={{ color: BAND_COLOURS.mid }}>mid</span> · <span style={{ color: BAND_COLOURS.high }}>high</span> · level
          {'  |  '}<span className="average">threshold</span> · due · <span className="kick">kicks</span> / <span className="tick">ticks</span>
          {'  |  '}tone {hz(view.centroid)} · energy {view.energy.toFixed(2)} · mood {view.mood.toFixed(2)}
        </div>
        <Timeline view={view} />
      </div>
      <div className="pv-c-inputs">
        {SCENE_INPUTS.map((input) => {
          const v = view.inputs[input.uniform];
          return <div key={input.uniform} title={input.help}><span>{input.uniform}</span><output>{Number.isInteger(v) ? v : v.toFixed(2)}</output></div>;
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------
// D. Radar: one turn of the circle is one pulse; 12 o'clock is when a pulse is due. Kicks (magenta) and ticks (green)
// sit at their phase, the newest on the outside. The rises of the last 6 s are folded onto the same circle.

const FOLD_BINS = 96;

export function drawRadar(view: HearingView) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const d = view.diagnostics, k = d.kicks, t = d.tempo, p = pulsePeriod(k);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 6, inner = R * 0.3, mid = R * 0.62;
    const angle = (phase: number) => phase * Math.PI * 2 - Math.PI / 2;
    const at = (phase: number, r: number) => [cx + Math.cos(angle(phase)) * r, cy + Math.sin(angle(phase)) * r] as const;
    const phaseOf = (ago: number) => { const f = ((k.due[0]! - ago) / p) % 1; return f < 0 ? f + 1 : f; };

    c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    for (const r of [inner, mid, R]) { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); }
    for (let q = 0; q < 4; q++) { const [x0, y0] = at(q / 4, inner), [x1, y1] = at(q / 4, R); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }

    if (p > 0) {
      // When a kick may land: the wedge either side of 12 o'clock.
      const half = (k.window / p) * Math.PI * 2;
      c.fillStyle = 'rgba(255, 255, 255, 0.1)';
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half); c.closePath(); c.fill();

      // The rises folded by phase, in the outer ring, against the threshold.
      const fold = new Float32Array(FOLD_BINS);
      for (let i = 0; i < k.rises.length; i++) {
        const b = Math.floor(phaseOf((k.rises.length - 1 - i) * k.cell) * FOLD_BINS) % FOLD_BINS;
        fold[b] = Math.max(fold[b]!, k.rises[i]!);
      }
      const peak = Math.max(k.threshold * 2.5, ...fold, 1), ring = (v: number) => mid + (Math.min(v, peak) / peak) * (R - mid);
      c.strokeStyle = COLOURS.threshold; c.setLineDash([3, 3]);
      c.beginPath(); c.arc(cx, cy, ring(k.threshold), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.strokeStyle = COLOURS.line; c.fillStyle = 'rgba(79, 227, 255, 0.15)'; c.beginPath();
      for (let b = 0; b <= FOLD_BINS; b++) { const [px, py] = at(b / FOLD_BINS, ring(fold[b % FOLD_BINS]!)); if (b) c.lineTo(px, py); else c.moveTo(px, py); }
      c.closePath(); c.fill(); c.stroke();

      // Kicks and ticks by phase, newest outside.
      const dot = (ago: number, colour: string, size: number) => {
        const [px, py] = at(phaseOf(ago), mid - 4 - (Math.min(ago, SPAN) / SPAN) * (mid - inner - 8));
        c.globalAlpha = 1 - (Math.min(ago, SPAN) / SPAN) * 0.75;
        c.fillStyle = colour; c.beginPath(); c.arc(px, py, size, 0, Math.PI * 2); c.fill();
      };
      for (const ago of k.ticks) dot(ago, COLOURS.tick, 2.5);
      for (const ago of k.kicks) dot(ago, COLOURS.kick, 3.5);
      c.globalAlpha = 1;

      // Now, on the pulse.
      const [hx, hy] = at(phaseOf(0), R), [h0x, h0y] = at(phaseOf(0), inner);
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(h0x, h0y); c.lineTo(hx, hy); c.stroke(); c.lineWidth = 1;
    }

    // The middle: the tempo, a flash on each kick.
    c.fillStyle = `rgba(255, 79, 216, ${0.08 + view.beat * 0.5})`;
    c.beginPath(); c.arc(cx, cy, inner - 2, 0, Math.PI * 2); c.fill();
    c.textAlign = 'center'; c.fillStyle = '#f1ecff';
    c.font = 'bold 22px ui-monospace, monospace';
    c.fillText(t.bpm === null ? '—' : t.bpm.toFixed(1), cx, cy + 4);
    c.font = '10px ui-monospace, monospace'; c.fillStyle = COLOURS.muted;
    c.fillText(p > 0 ? 'BPM' : 'no pulse yet', cx, cy + 18);
    c.textAlign = 'start';
  };
}

// A column of the mixer: what the Listener heard (thin, with its average) beside what the scene gets (wide, to 1.5).
function Fader({ label, heard, average, scene, top = 1.5 }: { label: string; heard?: number; average?: number; scene: number; top?: number }) {
  const v = (x: number) => ({ transform: `scaleY(${Math.min(1, Math.max(0, x))})` });
  return (
    <div className="pv-d-fader" title={`${label}: ${scene.toFixed(2)}`}>
      <div className="pv-d-slots">
        {heard !== undefined && <b className="pv-d-heard"><i style={v(heard)} />{average !== undefined && <u style={{ bottom: `${Math.min(1, average) * 100}%` }} />}</b>}
        <b className="pv-d-scene"><i style={v(scene / top)} />{top > 1 && <u style={{ bottom: `${(1 / top) * 100}%` }} />}</b>
      </div>
      <span>{label}</span>
    </div>
  );
}

export function VariantD({ view }: { view: HearingView }) {
  const d = view.diagnostics, t = d.tempo, i = view.inputs, fps = frameRateLabel(d.frameRate);
  const onTime = kicksOnTime(d.kicks);
  return (
    <div id="hearing" className="hearing pv-d">
      <div className="pv-d-corners">
        <span>uTime {i.uTime.toFixed(1)}</span>
        <span id="hearing-state" data-state={t.state}>{t.state === 'hearing' ? 'locked' : t.state === 'holding' ? 'holding' : 'searching'}</span>
        <span>uTicks {i.uTicks}</span>
      </div>
      <Plot label="Kicks folded onto the pulse" height={250} draw={drawRadar(view)} />
      <div className="pv-d-corners">
        <span>confidence {Math.round(t.confidence * 100)} %</span>
        <span>{onTime ? `${onTime.hit}/${onTime.of} on time` : ''}</span>
        <span data-slow={fps.slow || undefined}>{Math.round(d.frameRate)} fps</span>
      </div>
      <div className="pv-legend">12 o'clock = due · <span className="kick">kicks</span> · <span className="tick">ticks</span> · newest outside · rises folded in the outer ring</div>
      <div className="pv-d-meta">{tickLagLabel(d.tickLag)} · {latencyLabel(view.latency)}</div>

      <div className="pv-d-mixer">
        {(['bass', 'mid', 'high', 'level'] as const).map((b) => (
          <Fader key={b} label={b} heard={d.bands[b].level} average={d.bands[b].average} scene={i[`u${b[0]!.toUpperCase()}${b.slice(1)}` as 'uBass']} />
        ))}
        <span className="pv-d-sep" />
        <Fader label="beat" scene={i.uBeat} />
        <Fader label="tick" scene={i.uTick} top={1} />
        <span className="pv-d-sep" />
        <Fader label="hue" scene={i.uHue} top={1} />
        <Fader label="bright" scene={i.uBright} top={1} />
        <Fader label="mood" scene={i.uMood} top={1} />
      </div>
      <div className="pv-legend">thin: heard, <span className="average">its average</span> · wide: what the scene reads, <span className="average">1</span></div>

      <div className="pv-d-strips">
        <div>{d.spectrum ? <Plot label="Spectrum" height={44} draw={drawSpectrum(d.spectrum)} /> : <div className="hearing-meta">Nothing connected</div>}<small>spectrum · tone {hz(view.centroid)}</small></div>
        <div><Plot label="Tempo candidates" height={44} draw={drawCandidates(d.candidates, t.heardBpm)} /><small>tempo candidates</small></div>
      </div>
      <div className="perf-hint pv-d-foot"><span>Close with <Kbd hotkey={HOTKEYS.hearingMonitor} /></span><HelpButton topic="hearing" /></div>
    </div>
  );
}

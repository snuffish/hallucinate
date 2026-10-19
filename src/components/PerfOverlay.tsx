import { useApp, useUI } from '../app/AppContext';
import { STAGE_LABELS, type PerfReport } from '../engine/profiler';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { HelpButton } from './Help';

const ms = (v: number) => v.toFixed(1);

function fillText(perf: PerfReport): string {
  if (perf.fillRunning) return 'Rendering at half resolution for a moment…';
  const f = perf.fill;
  if (!f) return 'Half the pixels for ~3 s: tells the GPU apart from the rest.';
  const result = `${Math.round(f.baseFps)} → ${Math.round(f.reducedFps)} fps at half resolution (×${f.gain.toFixed(2)})`;
  return perf.fillCurrent ? result : `Last test, on another scene or resolution: ${result}`;
}

// Shift+P: where each frame's time goes, and what is holding the frame rate back. Updated ~2 Hz by
// the frame loop (FrameProfiler); see PERF.md for how to read it.
export function PerfOverlay() {
  const app = useApp();
  const perf = useUI((ui) => ui.perf);
  if (!perf) return <div id="perf" className="perf" hidden />;
  const [w, h] = perf.size;
  return (
    <div id="perf" className="perf">
      <div className="perf-head">
        <b>{Math.round(perf.fps)} fps</b>
        <span>frame {ms(perf.frameP50)} · p95 {ms(perf.frameP95)} ms</span>
        <span>budget {ms(perf.budget)} ms</span>
        <HelpButton topic="perf" />
      </div>
      <div className={`perf-verdict ${perf.verdict.kind}`} data-kind={perf.verdict.kind}>{perf.verdict.text}</div>
      <table className="perf-cpu">
        <thead><tr><th>Main thread</th><th>mean</th><th>p95</th><th aria-hidden="true" /></tr></thead>
        <tbody>
          {perf.cpu.map((s) => (
            <tr key={s.stage} data-stage={s.stage}>
              <td>{STAGE_LABELS[s.stage]}</td>
              <td>{ms(s.mean)}</td>
              <td>{ms(s.p95)}</td>
              <td className="perf-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, s.mean / perf.budget)})` }} /></td>
            </tr>
          ))}
          <tr className="perf-total"><td>Total</td><td>{ms(perf.cpuMean)}</td><td>{ms(perf.cpuP95)}</td><td aria-hidden="true" /></tr>
        </tbody>
      </table>
      <div className="perf-meta">
        {w}×{h} canvas · scenes at ×{perf.scale.toFixed(2)}
        {perf.preview && ' · Preview monitor on'}
        {perf.projectors > 0 && ` · ${perf.projectors} projector${perf.projectors === 1 ? '' : 's'}`}
        {perf.trace && ' · DevTools spans on'}
      </div>
      <div className="perf-fill">
        <button type="button" disabled={perf.fillRunning} onClick={() => void app.runFillTest()}>{perf.fillRunning ? 'Testing GPU…' : 'Test GPU'}</button>
        <span id="perf-fill-result">{fillText(perf)}</span>
      </div>
      <div className="perf-hint">Close with <Kbd hotkey={HOTKEYS.perf} /></div>
    </div>
  );
}

// The player bar along the bottom of the screen, VLC style: the seek bar on a row of its own, then
// play/pause, previous/stop/next, ±10 s and loop on the left, what's playing in the middle, and tempo,
// pitch, mute and the volume wedge on the right. Shown while there is something to control (a file,
// a SoundCloud track, a video's sound or the demo beat), and hides with the widgets.

import { useRef, useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { formatTime } from '../app/transport';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { playerBar } from './widgets/drop';

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ICONS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6 6h12v12H6z',
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  fwd: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  vol: 'M4 9v6h4l5 4V5L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
};

export function PlayerBar() {
  const app = useApp();
  const t = useUI((ui) => ui.transport);
  const started = useUI((ui) => ui.started);
  const now = useUI((ui) => ui.nowText);
  const scene = useUI((ui) => ui.sceneName);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [, rerender] = useState(0);
  const tr = app.transport;
  const ref = (el: HTMLElement | null) => { playerBar.el = el; };
  if (!started || !t.mode) return <footer id="transport" className="transport" ref={ref} hidden />;
  const file = t.mode === 'element';
  const seek = scrubbing ?? (t.duration ? (t.currentTime / t.duration) * 1000 : 0);
  const vol = tr.effectiveVolume;
  const setRate = (r: number) => { tr.setRate(r); rerender((n) => n + 1); };
  return (
    <footer id="transport" className={`transport${file ? '' : ' demo'}`} ref={ref}>
      <div id="tp-seek-row" className="tp-seek">
        <time id="tp-cur">{formatTime(scrubbing === null ? t.currentTime : (scrubbing / 1000) * t.duration)}</time>
        <input type="range" id="tp-seek" min={0} max={1000} step={1} value={seek} aria-label="Seek" style={{ '--p': `${seek / 10}%` } as React.CSSProperties}
          onPointerDown={() => setScrubbing(seek)}
          onPointerUp={() => setScrubbing(null)}
          onChange={(e) => { const v = Number(e.target.value); setScrubbing(v); tr.seekTo(v / 1000); }} />
        <time id="tp-dur">{t.duration ? formatTime(t.duration) : '–:––'}</time>
      </div>
      <div className="tp-main">
        <div className="tp-buttons">
          <button id="tp-play" className="tp-play" title={`${t.playing ? 'Pause' : 'Play'} (Space)`} onClick={() => app.togglePlay()}><Icon d={t.playing ? ICONS.pause : ICONS.play} /><Kbd hotkey={HOTKEYS.playPause} /></button>
          <span className="tp-sep tp-file" />
          <button id="tp-prev" className="tp-file" title="Previous track / restart" onClick={() => tr.prev()}><Icon d={ICONS.prev} /></button>
          <button id="tp-stop" className="tp-file" title="Stop" onClick={() => tr.stop()}><Icon d={ICONS.stop} /></button>
          <button id="tp-next" className="tp-file" title="Next track" disabled={!t.hasQueue} onClick={() => tr.next()}><Icon d={ICONS.next} /></button>
          <span className="tp-sep tp-file" />
          <button id="tp-back" className="tp-file" title="Back 10 s (Shift+←)" onClick={() => tr.skip(-10)}><Icon d={ICONS.back} /><Kbd hotkey={HOTKEYS.seekBack} /></button>
          <button id="tp-fwd" className="tp-file" title="Forward 10 s (Shift+→)" onClick={() => tr.skip(10)}><Icon d={ICONS.fwd} /><Kbd hotkey={HOTKEYS.seekFwd} /></button>
          <button id="tp-loop" className={`tp-file${t.loop ? ' active' : ''}`} title="Loop this track" onClick={() => tr.setLoop(!t.loop)}><Icon d={ICONS.loop} /></button>
        </div>
        <div id="tp-title" className="tp-title">{now}{scene && <small>{scene}</small>}</div>
        <div className="tp-controls">
          <span className="tp-label">Tempo</span>
          <input type="range" id="tp-rate" min={0.5} max={2} step={0.01} value={tr.rate} aria-label="Tempo" title="Tempo ([ / ]) · double-click to reset" style={{ '--p': `${((tr.rate - 0.5) / 1.5) * 100}%` } as React.CSSProperties}
            onChange={(e) => setRate(Number(e.target.value))}
            onDoubleClick={() => setRate(1)} />
          <button id="tp-rate-val" className="tp-rate-val" title={file ? 'Click to reset to 1×' : `${Math.round(124 * tr.rate)} BPM · click to reset`} onClick={() => setRate(1)}>{tr.rate.toFixed(2)}×</button>
          <label className="tp-pitch tp-file" title="Pitch follows tempo: vinyl / nightcore style">
            <input type="checkbox" id="tp-pitch" checked={tr.pitchFollows} onChange={(e) => { tr.setPitchFollows(e.target.checked); rerender((n) => n + 1); }} /> Pitch
          </label>
          <span className="tp-sep" />
          <button id="tp-mute" className="tp-icon" title={tr.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => { tr.toggleMute(); rerender((n) => n + 1); }}><Icon d={vol ? ICONS.vol : ICONS.mute} /><Kbd hotkey={HOTKEYS.mute} /></button>
          <VolumeWedge volume={vol} onChange={(v) => { tr.setVolume(v); rerender((n) => n + 1); }} />
        </div>
      </div>
    </footer>
  );
}

// VLC's volume control: a wedge that fills from the left. Drag across it, or focus it and use ← / →
// (↑ / ↓ change the volume anywhere).
function VolumeWedge({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); onChange(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); };
  const pct = Math.round(volume * 100);
  return (
    <div ref={ref} id="tp-volume" className="tp-wedge" role="slider" tabIndex={0} aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      title="Volume (↑ / ↓)" style={{ '--p': `${pct}%` } as React.CSSProperties}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key];
        if (step === undefined) return;
        e.preventDefault(); e.stopPropagation();
        onChange(Math.min(1, Math.max(0, volume + step)));
      }}>
      <output id="tp-vol-val">{pct}%</output>
    </div>
  );
}

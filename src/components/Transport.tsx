// Panel audio player: play/pause, seek, ±10 s, previous/next track, loop, volume and tempo.

import { useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { formatTime } from '../app/transport';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ICONS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  fwd: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  vol: 'M4 9v6h4l5 4V5L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
};

export function TransportPanel() {
  const app = useApp();
  const t = useUI((ui) => ui.transport);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [, rerender] = useState(0);
  const tr = app.transport;
  if (!t.mode) return <div id="transport" className="transport" hidden />;
  const seek = scrubbing ?? (t.duration ? (t.currentTime / t.duration) * 1000 : 0);
  const vol = tr.effectiveVolume;
  return (
    <div id="transport" className={`transport${t.mode === 'demo' ? ' demo' : ''}`}>
      <div id="tp-seek-row" className="tp-seek">
        <time id="tp-cur">{formatTime(scrubbing === null ? t.currentTime : (scrubbing / 1000) * t.duration)}</time>
        <input type="range" id="tp-seek" min={0} max={1000} step={1} value={seek} aria-label="Seek" style={{ '--p': `${seek / 10}%` } as React.CSSProperties}
          onPointerDown={() => setScrubbing(seek)}
          onPointerUp={() => setScrubbing(null)}
          onChange={(e) => { const v = Number(e.target.value); setScrubbing(v); tr.seekTo(v / 1000); }} />
        <time id="tp-dur">{t.duration ? formatTime(t.duration) : '–:––'}</time>
      </div>
      <div className="tp-buttons">
        <button id="tp-loop" className={`tp-small tp-file${t.loop ? ' active' : ''}`} title="Loop this track" onClick={() => tr.setLoop(!t.loop)}><Icon d={ICONS.loop} /></button>
        <button id="tp-prev" className="tp-file" title="Previous track / restart" disabled={t.mode !== 'element'} onClick={() => tr.prev()}><Icon d={ICONS.prev} /></button>
        <button id="tp-back" className="tp-file" title="Back 10 s (Shift+←)" onClick={() => tr.skip(-10)}><Icon d={ICONS.back} /><Kbd hotkey={HOTKEYS.seekBack} /></button>
        <button id="tp-play" className="tp-play" title={`${t.playing ? 'Pause' : 'Play'} (Space)`} onClick={() => app.togglePlay()}><Icon d={t.playing ? ICONS.pause : ICONS.play} /><Kbd hotkey={HOTKEYS.playPause} /></button>
        <button id="tp-fwd" className="tp-file" title="Forward 10 s (Shift+→)" onClick={() => tr.skip(10)}><Icon d={ICONS.fwd} /><Kbd hotkey={HOTKEYS.seekFwd} /></button>
        <button id="tp-next" className="tp-file" title="Next track" disabled={!t.hasQueue} onClick={() => tr.next()}><Icon d={ICONS.next} /></button>
        <span className="tp-small tp-file" />
      </div>
      <div className="tp-row">
        <button id="tp-mute" className="tp-icon" title={tr.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => { tr.toggleMute(); rerender((n) => n + 1); }}><Icon d={vol ? ICONS.vol : ICONS.mute} /><Kbd hotkey={HOTKEYS.mute} /></button>
        <input type="range" id="tp-volume" min={0} max={1} step={0.01} value={tr.volume} aria-label="Volume" title="Volume (↑ / ↓)" style={{ '--p': `${vol * 100}%` } as React.CSSProperties}
          onChange={(e) => { tr.setVolume(Number(e.target.value)); rerender((n) => n + 1); }} />
        <output id="tp-vol-val">{Math.round(vol * 100)}%</output>
      </div>
      <div className="tp-row">
        <span className="tp-label">Tempo</span>
        <input type="range" id="tp-rate" min={0.5} max={2} step={0.01} value={tr.rate} aria-label="Tempo" title="Tempo ([ / ]) · double-click to reset" style={{ '--p': `${((tr.rate - 0.5) / 1.5) * 100}%` } as React.CSSProperties}
          onChange={(e) => { tr.setRate(Number(e.target.value)); rerender((n) => n + 1); }}
          onDoubleClick={() => { tr.setRate(1); rerender((n) => n + 1); }} />
        <button id="tp-rate-val" className="tp-rate-val" title={t.mode === 'demo' ? `${Math.round(124 * tr.rate)} BPM · click to reset` : 'Click to reset to 1×'} onClick={() => { tr.setRate(1); rerender((n) => n + 1); }}>{tr.rate.toFixed(2)}×</button>
      </div>
      <label className="toggle tp-pitch tp-file">
        <input type="checkbox" id="tp-pitch" checked={tr.pitchFollows} disabled={t.mode === 'demo'} onChange={(e) => { tr.setPitchFollows(e.target.checked); rerender((n) => n + 1); }} /> Pitch follows tempo <small>vinyl / nightcore style</small>
      </label>
    </div>
  );
}

// The player bar along the bottom of the screen, Media Player style: a thin seek line across its top edge,
// what's playing on the left, the transport around a round play button in the middle (playback speed and pitch in
// a popover off its chip), and the time and volume on the right. Shown while there is something to
// control (a file, a SoundCloud track, a video's sound or the demo beat), and hides with the widgets.

import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { formatTime } from '../app/transport';
import { DEMO_BPM } from '../engine/audio';
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
  return (
    <footer id="transport" className={`transport${file ? '' : ' demo'}`} ref={ref}>
      <input type="range" id="tp-seek" className="tp-file" min={0} max={1000} step={1} value={seek} aria-label="Seek" style={{ '--p': `${seek / 10}%` } as React.CSSProperties}
        onPointerDown={() => setScrubbing(seek)}
        onPointerUp={() => setScrubbing(null)}
        onChange={(e) => { const v = Number(e.target.value); setScrubbing(v); tr.seekTo(v / 1000); }} />
      <div className="tp-main">
        <div className="tp-info">
          <Cover />
          <div id="tp-title" className="tp-title">
            <b>{now.replace(/^(▶|❚❚)\s*/, '')}</b>
            {scene && <small>{scene}</small>}
          </div>
        </div>
        <div className="tp-buttons">
          <button id="tp-loop" className={`tp-file${t.loop ? ' active' : ''}`} title="Loop this track" onClick={() => tr.setLoop(!t.loop)}><Icon d={ICONS.loop} /></button>
          <button id="tp-stop" className="tp-file" title="Stop" onClick={() => tr.stop()}><Icon d={ICONS.stop} /></button>
          <button id="tp-back" className="tp-file" title="Back 10 s (Shift+←)" onClick={() => tr.skip(-10)}><Icon d={ICONS.back} /><Kbd hotkey={HOTKEYS.seekBack} /></button>
          <button id="tp-prev" className="tp-file" title="Previous track / restart" onClick={() => tr.prev()}><Icon d={ICONS.prev} /></button>
          <button id="tp-play" className="tp-play" title={`${t.playing ? 'Pause' : 'Play'} (Space)`} onClick={() => app.togglePlay()}><Icon d={t.playing ? ICONS.pause : ICONS.play} /><Kbd hotkey={HOTKEYS.playPause} /></button>
          <button id="tp-next" className="tp-file" title="Next track" disabled={!t.hasQueue} onClick={() => tr.next()}><Icon d={ICONS.next} /></button>
          <button id="tp-fwd" className="tp-file" title="Forward 10 s (Shift+→)" onClick={() => tr.skip(10)}><Icon d={ICONS.fwd} /><Kbd hotkey={HOTKEYS.seekFwd} /></button>
          <SpeedChip file={file} onChange={() => rerender((n) => n + 1)} />
        </div>
        <div className="tp-controls">
          <span className="tp-time tp-file"><time id="tp-cur">{formatTime(scrubbing === null ? t.currentTime : (scrubbing / 1000) * t.duration)}</time> / <time id="tp-dur">{t.duration ? formatTime(t.duration) : '–:––'}</time></span>
          <button id="tp-mute" className="tp-icon" title={tr.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => { tr.toggleMute(); rerender((n) => n + 1); }}><Icon d={vol ? ICONS.vol : ICONS.mute} /><Kbd hotkey={HOTKEYS.mute} /></button>
          <input type="range" id="tp-volume" min={0} max={1} step={0.01} value={tr.volume} aria-label="Volume" title={`Volume ${Math.round(vol * 100)}% (↑ / ↓)`} style={{ '--p': `${vol * 100}%` } as React.CSSProperties}
            onChange={(e) => { tr.setVolume(Number(e.target.value)); rerender((n) => n + 1); }} />
        </div>
      </div>
    </footer>
  );
}

// The tile beside the title: the app's colours, glowing with the bass. Its own component, so the meters
// (≤30 Hz) re-render only it.
function Cover() {
  const bass = useUI((ui) => ui.meters.bass);
  return <div className="tp-cover" aria-hidden="true" style={{ '--bass': bass } as React.CSSProperties} />;
}

// The playback speed chip shows the rate; it opens a popover with the slider, a reset and Pitch follows speed.
// Native popover: light dismiss and Esc for free. Placed above the chip when it opens.
function SpeedChip({ file, onChange }: { file: boolean; onChange: () => void }) {
  const tr = useApp().transport;
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open' || !chip.current) return;
      const c = chip.current.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(c.left + c.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
      el.style.top = `${Math.max(8, c.top - height - 10)}px`;
    };
    el.addEventListener('toggle', place);
    return () => el.removeEventListener('toggle', place);
  }, []);
  const setRate = (r: number) => { tr.setRate(r); onChange(); };
  return (
    <>
      <button ref={chip} id="tp-rate-val" className="tp-rate-val" popoverTarget="tp-tempo"
        title={file ? 'Playback speed ([ / ])' : `Playback speed: ${Math.round(DEMO_BPM * tr.rate)} BPM ([ / ])`}>{tr.rate.toFixed(2)}×</button>
      <div ref={pop} id="tp-tempo" className="tp-tempo" popover="auto" aria-label="Playback speed">
        <div className="tp-tempo-row">
          <span>Playback speed</span>
          <input type="range" id="tp-rate" min={0.5} max={2} step={0.01} value={tr.rate} aria-label="Playback speed" title="Double-click to reset" style={{ '--p': `${((tr.rate - 0.5) / 1.5) * 100}%` } as React.CSSProperties}
            onChange={(e) => setRate(Number(e.target.value))}
            onDoubleClick={() => setRate(1)} />
          <button id="tp-rate-reset" title="Reset to 1×" onClick={() => setRate(1)}>{tr.rate.toFixed(2)}×</button>
        </div>
        {file && (
          <label className="toggle tp-pitch">
            <input type="checkbox" id="tp-pitch" checked={tr.pitchFollows} onChange={(e) => { tr.setPitchFollows(e.target.checked); onChange(); }} /> Pitch follows speed <small>vinyl / nightcore style</small>
          </label>
        )}
      </div>
    </>
  );
}

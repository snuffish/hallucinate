// PROTOTYPE — throwaway (branch prototype/player-styles). Not for main.
// Question: which classic desktop player should the bottom bar look like?
// `?player=vlc` (the real PlayerBar), `wmp` (Media Player) or `winamp`; Alt+← / Alt+→ cycle.
// All three drive the real Transport and register as the player bar, so docks keep above them.

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { formatTime } from '../app/transport';
import { PlayerBar } from './Transport';
import { playerBar } from './widgets/drop';
import './player-styles.prototype.css';

const STYLES = [
  { key: 'vlc', name: 'VLC: two rows, wedge volume (today)' },
  { key: 'wmp', name: 'Media Player: info left, round play in the centre' },
  { key: 'winamp', name: 'Winamp: display panel, digital time, spectrum' },
] as const;
type StyleKey = (typeof STYLES)[number]['key'];
const read = (): StyleKey => STYLES.find((s) => s.key === new URLSearchParams(location.search).get('player'))?.key ?? 'vlc';

const P = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6 6h12v12H6z',
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  vol: 'M4 9v6h4l5 4V5L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
  eject: 'M5 17h14v2H5zM12 5l7 9H5z',
};
const I = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

function usePlayer() {
  const app = useApp();
  const t = useUI((ui) => ui.transport);
  const now = useUI((ui) => ui.nowText);
  const scene = useUI((ui) => ui.sceneName);
  const meters = useUI((ui) => ui.meters);
  const bpm = useUI((ui) => ui.bpm);
  const [, setN] = useState(0);
  const bump = () => setN((n) => n + 1);
  const tr = app.transport;
  return {
    app, t, tr, now, scene, meters, bpm,
    title: now.replace(/^(▶|❚❚)\s*/, ''),
    file: t.mode === 'element',
    frac: t.duration ? t.currentTime / t.duration : 0,
    vol: tr.effectiveVolume,
    setVol: (v: number) => { tr.setVolume(v); bump(); },
    mute: () => { tr.toggleMute(); bump(); },
    setRate: (r: number) => { tr.setRate(r); bump(); },
  };
}
type Player = ReturnType<typeof usePlayer>;
const pct = (f: number) => ({ '--p': `${f * 100}%` }) as CSSProperties;
const ref = (el: HTMLElement | null) => { playerBar.el = el; };

// Media Player: thin seek line across the top edge; track info left, round play centre, volume right.
function MediaPlayer({ p }: { p: Player }) {
  return (
    <footer id="transport" ref={ref} className="transport ps-wmp">
      <input type="range" className="ps-range ps-wmp-seek" min={0} max={1000} value={p.frac * 1000} disabled={!p.file} aria-label="Seek"
        style={pct(p.frac)} onChange={(e) => p.tr.seekTo(Number(e.target.value) / 1000)} />
      <div className="ps-wmp-row">
        <div className="ps-wmp-info">
          <div className="ps-wmp-art" aria-hidden="true" style={{ '--bass': p.meters.bass } as CSSProperties} />
          <div>
            <b>{p.title}</b>
            <small>{p.scene}</small>
          </div>
        </div>
        <div className="ps-wmp-center">
          <button className={`ps-btn${p.t.loop ? ' on' : ''}`} disabled={!p.file} onClick={() => p.tr.setLoop(!p.t.loop)} title="Loop"><I d={P.loop} /></button>
          <button className="ps-btn" disabled={!p.file} onClick={() => p.tr.stop()} title="Stop"><I d={P.stop} /></button>
          <button className="ps-btn" disabled={!p.file} onClick={() => p.tr.prev()} title="Previous"><I d={P.prev} /></button>
          <button className="ps-wmp-play" onClick={() => p.app.togglePlay()} title="Play / pause (Space)"><I d={p.t.playing ? P.pause : P.play} /></button>
          <button className="ps-btn" disabled={!p.t.hasQueue} onClick={() => p.tr.next()} title="Next"><I d={P.next} /></button>
          <button className="ps-chip" onClick={() => p.setRate(p.tr.rate >= 2 ? 0.5 : Math.round((p.tr.rate + 0.25) * 4) / 4)} title="Tempo: click to step 0.5× → 2×">{p.tr.rate.toFixed(2)}×</button>
        </div>
        <div className="ps-wmp-right">
          <time>{formatTime(p.t.currentTime)}{p.file ? ` / ${formatTime(p.t.duration)}` : ''}</time>
          <button className="ps-btn" onClick={p.mute} title="Mute (M)"><I d={p.vol ? P.vol : P.mute} /></button>
          <input type="range" className="ps-range ps-wmp-vol" min={0} max={1} step={0.01} value={p.tr.volume} aria-label="Volume" style={pct(p.vol)} onChange={(e) => p.setVol(Number(e.target.value))} />
        </div>
      </div>
    </footer>
  );
}

// Winamp: a black display (digital time, scrolling title, BPM / tempo, a mini spectrum), then a row of
// square buttons, the seek and the volume / tempo sliders.
function Winamp({ p }: { p: Player }) {
  const m = p.meters;
  const bands = useSpectrum(m);
  const remaining = useRef(false);
  const [, flip] = useState(0);
  const time = remaining.current && p.t.duration ? `-${formatTime(p.t.duration - p.t.currentTime)}` : formatTime(p.t.currentTime);
  return (
    <footer id="transport" ref={ref} className="transport ps-amp">
      <div className="ps-amp-display" onClick={() => { remaining.current = !remaining.current; flip((n) => n + 1); }} title="Click: elapsed / remaining">
        <div className="ps-amp-state">{p.t.playing ? '▶' : '❚❚'}</div>
        <div className="ps-amp-time">{time}</div>
        <div className="ps-amp-spec" aria-hidden="true">{bands.map((v, i) => <i key={i} style={{ height: `${Math.max(4, v * 100)}%` }} />)}</div>
        <div className="ps-amp-text">
          <div className="ps-amp-marquee"><span>{`${p.title}  ***  ${p.scene}  ***  `}</span><span>{`${p.title}  ***  ${p.scene}  ***  `}</span></div>
          <div className="ps-amp-info"><b>{p.bpm ? Math.round(p.bpm) : '--'}</b> bpm <b>{p.tr.rate.toFixed(2)}</b>× <span className={p.t.loop ? 'lit' : ''}>REPEAT</span> <span className={p.vol ? '' : 'lit'}>MUTE</span></div>
        </div>
      </div>
      <div className="ps-amp-controls">
        <input type="range" className="ps-amp-slider ps-amp-seek" min={0} max={1000} value={p.frac * 1000} disabled={!p.file} aria-label="Seek" onChange={(e) => p.tr.seekTo(Number(e.target.value) / 1000)} />
        <div className="ps-amp-buttons">
          <button disabled={!p.file} onClick={() => p.tr.prev()} title="Previous"><I d={P.prev} /></button>
          <button onClick={() => p.app.togglePlay()} title="Play / pause (Space)"><I d={p.t.playing ? P.pause : P.play} /></button>
          <button disabled={!p.file} onClick={() => p.tr.stop()} title="Stop"><I d={P.stop} /></button>
          <button disabled={!p.t.hasQueue} onClick={() => p.tr.next()} title="Next"><I d={P.next} /></button>
          <button className={p.t.loop ? 'on' : ''} disabled={!p.file} onClick={() => p.tr.setLoop(!p.t.loop)} title="Repeat"><I d={P.loop} /></button>
          <span className="ps-amp-gap" />
          <label>VOL<input type="range" className="ps-amp-slider" min={0} max={1} step={0.01} value={p.tr.volume} aria-label="Volume" onChange={(e) => p.setVol(Number(e.target.value))} /></label>
          <label>TEMPO<input type="range" className="ps-amp-slider" min={0.5} max={2} step={0.01} value={p.tr.rate} aria-label="Tempo" onChange={(e) => p.setRate(Number(e.target.value))} onDoubleClick={() => p.setRate(1)} /></label>
        </div>
      </div>
    </footer>
  );
}

// Sixteen bars from the five meters (the bar only has bands, not bins): interpolated, with a little jitter
// and a falling peak so it reads as a spectrum.
function useSpectrum(m: Player['meters']): number[] {
  const peaks = useRef<number[]>(Array(16).fill(0));
  const anchors = [m.bass, m.bass * 0.9, m.mid, m.mid * 0.8, m.high, m.high * 0.6];
  return peaks.current = peaks.current.map((prev, i) => {
    const x = (i / 15) * (anchors.length - 1), a = Math.floor(x), f = x - a;
    const v = (anchors[a]! * (1 - f) + (anchors[a + 1] ?? anchors[a]!) * f) * (0.85 + Math.random() * 0.3) + m.beat * 0.15;
    return Math.min(1, Math.max(v, prev - 0.06));
  });
}

function Switcher({ v, set }: { v: StyleKey; set: (k: StyleKey) => void }) {
  const p = usePlayer();
  const i = STYLES.findIndex((s) => s.key === v);
  const step = (d: number) => set(STYLES[(i + d + STYLES.length) % STYLES.length]!.key);
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      e.preventDefault(); e.stopPropagation();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <div className="ps-switcher">
      <button onClick={() => step(-1)} title="Alt+←">‹</button>
      <span><b>{i + 1}/{STYLES.length}</b> {STYLES[i]!.name}</span>
      <button onClick={() => step(1)} title="Alt+→">›</button>
      <code>mode={String(p.t.mode)} {p.t.playing ? '▶' : '❚❚'} {formatTime(p.t.currentTime)}/{formatTime(p.t.duration)} vol={Math.round(p.vol * 100)}% rate={p.tr.rate.toFixed(2)} loop={String(p.t.loop)}</code>
    </div>
  );
}

export function PlayerStylesPrototype() {
  const [v, setV] = useState<StyleKey>(read);
  const p = usePlayer();
  const started = useUI((ui) => ui.started);
  const set = (k: StyleKey) => {
    const url = new URL(location.href);
    url.searchParams.set('player', k);
    history.replaceState(null, '', url);
    setV(k);
  };
  if (!import.meta.env.DEV) return <PlayerBar />;
  const shown = started && p.t.mode;
  return (
    <>
      {v === 'vlc' || !shown ? <PlayerBar /> : v === 'wmp' ? <MediaPlayer p={p} /> : <Winamp p={p} />}
      <Switcher v={v} set={set} />
    </>
  );
}

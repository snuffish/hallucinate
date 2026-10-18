// PROTOTYPE — throwaway (branch prototype/footer-player). Not for main.
// Question: what should an always-there audio player along the bottom of the app look like (VLC-ish)?
// Four variants + today's baseline, switchable via `?footer=` (0, A, B, C, D) and the bar at the top
// (Alt+← / Alt+→: plain arrows already step scenes). Everything drives the real `Transport`.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { formatTime } from '../app/transport';
import type { SourceButton } from '../state/app-state';
import { SOURCES } from './StartScreen';
import './footer-player.prototype.css';

const VARIANTS = [
  { key: '0', name: 'Today: player inside the Source widget' },
  { key: 'A', name: 'VLC bar: full-width, two rows' },
  { key: 'B', name: 'Slim strip: the bar is the timeline' },
  { key: 'C', name: 'Island: centred capsule' },
  { key: 'D', name: 'Deck: sources + player + scene in one footer' },
] as const;
type VariantKey = (typeof VARIANTS)[number]['key'];

const readVariant = (): VariantKey => {
  const v = new URLSearchParams(location.search).get('footer')?.toUpperCase();
  return VARIANTS.find((x) => x.key === v)?.key ?? 'A';
};

const P = {
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
  scenePrev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  sceneNext: 'M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6z',
};
const I = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

// Everything every variant needs, read once. `bump` re-renders after volume/rate/mute (Transport doesn't publish those).
function usePlayer() {
  const app = useApp();
  const t = useUI((ui) => ui.transport);
  const now = useUI((ui) => ui.nowText);
  const scene = useUI((ui) => ui.sceneName);
  const meters = useUI((ui) => ui.meters);
  const bpm = useUI((ui) => ui.bpm);
  const active = useUI((ui) => ui.activeSource);
  const [, setN] = useState(0);
  const bump = () => setN((n) => n + 1);
  const tr = app.transport;
  const frac = t.duration ? t.currentTime / t.duration : 0;
  return {
    app, t, tr, now, scene, meters, bpm, active, frac, bump,
    vol: tr.effectiveVolume,
    canSeek: t.mode === 'element' && t.duration > 0,
    play: () => app.togglePlay(),
    stop: () => { if (t.playing) app.togglePlay(); tr.seekTo(0); },
    seek: (f: number) => tr.seekTo(Math.min(1, Math.max(0, f))),
    setVol: (v: number) => { tr.setVolume(v); bump(); },
    mute: () => { tr.toggleMute(); bump(); },
    setRate: (r: number) => { tr.setRate(r); bump(); },
  };
}
type Player = ReturnType<typeof usePlayer>;

const pct = (f: number) => ({ '--p': `${f * 100}%` }) as CSSProperties;

function Seek({ p, className = '' }: { p: Player; className?: string }) {
  return (
    <input type="range" className={`fp-range ${className}`} min={0} max={1000} value={p.frac * 1000} disabled={!p.canSeek} aria-label="Seek"
      style={pct(p.frac)} onChange={(e) => p.seek(Number(e.target.value) / 1000)} />
  );
}

function Volume({ p }: { p: Player }) {
  return (
    <>
      <button className="fp-btn" title="Mute (M)" onClick={p.mute}><I d={p.vol ? P.vol : P.mute} /></button>
      <input type="range" className="fp-range fp-vol" min={0} max={1} step={0.01} value={p.tr.volume} aria-label="Volume" style={pct(p.vol)} onChange={(e) => p.setVol(Number(e.target.value))} />
    </>
  );
}

function Tempo({ p }: { p: Player }) {
  return (
    <span className="fp-tempo">
      <input type="range" className="fp-range" min={0.5} max={2} step={0.01} value={p.tr.rate} aria-label="Tempo" title="Tempo · double-click to reset"
        style={pct((p.tr.rate - 0.5) / 1.5)} onChange={(e) => p.setRate(Number(e.target.value))} onDoubleClick={() => p.setRate(1)} />
      <button className="fp-chip" title="Reset to 1×" onClick={() => p.setRate(1)}>{p.tr.rate.toFixed(2)}×</button>
    </span>
  );
}

const Title = ({ p }: { p: Player }) => <>{p.t.mode ? p.now : 'No audio — pick a source'}</>;
const times = (p: Player) => `${formatTime(p.t.currentTime)} / ${p.t.duration ? formatTime(p.t.duration) : '–:––'}`;

// A — VLC: edge-to-edge, seek bar on its own row, buttons left, title middle, tempo + wedge volume right.
function VariantA({ p }: { p: Player }) {
  const el = p.t.mode === 'element';
  return (
    <div className="fp fp-a">
      <div className="fp-a-seek">
        <time>{formatTime(p.t.currentTime)}</time>
        <Seek p={p} />
        <time>{p.t.duration ? formatTime(p.t.duration) : '–:––'}</time>
      </div>
      <div className="fp-a-row">
        <div className="fp-group">
          <button className="fp-btn fp-big" title="Play / pause (Space)" onClick={p.play}><I d={p.t.playing ? P.pause : P.play} /></button>
          <span className="fp-sep" />
          <button className="fp-btn" title="Previous" disabled={!el} onClick={() => p.tr.prev()}><I d={P.prev} /></button>
          <button className="fp-btn" title="Stop" onClick={p.stop}><I d={P.stop} /></button>
          <button className="fp-btn" title="Next" disabled={!p.t.hasQueue} onClick={() => p.tr.next()}><I d={P.next} /></button>
          <span className="fp-sep" />
          <button className="fp-btn" title="Back 10 s" disabled={!el} onClick={() => p.tr.skip(-10)}><I d={P.back} /></button>
          <button className="fp-btn" title="Forward 10 s" disabled={!el} onClick={() => p.tr.skip(10)}><I d={P.fwd} /></button>
          <button className={`fp-btn${p.t.loop ? ' on' : ''}`} title="Loop" disabled={!el} onClick={() => p.tr.setLoop(!p.t.loop)}><I d={P.loop} /></button>
        </div>
        <div className="fp-a-title"><Title p={p} /><small>{p.scene}</small></div>
        <div className="fp-group">
          <span className="fp-label">Tempo</span><Tempo p={p} />
          <span className="fp-sep" />
          <button className="fp-btn" title="Mute (M)" onClick={p.mute}><I d={p.vol ? P.vol : P.mute} /></button>
          <Wedge p={p} />
        </div>
      </div>
    </div>
  );
}

// VLC's triangular volume control: drag across the wedge.
function Wedge({ p }: { p: Player }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); p.setVol((e.clientX - r.left) / r.width); };
  return (
    <div ref={ref} className="fp-wedge" style={pct(p.vol)} role="slider" aria-label="Volume" aria-valuenow={Math.round(p.vol * 100)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }} onPointerMove={(e) => { if (e.buttons) at(e); }}>
      <span>{Math.round(p.vol * 100)}%</span>
    </div>
  );
}

// B — slim strip: one 38px row whose whole background is the progress; click anywhere to seek.
// Hover lifts a second row with the rest. Idle: shrinks to a 3px progress line instead of vanishing.
function VariantB({ p }: { p: Player }) {
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (p.canSeek) p.seek((e.clientX - r.left) / r.width);
  };
  return (
    <div className="fp fp-b" style={{ ...pct(p.frac), '--bass': p.meters.bass } as CSSProperties}>
      <div className="fp-b-more">
        <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.prev()}><I d={P.prev} /></button>
        <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.skip(-10)}><I d={P.back} /></button>
        <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.skip(10)}><I d={P.fwd} /></button>
        <button className="fp-btn" disabled={!p.t.hasQueue} onClick={() => p.tr.next()}><I d={P.next} /></button>
        <button className={`fp-btn${p.t.loop ? ' on' : ''}`} disabled={p.t.mode !== 'element'} onClick={() => p.tr.setLoop(!p.t.loop)}><I d={P.loop} /></button>
        <span className="fp-sep" />
        <span className="fp-label">Tempo</span><Tempo p={p} />
        <span className="fp-sep" />
        <Volume p={p} />
      </div>
      <div className="fp-b-strip" onClick={seekAt}>
        <button className="fp-btn" onClick={p.play}><I d={p.t.playing ? P.pause : P.play} /></button>
        <span className="fp-b-title"><Title p={p} /></span>
        <span className="fp-b-scene">{p.scene}</span>
        <time>{times(p)}</time>
      </div>
    </div>
  );
}

// C — island: a floating capsule in the middle; the play button wears the progress as a ring.
function VariantC({ p }: { p: Player }) {
  const R = 21, C = 2 * Math.PI * R;
  const [volOpen, setVolOpen] = useState(false);
  return (
    <div className="fp-c-wrap">
      <div className="fp fp-c">
        <button className="fp-btn" title="Previous scene (←)" onClick={() => p.app.stepScene(-1)}><I d={P.scenePrev} /></button>
        <div className="fp-c-meta">
          <b><Title p={p} /></b>
          <small>{p.scene}{p.bpm ? ` · ${Math.round(p.bpm)} BPM` : ''}</small>
        </div>
        <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.skip(-10)}><I d={P.back} /></button>
        <button className="fp-c-play" onClick={p.play} title="Play / pause (Space)">
          <svg className="fp-ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r={R} /><circle cx="24" cy="24" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - p.frac)} /></svg>
          <I d={p.t.playing ? P.pause : P.play} />
        </button>
        <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.skip(10)}><I d={P.fwd} /></button>
        <time>{times(p)}</time>
        <div className="fp-c-vol" onMouseEnter={() => setVolOpen(true)} onMouseLeave={() => setVolOpen(false)}>
          <button className="fp-btn" onClick={p.mute}><I d={p.vol ? P.vol : P.mute} /></button>
          {volOpen && (
            <div className="fp-c-pop">
              <input type="range" className="fp-range" min={0} max={1} step={0.01} value={p.tr.volume} aria-label="Volume" style={pct(p.vol)} onChange={(e) => p.setVol(Number(e.target.value))} />
              <span>{Math.round(p.vol * 100)}%</span>
              <Tempo p={p} />
            </div>
          )}
        </div>
        <button className="fp-btn" title="Next scene (→)" onClick={() => p.app.stepScene(1)}><I d={P.sceneNext} /></button>
      </div>
    </div>
  );
}

// D — deck: the footer replaces the Source widget. Sources left, player + live spectrum centre, scene + BPM right.
function VariantD({ p, onSource }: { p: Player; onSource: (k: SourceButton) => void }) {
  const m = p.meters;
  return (
    <div className="fp fp-d">
      <div className="fp-d-src">
        {SOURCES.map((s) => <button key={s.kind} className={`fp-chip${p.active === s.kind ? ' on' : ''}`} onClick={() => onSource(s.kind)}>{s.short}</button>)}
      </div>
      <div className="fp-d-mid">
        <div className="fp-d-top">
          <button className="fp-btn" disabled={p.t.mode !== 'element'} onClick={() => p.tr.prev()}><I d={P.prev} /></button>
          <button className="fp-btn fp-big" onClick={p.play}><I d={p.t.playing ? P.pause : P.play} /></button>
          <button className="fp-btn" disabled={!p.t.hasQueue} onClick={() => p.tr.next()}><I d={P.next} /></button>
          <span className="fp-d-title"><Title p={p} /></span>
          <time>{times(p)}</time>
        </div>
        <div className="fp-d-seek">
          <div className="fp-d-spec" aria-hidden="true">
            {[m.bass, m.mid, m.high, m.bright, m.beat, m.high, m.mid, m.bass].map((v, i) => <i key={i} style={{ height: `${10 + v * 90}%` }} />)}
          </div>
          <Seek p={p} />
        </div>
      </div>
      <div className="fp-d-right">
        <div className="fp-d-scene">
          <button className="fp-btn" onClick={() => p.app.stepScene(-1)}><I d={P.scenePrev} /></button>
          <span>{p.scene}</span>
          <button className="fp-btn" onClick={() => p.app.stepScene(1)}><I d={P.sceneNext} /></button>
        </div>
        <div className="fp-d-knobs">
          <span className="fp-bpm"><b>{p.bpm ? Math.round(p.bpm) : '–'}</b> BPM</span>
          <Tempo p={p} />
          <Volume p={p} />
        </div>
      </div>
    </div>
  );
}

function Switcher({ v, set, p }: { v: VariantKey; set: (k: VariantKey) => void; p: Player }) {
  const i = VARIANTS.findIndex((x) => x.key === v);
  const step = (d: number) => set(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]!.key);
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
    <div className="fp-switcher">
      <button onClick={() => step(-1)} title="Alt+←">‹</button>
      <span><b>{v}</b> {VARIANTS[i]!.name}</span>
      <button onClick={() => step(1)} title="Alt+→">›</button>
      <code>mode={String(p.t.mode)} {p.t.playing ? '▶' : '⏸'} {times(p)} vol={Math.round(p.vol * 100)}% rate={p.tr.rate.toFixed(2)} loop={String(p.t.loop)} queue={String(p.t.hasQueue)}</code>
    </div>
  );
}

export function FooterPlayerPrototype({ onSource }: { onSource: (k: SourceButton) => void }) {
  const [v, setV] = useState<VariantKey>(readVariant);
  const p = usePlayer();
  const started = useUI((ui) => ui.started);
  const host = useRef<HTMLDivElement>(null);
  const set = (k: VariantKey) => {
    const url = new URL(location.href);
    url.searchParams.set('footer', k);
    history.replaceState(null, '', url);
    setV(k);
  };

  // Tell the docks / bubble how much room the footer takes (see the CSS), and which variant is up.
  useLayoutEffect(() => {
    const body = document.body;
    body.dataset.footer = v;
    const measure = () => body.style.setProperty('--footer-h', `${host.current?.offsetHeight ?? 0}px`);
    measure();
    const ro = new ResizeObserver(measure);
    if (host.current) ro.observe(host.current);
    return () => { ro.disconnect(); delete body.dataset.footer; body.style.removeProperty('--footer-h'); };
  }, [v, started]);

  if (!import.meta.env.DEV) return null;
  let footer: ReactNode = null;
  if (v === 'A') footer = <VariantA p={p} />;
  if (v === 'B') footer = <VariantB p={p} />;
  if (v === 'C') footer = <VariantC p={p} />;
  if (v === 'D') footer = <VariantD p={p} onSource={onSource} />;
  return (
    <>
      {started && <footer ref={host} className="fp-host">{footer}</footer>}
      <Switcher v={v} set={set} p={p} />
    </>
  );
}

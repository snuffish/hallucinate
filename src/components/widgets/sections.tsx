// The bodies of the control widgets: sources and player, media, meters, scene, look sliders,
// actions. Each reads its own slice of the store; the widget frame (title, drag, dock) is `Widget`.

import type { CSSProperties } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { STATIC_DEMO } from '../../app/static-demo';
import { HOTKEYS } from '../../hotkeys/registry';
import { Kbd } from '../../hotkeys/Kbd';
import { LOOK_RANGES, type LookKey, type SourceButton } from '../../state/app-state';
import { SOURCES } from '../StartScreen';
import { TransportPanel } from '../Transport';

export interface PanelActions {
  onSource: (kind: SourceButton) => void;
  onOpenMediaFile: () => void;
  onOpenYouTube: () => void;
  onOpenLibrary: () => void;
  onOpenEditor: () => void;
  onOpenVisualMaker: () => void;
  onOpenStudio: () => void;
}

export function Downloads() {
  const downloads = useUI((ui) => ui.downloads);
  const app = useApp();
  return (
    <div id="downloads" className="downloads">
      {downloads.map((d) => (
        <div key={d.id} className={`download ${d.id}`} title={d.title}>
          <div className="download-head" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) app.setOverlay(d.id === 'yt' ? 'youtube' : 'soundcloud'); }}>
            <b>{d.id === 'yt' ? 'YouTube' : 'SoundCloud'}</b><span>{d.text}</span>
            <button className="icon" title="Cancel the download" onClick={() => app.cancelDownload(d.id)}>×</button>
          </div>
          <div className="dl-bar"><i style={{ width: `${d.percent}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function SourceBody({ onSource }: { onSource: (kind: SourceButton) => void }) {
  const active = useUI((ui) => ui.activeSource);
  const now = useUI((ui) => ui.nowText);
  return (
    <>
      <Downloads />
      <div className="sources compact">
        {SOURCES.map((s) => <button key={s.kind} data-source={s.kind} className={active === s.kind ? 'active' : undefined} onClick={() => onSource(s.kind)}>{s.short}</button>)}
      </div>
      <div id="now" className="now">{now}</div>
      <TransportPanel />
    </>
  );
}

export function MediaBody({ onOpenMediaFile, onOpenYouTube }: { onOpenMediaFile: () => void; onOpenYouTube: () => void }) {
  const app = useApp();
  const media = useUI((ui) => ui.media);
  const mediaSound = useUI((ui) => ui.mediaSound);
  return (
    <>
      <div className="media-row">
        <div id="media-preview" className="media-preview" ref={(el) => { if (!el) return; el.replaceChildren(...(app.media.el && media.loaded ? [app.media.el] : [])); }} />
        <span id="media-name" className="media-name">
          {media.loaded ? `${media.name} · ${media.width}×${media.height}${media.kind === 'video' ? ' · video' : ''}` : `Drop an image or video anywhere${STATIC_DEMO ? '' : ', or pick one from YouTube'}`}
        </span>
      </div>
      <div className="media-buttons">
        <button id="media-open" onClick={onOpenMediaFile}>Open file</button>
        {!STATIC_DEMO && <button id="media-youtube" onClick={onOpenYouTube}>YouTube</button>}
        <button id="media-clear" disabled={!media.loaded} onClick={() => app.clearMedia()}>Clear</button>
      </div>
      <label id="media-sound-row" className="toggle media-sound" hidden={media.kind !== 'video'}>
        <input type="checkbox" id="media-sound" checked={mediaSound} onChange={(e) => app.setMediaSound(e.target.checked)} /> Use the video's sound as the music
      </label>
    </>
  );
}

export function AudioBody() {
  const m = useUI((ui) => ui.meters);
  const bpm = useUI((ui) => ui.bpm);
  const moodLabel = useUI((ui) => ui.moodLabel);
  const toneTitle = useUI((ui) => ui.toneTitle);
  const bar = (v: number): CSSProperties => ({ transform: `scaleX(${v})` });
  return (
    <>
      <div className="meters">
        <div><span>Bass</span><i id="m-bass" style={bar(m.bass)} /></div>
        <div><span>Mid</span><i id="m-mid" style={bar(m.mid)} /></div>
        <div><span>High</span><i id="m-high" style={bar(m.high)} /></div>
        <div id="tone-row" title={toneTitle}><span>Tone</span><b className="tone-track"><i id="m-tone" style={{ left: `${m.bright * 100}%` }} /></b></div>
      </div>
      <div className="beat-row"><span id="beat" className="beat" style={{ opacity: 0.15 + m.beat * 0.85 }} /><span id="bpm">{bpm ? `~${bpm} BPM` : '— BPM'}</span><span id="mood-label">{moodLabel}</span></div>
    </>
  );
}

export function SceneBody({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const app = useApp();
  const name = useUI((ui) => ui.sceneName);
  const auto = useUI((ui) => ui.look.auto);
  const liveName = useUI((ui) => ui.liveName);
  const screenMode = useUI((ui) => ui.screenMode);
  return (
    <>
      <div className="scene-now">
        <button id="scene-prev" className="icon" title="Previous scene (←)" onClick={() => app.stepScene(-1)}>‹</button>
        <span id="scene-name">{name}</span>
        <button id="scene-next" className="icon" title="Next scene (→)" onClick={() => app.stepScene(1)}>›</button>
      </div>
      {liveName && <div id="live-pin" className="live-pin" title="The projector shows the Live show scene. The Screen widget switches this screen between your preview and Live; the studio (O) puts Live back on screen too.">● LIVE · {liveName} <span>· {screenMode === 'live' ? 'on screen' : 'screen is a preview'}</span></div>}
      <div className="scene-buttons">
        <button id="open-library" onClick={onOpenLibrary}>Scene library<Kbd hotkey={HOTKEYS.library} /></button>
      </div>
      <label className="toggle"><input type="checkbox" id="auto" checked={auto} onChange={(e) => app.setLookFlag('auto', e.target.checked)} /> Auto-switch on the beat <Kbd hotkey={HOTKEYS.auto} /></label>
    </>
  );
}

// The main screen while the studio is closed: your preview (browse freely, Live keeps playing on
// the projectors) or Live itself. With the studio open the screen is always the Live monitor.
export function ScreenBody() {
  const app = useApp();
  const mode = useUI((ui) => ui.screenMode);
  const liveName = useUI((ui) => ui.liveName);
  const studioOpen = useUI((ui) => ui.overlay === 'studio');
  const status = studioOpen ? 'The studio is open: the screen is the Live monitor.'
    : !liveName ? 'Nothing is pinned Live: the screen and the projectors show the same. Take a show scene (T) to split them.'
    : mode === 'live' ? `Showing Live: ${liveName}. Scene changes you make go to the preview.`
    : `Showing your preview. Live: ${liveName}.`;
  return (
    <>
      <div className="seg" role="group" aria-label="What the screen shows">
        {(['preview', 'live'] as const).map((m) => (
          <button key={m} id={`screen-${m}`} className={mode === m ? 'active' : undefined} aria-pressed={mode === m} disabled={studioOpen}
            onClick={() => app.live.setScreenMode(m)}>{m === 'live' ? '● Live' : 'Preview'}</button>
        ))}
      </div>
      <small id="screen-status" className="screen-status">{status}</small>
    </>
  );
}

const SLIDERS: { key: LookKey; label: string; hint?: string }[] = [
  { key: 'reactivity', label: 'Reactivity' },
  { key: 'speed', label: 'Speed' },
  { key: 'trails', label: 'Trails' },
  { key: 'hue', label: 'Colour' },
  { key: 'cycle', label: 'Colour cycling' },
  { key: 'synesthesia', label: 'Synesthesia', hint: 'dark sound → dim & cool · bright sound → light & warm · energetic mood → vivid & warm' },
];

export function LookBody() {
  const app = useApp();
  const look = useUI((ui) => ui.look);
  const slider = (key: LookKey) => {
    const r = LOOK_RANGES[key];
    return <input type="range" id={key} min={r.min} max={r.max} step={r.step} value={look[key]} onChange={(e) => app.setLook(key, Number(e.target.value))} />;
  };
  return (
    <>
      {SLIDERS.map((s) => <label key={s.key}>{s.label} {s.hint && <small>{s.hint}</small>}{slider(s.key)}</label>)}
      <label>Fringing {slider('aberration')}</label>
      <label className="toggle"><input type="checkbox" id="drift" checked={look.drift} onChange={(e) => app.setLookFlag('drift', e.target.checked)} /> Drift <small>sliders glide to random values, each at its own pace</small></label>
      {look.drift && <label>Drift speed {slider('driftSpeed')}</label>}
    </>
  );
}

export function ActionsBody(a: PanelActions) {
  const app = useApp();
  const recording = useUI((ui) => ui.recording);
  const randomScene = useUI((ui) => ui.look.randomScene);
  return (
    <>
      <button id="randomize" title={randomScene ? 'Random look and a random scene' : 'Random values for the Look sliders'} onClick={() => app.randomize()}>Randomize<Kbd hotkey={HOTKEYS.randomize} /></button>
      <button id="fullscreen" onClick={() => app.toggleFullscreen()}>Fullscreen<Kbd hotkey={HOTKEYS.fullscreen} /></button>
      <button id="record" className={recording ? 'recording' : undefined} onClick={() => app.toggleRecording()}>{recording ? 'Stop rec' : 'Record'}<Kbd hotkey={HOTKEYS.record} /></button>
      <button id="code" onClick={a.onOpenEditor}>Code<Kbd hotkey={HOTKEYS.editor} /></button>
      <button id="visual" onClick={a.onOpenVisualMaker}>Visual maker<Kbd hotkey={HOTKEYS.visualMaker} /></button>
      <button id="studio-open" onClick={a.onOpenStudio}>Studio &amp; projector<Kbd hotkey={HOTKEYS.studio} /></button>
      <label className="toggle random-scene"><input type="checkbox" id="random-scene" checked={randomScene} onChange={(e) => app.setLookFlag('randomScene', e.target.checked)} /> Randomize also picks a random scene</label>
    </>
  );
}

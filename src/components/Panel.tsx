// The control panel on the left: sources, player, media, meters, scene, look sliders, actions.

import type { CSSProperties } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { STATIC_DEMO } from '../app/static-demo';
import { HELP_ROW, HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { LOOK_RANGES, type LookKey, type SourceButton } from '../state/app-state';
import { SOURCES } from './StartScreen';
import { TransportPanel } from './Transport';

export interface PanelActions {
  onSource: (kind: SourceButton) => void;
  onOpenMediaFile: () => void;
  onOpenYouTube: () => void;
  onOpenLibrary: () => void;
  onOpenEditor: () => void;
  onOpenVisualMaker: () => void;
  onOpenStudio: () => void;
}

export function Panel(a: PanelActions) {
  const collapsed = useUI((ui) => ui.panelCollapsed);
  return (
    <aside id="panel" className={`panel${collapsed ? ' collapsed' : ''}`}>
      <PanelHeader />
      <Downloads />
      <SourceGroup onSource={a.onSource} />
      <MediaGroup onOpenMediaFile={a.onOpenMediaFile} onOpenYouTube={a.onOpenYouTube} />
      <AudioGroup />
      <SceneGroup onOpenLibrary={a.onOpenLibrary} />
      <LookGroup />
      <ActionsGroup {...a} />
      <HelpRow />
    </aside>
  );
}

function PanelHeader() {
  const app = useApp();
  return (
    <header>
      <strong>Hallucinate</strong>
      <button id="collapse" className="icon" title="Hide panel (H)" onClick={() => app.togglePanel()}>–<Kbd hotkey={HOTKEYS.hidePanel} /></button>
    </header>
  );
}

function Downloads() {
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

function SourceGroup({ onSource }: { onSource: (kind: SourceButton) => void }) {
  const active = useUI((ui) => ui.activeSource);
  const now = useUI((ui) => ui.nowText);
  return (
    <div className="group">
      <label>Source</label>
      <div className="sources compact">
        {SOURCES.map((s) => <button key={s.kind} data-source={s.kind} className={active === s.kind ? 'active' : undefined} onClick={() => onSource(s.kind)}>{s.short}</button>)}
      </div>
      <div id="now" className="now">{now}</div>
      <TransportPanel />
    </div>
  );
}

function MediaGroup({ onOpenMediaFile, onOpenYouTube }: { onOpenMediaFile: () => void; onOpenYouTube: () => void }) {
  const app = useApp();
  const media = useUI((ui) => ui.media);
  const mediaSound = useUI((ui) => ui.mediaSound);
  return (
    <div className="group">
      <label>Media</label>
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
    </div>
  );
}

function AudioGroup() {
  const m = useUI((ui) => ui.meters);
  const bpm = useUI((ui) => ui.bpm);
  const moodLabel = useUI((ui) => ui.moodLabel);
  const toneTitle = useUI((ui) => ui.toneTitle);
  const bar = (v: number): CSSProperties => ({ transform: `scaleX(${v})` });
  return (
    <div className="group">
      <label>Audio</label>
      <div className="meters">
        <div><span>Bass</span><i id="m-bass" style={bar(m.bass)} /></div>
        <div><span>Mid</span><i id="m-mid" style={bar(m.mid)} /></div>
        <div><span>High</span><i id="m-high" style={bar(m.high)} /></div>
        <div id="tone-row" title={toneTitle}><span>Tone</span><b className="tone-track"><i id="m-tone" style={{ left: `${m.bright * 100}%` }} /></b></div>
      </div>
      <div className="beat-row"><span id="beat" className="beat" style={{ opacity: 0.15 + m.beat * 0.85 }} /><span id="bpm">{bpm ? `~${bpm} BPM` : '— BPM'}</span><span id="mood-label">{moodLabel}</span></div>
    </div>
  );
}

function SceneGroup({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const app = useApp();
  const name = useUI((ui) => ui.sceneName);
  const auto = useUI((ui) => ui.look.auto);
  const liveName = useUI((ui) => ui.liveName);
  return (
    <div className="group">
      <label>Scene</label>
      <div className="scene-now">
        <button id="scene-prev" className="icon" title="Previous scene (←)" onClick={() => app.stepScene(-1)}>‹</button>
        <span id="scene-name">{name}</span>
        <button id="scene-next" className="icon" title="Next scene (→)" onClick={() => app.stepScene(1)}>›</button>
      </div>
      {liveName && <div id="live-pin" className="live-pin" title="The projector shows the Live show scene; what you see here is a preview. Open the studio (O) to put Live back on screen.">● LIVE · {liveName} <span>· screen is a preview</span></div>}
      <div className="scene-buttons">
        <button id="open-library" onClick={onOpenLibrary}>Scene library<Kbd hotkey={HOTKEYS.library} /></button>
        <button id="play-game" onClick={() => app.setScene(app.state.gameIndex)}>Beat Racer<Kbd hotkey={HOTKEYS.game} /></button>
      </div>
      <label className="toggle"><input type="checkbox" id="auto" checked={auto} onChange={(e) => app.setLookFlag('auto', e.target.checked)} /> Auto-switch on the beat <Kbd hotkey={HOTKEYS.auto} /></label>
    </div>
  );
}

const SLIDERS: { key: LookKey; label: string; hint?: string }[] = [
  { key: 'reactivity', label: 'Reactivity' },
  { key: 'speed', label: 'Speed' },
  { key: 'trails', label: 'Trails' },
  { key: 'hue', label: 'Colour' },
  { key: 'cycle', label: 'Colour cycling' },
  { key: 'synesthesia', label: 'Synesthesia', hint: 'dark sound → dim & cool · bright sound → light & warm' },
];

function LookGroup() {
  const app = useApp();
  const look = useUI((ui) => ui.look);
  const slider = (key: LookKey) => {
    const r = LOOK_RANGES[key];
    return <input type="range" id={key} min={r.min} max={r.max} step={r.step} value={look[key]} onChange={(e) => app.setLook(key, Number(e.target.value))} />;
  };
  return (
    <div className="group sliders">
      {SLIDERS.map((s) => <label key={s.key}>{s.label} {s.hint && <small>{s.hint}</small>}{slider(s.key)}</label>)}
      <label className="toggle"><input type="checkbox" id="mood" checked={look.mood} onChange={(e) => app.setLookFlag('mood', e.target.checked)} /> Mood from tempo <small>fast → vivid & warm · slow → muted & cool</small></label>
      <label>Aberration {slider('aberration')}</label>
      <label>Resolution {slider('resolution')}</label>
    </div>
  );
}

function ActionsGroup(a: PanelActions) {
  const app = useApp();
  const recording = useUI((ui) => ui.recording);
  return (
    <div className="group actions">
      <button id="randomize" onClick={() => app.randomize()}>Randomize<Kbd hotkey={HOTKEYS.randomize} /></button>
      <button id="fullscreen" onClick={() => app.toggleFullscreen()}>Fullscreen<Kbd hotkey={HOTKEYS.fullscreen} /></button>
      <button id="record" className={recording ? 'recording' : undefined} onClick={() => app.toggleRecording()}>{recording ? 'Stop rec' : 'Record'}<Kbd hotkey={HOTKEYS.record} /></button>
      <button id="code" onClick={a.onOpenEditor}>Code<Kbd hotkey={HOTKEYS.editor} /></button>
      <button id="visual" onClick={a.onOpenVisualMaker}>Visual maker<Kbd hotkey={HOTKEYS.visualMaker} /></button>
      <button id="studio-open" onClick={a.onOpenStudio}>Studio &amp; projector<Kbd hotkey={HOTKEYS.studio} /></button>
    </div>
  );
}

// Every shortcut, generated from the registry so it can't drift from what the keys do.
function HelpRow() {
  return (
    <p className="keys">
      {HELP_ROW.map((id) => <span key={id} className="key-help"><Kbd hotkey={HOTKEYS[id]} /> {HOTKEYS[id].label}</span>)}
    </p>
  );
}

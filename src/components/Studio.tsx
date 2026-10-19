// Studio & projector. The main canvas is the Live monitor: it never moves in the DOM (that would
// destroy the WebGL context); while the studio is open it is positioned over the Live box with CSS.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';
import { useSessions } from '../app/sessions';
import { AUTO_BEATS, AUTO_SECONDS, type AutoUnit, type Cue } from '../app/studio';
import { DIRECTOR_BEATS, DIRECTOR_SECONDS } from '../director/director';
import { laserCss } from '../engine/laser-colour';
import { HOTKEYS, CUE_DIGITS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { useStore } from '../state/store';
import { StudioParams } from './ParamOverlay';
import { DirectorChanges } from './DirectorChanges';
import { HelpButton } from './Help';
import { FineRange, NumberField } from './widgets/LookSlider';
import { NEUTRAL_TRIMS, type MasterTrims } from '../app/live-slot';
import type { StudioSession } from '../app/studio';

export function Studio() {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'studio');
  const outputs = useUI((ui) => ui.outputs);
  const sceneVersion = useUI((ui) => ui.sceneVersion);
  const sceneName = useUI((ui) => ui.sceneName);
  const { studio, director } = useSessions();
  const [, setVersion] = useState(0);
  const dir = useStore(director.store, (s) => s);
  const [screen, setScreen] = useState('');
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const liveBox = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  // The session mutates itself; re-render on every change it announces (takes and beats included).
  useEffect(() => studio.subscribe(() => setVersion((v) => v + 1)), [studio]);
  useEffect(() => { studio.setOpen(open, previewCanvas.current); }, [open, studio]);

  // Pin the main canvas over the Live monitor box while the studio is open.
  useLayoutEffect(() => {
    const canvas = app.renderer.canvas;
    if (!open || !liveBox.current) {
      canvas.removeAttribute('style');
      document.body.classList.remove('studio-open');
      return;
    }
    document.body.classList.add('studio-open');
    const place = () => {
      const r = liveBox.current!.getBoundingClientRect();
      Object.assign(canvas.style, { inset: 'auto', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '8px' });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(liveBox.current);
    ro.observe(document.body);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [open, app]);

  // Monitors match the projector's aspect ratio.
  useEffect(() => {
    const o = outputs[0];
    if (o?.h) root.current?.style.setProperty('--aspect', String(o.w / o.h));
  }, [outputs]);

  const preview = studio.preview, live = studio.live;
  const tempo = app.hearing.bpm;
  const missing = (cue: Cue) => studio.sceneIndex(cue) < 0;
  const scenes = studio.listScenes();
  void sceneVersion;
  const plan = studio.plan;
  const timer = studio.autopilot.unit === 'seconds';
  const directorTimer = studio.directorUnit === 'seconds';
  const tokens = dir.tokens.prompt + dir.tokens.completion;
  const directorStatus = STATIC_DEMO ? STATIC_DEMO_NOTE
    : dir.error ? dir.error
    : !dir.on ? (plan?.note ? `Plan: ${plan.note}` : 'Off — Claude plans the show for you; the autopilot follows the plan on the beat')
    : dir.cycling ? 'Planning…'
    : !app.music.playing ? 'Waiting for the music'
    : studio.cues.length < 2 ? 'Add at least two show scenes'
    : `${dir.lastNote || 'Waiting for the first plan'} · next in ${directorTimer ? `${dir.secondsToCycle} s` : `${dir.beatsToCycle} beats`}${tokens ? ` · ${Math.round(tokens / 1000)}k tokens` : ''}`;

  return (
    <section id="studio" className="studio" hidden={!open} ref={root}>
      <header className="studio-bar">
        <strong>Studio</strong>
        <span className="studio-hint">Click a show scene to preview it · <Kbd hotkey={HOTKEYS.take} /> take it live · <Kbd hotkey={HOTKEYS.blackout} /> blackout · <Kbd hotkey="1" />–<Kbd hotkey="9" /> / <Kbd hotkey={HOTKEYS.studioPrev} /><Kbd hotkey={HOTKEYS.studioNext} /> pick</span>
        <HelpButton topic="studio" />
        <button id="st-close" className="icon" title="Close (O / Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <div className="studio-monitors">
        <figure className="monitor preview">
          <div className="screen-fit"><div className="screen"><canvas id="preview-gl" ref={previewCanvas} /></div></div>
          <figcaption><b>Preview</b><span id="st-preview-name">{preview?.name ?? '—'}</span></figcaption>
        </figure>
        <div className="studio-take">
          <button id="st-take" className="take" title="Transition Preview to Live (T)" onClick={() => studio.take()}>Take ▸<Kbd hotkey={HOTKEYS.take} /></button>
          <div className="seg">
            <button id="st-cut" className={studio.mode === 'cut' ? 'active' : undefined} onClick={() => studio.setMode('cut')}>Cut</button>
            <button id="st-fade" className={studio.mode === 'fade' ? 'active' : undefined} onClick={() => studio.setMode('fade')}>Fade</button>
          </div>
          <label>Fade <output id="st-dur-val">{studio.seconds.toFixed(1)} s</output>
            <input type="range" id="st-dur" min={0.2} max={8} step={0.1} value={studio.seconds} disabled={studio.mode === 'cut'} onChange={(e) => studio.setSeconds(Number(e.target.value))} />
          </label>
        </div>
        <figure className="monitor program">
          <div className="screen-fit"><div className="screen" id="st-live" ref={liveBox} /></div>
          <figcaption><b>Live</b><span id="st-live-name">{live?.name ?? sceneName.replace(/^.+ · /, '')}</span></figcaption>
        </figure>
      </div>
      <div className="studio-docks">
        <section className="dock">
          <header>
            <strong>Show scenes</strong>
            <select id="st-add" value="" onChange={(e) => studio.addFromSelect(e.target.value)}>
              <option value="">+ Add scene…</option>
              <option value="@live">What's on Live now</option>
              {scenes.map(({ s }) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </header>
          <ol id="st-cues" className="cues">
            {studio.cues.map((cue, n) => (
              <li key={cue.id} className={`cue${cue.id === studio.previewId ? ' preview' : ''}${cue.id === studio.liveId ? ' program' : ''}${missing(cue) ? ' missing' : ''}`}
                title="Click: preview · double-click: take live"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) studio.setPreview(cue); }}
                onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) studio.take(cue); }}>
                {n < 9 ? <Kbd hotkey={CUE_DIGITS[n]!} title={`Preview cue ${n + 1}`} /> : <kbd>·</kbd>}
                <i className="cue-swatch" style={{ background: laserCss(cue.look.hue ?? 0) }} />
                <div className="cue-text">
                  <strong>{cue.name}</strong>
                  <span>{missing(cue) ? `missing scene "${cue.scene}"` : cue.scene}</span>
                </div>
                <div className="cue-tools">
                  <button title="Move up" onClick={() => studio.move(cue, -1)}>▲</button>
                  <button title="Move down" onClick={() => studio.move(cue, 1)}>▼</button>
                  <button title="Rename" onClick={() => studio.rename(cue)}>✎</button>
                  <button title="Update from Live: store the scene, parameters, look and effects that are live now" onClick={() => studio.updateFromLive(cue)}>⤓</button>
                  <button title="Duplicate" onClick={() => studio.duplicate(cue)}>⧉</button>
                  <button title="Remove" onClick={() => studio.remove(cue)}>×</button>
                </div>
              </li>
            ))}
            {!studio.cues.length && <li className="cue-empty">No show scenes yet. Use "+ Add scene…" — or set up a look on Live and add "What's on Live now".</li>}
          </ol>
          <footer>
            <label className="toggle"><input type="checkbox" id="st-auto" checked={studio.autopilot.on} onChange={(e) => studio.setAutopilot(e.target.checked)} /> Autopilot: next every
              {timer
                ? <select id="st-auto-seconds" value={studio.autopilot.seconds} onChange={(e) => studio.setAutoSeconds(Number(e.target.value))}>
                    {AUTO_SECONDS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                : <select id="st-auto-beats" value={studio.autopilot.beats} onChange={(e) => studio.setAutoBeats(Number(e.target.value))}>
                    {AUTO_BEATS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>}
              <select id="st-auto-unit" value={studio.autopilot.unit} title="Count beats of the tempo clock, or run a plain timer (for music without a usable beat)" onChange={(e) => studio.setAutoUnit(e.target.value as AutoUnit)}>
                <option value="beats">beats</option>
                <option value="seconds">seconds</option>
              </select>
            </label>
            <div id="st-beats" className={`st-beats${studio.autopilot.on ? ' on' : ''}`} title={!studio.autopilot.on ? 'Autopilot is off' : timer ? 'A plain timer: every show scene (and every plan step) gets this many seconds' : 'Beats follow the detected tempo and keep counting through breakdowns'}>
              <i style={{ transform: `scaleX(${!studio.autopilot.on ? 0 : timer ? Math.min(1, studio.secondsElapsed / studio.autopilot.seconds) : studio.beatsElapsed / studio.beatsTarget})` }} />
              <b>{timer
                ? (!studio.autopilot.on ? `— / ${studio.autopilot.seconds} s` : `${Math.floor(studio.secondsElapsed)} / ${studio.autopilot.seconds} s · ${Math.max(0, Math.ceil(studio.autopilot.seconds - studio.secondsElapsed))} s to go`)
                : !studio.autopilot.on ? `— / ${studio.beatsTarget} beats`
                : !tempo ? 'waiting for a tempo — a few kicks are enough'
                : `${studio.beatsElapsed} / ${studio.beatsTarget} beats · ${studio.beatsTarget - studio.beatsElapsed} to go · ${tempo} BPM`}</b>
            </div>
            {plan && (
              <ol id="st-plan" className="plan" title={plan.note || 'The plan the autopilot follows'}>
                {plan.steps.map((step, i) => {
                  const cue = studio.cueByRef(step.cue);
                  return (
                    <li key={i} className={`${i === studio.planIndex ? 'playing' : ''}${!cue || missing(cue) ? ' missing' : ''}`} title={`${step.beats} beats${step.mode ? ` · ${step.mode}` : ''}${step.seconds !== undefined ? ` ${step.seconds} s` : ''}`}
                      onClick={() => { if (cue) studio.setPreview(cue); }}>
                      <b>{cue?.name ?? step.cue}</b><span>{step.beats}</span>
                    </li>
                  );
                })}
                <li className="plan-tools">
                  {studio.lastPlan && <button id="st-plan-restore" title="Bring the previous plan back" onClick={() => studio.restoreLastPlan()}>↶ previous</button>}
                  <button id="st-plan-clear" title="Drop the plan and follow the list again" onClick={() => studio.setPlan(null)}>×</button>
                </li>
              </ol>
            )}
            <label className="toggle" title="Claude plans the show from the music: every cycle it reads a digest of the tempo, mood and energy and writes the next steps. Needs the assistant backend.">
              <input type="checkbox" id="st-director" checked={dir.on} disabled={STATIC_DEMO} onChange={(e) => director.setOn(e.target.checked)} /> Director: plan every
              {directorTimer
                ? <select id="st-director-seconds" value={studio.directorSeconds} onChange={(e) => studio.setDirectorSeconds(Number(e.target.value))}>
                    {DIRECTOR_SECONDS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                : <select id="st-director-beats" value={studio.directorBeats} onChange={(e) => studio.setDirectorBeats(Number(e.target.value))}>
                    {DIRECTOR_BEATS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>}
              <select id="st-director-unit" value={studio.directorUnit} title="Plan every N beats of the tempo clock (and at least every 2 minutes), or every N seconds on a timer" onChange={(e) => studio.setDirectorUnit(e.target.value as AutoUnit)}>
                <option value="beats">beats</option>
                <option value="seconds">seconds</option>
              </select>
            </label>
            <p id="st-director-status" className={`st-director${dir.error ? ' error' : ''}${dir.on ? ' on' : ''}`}>{directorStatus}</p>
            {dir.hidden && <p className="st-director error">The show stands still while this window is hidden — keep it visible.</p>}
            <DirectorChanges />
          </footer>
        </section>
        <section className="dock">
          <header>
            <strong>Parameters</strong>
            <div className="seg" title="Which scene the controls edit">
              <button id="st-pp-preview" className={studio.paramTab === 'preview' ? 'active' : undefined} title="The selected show scene (green) — Take sends your changes live" onClick={() => studio.setParamTab('preview')}>Preview</button>
              <button id="st-pp-live" className={studio.paramTab === 'live' ? 'active' : undefined} title="What's live now (red)" onClick={() => studio.setParamTab('live')}>Live</button>
            </div>
          </header>
          <div id="st-params-dock" className="params-dock">
            {open && <StudioParams />}
            <p className="dock-empty">This scene has no live parameters.</p>
          </div>
        </section>
        <section className="dock">
          <header><strong>Projector</strong></header>
          <label className="dock-field">Display
            <select id="st-screen" value={screen} onChange={(e) => setScreen(e.target.value)}>
              <option value="">New window — drag it to the projector</option>
              {studio.screens.map((s, i) => <option key={i} value={i}>{`${s.label || `Display ${i + 1}`} · ${s.width}×${s.height}${s.isPrimary ? ' (this screen)' : ''}`}</option>)}
            </select>
          </label>
          <div className="dock-row">
            <button id="st-detect" title="List displays (asks for permission once)" onClick={() => { void studio.detectScreens().then(() => { const ext = studio.screens.findIndex((s) => !s.isPrimary); if (ext >= 0) setScreen(String(ext)); }); }}>Detect displays</button>
            <button id="st-open" className="primary" onClick={() => studio.openProjector(screen)}>Open projector</button>
            <button id="st-identify" title="Show the resolution on every projector" onClick={() => app.output.identify()}>Identify</button>
          </div>
          <p id="st-out-status" className={`out-status${outputs.length ? ' live' : ''}`}>
            {outputs.length
              ? `● ${outputs.length === 1 ? 'Projector' : `${outputs.length} projectors`} live · ${outputs.map((o) => `${o.w}×${o.h}${o.fullscreen ? ' fullscreen' : ''} · ${o.fps} fps`).join(' | ')}`
              : '○ No projector connected'}
          </p>
          <label className="dock-field">Master <output id="st-master-val">{Math.round(studio.masterTarget * 100)}%</output>
            <input type="range" id="st-master" min={0} max={1} step={0.01} value={studio.masterTarget} onChange={(e) => studio.setMaster(Number(e.target.value))} />
          </label>
          <MasterLook studio={studio} />
          <button id="st-blackout" className={`blackout${studio.masterTarget === 0 ? ' active' : ''}`} title="Fade Live to black (B)" onClick={() => studio.blackout()}>
            {studio.masterTarget === 0 ? 'Blacked out — click to restore' : 'Blackout'}<Kbd hotkey={HOTKEYS.blackout} />
          </button>
          <p className="dock-hint">On the projector: double-click or press F for fullscreen. To stream or record, capture the projector window in OBS (Window Capture).</p>
        </section>
      </div>
    </section>
  );
}

// Live's master trims (ADR 0006): turn down what each show scene's look sets, and shift its colour, on Live
// and the Preview monitor. Double-click one to put it back.
const TRIMS: { key: keyof MasterTrims; label: string; scale: number; unit: string; min: number; max: number }[] = [
  { key: 'reactivity', label: 'Reactivity', scale: 100, unit: '%', min: 0, max: 1 },
  { key: 'speed', label: 'Speed', scale: 100, unit: '%', min: 0, max: 1 },
  { key: 'trails', label: 'Trails', scale: 100, unit: '%', min: 0, max: 1 },
  { key: 'aberration', label: 'Fringing', scale: 100, unit: '%', min: 0, max: 1 },
  { key: 'hue', label: 'Colour shift', scale: 360, unit: '°', min: -0.5, max: 0.5 },
];

function MasterLook({ studio }: { studio: StudioSession }) {
  const trimmed = TRIMS.some((t) => studio.trims[t.key] !== NEUTRAL_TRIMS[t.key]);
  return (
    <details id="st-master-look" className="dock-field master-look">
      <summary>Master look {trimmed && <small>trimmed</small>}</summary>
      {TRIMS.map((t) => (
        <div key={t.key} className="look-row">
          <span />
          <label htmlFor={`st-trim-${t.key}`}>{t.label}</label>
          <FineRange id={`st-trim-${t.key}`} label={`Master ${t.label}`} value={studio.trims[t.key]} r={{ min: t.min, max: t.max, step: 0.01 }}
            onSet={(v) => studio.setTrim(t.key, v)} onReset={() => studio.setTrim(t.key, NEUTRAL_TRIMS[t.key])} />
          <NumberField d={{ label: `Master ${t.label}`, scale: t.scale, unit: t.unit, digits: 0 }} value={studio.trims[t.key]} onSet={(v) => studio.setTrim(t.key, v)} />
        </div>
      ))}
      {trimmed && <button type="button" onClick={() => studio.resetTrims()}>Back to the show scenes' own look</button>}
    </details>
  );
}

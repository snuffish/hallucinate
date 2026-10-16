// Settings: the device preferences (src/state/prefs.ts), a few app-wide conveniences and the setup's
// data. A preference is a default, never a second control for something live: the Look widget keeps
// Resolution, the transport keeps volume and tempo.

import { useRef, useState, type ReactNode } from 'react';
import { useApp, usePrefs, useUI } from '../app/AppContext';
import { STATIC_DEMO } from '../app/static-demo';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { LOOK_RANGES } from '../state/app-state';
import { APPLIES, IDLE_SECONDS, PIXEL_RATIOS, setShowThinking, useShowThinking, type PrefKey } from '../state/prefs';
import { HelpButton } from './Help';
import { AssistantSettings } from './SettingsAssistant';

const SECTIONS = { display: 'Display', audio: 'Audio', interface: 'Interface', assistant: 'Assistant', data: 'Data' } as const;
type SectionId = keyof typeof SECTIONS;

// When a change takes effect, shown beside the settings that don't apply at once.
const APPLIES_NOTE: Partial<Record<(typeof APPLIES)[PrefKey], string>> = {
  'startup': 'next start',
  'next-mic': 'next time the microphone starts',
  'all-renderers': 'this window, the studio monitor and projectors',
};

export function Settings() {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'settings');
  const [section, setSection] = useState<SectionId>('display');
  return (
    <section id="settings" className="settings" hidden={!open} aria-label="Settings">
      <header>
        <strong>Settings</strong>
        <HelpButton topic="settings" />
        <button id="settings-close" className="icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" role="tablist" aria-label="Settings sections">
          {(Object.keys(SECTIONS) as SectionId[]).map((id) => (
            <button key={id} id={`settings-tab-${id}`} role="tab" aria-selected={section === id} aria-controls="settings-pane"
              className={section === id ? 'active' : undefined} onClick={() => setSection(id)}>{SECTIONS[id]}</button>
          ))}
        </nav>
        <div id="settings-pane" className="settings-pane" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
          {section === 'display' && <DisplaySection />}
          {section === 'audio' && <AudioSection />}
          {section === 'interface' && <InterfaceSection />}
          {section === 'assistant' && open && <AssistantSettings />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </section>
  );
}

// One setting: its label and control, then what it does (and when it applies).
function Field({ label, hint, pref, children }: { label: string; hint?: ReactNode; pref?: PrefKey; children: ReactNode }) {
  const when = pref ? APPLIES_NOTE[APPLIES[pref]] : undefined;
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {children}
      {(hint || when) && <small>{hint}{hint && when && ' '}{when && <em>Applies: {when}.</em>}</small>}
    </label>
  );
}

function Toggle({ id, checked, onChange, children, hint }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="settings-field">
      <label className="toggle"><input type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function DisplaySection() {
  const app = useApp();
  const startResolution = usePrefs((p) => p.startResolution);
  const maxPixelRatio = usePrefs((p) => p.maxPixelRatio);
  const r = LOOK_RANGES.resolution;
  const screenRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return (
    <>
      <h3>Display & performance</h3>
      <Field label={`Start resolution · ${Math.round(startResolution * 100)}%`} pref="startResolution"
        hint="Where the Look widget's Resolution slider starts each time Hallucinate opens. Lower it on a slower computer.">
        <input type="range" id="pref-start-resolution" min={r.min} max={r.max} step={r.step} value={startResolution}
          onChange={(e) => app.setPref('startResolution', Number(e.target.value))} />
      </Field>
      <Field label="Pixel density" pref="maxPixelRatio"
        hint={`This screen has ${screenRatio}× pixels. On a HiDPI screen, 1× draws a quarter of the pixels of 2×: much faster, a little softer.`}>
        <select id="pref-pixel-ratio" value={maxPixelRatio} onChange={(e) => app.setPref('maxPixelRatio', Number(e.target.value) as (typeof PIXEL_RATIOS)[number])}>
          {PIXEL_RATIOS.map((n) => <option key={n} value={n}>{`Up to ${n}×${n === 2 ? ' (sharpest)' : n === 1 ? ' (fastest)' : ''}`}</option>)}
        </select>
      </Field>
    </>
  );
}

function AudioSection() {
  const app = useApp();
  const smoothing = usePrefs((p) => p.audioSmoothing);
  const echo = usePrefs((p) => p.micEchoCancellation);
  const noise = usePrefs((p) => p.micNoiseSuppression);
  const gain = usePrefs((p) => p.micAutoGain);
  const micOn = useUI((ui) => ui.activeSource === 'mic');
  const mediaSound = useUI((ui) => ui.mediaSound);
  return (
    <>
      <h3>Audio</h3>
      <Field label={`Smoothing · ${smoothing.toFixed(2)}`} pref="audioSmoothing"
        hint="How much the analysis averages over time: higher is calmer, lower follows every transient.">
        <input type="range" id="pref-smoothing" min={0} max={0.95} step={0.05} value={smoothing}
          onChange={(e) => app.setPref('audioSmoothing', Number(e.target.value))} />
      </Field>
      <h4>Microphone / line-in</h4>
      <p className="settings-note">Off by default: the browser's voice processing ducks and gates music. Turn them on for a laptop mic in a noisy room. <em>Applies: {APPLIES_NOTE['next-mic']}.</em></p>
      <Toggle id="pref-mic-echo" checked={echo} onChange={(on) => app.setPref('micEchoCancellation', on)}>Echo cancellation</Toggle>
      <Toggle id="pref-mic-noise" checked={noise} onChange={(on) => app.setPref('micNoiseSuppression', on)}>Noise suppression</Toggle>
      <Toggle id="pref-mic-gain" checked={gain} onChange={(on) => app.setPref('micAutoGain', on)}>Automatic gain</Toggle>
      {micOn && <button id="pref-mic-restart" onClick={() => void app.startSource('mic')}>Restart the microphone with these settings</button>}
      <h4>Media</h4>
      <Toggle id="pref-media-sound" checked={mediaSound} onChange={(on) => app.setMediaSound(on, { quiet: !app.media.el })}
        hint="A loaded video's soundtrack becomes the music, so the visuals react to it.">Use the video's sound as the music</Toggle>
    </>
  );
}

function InterfaceSection() {
  const app = useApp();
  const idle = usePrefs((p) => p.idleHideSeconds);
  const badges = usePrefs((p) => p.showKeyBadges);
  const thinking = useShowThinking();
  return (
    <>
      <h3>Interface</h3>
      <Field label="Hide the controls" pref="idleHideSeconds" hint="While music plays and the mouse is still. H hides them at any time.">
        <select id="pref-idle" value={idle ?? 'never'} onChange={(e) => app.setPref('idleHideSeconds', e.target.value === 'never' ? null : Number(e.target.value) as (typeof IDLE_SECONDS)[number])}>
          {IDLE_SECONDS.map((s) => <option key={s} value={s}>{`After ${s} s`}</option>)}
          <option value="never">Never</option>
        </select>
      </Field>
      <Toggle id="pref-kbd" checked={badges} onChange={(on) => app.setPref('showKeyBadges', on)}
        hint={<>The small key labels on buttons. The shortcut sheet (<Kbd hotkey={HOTKEYS.help} />) always lists them.</>}>Show shortcut badges</Toggle>
      {!STATIC_DEMO && <Toggle id="pref-thinking" checked={thinking} onChange={setShowThinking}>Show the assistant's reasoning (💭)</Toggle>}
      <div className="settings-actions">
        <button id="pref-reset-layout" onClick={() => app.resetLayout()}>Reset layout<Kbd hotkey={HOTKEYS.resetLayout} /></button>
        <button id="pref-help-hint" onClick={() => { app.resetHelpHint(); app.toast('The help hint shows again at the next sound source', 2500); }}>Show the "Press ? for help" hint again</button>
      </div>
    </>
  );
}

function DataSection() {
  const app = useApp();
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <h3>Your setup</h3>
      <p className="settings-note">Export saves your scenes, edits, My Shader, the visual maker graph, parameter values, the Studio show, favourites, player settings and layout to one file. These device settings stay on this computer.</p>
      <div className="settings-actions">
        <button id="pref-export" onClick={() => app.exportSettings()}>Export scenes &amp; settings</button>
        <button id="pref-import" onClick={() => file.current?.click()}>Import…</button>
        <input type="file" id="pref-import-file" accept="application/json,.json" hidden ref={file}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.importSettings(f); e.target.value = ''; }} />
      </div>
      <h4>Clean up</h4>
      <div className="settings-actions">
        <button id="pref-clear-recent" onClick={() => {
          if (!confirm('Forget the recently played SoundCloud tracks and YouTube videos?')) return;
          app.clearRecentTracks();
          app.toast('Recently played cleared', 2000);
        }}>Clear recently played</button>
        <button id="pref-reset" onClick={() => {
          if (!confirm('Reset the Display, Audio and Interface settings to their defaults? Your scenes, show, layout and the Assistant settings stay as they are.')) return;
          app.resetPrefs();
          app.toast('Settings reset to defaults', 2000);
        }}>Reset settings to defaults</button>
      </div>
    </>
  );
}

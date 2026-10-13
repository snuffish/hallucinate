// Live GLSL editor. It always shows the scene that's on screen and edits it in place: recompiles
// while you type (in the background, the last working version keeps running), shows errors with
// line numbers, and saves every successful compile.

import { useEffect, useRef, useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import type { EditorTarget } from '../app/editor';
import { SCENES, TEMPLATE } from '../engine/scenes';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';

const TITLES: Record<EditorTarget['kind'], string> = {
  custom: 'Your own scene',
  builtin: 'Built-in scene — your edits are kept, and can be reverted',
  user: 'Your library scene',
  nodes: 'Made in the visual maker',
};
type Status = { text: string; kind: 'ok' | 'error' };
const statusFor = (t: EditorTarget): Status => ({
  text: t.kind === 'nodes' ? 'Made in the visual maker — the code is generated from the graph, so it\'s read-only here.' : 'Editing live — changes apply as you type.',
  kind: 'ok',
});

export function Editor() {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'editor');
  const sceneIndex = useUI((ui) => ui.sceneIndex);
  const editor = app.editor;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ target: EditorTarget; code: string } | null>(null);

  // The editor follows the scene on screen while it's open: when the target changes, the code and
  // status are re-derived (state adjusted during render, so no effect round-trip).
  const targetKey = open ? sceneIndex : -1;
  const [shownKey, setShownKey] = useState(-1);
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>({ text: '', kind: 'ok' });
  if (targetKey !== shownKey) {
    setShownKey(targetKey);
    if (targetKey >= 0) {
      const t = editor.target(targetKey);
      setTarget(t);
      setCode(t.body);
      setStatus(statusFor(t));
    }
  }

  const compile = async (t: EditorTarget, source: string) => {
    if (t.kind === 'nodes') return;
    const error = await editor.compileInto(t, source);
    if (error) setStatus({ text: error, kind: 'error' });
    else {
      const n = app.state.scenes[t.index]?.params.length ?? 0;
      setStatus({ text: `Compiled ✓ — saved${n ? ` · ${n} live parameter${n > 1 ? 's' : ''}` : ''}`, kind: 'ok' });
    }
  };
  // Unsaved typing is compiled into the scene it belongs to, even after the target moved on.
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (p) void compile(p.target, p.code);
  };

  useEffect(() => {
    flush();
    if (open) textarea.current?.focus();
  }, [open, sceneIndex]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return <aside id="editor" className="editor" hidden />;
  const readOnly = target.kind === 'nodes';
  const edited = target.kind === 'builtin' && !!target.original && code.trim() !== target.original.trim();
  const templates = [{ name: 'Blank template', body: TEMPLATE }, ...SCENES.filter((s) => !s.kind).map((s) => ({ name: s.name, body: s.original ?? s.body }))];

  const onInput = (value: string) => {
    setCode(value);
    pending.current = { target, code: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
  };
  const replaceCode = (value: string) => {
    setCode(value);
    pending.current = { target, code: value };
    flush();
  };
  const loadTemplate = (i: string) => {
    const t = templates[Number(i)];
    if (!t || readOnly) return;
    if (code !== t.body && !confirm(`Replace the code of "${target.name}" with "${t.name}"?`)) return;
    replaceCode(t.body);
  };
  const revert = () => {
    if (!target.original || !confirm(`Revert "${target.name}" to its original code? Your edits will be lost.`)) return;
    replaceCode(target.original);
    app.toast(`"${target.name}" is back to the original`);
  };
  const copyGenerated = async () => {
    await editor.setCustomCode(code);
    app.setScene(app.state.customIndex);
    app.toast('Copied into My Shader — edit away');
  };
  const save = () => { flush(); editor.saveToLibrary(code, target); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || readOnly) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;
    onInput(value.slice(0, start) + '  ' + value.slice(end));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  };

  return (
    <aside id="editor" className={`editor${readOnly ? ' read-only' : ''}`} hidden={!open}>
      <header>
        <strong id="ed-title" title={TITLES[target.kind]}>{target.name}</strong>
        <select id="ed-template" title="Replace the code with a starting point" value="" disabled={readOnly} onChange={(e) => loadTemplate(e.target.value)}>
          <option value="">Start from…</option>
          {templates.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}
        </select>
        <button id="ed-revert" title="Undo your edits to this built-in scene" hidden={!edited} onClick={revert}>Revert to original</button>
        <button id="ed-copy" title="Copy this generated code into My Shader and edit it there" hidden={!readOnly} onClick={() => void copyGenerated()}>Edit a copy</button>
        <button id="ed-save" title="Save this code as a new scene in the library" onClick={save}>Save to library</button>
        <button id="ed-close" className="icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <details>
        <summary>Cheat sheet</summary>
        <dl>
          <dt><code>centered()</code></dt><dd>pixel position, (0,0) = centre, y from −0.5 to 0.5</dd>
          <dt><code>uTime</code></dt><dd>clock that runs faster when the music is loud</dd>
          <dt><code>uBass uMid uHigh uLevel</code></dt><dd>band loudness, 0 → ~1</dd>
          <dt><code>uBeat</code></dt><dd>1 on each beat, fading to 0</dd>
          <dt><code>uHue</code></dt><dd>colour slider + cycling</dd>
          <dt><code>uBright uMood</code></dt><dd>tone of the sound (0 dark … 1 bright) and mood (0 calm … 1 energetic); slow-moving</dd>
          <dt><code>spec(x) wave(x)</code></dt><dd>spectrum (0…1, bass→treble) and waveform (−1…1) at x</dd>
          <dt><code>rainbow(t) neon(t)</code></dt><dd>colour palettes, repeat every 1.0</dd>
          <dt><code>rot(a) noise(p) fbm(p) hash(p)</code></dt><dd>rotate a vec2, smooth noise, layered noise, random</dd>
          <dt><code>fragColor</code></dt><dd>write your final colour here</dd>
          <dt><code>media(p) luma(c) untone(c)</code></dt><dd>the dropped image / video at p (fills the screen, mirrored beyond its edges); the brightness of a colour; wrap your final colour in <code>untone()</code> to show a picture in its true colours</dd>
          <dt><code>// @param</code></dt><dd>put after a top-level <code>uniform</code> or <code>const</code> to get a live control in the Parameters overlay:<br />
            <code>uniform float uGlow; // @param min=0 max=3 default=1</code><br />
            <code>const vec3 TINT = vec3(1., .3, .8); // @param color</code><br />
            types float · bool · vec2 · vec3 · vec4; options min max step default label int color</dd>
        </dl>
      </details>
      <textarea id="ed-code" ref={textarea} spellCheck={false} autoCapitalize="off" autoComplete="off" value={code} readOnly={readOnly}
        onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown} />
      <div id="ed-status" className={`ed-status ${status.kind}`}>{status.text}</div>
    </aside>
  );
}

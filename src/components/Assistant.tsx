// The in-app AI assistant panel: a TanStack AI chat whose tools run here in the browser. Replies
// render as Markdown, thinking folds away, tool calls show as chips (with the frames the assistant
// looked at), and every change can be undone.

import { createChatClientOptions } from '@tanstack/ai-client';
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react';
import { Markdown } from '@tanstack/markdown/react';
import { createRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useApp, useLayout, useUI } from '../app/AppContext';
import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';
import { clientTools } from '../assistant/client-tools';
import { createToolRunner, type ToolRunner } from '../assistant/executor';
import { splitFollowUps } from '../assistant/follow-ups';
import { relayToolCalls } from '../assistant/relay';
import { ContentPartsSchema, DONE_VERBS, VERBS, type ToolName } from '../assistant/tools';
import { UndoStack } from '../assistant/undo';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { chatPlacement, effective } from '../state/layout';
import { useStore } from '../state/store';
import { HelpButton } from './Help';
import { rectOf } from './widgets/drop';
import { usePointerDrag } from './widgets/usePointerDrag';
import { useFloatPlacement, useNarrow } from './widgets/Widget';

const InfoSchema = z.object({ backend: z.enum(['api', 'claude-code', 'none']), model: z.string().nullable().optional(), setup: z.string().optional() });
const UNDO_NOTE = '(The user pressed Undo and reverted your change: ';

const EXAMPLES: [label: string, prompt: string][] = [
  ['Create a jellyfish scene', 'Create a new scene: a slowly rotating field of glowing jellyfish that pulse with the bass.'],
  ['Punch up this scene on the beat', 'Make the scene on screen more intense on the beat, without making it jumpy.'],
  ['Add parameters to this scene', 'Add a few useful live parameters to the scene on screen.'],
  ['Explain this scene', 'Explain how the scene on screen works, briefly.'],
];

// Tool results that are pictures come back as content parts; the chip shows them.
function imagesOf(output: unknown): string[] {
  let value = output;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  const parts = ContentPartsSchema.safeParse(value);
  return parts.success ? parts.data.filter((p): p is Extract<typeof p, { type: 'image' }> => p.type === 'image').map((p) => `data:${p.source.mimeType};base64,${p.source.value}`) : [];
}

// A moved bubble opens the chat beside itself, toward the side with more room. With the bubble in
// its default spot (beside the left dock) the stylesheet places both.
const chatBox = createRef<HTMLElement>();

function placeChat(bubble: HTMLElement | null): void {
  const chat = chatBox.current;
  if (!chat || !bubble || chat.hidden) return;
  const p = chatPlacement(rectOf(bubble), { width: chat.offsetWidth, height: Math.min(640, window.innerHeight - 32) }, { width: window.innerWidth, height: window.innerHeight });
  Object.assign(chat.style, { left: `${p.left}px`, top: `${p.top}px`, bottom: 'auto', height: `${p.maxHeight}px` });
}
function unplaceChat(): void {
  const chat = chatBox.current;
  if (chat) chat.style.left = chat.style.top = chat.style.bottom = chat.style.height = '';
}

// The floating bubble that opens and closes the assistant. Drag it anywhere to get it out of the way;
// a click (not a drag) toggles the chat.
export function AssistantBubble() {
  const app = useApp();
  const open = useUI((ui) => ui.assistantOpen);
  const started = useUI((ui) => ui.started);
  const narrow = useNarrow();
  const place = useLayout((l) => effective(l, narrow).bubble);
  const dragging = useUI((ui) => ui.dragging === 'bubble');
  const shown = useLayout((l) => l.bubbleShown);
  const root = useRef<HTMLButtonElement>(null);
  useFloatPlacement(root, started && shown && place.kind === 'float' ? place : null);   // the bubble mounts once a source plays
  const drag = useRef<{ dx: number; dy: number; style: string } | null>(null);
  const restore = () => {
    const el = root.current;
    if (el && drag.current) el.style.cssText = drag.current.style;
    drag.current = null;
    app.setDragging(null);
  };
  const handlers = usePointerDrag({
    onStart: (_e, grab) => {
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      drag.current = { dx: grab.x, dy: grab.y, style: el.style.cssText };
      Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, bottom: 'auto' });
      app.setDragging('bubble');
    },
    onMove: (e) => {
      const el = root.current, d = drag.current;
      if (!el || !d) return;
      el.style.left = `${Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - el.offsetHeight)}px`;
      placeChat(el);   // an open chat moves along
    },
    onEnd: () => {
      const el = root.current;
      if (!el || !drag.current) return restore();
      const rect = rectOf(el);
      restore();
      app.moveBubble(rect);
    },
    onCancel: () => { restore(); if (place.kind === 'auto') unplaceChat(); else placeChat(root.current); },
  }, { enabled: !narrow, ignoreButtons: false });

  // The chat follows a moved bubble: on open, after a move, on resize.
  useLayoutEffect(() => {
    if (place.kind !== 'float' || !open || !started || !shown) { unplaceChat(); return; }
    const fit = () => placeChat(root.current);
    fit();
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); };
  }, [place, open, started, shown]);

  if (!started || !shown) return null;
  return (
    <button ref={root} id="assistant-bubble" className={`ai-bubble${open ? ' open' : ''}${place.kind === 'float' ? ' moved' : ''}${dragging ? ' dragging' : ''}`}
      title={`${open ? 'Close the assistant (I)' : 'AI assistant (I)'}${narrow ? '' : ' · drag to move'}`} aria-expanded={open} aria-controls="ai"
      onPointerDown={handlers.onPointerDown} onClickCapture={handlers.onClickCapture} onClick={() => app.toggleAssistant()}>
      <span className="ai-bubble-icon" aria-hidden="true">{open ? '×' : '✦'}</span>
      <Kbd hotkey={HOTKEYS.assistant} />
    </button>
  );
}

export function Assistant() {
  const app = useApp();
  const open = useUI((ui) => ui.assistantOpen);
  const [undo] = useState(() => new UndoStack());
  const undoLabels = useStore(undo.store, (s) => s.labels);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState('');
  const [info, setInfo] = useState<z.infer<typeof InfoSchema> | null>(STATIC_DEMO ? { backend: 'none', setup: STATIC_DEMO_NOTE } : null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const runner = useMemo<ToolRunner>(() => createToolRunner(app, undo), [app, undo]);

  useEffect(() => {
    if (STATIC_DEMO) return;
    fetch('/api/assistant/info').then((r) => r.json()).then((j) => { const p = InfoSchema.safeParse(j); if (p.success) setInfo(p.data); }).catch(() => {});
  }, []);

  const options = useMemo(() => createChatClientOptions({
    connection: fetchServerSentEvents('/api/assistant'),
    tools: clientTools,
    context: { run: runner },
    threadId,
    // Subscription backend: the server relays each tool call as a custom event; run it here and answer.
    onCustomEvent: relayToolCalls(runner),
    onError: (err) => setNote({ text: err.message, error: true }),
  }), [runner, threadId]);

  const { messages, sendMessage, isLoading, stop, clear, append } = useChat(options);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, note]);
  useEffect(() => { app.ui.set({ assistantBusy: isLoading }); }, [app, isLoading]);   // the director waits for the chat
  useEffect(() => { if (open) composer.current?.focus(); }, [open]);

  const submit = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    setNote(null);
    void sendMessage(text);
  };
  const reset = () => {
    if (isLoading) stop();
    if (info?.backend === 'claude-code') fetch('/api/assistant/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId }) }).catch(() => {});
    clear();
    undo.clear();
    setNote(null);
    setThreadId(crypto.randomUUID());
  };
  const doUndo = () => {
    const step = undo.pop();
    if (!step) return;
    step.undo();
    setNote({ text: `Undid: ${step.label}` });
    // Tell Claude, so it doesn't build on a change that's gone.
    void append({ role: 'user', content: `${UNDO_NOTE}${step.label}.)` });
  };

  const idle = info?.backend === 'claude-code' ? 'Using your Claude subscription (via Claude Code)' : info?.backend === 'api' ? `Anthropic API${info.model ? ` · ${info.model}` : ''}` : '';
  const status = isLoading ? 'Working…' : idle;

  return (
    <aside id="ai" ref={chatBox} className="ai" hidden={!open}>
      <header>
        <strong>✦ Assistant</strong>
        <button id="ai-undo" title={undoLabels.length ? `Undo: ${undoLabels.at(-1)}` : 'Nothing to undo'} disabled={!undoLabels.length || isLoading} onClick={doUndo}>Undo</button>
        <button id="ai-new" title="Start a new conversation" onClick={reset}>New chat</button>
        <HelpButton topic="assistant" />
        <button id="ai-close" className="icon" title="Close (Esc)" onClick={() => app.toggleAssistant(false)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <div id="ai-log" className="ai-log" ref={log}>
        {!messages.length && (
          <div className="ai-welcome">
            <p>I can create and edit scenes, tweak their parameters and the look, and explain how things work. I see the result and fix my own compile errors.</p>
            <div className="ai-examples">
              {EXAMPLES.map(([label, prompt]) => <button key={label} onClick={() => { setInput(prompt); void sendMessage(prompt); }}>{label}</button>)}
            </div>
            {info?.backend === 'none' && <p className="ai-note error">{info.setup}</p>}
          </div>
        )}
        {messages.map((m, mi) => {
          if (m.role === 'user') {
            const text = m.parts.map((p) => (p.type === 'text' ? p.content : '')).join('');
            if (text.startsWith(UNDO_NOTE)) return <p key={m.id} className="ai-note">{text.slice(1, -1)}</p>;
            return <div key={m.id} className="ai-msg user"><div className="ai-body">{text}</div></div>;
          }
          if (m.role !== 'assistant') return null;
          // The reply's last text part carries the suggested next requests; they show once the run is done.
          const lastText = m.parts.reduce((last, p, i) => (p.type === 'text' ? i : last), -1);
          const isLast = mi === messages.length - 1;
          let followUps: string[] = [];
          return (
            <div key={m.id} className="ai-msg assistant">
              <div className="ai-body">
                {m.parts.map((p, i) => {
                  if (p.type === 'thinking') return <details key={i} className="ai-thinking"><summary>{isLoading && i === m.parts.length - 1 ? 'Thinking' : 'Thought about it'}</summary><p>{p.content}</p></details>;
                  if (p.type === 'text') {
                    const split = i === lastText ? splitFollowUps(p.content) : { text: p.content, followUps: [] };
                    if (i === lastText) followUps = split.followUps;
                    return split.text ? <div key={i} className="ai-text"><Markdown>{split.text}</Markdown></div> : null;
                  }
                  if (p.type === 'tool-call') {
                    const input = (p.input ?? {}) as Record<string, unknown>;
                    const result = m.parts.find((q) => q.type === 'tool-result' && q.toolCallId === p.id);
                    const error = result?.type === 'tool-result' && result.state === 'error';
                    const done = p.output !== undefined || !!result;
                    const label = ((done && !error ? DONE_VERBS : VERBS)[p.name as ToolName] ?? (() => p.name))(input);
                    const images = imagesOf(p.output ?? (result?.type === 'tool-result' ? result.content : undefined));
                    return (
                      <div key={i} className={`ai-tool ${done ? (error ? 'error' : 'ok') : 'running'}`}>
                        <span>{done ? `${error ? '✗' : '✓'} ${label}` : `${label}…`}</span>
                        {images.map((src, k) => <img key={k} src={src} alt="What the assistant saw" />)}
                      </div>
                    );
                  }
                  return null;
                })}
                {isLast && !isLoading && followUps.length > 0 && (
                  <div className="ai-examples ai-followups" aria-label="Suggested next requests">
                    {followUps.map((q) => <button key={q} onClick={() => { setNote(null); void sendMessage(q); }}>{q}</button>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {note && <p className={`ai-note${note.error ? ' error' : ''}`}>{note.text}</p>}
      </div>
      <p id="ai-status" className="ai-status">{status}</p>
      <div className="ai-composer">
        <textarea id="ai-input" ref={composer} rows={2} value={input} placeholder="Ask for a scene, a change, or an explanation…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button id="ai-send" className={isLoading ? 'stop' : undefined} onClick={() => (isLoading ? stop() : submit())}>{isLoading ? 'Stop' : 'Send'}</button>
      </div>
    </aside>
  );
}

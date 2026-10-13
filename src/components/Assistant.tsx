// The in-app AI assistant panel: a TanStack AI chat whose tools run here in the browser. Replies
// render as Markdown, thinking folds away, tool calls show as chips (with the frames the assistant
// looked at), and every change can be undone.

import { createChatClientOptions } from '@tanstack/ai-client';
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react';
import { Markdown } from '@tanstack/markdown/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useApp, useUI } from '../app/AppContext';
import { clientTools } from '../assistant/client-tools';
import { createToolRunner, type ToolRunner } from '../assistant/executor';
import { ContentPartsSchema, DONE_VERBS, VERBS, type ToolName } from '../assistant/tools';
import { UndoStack } from '../assistant/undo';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { useStore } from '../state/store';

const InfoSchema = z.object({ backend: z.enum(['api', 'claude-code', 'none']), model: z.string().nullable().optional(), setup: z.string().optional() });
const ToolCallEventSchema = z.object({ threadId: z.string(), callId: z.string(), toolCallId: z.string(), name: z.string(), input: z.unknown() });
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

export function Assistant() {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'assistant');
  const [undo] = useState(() => new UndoStack());
  const undoLabels = useStore(undo.store, (s) => s.labels);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState('');
  const [info, setInfo] = useState<z.infer<typeof InfoSchema> | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const runner = useMemo<ToolRunner>(() => createToolRunner(app, undo), [app, undo]);

  useEffect(() => {
    fetch('/api/assistant/info').then((r) => r.json()).then((j) => { const p = InfoSchema.safeParse(j); if (p.success) setInfo(p.data); }).catch(() => {});
  }, []);

  const options = useMemo(() => createChatClientOptions({
    connection: fetchServerSentEvents('/api/assistant'),
    tools: clientTools,
    context: { run: runner },
    threadId,
    // Subscription backend: the server relays each tool call as a custom event; run it here and answer.
    onCustomEvent: (type, data) => {
      if (type !== 'hallucinate.tool_call') return;
      const ev = ToolCallEventSchema.safeParse(data);
      if (!ev.success) return;
      const { callId, name, input } = ev.data;
      runner(name, (input ?? {}) as Record<string, unknown>)
        .then((out) => {
          const parts = ContentPartsSchema.safeParse(out);
          const content = parts.success
            ? parts.data.map((p) => (p.type === 'image' ? { type: 'image' as const, data: p.source.value, mimeType: p.source.mimeType } : { type: 'text' as const, text: p.content }))
            : [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) }];
          return { content, isError: false };
        })
        .catch((err: Error) => ({ content: [{ type: 'text' as const, text: err.message }], isError: true }))
        .then((result) => fetch('/api/assistant/tool-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: ev.data.threadId, callId, result }) }))
        .catch(() => {});
    },
    onError: (err) => setNote({ text: err.message, error: true }),
  }), [runner, threadId]);

  const { messages, sendMessage, isLoading, stop, clear, append } = useChat(options);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, note]);
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
    <aside id="ai" className="ai" hidden={!open}>
      <header>
        <strong>✦ Assistant</strong>
        <button id="ai-undo" title={undoLabels.length ? `Undo: ${undoLabels.at(-1)}` : 'Nothing to undo'} disabled={!undoLabels.length || isLoading} onClick={doUndo}>Undo</button>
        <button id="ai-new" title="Start a new conversation" onClick={reset}>New chat</button>
        <button id="ai-close" className="icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
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
        {messages.map((m) => {
          if (m.role === 'user') {
            const text = m.parts.map((p) => (p.type === 'text' ? p.content : '')).join('');
            if (text.startsWith(UNDO_NOTE)) return <p key={m.id} className="ai-note">{text.slice(1, -1)}</p>;
            return <div key={m.id} className="ai-msg user"><div className="ai-body">{text}</div></div>;
          }
          if (m.role !== 'assistant') return null;
          return (
            <div key={m.id} className="ai-msg assistant">
              <div className="ai-body">
                {m.parts.map((p, i) => {
                  if (p.type === 'thinking') return <details key={i} className="ai-thinking"><summary>{isLoading && i === m.parts.length - 1 ? 'Thinking' : 'Thought about it'}</summary><p>{p.content}</p></details>;
                  if (p.type === 'text') return <div key={i} className="ai-text"><Markdown>{p.content}</Markdown></div>;
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

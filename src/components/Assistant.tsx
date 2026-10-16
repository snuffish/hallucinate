// The in-app AI assistant: a floating bubble and the chat panel it opens. The panel holds several
// conversations (src/assistant/conversations.ts) that keep running while another one is on screen or
// the panel is closed; the bubble shows when they work and when a reply is waiting, with a peek at it.
// The panel resizes from its corner like a widget, and can show the assistant's reasoning.

import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { createRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useApp, useLayout, useUI } from '../app/AppContext';
import { downloadFile, fileStamp } from '../app/download';
import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';
import { useSessions } from '../app/sessions';
import { LONG_CHAT_TOKENS } from '../assistant/conversations';
import { toMarkdown } from '../assistant/transcript';
import { formatTokens, totalTokens } from '../assistant/usage';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { chatPlacement, effective, type WidgetSize } from '../state/layout';
import { KEYS, readString, writeString } from '../state/persistence';
import { Store, useStore } from '../state/store';
import { ChatList } from './assistant/ChatList';
import { Transcript, usageLabel, usageTitle } from './assistant/Transcript';
import { HelpButton } from './Help';
import { rectOf } from './widgets/drop';
import { usePointerDrag } from './widgets/usePointerDrag';
import { Grip, useFloatPlacement, useNarrow } from './widgets/Widget';

const InfoSchema = z.object({ backend: z.enum(['api', 'claude-code', 'none']), model: z.string().nullable().optional(), setup: z.string().optional() });
type Info = z.infer<typeof InfoSchema>;

const EXAMPLES: [label: string, prompt: string][] = [
  ['Create a jellyfish scene', 'Create a new scene: a slowly rotating field of glowing jellyfish that pulse with the bass.'],
  ['Punch up this scene on the beat', 'Make the scene on screen more intense on the beat, without making it jumpy.'],
  ['Add parameters to this scene', 'Add a few useful live parameters to the scene on screen.'],
  ['Explain this scene', 'Explain how the scene on screen works, briefly.'],
];

const DEFAULT_CHAT_H = 640;

// A moved bubble opens the chat beside itself, toward the side with more room. With the bubble in
// its default spot (beside the left dock) the stylesheet places both. `chatGrow` says which corner
// faces away from the bubble: the resize grip sits there.
const chatBox = createRef<HTMLElement>();
const chatGrow = new Store<{ x: 'left' | 'right'; y: 'up' | 'down' }>({ x: 'right', y: 'up' });

// `sizedH`: the height the user gave the panel (null: the stylesheet's). Placement owns `height` only
// while the panel floats beside a moved bubble; otherwise it puts the stored height back.
function placeChat(bubble: HTMLElement | null, sizedH: number | null): void {
  const chat = chatBox.current;
  if (!chat || !bubble || chat.hidden) return;
  const p = chatPlacement(rectOf(bubble), { width: chat.offsetWidth, height: Math.min(sizedH ?? DEFAULT_CHAT_H, window.innerHeight - 32) }, { width: window.innerWidth, height: window.innerHeight });
  Object.assign(chat.style, { left: `${p.left}px`, top: `${p.top}px`, bottom: 'auto', height: `${p.maxHeight}px`, maxHeight: 'none' });
  chatGrow.set({ x: p.growX, y: p.growY });
}
function unplaceChat(sizedH: number | null): void {
  const chat = chatBox.current;
  if (chat) Object.assign(chat.style, { left: '', top: '', bottom: '', maxHeight: '', height: sizedH === null ? '' : `${sizedH}px` });
  chatGrow.set({ x: 'right', y: 'up' });
}

// ---------------------------------------------------------------------------------------------

// The card beside the bubble when a reply lands with the panel closed. Click opens that conversation.
function Peek({ bubble }: { bubble: HTMLElement | null }) {
  const app = useApp();
  const peek = useUI((ui) => ui.assistantPeek);
  const card = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !bubble || !peek) return;
    const b = bubble.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = b.right + 10 + w <= window.innerWidth - 8 ? b.right + 10 : Math.max(8, b.left - 10 - w);
    const top = Math.min(Math.max(8, b.top + b.height / 2 - h / 2), window.innerHeight - h - 8);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  }, [peek, bubble]);
  useEffect(() => {
    if (!peek || hover) return;
    const t = setTimeout(() => app.ui.set({ assistantPeek: null }), 6000);
    return () => clearTimeout(t);
  }, [app, peek, hover]);
  if (!peek) return null;
  return (
    <div id="ai-peek" ref={card} className={`ai-peek${peek.error ? ' error' : ''}`} role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="ai-peek-open" onClick={() => app.toggleAssistant(true, peek.chatId)}>
        <strong>{peek.title}</strong>
        <span>{peek.text}</span>
      </button>
      <button type="button" className="icon" aria-label="Dismiss" title="Dismiss" onClick={() => app.ui.set({ assistantPeek: null })}>×</button>
    </div>
  );
}

// The floating bubble that opens and closes the assistant. Drag it anywhere to get it out of the way;
// a click (not a drag) toggles the chat. A badge counts conversations with an unread reply, a ring
// turns while one works with the panel closed.
export function AssistantBubble() {
  const app = useApp();
  const open = useUI((ui) => ui.assistantOpen);
  const started = useUI((ui) => ui.started);
  const running = useUI((ui) => ui.assistantRunning);
  const unread = useUI((ui) => ui.assistantUnread);
  const narrow = useNarrow();
  const place = useLayout((l) => effective(l, narrow).bubble);
  const chatH = useLayout((l) => effective(l, narrow).chatSize.h);
  const dragging = useUI((ui) => ui.dragging === 'bubble');
  const shown = useLayout((l) => l.bubbleShown);
  const root = useRef<HTMLButtonElement>(null);
  const [bubbleEl, setBubbleEl] = useState<HTMLButtonElement | null>(null);
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
      placeChat(el, chatH);   // an open chat moves along
    },
    onEnd: () => {
      const el = root.current;
      if (!el || !drag.current) return restore();
      const rect = rectOf(el);
      restore();
      app.moveBubble(rect);
    },
    onCancel: () => { restore(); if (place.kind === 'auto') unplaceChat(chatH); else placeChat(root.current, chatH); },
  }, { enabled: !narrow, ignoreButtons: false });

  // The chat follows a moved bubble: on open, after a move or a resize of the chat, on window resize.
  useLayoutEffect(() => {
    if (place.kind !== 'float' || !open || !started || !shown) { unplaceChat(chatH); return; }
    const fit = () => placeChat(root.current, chatH);
    fit();
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); };
  }, [place, open, started, shown, chatH]);

  if (!started || !shown) return null;
  const busy = running > 0 && !open;
  const title = `${open ? 'Close the assistant (I)' : 'AI assistant (I)'}${unread ? ` · ${unread} new repl${unread === 1 ? 'y' : 'ies'}` : ''}${busy ? ' · working' : ''}${narrow ? '' : ' · drag to move'}`;
  return (
    <>
      <button ref={(el) => { root.current = el; setBubbleEl(el); }} id="assistant-bubble"
        className={`ai-bubble${open ? ' open' : ''}${place.kind === 'float' ? ' moved' : ''}${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}${unread ? ' unread' : ''}`}
        title={title} aria-label={title} aria-expanded={open} aria-controls="ai"
        onPointerDown={handlers.onPointerDown} onClickCapture={handlers.onClickCapture} onClick={() => app.toggleAssistant()}>
        <span className="ai-bubble-icon" aria-hidden="true">{open ? '×' : '✦'}</span>
        {unread > 0 && !open && <span className="ai-bubble-badge" aria-hidden="true">{unread}</span>}
        <Kbd hotkey={HOTKEYS.assistant} />
      </button>
      {!open && <Peek bubble={bubbleEl} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

// The panel's resize grip, on the corner facing away from the bubble. The new size shows live and
// is stored on release; a double-click goes back to the natural size.
function ChatGrip() {
  const app = useApp();
  const grow = useStore(chatGrow, (g) => g);
  const start = useRef<{ w: number; h: number; left: number; top: number; style: string } | null>(null);
  const corner = `${grow.y === 'up' ? 't' : 'b'}${grow.x === 'left' ? 'l' : 'r'}`;
  const floating = () => !!chatBox.current?.style.top;   // placed beside a moved bubble (left/top), not by the stylesheet
  return (
    <Grip className={`ai-grip ${corner}`} title="Drag to resize · double-click for the natural size"
      onStart={() => {
        const el = chatBox.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        start.current = { w: r.width, h: r.height, left: r.left, top: r.top, style: el.style.cssText };
        app.setDragging('resize');
      }}
      onMove={(dx, dy) => {
        const el = chatBox.current, s = start.current;
        if (!el || !s) return;
        // Grow toward the free side, never past the screen's edge (8 px margin).
        const roomW = grow.x === 'left' ? s.left + s.w - 8 : window.innerWidth - s.left - 8;
        const roomH = grow.y === 'up' ? s.top + s.h - 8 : window.innerHeight - s.top - 8;
        const w = Math.max(300, Math.min(s.w + (grow.x === 'left' ? -dx : dx), roomW));
        const h = Math.max(260, Math.min(s.h + (grow.y === 'up' ? -dy : dy), roomH));
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        if (floating()) {
          if (grow.x === 'left') el.style.left = `${s.left + s.w - w}px`;
          if (grow.y === 'up') el.style.top = `${s.top + s.h - h}px`;
        }
      }}
      onEnd={() => {
        const el = chatBox.current;
        start.current = null;
        app.setDragging(null);
        if (!el) return;
        const r = el.getBoundingClientRect();
        app.resizeChat({ w: Math.round(r.width), h: Math.round(r.height) });
      }}
      onCancel={() => {
        const el = chatBox.current;
        if (el && start.current) el.style.cssText = start.current.style;
        start.current = null;
        app.setDragging(null);
      }}
      onReset={() => app.resizeChat({ w: null, h: null })} />
  );
}

const readThinking = () => readString(KEYS.assistantThinking) === '1';

export function Assistant() {
  const app = useApp();
  const open = useUI((ui) => ui.assistantOpen);
  const narrow = useNarrow();
  const size: WidgetSize = useLayout((l) => effective(l, narrow).chatSize);
  const session = useSessions().assistant;
  const sv = useStore(session.store, (s) => s);
  const chat = session.conversation(sv.activeId);
  const view = useStore(chat.store, (v) => v);
  const meta = sv.chats.find((c) => c.id === sv.activeId);
  const undo = useStore(session.undo.store, (u) => u);
  const [info, setInfo] = useState<Info | null>(STATIC_DEMO ? { backend: 'none', setup: STATIC_DEMO_NOTE } : null);
  const [listOpen, setListOpen] = useState(false);
  const [searchTick, setSearchTick] = useState(0);
  const [showThinking, setShowThinking] = useState(readThinking);
  const [now, setNow] = useState(() => Date.now());
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (STATIC_DEMO) return;
    fetch('/api/assistant/info').then((r) => r.json()).then((j) => { const p = InfoSchema.safeParse(j); if (p.success) { setInfo(p.data); session.setBackend(p.data.backend); } }).catch(() => {});
  }, [session]);

  // Stick to the bottom while new text arrives, unless the user scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => { if (log.current && pinned.current) log.current.scrollTop = log.current.scrollHeight; }, [view.messages, view.outbox, view.notes, view.error, sv.activeId]);
  useEffect(() => { pinned.current = true; }, [sv.activeId]);
  useEffect(() => { if (open && !listOpen) composer.current?.focus(); }, [open, listOpen, sv.activeId]);
  // The status line's clock while a run is going.
  useEffect(() => {
    if (view.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view.status]);

  const submit = (text = view.draft) => {
    const t = text.trim();
    if (!t || view.readOnly) return;
    chat.send(t);
    if (text === view.draft) chat.setDraft('');
    pinned.current = true;
  };
  const doUndo = () => {
    const owner = undo.lastChat;
    const done = session.undoLast();
    if (!done) return;
    if (done.error) app.toast(done.error, 6000);
    else if (owner && owner !== sv.activeId) app.toast(`Undid: ${done.label} (from “${session.meta(owner)?.title ?? 'another chat'}”)`);
  };
  const pick = (id: string) => { session.select(id); setListOpen(false); };
  const exportChat = (id: string) => {
    const m = session.meta(id);
    const c = session.conversation(id);
    void c.load(!!m).then(() => {
      const title = m?.title ?? 'Conversation';
      const md = toMarkdown(title, c.view.messages, { reasoning: showThinking });
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'conversation';
      downloadFile(new Blob([md], { type: 'text/markdown' }), `hallucinate-chat-${slug}-${fileStamp()}.md`);
    });
  };
  const toggleThinking = () => {
    setShowThinking((v) => { writeString(KEYS.assistantThinking, v ? '0' : '1'); return !v; });
  };

  // Panel shortcuts, while it is open (they work from the text box too).
  const hk = (def: { keys: string; label: string }, fn: () => void): UseHotkeyDefinition => ({
    hotkey: def.keys as UseHotkeyDefinition['hotkey'], callback: fn,
    options: { enabled: open, preventDefault: true, ignoreInputs: false, meta: { name: def.label, group: 'Panels' } },
  });
  useHotkeys([
    hk(HOTKEYS.assistantNew, () => { session.newChat(); setListOpen(false); }),
    hk(HOTKEYS.assistantPrev, () => session.step(-1)),
    hk(HOTKEYS.assistantNext, () => session.step(1)),
    hk(HOTKEYS.assistantSearch, () => { setListOpen(true); setSearchTick((n) => n + 1); }),
  ].filter((d) => d.options?.enabled));

  const running = view.status === 'running';
  const idle = info?.backend === 'claude-code' ? 'Using your Claude subscription (via Claude Code)' : info?.backend === 'api' ? `Anthropic API${info.model ? ` · ${info.model}` : ''}` : '';
  const seconds = view.runStartedAt ? Math.max(0, Math.round((now - view.runStartedAt) / 1000)) : 0;
  const status = running ? `Working… ${seconds} s${view.runTools ? ` · ${view.runTools} tool${view.runTools === 1 ? '' : 's'}` : ''}` : view.status === 'waiting' ? 'Waiting for a free slot…' : idle;
  const costLabel = info?.backend === 'claude-code' ? '≈ API-equivalent cost (not billed on a subscription)' : 'Cost';
  const usage = meta?.usage;
  const long = (meta?.lastPrompt ?? 0) >= LONG_CHAT_TOKENS;
  const undoOwner = undo.lastChat ? session.meta(undo.lastChat)?.title : undefined;
  const undoBusy = !!undo.lastChat && session.isRunning(undo.lastChat);
  const othersWorking = Object.entries(sv.live).filter(([id, l]) => id !== sv.activeId && l.status !== 'idle').length;
  const othersUnread = Object.entries(sv.live).filter(([id, l]) => id !== sv.activeId && l.unread).length;
  const sendLabel = running ? (view.draft.trim() ? 'Queue' : 'Stop') : 'Send';

  const welcome = (
    <div className="ai-welcome">
      <p>I can create and edit scenes, tweak their parameters and the look, and explain how things work. I see the result and fix my own compile errors.</p>
      <div className="ai-examples">
        {EXAMPLES.map(([label, prompt]) => <button key={label} disabled={view.readOnly} onClick={() => submit(prompt)}>{label}</button>)}
      </div>
      {info?.backend === 'none' && <p className="ai-note error">{info.setup}</p>}
    </div>
  );

  return (
    <aside id="ai" ref={chatBox} className={`ai${size.w !== null || size.h !== null ? ' sized' : ''}`} hidden={!open}
      style={{ width: size.w ?? undefined, ...(size.h !== null && { height: size.h }) }}>
      <header>
        <button type="button" id="ai-chats-toggle" className={`ai-switcher${listOpen ? ' active' : ''}`} aria-expanded={listOpen} aria-controls="ai-chats"
          title={`Conversations (${HOTKEYS.assistantSearch.label}: ${HOTKEYS.assistantSearch.keys}, previous / next: Alt+↑ / Alt+↓)`} onClick={() => setListOpen((v) => !v)}>
          <span className={`ai-dot ${running ? 'running' : ''}`} aria-hidden="true" />
          <strong>{meta?.title ?? 'New chat'}</strong>
          {(othersWorking > 0 || othersUnread > 0) && <span className="ai-switcher-count" title={`${othersWorking} working, ${othersUnread} with a new reply`}>{othersWorking + othersUnread}</span>}
          <span aria-hidden="true">▾</span>
        </button>
        <button id="ai-new" title={`Start a new conversation (${HOTKEYS.assistantNew.keys})`} onClick={() => { session.newChat(); setListOpen(false); }}>New</button>
        <button id="ai-undo" title={undo.labels.length ? `Undo: ${undo.labels.at(-1)}${undoOwner ? ` (from “${undoOwner}”)` : ''}` : 'Nothing to undo'} disabled={!undo.labels.length || undoBusy} onClick={doUndo}>Undo</button>
        <button id="ai-thinking-toggle" className={`icon${showThinking ? ' on' : ''}`} aria-pressed={showThinking} title={showThinking ? 'Hide the assistant\'s reasoning' : 'Show the assistant\'s reasoning'} onClick={toggleThinking}>💭</button>
        <HelpButton topic="assistant" />
        <button id="ai-close" className="icon" title="Close (Esc)" onClick={() => app.toggleAssistant(false)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      {listOpen
        ? <ChatList session={session} chats={sv.chats} live={sv.live} activeId={sv.activeId} storageOk={sv.storageOk} focusSearch={searchTick} onPick={pick} onExport={exportChat} />
        : (
          <div id="ai-log" className="ai-log" ref={log} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
            {!view.loaded ? <p className="ai-note">Loading…</p> : (
              <Transcript chat={chat} view={view} showThinking={showThinking} costLabel={costLabel} welcome={welcome}
                onFollowUp={(q) => submit(q)} onRetry={() => chat.retry()} />
            )}
          </div>
        )}
      {long && !listOpen && (
        <p className="ai-note ai-hint">This conversation is long: every message resends about {formatTokens(meta!.lastPrompt)} tokens, so replies are slower and cost more.
          {' '}<button type="button" onClick={() => session.newChat()}>Start a new chat</button></p>
      )}
      <p id="ai-status" className="ai-status">
        <span>{status}</span>
        {usage && totalTokens(usage) > 0 && <span id="ai-usage" title={usageTitle(usage, costLabel)}>This chat: {usageLabel(usage, { chat: true })}</span>}
      </p>
      <div className="ai-composer">
        <textarea id="ai-input" ref={composer} rows={2} value={view.draft} disabled={view.readOnly}
          placeholder={view.readOnly ? 'This conversation is open in another tab: read-only here.' : running ? 'Type your next message: it is sent when this reply is done.' : 'Ask for a scene, a change, or an explanation…  (Enter to send, Shift+Enter for a new line)'}
          onChange={(e) => chat.setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button id="ai-send" className={sendLabel === 'Stop' ? 'stop' : undefined} disabled={view.readOnly} onClick={() => (sendLabel === 'Stop' ? chat.stop() : submit())}>{sendLabel}</button>
      </div>
      {!narrow && <ChatGrip />}
    </aside>
  );
}

// The conversation drawer: search, the running ones first, then pinned, then by day. Each row can be
// renamed, pinned, exported as Markdown or deleted; the history can be cleared.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantSession, ChatLive } from '../../assistant/conversations';
import type { ChatMeta } from '../../assistant/history-store';
import { formatTokens, totalTokens } from '../../assistant/usage';

interface Props {
  session: AssistantSession;
  chats: ChatMeta[];
  live: Record<string, ChatLive>;
  activeId: string;
  storageOk: boolean;
  focusSearch: number;           // bumps when Mod+K asks for the search box
  onPick: (id: string) => void;
  onExport: (id: string) => void;
}

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < DAY / 1000) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Dot({ live }: { live: ChatLive | undefined }) {
  const kind = live?.status === 'running' ? 'running' : live?.status === 'waiting' ? 'waiting' : live?.error && live.unread ? 'error' : live?.unread ? 'unread' : '';
  return <span className={`ai-dot ${kind}`} aria-label={kind ? { running: 'working', waiting: 'waiting', error: 'failed', unread: 'new reply' }[kind] : undefined} />;
}

function Row({ chat, live, active, now, session, onPick, onExport }: { chat: ChatMeta; live: ChatLive | undefined; active: boolean; now: number } & Pick<Props, 'session' | 'onPick' | 'onExport'>) {
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const tokens = totalTokens(chat.usage);
  if (renaming) {
    const done = (save: boolean) => { if (save) session.rename(chat.id, title); setRenaming(false); };
    return (
      <li className="ai-chat-row renaming">
        <input autoFocus value={title} aria-label="Conversation name" onChange={(e) => setTitle(e.target.value)} onBlur={() => done(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } }} />
      </li>
    );
  }
  return (
    <li className={`ai-chat-row${active ? ' active' : ''}`} data-chat-id={chat.id}>
      <button type="button" className="ai-chat-pick" onClick={() => onPick(chat.id)} aria-current={active || undefined}>
        <Dot live={live} />
        <span className="ai-chat-title">{chat.pinned && <span aria-label="pinned">📌 </span>}{chat.title}</span>
        <span className="ai-chat-meta">{ago(chat.updatedAt, now)}{tokens ? ` · ${formatTokens(tokens)}` : ''}</span>
      </button>
      <span className="ai-chat-actions">
        <button type="button" className="icon" title="Rename" aria-label="Rename" onClick={() => { setTitle(chat.title); setRenaming(true); }}>✎</button>
        <button type="button" className={`icon${chat.pinned ? ' on' : ''}`} title={chat.pinned ? 'Unpin' : 'Pin (kept when old chats are cleared out)'} aria-label={chat.pinned ? 'Unpin' : 'Pin'} onClick={() => session.setPinned(chat.id, !chat.pinned)}>📌</button>
        <button type="button" className="icon" title="Export as Markdown" aria-label="Export as Markdown" onClick={() => onExport(chat.id)}>⤓</button>
        {confirm
          ? <button type="button" className="danger" onClick={() => void session.remove(chat.id)} onBlur={() => setConfirm(false)} autoFocus>Delete?</button>
          : <button type="button" className="icon" title="Delete" aria-label="Delete" onClick={() => setConfirm(true)}>🗑</button>}
      </span>
    </li>
  );
}

export function ChatList({ session, chats, live, activeId, storageOk, focusSearch, onPick, onExport }: Props) {
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now());   // the drawer is remounted each time it opens
  useEffect(() => { search.current?.focus(); }, [focusSearch]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
    const today = startOfDay(now);
    const out: [string, ChatMeta[]][] = [['Working', []], ['Pinned', []], ['Today', []], ['Yesterday', []], ['Earlier', []]];
    const add = (name: string, c: ChatMeta) => out.find(([n]) => n === name)![1].push(c);
    for (const c of hits) {
      const l = live[c.id];
      if (l && l.status !== 'idle') add('Working', c);
      else if (c.pinned) add('Pinned', c);
      else if (c.updatedAt >= today) add('Today', c);
      else if (c.updatedAt >= today - DAY) add('Yesterday', c);
      else add('Earlier', c);
    }
    return out.filter(([, list]) => list.length);
  }, [chats, live, query, now]);

  return (
    <div id="ai-chats" className="ai-chats" role="region" aria-label="Conversations">
      <input ref={search} id="ai-chat-search" type="search" placeholder="Search conversations…" value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
      {!storageOk && <p className="ai-note error">This browser won't keep conversations (storage is blocked); they last until you close the tab.</p>}
      {!chats.length && <p className="ai-note">No conversations yet.</p>}
      {chats.length > 0 && !groups.length && <p className="ai-note">Nothing matches “{query}”.</p>}
      {groups.map(([name, list]) => (
        <section key={name}>
          <h4>{name}</h4>
          <ul>{list.map((c) => <Row key={c.id} chat={c} live={live[c.id]} active={c.id === activeId} now={now} session={session} onPick={onPick} onExport={onExport} />)}</ul>
        </section>
      ))}
      {chats.length > 0 && (
        <p className="ai-chats-foot">
          {confirmClear
            ? <><button type="button" className="danger" id="ai-clear-confirm" onClick={() => { setConfirmClear(false); void session.clearHistory(); }}>Delete all {chats.length}</button> <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button></>
            : <button type="button" id="ai-clear" onClick={() => setConfirmClear(true)}>Clear history</button>}
          <span>Keeps the 50 newest; pinned ones stay.</span>
        </p>
      )}
    </div>
  );
}

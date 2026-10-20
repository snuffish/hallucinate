// One conversation's messages: replies as Markdown, the assistant's reasoning (folded or shown, see
// the panel's "Show reasoning"), tool calls as chips with the frames the assistant looked at and what
// they changed (opened from the chip), app notes (undo, reopened), the token usage of each turn, and
// messages queued behind a running one.

import type { UIMessage } from '@tanstack/ai-client';
import { Markdown } from '@tanstack/markdown/react';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { useSessions } from '../../app/sessions';
import type { ChatView, Conversation } from '../../assistant/conversations';
import { splitFollowUps } from '../../assistant/follow-ups';
import { describeNote, splitNotes } from '../../assistant/notes';
import { ContentPartsSchema, toolLabel } from '../../assistant/tools';
import { textOf } from '../../assistant/transcript';
import { addUsage, formatCost, formatTokens, newInput, NO_USAGE, type Usage } from '../../assistant/usage';
import { useStore } from '../../state/store';
import { AiChange } from './AiChange';
import { plural } from '../../app/plural';

type Part = UIMessage['parts'][number];

// Tool results that are pictures come back as content parts; the chip shows them.
function imagesOf(output: unknown): string[] {
  let value = output;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  const parts = ContentPartsSchema.safeParse(value);
  return parts.success ? parts.data.filter((p): p is Extract<typeof p, { type: 'image' }> => p.type === 'image').map((p) => `data:${p.source.mimeType};base64,${p.source.value}`) : [];
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyButton({ text, label = 'Copy', className = '' }: { text: () => string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`ai-copy ${className}`} title={label} aria-label={label}
      onClick={() => void copyText(text()).then((ok) => { if (!ok) return; setDone(true); setTimeout(() => setDone(false), 1200); })}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// Code blocks in replies get a Copy button.
function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="ai-code">
      <pre ref={ref} {...props} />
      <CopyButton text={() => ref.current?.textContent ?? ''} label="Copy code" />
    </div>
  );
}
const MD_COMPONENTS = { pre: CodeBlock };

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function Thinking({ content, live, open }: { content: string; live: boolean; open: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (live && body.current) body.current.scrollTop = body.current.scrollHeight; }, [content, live]);
  if (!content.trim()) {
    return <p className="ai-thinking private">{live ? 'Thinking…' : 'Reasoned privately (the model didn\'t share its thinking)'}</p>;
  }
  const n = words(content);
  return (
    <details className={`ai-thinking${live ? ' live' : ''}`} open={open}>
      <summary>{live ? 'Thinking…' : 'Thought about it'} <span className="ai-thinking-count">· {plural(n, 'word')}</span></summary>
      <div className="ai-thinking-body" ref={body}>
        <Markdown components={MD_COMPONENTS}>{content}</Markdown>
        {!live && <CopyButton text={() => content} label="Copy reasoning" className="ai-copy-thinking" />}
      </div>
    </details>
  );
}

function ToolChip({ part, message, chatId }: { part: Extract<Part, { type: 'tool-call' }>; message: UIMessage; chatId: string }) {
  const { changes: log } = useSessions();
  useStore(log.store, (s) => s.revision);
  const changes = log.forCall(chatId, part.id);
  const [open, setOpen] = useState(false);
  const input = (part.input ?? {}) as Record<string, unknown>;
  const result = message.parts.find((q): q is Extract<Part, { type: 'tool-result' }> => q.type === 'tool-result' && q.toolCallId === part.id);
  const error = result?.state === 'error';
  const done = part.output !== undefined || !!result;
  const label = toolLabel(part.name, input, done && !error);
  const images = imagesOf(part.output ?? result?.content);
  const why = error && typeof result?.content === 'string' ? result.content : undefined;
  const text = done ? `${error ? '✗' : '✓'} ${label}` : `${label}…`;
  return (
    <div className={`ai-tool ${done ? (error ? 'error' : 'ok') : 'running'}${open ? ' open' : ''}`} title={why}>
      {changes.length && done ? (
        <button type="button" className="ai-tool-toggle" aria-expanded={open} title={open ? 'Hide what changed' : 'Show what changed'} onClick={() => setOpen(!open)}>
          <span className="ai-tool-label">{text}</span><span className="ai-tool-more">{open ? '▾' : '▸'} what changed</span>
        </button>
      ) : <span>{text}</span>}
      {images.map((src, k) => <img key={k} src={src} alt="What the assistant saw" />)}
      {open && changes.map((c) => <AiChange key={c.id} change={c} />)}
    </div>
  );
}

// What a turn (or a whole chat, `chat`) cost. Not the summed input: every step of a run resends the
// whole conversation, mostly from the prompt cache at about a tenth of the price, so that sum looks
// huge for a one-line change. The conversation's size, the input the cache didn't serve, the output
// (about five times the price of input) and the cost the provider reported say what it took.
export function usageLabel(u: Usage, opts: { chat?: boolean } = {}): string {
  return [
    ...(u.context && !opts.chat ? [`${formatTokens(u.context)} context`] : []),
    `${formatTokens(newInput(u))} new in`,
    `${formatTokens(u.completion)} out`,
    ...(u.cost > 0 ? [`≈${formatCost(u.cost)}`] : []),
  ].join(' · ');
}
export function usageTitle(u: Usage, costLabel: string | null): string {
  const uncached = Math.max(0, u.prompt - u.cacheRead - u.cacheWrite);
  return [
    ...(u.context ? [`Context: ${u.context.toLocaleString()} tokens, what each further step resends`] : []),
    `Input over all steps: ${u.prompt.toLocaleString()} tokens: ${u.cacheRead.toLocaleString()} read from the cache (about a tenth of the price), ${u.cacheWrite.toLocaleString()} written to it, ${uncached.toLocaleString()} uncached`,
    `Output: ${u.completion.toLocaleString()} tokens (about five times the price of input)`,
    ...(u.cost > 0 && costLabel ? [`${costLabel}: ${formatCost(u.cost)}`] : []),
  ].join('\n');
}

interface Props {
  chat: Conversation;
  view: ChatView;
  showThinking: boolean;
  costLabel: string | null;     // how to name a reported cost ("API-equivalent" on a subscription), or null to hide it
  onFollowUp: (text: string) => void;
  onRetry: () => void;
  welcome: ReactNode;
}

export function Transcript({ chat, view, showThinking, costLabel, onFollowUp, onRetry, welcome }: Props) {
  const { messages, status, replyUsage } = view;
  const running = status === 'running';
  return (
    <>
      {!messages.length && !view.outbox.length && welcome}
      {messages.map((m, mi) => {
        if (m.role === 'user') {
          const { notes, text } = splitNotes(textOf(m));
          return (
            <div key={m.id} className="ai-turn-user">
              {notes.map((n) => <p key={n} className="ai-note">{describeNote(n)}</p>)}
              {text && <div className="ai-msg user"><div className="ai-body">{text}</div></div>}
            </div>
          );
        }
        if (m.role !== 'assistant') return null;
        const isLast = mi === messages.length - 1;
        const endsTurn = isLast || messages[mi + 1]!.role === 'user';
        // The reply's last text part carries the suggested next requests; they show once the run is done.
        const lastText = m.parts.reduce((last, p, i) => (p.type === 'text' ? i : last), -1);
        let followUps: string[] = [];
        // A turn's usage (a tool call and the reply after it are separate messages) shows once, at its end.
        let turn: Usage | null = null;
        if (endsTurn && !(isLast && running)) {
          turn = NO_USAGE;
          for (let i = mi; i >= 0 && messages[i]!.role !== 'user'; i--) turn = addUsage(turn, replyUsage[messages[i]!.id] ?? NO_USAGE);
          if (!turn.prompt && !turn.completion) turn = null;
        }
        const replyText = () => {
          const parts: string[] = [];
          for (let i = mi; i >= 0 && messages[i]!.role !== 'user'; i--) parts.unshift(messages[i]!.parts.map((p) => (p.type === 'text' ? splitFollowUps(p.content).text : '')).filter(Boolean).join('\n\n'));
          return parts.filter(Boolean).join('\n\n');
        };
        return (
          <div key={m.id} className="ai-msg assistant">
            <div className="ai-body">
              {m.parts.map((p, i) => {
                if (p.type === 'thinking') return <Thinking key={i} content={p.content} live={running && isLast && i === m.parts.length - 1} open={showThinking} />;
                if (p.type === 'text') {
                  const split = i === lastText ? splitFollowUps(p.content) : { text: p.content, followUps: [] };
                  if (i === lastText) followUps = split.followUps;
                  return split.text ? <div key={i} className="ai-text"><Markdown components={MD_COMPONENTS}>{split.text}</Markdown></div> : null;
                }
                if (p.type === 'tool-call') return <ToolChip key={i} part={p} message={m} chatId={chat.id} />;
                return null;
              })}
              {endsTurn && !(isLast && running) && (
                <div className="ai-msg-foot">
                  {turn && <span className="ai-reply-usage" title={usageTitle(turn, costLabel)}>{usageLabel(turn)}</span>}
                  <CopyButton text={replyText} label="Copy reply" />
                </div>
              )}
              {isLast && !running && !view.outbox.length && followUps.length > 0 && !view.readOnly && (
                <div className="ai-examples ai-followups" aria-label="Suggested next requests">
                  {followUps.map((q) => <button key={q} onClick={() => onFollowUp(q)}>{q}</button>)}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {view.notes.map((n) => <p key={n} className="ai-note pending">{describeNote(n)} · Claude hears about it with your next message.</p>)}
      {view.outbox.map((q) => (
        <div key={q.id} className="ai-msg user queued">
          <div className="ai-body">{q.text}</div>
          <button type="button" className="icon ai-unqueue" title="Don't send this" aria-label="Don't send this" onClick={() => chat.cancelQueued(q.id)}>×</button>
        </div>
      ))}
      {status === 'waiting' && <p className="ai-note">Waiting for another conversation to finish (at most 3 run at once on your subscription).</p>}
      {view.error && (
        <div className="ai-note error">
          {view.error}
          {!running && !view.readOnly && <button type="button" id="ai-retry" onClick={onRetry}>Retry</button>}
        </div>
      )}
    </>
  );
}

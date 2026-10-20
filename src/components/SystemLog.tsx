import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { z } from 'zod';
import { useApp, useUI } from '../app/AppContext';
import { downloadFile, fileStamp } from '../app/download';
import { useSessions } from '../app/sessions';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { complete, helpText, parseCommand, type Command } from '../log/commands';
import { followServer } from '../log/server-stream';
import { LEVELS, SOURCES, counts, filterEntries, sourcesFor, toText, type LogEntry, type LogLevel, type SourcePick } from '../log/system-log';
import { KEYS, readJSON, readWithDefaults, writeJSON } from '../state/persistence';
import { useStore } from '../state/store';
import { HelpButton } from './Help';
import { useMonitorDrag } from './widgets/useMonitorDrag';

const SHOWN = 500;            // the newest lines drawn; Copy and Export take every line that matches
const HISTORY = 50;           // commands kept for ↑ / ↓
const STICK_PX = 24;          // this close to the bottom, new lines keep it scrolled to the bottom

const ViewSchema = z.object({
  levels: z.array(z.enum(LEVELS)).default([...LEVELS]),
  source: z.enum(['all', ...SOURCES]).catch('all'),   // one place, so a source added later shows under "all"
  query: z.string().default(''),
});
const HistorySchema = z.array(z.string());

const LEVEL_LABEL: Record<LogLevel, string> = { error: 'Errors', warn: 'Warnings', info: 'Info', debug: 'Debug' };
const SOURCE_LABEL: Record<SourcePick, string> = { all: 'Everywhere', console: 'Console', server: 'Server', desktop: 'Desktop app', app: 'App', command: 'Commands' };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };

// A tool's answer as one line and the whole of it: long strings (a picture's data) are cut short.
function answer(result: unknown): { text: string; detail?: string } {
  const json = JSON.stringify(result, (_k, v: unknown) => (typeof v === 'string' && v.length > 500 ? `${v.slice(0, 60)}… (${v.length} characters)` : v), 2) ?? String(result);
  const flat = json.replace(/\s*\n\s*/g, ' ');
  return flat.length <= 160 ? { text: flat } : { text: `${flat.slice(0, 160)}…`, detail: json };
}

// Shift+S: everything the app, the page's console and the local server said, with a command line that runs
// the assistant's tools. It records from the first line the page runs; open, it follows the server too.
export function SystemLog() {
  const open = useUI((ui) => ui.systemLog);
  if (!open) return <div id="system-log" className="syslog" hidden />;
  return <LogPanel />;
}

// The errors since the log was last open, while it is closed: a click opens it.
export function LogBadge() {
  const app = useApp();
  const open = useUI((ui) => ui.systemLog);
  const unseen = useStore(app.log.stats, (s) => s.unseenErrors);
  const hidden = open || unseen === 0;
  return (
    <button type="button" id="log-badge" className="log-badge" hidden={hidden} onClick={() => app.toggleSystemLog(true)} title="Open the System log">
      {unseen} {unseen === 1 ? 'error' : 'errors'} <Kbd hotkey={HOTKEYS.systemLog} />
    </button>
  );
}

type View = z.infer<typeof ViewSchema>;
function useView(): [View, (patch: Partial<View>) => void] {
  const [view, setView] = useState<View>(() => readWithDefaults(KEYS.systemLogView, ViewSchema));
  const patch = (p: Partial<View>) => setView((v) => { const next = { ...v, ...p }; writeJSON(KEYS.systemLogView, next); return next; });
  return [view, patch];
}

function LogPanel() {
  const app = useApp();
  const { assistant } = useSessions();
  const log = app.log;
  const { root, moved, sized, narrow, grip, style, ...drag } = useMonitorDrag('log', '.syslog-lines');
  const dragging = useUI((ui) => ui.dragging === 'log');
  useStore(log.stats, (s) => s.version);   // re-render as lines come in
  const [view, setView] = useView();
  const [paused, setPaused] = useState<readonly LogEntry[] | null>(null);   // the lines as they were when paused
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => followServer(log), [log]);

  const all = paused ?? log.entries();
  const filter = { levels: view.levels, sources: sourcesFor(view.source), query: view.query };
  const matching = filterEntries(all, filter);
  const shown = matching.slice(-SHOWN);
  const n = counts(filterEntries(all, { ...filter, levels: LEVELS }));

  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };

  const toggleLevel = (level: LogLevel) => setView({ levels: view.levels.includes(level) ? view.levels.filter((l) => l !== level) : LEVELS.filter((l) => l === level || view.levels.includes(l)) });
  const toggleOpen = (id: number) => setOpen((o) => { const next = new Set(o); if (!next.delete(id)) next.add(id); return next; });

  const say = (level: LogLevel, text: string, detail?: string) => log.push({ level, source: 'command', text, detail });
  const copy = () => {
    const text = toText(matching);
    navigator.clipboard.writeText(text).then(() => say('info', `Copied ${matching.length} line${matching.length === 1 ? '' : 's'}`), (err: Error) => say('error', `Couldn't copy: ${err.message}`));
  };
  const save = () => {
    downloadFile(new Blob([toText(matching)], { type: 'text/plain' }), `hallucinate-${fileStamp()}.log`);
    say('info', `Saved ${matching.length} line${matching.length === 1 ? '' : 's'}`);
  };
  const clear = () => { log.clear(); setPaused(null); setOpen(new Set()); };
  // The last change a tool made, from here or the assistant: they share one undo stack.
  const undo = () => {
    const done = assistant.undoLast();
    if (!done) say('info', 'Nothing to undo');
    else if (done.error) say('error', done.error);
    else say('info', `Undid: ${done.label}`);
  };

  return (
    <div id="system-log" ref={root} className={`syslog${moved ? ' moved' : ''}${sized ? ' sized' : ''}${dragging ? ' dragging' : ''}`} style={style} data-draggable={!narrow || undefined} {...drag}>
      <div className="syslog-head">
        <b>System log</b>
        <div className="syslog-levels" role="group" aria-label="Levels">
          {LEVELS.map((level) => (
            <button key={level} type="button" className={`syslog-level ${level}`} aria-pressed={view.levels.includes(level)} onClick={() => toggleLevel(level)}>
              {LEVEL_LABEL[level]} <output>{n[level]}</output>
            </button>
          ))}
        </div>
        <HelpButton topic="log" />
      </div>
      <div className="syslog-tools">
        <select aria-label="Source" value={view.source} onChange={(e) => setView({ source: e.target.value as SourcePick })}>
          {(['all', ...SOURCES] as const).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        <input type="search" aria-label="Search the log" placeholder="Search…" value={view.query} onChange={(e) => setView({ query: e.target.value })} />
        <button type="button" className="syslog-pause" aria-pressed={!!paused} onClick={() => setPaused(paused ? null : log.entries().slice())}>{paused ? 'Resume' : 'Pause'}</button>
        <button type="button" onClick={clear}>Clear</button>
        <button type="button" onClick={copy}>Copy</button>
        <button type="button" onClick={save}>Export</button>
      </div>
      <ol className="syslog-lines" ref={list} onScroll={onScroll} aria-label="Log lines" aria-live="off">
        {matching.length > shown.length && <li className="syslog-more">{matching.length - shown.length} earlier lines: narrow the search, or Export them all</li>}
        {shown.map((e) => (
          <li key={e.id} className={`syslog-line ${e.level}`} data-level={e.level} data-source={e.source}>
            <time>{clock(e.t)}</time>
            <span className="syslog-src">{e.source}</span>
            <span className="syslog-text">
              {e.detail
                ? <button type="button" className="syslog-expand" aria-expanded={open.has(e.id)} onClick={() => toggleOpen(e.id)}>{e.text}</button>
                : e.text}
              {e.repeat > 1 && <span className="syslog-repeat">×{e.repeat}</span>}
              {e.detail && open.has(e.id) && <pre>{e.detail}</pre>}
            </span>
          </li>
        ))}
        {!shown.length && <li className="syslog-empty">{all.length ? 'No lines match.' : 'Nothing logged yet.'}</li>}
      </ol>
      <CommandLine
        onRun={(cmd) => {
          stick.current = true;
          if (cmd.kind === 'error') return say('error', cmd.message);
          if (cmd.kind === 'tool') return;   // run by the command line itself, which waits for it
          switch (cmd.name) {
            case 'help': return say('info', cmd.topic ? `help ${cmd.topic}` : 'help', helpText(cmd.topic));
            case 'clear': return clear();
            case 'copy': return copy();
            case 'export': return save();
            case 'level': return setView({ levels: cmd.levels });
            case 'source': return setView({ source: cmd.source });
            case 'filter': return setView({ query: cmd.query });
            case 'undo': return undo();
          }
        }}
      />
      <div className="syslog-hint">Close with <Kbd hotkey={HOTKEYS.systemLog} /> · type <code>help</code> below for commands</div>
      {grip}
    </div>
  );
}

// The field at the bottom: Enter runs the line, ↑ / ↓ step through the commands typed before (kept for next
// time), Tab completes a command or tool name, Esc leaves the field.
function CommandLine({ onRun }: { onRun: (cmd: Command) => void }) {
  const app = useApp();
  const { commands } = useSessions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stored] = useState(() => readJSON(KEYS.systemLogCommands, HistorySchema, []));
  const history = useRef<string[]>(stored);
  const at = useRef(Infinity);   // where ↑ / ↓ are in the history; past its end is the line being typed

  const run = async (line: string) => {
    const cmd = parseCommand(line);
    if (!cmd) return;
    history.current = [...history.current.filter((h) => h !== line), line].slice(-HISTORY);
    at.current = Infinity;
    writeJSON(KEYS.systemLogCommands, history.current);
    app.log.push({ level: 'info', source: 'command', text: `> ${line}` });
    setText('');
    onRun(cmd);
    if (cmd.kind !== 'tool') return;
    setBusy(true);
    try {
      app.log.push({ level: 'info', source: 'command', ...answer(await commands(cmd.name, cmd.input)) });
    } catch (err) {
      app.log.push({ level: 'error', source: 'command', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void run(text.trim()); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); return; }
    if (e.key === 'Tab' && !e.shiftKey && text && !text.includes(' ')) {
      e.preventDefault();
      const c = complete(text);
      setText(c.text);
      if (c.options.length > 1 && c.text === text) app.log.push({ level: 'info', source: 'command', text: c.options.join('  ') });
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = history.current;
      if (!h.length) return;
      e.preventDefault();
      at.current = Math.max(0, Math.min(h.length, Math.min(at.current, h.length) + (e.key === 'ArrowUp' ? -1 : 1)));
      setText(h[at.current] ?? '');
    }
  };

  return (
    <form className="syslog-command" onSubmit={(e) => e.preventDefault()}>
      <span aria-hidden="true">{busy ? '…' : '>'}</span>
      <input
        type="text" aria-label="Command" placeholder="help · state · switch_scene scene=&quot;…&quot; · level warn"
        spellCheck={false} autoComplete="off" value={text} readOnly={busy}
        onChange={(e) => { setText(e.target.value); at.current = Infinity; }}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}

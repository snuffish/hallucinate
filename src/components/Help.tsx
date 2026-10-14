// The `?` buttons and the one popover they open. Which help is open lives in the UI store (`ui.help`),
// not in the popover's own state: the controller closes it whenever an overlay, the panel or the
// assistant changes, so it can't be left floating after its panel is gone. Only HelpLayer holds a
// popover element; buttons just toggle the store.

import { formatForDisplay } from '@tanstack/react-hotkeys';
import { useLayoutEffect, useRef } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { HELP_TOPICS, SHEET_GROUPS, groupRows, shortcutRows, type HelpTopic, type ShortcutRow } from '../help/topics';
import { Kbd } from '../hotkeys/Kbd';
import { CUE_DIGITS, HOTKEYS, SCENE_DIGITS, type HotkeyDef } from '../hotkeys/registry';
import type { HelpId } from '../state/ui-state';

const GAP = 6;
const EDGE = 8;

// The mounted `?` buttons, so the popover can sit next to the one that opened it.
const anchors = new Map<HelpId, HTMLButtonElement>();

const titleOf = (id: HelpId) => (id === 'sheet' ? 'Help & shortcuts' : HELP_TOPICS[id].title);

export function HelpButton({ topic }: { topic: HelpId }) {
  const app = useApp();
  const open = useUI((ui) => ui.help === topic);
  const title = titleOf(topic);
  return (
    <button type="button" id={`help-btn-${topic}`} ref={(el) => { if (!el) return; anchors.set(topic, el); return () => { anchors.delete(topic); }; }} className={`icon help-btn${open ? ' active' : ''}`} title={title} aria-label={`Help: ${title}`}
      aria-expanded={open} aria-controls="help-pop" onClick={() => app.toggleHelp(topic)}>
      ?{topic === 'sheet' && <Kbd hotkey={HOTKEYS.help} />}
    </button>
  );
}

export function HelpLayer() {
  const app = useApp();
  const help = useUI((ui) => ui.help);
  const pop = useRef<HTMLDivElement>(null);

  // Show / hide follows the store; position next to the button that opened it (the sheet is centred by CSS).
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    if (!help) { if (el.matches(':popover-open')) el.hidePopover(); return; }
    if (!el.matches(':popover-open')) el.showPopover();

    const place = () => {
      const anchor = help === 'sheet' ? null : anchors.get(help) ?? null;
      const anchored = anchor !== null && window.innerWidth > 600;   // phones get a bottom sheet (CSS)
      el.classList.toggle('anchored', anchored);
      if (!anchored) { el.style.left = el.style.top = ''; return; }
      const a = anchor.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      const left = Math.min(Math.max(EDGE, a.right - width), window.innerWidth - width - EDGE);
      const below = a.bottom + GAP;
      const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, a.top - height - GAP);
      el.style.left = `${Math.max(EDGE, left)}px`;
      el.style.top = `${top}px`;
    };
    place();

    // `popover="manual"` has no light dismiss: a press outside the popover (and outside any `?`) closes it.
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && el.contains(t)) return;
      if (t instanceof Node && [...anchors.values()].some((b) => b.contains(t))) return;
      app.setHelp(null);
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', onDown, true); };
  }, [help, app]);

  const topic = help && help !== 'sheet' ? HELP_TOPICS[help] : null;
  return (
    <div id="help-pop" ref={pop} popover="manual" role="dialog" aria-labelledby="help-pop-title" className={`help-pop${help === 'sheet' ? ' sheet' : ''}`}>
      {help && (
        <>
          <header><strong id="help-pop-title">{titleOf(help)}</strong></header>
          {topic ? <TopicBody topic={topic} /> : <Sheet />}
        </>
      )}
    </div>
  );
}

function TopicBody({ topic }: { topic: HelpTopic }) {
  const rows = shortcutRows(topic.hotkeys);
  return (
    <>
      {topic.body.map((p) => <p key={p}>{p}</p>)}
      {rows.length > 0 && <Shortcuts rows={rows} />}
    </>
  );
}

function Sheet() {
  return (
    <>
      {HELP_TOPICS.panel.body.map((p) => <p key={p}>{p}</p>)}
      <p className="help-more">Every panel has its own <b>?</b> with more about it.</p>
      <div className="help-groups">
        {SHEET_GROUPS.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <Shortcuts rows={groupRows(group)} />
            {group === 'Scenes' && <Digits digits={SCENE_DIGITS} label="Pick a scene" />}
            {group === 'Studio' && <Digits digits={CUE_DIGITS} label="Pick a cue" note="in the studio" />}
          </section>
        ))}
      </div>
    </>
  );
}

function Shortcuts({ rows }: { rows: ShortcutRow[] }) {
  return (
    <dl className="help-keys">
      {rows.map((r) => (
        <div key={`${r.label}|${r.note ?? ''}`}>
          <dt>{r.keys.map((def) => <Key key={def.id} def={def} />)}</dt>
          <dd>{r.label}{r.note && <small> · {r.note}</small>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Digits({ digits, label, note }: { digits: readonly string[]; label: string; note?: string }) {
  const first = digits[0]!, last = digits[digits.length - 1]!;
  return (
    <dl className="help-keys">
      <div>
        <dt><Kbd hotkey={first as HotkeyDef['keys']} />–<Kbd hotkey={last as HotkeyDef['keys']} /><span className="sr-only">{first} to {last}</span></dt>
        <dd>{label}{note && <small> · {note}</small>}</dd>
      </div>
    </dl>
  );
}

// The badge is aria-hidden (it's decoration on buttons), so help spells the key out for screen readers.
function Key({ def }: { def: HotkeyDef }) {
  return <><Kbd hotkey={def} /><span className="sr-only">{formatForDisplay(def.keys)}</span></>;
}

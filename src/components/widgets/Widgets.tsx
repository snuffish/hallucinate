// Every control widget, laid out from the layout store: four edge docks (stacked in order) and the
// floating widgets. Also publishes the layout to the rest of the page: `--dock-left/right/top/bottom`
// (how far each dock reaches into the screen) and `body[data-widgets]` (whether the open overlay
// shows widgets at all). Overlays position themselves from those only, never from a widget.

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useApp, useLayout, useUI } from '../../app/AppContext';
import { HOTKEYS } from '../../hotkeys/registry';
import { Kbd } from '../../hotkeys/Kbd';
import { NO_INSETS, WIDGET_IDS, ZONES, effective, zoneWidgets, type WidgetId, type WidgetLayout, type Zone } from '../../state/layout';
import type { Overlay } from '../../state/ui-state';
import { HelpButton } from '../Help';
import { ParamsWidget } from '../ParamOverlay';
import { dockInsets, dropStore, zoneEls } from './drop';
import { ActionsBody, AudioBody, LookBody, MediaBody, SceneBody, SourceBody, type PanelActions } from './sections';
import { Widget, useNarrow } from './Widget';

export const WIDGET_LABELS: Record<WidgetId, string> = {
  hub: 'Hallucinate', source: 'Source', media: 'Media', audio: 'Audio', scene: 'Scene', look: 'Look', actions: 'Actions', params: 'Parameters',
};

// Space kept between a dock and a floating widget pushed out of it.
const FLOAT_GAP = 10;

// The overlays that take the whole screen: widgets hide while they are open.
const HIDES_WIDGETS: Overlay[] = ['library', 'nodes'];

export function Widgets(actions: PanelActions) {
  const narrow = useNarrow();
  const layout = useLayout((l) => l);
  const hidden = useUI((ui) => ui.widgetsHidden);
  const dragging = useUI((ui) => ui.dragging !== null);
  const shown = effective(layout, narrow);
  const render = (id: WidgetId) => <WidgetFor key={id} id={id} entry={shown.widgets[id]} actions={actions} />;
  return (
    <div id="widgets" className={`widgets${hidden ? ' collapsed' : ''}${dragging ? ' dragging' : ''}`}>
      {ZONES.map((zone) => (
        <div key={zone} className={`dock-zone ${zone}`} style={(zone === 'left' || zone === 'right') && !narrow ? { width: shown.dockWidth[zone] } : undefined}
          ref={(el) => { if (!el) return; zoneEls[zone] = el; return () => { delete zoneEls[zone]; }; }}>
          {zoneWidgets(shown, zone).map(render)}
        </div>
      ))}
      {WIDGET_IDS.filter((id) => shown.widgets[id].open && shown.widgets[id].place.kind === 'float').map(render)}
      <DropPreview />
      <DockMetrics />
    </div>
  );
}

function WidgetFor({ id, entry, actions: a }: { id: WidgetId; entry: WidgetLayout; actions: PanelActions }) {
  switch (id) {
    case 'hub': return <HubWidget entry={entry} />;
    case 'source': return <Widget id={id} entry={entry} title="Source" help="sources"><SourceBody onSource={a.onSource} /></Widget>;
    case 'media': return <Widget id={id} entry={entry} title="Media"><MediaBody onOpenMediaFile={a.onOpenMediaFile} onOpenYouTube={a.onOpenYouTube} /></Widget>;
    case 'audio': return <Widget id={id} entry={entry} title="Audio"><AudioBody /></Widget>;
    case 'scene': return <Widget id={id} entry={entry} title="Scene"><SceneBody onOpenLibrary={a.onOpenLibrary} /></Widget>;
    case 'look': return <Widget id={id} entry={entry} title="Look" help="look" bodyClass="sliders"><LookBody /></Widget>;
    case 'actions': return <Widget id={id} entry={entry} title="Actions" bodyClass="actions"><ActionsBody {...a} /></Widget>;
    case 'params': return <ParamsWidget entry={entry} />;
  }
}

// The title bar of the app: the shortcut sheet, the Widgets menu and H. It can't be closed, so the
// way back to every other widget is always on screen.
function HubWidget({ entry }: { entry: WidgetLayout }) {
  const app = useApp();
  return (
    <Widget id="hub" domId="hub" entry={entry} title="Hallucinate" closable={false} collapse={false} resizable={false}
      tools={<>
        <WidgetsMenu />
        <HelpButton topic="sheet" />
        <button id="collapse" className="icon" title="Hide the controls (H)" onClick={() => app.toggleWidgets()}>–<Kbd hotkey={HOTKEYS.hidePanel} /></button>
      </>} />
  );
}

function WidgetsMenu() {
  const app = useApp();
  const open = useLayout((l) => l.widgets);
  const bubbleShown = useLayout((l) => l.bubbleShown);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const settingsFile = useRef<HTMLInputElement>(null);
  // Native popover: light dismiss and Esc for free. Placed under its button when it opens.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open' || !button.current) return;
      const b = button.current.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - width - 8))}px`;
      el.style.top = `${b.bottom + 6 + height <= window.innerHeight - 8 ? b.bottom + 6 : Math.max(8, b.top - height - 6)}px`;
    };
    el.addEventListener('toggle', place);
    return () => el.removeEventListener('toggle', place);
  }, []);
  return (
    <>
      <button ref={button} id="widgets-menu-btn" className="icon" title="Show or hide widgets, reset the layout, export or import your setup" aria-label="Widgets" popoverTarget="widgets-menu">☰</button>
      <div ref={menu} id="widgets-menu" className="widgets-menu" popover="auto" role="menu" aria-label="Widgets">
        <strong>Widgets</strong>
        {WIDGET_IDS.filter((id) => id !== 'hub').map((id) => (
          <label key={id} className="toggle" role="menuitemcheckbox" aria-checked={open[id].open}>
            <input type="checkbox" data-widget-toggle={id} checked={open[id].open} onChange={(e) => app.setWidgetOpen(id, e.target.checked)} /> {WIDGET_LABELS[id]}
          </label>
        ))}
        <label className="toggle" role="menuitemcheckbox" aria-checked={bubbleShown}>
          <input type="checkbox" data-widget-toggle="assistant" checked={bubbleShown} onChange={(e) => app.setBubbleShown(e.target.checked)} /> AI assistant
        </label>
        <button id="reset-layout" onClick={() => { menu.current?.hidePopover(); app.resetLayout(); }}>Reset layout<Kbd hotkey={HOTKEYS.resetLayout} /></button>
        <small>Drag a widget by its title bar. Drop it on an edge of the screen to dock it there.</small>
        <strong>Your setup</strong>
        <button id="export-settings" title="Save your scenes, show, parameters, favourites and layout to a file" onClick={() => { menu.current?.hidePopover(); app.exportSettings(); }}>Export scenes &amp; settings</button>
        <button id="import-settings" title="Replace them with an exported file (your current setup is downloaded first)" onClick={() => { menu.current?.hidePopover(); settingsFile.current?.click(); }}>Import…</button>
        <input type="file" id="settings-file" accept="application/json,.json" hidden ref={settingsFile}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.importSettings(f); e.target.value = ''; }} />
      </div>
    </>
  );
}

// Where the dragged widget would land: a dock's area or an insertion line.
function DropPreview() {
  const target = useSyncExternalStore(dropStore.subscribe, () => dropStore.get().target);
  if (!target || target.kind !== 'dock') return null;
  const { left, top, width, height } = target.preview;
  return <div className={`drop-preview${target.line ? ' line' : ''}`} style={{ left, top, width, height }} aria-hidden="true" />;
}

// Publishes how far each dock reaches into the screen. Runs on layout and size changes only,
// never per frame: the zones' sizes don't change with the meters.
function DockMetrics() {
  const app = useApp();
  const overlay = useUI((ui) => ui.overlay);
  const hidden = useUI((ui) => ui.widgetsHidden);
  const started = useUI((ui) => ui.started);
  const layout = useLayout((l) => l);
  useLayoutEffect(() => {
    const body = document.body;
    const hideAll = HIDES_WIDGETS.includes(overlay);
    body.dataset.widgets = hideAll ? 'hidden' : 'shown';
    const zones = ZONES.map((z) => [z, zoneEls[z]] as const);
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const insets = { ...NO_INSETS };
      for (const [zone, el] of zones) {
        let reach = 0;
        if (el && started && !hidden && !hideAll && el.childElementCount > 0) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) reach = ({ left: r.right, right: vw - r.left, top: r.bottom, bottom: vh - r.top } satisfies Record<Zone, number>)[zone];
        }
        body.style.setProperty(`--dock-${zone}`, `${Math.round(reach)}px`);
        insets[zone] = reach > 0 ? Math.round(reach) + FLOAT_GAP : 0;
      }
      dockInsets.set(insets);
    };
    measure();
    // Writing the vars resizes the top/bottom docks (they span between the side docks), so measure
    // again on the next frame rather than inside the observer callback (no ResizeObserver loop).
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(later);
    for (const [, el] of zones) if (el) ro.observe(el);
    window.addEventListener('resize', later);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); window.removeEventListener('resize', later); };
  }, [app, overlay, hidden, started, layout]);
  return null;
}

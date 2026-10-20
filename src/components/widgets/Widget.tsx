// The frame every control widget shares: dragged by any part that doesn't take the press itself (to an
// edge to dock it there, or anywhere to float it), double-click there to put it back, a header with
// collapse and close buttons, and the body.
// Where it sits comes from the layout store; a floating widget is placed from its stored corner
// offset and fitted back on screen whenever the window, fullscreen or its own size changes.

import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { Kbd } from '../../hotkeys/Kbd';
import type { HotkeyDef } from '../../hotkeys/registry';
import { DOCK_WIDTH, clampDock, clampH, clampW, floatToPx, type FloatPlace, type SideZone, type WidgetId, type WidgetLayout } from '../../state/layout';
import type { HelpId } from '../../state/ui-state';
import { HelpButton } from '../Help';
import { dockInsets, dropTargetAt, rectOf, setDropTarget, setZoneStyle, zoneStyle, zoneWidth } from './drop';
import { ownsPress, startsDrag } from './ownPress';
import { usePointerDrag } from './usePointerDrag';

const NARROW = '(max-width: 600px)';
const subscribeNarrow = (cb: () => void) => { const m = window.matchMedia(NARROW); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
// Phones: one column, no dragging (see `effective` in src/state/layout.ts).
export const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

// Keeps a floating element at its stored spot, on screen and out of the docks. Not used while it is
// being dragged.
export function useFloatPlacement(ref: RefObject<HTMLElement | null>, place: FloatPlace | null) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !place) return;
    const fit = () => {
      if (el.classList.contains('dragging') || el.classList.contains('resizing') || !el.offsetWidth) return;
      const { left, top } = floatToPx(place, { width: el.offsetWidth, height: el.offsetHeight }, viewport(), dockInsets.get());
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const unsubscribe = dockInsets.subscribe(fit);
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    return () => {
      unsubscribe();
      ro.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', fit);
      el.style.left = el.style.top = '';
    };
  }, [ref, place]);
}

// A resize grip. `onMove` gets the pointer's offset from where the press started.
export function Grip({ className, title, onStart, onMove, onEnd, onCancel, onReset }: {
  className: string; title: string; onStart: () => void; onMove: (dx: number, dy: number) => void; onEnd: () => void; onCancel: () => void; onReset: () => void;
}) {
  const from = useRef({ x: 0, y: 0 });
  const handlers = usePointerDrag({
    onStart: () => onStart(),
    onMove: (e) => onMove(e.clientX - from.current.x, e.clientY - from.current.y),
    onEnd: () => onEnd(),
    onCancel,
  });
  return (
    <div className={`grip ${className}`} title={title} aria-hidden="true" onDoubleClick={onReset}
      onPointerDown={(e) => { from.current = { x: e.clientX, y: e.clientY }; handlers.onPointerDown(e); }} />
  );
}

// A corner grip's new size for a box that started at `s` (its rect when the press began), the pointer
// `dx` / `dy` from where it started. `up`: the grip is on the top edge (the box grows upward). The
// dragged edge stops at the screen's edge (8 px in). Shared by the widgets and the monitors.
export function cornerSize(s: { w: number; h: number; left: number; top: number; bottom: number }, dx: number, dy: number, up = false): { w: number; h: number } {
  const view = viewport();
  const w = Math.min(clampW(s.w + dx, view), Math.max(s.w, view.width - s.left - 8));
  const room = up ? s.bottom - 8 : view.height - s.top - 8;
  const h = Math.min(clampH(s.h + (up ? -dy : dy), view), Math.max(s.h, room));
  return { w, h };
}

// What the grips of a widget resize, by where it sits: a float or a top/bottom widget by its corner
// (a bottom-docked one grows upward), a side-docked one by its bottom edge (its height) and its inner
// edge (the whole dock's width, like a sidebar).
type GripMode = 'corner' | 'corner-up' | 'height' | 'width';

export interface WidgetProps {
  id: WidgetId;
  entry: WidgetLayout;
  title: ReactNode;
  domId?: string;
  help?: HelpId;
  tools?: ReactNode;              // extra header buttons, before help / collapse / close
  hidden?: boolean;               // nothing to show right now (e.g. a scene without parameters)
  closable?: boolean;
  collapse?: { id?: string; hotkey?: HotkeyDef } | false;
  resizable?: boolean;
  bodyClass?: string;
  children?: ReactNode;
}

export function Widget({ id, entry, title, domId, help, tools, hidden, closable = true, collapse = {}, resizable = true, bodyClass, children }: WidgetProps) {
  const app = useApp();
  const narrow = useNarrow();
  const root = useRef<HTMLElement>(null);
  const isFloat = entry.place.kind === 'float';
  const draggingThis = useUI((ui) => ui.dragging === id);
  useFloatPlacement(root, entry.place.kind === 'float' ? entry.place : null);

  // While dragging, the widget follows the pointer as a fixed "ghost"; its inline style is restored
  // afterwards and the drop is committed to the layout store.
  const drag = useRef<{ dx: number; dy: number; style: string } | null>(null);
  const restore = () => {
    const el = root.current;
    if (el && drag.current) { el.style.cssText = drag.current.style; el.classList.remove('dragging'); }
    drag.current = null;
    setDropTarget(null);
    app.setDragging(null);
  };
  const handlers = usePointerDrag({
    onStart: (_e, grab) => {
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      drag.current = { dx: grab.x, dy: grab.y, style: el.style.cssText };   // `grab`: where it was pressed
      Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: '0' });
      el.classList.add('dragging');
      app.setDragging(id);
    },
    onMove: (e) => {
      const el = root.current, d = drag.current;
      if (!el || !d) return;
      // The ghost stays on screen even when the pointer is at the very edge.
      el.style.left = `${Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - Math.min(el.offsetHeight, 80))}px`;
      setDropTarget(dropTargetAt(e.clientX, e.clientY, id, app.layout.get().dockWidth));
    },
    onEnd: (e) => {
      const el = root.current;
      if (!el || !drag.current) return restore();
      const target = dropTargetAt(e.clientX, e.clientY, id, app.layout.get().dockWidth);
      const rect = rectOf(el);
      restore();
      if (target.kind === 'dock') app.dockWidget(id, target.zone, target.index);
      else app.floatWidget(id, rect);
    },
    onCancel: restore,
  }, { enabled: !narrow });

  // Resizing: the new size shows live as inline style and is committed to the layout on release.
  const zone = entry.place.kind === 'dock' ? entry.place.zone : null;
  const side: SideZone | null = zone === 'left' || zone === 'right' ? zone : null;
  const sized = useRef<{ w: number; h: number; left: number; top: number; bottom: number; dock: number; style: string; dockStyle: string } | null>(null);
  const startResize = () => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    sized.current = { w: r.width, h: r.height, left: r.left, top: r.top, bottom: r.bottom, dock: (side && zoneWidth(side)) || DOCK_WIDTH, style: el.style.cssText, dockStyle: side ? zoneStyle(side) : '' };
    el.classList.add('resizing');
    app.setDragging('resize');
  };
  const moveResize = (mode: GripMode) => (dx: number, dy: number) => {
    const el = root.current, s = sized.current;
    if (!el || !s) return;
    if (mode === 'width' && side) { setZoneStyle(side, { width: clampDock(s.dock + (side === 'left' ? dx : -dx)) }); return; }
    const { w, h } = cornerSize(s, dx, dy, mode === 'corner-up');
    if (mode !== 'height') el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  };
  const endResize = (mode: GripMode) => () => {
    const el = root.current, s = sized.current;
    if (!el || !s) return;
    const rect = rectOf(el);
    const dockWidth = (side && zoneWidth(side)) || s.dock;
    el.classList.remove('resizing');
    sized.current = null;
    app.setDragging(null);
    if (mode === 'width' && side) app.setDockWidth(side, dockWidth);
    else if (mode === 'height') app.resizeWidget(id, { h: rect.height });
    else app.resizeWidget(id, { w: rect.width, h: rect.height }, rect);
  };
  const cancelResize = () => {
    const el = root.current, s = sized.current;
    if (el && s) { el.style.cssText = s.style; el.classList.remove('resizing'); }
    if (side && s) setZoneStyle(side, { cssText: s.dockStyle });
    sized.current = null;
    app.setDragging(null);
  };
  const grip = (mode: GripMode, title: string, onReset: () => void) => (
    <Grip key={mode} className={`${mode}${side ? ` ${side}` : ''}`} title={`${title} · double-click for the natural size`}
      onStart={startResize} onMove={moveResize(mode)} onEnd={endResize(mode)} onCancel={cancelResize} onReset={onReset} />
  );
  const resetSize = () => app.resizeWidget(id, { w: null, h: null });
  const grips = !resizable || narrow || entry.collapsed ? null
    : side ? [grip('height', 'Drag to change the height', () => app.resizeWidget(id, { h: null })), grip('width', 'Drag to change the width of the dock', () => app.setDockWidth(side, DOCK_WIDTH))]
    : zone === 'bottom' ? [grip('corner-up', 'Drag to resize', resetSize)]
    : [grip('corner', 'Drag to resize', resetSize)];

  // Side docks set the width; everything else can have its own. A collapsed widget is just its header.
  const style: CSSProperties = {
    width: side || entry.size.w === null ? undefined : entry.size.w,
    height: entry.collapsed || entry.size.h === null ? undefined : entry.size.h,
  };
  const classes = ['widget', `widget-${id}`, isFloat ? 'floating' : 'docked', entry.collapsed ? 'collapsed' : '', draggingThis ? 'dragging' : '',
    entry.size.h !== null && !entry.collapsed ? 'sized' : ''].filter(Boolean).join(' ');
  return (
    <section ref={root} id={domId ?? `w-${id}`} data-widget={id} data-draggable={!narrow || undefined} className={classes} hidden={hidden} style={style}
      aria-label={typeof title === 'string' ? title : undefined}
      onPointerDown={(e) => { if (startsDrag(e)) handlers.onPointerDown(e); }} onClickCapture={handlers.onClickCapture}
      onDoubleClick={(e) => { if (!narrow && !ownsPress(e)) app.resetWidget(id); }}>
      <header title={narrow ? undefined : 'Drag anywhere on the widget to move it · drop on an edge to dock · double-click to put it back'}>
        <strong className="widget-title">{title}</strong>
        {tools}
        {help && <HelpButton topic={help} />}
        {collapse && (
          <button id={collapse.id} className="icon widget-collapse" title={`${entry.collapsed ? 'Expand' : 'Collapse'}${collapse.hotkey ? ` (${collapse.hotkey.keys})` : ''}`}
            aria-expanded={!entry.collapsed} onClick={() => app.toggleWidgetCollapsed(id)}>
            {entry.collapsed ? '+' : '–'}{collapse.hotkey && <Kbd hotkey={collapse.hotkey} />}
          </button>
        )}
        {closable && <button className="icon widget-close" title="Close (reopen it from the Widgets menu)" aria-label={`Close ${typeof title === 'string' ? title : 'widget'}`} onClick={() => app.setWidgetOpen(id, false)}>×</button>}
      </header>
      {children !== undefined && <div className={`widget-body${bodyClass ? ` ${bodyClass}` : ''}`} hidden={entry.collapsed}>{children}</div>}
      {grips}
    </section>
  );
}

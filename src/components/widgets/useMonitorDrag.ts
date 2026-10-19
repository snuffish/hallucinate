// A monitor (the Hearing monitor, the System log) sits in the monitors' corner until dragged, by any part
// that doesn't take the press itself; then where it was dropped (stored in the layout), until a double-click
// on such a part puts it back. Phones keep it in the corner.

import { useRef } from 'react';
import { useApp, useLayout } from '../../app/AppContext';
import { effective, type MonitorId } from '../../state/layout';
import { rectOf } from './drop';
import { usePointerDrag } from './usePointerDrag';
import { useFloatPlacement, useNarrow } from './Widget';

// What takes a press itself instead of moving the monitor: its buttons and chips, its fields and sliders, a link.
const OWN_PRESS = 'button, input, select, textarea, a';
const ownsPress = (e: React.MouseEvent) => !!(e.target as HTMLElement).closest(OWN_PRESS);
// A press on the monitor's scrollbar (when it scrolls) drags the scrollbar, not the monitor.
const onScrollbar = (e: React.PointerEvent<HTMLElement>) => e.clientX >= e.currentTarget.getBoundingClientRect().left + e.currentTarget.clientLeft + e.currentTarget.clientWidth;

// `fixed`: a part (the System log's lines) that is selected as text, so it never starts a drag either.
export function useMonitorDrag(id: MonitorId, fixed?: string) {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const place = useLayout((l) => effective(l, narrow)[id]);
  useFloatPlacement(root, place.kind === 'float' ? place : null);
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
      drag.current = { dx: grab.x, dy: grab.y, style: el.style.cssText };   // `grab`: where it was pressed
      Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, maxHeight: `${r.height}px` });
      app.setDragging(id);
    },
    onMove: (e) => {
      const el = root.current, d = drag.current;
      if (!el || !d) return;
      el.style.left = `${Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - el.offsetHeight)}px`;
    },
    onEnd: () => {
      const el = root.current;
      if (!el || !drag.current) return restore();
      const rect = rectOf(el);
      restore();
      app.moveMonitor(id, rect);
    },
    onCancel: restore,
  }, { enabled: !narrow });
  const isFixed = (e: React.MouseEvent) => !!fixed && !!(e.target as HTMLElement).closest(fixed);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { if (!onScrollbar(e) && !isFixed(e)) handlers.onPointerDown(e); };
  const onDoubleClick = (e: React.MouseEvent) => { if (place.kind === 'float' && !ownsPress(e) && !isFixed(e)) app.resetMonitor(id); };
  return { root, moved: place.kind === 'float', narrow, onPointerDown, onClickCapture: handlers.onClickCapture, onDoubleClick };
}

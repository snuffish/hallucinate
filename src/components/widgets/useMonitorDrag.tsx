// A monitor (the performance overlay, the Hearing monitor, the System log) sits in the monitors' corner until
// dragged, by any part that doesn't take the press itself; then where it was dropped (stored in the layout),
// until a double-click on such a part puts it back. Its corner grip resizes it (double-click: the natural
// size). Phones keep it in the corner at its natural size.

import { useRef, type CSSProperties } from 'react';
import { useApp, useLayout } from '../../app/AppContext';
import { effective, type MonitorId } from '../../state/layout';
import { rectOf } from './drop';
import { isFixed, ownsPress, startsDrag } from './ownPress';
import { usePointerDrag } from './usePointerDrag';
import { cornerSize, Grip, useFloatPlacement, useNarrow } from './Widget';

// `fixed`: a part (the System log's lines) that is selected as text, so it never starts a drag either.
export function useMonitorDrag(id: MonitorId, fixed?: string) {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const place = useLayout((l) => effective(l, narrow)[id]);
  const size = useLayout((l) => effective(l, narrow).monitorSize[id]);
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

  // Resizing: the new size shows live as inline style and is committed to the layout on release.
  const sized = useRef<{ w: number; h: number; left: number; top: number; bottom: number; style: string } | null>(null);
  const startResize = () => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    sized.current = { w: r.width, h: r.height, left: r.left, top: r.top, bottom: r.bottom, style: el.style.cssText };
    el.classList.add('resizing');
    app.setDragging('resize');
  };
  const moveResize = (dx: number, dy: number) => {
    const el = root.current, s = sized.current;
    if (!el || !s) return;
    const { w, h } = cornerSize(s, dx, dy);
    Object.assign(el.style, { width: `${w}px`, height: `${h}px`, maxHeight: 'none' });
  };
  const endResize = () => {
    const el = root.current;
    if (!el || !sized.current) return;
    const rect = rectOf(el);
    el.classList.remove('resizing');
    sized.current = null;
    app.setDragging(null);
    app.resizeMonitor(id, { w: rect.width, h: rect.height }, rect);
  };
  const cancelResize = () => {
    const el = root.current, s = sized.current;
    if (el && s) { el.style.cssText = s.style; el.classList.remove('resizing'); }
    sized.current = null;
    app.setDragging(null);
  };
  const grip = narrow ? null : (
    <Grip className="corner" title="Drag to resize · double-click for the natural size"
      onStart={startResize} onMove={moveResize} onEnd={endResize} onCancel={cancelResize} onReset={() => app.resizeMonitor(id, { w: null, h: null })} />
  );
  const sizedNow = size.w !== null || size.h !== null;
  const style: CSSProperties = { width: size.w ?? undefined, height: size.h ?? undefined, ...(size.h !== null && { maxHeight: 'none' }) };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { if (startsDrag(e, fixed)) handlers.onPointerDown(e); };
  const onDoubleClick = (e: React.MouseEvent) => { if ((place.kind === 'float' || sizedNow) && !ownsPress(e) && !isFixed(e, fixed)) app.resetMonitor(id); };
  return { root, moved: place.kind === 'float', sized: sizedNow, narrow, grip, style, onPointerDown, onClickCapture: handlers.onClickCapture, onDoubleClick };
}

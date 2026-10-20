// A pointer drag on one handle element: a few pixels of slack before it counts as a drag (so a click
// stays a click, on whatever part of the handle was pressed), then pointer capture, Esc to cancel, and
// the click that follows a real drag swallowed (so dragging a button doesn't also press it). Shared by
// the widgets, the monitors, the chat window, the resize grips and the assistant bubble.

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

const SLACK = 4;

export interface DragHandlers {
  // The drag starts (the pointer moved past the slack). `grab` is where the pointer is inside `el`.
  onStart: (e: PointerEvent, grab: { x: number; y: number }) => void;
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
  onCancel: () => void;
}

export interface DragOptions {
  enabled?: boolean;
  // Presses on a button inside the handle (other than the handle itself) don't start a drag.
  ignoreButtons?: boolean;
}

export function usePointerDrag(handlers: DragHandlers, { enabled = true, ignoreButtons = true }: DragOptions = {}) {
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; });
  const swallowClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || e.button !== 0 || cleanup.current) return;
    const handle = e.currentTarget;
    const button = (e.target as HTMLElement).closest('button, input, select, a');
    if (ignoreButtons && button && button !== handle) return;
    const rect = handle.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < SLACK) return;
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        latest.current.onStart(ev, grab);
      }
      latest.current.onMove(ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      done();
      if (!dragging) return;
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 0);   // in case no click follows
      latest.current.onEnd(ev);
    };
    const cancel = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      done();
      if (dragging) latest.current.onCancel();
    };
    // Esc cancels the drag and nothing else (it would otherwise close an overlay too).
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !dragging) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancel();
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      cleanup.current = null;
    };
    // On the window: until the drag starts, the pointer isn't captured and may leave the handle.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    cleanup.current = cancel;
  };

  const onClickCapture = (e: ReactMouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}

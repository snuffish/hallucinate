// A pointer drag on one handle element: pointer capture, a few pixels of slack before it counts as a
// drag (so a click stays a click), Esc to cancel, and the click that follows a real drag swallowed
// (so dragging a button doesn't also press it). Shared by the widget headers and the assistant bubble.

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
    handle.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < SLACK) return;
        dragging = true;
        latest.current.onStart(ev, grab);
      }
      latest.current.onMove(ev);
    };
    const up = (ev: PointerEvent) => {
      done();
      if (!dragging) return;
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 0);   // in case no click follows
      latest.current.onEnd(ev);
    };
    const cancel = () => { done(); if (dragging) latest.current.onCancel(); };
    // Esc cancels the drag and nothing else (it would otherwise close an overlay too).
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !dragging) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancel();
    };
    const done = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      cleanup.current = null;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
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

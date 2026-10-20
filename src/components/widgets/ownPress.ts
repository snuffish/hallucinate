// Which presses on a draggable panel (a widget, a monitor, the chat window) move it: any part that
// doesn't take the press itself. Controls, the XY pad, a resize grip and a scrollbar keep theirs.

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

// What takes a press itself instead of moving the panel: buttons and chips, fields and sliders, links,
// anything marked `data-own-press` (the XY pad), and the resize grips.
const OWN_PRESS = 'button, input, select, textarea, a, label, [contenteditable], [role="slider"], [data-own-press], .grip';
export const ownsPress = (e: ReactMouseEvent) => !!(e.target as HTMLElement).closest(OWN_PRESS);

// A press on a scrollbar (of the panel or of a part of it that scrolls) drags the scrollbar.
function onScrollbar(e: ReactPointerEvent<HTMLElement>): boolean {
  for (let el = e.target as HTMLElement | null; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && e.clientX >= el.getBoundingClientRect().left + el.clientLeft + el.clientWidth) return true;
    if (el.scrollWidth > el.clientWidth && e.clientY >= el.getBoundingClientRect().top + el.clientTop + el.clientHeight) return true;
    if (el === e.currentTarget) break;
  }
  return false;
}

// `fixed`: a part (the System log's lines, the chat's messages) that is selected as text, so it never starts a drag either.
export const startsDrag = (e: ReactPointerEvent<HTMLElement>, fixed?: string): boolean =>
  !ownsPress(e) && !onScrollbar(e) && !(fixed && (e.target as HTMLElement).closest(fixed));

export const isFixed = (e: ReactMouseEvent, fixed?: string): boolean => !!fixed && !!(e.target as HTMLElement).closest(fixed);

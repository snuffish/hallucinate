// Where a dragged widget would land: an edge dock (at a position among the widgets there) or a free
// float. Worked out from the pointer and the dock zones' live rectangles; the preview rectangle it
// returns is what the drop-preview overlay draws (VS Code's highlighted area).

import type { Insets, Rect, SideZone, WidgetId, Zone } from '../../state/layout';
import { NO_INSETS, ZONES } from '../../state/layout';
import { Store } from '../../state/store';

// How close to an edge of the screen counts as "dock here".
export const EDGE = 56;
const MARGIN = 16;
const ROW_HEIGHT = 140;
const LINE = 3;

export type DropTarget =
  | { kind: 'dock'; zone: Zone; index: number; preview: Rect; line: boolean }
  | { kind: 'float' };

// How far each dock reaches into the screen (plus a gap), published by Widgets; floating widgets
// and a moved bubble keep out of it.
export const dockInsets = new Store<Insets>(NO_INSETS);

// The drop target while a drag is on; null otherwise. Only the preview overlay subscribes.
export const dropStore = new Store<{ target: DropTarget | null }>({ target: null });

export function setDropTarget(target: DropTarget | null): void {
  const prev = dropStore.get().target;
  const same = prev === target || (prev && target && prev.kind === target.kind && (prev.kind === 'float'
    || (target.kind === 'dock' && prev.zone === target.zone && prev.index === target.index && prev.preview.top === target.preview.top && prev.preview.left === target.preview.left)));
  if (!same) dropStore.set({ target });
}

// The mounted dock zone elements (registered by their ref callbacks in Widgets).
export const zoneEls: Partial<Record<Zone, HTMLElement>> = {};
const zoneEl = (zone: Zone) => zoneEls[zone] ?? null;

// Live resizing of a side dock (the committed width comes back through the layout store).
export const zoneWidth = (zone: Zone): number | null => zoneEl(zone)?.offsetWidth ?? null;
export const zoneStyle = (zone: Zone): string => zoneEl(zone)?.style.cssText ?? '';
export function setZoneStyle(zone: Zone, style: { width?: number; cssText?: string }): void {
  const el = zoneEl(zone);
  if (!el) return;
  if (style.cssText !== undefined) el.style.cssText = style.cssText;
  if (style.width !== undefined) el.style.width = `${style.width}px`;
}
const vertical = (zone: Zone) => zone === 'left' || zone === 'right';

// The widgets docked in a zone, minus the one being dragged.
function children(zone: Zone, dragged: WidgetId): HTMLElement[] {
  const el = zoneEl(zone);
  return el ? [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.widget !== dragged) : [];
}

const box = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

// The whole area a dock would take when it is empty.
function zoneArea(zone: Zone, vw: number, vh: number, widths: Record<SideZone, number>): Rect {
  const side = (z: Zone) => { const el = zoneEl(z); return el && el.childElementCount > 0 ? el.getBoundingClientRect() : null; };
  if (zone === 'left') return { left: MARGIN, top: MARGIN, width: widths.left, height: vh - 2 * MARGIN };
  if (zone === 'right') return { left: vw - MARGIN - widths.right, top: MARGIN, width: widths.right, height: vh - 2 * MARGIN };
  const l = side('left'), r = side('right');
  const left = l ? l.right + MARGIN : MARGIN;
  const right = r ? r.left - MARGIN : vw - MARGIN;
  return { left, top: zone === 'top' ? MARGIN : vh - MARGIN - ROW_HEIGHT, width: Math.max(0, right - left), height: ROW_HEIGHT };
}

// Inside a non-empty dock: the slot before the first widget whose middle is past the pointer, and a
// thin line where it would go.
function slot(zone: Zone, dragged: WidgetId, x: number, y: number): { index: number; preview: Rect } {
  const items = children(zone, dragged).map((c) => c.getBoundingClientRect());
  const v = vertical(zone);
  let index = items.findIndex((r) => (v ? y < r.top + r.height / 2 : x < r.left + r.width / 2));
  if (index < 0) index = items.length;
  const ref = items[Math.min(index, items.length - 1)]!;
  const atEnd = index === items.length;
  if (v) {
    const top = atEnd ? ref.bottom + 4 : ref.top - 4 - LINE;
    return { index, preview: { left: ref.left, top, width: ref.width, height: LINE } };
  }
  const left = atEnd ? ref.right + 4 : ref.left - 4 - LINE;
  return { index, preview: { left, top: ref.top, width: LINE, height: ref.height } };
}

export function dropTargetAt(x: number, y: number, dragged: WidgetId, widths: Record<SideZone, number>): DropTarget {
  const vw = window.innerWidth, vh = window.innerHeight;
  // Near an edge: the nearest one.
  const dist: Record<Zone, number> = { left: x, right: vw - x, top: y, bottom: vh - y };
  const edge = ZONES.filter((z) => dist[z] <= EDGE).sort((a, b) => dist[a] - dist[b])[0];
  // Over a dock that already has widgets.
  const over = edge ?? ZONES.find((z) => {
    if (children(z, dragged).length === 0) return false;
    const r = zoneEl(z)!.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (!over) return { kind: 'float' };
  if (children(over, dragged).length === 0) return { kind: 'dock', zone: over, index: 0, preview: zoneArea(over, vw, vh, widths), line: false };
  const { index, preview } = slot(over, dragged, x, y);
  return { kind: 'dock', zone: over, index, preview, line: true };
}

export function rectOf(el: HTMLElement): Rect {
  return box(el.getBoundingClientRect());
}

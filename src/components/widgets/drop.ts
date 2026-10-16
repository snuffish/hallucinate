// The docks as a drag sees them, read from the DOM: where a dragged widget would land is worked out
// from that snapshot by dropTarget (src/state/layout.ts); the preview rectangle it returns is what the
// drop-preview overlay draws (VS Code's highlighted area).

import type { DockView, DropTarget, Insets, Rect, SideZone, WidgetId, Zone } from '../../state/layout';
import { dropTarget, NO_INSETS, ZONES } from '../../state/layout';
import { Store } from '../../state/store';

export type { DropTarget };

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
const box = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

// Each dock's rectangle and its widgets', the dragged one left out.
function snapshot(dragged: WidgetId): Record<Zone, DockView> {
  const view = (zone: Zone): DockView => {
    const el = zoneEl(zone);
    if (!el) return { rect: null, occupied: false, items: [] };
    const items = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.widget !== dragged);
    return { rect: box(el.getBoundingClientRect()), occupied: el.childElementCount > 0, items: items.map((c) => box(c.getBoundingClientRect())) };
  };
  return Object.fromEntries(ZONES.map((z) => [z, view(z)])) as Record<Zone, DockView>;
}

export function dropTargetAt(x: number, y: number, dragged: WidgetId, widths: Record<SideZone, number>): DropTarget {
  return dropTarget(x, y, snapshot(dragged), { width: window.innerWidth, height: window.innerHeight }, widths);
}

export function rectOf(el: HTMLElement): Rect {
  return box(el.getBoundingClientRect());
}

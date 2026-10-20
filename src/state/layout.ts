// Where every control widget sits: docked to an edge of the screen (in order) or floating. Pure
// functions over an immutable `Layout`; the controller holds it in a store and persists it under
// `KEYS.layout`. Floats are stored as an offset from their nearest corner, so they stay in the same
// part of the screen when the window, the monitor or fullscreen changes; `floatToPx` fits them back
// on screen without changing what is stored.

import { z } from 'zod';
import { KEYS, readJSON, readString, remove } from './persistence';

export const WIDGET_IDS = ['hub', 'source', 'media', 'audio', 'scene', 'look', 'effects', 'actions', 'screen', 'params'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export const ZONES = ['left', 'right', 'top', 'bottom'] as const;
export type Zone = (typeof ZONES)[number];

export interface FloatPlace { kind: 'float'; ax: 'l' | 'r'; ay: 't' | 'b'; dx: number; dy: number }
export interface DockPlace { kind: 'dock'; zone: Zone; order: number }
export type Place = DockPlace | FloatPlace;
// A size the user dragged; null means "as tall / wide as the content (or the dock) makes it".
export interface WidgetSize { w: number | null; h: number | null }
export interface WidgetLayout { open: boolean; collapsed: boolean; place: Place; size: WidgetSize }
export type SideZone = 'left' | 'right';
// The assistant bubble: `auto` keeps it beside the left dock (the stylesheet places it), a float pins it.
export type BubblePlace = { kind: 'auto' } | FloatPlace;
// A monitor (the performance overlay, the Hearing monitor, the System log): `auto` keeps it in the monitors' corner, a float pins it.
export type MonitorPlace = { kind: 'auto' } | FloatPlace;
const MONITOR_IDS = ['perf', 'hearing', 'log'] as const;
export type MonitorId = (typeof MONITOR_IDS)[number];
// `dockWidth`: the left and right docks are one column each, as wide as this.
// `bubbleShown`: the assistant bubble can be switched off from the Widgets menu like a widget.
// `chatSize`: the assistant's chat window, resized by its grip like a widget (null: the stylesheet's size).
// `chatPlace`: where the chat window opens (`auto`: beside the bubble; a float: where it was dropped).
// `perf`: where the performance overlay (Shift+P) opens; `hearing`: the Hearing monitor (Shift+L); `log`: the System log (Shift+S).
// `monitorSize`: each monitor's dragged size (null: the stylesheet's).
export interface Layout {
  v: 1; widgets: Record<WidgetId, WidgetLayout>; bubble: BubblePlace; bubbleShown: boolean; dockWidth: Record<SideZone, number>;
  chatSize: WidgetSize; chatPlace: MonitorPlace; perf: MonitorPlace; hearing: MonitorPlace; log: MonitorPlace; monitorSize: Record<MonitorId, WidgetSize>;
}

export const MIN_W = 200;
export const MIN_H = 80;
export const DOCK_MIN = 220;
export const DOCK_MAX = 560;
export const DOCK_WIDTH = 290;
export const CHAT_MIN_W = 300;
export const CHAT_MIN_H = 260;
const AUTO: WidgetSize = { w: null, h: null };
const AUTO_PLACE: BubblePlace & MonitorPlace = { kind: 'auto' };
const AUTO_MONITOR_SIZE: Record<MonitorId, WidgetSize> = { perf: AUTO, hearing: AUTO, log: AUTO };
const clampTo = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
export const clampW = (w: number, viewport?: Size) => clampTo(w, MIN_W, (viewport?.width ?? Infinity) - 32);
export const clampH = (h: number, viewport?: Size) => clampTo(h, MIN_H, (viewport?.height ?? Infinity) - 32);
export const clampDock = (w: number) => clampTo(w, DOCK_MIN, DOCK_MAX);

export interface Size { width: number; height: number }
export interface Rect extends Size { left: number; top: number }

const dockAt = (zone: Zone, order: number): DockPlace => ({ kind: 'dock', zone, order });

// Today's screen: the controls stacked on the left, the parameters top-right.
export const DEFAULT_LAYOUT: Layout = {
  v: 1,
  widgets: {
    hub: { open: true, collapsed: false, place: dockAt('left', 0), size: AUTO },
    source: { open: true, collapsed: false, place: dockAt('left', 1), size: AUTO },
    media: { open: true, collapsed: false, place: dockAt('left', 2), size: AUTO },
    audio: { open: true, collapsed: false, place: dockAt('left', 3), size: AUTO },
    scene: { open: true, collapsed: false, place: dockAt('left', 4), size: AUTO },
    look: { open: true, collapsed: false, place: dockAt('left', 5), size: AUTO },
    effects: { open: true, collapsed: false, place: dockAt('left', 6), size: AUTO },
    actions: { open: true, collapsed: false, place: dockAt('left', 7), size: AUTO },
    screen: { open: true, collapsed: false, place: dockAt('left', 8), size: AUTO },
    params: { open: true, collapsed: false, place: { kind: 'float', ax: 'r', ay: 't', dx: 16, dy: 16 }, size: AUTO },
  },
  bubble: { kind: 'auto' },
  bubbleShown: true,
  dockWidth: { left: DOCK_WIDTH, right: DOCK_WIDTH },
  chatSize: AUTO,
  chatPlace: { kind: 'auto' },
  perf: { kind: 'auto' },
  hearing: { kind: 'auto' },
  log: { kind: 'auto' },
  monitorSize: { perf: AUTO, hearing: AUTO, log: AUTO },
};

const withWidget = (layout: Layout, id: WidgetId, patch: Partial<WidgetLayout>): Layout =>
  ({ ...layout, widgets: { ...layout.widgets, [id]: { ...layout.widgets[id], ...patch } } });

// Open widgets docked in `zone`, in order.
export function zoneWidgets(layout: Layout, zone: Zone): WidgetId[] {
  return WIDGET_IDS
    .filter((id) => { const w = layout.widgets[id]; return w.open && w.place.kind === 'dock' && w.place.zone === zone; })
    .sort((a, b) => (layout.widgets[a].place as DockPlace).order - (layout.widgets[b].place as DockPlace).order);
}

// Renumbers every dock 0..n-1 (closed widgets keep their slot among the open ones).
function renumber(layout: Layout): Layout {
  const widgets = { ...layout.widgets };
  for (const zone of ZONES) {
    const ids = WIDGET_IDS.filter((id) => { const p = widgets[id].place; return p.kind === 'dock' && p.zone === zone; })
      .sort((a, b) => (widgets[a].place as DockPlace).order - (widgets[b].place as DockPlace).order || WIDGET_IDS.indexOf(a) - WIDGET_IDS.indexOf(b));
    ids.forEach((id, order) => { widgets[id] = { ...widgets[id], place: dockAt(zone, order) }; });
  }
  return { ...layout, widgets };
}

// Docks `id` into `zone` before the open widget currently at `index` (or last).
export function dock(layout: Layout, id: WidgetId, zone: Zone, index: number): Layout {
  const others = zoneWidgets(layout, zone).filter((w) => w !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const before = others[at];
  const order = before === undefined ? Number.MAX_SAFE_INTEGER : (layout.widgets[before].place as DockPlace).order - 0.5;
  return renumber(withWidget(layout, id, { place: dockAt(zone, order) }));
}

// The nearest corner of `rect` and its distance from it.
function anchorFor(rect: Rect, viewport: Size): FloatPlace {
  const ax = rect.left + rect.width / 2 < viewport.width / 2 ? 'l' : 'r';
  const ay = rect.top + rect.height / 2 < viewport.height / 2 ? 't' : 'b';
  return {
    kind: 'float', ax, ay,
    dx: Math.round(ax === 'l' ? rect.left : viewport.width - rect.left - rect.width),
    dy: Math.round(ay === 't' ? rect.top : viewport.height - rect.top - rect.height),
  };
}

export function float(layout: Layout, id: WidgetId, rect: Rect, viewport: Size): Layout {
  return renumber(withWidget(layout, id, { place: anchorFor(rect, viewport) }));
}

export type Insets = Record<Zone, number>;
export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

// Fits [pos, pos + size] into [lo, hi] when it can, else into [0, max].
const fit = (pos: number, size: number, lo: number, hi: number, max: number) =>
  hi - lo >= size ? Math.min(Math.max(lo, pos), hi - size) : Math.min(Math.max(0, pos), Math.max(0, max - size));

// Where a float goes on this screen: its corner offset, then pulled fully on screen and out of the
// docks (`insets`: how far each dock reaches in) when it fits. What is stored never changes.
export function floatToPx(place: FloatPlace, size: Size, viewport: Size, insets: Insets = NO_INSETS): { left: number; top: number } {
  const left = place.ax === 'l' ? place.dx : viewport.width - place.dx - size.width;
  const top = place.ay === 't' ? place.dy : viewport.height - place.dy - size.height;
  return {
    left: Math.round(fit(left, size.width, insets.left, viewport.width - insets.right, viewport.width)),
    top: Math.round(fit(top, size.height, insets.top, viewport.height - insets.bottom, viewport.height)),
  };
}

export function setOpen(layout: Layout, id: WidgetId, open: boolean): Layout {
  if (id === 'hub' && !open) throw new Error('The Hallucinate widget holds the way back to every other widget; it cannot be closed.');
  return withWidget(layout, id, { open });
}

export function setCollapsed(layout: Layout, id: WidgetId, collapsed: boolean): Layout {
  return withWidget(layout, id, { collapsed });
}

// `cur` with the dimensions `size` gives: each clamped, null back to automatic, a missing one left as it was.
function applySize(cur: WidgetSize, size: Partial<WidgetSize>, clampW: (w: number) => number, clampH: (h: number) => number): WidgetSize {
  const dim = (v: number | null | undefined, was: number | null, clamp: (v: number) => number) => (v === undefined ? was : v === null ? null : clamp(v));
  return { w: dim(size.w, cur.w, clampW), h: dim(size.h, cur.h, clampH) };
}

// A dragged size; null puts that dimension back to automatic.
export function resize(layout: Layout, id: WidgetId, size: Partial<WidgetSize>): Layout {
  return withWidget(layout, id, { size: applySize(layout.widgets[id].size, size, clampW, clampH) });
}

export function setDockWidth(layout: Layout, zone: SideZone, width: number): Layout {
  return { ...layout, dockWidth: { ...layout.dockWidth, [zone]: clampDock(width) } };
}

export function resetLayout(): Layout {
  return structuredClone(DEFAULT_LAYOUT);
}

// Puts one widget back where the default layout has it (among the widgets docked there now), at
// its natural size.
export function resetWidget(layout: Layout, id: WidgetId): Layout {
  const def = DEFAULT_LAYOUT.widgets[id].place;
  const sized = withWidget(layout, id, { size: AUTO });
  if (def.kind === 'float') return renumber(withWidget(sized, id, { place: { ...def } }));
  const index = zoneWidgets(sized, def.zone).filter((w) => w !== id && WIDGET_IDS.indexOf(w) < WIDGET_IDS.indexOf(id)).length;
  return dock(sized, id, def.zone, index);
}

export function setBubbleShown(layout: Layout, shown: boolean): Layout {
  return { ...layout, bubbleShown: shown };
}

// The chat window's dragged size; null puts that dimension back to the stylesheet's.
export function resizeChat(layout: Layout, size: Partial<WidgetSize>): Layout {
  return { ...layout, chatSize: applySize(layout.chatSize, size, (w) => clampTo(w, CHAT_MIN_W, Infinity), (h) => clampTo(h, CHAT_MIN_H, Infinity)) };
}

export function moveBubble(layout: Layout, rect: Rect, viewport: Size): Layout {
  return { ...layout, bubble: anchorFor(rect, viewport) };
}

export function moveMonitor(layout: Layout, id: MonitorId, rect: Rect, viewport: Size): Layout {
  return { ...layout, [id]: anchorFor(rect, viewport) };
}

// Back in the monitors' corner at the stylesheet's size.
export function resetMonitor(layout: Layout, id: MonitorId): Layout {
  return { ...layout, [id]: { kind: 'auto' }, monitorSize: { ...layout.monitorSize, [id]: AUTO } };
}

// A monitor's dragged size; null puts that dimension back to the stylesheet's.
export function resizeMonitor(layout: Layout, id: MonitorId, size: Partial<WidgetSize>): Layout {
  return { ...layout, monitorSize: { ...layout.monitorSize, [id]: applySize(layout.monitorSize[id], size, clampW, clampH) } };
}

// The chat window floats where it was dropped; reset puts it back beside the bubble.
export function moveChat(layout: Layout, rect: Rect, viewport: Size): Layout {
  return { ...layout, chatPlace: anchorFor(rect, viewport) };
}

export function resetChat(layout: Layout): Layout {
  return { ...layout, chatPlace: { kind: 'auto' } };
}

// Phones: one column on the left in the default order and natural sizes, the bubble and the monitors
// in their default spots. The stored layout is untouched, so the desktop arrangement comes back on a wider window.
export function effective(layout: Layout, narrow: boolean): Layout {
  if (!narrow) return layout;
  const widgets = { ...layout.widgets };
  WIDGET_IDS.forEach((id, order) => { widgets[id] = { ...widgets[id], place: dockAt('left', order), size: AUTO }; });
  // The same place object every call: the assistant and the monitor select it from the store, and a new one each time re-renders forever.
  return { ...layout, widgets, bubble: AUTO_PLACE, dockWidth: DEFAULT_LAYOUT.dockWidth, chatSize: AUTO, chatPlace: AUTO_PLACE, perf: AUTO_PLACE, hearing: AUTO_PLACE, log: AUTO_PLACE, monitorSize: AUTO_MONITOR_SIZE };
}

// Where the chat window opens next to a moved bubble: toward the side with more room, above or
// below and left- or right-aligned, kept `margin` px inside the screen. `growX` / `growY` say which
// way it grows when resized (away from the bubble), so its grip sits on that corner.
export interface ChatPlacement { left: number; top: number; maxHeight: number; growX: 'left' | 'right'; growY: 'up' | 'down' }
export function chatPlacement(bubble: Rect, chat: Size, viewport: Size, gap = 14, margin = 8): ChatPlacement {
  const roomRight = viewport.width - bubble.left;
  const roomLeft = bubble.left + bubble.width;
  const rawLeft = roomRight >= roomLeft ? bubble.left : bubble.left + bubble.width - chat.width;
  const left = Math.max(margin, Math.min(rawLeft, viewport.width - chat.width - margin));
  const roomAbove = bubble.top - gap - margin;
  const roomBelow = viewport.height - bubble.top - bubble.height - gap - margin;
  const above = roomAbove >= roomBelow;
  const maxHeight = Math.max(120, Math.min(chat.height, above ? roomAbove : roomBelow));
  const rawTop = above ? bubble.top - gap - maxHeight : bubble.top + bubble.height + gap;
  const top = Math.max(margin, Math.min(rawTop, viewport.height - maxHeight - margin));
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.round(maxHeight), growX: roomRight >= roomLeft ? 'right' : 'left', growY: above ? 'up' : 'down' };
}

// ---------- Persistence ----------

const FloatSchema = z.object({ kind: z.literal('float'), ax: z.enum(['l', 'r']), ay: z.enum(['t', 'b']), dx: z.number(), dy: z.number() });
const DockSchema = z.object({ kind: z.literal('dock'), zone: z.enum(ZONES), order: z.number() });
const SizeSchema = z.object({ w: z.number().nullable(), h: z.number().nullable() });
const WidgetLayoutSchema = z.object({ open: z.boolean(), collapsed: z.boolean(), place: z.discriminatedUnion('kind', [DockSchema, FloatSchema]), size: SizeSchema.optional() });
const DockWidthSchema = z.object({ left: z.number(), right: z.number() });
const AutoOrFloatSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('auto') }), FloatSchema]);
export const StoredLayoutSchema = z.object({ v: z.literal(1), widgets: z.record(z.string(), z.unknown()), bubble: z.unknown().optional(), bubbleShown: z.unknown().optional(), dockWidth: z.unknown().optional(), chatSize: z.unknown().optional(), chatPlace: z.unknown().optional(), perf: z.unknown().optional(), hearing: z.unknown().optional(), log: z.unknown().optional(), monitorSize: z.unknown().optional() });

// Every entry is checked on its own: an unknown widget is dropped and a missing or broken one falls
// back to its default, so adding a widget in a later version never resets the rest of the layout.
export function parseLayout(raw: unknown): Layout {
  const stored = StoredLayoutSchema.safeParse(raw);
  if (!stored.success) return resetLayout();
  const layout = resetLayout();
  for (const id of WIDGET_IDS) {
    const entry = WidgetLayoutSchema.safeParse(stored.data.widgets[id]);
    if (!entry.success) continue;
    const size = entry.data.size ?? AUTO;
    layout.widgets[id] = { ...entry.data, size: applySize(AUTO, size, clampW, clampH) };
  }
  layout.widgets.hub.open = true;
  const bubble = AutoOrFloatSchema.safeParse(stored.data.bubble);
  if (bubble.success) layout.bubble = bubble.data;
  if (typeof stored.data.bubbleShown === 'boolean') layout.bubbleShown = stored.data.bubbleShown;
  const widths = DockWidthSchema.safeParse(stored.data.dockWidth);
  if (widths.success) layout.dockWidth = { left: clampDock(widths.data.left), right: clampDock(widths.data.right) };
  const chat = SizeSchema.safeParse(stored.data.chatSize);
  if (chat.success) layout.chatSize = resizeChat(layout, chat.data).chatSize;
  const chatPlace = AutoOrFloatSchema.safeParse(stored.data.chatPlace);
  if (chatPlace.success) layout.chatPlace = chatPlace.data;
  const sizes = z.record(z.string(), z.unknown()).safeParse(stored.data.monitorSize);
  for (const id of MONITOR_IDS) {
    const place = AutoOrFloatSchema.safeParse(stored.data[id]);
    if (place.success) layout[id] = place.data;
    const size = SizeSchema.safeParse(sizes.success ? sizes.data[id] : undefined);
    if (size.success) layout.monitorSize = resizeMonitor(layout, id, size.data).monitorSize;
  }
  return renumber(layout);
}

const OldParamsPos = z.object({ x: z.number(), y: z.number() }).nullable();

// The stored layout, or (first run of this version) the default with the Parameters overlay's old
// position and collapsed state carried over. `migrated` means the caller should save it now; the
// old keys are removed here.
export function loadLayout(): { layout: Layout; migrated: boolean } {
  const raw = readJSON<unknown>(KEYS.layout, z.unknown(), undefined);
  if (raw !== undefined) return { layout: parseLayout(raw), migrated: false };
  let layout = resetLayout();
  const pos = readJSON(KEYS.paramsPos, OldParamsPos, null);
  if (pos) layout = withWidget(layout, 'params', { place: { kind: 'float', ax: 'l', ay: 't', dx: Math.round(pos.x), dy: Math.round(pos.y) } });
  if (readString(KEYS.paramsCollapsed) === '1') layout = setCollapsed(layout, 'params', true);
  const migrated = pos !== null || readString(KEYS.paramsCollapsed) !== null;
  remove(KEYS.paramsPos);
  remove(KEYS.paramsCollapsed);
  return { layout, migrated };
}

// ---------- Where a dragged widget lands ----------

// An edge dock (at a position among the widgets there, with the preview the overlay draws: the whole
// area of an empty dock, else a thin line where it would go), or a free float.
export type DropTarget =
  | { kind: 'dock'; zone: Zone; index: number; preview: Rect; line: boolean }
  | { kind: 'float' };

// One dock as the drag sees it: its rectangle, whether anything is docked there (the dragged widget
// counts), and the rectangles of the other widgets in it, in order.
export interface DockView { rect: Rect | null; occupied: boolean; items: Rect[] }

export const DROP_EDGE = 56;   // how close to an edge of the screen counts as "dock here"
const DROP_MARGIN = 16;
const DROP_ROW_HEIGHT = 140;
const DROP_LINE = 3;

// The dock nearest an edge the pointer is close to, else the non-empty dock it is over, else a float.
export function dropTarget(x: number, y: number, docks: Record<Zone, DockView>, view: Size, widths: Record<SideZone, number>): DropTarget {
  const dist: Record<Zone, number> = { left: x, right: view.width - x, top: y, bottom: view.height - y };
  const edge = ZONES.filter((z) => dist[z] <= DROP_EDGE).sort((a, b) => dist[a] - dist[b])[0];
  const inside = (r: Rect) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  const over = edge ?? ZONES.find((z) => docks[z].items.length > 0 && !!docks[z].rect && inside(docks[z].rect!));
  if (!over) return { kind: 'float' };
  const items = docks[over].items;
  if (!items.length) return { kind: 'dock', zone: over, index: 0, preview: emptyDockArea(over, docks, view, widths), line: false };
  return { kind: 'dock', zone: over, ...dropSlot(over, items, x, y), line: true };
}

// The whole area a dock takes when it is empty. A top or bottom row runs between the side docks.
function emptyDockArea(zone: Zone, docks: Record<Zone, DockView>, view: Size, widths: Record<SideZone, number>): Rect {
  const m = DROP_MARGIN;
  if (zone === 'left') return { left: m, top: m, width: widths.left, height: view.height - 2 * m };
  if (zone === 'right') return { left: view.width - m - widths.right, top: m, width: widths.right, height: view.height - 2 * m };
  const side = (z: SideZone) => (docks[z].occupied ? docks[z].rect : null);
  const l = side('left'), r = side('right');
  const left = l ? l.left + l.width + m : m;
  const right = r ? r.left - m : view.width - m;
  return { left, top: zone === 'top' ? m : view.height - m - DROP_ROW_HEIGHT, width: Math.max(0, right - left), height: DROP_ROW_HEIGHT };
}

// Inside a non-empty dock: the slot before the first widget whose middle is past the pointer.
function dropSlot(zone: Zone, items: Rect[], x: number, y: number): { index: number; preview: Rect } {
  const vertical = zone === 'left' || zone === 'right';
  let index = items.findIndex((r) => (vertical ? y < r.top + r.height / 2 : x < r.left + r.width / 2));
  if (index < 0) index = items.length;
  const ref = items[Math.min(index, items.length - 1)]!;
  const atEnd = index === items.length;
  if (vertical) {
    const top = atEnd ? ref.top + ref.height + 4 : ref.top - 4 - DROP_LINE;
    return { index, preview: { left: ref.left, top, width: ref.width, height: DROP_LINE } };
  }
  const left = atEnd ? ref.left + ref.width + 4 : ref.left - 4 - DROP_LINE;
  return { index, preview: { left, top: ref.top, width: DROP_LINE, height: ref.height } };
}

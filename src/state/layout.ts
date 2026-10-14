// Where every control widget sits: docked to an edge of the screen (in order) or floating. Pure
// functions over an immutable `Layout`; the controller holds it in a store and persists it under
// `KEYS.layout`. Floats are stored as an offset from their nearest corner, so they stay in the same
// part of the screen when the window, the monitor or fullscreen changes; `floatToPx` fits them back
// on screen without changing what is stored.

import { z } from 'zod';
import { KEYS, readJSON, readString, remove } from './persistence';

export const WIDGET_IDS = ['hub', 'source', 'media', 'audio', 'scene', 'look', 'actions', 'screen', 'params'] as const;
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
// `dockWidth`: the left and right docks are one column each, as wide as this.
// `bubbleShown`: the assistant bubble can be switched off from the Widgets menu like a widget.
export interface Layout { v: 1; widgets: Record<WidgetId, WidgetLayout>; bubble: BubblePlace; bubbleShown: boolean; dockWidth: Record<SideZone, number> }

export const MIN_W = 200;
export const MIN_H = 80;
export const DOCK_MIN = 220;
export const DOCK_MAX = 560;
export const DOCK_WIDTH = 290;
const AUTO: WidgetSize = { w: null, h: null };
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
    actions: { open: true, collapsed: false, place: dockAt('left', 6), size: AUTO },
    screen: { open: true, collapsed: false, place: dockAt('left', 7), size: AUTO },
    params: { open: true, collapsed: false, place: { kind: 'float', ax: 'r', ay: 't', dx: 16, dy: 16 }, size: AUTO },
  },
  bubble: { kind: 'auto' },
  bubbleShown: true,
  dockWidth: { left: DOCK_WIDTH, right: DOCK_WIDTH },
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
export function anchorFor(rect: Rect, viewport: Size): FloatPlace {
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

// A dragged size; null puts that dimension back to automatic.
export function resize(layout: Layout, id: WidgetId, size: Partial<WidgetSize>): Layout {
  const cur = layout.widgets[id].size;
  const w = size.w === undefined ? cur.w : size.w === null ? null : clampW(size.w);
  const h = size.h === undefined ? cur.h : size.h === null ? null : clampH(size.h);
  return withWidget(layout, id, { size: { w, h } });
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

export function moveBubble(layout: Layout, rect: Rect, viewport: Size): Layout {
  return { ...layout, bubble: anchorFor(rect, viewport) };
}

// Phones: one column on the left in the default order and natural sizes, the bubble in its default
// spot. The stored layout is untouched, so the desktop arrangement comes back on a wider window.
export function effective(layout: Layout, narrow: boolean): Layout {
  if (!narrow) return layout;
  const widgets = { ...layout.widgets };
  WIDGET_IDS.forEach((id, order) => { widgets[id] = { ...widgets[id], place: dockAt('left', order), size: AUTO }; });
  return { ...layout, widgets, bubble: { kind: 'auto' }, dockWidth: DEFAULT_LAYOUT.dockWidth };
}

// Where the chat window opens next to a moved bubble: toward the side with more room, above or
// below and left- or right-aligned, kept `margin` px inside the screen.
export function chatPlacement(bubble: Rect, chat: Size, viewport: Size, gap = 14, margin = 8): { left: number; top: number; maxHeight: number } {
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
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.round(maxHeight) };
}

// ---------- Persistence ----------

const FloatSchema = z.object({ kind: z.literal('float'), ax: z.enum(['l', 'r']), ay: z.enum(['t', 'b']), dx: z.number(), dy: z.number() });
const DockSchema = z.object({ kind: z.literal('dock'), zone: z.enum(ZONES), order: z.number() });
const SizeSchema = z.object({ w: z.number().nullable(), h: z.number().nullable() });
const WidgetLayoutSchema = z.object({ open: z.boolean(), collapsed: z.boolean(), place: z.discriminatedUnion('kind', [DockSchema, FloatSchema]), size: SizeSchema.optional() });
const DockWidthSchema = z.object({ left: z.number(), right: z.number() });
const BubbleSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('auto') }), FloatSchema]);
export const StoredLayoutSchema = z.object({ v: z.literal(1), widgets: z.record(z.string(), z.unknown()), bubble: z.unknown().optional(), bubbleShown: z.unknown().optional(), dockWidth: z.unknown().optional() });

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
    layout.widgets[id] = { ...entry.data, size: { w: size.w === null ? null : clampW(size.w), h: size.h === null ? null : clampH(size.h) } };
  }
  layout.widgets.hub.open = true;
  const bubble = BubbleSchema.safeParse(stored.data.bubble);
  if (bubble.success) layout.bubble = bubble.data;
  if (typeof stored.data.bubbleShown === 'boolean') layout.bubbleShown = stored.data.bubbleShown;
  const widths = DockWidthSchema.safeParse(stored.data.dockWidth);
  if (widths.success) layout.dockWidth = { left: clampDock(widths.data.left), right: clampDock(widths.data.right) };
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

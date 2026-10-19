import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from './persistence';
import {
  DEFAULT_LAYOUT, DROP_EDGE, WIDGET_IDS, chatPlacement, dock, dropTarget, type DockView, effective, float, floatToPx, loadLayout, moveBubble, moveHearing, moveMonitor, parseLayout,
  CHAT_MIN_H, CHAT_MIN_W, DOCK_MAX, DOCK_MIN, MIN_H, MIN_W, resetHearing, resetLayout, resetMonitor, resetWidget, resize, resizeChat, setBubbleShown, setDockWidth, setOpen, zoneWidgets, type DockPlace, type FloatPlace,
} from './layout';

const VIEW = { width: 1280, height: 720 };

describe('layout', () => {
  it('starts as today: controls stacked on the left, parameters top-right', () => {
    expect(zoneWidgets(DEFAULT_LAYOUT, 'left')).toEqual(['hub', 'source', 'media', 'audio', 'scene', 'look', 'effects', 'actions', 'screen']);
    expect(DEFAULT_LAYOUT.widgets.params.place).toMatchObject({ kind: 'float', ax: 'r', ay: 't' });
    expect(DEFAULT_LAYOUT.bubble).toEqual({ kind: 'auto' });
  });

  it('docks a widget at a position and renumbers the dock it left and the one it joined', () => {
    let l = dock(resetLayout(), 'look', 'right', 0);
    expect(zoneWidgets(l, 'right')).toEqual(['look']);
    expect(zoneWidgets(l, 'left')).toEqual(['hub', 'source', 'media', 'audio', 'scene', 'effects', 'actions', 'screen']);
    expect(WIDGET_IDS.filter((id) => l.widgets[id].place.kind === 'dock' && (l.widgets[id].place as DockPlace).zone === 'left')
      .map((id) => (l.widgets[id].place as DockPlace).order).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    l = dock(l, 'scene', 'right', 0);
    expect(zoneWidgets(l, 'right')).toEqual(['scene', 'look']);
    l = dock(l, 'scene', 'right', 99);
    expect(zoneWidgets(l, 'right')).toEqual(['look', 'scene']);
    l = dock(l, 'actions', 'left', 1);
    expect(zoneWidgets(l, 'left')).toEqual(['hub', 'actions', 'source', 'media', 'audio', 'effects', 'screen']);
  });

  it('anchors a float to its nearest corner', () => {
    const l = float(resetLayout(), 'scene', { left: 1000, top: 600, width: 260, height: 100 }, VIEW);
    expect(l.widgets.scene.place).toEqual({ kind: 'float', ax: 'r', ay: 'b', dx: 20, dy: 20 });
    expect(zoneWidgets(l, 'left')).not.toContain('scene');
  });

  it('keeps a float on screen on a smaller screen without changing what is stored', () => {
    const big = { width: 2560, height: 1440 };
    const place = float(resetLayout(), 'look', { left: 1800, top: 300, width: 260, height: 400 }, big).widgets.look.place as FloatPlace;
    const pos = floatToPx(place, { width: 260, height: 400 }, VIEW);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left + 260).toBeLessThanOrEqual(VIEW.width);
    expect(pos.top + 400).toBeLessThanOrEqual(VIEW.height);
    // Top-left anchored and too far right: pulled back in.
    expect(floatToPx({ kind: 'float', ax: 'l', ay: 't', dx: 2000, dy: 1200 }, { width: 260, height: 400 }, VIEW)).toEqual({ left: 1020, top: 320 });
  });

  it('keeps a float out of the docks when there is room, and on screen when there is not', () => {
    const topRight: FloatPlace = { kind: 'float', ax: 'r', ay: 't', dx: 16, dy: 16 };
    const size = { width: 270, height: 250 };
    // A right dock reaching 316 px in: the float moves left of it.
    expect(floatToPx(topRight, size, VIEW, { left: 0, right: 316, top: 0, bottom: 0 })).toEqual({ left: 1280 - 316 - 270, top: 16 });
    // Docks on both sides leave no room: it just stays on screen.
    expect(floatToPx(topRight, size, VIEW, { left: 600, right: 600, top: 0, bottom: 0 }).left).toBe(1280 - 16 - 270);
  });

  it('resizes a widget within limits; null goes back to the natural size', () => {
    let l = resize(resetLayout(), 'look', { w: 420, h: 300 });
    expect(l.widgets.look.size).toEqual({ w: 420, h: 300 });
    l = resize(l, 'look', { h: 5 });
    expect(l.widgets.look.size).toEqual({ w: 420, h: MIN_H });
    l = resize(l, 'look', { w: 10, h: null });
    expect(l.widgets.look.size).toEqual({ w: MIN_W, h: null });
    expect(resetWidget(l, 'look').widgets.look.size).toEqual({ w: null, h: null });
  });

  it('sizes the side docks within limits', () => {
    expect(setDockWidth(resetLayout(), 'left', 380).dockWidth).toEqual({ left: 380, right: 290 });
    expect(setDockWidth(resetLayout(), 'right', 5).dockWidth.right).toBe(DOCK_MIN);
    expect(setDockWidth(resetLayout(), 'right', 5000).dockWidth.right).toBe(DOCK_MAX);
  });

  it('switches the assistant bubble off and on; a reset brings it back', () => {
    const off = setBubbleShown(resetLayout(), false);
    expect(off.bubbleShown).toBe(false);
    expect(setBubbleShown(off, true).bubbleShown).toBe(true);
    expect(resetLayout().bubbleShown).toBe(true);
  });

  it('never closes the Hallucinate widget', () => {
    expect(() => setOpen(resetLayout(), 'hub', false)).toThrow();
    expect(setOpen(resetLayout(), 'audio', false).widgets.audio.open).toBe(false);
    expect(zoneWidgets(setOpen(resetLayout(), 'audio', false), 'left')).not.toContain('audio');
  });

  it('puts one widget back where it started', () => {
    let l = dock(resetLayout(), 'media', 'bottom', 0);
    l = resetWidget(l, 'media');
    expect(zoneWidgets(l, 'left')).toEqual(zoneWidgets(DEFAULT_LAYOUT, 'left'));
    l = dock(l, 'params', 'right', 0);
    expect(resetWidget(l, 'params').widgets.params.place).toEqual(DEFAULT_LAYOUT.widgets.params.place);
  });

  it('shows one column on phones and keeps the stored layout', () => {
    const l = moveBubble(dock(resetLayout(), 'look', 'top', 0), { left: 1000, top: 20, width: 54, height: 54 }, VIEW);
    const narrow = effective(l, true);
    expect(zoneWidgets(narrow, 'left')).toEqual([...WIDGET_IDS]);
    expect(narrow.bubble).toEqual({ kind: 'auto' });
    expect(effective(l, true).bubble).toBe(narrow.bubble);   // selected from the store: a new object each time loops
    expect(effective(l, false)).toBe(l);
  });

  it('floats the Hearing monitor where it was dropped, keeps it on phones in its corner, and puts it back on reset', () => {
    expect(DEFAULT_LAYOUT.hearing).toEqual({ kind: 'auto' });
    const l = moveHearing(resetLayout(), { left: 900, top: 400, width: 620, height: 300 }, VIEW);
    expect(l.hearing).toEqual({ kind: 'float', ax: 'r', ay: 'b', dx: 1280 - 900 - 620, dy: 720 - 400 - 300 });
    expect(effective(l, true).hearing).toEqual({ kind: 'auto' });
    expect(effective(l, true).hearing).toBe(effective(l, true).hearing);   // selected from the store: a new object each time loops
    expect(resetHearing(l).hearing).toEqual({ kind: 'auto' });
    expect(resetLayout().hearing).toEqual({ kind: 'auto' });
  });

  it('keeps each monitor where it was dropped, apart', () => {
    expect(DEFAULT_LAYOUT.log).toEqual({ kind: 'auto' });
    const l = moveMonitor(resetLayout(), 'log', { left: 40, top: 400, width: 620, height: 300 }, VIEW);
    expect(l.log).toEqual({ kind: 'float', ax: 'l', ay: 'b', dx: 40, dy: 720 - 400 - 300 });
    expect(l.hearing).toEqual({ kind: 'auto' });
    expect(effective(l, true).log).toBe(effective(l, true).hearing);
    expect(resetMonitor(l, 'log').log).toEqual({ kind: 'auto' });
    expect(parseLayout(JSON.parse(JSON.stringify(l))).log).toEqual(l.log);
    expect(parseLayout({ ...JSON.parse(JSON.stringify(l)), log: { kind: 'float' } }).log).toEqual({ kind: 'auto' });
  });

  it('opens the chat toward the room from a bubble in each corner', () => {
    const chat = { width: 400, height: 640 };
    const corners = [
      { left: 10, top: 10 }, { left: VIEW.width - 64, top: 10 }, { left: 10, top: VIEW.height - 64 }, { left: VIEW.width - 64, top: VIEW.height - 64 },
    ];
    for (const c of corners) {
      const bubble = { ...c, width: 54, height: 54 };
      const p = chatPlacement(bubble, chat, VIEW);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + chat.width).toBeLessThanOrEqual(VIEW.width - 8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(VIEW.height - 8);
      // It doesn't cover the bubble.
      const overlapsY = p.top < bubble.top + bubble.height && p.top + p.maxHeight > bubble.top;
      expect(overlapsY).toBe(false);
    }
  });
});

describe('layout storage', () => {
  it('keeps every valid entry when one is unknown, missing or broken', () => {
    const stored = JSON.parse(JSON.stringify(dock(resetLayout(), 'look', 'right', 0))) as { widgets: Record<string, unknown>; bubble: unknown };
    stored.widgets.someFutureWidget = { open: true, collapsed: false, place: { kind: 'dock', zone: 'left', order: 0 } };
    delete stored.widgets.media;
    stored.widgets.audio = { open: 'yes' };
    stored.bubble = { kind: 'float', ax: 'x' };
    const l = parseLayout(stored);
    expect(zoneWidgets(l, 'right')).toEqual(['look']);
    expect(l.widgets.media).toEqual(DEFAULT_LAYOUT.widgets.media);
    expect(l.widgets.audio).toEqual(DEFAULT_LAYOUT.widgets.audio);
    expect(l.bubble).toEqual({ kind: 'auto' });
    expect(zoneWidgets(l, 'left')).toEqual(['hub', 'source', 'media', 'audio', 'scene', 'effects', 'actions', 'screen']);
  });

  it('adds a widget newer than the stored layout at the end of its default dock', () => {
    const stored = JSON.parse(JSON.stringify(dock(resetLayout(), 'actions', 'left', 0))) as { widgets: Record<string, unknown> };
    delete stored.widgets.screen;   // saved before the Screen widget existed
    expect(zoneWidgets(parseLayout(stored), 'left')).toEqual(['actions', 'hub', 'source', 'media', 'audio', 'scene', 'look', 'effects', 'screen']);
  });

  it('keeps sizes and dock widths, and reads entries saved before sizes existed', () => {
    const stored = JSON.parse(JSON.stringify(setDockWidth(resize(resetLayout(), 'scene', { w: 333, h: 222 }), 'left', 350))) as { widgets: Record<string, { size?: unknown }>; dockWidth: unknown };
    delete stored.widgets.media!.size;
    const l = parseLayout(stored);
    expect(l.widgets.scene.size).toEqual({ w: 333, h: 222 });
    expect(l.widgets.media.size).toEqual({ w: null, h: null });
    expect(l.dockWidth.left).toBe(350);
    stored.dockWidth = 'wide';
    expect(parseLayout(stored).dockWidth).toEqual(DEFAULT_LAYOUT.dockWidth);
    expect(parseLayout({ ...stored, bubbleShown: false }).bubbleShown).toBe(false);
    expect(parseLayout({ ...stored, bubbleShown: 'no' }).bubbleShown).toBe(true);
    expect(parseLayout({ ...stored, bubbleShown: false }).bubbleShown).toBe(false);
    expect(parseLayout({ ...stored, bubbleShown: 'no' }).bubbleShown).toBe(true);
  });

  it('keeps where the Hearing monitor was dropped across a reload, and its corner for layouts saved before it moved', () => {
    const moved = moveHearing(resetLayout(), { left: 40, top: 300, width: 620, height: 300 }, VIEW);
    expect(parseLayout(JSON.parse(JSON.stringify(moved))).hearing).toEqual(moved.hearing);
    const old = JSON.parse(JSON.stringify(resetLayout())) as Record<string, unknown>;
    delete old.hearing;
    expect(parseLayout(old).hearing).toEqual({ kind: 'auto' });
    expect(parseLayout({ ...old, hearing: { kind: 'float', ax: 'up' } }).hearing).toEqual({ kind: 'auto' });
  });

  it('falls back to the default for anything that is not a layout', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ v: 2, widgets: {} })).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('nope')).toEqual(DEFAULT_LAYOUT);
  });

  it('reopens the Hallucinate widget if it was stored closed', () => {
    const stored = resetLayout();
    stored.widgets.hub.open = false;
    expect(parseLayout(stored).widgets.hub.open).toBe(true);
  });

  describe('migration', () => {
    let map: Map<string, string>;
    beforeEach(() => {
      map = new Map();
      vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k) });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("carries the Parameters overlay's old position and collapsed state over, once", () => {
      map.set(KEYS.paramsPos, JSON.stringify({ x: 400, y: 120 }));
      map.set(KEYS.paramsCollapsed, '1');
      const { layout, migrated } = loadLayout();
      expect(migrated).toBe(true);
      expect(layout.widgets.params).toEqual({ open: true, collapsed: true, place: { kind: 'float', ax: 'l', ay: 't', dx: 400, dy: 120 }, size: { w: null, h: null } });
      expect(map.has(KEYS.paramsPos)).toBe(false);
      expect(map.has(KEYS.paramsCollapsed)).toBe(false);
    });

    it('reads a stored layout and ignores the old keys', () => {
      map.set(KEYS.layout, JSON.stringify(dock(resetLayout(), 'scene', 'top', 0)));
      const { layout, migrated } = loadLayout();
      expect(migrated).toBe(false);
      expect(zoneWidgets(layout, 'top')).toEqual(['scene']);
    });

    it('starts from the default on a fresh browser', () => {
      expect(loadLayout()).toEqual({ layout: DEFAULT_LAYOUT, migrated: false });
    });
  });
});

describe('the chat window size', () => {
  it('stores a dragged size, clamped to a usable minimum; null goes back to the stylesheet\'s', () => {
    let l = resizeChat(resetLayout(), { w: 520, h: 700 });
    expect(l.chatSize).toEqual({ w: 520, h: 700 });
    l = resizeChat(l, { w: 10 });
    expect(l.chatSize).toEqual({ w: CHAT_MIN_W, h: 700 });
    l = resizeChat(l, { h: 5 });
    expect(l.chatSize.h).toBe(CHAT_MIN_H);
    expect(resizeChat(l, { w: null, h: null }).chatSize).toEqual({ w: null, h: null });
    expect(resetLayout().chatSize).toEqual({ w: null, h: null });
  });

  it('is kept across a reload, falls back when broken, and phones use the natural size', () => {
    const stored = JSON.parse(JSON.stringify(resizeChat(resetLayout(), { w: 480, h: 600 })));
    expect(parseLayout(stored).chatSize).toEqual({ w: 480, h: 600 });
    expect(parseLayout({ ...stored, chatSize: { w: 'wide' } }).chatSize).toEqual({ w: null, h: null });
    const { chatSize: _gone, ...older } = stored;
    expect(parseLayout(older).chatSize).toEqual({ w: null, h: null });   // written before the chat could be resized
    expect(effective(parseLayout(stored), true).chatSize).toEqual({ w: null, h: null });
  });

  it('grows away from a moved bubble, so the grip sits on that corner', () => {
    const chat = { width: 400, height: 500 };
    expect(chatPlacement({ left: 20, top: 640, width: 54, height: 54 }, chat, VIEW)).toMatchObject({ growX: 'right', growY: 'up' });
    expect(chatPlacement({ left: 1200, top: 20, width: 54, height: 54 }, chat, VIEW)).toMatchObject({ growX: 'left', growY: 'down' });
  });
});

describe('where a dragged widget lands', () => {
  const none: DockView = { rect: null, occupied: false, items: [] };
  const widths = { left: 300, right: 280 };
  // The left dock holds two widgets, 100 px tall, one under the other; the rest are empty.
  const docks = (left: Partial<DockView> = {}): Record<'left' | 'right' | 'top' | 'bottom', DockView> => ({
    left: { rect: { left: 16, top: 16, width: 300, height: 220 }, occupied: true, items: [{ left: 16, top: 16, width: 300, height: 100 }, { left: 16, top: 126, width: 300, height: 100 }], ...left },
    right: none, top: none, bottom: none,
  });

  it('floats away from the edges and the docks', () => {
    expect(dropTarget(640, 360, docks(), VIEW, widths)).toEqual({ kind: 'float' });
  });

  it('docks at the nearest edge it is close to, previewing the whole of an empty dock', () => {
    expect(dropTarget(VIEW.width - 10, 300, docks(), VIEW, widths)).toEqual({ kind: 'dock', zone: 'right', index: 0, line: false, preview: { left: VIEW.width - 16 - 280, top: 16, width: 280, height: VIEW.height - 32 } });
    expect(dropTarget(VIEW.width - 10, VIEW.height - 5, docks(), VIEW, widths)).toMatchObject({ zone: 'bottom' });   // the nearer edge
    expect(dropTarget(640, DROP_EDGE + 1, docks(), VIEW, widths)).toEqual({ kind: 'float' });
  });

  it('runs a top row between the side docks that hold something', () => {
    const t = dropTarget(640, 10, docks(), VIEW, widths);
    expect(t).toMatchObject({ zone: 'top', preview: { left: 16 + 300 + 16, top: 16, width: VIEW.width - 16 - (16 + 300 + 16), height: 140 } });
  });

  it('inside a dock with widgets, goes before the first one whose middle is past the pointer, with a line', () => {
    expect(dropTarget(150, 60, docks(), VIEW, widths)).toEqual({ kind: 'dock', zone: 'left', index: 0, line: true, preview: { left: 16, top: 16 - 4 - 3, width: 300, height: 3 } });
    expect(dropTarget(150, 140, docks(), VIEW, widths)).toMatchObject({ index: 1 });
    expect(dropTarget(150, 200, docks(), VIEW, widths)).toMatchObject({ index: 2, preview: { top: 226 + 4 } });   // after the last
  });

  it('counts a dock whose only widget is the dragged one as empty', () => {
    const t = dropTarget(10, 300, docks({ items: [] }), VIEW, widths);
    expect(t).toMatchObject({ zone: 'left', index: 0, line: false });
  });
});

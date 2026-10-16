// Scene library: browse every scene with a rendered preview, filter by category or search,
// mark favourites, choose which scenes auto-switch rotates through, and keep your own shaders.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useUI } from '../app/AppContext';
import { encodeJpeg } from '../engine/jpeg';
import { stillUniforms } from '../engine/scene-inputs';
import { CATEGORIES, type Scene } from '../engine/scenes';
import { HOTKEYS } from '../hotkeys/registry';
import { useHotkeyActions } from '../hooks/useAppHotkeys';
import { Kbd } from '../hotkeys/Kbd';
import { inRotation, isFav, listedScenes, togglePref } from '../state/library-prefs';
import { HelpButton } from './Help';

// Stand-in audio for the previews, so they look like the scene mid-song rather than silent.
const THUMB_UNIFORMS = stillUniforms();
const SPECIAL = ['All', '★ Favourites', '⚙ Tweakable'];

interface Thumb { url: string; frag: string; mediaVersion: number }

const toBlobUrl = async (img: ImageData): Promise<string> => URL.createObjectURL(await encodeJpeg(img, 0.85));

export function Library({ onEdit }: { onEdit: (index: number) => void }) {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'library');
  const current = useUI((ui) => ui.sceneIndex);
  const version = useUI((ui) => ui.sceneVersion);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(-1);   // index into `shown`, moved with the arrow keys
  const grid = useRef<HTMLUListElement>(null);
  const [thumbs, setThumbs] = useState(() => new Map<Scene, Thumb>());
  const search = useRef<HTMLInputElement>(null);
  const prefs = app.libraryPrefs;

  const all = useMemo(() => listedScenes(app.state.scenes), [app, version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hasMine = all.some(({ s }) => s.user);
  const tabs = ['All', '★ Favourites', '⚙ Tweakable', ...CATEGORIES, 'Game', ...(hasMine ? ['Mine'] : [])];
  const activeFilter = tabs.includes(filter) ? filter : 'All';
  const q = query.trim().toLowerCase();
  const shown = all.filter(({ s }) => {
    if (activeFilter === '★ Favourites' && !isFav(prefs, s)) return false;
    if (activeFilter === '⚙ Tweakable' && !s.params?.length) return false;
    if (!SPECIAL.includes(activeFilter) && s.cat !== activeFilter) return false;
    return !q || `${s.name} ${s.cat} ${s.desc}`.toLowerCase().includes(q);
  });
  const rotating = all.filter(({ s }) => !s.kind && inRotation(prefs, s)).length;

  // Previews render a couple at a time so opening the library doesn't stall the visuals. A preview
  // is redone when the scene's code changed, or the media changed for a scene that samples it.
  // Each batch updates `thumbs`, which re-runs this effect for the next batch. The effect follows
  // which previews are missing, not every render, so hovering a card doesn't restart a batch.
  const stale = (s: Scene, i: number) => {
    const t = thumbs.get(s);
    return !t || t.frag !== s.frag || (app.renderer.usesMedia(i) && t.mediaVersion !== app.media.version);
  };
  const missing = open ? shown.filter(({ s, i }) => stale(s, i)).slice(0, 2) : [];
  const missingKey = missing.map(({ s, i }) => `${i}:${s.frag.length}:${app.media.version}`).join(',');
  useEffect(() => {
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async ({ s, i }) => {
      const frag = s.frag, mediaVersion = app.media.version;
      try {
        const url = await toBlobUrl(await app.renderer.snapshotAsync(i, THUMB_UNIFORMS));
        if (cancelled) { URL.revokeObjectURL(url); return null; }
        return [s, { url, frag, mediaVersion }] as const;
      } catch { return null; }   // renderer busy or gone
    })).then((done) => {
      if (cancelled) return;
      const entries = done.filter((d): d is readonly [Scene, Thumb] => d !== null);
      if (!entries.length) return;
      setThumbs((prev) => {
        const next = new Map(prev);
        for (const [s, t] of entries) { const old = next.get(s); if (old) URL.revokeObjectURL(old.url); next.set(s, t); }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [missingKey, thumbs, app]);   // eslint-disable-line react-hooks/exhaustive-deps -- `missing` is what `missingKey` names

  const pick = (i: number) => { app.setScene(i); app.setOverlay(null); };

  // Keyboard: `/` focuses the search, arrows move through the hits (up/down by a grid row), Enter plays.
  const shownRef = useRef(shown);
  const focusedRef = useRef(focused);
  const tabsRef = useRef({ tabs, activeFilter });
  useEffect(() => { shownRef.current = shown; focusedRef.current = focused; tabsRef.current = { tabs, activeFilter }; });
  // Escape leaves the search field first; a second Escape closes the library.
  useEffect(() => app.setHooks({ escape: () => { if (document.activeElement === search.current) { search.current?.blur(); return true; } return false; } }), [app]);
  const move = (dx: number, dy: number) => {
    const cards = grid.current ? [...grid.current.querySelectorAll<HTMLElement>('.lib-card')] : [];
    const columns = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]?.offsetTop).length);
    const n = shownRef.current.length;
    if (!n) return;
    const cur = focusedRef.current;
    const next = cur < 0 ? 0 : Math.min(n - 1, Math.max(0, cur + dx + dy * columns));
    setFocused(next);
    cards[next]?.scrollIntoView({ block: 'nearest' });
  };
  const tab = (dir: number) => {
    const { tabs, activeFilter } = tabsRef.current;
    const i = tabs.indexOf(activeFilter);
    setFilter(tabs[(i + dir + tabs.length) % tabs.length]!);
    setFocused(-1);
  };
  useHotkeyActions<'library'>({
    librarySearch: () => { search.current?.focus(); search.current?.select(); },
    libraryLeft: () => move(-1, 0),
    libraryRight: () => move(1, 0),
    libraryUp: () => move(0, -1),
    libraryDown: () => move(0, 1),
    libraryPick: () => {
      const list = shownRef.current;
      const i = focusedRef.current >= 0 ? focusedRef.current : 0;
      const hit = list[i];
      if (hit) pick(hit.i);
    },
    libraryTabNext: () => tab(1),
    libraryTabPrev: () => tab(-1),
  });
  const remove = (i: number) => {
    const s = app.state.scenes[i]!;
    if (!confirm(`Delete "${s.name}" from the library?`)) return;
    app.library.remove(i);
  };

  return (
    <section id="library" className="library" hidden={!open}>
      <header>
        <strong>Scene library</strong>
        <input id="lib-search" ref={search} type="search" placeholder="Search scenes…" autoComplete="off" value={query}
          onChange={(e) => { setQuery(e.target.value); setFocused(-1); if (e.target.value.trim()) setFilter('All'); }} />
        <Kbd hotkey={HOTKEYS.librarySearch} />
        <HelpButton topic="library" />
        <button id="lib-close" className="icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <nav id="lib-filters" className="lib-filters">
        {tabs.map((tab) => <button key={tab} className={tab === activeFilter ? 'active' : undefined} onClick={() => { setFilter(tab); setFocused(-1); }}>{tab}</button>)}
      </nav>
      <p id="lib-count" className="lib-count">
        {shown.length} of {all.length} scenes · {rotating} in auto-switch rotation
        <span className="lib-nav"><Kbd hotkey={HOTKEYS.libraryLeft} /><Kbd hotkey={HOTKEYS.libraryUp} /><Kbd hotkey={HOTKEYS.libraryDown} /><Kbd hotkey={HOTKEYS.libraryRight} /> move · <Kbd hotkey={HOTKEYS.libraryPick} /> play · <Kbd hotkey={HOTKEYS.libraryTabNext} /> category</span>
      </p>
      <Parked />
      <ul id="lib-grid" className="lib-grid" ref={grid}>
        {shown.map(({ s, i }, n) => (
          <li key={s.id} className={`lib-card${i === current ? ' active' : ''}${n === focused ? ' focused' : ''}${!s.kind && !inRotation(prefs, s) ? ' off' : ''}`} data-index={i}
            onPointerEnter={() => setFocused(n)}>
            <button className="lib-thumb" title={`Play ${s.name}`} onClick={() => pick(i)}>
              <img alt="" src={thumbs.get(s)?.url} />
              {app.keyFor(i) && <Kbd hotkey={app.keyFor(i) as 'G'} title={`Press ${app.keyFor(i)}`} />}
              {s.params?.length ? <span className="lib-live" title={`Live parameters (P): ${s.params.map((p) => p.label).join(', ')}`}>⚙ {s.params.length}</span> : null}
            </button>
            <div className="lib-info">
              <div className="lib-head">
                <strong>{s.name}</strong>
                <button className={`lib-fav${isFav(prefs, s) ? ' on' : ''}`} title={isFav(prefs, s) ? 'Remove from favourites' : 'Favourite — comes up twice as often in auto-switch'}
                  onClick={() => app.setLibraryPrefs(togglePref(prefs, 'favs', s))}>{isFav(prefs, s) ? '★' : '☆'}</button>
              </div>
              <span>{s.cat} · {s.desc}{s.edited ? ' · edited by you' : ''}</span>
            </div>
            <div className="lib-tools">
              {!s.kind && (
                <>
                  <label title="Include this scene when auto-switch picks the next one">
                    <input type="checkbox" checked={inRotation(prefs, s)} onChange={() => app.setLibraryPrefs(togglePref(prefs, 'off', s))} /> Auto-switch
                  </label>
                  <button title="Play this scene and open its code (E)" onClick={() => onEdit(i)}>Edit code<Kbd hotkey={HOTKEYS.editor} /></button>
                </>
              )}
              {s.user && <button title="Delete this scene from the library" onClick={() => remove(i)}>Delete</button>}
            </div>
          </li>
        ))}
        {!shown.length && <p className="lib-empty">No scenes match.</p>}
      </ul>
    </section>
  );
}

// Saved scenes and edits that didn't compile on this device (another GPU or app version). They stay
// stored until deleted here; a scene can be loaded into "My Shader" to fix it.
function Parked() {
  const app = useApp();
  useUI((ui) => ui.sceneVersion);   // re-render when the parked set changes
  const { userScenes, sceneEdits } = app.library.parked;
  const edits = Object.keys(sceneEdits);
  if (!userScenes.length && !edits.length) return null;
  return (
    <section id="lib-parked" className="lib-parked" aria-label="Doesn't compile here">
      <strong>Doesn't compile here</strong>
      <p>These were saved elsewhere or by an older version. They're kept until you delete them.</p>
      <ul>
        {userScenes.map(({ name }) => (
          <li key={`scene:${name}`} data-parked-scene={name}>
            <span>{name}</span>
            <button title="Load it into My Shader to fix it, then Save to library under the same name" onClick={() => app.openParkedInEditor(name)}>Fix in editor</button>
            <button onClick={() => { if (confirm(`Delete "${name}" for good?`)) app.library.discardParked('scene', name); }}>Delete</button>
          </li>
        ))}
        {edits.map((name) => (
          <li key={`edit:${name}`} data-parked-edit={name}>
            <span>Your edit of {name}</span>
            <button onClick={() => { if (confirm(`Discard your edit of "${name}"?`)) app.library.discardParked('edit', name); }}>Discard edit</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

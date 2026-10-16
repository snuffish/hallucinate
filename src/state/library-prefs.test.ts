import { describe, expect, it } from 'vitest';
import { scene, type Scene } from '../scenes';
import { libraryTabs, rotation } from './library-prefs';
import { userScene } from './scene-list';

const body = 'void main() { fragColor = vec4(1.); }';
const slot = (kind: 'custom' | 'nodes'): Scene => ({ id: kind, name: kind, kind, cat: '', desc: '', body, frag: body, params: [] });
const noPrefs = { favs: [], off: [] };

describe('library tabs', () => {
  it('shows a category tab only when it has scenes, in category order', () => {
    const scenes = [scene('Grid', 'Geometry', '', body), scene('Lasers', 'Beams', '', body), slot('custom')];
    expect(libraryTabs(scenes)).toEqual(['All', '★ Favourites', '⚙ Tweakable', 'Beams', 'Geometry']);
  });

  it('adds Mine when you have saved scenes, and ignores removed ones', () => {
    const gone = { ...scene('Fog', 'Fields', '', body), removed: true };
    expect(libraryTabs([gone, slot('custom'), userScene('Neon', body)])).toEqual(['All', '★ Favourites', '⚙ Tweakable', 'Mine']);
  });

  it('has only the special tabs when there are no scenes to list', () => {
    expect(libraryTabs([slot('custom'), slot('nodes')])).toEqual(['All', '★ Favourites', '⚙ Tweakable']);
  });
});

describe('auto-switch rotation', () => {
  it('is empty when only the editor slots exist', () => {
    expect(rotation([slot('custom'), slot('nodes')], noPrefs)).toEqual([]);
  });
});

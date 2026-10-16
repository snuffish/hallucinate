# 🎬 Scenes & the library

[← Back to the README](../README.md)

## Scenes

The built-in scenes are a **laser show**: thin luminous lines, beams and points on pure black (see
[ADR 0001](adr/0001-replace-all-built-in-scenes.md)). Every one reacts to the kicks, the ticks of the tempo and the
bands, takes its colour from the hue slider and colour cycling, and keeps the background pure black. A kick never
brightens more than a quarter of the frame. The set is still growing; the number keys play them in this order:

| Key | Scene | Category | What it does |
| --- | --- | --- | --- |
| 1 | **Beam Fan** | Beams | A fan of thin beams rising from the bottom edge. It sweeps, opens with the bass, strobes on kicks and chases one beam along on each tick. |

They come in four categories: **Beams · Geometry · Fields · Media**; the library shows a category only once it has
scenes. You can also play the [Node Scene](visual-maker.md), **My Shader** and your own saved scenes (*Mine*).

A show you saved that uses a removed scene keeps that show scene, marked *missing scene* in the [Studio](studio.md):
taking it only shows a message, and the autopilot and the director skip it.

With *Auto-switch* on (A), scenes crossfade every 32 detected beats (or 45 s), picking from the scenes in rotation.

## 📚 Scene library — press L

<img src="screenshots/library.jpg" alt="The scene library: every scene as a card with a rendered preview, category filters and search" width="100%">

Every scene as a card with a rendered preview. Filter by category or search, then click a preview to play it.

- **★ Favourite** – favourites come up twice as often in auto-switch.
- **Auto-switch** checkbox – take a scene out of (or back into) the rotation.
- **Edit code** – opens the scene's source in the [code editor](editor.md) to remix.
- In the code editor, **Save to library** stores your shader as a scene (category *Mine*). It joins the rotation,
  survives reloads, and can be overwritten by saving under the same name or deleted from its card.
- **Doesn't compile here** – scenes that don't compile on this computer; see [Back up & move your setup](backup.md#shaders-that-dont-compile-here).

Keyboard, with the library open: `/` jumps to the search box (`Esc` leaves it, a second `Esc` closes the library),
`Tab` / `Shift+Tab` cycle the categories, `←` `↑` `↓` `→` move through the hits (also while typing), `Enter` plays the
highlighted scene, `1`–`9` and `0` play the first ten scenes (built-ins first, then yours) as everywhere else.

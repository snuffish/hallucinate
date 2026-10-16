# 🎬 Scenes & the library

[← Back to the README](../README.md)

## Scenes

40 visual scenes in seven categories (Fractal · Tunnel & 3D · Geometric · Organic · Spectrum · Space · Media). Every
scene has [live parameters](editor.md#-live-parameters--press-p) suited to it — speeds, counts, sizes, colours and
on/off layers (press P); their defaults are the scene's original look:
Kaleido Fractal · Hyper Tunnel · Mandala Bloom · Liquid Plasma · Gyroid Cave · Wave Orbits · Julia Morph · Voronoi Glass · Hex Pulse ·
Aurora Veil · Radial EQ · Oscilloscope · Truchet Weave · Moiré Bloom · Hyperspace · Menger Halls · Flower of Life ·
Quasicrystal · Tumbling Blocks · Polygon Tunnel · Op Art Lens · Tesseract · Spirograph ·
Lissajous Knot · Mirror Kaleidoscope · Retro Plasma · Starfield · Sunburst · Lava Lamp · the seven
[Media scenes](media.md), plus four written from techniques made famous on Shadertoy (own implementations, not copied code):

| Scene | Technique | Inspired by |
| --- | --- | --- |
| Neon Loop | repeated `fract()` folding + inverse-distance neon glow | kishimisu, *An introduction to Shader Art Coding* |
| Star Nest | volumetric march through a tiled 3D Kali fractal | Kali, *Star Nest* |
| Neon Jacks | glow accumulation while raymarching repeated shapes | *Phantom Star* / *Octagrams* style |
| Liquid Blobs | smooth-min metaballs; bass melts them, spectrum sizes them | *Audio Reactive Liquid Blobs* |

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
highlighted scene, `1`–`9` and `0` play the first ten scenes as everywhere else.

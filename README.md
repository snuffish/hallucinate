# Hallucinate

Psychedelic, audio-reactive visuals generated in real time with WebGL2 shaders. Built with [Vite](https://vite.dev); no runtime dependencies.

```sh
npm install
npm run dev      # → http://localhost:5173, with hot reload (localhost only; HOST=0.0.0.0 exposes it, PORT changes the port)
npm run build    # → dist/
npm run preview  # serve the built app (the SoundCloud bridge works here too)
```

## Audio sources
- **File** – click *Open audio file* or drag & drop any mp3/wav/flac/ogg/m4a onto the page.
- **SoundCloud** – search SoundCloud, or paste a track / playlist / artist link, and click a result.
  The picker opens on your *recently played* tracks (last 25; *Recent* brings the list back, *Clear history* forgets it),
  so you can replay one without searching again. Results play in order like a queue. Needs [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed
  (`sudo pacman -S yt-dlp` or `pip install yt-dlp`): the local server fetches the track into a temp cache
  (`$TMPDIR/hallucinate-soundcloud`) so the browser can analyse it, which SoundCloud's own embedded player doesn't allow.
  Some tracks (SoundCloud Go+ / region-locked) can't be fetched. For personal use; respect artists' rights.
- **Microphone / line-in** – reacts to whatever the mic hears.
- **Tab / system audio** – share a browser tab (Spotify web, YouTube, SoundCloud…) or your screen and tick *Share audio* (Chromium-based browsers).
- **Demo beat** – a built-in synthesised techno loop.

## Audio player
Files and SoundCloud tracks get a player in the panel: seek bar, play/pause, ±10 s, previous / next track
(SoundCloud results act as the queue; ⏮ restarts the track after 3 s), loop, volume and mute, and **tempo**
from 0.5× to 2× (click the value or double-click the slider to reset). By default tempo keeps the pitch;
tick *Pitch follows tempo* for a vinyl / nightcore effect. The demo beat gets play/pause, volume and tempo (its BPM).
Volume is applied after the analyser, so the visuals react the same at any listening volume, even when muted.

## Synesthesia (sound ↔ light mapping)
Based on crossmodal-correspondence research (people reliably pair loud ↔ bright, high/bright timbre ↔ light and
warm, low/muffled ↔ dark and cool, fast/energetic music ↔ saturated warm colours).

- **Tone** – the spectral centroid (loudness-weighted average frequency) mapped from ~1.1 kHz (dark: piano,
  ambient) to ~5.5 kHz (bright: hi-hat-heavy house, psytrance) and smoothed over a few seconds. Shown in the panel.
- **Mood** – tempo (80 → 160 BPM) plus overall energy, smoothed over ~4 s. Toggle with *Mood from tempo*.
- **Synesthesia slider** – how strongly they grade every scene: dark sound → dimmer, cooler, hazier, longer trails;
  bright sound → lighter, warmer, crisper, more colour fringing; energetic mood → more saturated and warmer.
- Both values are also available to your own shaders (`uBright`, `uMood`) and as *tone* / *mood* outputs on the
  visual maker's Audio block.

## Scenes
40 visual scenes in seven categories (Fractal · Tunnel & 3D · Geometric · Organic · Spectrum · Space · Media). Every
scene has live parameters suited to it — speeds, counts, sizes, colours and on/off layers (press P); their defaults are
the scene's original look:
Kaleido Fractal · Hyper Tunnel · Mandala Bloom · Liquid Plasma · Gyroid Cave · Wave Orbits · Julia Morph · Voronoi Glass · Hex Pulse ·
Aurora Veil · Radial EQ · Oscilloscope · Truchet Weave · Moiré Bloom · Hyperspace · Menger Halls · Flower of Life ·
Quasicrystal · Tumbling Blocks · Polygon Tunnel · Op Art Lens · Tesseract · Spirograph ·
Lissajous Knot · Mirror Kaleidoscope · Retro Plasma · Starfield · Sunburst · Lava Lamp · the seven Media scenes below,
plus four written from techniques made famous on Shadertoy (own implementations, not copied code):

| Scene | Technique | Inspired by |
| --- | --- | --- |
| Neon Loop | repeated `fract()` folding + inverse-distance neon glow | kishimisu, *An introduction to Shader Art Coding* |
| Star Nest | volumetric march through a tiled 3D Kali fractal | Kali, *Star Nest* |
| Neon Jacks | glow accumulation while raymarching repeated shapes | *Phantom Star* / *Octagrams* style |
| Liquid Blobs | smooth-min metaballs; bass melts them, spectrum sizes them | *Audio Reactive Liquid Blobs* |

With *Auto-switch* on, scenes crossfade every 32 detected beats (or 45 s), picking from the scenes in rotation.

## Scene library — press L
Every scene as a card with a rendered preview. Filter by category or search, then click a preview to play it.
- **★ Favourite** – favourites come up twice as often in auto-switch.
- **Auto-switch** checkbox – take a scene out of (or back into) the rotation.
- **Edit copy** – opens the scene's source in the code editor to remix.
- In the code editor, **Save to library** stores your shader as a scene (category *Mine*). It joins the rotation,
  survives reloads, and can be overwritten by saving under the same name or deleted from its card.

## Beat Racer (game) — press G
A synthwave racer driven by your music: walls drop on every detected beat, the mountains are the live spectrum.
Steer with ← / →, dodge walls (+1 × multiplier), grab orbs (+10 × multiplier). The multiplier grows every 8 in a row; 3 lives; Enter restarts. Best score is remembered.

## Code your own — press E
Opens the code of **the scene that's playing** in a live GLSL editor, and edits it in place. It recompiles as you type,
shows errors with line numbers (the last working version keeps running), and saves automatically in the browser.
While it's open the editor follows the scene on screen (← / →, the library…) and auto-switch holds still.

- **Built-in scenes:** your edits are kept as your version of the scene (its library card says *edited by you*);
  *Revert to original* brings the original back.
- **Your library scenes** save straight back to the library. **My Shader** is your scratch scene.
- **Visual-maker scenes** are generated from the graph, so they open read-only; *Edit a copy* puts the code in My Shader.
- *Start from…* replaces the code with a blank template or any built-in scene's original; *Save to library* saves the
  code as a new scene. The *Cheat sheet* lists the audio uniforms and helpers. In the library, *Edit code* plays a scene
  and opens it here.

## Live parameters — press P
Expose values and constants as controls in an overlay on the scene, and tweak them while it runs (no recompiling).
In the code editor, tag a top-level `uniform` or `const` with `// @param`:

```glsl
uniform float uGlow;                 // @param min=0 max=3 default=1 label="Glow"
const float RINGS = 30.;             // @param min=5 max=80 int
const vec3 TINT = vec3(1., .3, .8);  // @param color
uniform bool uMirror;                // @param default=true
uniform vec2 uCentre;                // @param min=-.5 max=.5
```

Types: `float` (slider + number), `bool` (checkbox), `vec2`/`vec3`/`vec4` (a slider per component, or a colour picker
with `color`). Options: `min max step default label int color`. In the visual maker, use the **Slider** and
**Colour picker** blocks — they become the same annotated uniforms, so *Send to code* and *Save to library* keep them.
Values are remembered per scene; if you change a `default` in the code, the new default takes over. Double-click a slider
to reset it, *Reset* resets them all, P collapses the overlay. Drag the overlay by its title bar to put it anywhere (it
remembers the spot); double-click the title bar to send it back to the corner. Inside the studio it's a dock.

## Media — drop an image or video
Drop any image (png, jpg, gif, webp…) or video (mp4, webm, mov…) on the page, or use *Open image / video* in the panel's
Media section. Every scene can sample it; the **Media** scenes are built for it, each with live parameters:

| Scene | What it does |
| --- | --- |
| Media Kaleidoscope | mirrors it into 0–16 segments, zoom / spin |
| Media Liquid | flowing noise warp, colour split, optional swirl |
| Media Glitch | datamosh-style row shifts, RGB split, corrupted blocks, scanlines; bursts on the beat |
| Media Halftone | print-style dots (ink on paper, or colour dots) |
| Media Ripple | water ripples from a movable drop point |
| Media Droste | endless zoom into copies of itself, with optional spiral arms |
| Media Neon Edges | its outlines as glowing (rainbow) neon |

**YouTube:** *YouTube* in the Media section searches YouTube (or paste a video, playlist or Shorts link) and remembers
the videos you used. The local server fetches the video with yt-dlp (up to 720p; needs ffmpeg to merge picture and
sound) into a temp cache, so the first load of a long video takes a moment and later ones are instant. Live streams
aren't supported. Downloads show live progress (percentage, size, speed, time left) in the picker and at the top of
the panel — also for SoundCloud — and × cancels; a cancelled download resumes where it stopped next time.

Videos loop, muted (the music drives the visuals). Tick **Use the video's sound as the music** (Media section or the
YouTube picker) to make a video — e.g. a music video — the audio source: the player then controls it (seek, tempo,
volume), the picture follows, and a YouTube result list continues with the next video when one ends. In code, `media(p)` returns the picture at a centered position —
it fills the screen and is mirrored beyond its edges, so warped coordinates never run out — and `untone(col)` shows it in
its true colours. In the visual maker use the **Media** block (see the *Media warp* example). Projector windows get the
file itself and play it in sync, at full quality.

## Studio & projector — press O
Run a show like OBS's Studio Mode and put it on a projector.

1. **Build the show.** *+ Add scene…* adds any library scene, or *What's on Program now* (the current scene,
   its live parameter values and the look sliders). Rename, reorder (▲▼), duplicate, and use ⤓ *Update from Program*
   to store a look you've just tweaked live.
2. **Preview → Program.** Click a show scene (or 1–9, ←/→) to put it in **Preview**, then **Take** (T) sends it to
   **Program** with a *Cut* or a *Fade* (0.2–8 s). Double-click a scene to take it straight away. Preview then moves on
   to the next scene, so you can keep pressing T.
3. **Projector.** *Detect displays* (asks once for the browser's *window management* permission, Chrome/Edge),
   pick the projector, *Open projector*, then double-click that window (or press F there) for fullscreen.
   The projector renders the show itself at its own resolution — it isn't a scaled-down video — and follows
   live code / visual-maker edits. *Identify* shows each projector's resolution on it. Without display access, open it
   as a normal window and drag it onto the projector.
4. **Master / Blackout** (B) fades Program and every projector to black and back, over the fade time.
5. **Autopilot** steps through the show every 16 / 32 / 64 / 128 beats (random auto-switch pauses while it's on).

While the studio is open the main canvas is the Program monitor and the Parameters overlay becomes a dock. Like OBS's
Studio Mode, the dock edits the **selected (Preview) show scene** by default — tweaks show on the Preview monitor, are
saved in that show scene and go live when you Take it — and its *Program* tab edits what's live. The show is
saved in the browser. The projector must run in the same browser on the same computer (e.g. an extended display);
keep the main window open (not minimised) — it drives the projector. To stream or record, capture the projector window
in OBS (*Window Capture*), or use *Record* here.

## Visual maker — press N
Build scenes by wiring blocks together instead of writing code. Pick blocks from the left
(Input · Coordinates · Pattern · Math · Color), drag from an output ● to an input ● to connect them, and type
numbers straight into unconnected inputs. The result renders live behind the graph (*Peek* hides the graph).
Wires are colour-coded by type (white = number, cyan = position, pink = colour); mismatched types are converted
automatically. *Examples…* loads ready-made graphs, and *Send to code* turns the graph into GLSL in the code editor
so you can keep going by hand. Graphs save automatically.

## Keys
| Key | Action |
| --- | --- |
| Space | play / pause |
| Shift + ← / → | seek −10 s / +10 s |
| ↑ / ↓ | volume |
| [ / ] | tempo −5 % / +5 % |
| M | mute |
| ← / → , 1–9, 0 | change scene (← / → steer in the game) |
| L | scene library |
| O | studio & projector (inside: 1–9 / ← → preview, T take, Esc close) |
| T | take Preview live |
| B | blackout / restore |
| P | collapse / expand the Parameters overlay |
| G | Beat Racer |
| E | shader editor |
| N | visual maker (node graph) |
| A | toggle auto-switch |
| R | randomize look |
| C | start / stop recording (downloads a .webm with audio) |
| F | fullscreen |
| H | hide panel (also auto-hides after 3 s of no mouse movement) |

Sliders: reactivity, speed, trails (feedback), colour, colour cycling, chromatic aberration and render resolution (lower it if frames drop).

## How it works
- `vite.config.js` – dev/preview server config; mounts the SoundCloud bridge as middleware.
- `server/ytdlp-bridge.js` – the yt-dlp bridges for SoundCloud audio and YouTube video (search, fetch into a temp cache,
  serve with seeking); mounted by `vite.config.js`.
  Set `YTDLP=/path/to/yt-dlp` if it isn't on your PATH.
- `src/audio.js` – Web Audio `AnalyserNode` → adaptive bass/mid/high energies, beat detection and a 256-texel spectrum + waveform texture.
- `src/scenes.js` – one GLSL fragment shader per scene, sharing the audio uniforms.
- `src/renderer.js` – scene pass → feedback pass (zoom/rotate/hue-shift of the previous frame for trails) → display pass (tonemap, chromatic aberration, vignette).
- `src/game.js` – Beat Racer state (lanes, spawning on beats, collisions, score).
- `src/editor.js` – live shader editor.
- `src/media.js` – the dropped image / video (loaded once per window, uploaded as the `uMedia` texture).
- `src/studio.js` – studio mode: show scenes, preview/program, transitions, autopilot, master/blackout.
- `src/output-link.js` / `output.html` / `src/output.js` – projector windows: the main window broadcasts scene shaders
  and per-frame render state over a `BroadcastChannel`; each projector renders it at its own resolution.
- `src/params.js` / `src/param-panel.js` – `@param` parsing, per-scene values, and the Parameters overlay.
- `src/library.js` – scene library (previews, favourites, rotation, saved user scenes).
- `src/nodes.js` – visual maker block types, example graphs and the graph → GLSL compiler.
- `src/node-editor.js` – visual maker canvas (blocks, wires, pan/zoom).
- `src/remote-picker.js` – SoundCloud / YouTube search, queue and recently-played UI.
- `src/player.js` – panel audio player (transport, volume, tempo).
- `src/main.js` – UI, audio-driven clock, scene transitions, recording.

Adding a scene = add a `scene(name, category, description, glsl)` line to `SCENES` in `src/scenes.js`.

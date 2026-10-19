# 🧑‍💻 Code editor & live parameters

[← Back to the README](../README.md)

## Code your own — press E

<img src="screenshots/editor.jpg" alt="The live GLSL editor next to the scene it edits" width="100%">

Opens the code of **the scene that's playing** in a live GLSL editor, and edits it in place. It recompiles as you type
— in the background, so the visuals never freeze — shows errors with line numbers (the last working version keeps
running), and saves automatically in the browser. While it's open the editor follows the scene on screen
(← / →, the library…) and auto-switch holds still.

- **Built-in scenes:** your edits are kept as your version of the scene (its library card says *edited by you*);
  *Revert to original* brings the original back.
- **Your library scenes** save straight back to the library. **My Shader** is your scratch scene.
- **Visual-maker scenes** are generated from the graph, so they open read-only; *Edit a copy* puts the code in My Shader.
- *Start from…* replaces the code with a blank template or any built-in scene's original; *Save to library* saves the
  code as a new scene. The *Cheat sheet* lists the audio uniforms and helpers. In the library, *Edit code* plays a scene
  and opens it here.

## History

**History** in the editor lists the versions of the scene's code, newest first, and who made each: you, the
✦ assistant (with the conversation it came from: click it to open that chat), *Start from…*, *Revert to original*,
*Save to library* over an existing scene, or a restore. Click a version to see how the code changed since, and
*Restore this version* to bring it back. A restore is a version too, so the code you had stays in the list.

A version is kept before and after every change that isn't your typing, so the assistant's edits, templates and
reverts can always be gone back on. Your own typing is saved as you go and folds into one version until you pause for
about a minute. Each scene keeps its last 50 versions (your typing goes first when it's trimmed). History stays on this
computer: it isn't part of an [export](backup.md).

## 🎛 Live parameters — press P

<img src="screenshots/params-groups.jpg" alt="A scene with its parameters in folding groups, some open and some folded" width="100%">

Expose values and constants as controls in the Parameters widget, and tweak them while the scene runs (no
recompiling). In the code editor, tag a top-level `uniform` or `const` with `// @param`:

```glsl
uniform float uGlow;                 // @param min=0 max=3 default=1 label="Glow"
const float RINGS = 30.;             // @param min=5 max=80 int
const vec3 TINT = vec3(1., .3, .8);  // @param color
uniform bool uMirror;                // @param default=true
uniform vec2 uCentre;                // @param min=-.5 max=.5
```

**Types:** `float` (slider + number), `bool` (checkbox), `vec2`/`vec3`/`vec4` (a slider per component, or a colour
picker with `color`).

**Options:** `min max step default label int color group`.

**Groups:** a `// @group Name` line puts the controls after it under a heading that starts folded and opens with a
click (until the next `@group`; a bare `// @group` ends grouping), which keeps a long list tidy. `group="Name"` on a
single `@param` line overrides it. Which groups are open is remembered per scene, and ⊟ / ⊞ in the header folds or
unfolds them all.

**In the visual maker,** use the **Slider** and **Colour picker** blocks — they become the same annotated uniforms, so
*Send to code* and *Save to library* keep them.

Values are remembered per scene; if you change a `default` in the code, the new default takes over. Double-click a
slider to reset it, *Reset* resets them all, P collapses the Parameters widget. Like every widget, it can be docked or
floated anywhere (see [Widgets & layout](interface.md)). It appears once a source plays; inside the
[studio](studio.md) it becomes the studio's parameters dock.

## Shader uniforms & helpers

The editor's *Cheat sheet* has the full list. A few worth knowing:

- `uBass`, `uMid`, `uHigh`, `uLevel`, `uBeat` – 0 to 1, up to 1.5 when Reactivity is turned up; `uBeat` follows the
  detected kicks.
- `uTick`, `uTicks` – the music's tempo: `uTick` runs 0 → 1 through each tick (one beat) and `uTicks` counts them,
  so `mod(uTicks, 4.)` changes something every four beats. Both keep going through breakdowns and hold still while
  nothing plays.
- `uBright`, `uMood` – the [synesthesia](audio.md#-synesthesia-sound--light-mapping) tone and mood, 0 to 1 and not
  scaled by Reactivity.
- `laser(t)`, `rainbow(t)`, `neon(t)` – colour palettes that repeat every 1.0; add `uHue` so the Colour slider and
  Colour cycling move them. `laser` is the laser palette: pure, fully saturated colours on a continuous wheel (red →
  yellow → green → cyan → blue → magenta → red), which the built-in scenes and the new-scene template use. It follows
  the Look's palette when one is set (only its colours, see [ADR 0004](adr/0004-palettes-are-hues-on-the-laser-wheel.md));
  `laserWheel(t)` is always the whole wheel. `rainbow` is the softer one.
- `media(p)`, `untone(col)` – sample the dropped image or video; see [Media](media.md#in-code-and-the-visual-maker).

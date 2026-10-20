# Changelog

## Unreleased — a more customizable Look (2026-10-20)

### Added

- Every **Look** slider shows its value (Reactivity, Trails, Synesthesia and Fringing in %, Colour in degrees,
  Speed and Colour cycling as ×). Click the value to type one; double-click a slider to put it back.
- **Fine tuning** on every Look control: Shift while dragging moves ten times finer, even when pressed halfway
  through a drag; the wheel steps a slider once it has focus (Shift: one step), and so do the arrow keys.
- Two **XY pads** above the sliders, each moving two of them at once, one across and one up, picked per pad
  (Speed and Reactivity, Colour and Colour cycling to start). A tag on a slider says which pad axis it is also on.
  The pads fold away.
- A **lock** beside each slider keeps Randomize, Shift+R and Drift off it. `get_app_state` tells the assistant
  which are locked.
- A dot beside **Colour** shows the colour on screen now, cycling included.
- **Look slots** A–D: click an empty slot (or Shift+click any) to store the look, click a filled one or press
  Alt+1–4 to glide to it over a second; the × on a filled slot's corner empties it.
  **Auto-change** lets the filled slots take turns on their own every 8–64 kicks while the music plays, Linear or
  Random, Soft (a glide) or Hard (a cut); the current slot is outlined. Shift+R comes back from a slot as from a Randomize. They go with an Export.
- A **palette** under Colour: 2–5 colours on the laser wheel that every scene's colours walk instead of the whole
  wheel, blending or in steps (each step eases, so cycling never switches the colour in one frame). Show scenes keep
  it; `set_look` takes `palette` and `get_app_state` reports it. Scenes of your own follow it through `laser()`;
  `laserWheel()` is the whole wheel ([ADR 0004](docs/adr/0004-palettes-are-hues-on-the-laser-wheel.md)).
- **Master look** in the studio, under the master fader: Live's master trims turn down what every show scene sets
  (Reactivity, Speed, Trails, Fringing, 0–100%) and shift its colour (±180°), on Live and the Preview monitor, without
  editing a show scene. Kept with the show; a show saved before them opens neutral
  ([ADR 0006](docs/adr/0006-master-trims-turn-down-live.md)).
- Sliders that **follow the music**: the ♪ beside Speed, Trails, Colour, Synesthesia or Fringing makes it move with
  the bass, mids, highs, level, kick, tone or mood, by a depth either way, with an attack and a release. It never goes
  above the higher of where you set it and the top of the Randomize range, rises no faster than 50 ms (Colour 150 ms,
  ±0.1 of the wheel), and a mark shows where it sits now. The Look slots keep it; show scenes don't yet. `set_look`
  takes `routes`. The built-in scenes' strobe check gains a third Look: every slider following the kick
  ([ADR 0005](docs/adr/0005-look-sliders-follow-the-music-within-a-checked-ceiling.md)).
- **Intensity**: one control that moves Reactivity, Trails and Fringing together, from the gentlest to the strongest
  look Randomize can reach. `set_look` takes `intensity`; `get_app_state` reports it and the filled slots.

### Changed

- The Look stays as you left it the next time the app opens: sliders, locks, switches and pads (stored on this
  computer, not exported; show scenes still carry their own look).
- Synesthesia's explanation moved from under its label to its tooltip and the help.
- The studio's cue swatches show the laser palette's colour for the cue's hue.
- A kick's colour change eases in over about 150 ms instead of landing in one frame. It goes as far as before.
- Show scenes keep **Synesthesia** with the rest of their look. One saved before takes the app's, as it did.

## Unreleased — System log (2026-10-19)

### Added

- A **System log** (Shift+S): everything the app has said since the page loaded, as it happens. The page's console
  and the errors nothing caught (an uncaught error, an unhandled rejection, a shader that doesn't compile, the GPU
  losing its context); the app's own events (the scene on screen, the music starting or failing, the tempo locking
  and letting go, projectors, media, export and import, recordings); and, while it is open, the local server's lines:
  each `/api` request with its status and time, and the assistant's traffic with the Claude CLI (on the computer the
  server runs on only). Filter by level (each with its count), source and text; pause; clear; open a line's stack
  with a click; repeated lines count up instead of repeating. **Copy** and **Export** (a `.log` file) take every line
  that matches.
- While the System log is closed, a red **badge** in the monitors' corner counts the errors you haven't seen; a click
  opens the log.
- The System log's **command line** runs every assistant tool by name, as the assistant runs it, with its input as
  `key=value` pairs or JSON (`switch_scene scene="Ring Run"`, `set_look {"hue": 0.3}`, `state`), plus its own
  commands (`help`, `level`, `source`, `filter`, `clear`, `copy`, `export`, `undo`). A tool's change goes on the
  assistant's undo stack. ↑ / ↓ bring back earlier commands, even after a reload; Tab completes a name.
- In the desktop app the System log also shows the **main process** (source *Desktop app*): its console, errors
  nothing caught and Node's warnings, the version and address it serves on, a window's page crashing or not
  responding, a helper process such as the GPU going away, a page failing to load, and permissions refused. They
  travel with the server's lines, since the server runs in the main process (not with `npm run desktop`, whose
  window loads the Vite dev server).
- The local server streams its lines at `GET /api/log` (server-sent events: the last 500, then each new one).

### Changed

- The Hearing monitor and the System log share one way of being dragged and put back (`useMonitorDrag`), and the
  layout keeps each monitor's place apart.

## Unreleased — scene history and what the assistant changed (2026-10-19)

### Added

- **History** in the code editor: every scene keeps its versions, newest first, with who made each (you, the
  assistant and the conversation it came from, *Start from…*, *Revert to original*, *Save to library* over a scene, a
  restore). Pick one to see how the code changed since, and restore it; a restore is a version too. A version is kept
  before and after every change that isn't your typing; your typing folds into one version until you pause for about a
  minute. The last 50 per scene are kept, on this computer only (not in exports).
- The assistant's tool chips open to **what changed**: a code diff (with *Open in editor* and *Put back the code from
  before*), parameters, Look, transition and autopilot from → to, and the show scenes and plan before and after. It is
  kept with the conversation, so it is still there after a reload, and deleted with it.
- The studio lists **what the director changed**, under its status, the same way (the director's changes still can't
  be undone from the assistant panel).

## Unreleased — docs website (2026-10-19)

### Added

- The guides in `docs/` (and the ADRs) are published as a website at
  [snuffish.github.io/hallucinate/docs](https://snuffish.github.io/hallucinate/docs/), next to the web demo. It is built
  with VitePress and has a sidebar, search and dark mode. Preview it with `npm run docs:dev`.

## Unreleased — Hearing monitor (2026-10-18)

### Added

- A **Hearing monitor** (Shift+L): what the Listener hears and why, over the main window (never on Live or the
  projectors). On top, at a glance: the tempo to a tenth (with what the kicks gave when it was folded into 85–175,
  e.g. *95.0 BPM (heard 190)*), how confident it is, kick and tick lights, whether it is *hearing kicks*, *holding*
  through a breakdown or has *no tempo*, and the delay to the speakers (or *heard outside the app* for the microphone
  and a shared tab). Below: the spectrum as heard, the bands against their running averages, the last 6 s of the
  kick signal with its threshold, the windows where a kick was due and the kicks against the ticks, the tempo
  candidates against the Listener's preference, and the tone, energy and mood. It stacks under the performance
  monitor when both are open. The Listener keeps what it shows only while it is open.
- The Hearing monitor also shows how many frames a second the Listener hears (red below 30, where kicks go unheard
  and the tempo wanders), how late the ticks land after their kicks, and every scene input (`uTime` … `uMood`) as the
  main screen's scene gets it, after the Look. Its **?** explains each part, and on a short screen it stops above the
  player bar and scrolls.

### Changed

- The player's tempo chip and `[` / `]` are called **Playback speed** (and *Pitch follows speed*): they change how
  fast the music plays, not the tempo heard in it.

## Unreleased — new scenes (2026-10-18)

### Added

- Four new built-in laser-show scenes, of kinds the set didn't have yet: **Lissajous** (key 9) and **Scope Ring**
  (key 0) in a new **Signals** category, drawn like an oscilloscope from the music's waveform and spectrum;
  **Constellation** (Geometry), drifting stars linked to their neighbours; and **Vortex** (Beams), spiral arms
  winding out from the centre. Each passes the laser-show checklist (ADR 0001): black edges in silence and a
  strobe-safe kick and tick, at the default and the strongest Look.

## Unreleased — the assistant's prompt catches up (2026-10-18)

### Changed

- The assistant is told the built-in set is a laser show and how to keep what it makes strobe-safe: black edges in
  silence, no kick or tick that brightens more than about a quarter of the frame, and the Look inside the ranges
  Randomize uses (taken from `RANDOM_RANGES`, so they can't drift).
- It knows effects reshape the picture and belong to show scenes, and that it can't set them yet, so it points to the
  Effects widget instead of faking a mirror in GLSL.
- Plans: while the tempo is known, `set_autopilot_plan` raises a step's `maxSeconds` to fit its beats (with a quarter
  to spare) and says so, so a 256-beat step at 128 BPM is no longer cut at the 90-second default.
- It names the scene it means once auto-switch may have moved the screen, and knows that while Live is pinned the
  Look, scene and parameter tools change the main screen, not Live. When the scene on screen changed since its last
  reply, the next message starts with a note saying which scene is on screen now.
- `get_app_state` also reports the playing scene's description, auto-switch, Drift and drift speed, the main screen's
  effects, whether Live is pinned and what the screen shows then, and the live levels while music plays; `get_show`
  reports each show scene's effects.
- Director cycles no longer ask for a FOLLOW-UPS line, and the prompt uses the glossary's *kick*, *tick* and *tone*.

### Added

- Two assistant tools: `find_scenes` searches the library by name, category or description, and `get_help` reads the
  app's help topics with their shortcuts.

## Unreleased — the player bar (2026-10-18)

### Changed

- The audio player moved out of the Source widget into a **bar along the bottom of the screen**, Media Player style:
  a thin seek line along its top edge, what's playing on the left, a round play button in the middle between loop,
  stop, ±10 s and previous / next, and the time, mute and volume on the right. Tempo and *Pitch follows tempo* moved
  into a popover off the tempo chip. It shows while there is something to control, hides with the controls (H, idle),
  and the bottom dock, floating widgets, the assistant, toasts and drop previews keep above it. On a phone it keeps
  play, previous / next, seek, tempo and volume.

### Added

- A **Stop** button in the player: pauses and goes back to the start.

### Fixed

- The demo beat's play button showed ▶ while it played; it now shows ❚❚ and turns back to ▶ when paused.
- The controls crashed ("Maximum update depth exceeded") on windows 600 px wide or narrower.

## Unreleased — effects (2026-10-17)

### Added

- An **Effects** widget, docked under the Look: add a **Mirror** to the main screen (left↔right, top↕bottom or both),
  switch it on and off and remove it. It stays through scene changes and reloads, and projectors showing the main
  screen show it too. See [ADR 0003](docs/adr/0003-effects-belong-to-the-show-scene.md).
- A **Kaleidoscope** effect: the picture folded into 3 to 12 segments around the centre, turning at a spin speed. It
  turns faster with the bass and each kick sends it a step further on, scaled by the Look's Reactivity; it never turns
  back.
- A **Glow** effect: a soft bloom around the lines with a strength and a radius. It swells with the bass and gives
  way to each kick, so a kick never doubles the picture. Its blur runs at half size in two passes: about +1.2 ms a
  frame at 1080p on an M2 at its defaults (PERF.md).
- A **Wave** effect: the picture ripples and bends, with an amount and a wavelength, and each kick sends a ripple
  outward from the centre, scaled by Reactivity.
- Show scenes keep their effects: *What's on Live now* and *Update from Live* store the screen's, a take with the
  studio open brings them back to the screen, and Preview, Live and every projector show them. Through a fade each
  picture keeps its own effects; a cut switches them with the scene. Shows saved before effects load with none, a
  damaged effect is dropped without losing the show, and an exported show carries its effects while still opening
  (without them) in an older copy. Show scenes the director and the assistant write have none.
- Effects can be dragged into another order by the ⠿ handle on their row (or moved with ↑ / ↓ from the focused
  handle); they run from the top down, so the order changes the picture. The order is kept on the screen, in show
  scenes and through a reload.
- `__profiler.effectsCost(stack)` times what effects cost per frame at the screen's resolution, against none, and
  `perf/measure.mjs` reports it for Glow and for all four stacked (about +1.6 ms at 720p and +3.4 ms at 1080p on an
  M2 at their strongest; PERF.md).

### Changed

- The built-in scenes spec measures the edges as a 7-pixel band at 720p (it was the outermost pixel), the band every
  effect leaves to the scene's own picture, checks every effect alone at its strongest on every scene, and checks the
  edges of every scene with all four stacked at their strongest.

## Unreleased — the Look serves the laser set (2026-10-17)

The Look widget now works with the laser set instead of against it. See
[ADR 0002](docs/adr/0002-the-look-serves-the-laser-set.md).

### Changed

- The default Look shows crisp lines on black: light trails (0.35), slow colour cycling (0.2), no fringing and a
  light Synesthesia (0.3). Dragging the sliders by hand still reaches their full ranges.
- Trails are now an afterglow: a line fades where it was drawn. The tunnel zoom and the hidden spin are gone, and the
  afterglow keeps the line's colour. A saved show scene with long trails now plays a long afterglow instead of a
  tunnel; it is not migrated.
- *Aberration* is renamed *Fringing* and defaults to 0.
- Colour cycling at 0 holds the colour still, even on kicks; kicks jump the colour more as cycling goes up.
- Synesthesia at 0 is off (it no longer boosts saturation), and it always includes the music's mood: the *Mood from
  tempo* checkbox is gone.
- Reactivity no longer makes kick flashes brighter.
- Resolution moved from the Look widget to Settings → *Display & performance*. It applies at once, defaults to 100%,
  and the studio's Preview renders at it too. The old *Start resolution* setting is not carried over.
- Randomize and Drift pick from narrower, laser-friendly ranges (trails 0–0.6, fringing 0–0.006, synesthesia 0–0.6,
  reactivity 0.6–1.4, speed 0.5–1.6), and Randomize no longer flips mood or spin.
- The built-in scenes and the new-scene template use a new `laser` palette of pure, fully saturated colours, and a
  new Palette block in the visual maker starts on it. `rainbow` keeps its colours for your own scenes, and saved graphs that name it (or no
  palette) keep it.
- The safety rules (black edges, strobe) now check every built-in scene with the Look applied, at the default Look and
  at the strongest one Randomize or Drift can reach.

## Unreleased — the music and the visuals (2026-10-16)

### Removed

- Beat Racer, the game: its scene, the *Game* tab in the library, the toolbar button, the score overlay and the
  assistant's knowledge of it. The G key is now free (it does nothing). See
  [ADR 0001](docs/adr/0001-replace-all-built-in-scenes.md).

### Fixed

- A paused, stopped or finished file (or SoundCloud track, or video's sound) no longer counts as music playing: the
  autopilot's beats, auto-switch, the director's cycles and the assistant's "mood / tone" wait for it to play again,
  instead of carrying on as if it still did. The assistant and the director say the source is "none" after a stop.
- The tempo reads right at a low frame rate: kicks are timed on real time, not on the show's clock, which runs slow
  below 10 fps.
- When nothing plays, the tone drifts back to neutral like the mood does, so the picture no longer stays warm or cool
  from the last track.
- A show scene's own reactivity, speed and colour cycle now apply on Live and in Preview. Before, with the studio
  closed, moving the main Reactivity or Speed slider while browsing changed what the projectors showed, and Preview
  showed a show scene with the main sliders' reactivity while Take then applied its own.
- With *Mood from tempo* off, shaders get a neutral `uMood` too, not only the colour grade.
- The editor's cheat sheet, the visual maker's Audio block and the assistant now give every shader input's real range:
  the bands and `uBeat` reach 1.5 when Reactivity is turned up (they said "0 → ~1"), and `uBright` / `uMood` are not
  scaled by Reactivity (the header said every audio value was).
- The director reads the music's energy trend from how loud it is over seconds, so a build-up reads as rising; before,
  each band was measured against its own last few seconds and most of a build-up was evened out.

## Unreleased — studio Live (2026-10-16)

### Fixed

- With the studio closed, a fade between two show scenes no longer starts the outgoing one with the main screen's
  parameter values: it fades out as it was on Live. Two show scenes of the same scene no longer fade the new values in
  only at the very end; the new ones show at once, as they do with the studio open.
- Opening the library no longer breaks the controls with "'ArrowLeft' is already registered".
- When a shared tab stops sharing (or the microphone goes away), the player says so instead of still showing
  "▶ Tab / system audio", and the source button is no longer lit.
- A conversation's transcript is saved in order: a reply's final state can no longer be overwritten by an older one
  that was still being written, and deleting a conversation while a save is in flight no longer leaves it stored.
- The desktop app started from the Dock or Finder now uses `CLAUDE_BIN`, `YTDLP`, `YTDLP_CACHE_MB` and `ASSISTANT_DEBUG`
  from the login shell. Before, they were read before the shell was asked, so only `PATH` and the assistant's settings
  came through.

## Unreleased — SoundCloud and YouTube (2026-10-16)

### Fixed

- A search no longer fails with "Unexpected answer from the local server" when one result has no duration or artwork
  (live sets, some uploads), and the download bar no longer stalls on updates that don't know the speed or size yet.

## Unreleased — assistant undo (2026-10-16)

### Fixed

- Undoing the assistant's transition, autopilot, parameter, look or code change refuses (with a message) once you or
  the director changed the same thing after it, instead of silently overwriting your change. Before, only show edits
  were checked.
- Undoing a plan also switches the autopilot back off when the plan switched it on.
- Undoing a parameter change resets only the parameters the assistant set, not every parameter of the scene.
- Undoing a new scene leaves it alone once you edited its code.
- Deleting a conversation while it is replying deletes it for good: its transcript is no longer written back a moment
  later, and it no longer comes back as an unread badge or a peek.
- Stop on a conversation that is waiting for a free slot sets it back to idle.
- With the Claude subscription, a reply that uses the same tool twice shows each call's input on its own step while it
  streams in, instead of the second one's on the first.

## Unreleased — settings (2026-10-16)

### Added

- Settings (⚙ in the Hallucinate widget, ☰ → Settings…, or the , key): where Resolution starts, a pixel-density cap
  for the main screen, the studio monitor and projectors, audio smoothing, the browser's microphone processing, how soon
  the controls hide (or never), key badges on or off, and the assistant's reasoning toggle. Also export / import, clearing
  the recently played lists and resetting the settings. They belong to this computer and stay out of Export; a change
  in one tab reaches the others at once. See docs/settings.md.
- Settings → Assistant: choose the connection (API key or Claude subscription), the model and the efforts from the app;
  a save applies to the next reply without a restart. The desktop app can keep an API key, encrypted with the system
  keychain and never sent back to the page. Environment variables still win and lock their field; `claude` and
  `yt-dlp` paths stay environment-only, and settings can only be changed on the computer the server runs on.

## Unreleased — assistant token use (2026-10-16)

### Changed

- The assistant changes part of a scene with a new `edit_scene_code` tool (exact replacements) instead of resending the
  whole shader, which was most of what a small tweak cost.
- Tool results are leaner: setting parameters answers with what it applied, a code change with the new values only, and
  the app state lists the library one line per category.
- A reopened conversation tells Claude what is on screen and whether that scene's code changed since its last reply,
  instead of asking it to look everything up again.
- Token usage shows the conversation's size, the input the prompt cache didn't serve, the output and the reported cost,
  instead of a summed input that mostly counted cheap cache reads. The long-conversation hint comes at 80k tokens.

### Added

- `node scripts/assistant-usage.mjs` prices a subscription conversation step by step from Claude Code's logs.

## Unreleased — performance monitor (2026-10-16)

### Added

- A performance monitor (Shift+P, or `?perf` in the URL): frame rate against the display's refresh, the main thread's
  time per stage of the frame (audio analysis, look, draw calls, projector link, studio, React), and one sentence on what
  holds the frame rate back. **Test GPU** renders at half resolution for a moment to tell a GPU-bound scene from
  everything else. `?perf=trace` adds the stages to a DevTools Performance recording, and
  `node perf/measure.mjs … --gpu` runs on the real GPU and ranks every scene by how hard it is on it. See PERF.md.

## Unreleased — fixes from the architecture review (2026-10-15)

### Fixed

- Opening the library during Beat Racer (G, then L) no longer blanks the app; ← / → change scene with the code
  editor open, as documented. A crash in the controls now shows a message while the visuals keep running.
- Only the app itself can use its local server: other websites can no longer start assistant runs on your account or
  downloads through it. The yt-dlp cache is trimmed to 2 GB (`YTDLP_CACHE_MB`).
- An imported visual-maker graph with an unknown block or a dangling wire can no longer break the app on start.
- Loading or clearing media quickly always ends on your last choice, in the main window and on projectors.
- Fast typing in the code editor no longer leaks graphics memory, and an old error no longer covers a newer success.
- The studio's Preview shows exactly what Take puts on screen (beat fringing and synesthesia included); its slider
  drags are saved once instead of on every movement; imported shows can't set out-of-range autopilot timings.
- The AI Director and the assistant's conversations take turns with their tools, and Undo refuses (with a message)
  instead of silently reverting changes made after the step it undoes.
- The desktop app reads `ANTHROPIC_API_KEY`, `CLAUDE_BIN`, `YTDLP` and the `ASSISTANT_*` settings from your shell
  profile, as documented, and builds Intel as well as Apple-silicon Macs; tagged releases are published on GitHub.

## Unreleased — React + TypeScript port (2026-10-13)

### Added

- The assistant keeps several conversations, running side by side, with a history kept in the browser (IndexedDB;
  search, rename, pin, delete, export as Markdown; the 50 newest, pinned ones stay). The bubble turns while one works
  with the panel closed, then counts replies waiting and peeks at the newest. Token usage per reply and per
  conversation, a hint when a conversation gets long, the assistant's reasoning on demand (💭), messages typed while
  it works are queued, Retry and Copy, and the panel resizes from its corner like a widget. (2026-10-15)
- The subscription backend reports token usage (the director's token count now works there too) and keeps a
  conversation's Claude Code session across dev-server restarts, falling back to a transcript when the session is gone.

### Changed

- Undo reverts the newest assistant change from any conversation, and tells Claude with the next message instead of
  starting an extra reply.

- The studio autopilot counts beats on a tempo clock (BPM from the detected kicks, re-anchored on each kick) instead of
  raw bass hits, so the show keeps moving through breakdowns; the indicator shows the tempo in use.
- Studio: closing it with a show scene Live pins the Live slot, so projectors keep that scene while the screen is
  only a preview (the panel shows *● LIVE · name*); reopening restores Live to the screen. The autopilot shows a
  beat indicator (beats gone / to go until the next take).
- The assistant is a detached chat bubble at the bottom next to the panel, toggled with the bubble or `I`; it no
  longer replaces the control panel and can stay open next to the other panels.
- The assistant suggests three follow-up requests after every reply, shown as chips under it (the model ends its
  reply with a `FOLLOW-UPS:` line that the panel turns into buttons).
- The whole UI is now React 19 + TypeScript. No vanilla JavaScript remains in `src/`; the engines kept their
  behaviour and moved to `src/engine/`. See `ARCHITECTURE.md`.
- The AI assistant runs on [TanStack AI](https://tanstack.com/ai): the agent loop lives on the server, the tools
  are defined once with zod and run in the browser, replies render with `@tanstack/markdown`. Two backends:
  an Anthropic API key, or a Claude subscription through the local Claude Code CLI (locked down to this app's
  tools only).
- Every shortcut comes from one registry (`@tanstack/react-hotkeys`) and is shown as a key badge on the control
  it triggers; the help row at the bottom of the panel is generated from the same table.
- Studio: what was called *Program* is now **Live** (monitor, parameters tab, "What's on Live now").
- Scene library keyboard navigation: `/` focuses the search (Esc leaves it, a second Esc closes), `Tab` /
  `Shift+Tab` cycle the categories, arrow keys move through the hits (also while typing), `Enter` plays.
  The search box is no longer focused automatically on open.
- The Parameters overlay no longer shows over the start screen; it appears once a source plays.
- All saved data (scene edits, library scenes and preferences, parameter values, the show, the player settings,
  recent tracks, the visual-maker graph) keeps its keys and shapes, and is validated when read.

### Performance

- Shaders compile in the background; typing in the editor no longer freezes the visuals.
- Video media uploads once per decoded frame through immutable texture storage instead of reallocating every frame.
- Library previews and assistant screenshots are read back asynchronously and encoded in a worker, so opening
  the library no longer stalls the show.
- Slider drags no longer write to `localStorage` on every event (writes are coalesced and flushed on hide).
- The renderer learns its size from a `ResizeObserver` instead of reading layout every frame; meters animate
  on the compositor.
- Numbers before and after in `PERF.md`.

### Removed

- The Anthropic beta features that the TanStack adapter does not expose: server-side model fallback and eager
  tool-input streaming.
- The hand-written SSE parser and Markdown renderer in the old assistant panel.

### Tooling

- Vite 8 with `@vitejs/plugin-react`, TypeScript 5.9 (strict), ESLint (typescript-eslint + React hooks rules),
  Vitest unit tests, Playwright end-to-end tests, a performance probe (`perf/measure.mjs`).

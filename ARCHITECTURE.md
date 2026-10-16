# Architecture

How Hallucinate is put together after the React + TypeScript port, and the rules that keep it fast.
Read this before adding a panel, a tool, a shortcut or a scene.

## The shape

```
browser                                              dev server (Vite middleware)
┌───────────────────────────────────────────┐        ┌───────────────────────────────────┐
│ React tree (panels, overlays, badges)     │        │ /api/soundcloud, /api/youtube      │  yt-dlp bridges
│   ▲ subscribes (≤30 Hz)   │ calls actions │        │ /api/assistant   TanStack AI chat() │
│ UI store  ◄───────────────┤               │        │   adapters: Anthropic API | Claude │
│   ▲ publishes             ▼               │  SSE   │   CLI (subscription, locked down)  │
│ AppController ── frame loop ── engines    │◄──────►│   MCP endpoint for the CLI          │
│   (renderer, audio, media, game, params)  │        └───────────────────────────────────┘
│   shared Scene[] (stable indices)         │
└──────────────┬────────────────────────────┘
               │ BroadcastChannel (scenes, per-frame state, media)
        ┌──────▼──────┐
        │ output.html │  projector windows, each renders at its own resolution
        └─────────────┘
```

- **Engines** (`src/engine/`) are plain classes with no DOM access beyond the canvas, media elements and
  `localStorage`: `Renderer`, `AudioEngine`, `MediaLayer`, `BeatRacer`, the `@param` parser and store, the
  visual-maker compiler, the projector link. Each one that holds a resource (GL objects, audio nodes, media,
  listeners) has `dispose()`. `src/engine/look.ts` turns the look sliders and the sound into one frame's state
  (`applyLook`); the main output, the studio's Preview monitor and the pinned Live slot all use it, and
  `crossfade` is the one rule for how far a transition is.
- **AppController** (`src/app/controller.ts`) is created once the canvas exists. It owns the engines, the
  shared scene list, the look sliders, the clock and the `requestAnimationFrame` loop, and exposes every
  action the UI calls (`setScene`, `startSource`, `setParam`, `toggleRecording`, …).
- **The music** (`src/app/music-source.ts`, the controller's `music`): which source is playing, the "now playing"
  line and play / pause. A live input, a file or track through the `<audio>` player, or a video's sound starts there,
  and it hears when the audio engine lets go of a live input by itself (`AudioEngine.onEnded`: a shared tab stopped
  sharing, the microphone went away). It is the only writer of `activeSource`.
- **The Live slot** (`src/app/live-slot.ts`, the controller's `live`): closing the studio with a show scene Live pins
  it there. Projectors keep it, and crossfade from it on the next take with each show scene's own values, while the
  screen is free to browse (or shows Live too, from the Screen widget). `route()` decides each frame what the main
  canvas and the projectors draw; the studio's Preview monitor is composed by the same code (`preview()`), and the
  slot publishes `liveName` and `screenMode`. The tests' fake app uses the real one.
- **UI store** (`src/state/store.ts`, `ui-state.ts`): an immutable snapshot published by the controller.
  The loop publishes meters, BPM and the like every second frame; actions publish immediately. Components
  subscribe with selectors (`useUI(ui => ui.sceneName)`), so nothing per-frame goes through React state.
- **Panels** (`src/components/`) stay mounted and toggle with the `hidden` attribute. That keeps the
  stylesheet's `body:has(#x:not([hidden]))` rules, the canvases and focus handling as they were.
- **Widgets** (`src/components/widgets/`): every group of controls (and the Parameters) is a `<Widget>` docked to
  an edge or floating. Where each one sits lives in a second store, `app.layout`, built from the pure functions in
  `src/state/layout.ts` and persisted (validated per widget) under `KEYS.layout`. The widgets publish
  `--dock-left/right/top/bottom` (how far each dock reaches into the screen) and `body[data-widgets]`; the overlays
  inset themselves from those. Stacking uses the named `--z-*` scale in `:root`.
- **Sessions** live outside React state. `src/app/sessions.ts` is their composition root: once per controller it
  creates the `StudioSession` (cues, Preview/Live, master), the `Director` and the `AssistantSession`, hands the
  director and the assistant one shared tool lock, and provides them to the panels through `useSessions()`.
  The panels only subscribe and render; the shortcuts and the tools reach the same objects. The sessions see
  the app through `AppPort` (`src/app/app-port.ts`), the part of the controller they use; the tests use one
  in-memory fake of it (`src/app/fake-app.ts`), so neither can drift from what the sessions need. A scene goes
  on screen as a whole through `applyScene` / `captureScene` (scene, parameter values, look), the way the studio
  takes it. A scene's code, its `@params` and their stored values belong to the scene library
  (`src/app/scene-library.ts`, the controller's `library`): compiling into a scene, adding one of yours (one rule for
  "Save to library" and the assistant's `create_scene`), removing it and setting values all go through it, and it
  tells the controller what changed, which keeps the renderer, the projector and the Parameters panel current. It
  compiles through a `Compiler` (the renderer), so the tests' fake app runs the real library on a fake one.
  `EditorCore` keeps the editors' own text ("My Shader", the visual maker's code) and asks before a save; the visual
  maker's `GraphSession` belongs to its panel. The
  controller's `ControllerHooks` are only what a session plugs into the frame loop, plus `escape` (a panel's
  first Escape may just leave its text field); panels register their own shortcuts.
- **Errors in the interface** are caught by one `ErrorBoundary` around the panels; the canvas and the frame loop
  sit outside it, so the show keeps running. The loop itself re-arms before each frame, so a frame that throws
  is logged once and the next one runs.

## The desktop app

`desktop/` packages the same app with Electron. The main process (`desktop/main.ts`) starts `desktop/server.ts`, a
small Node server on `127.0.0.1` that serves the built `dist/` and mounts the same `/api` handlers as `vite.config.ts`,
then loads it in a window. The renderer doesn't know it's in Electron: relative URLs, the projector pop-up and the
BroadcastChannel work as in a browser. The main process answers what a browser would ask the user (microphone,
screen capture, display access, which pop-ups may open) and imports the login shell's `PATH` and the app's own
settings (`SHELL_VARS` in `desktop/env.ts`: the API key, `CLAUDE_BIN`, `YTDLP`, `ASSISTANT_*`, derived from what the
server reads, `ENV_NAMES` in `server/config.ts` and `PROGRAM_ENV` in `server/programs.ts`) so they work from the Dock too.
It imports the server before it asks the shell, so the server reads its environment when `apiRoutes()` builds the
routes, never when a module loads. The port is fixed (47741) because the storage origin includes it. `vite.desktop.config.ts`
bundles the main process and the server code into `dist-desktop/main.js`; `electron-builder.yml` packages `dist/` and
`dist-desktop/` without `node_modules`.

## Invariants

1. **Scenes are addressed by index** in one shared `Scene[]`: the renderer, the projector protocol, the number
   keys and parameter storage all rely on it. Never filter, sort or splice that array; entries are appended
   (`appendScene`) or soft-removed (`removed: true`). The controller creates the array, gives it to the
   renderer and lets `buildSceneList` fill it, so there is exactly one; `AppState.scenes` is `readonly`, so a
   splice or sort doesn't compile. React keys use `scene.id`.
2. **Canvases never move in the DOM.** Moving `<canvas>` would create a new WebGL context and lose every
   program, the trails and the recording stream. The studio pins the main canvas over its Live box with CSS.
3. **Nothing per-frame allocates or touches layout.** The renderer reuses its uniform objects, learns its
   size from a `ResizeObserver`, uploads video frames with `texSubImage2D` once per decoded frame, compiles
   shaders in the background (`KHR_parallel_shader_compile`) and reads snapshots back through a pixel buffer
   and a fence. The studio's monitors reuse their frame state and cache each show scene's uniforms. Meters
   animate with `transform`. (Known exception: the projector link posts the whole frame state every frame; see
   PERF.md.)
4. **Persistence is validated.** Every `localStorage` key is listed in `src/state/persistence.ts`. JSON values are
   parsed with a zod schema on the way in (`readJSON`); plain strings and flags (`readString`) are read as text
   and treated as untrusted. Bursts of writes (slider drags, graph edits, the studio's show) are coalesced with
   `debouncedWriter`.
5. **One shortcut registry.** `src/hotkeys/registry.ts` declares every binding with the condition it is
   active under and its owner (the app, or the library, visual maker or assistant panel), and `isEnabled(when,
   context)` decides which are live. Each owner registers its bindings with one action map typed by binding id
   (`useAppHotkeys` in `App.tsx`, `useHotkeyActions<'library'>` in a panel), so a binding without an action doesn't
   compile; only the live ones are registered and `<Kbd>` renders the badge. The registry test runs `isEnabled` over
   every UI state and fails if two bindings are ever live on the same key. That test is the guard, not TanStack's conflict
   check: a panel taking a key over registers it (a child's effect) before the app drops its own, so the registrations
   overlap for a moment and conflicts are allowed.
6. **The assistant's tools run in the browser**, each declared once in `src/assistant/tools.ts` (zod schema,
   description, the panel's labels, whether the director gets it). The runner parses each call's input with that
   schema before the implementation sees it, and the implementations are a map typed by tool name, so a tool
   without one doesn't compile. Errors are thrown and become error tool results. Every tool call, from any
   conversation or the director, waits on one lock. Every change is one undo step under one rule
   (`undoable` / `record` in `executor.ts`): the undo puts back what the change touched only while that is still
   what the change left, and refuses (`UndoConflict`) once anything else changed it since.
7. **Overlays lay out around the widgets through one contract.** They read `--dock-*` and `body[data-widgets]`
   only, never a widget's selector, and stack with the `--z-*` scale; the studio's pinned Live canvas (`--z-live`)
   stays above every floating widget.
8. **The subscription backend is locked down.** `server/claude-cli-adapter.ts` spawns `claude -p` with
   `--tools ''` (no files, no shell), `--strict-mcp-config` (only this app's MCP server),
   `--setting-sources ''` (none of the user's CLAUDE.md, hooks or plugins), `--disable-slash-commands`, and a
   working directory of its own that only the user can read (it holds the MCP configs and their tokens). The
   flags are built by `cliArgs()`, and a test pins them. Do not add `--safe-mode`: it silently disables MCP
   servers, which is how the app's tools reach the model. `server/probes/claude-code-lockdown.mjs` documents why
   TanStack's own Claude Code adapter is not used.
9. **The server handlers are host-agnostic.** `server/routes.ts` lists the `/api` handlers once; the Vite dev /
   preview server and the desktop app's own server both mount that list. Anything server-side goes there, not
   into a Vite-only hook. The assistant's settings come from one `ConfigStore` (`server/config.ts`) passed to that list:
   a file in the desktop app's profile with the keychain for an API key, else `~/.config/hallucinate` without one.
   What a route and the browser exchange is declared once, in a zod-only leaf both ends parse with:
   `src/assistant/relay-wire.ts` for the tool round trip, `src/remote/wire.ts` for the yt-dlp bridges (whose browser
   side is `remoteSite()` in `src/remote/client.ts`; the bridge takes its yt-dlp runner, so its tests drive that client
   against a scripted one), `src/assistant/settings-wire.ts` for `/api/settings` and `/api/assistant/info` (the e2e
   fake of the settings server is typed by it too).
10. **Only the app may call `/api`.** Every route is wrapped in `guarded()` (`server/guard.ts`): the Host must be
   a loopback name or an IP literal (or listed in `ALLOWED_HOSTS`), a browser request must come from the app's
   own origin, and a POST must be JSON. The CLI reaches the MCP endpoint at the server's own socket address,
   never at the Host a client sent.

## Data flow per frame

`AudioEngine.update` → band energies, beat → `AppController.step` eases the clock, updates mood and the
colour grade, fills one reused `ProgramState` (`applyLook`) → `LiveSlot.route` decides what the screen and the
projectors draw → `Renderer.render` (scene pass → feedback pass → display pass) → `OutputLink.sendFrame` when a
projector is connected → `hooks.onFrame` (studio preview and master
fader) → every second frame: publish meters to the UI store. `FrameProfiler` (Shift+P, `?perf`) laps between these stages;
while it is off each lap is one flag check.

## Assistant flow

API key: the conversation's `ChatClient` → `POST /api/assistant` (AG-UI body) → `chat({ adapter: anthropicText, tools: definitions })`
→ the model calls a tool → the server pauses → the browser runs the `.client()` implementation → the run
resumes with the result.

Conversations: `AssistantSession` (`src/assistant/conversations.ts`, created by `sessions.ts` like the studio) owns one
`Chat` per conversation (`chat.ts`: one `ChatClient`, its tools, when a run is over, sealing on Stop, and a final
dispose; the director's cycles use the same), so several run at once and keep running while another is on screen. They share one
tool lock with each other and the director (`lock.ts`: their tools act on one app, one at a time) and one undo stack (an undo closure restores a
snapshot, so only the newest change can be undone safely; the entry says whose it was). The session publishes
`assistantBusy` / `assistantRunning` / `assistantUnread` / `assistantPeek` for the bubble and the director. History:
an index under `KEYS.assistantChats`, transcripts in IndexedDB (`history-store.ts`). Each conversation keeps its
transcript through one `storedTranscript` handle, which holds every rule for it: read once, sealed; never written
before that read (a conversation closed early doesn't overwrite it); written at most once a second and at once when a
reply ends, in order; nothing written after a delete. A transcript is *sealed* when read and on Stop (`sealInterrupted`): a tool call without a
result gets one saying the app closed first. Notes for Claude (undo, reopened later) ride at the start of the next
user message (`notes.ts`). Before a send, screenshots older than the newest three are replaced by a short note
(`prepareForSend`). The connection has no `joinRun` on purpose: a run is never rejoined.

Subscription: the same route asks the CLI bridge (`server/cli-bridge.ts`, one `CliBridge` per server) for a
`ClaudeCliAdapter` → it spawns the CLI with an MCP config pointing back at `/api/assistant/mcp` and turns its stream-json
into chunks (`claude-cli-adapter.ts`) → a tool call arrives as an MCP `tools/call` → the bridge emits a `hallucinate.tool_call`
custom event on the chat stream → the browser (`relay.ts`) runs the same implementation and answers via
`POST /api/assistant/tool-result` → the bridge emits the tool result chunk and returns the MCP result (or an error one after
120 s, or when the run ends first). The bridge owns the CLI sessions and its sub-routes (`/mcp`, `/tool-result`, `/new`); the
route only mounts them. The event and the posted result are declared once, in `src/assistant/relay-wire.ts` (zod only, so
the browser loads it too), and both ends parse them with it. The CLI session id is the conversation's
`threadId`, and `forwardedProps.continued` makes the adapter `--resume` it after a server restart; a session the
CLI no longer has is retried as a new one that starts from a transcript. Usage comes from the CLI's `result` event.

## Adding things

- **A scene:** add a `scene(name, category, description, glsl)` line to `SCENES` in `src/engine/scenes.ts`.
  Tag uniforms or constants with `// @param` for live controls.
- **A visual-maker block:** add an entry to `NODE_TYPES` in `src/engine/nodes.ts` (and a helper to `LIBS` if it
  needs GLSL). The examples test compiles every example graph.
- **An assistant tool:** add a `tool({ … })` entry to `TOOLS` in `src/assistant/tools.ts` (schema, description, its
  `running` / `done` labels, `director: true` if the director may use it), then implement it in
  `src/assistant/executor.ts`, where the compiler points until you do. A change goes through `undoable` with what it
  touches (`show(s)`, `params(i, specs)`, …), never a hand-pushed undo. The browser wrapper (`client-tools.ts`) is
  generated from the definitions.
- **A shortcut:** add it to `HOTKEYS` with a `when` condition (and an `owner` if a panel handles it), give it its
  action in that owner's map (`App.tsx`, or the panel's `useHotkeyActions`; the compiler points there), and put
  `<Kbd hotkey={HOTKEYS.x} />` on the control it triggers.
- **A persisted value:** add the key to `KEYS` and give it a class in `KEY_CLASS` (`src/state/persistence.ts`; it
  doesn't compile without one). Read JSON with `readJSON(key, schema, fallback)`, or `readWithDefaults(key, schema)`
  when every field has a default, and on / off flags with `readFlag` / `writeFlag`. A `setup` key also goes into
  `SECTIONS` in `src/app/bundle.ts`, so Export / Import carry it; the bundle test fails until it does.
- **A device preference** (how this computer renders, listens or shows the controls): add a field with a `.catch`
  default to `PrefsSchema` in `src/state/prefs.ts`, say in `APPLIES` when it takes effect, apply it in the
  controller's `applyPrefs`, and give it a control in `src/components/Settings.tsx`. A preference is a default that seeds
  live state, never a second control for it. One that reaches every renderer (`all-renderers`) goes into
  `outputPrefs` and `OutputPrefs` with an applier in `src/engine/output-link.ts` (it doesn't compile without one): the
  main canvas, the studio's Preview monitor and projector windows all apply them with `applyRendererPrefs`, and the
  prefs test fails if `outputPrefs` and `APPLIES` disagree. Preferences are not exported.
- **A server setting** (how the server reaches Claude): add it to `StoredConfigSchema`, `effectiveConfig` and
  `ENV_NAMES` in `server/config.ts` (the environment wins, then Settings, then the default; the desktop app copies the
  variable from the login shell by itself), to the view and the patch in `src/assistant/settings-wire.ts` (the route
  and the e2e fake don't compile until they answer it), and give it a control in `src/components/SettingsAssistant.tsx`.
  Never make a program path settable over HTTP: those live in `server/programs.ts`, read from the environment only,
  since the server runs them and `/api` admits non-browser clients. Writes are allowed from a loopback host only
  (`isLoopbackHost`).

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run test:e2e   # CI runs all four
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json   # with the dev server running
```

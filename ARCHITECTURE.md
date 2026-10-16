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
  (`applyLook`); the main output, the studio's Preview monitor and the pinned Live slot all use it.
- **AppController** (`src/app/controller.ts`) is created once the canvas exists. It owns the engines, the
  shared scene list, the look sliders, the clock and the `requestAnimationFrame` loop, and exposes every
  action the UI calls (`setScene`, `startSource`, `setParam`, `toggleRecording`, …).
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
  The panels only subscribe and render; the shortcuts and the tools reach the same objects. `EditorCore`
  (compiling and saving code) belongs to the controller, the visual maker's `GraphSession` to its panel. The
  controller's `ControllerHooks` are only what a session plugs into the frame loop and the shortcuts that
  follow the open panel (library navigation, deleting a block).
- **Errors in the interface** are caught by one `ErrorBoundary` around the panels; the canvas and the frame loop
  sit outside it, so the show keeps running. The loop itself re-arms before each frame, so a frame that throws
  is logged once and the next one runs.

## The desktop app

`desktop/` packages the same app with Electron. The main process (`desktop/main.ts`) starts `desktop/server.ts`, a
small Node server on `127.0.0.1` that serves the built `dist/` and mounts the same `/api` handlers as `vite.config.ts`,
then loads it in a window. The renderer doesn't know it's in Electron: relative URLs, the projector pop-up and the
BroadcastChannel work as in a browser. The main process answers what a browser would ask the user (microphone,
screen capture, display access, which pop-ups may open) and imports the login shell's `PATH` and the app's own
settings (`SHELL_VARS` in `desktop/env.ts`: the API key, `CLAUDE_BIN`, `YTDLP`, `ASSISTANT_*`) so they work from the
Dock too. The port is fixed (47741) because the storage origin includes it. `vite.desktop.config.ts`
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
   active under, and `isEnabled(when, context)` decides which are live; `useAppHotkeys` registers only those (a
   double binding is an error) and `<Kbd>` renders the badge. The registry test runs `isEnabled` over every UI
   state and fails if two bindings are ever live on the same key.
6. **The assistant's tools run in the browser**, defined once with zod in `src/assistant/tools.ts`. The runner
   parses each call's input with that schema before the implementation sees it, and the implementations are a
   map typed by tool name, so a tool without one doesn't compile. Errors are thrown and become error tool
   results; changes register an undo. Every tool call, from any conversation or the director, waits on one lock.
   A show change's undo restores a snapshot only if nothing changed the show after it (`UndoConflict`).
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
   into a Vite-only hook.
10. **Only the app may call `/api`.** Every route is wrapped in `guarded()` (`server/guard.ts`): the Host must be
   a loopback name or an IP literal (or listed in `ALLOWED_HOSTS`), a browser request must come from the app's
   own origin, and a POST must be JSON. The CLI reaches the MCP endpoint at the server's own socket address,
   never at the Host a client sent.

## Data flow per frame

`AudioEngine.update` → band energies, beat → `AppController.step` eases the clock, updates mood and the
colour grade, fills one reused `ProgramState` (`applyLook`) → `Renderer.render` (scene pass → feedback pass → display
pass) → `OutputLink.sendFrame` when a projector is connected → `hooks.onFrame` (studio preview and master
fader) → every second frame: publish meters to the UI store. `FrameProfiler` (Shift+P, `?perf`) laps between these stages;
while it is off each lap is one flag check.

## Assistant flow

API key: the conversation's `ChatClient` → `POST /api/assistant` (AG-UI body) → `chat({ adapter: anthropicText, tools: definitions })`
→ the model calls a tool → the server pauses → the browser runs the `.client()` implementation → the run
resumes with the result.

Conversations: `AssistantSession` (`src/assistant/conversations.ts`, created by `sessions.ts` like the studio) owns one
`ChatClient` per conversation, so several run at once and keep running while another is on screen. They share one
tool lock with each other and the director (`lock.ts`: their tools act on one app, one at a time) and one undo stack (an undo closure restores a
snapshot, so only the newest change can be undone safely; the entry says whose it was). The session publishes
`assistantBusy` / `assistantRunning` / `assistantUnread` / `assistantPeek` for the bubble and the director. History:
an index under `KEYS.assistantChats`, transcripts in IndexedDB (`history-store.ts`), written at most once a second and
at once when a reply ends. A transcript is *sealed* when read and on Stop (`sealInterrupted`): a tool call without a
result gets one saying the app closed first. Notes for Claude (undo, reopened later) ride at the start of the next
user message (`notes.ts`). Before a send, screenshots older than the newest three are replaced by a short note
(`prepareForSend`). The connection has no `joinRun` on purpose: a run is never rejoined.

Subscription: the same route picks `ClaudeCliAdapter` → it spawns the CLI with an MCP config pointing back at
`/api/assistant/mcp` → a tool call arrives as an MCP `tools/call` → the adapter emits a `hallucinate.tool_call`
custom event on the chat stream → the browser runs the same implementation and answers via
`POST /api/assistant/tool-result` → the adapter emits the tool result chunk and returns the MCP result. The CLI session id is the conversation's
`threadId`, and `forwardedProps.continued` makes the adapter `--resume` it after a server restart; a session the
CLI no longer has is retried as a new one that starts from a transcript. Usage comes from the CLI's `result` event.

## Adding things

- **A scene:** add a `scene(name, category, description, glsl)` line to `SCENES` in `src/engine/scenes.ts`.
  Tag uniforms or constants with `// @param` for live controls.
- **A visual-maker block:** add an entry to `NODE_TYPES` in `src/engine/nodes.ts` (and a helper to `LIBS` if it
  needs GLSL). The examples test compiles every example graph.
- **An assistant tool:** define it in `src/assistant/tools.ts` (add it to `TOOL_DEFINITIONS`), then implement it in
  `src/assistant/executor.ts` and give it a verb in `VERBS` / `DONE_VERBS`; the compiler points at both until you
  do. The browser wrapper (`client-tools.ts`) is generated from the definitions.
- **A shortcut:** add it to `HOTKEYS` with a `when` condition, wire the action in `useAppHotkeys` / `App.tsx`,
  and put `<Kbd hotkey={HOTKEYS.x} />` on the control it triggers.
- **A persisted value:** add the key to `KEYS`, a zod schema, and read it with `readJSON(key, schema, fallback)`.
  Decide whether it is setup (add it to `SECTIONS` in `src/app/bundle.ts`, so Export / Import carry it) or history
  (leave it out, and say so in the comment above `SECTIONS`).

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run test:e2e   # CI runs all four
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json   # with the dev server running
```

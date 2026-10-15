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
  visual-maker compiler, the projector link. Each has `dispose()`.
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
- **Sessions** for the bigger panels live outside React state: `EditorCore` (compiling and saving code),
  `StudioSession` (cues, Preview/Live, master), the visual maker's `GraphSession`. They mutate themselves and
  bump a version the component re-renders on.

## The desktop app

`desktop/` packages the same app with Electron. The main process (`desktop/main.ts`) starts `desktop/server.ts`, a
small Node server on `127.0.0.1` that serves the built `dist/` and mounts the same `/api` handlers as `vite.config.ts`,
then loads it in a window. The renderer doesn't know it's in Electron: relative URLs, the projector pop-up and the
BroadcastChannel work as in a browser. The main process answers what a browser would ask the user (microphone,
screen capture, display access, which pop-ups may open) and imports the login shell's `PATH` so `claude` and `yt-dlp`
are found from the Dock. The port is fixed (47741) because the storage origin includes it. `vite.desktop.config.ts`
bundles the main process and the server code into `dist-desktop/main.js`; `electron-builder.yml` packages `dist/` and
`dist-desktop/` without `node_modules`.

## Invariants

1. **Scenes are addressed by index** in one shared `Scene[]`: the renderer, the projector protocol, the number
   keys and parameter storage all rely on it. Never filter, sort or splice that array; entries are appended
   or soft-removed (`removed: true`). React keys use `scene.id`.
2. **Canvases never move in the DOM.** Moving `<canvas>` would create a new WebGL context and lose every
   program, the trails and the recording stream. The studio pins the main canvas over its Live box with CSS.
3. **Nothing per-frame allocates or touches layout.** The renderer reuses its uniform objects, learns its
   size from a `ResizeObserver`, uploads video frames with `texSubImage2D` once per decoded frame, compiles
   shaders in the background (`KHR_parallel_shader_compile`) and reads snapshots back through a pixel buffer
   and a fence. Meters animate with `transform`.
4. **Persistence is validated.** Every `localStorage` key is listed in `src/state/persistence.ts` and parsed
   with a zod schema on the way in; bursts of writes (slider drags, graph edits) are coalesced.
5. **One shortcut registry.** `src/hotkeys/registry.ts` declares every binding with the condition it is
   active under; `useAppHotkeys` registers only the enabled ones (so shared keys never conflict) and `<Kbd>`
   renders the badge. A unit test proves no two bindings can be live on the same key at once.
6. **The assistant's tools run in the browser**, defined once with zod in `src/assistant/tools.ts`. Errors are
   thrown and become error tool results; changes register an undo.
7. **Overlays lay out around the widgets through one contract.** They read `--dock-*` and `body[data-widgets]`
   only, never a widget's selector, and stack with the `--z-*` scale; the studio's pinned Live canvas (`--z-live`)
   stays above every floating widget.
8. **The subscription backend is locked down.** `server/claude-cli-adapter.ts` spawns `claude -p` with
   `--tools ''` (no files, no shell), `--strict-mcp-config` (only this app's MCP server),
   `--setting-sources ''` (none of the user's CLAUDE.md, hooks or plugins), `--disable-slash-commands`, and a
   throw-away working directory. Do not add `--safe-mode`: it silently disables MCP servers, which is how
   the app's tools reach the model. `server/probes/claude-code-lockdown.mjs` documents why TanStack's own
   Claude Code adapter is not used.
9. **The server handlers are host-agnostic.** `server/` exports plain `(req, res)` handlers that the Vite dev /
   preview server and the desktop app's own server both mount; anything server-side goes there, not into a
   Vite-only hook.

## Data flow per frame

`AudioEngine.update` → band energies, beat → `AppController.frame` eases the clock, updates mood and the
colour grade, fills one reused `ProgramState` → `Renderer.render` (scene pass → feedback pass → display
pass) → `OutputLink.sendFrame` when a projector is connected → `hooks.onFrame` (studio preview and master
fader) → every second frame: publish meters to the UI store.

## Assistant flow

API key: `useChat` → `POST /api/assistant` (AG-UI body) → `chat({ adapter: anthropicText, tools: definitions })`
→ the model calls a tool → the server pauses → the browser runs the `.client()` implementation → the run
resumes with the result.

Conversations: `AssistantSession` (`src/assistant/conversations.ts`, outside React like the studio) owns one
`ChatClient` per conversation, so several run at once and keep running while another is on screen. They share one
tool lock (`lock.ts`: their tools act on one app, one at a time) and one undo stack (an undo closure restores a
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
- **An assistant tool:** define it in `src/assistant/tools.ts`, implement it in `src/assistant/executor.ts`,
  add a `.client()` wrapper in `client-tools.ts` and a verb in `VERBS`.
- **A shortcut:** add it to `HOTKEYS` with a `when` condition, wire the action in `useAppHotkeys` / `App.tsx`,
  and put `<Kbd hotkey={HOTKEYS.x} />` on the control it triggers.
- **A persisted value:** add the key to `KEYS`, a zod schema, and read it with `readJSON(key, schema, fallback)`.

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run test:e2e
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json   # with the dev server running
```

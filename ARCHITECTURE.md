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
- **Sessions** for the bigger panels live outside React state: `EditorCore` (compiling and saving code),
  `StudioSession` (cues, Preview/Live, master), the visual maker's `GraphSession`. They mutate themselves and
  bump a version the component re-renders on.

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
7. **The subscription backend is locked down.** `server/claude-cli-adapter.ts` spawns `claude -p` with
   `--tools ''` (no files, no shell), `--strict-mcp-config` (only this app's MCP server),
   `--setting-sources ''` (none of the user's CLAUDE.md, hooks or plugins), `--disable-slash-commands`, and a
   throw-away working directory. Do not add `--safe-mode`: it silently disables MCP servers, which is how
   the app's tools reach the model. `server/probes/claude-code-lockdown.mjs` documents why TanStack's own
   Claude Code adapter is not used.

## Data flow per frame

`AudioEngine.update` → band energies, beat → `AppController.frame` eases the clock, updates mood and the
colour grade, fills one reused `ProgramState` → `Renderer.render` (scene pass → feedback pass → display
pass) → `OutputLink.sendFrame` when a projector is connected → `hooks.onFrame` (studio preview and master
fader) → every second frame: publish meters to the UI store.

## Assistant flow

API key: `useChat` → `POST /api/assistant` (AG-UI body) → `chat({ adapter: anthropicText, tools: definitions })`
→ the model calls a tool → the server pauses → the browser runs the `.client()` implementation → the run
resumes with the result.

Subscription: the same route picks `ClaudeCliAdapter` → it spawns the CLI with an MCP config pointing back at
`/api/assistant/mcp` → a tool call arrives as an MCP `tools/call` → the adapter emits a `hallucinate.tool_call`
custom event on the chat stream → the browser runs the same implementation and answers via
`POST /api/assistant/tool-result` → the adapter emits the tool result chunk and returns the MCP result.

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

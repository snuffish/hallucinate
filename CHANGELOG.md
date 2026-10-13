# Changelog

## Unreleased — React + TypeScript port (2026-10-13)

### Changed

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

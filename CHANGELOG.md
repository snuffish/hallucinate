# Changelog

## Unreleased — assistant undo (2026-10-16)

### Fixed

- Undoing the assistant's transition, autopilot, parameter, look or code change refuses (with a message) once you or
  the director changed the same thing after it, instead of silently overwriting your change. Before, only show edits
  were checked.
- Undoing a plan also switches the autopilot back off when the plan switched it on.
- Undoing a parameter change resets only the parameters the assistant set, not every parameter of the scene.
- Undoing a new scene leaves it alone once you edited its code.

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

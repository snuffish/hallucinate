# 🛠️ Development

[← Back to the README](../README.md)

## Running

```sh
npm install
npm run dev      # → http://localhost:5173 (localhost only; PORT changes the port, HOST=0.0.0.0 exposes it, see below)
npm run build    # → dist/
npm run preview  # serve the built app (the SoundCloud / YouTube bridges and the assistant work here too)
npm run desktop  # the same app as a desktop window (Electron); see desktop.md
```

Needs Node 22.12 or newer. SoundCloud and YouTube need [yt-dlp](https://github.com/yt-dlp/yt-dlp) (and ffmpeg for
YouTube); the assistant needs a [Claude backend](assistant.md#setup).

`HOST=0.0.0.0` opens the app, its SoundCloud / YouTube downloads and the assistant (on your Claude account) to
everyone on your network, so use it only on a network you trust. Open it by IP address (`http://192.168.1.20:5173`);
to use a host name, list it in `ALLOWED_HOSTS` (comma-separated). The `/api` routes only answer the app's own
pages, never another website.

## Checks

```sh
npm run lint        # ESLint (TypeScript + React hooks rules)
npm run typecheck   # tsc for the app and the server
npm test            # Vitest unit tests (parameters, node compiler, scene list, hotkeys, persistence, assistant plumbing)
npm run test:e2e    # Playwright: boot, scenes, every panel, library keys, widgets & layout, help, params, randomize, backup, studio, assistant chats
npm run test:e2e:desktop   # builds the desktop app and drives it (needs a GPU, so not in CI; lint, typecheck, unit and e2e are)
ASSISTANT_E2E=1 npx playwright test e2e/assistant.spec.ts   # one real assistant round-trip (uses your Claude backend)
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json   # performance probe, with the dev server running
node perf/measure.mjs http://localhost:5173/ perf/results/<name>.json --gpu   # same on the real GPU (opens a window), plus a GPU test of every scene
```

The README screenshots are taken by `scripts/screenshots.mjs` (run it with the dev server up).

## 🏗️ How it works

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the structure, the invariants and how to add scenes, blocks, tools and
shortcuts; [PERF.md](../PERF.md) for the performance work and measurements; [CHANGELOG.md](../CHANGELOG.md) for what
changed in the React port. In short:

- `src/scenes/` – the built-in scenes (one module each, listed in key order in `index.ts`), the shared shader header and the new-scene template.
- `src/engine/` – the engines (WebGL pipeline, audio analysis, `@param` parsing, visual-maker compiler, media, projector link), plain TypeScript classes.
- `src/app/` – the controller that owns them and the frame loop, the editor / studio / player logic, the React shell.
- `src/components/` – the panels, with the dockable widgets in `src/components/widgets/`; `src/hotkeys/` – the shortcut
  registry and the key badge; `src/help/` – the help topics; `src/state/` – app state, UI store, widget layout, persistence.
- `src/assistant/` – the assistant's tools (zod definitions, browser implementations, undo), its conversations and their history.
- `server/` – the yt-dlp bridges, the TanStack AI chat route, the two Claude backends and the system prompt.
- `src/output.ts` / `output.html` – projector windows.
- `desktop/` – the Electron main process and the local server it starts.

Adding a scene = a module in `src/scenes/` that builds it with `scene(name, category, description, glsl)`, listed in `SCENES` in `src/scenes/index.ts` (in key order). It uses only the scene inputs and the shared header's helpers (draw its lines with `beam(d, w)`); a helper two scenes need goes into `src/scenes/header.ts`. `e2e/builtin-scenes.spec.ts` checks every listed built-in against the laser-show checklist ([ADR 0001](adr/0001-replace-all-built-in-scenes.md)): it compiles, its category has a tab, it has 3–8 parameters, its edges are pure black in silence, and a kick makes under a quarter of the frame more than twice as bright.

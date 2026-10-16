# 🖥 Desktop app & web demo

[← Back to the README](../README.md)

## Desktop app

Hallucinate also runs as a desktop app, built with [Electron](https://www.electronjs.org/). Everything works in it,
including SoundCloud, YouTube, the AI assistant and the Director: the app starts the same local server the dev server
provides and opens the app in its own window, so no terminal or browser is needed.

```sh
npm run desktop       # develop: the desktop window on the Vite dev server, with hot reload
npm run package:dir   # build the app unpacked into release/ (quick to try: release/mac-arm64/Hallucinate.app)
npm run package       # build the installer for this OS into release/ (.dmg + .zip, .exe, or .AppImage)
```

Installers for macOS (Apple silicon and Intel), Windows and Linux are also built by
[`.github/workflows/release.yml`](../.github/workflows/release.yml) once the checks pass: on a `v*` tag they are attached
to that tag's [GitHub Release](https://github.com/snuffish/hallucinate/releases); a run started by hand from the Actions
tab keeps them as run artifacts.

- **Unsigned.** The builds aren't code-signed. On macOS, open the app the first time with right-click → *Open*; Windows
  SmartScreen asks once too.
- **`claude`, `yt-dlp` and `ffmpeg`** are found through your login shell's `PATH`, also when the app is started from the
  Dock or a menu. The app's own settings are read from your shell profile too: `CLAUDE_BIN` and `YTDLP` point at a
  specific binary, `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) selects the API backend, and the `ASSISTANT_*`
  settings apply. Nothing else is taken from the shell, and a value the app was started with wins.
- **Settings → Assistant** sets the connection, model and effort without touching your shell profile, and keeps an API
  key encrypted with the system keychain (macOS Keychain, Windows DPAPI, the Linux secret service). A shell variable
  still wins and locks that field. On Linux without a keyring the key field is off; use `ANTHROPIC_API_KEY`.
- **Your data** (scenes, shows, settings, assistant conversations) lives in the app's own profile, separate from the
  browser's and from `npm run desktop`'s. Move a setup between them with *☰ → Export scenes & settings* and *Import…*
  (see [Back up & move your setup](backup.md)); assistant conversations don't move that way, but each one can be
  exported as Markdown from the conversation list. The app serves itself on `http://127.0.0.1:47741`; if that port is
  taken it says so and runs on another one, without your saved data, until the port is free again.
- **System audio** (*Tab / system audio*): on Windows it captures everything playing. On macOS it opens the system's
  screen-sharing picker; whether sound comes along depends on the macOS version. On Linux, Electron can't capture
  system audio; use the microphone / line-in or a loopback device instead.
- **Projectors** work as in Chrome: *Detect displays* lists the screens without asking, and projector windows are
  ordinary app windows.

## 🌐 Web demo

**[https://snuffish.github.io/hallucinate/](https://snuffish.github.io/hallucinate/)** runs the app straight from
GitHub Pages. Everything that runs in the browser works: audio files, mic, tab audio, the demo beat, all scenes, the
editor, the visual maker, and the studio with projector windows. SoundCloud, YouTube, the AI assistant and
the studio director need the local server, so the demo hides them or points you to `npm run dev`.

It is deployed by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push to `main`. To build the
same thing locally:

```sh
VITE_STATIC_DEMO=1 BASE_PATH=/hallucinate/ npm run build   # → dist/, served from /hallucinate/
```

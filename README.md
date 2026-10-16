<h1 align="center">
  <a href="https://snuffish.github.io/hallucinate/"><img src="docs/screenshots/hallucinate-social-preview.jpg" alt="The Hallucinate start screen: pick an audio source, or drop a file" width="100%"></a>
  <br>
  Hallucinate
</h1>

<p align="center">
  <b>Psychedelic, audio-reactive visuals for your music, rendered in real time with WebGL2 shaders.</b><br>
  scenes that follow the beat · a live GLSL editor · a node-based visual maker · an OBS-style studio with projector output ·<br>
  an AI assistant that writes and fixes scenes for you, inside the app.
</p>

<p align="center">
  <a href="https://snuffish.github.io/hallucinate/"><b>▶ Try it in your browser</b></a> — the web demo has everything except SoundCloud, YouTube, the AI
  assistant and the studio's AI Director, which need the local server (<code>npm run dev</code>).
</p>

<p align="center">
  <a href="https://snuffish.github.io/hallucinate/"><img alt="Live demo" src="https://img.shields.io/badge/demo-snuffish.github.io%2Fhallucinate-ff4fd8?logo=githubpages&logoColor=white"></a>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white">
  <a href="docs/desktop.md"><img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white"></a>
  <img alt="WebGL2" src="https://img.shields.io/badge/WebGL2-GLSL%20ES%203.00-990000?logo=webgl&logoColor=white">
  <img alt="TanStack AI" src="https://img.shields.io/badge/TanStack-AI%20%C2%B7%20Hotkeys%20%C2%B7%20Markdown-ff4154">
  <img alt="Tests" src="https://img.shields.io/badge/tests-vitest%20%2B%20playwright-6e9f18">
  <a href="https://github.com/snuffish/hallucinate/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/snuffish/hallucinate/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

## 🚀 Quick start

```sh
npm install
npm run dev      # → http://localhost:5173
npm run desktop  # or run it as a desktop app (Electron)
```

Needs Node 22.12 or newer. SoundCloud and YouTube also need [yt-dlp](https://github.com/yt-dlp/yt-dlp) (and ffmpeg),
and the AI assistant needs a Claude subscription or an Anthropic API key ([setup](docs/assistant.md#setup)).
Press **?** in the app for help and every shortcut.

## ✨ Scenes: a laser show

The built-in scenes are a new set built for one style, a laser show: thin luminous lines on pure black
([ADR 0001](docs/adr/0001-replace-all-built-in-scenes.md)). The first is **Beam Fan**, and more are on the way. Write
your own scenes in the code editor or the visual maker, or ask the assistant for one.

## 🎛 Features

<img src="docs/screenshots/main.jpg" alt="A scene playing with the panel's widgets on the left (Source, Media, Audio, Scene) and its live parameters on the right" width="100%">

| | Feature | |
| --- | --- | --- |
| 🎧 | **[Audio](docs/audio.md)** | Play a file, SoundCloud, the mic, a browser tab or the built-in demo beat. A full player with tempo, and *synesthesia* that colours the visuals by how the music sounds. |
| 🎬 | **[Scenes](docs/scenes.md)** · L | A laser-show set, growing (Beams, Geometry, Fields and Media). Your scenes crossfade on the beat, in a searchable library with favourites. |
| 🧑‍💻 | **[Code editor](docs/editor.md)** · E | Edit any scene's GLSL live, with errors shown as you type. Tag a value with `// @param` and it becomes a slider (P). |
| 🧩 | **[Visual maker](docs/visual-maker.md)** · N | Build scenes by wiring blocks together, then send the result to code. |
| 🖼️ | **[Media](docs/media.md)** | Drop an image or video, or pick one from YouTube, and sample it in any scene with `media(p)`. |
| 📺 | **[Studio & projector](docs/studio.md)** · O | An OBS-style Preview / Live studio with projector windows, fades, an autopilot that counts beats, and an AI Director that plans the set. |
| ✦ | **[AI assistant](docs/assistant.md)** · I | Claude writes and fixes scenes, sets parameters and runs the studio for you, across several conversations. |
| 🪟 | **[Interface](docs/interface.md)** | Dockable, resizable widgets with a remembered layout, and help on every panel. |
| ⚙ | **[Settings](docs/settings.md)** · , | Render quality, microphone processing and when the controls hide, for this computer. |
| 💾 | **[Back up](docs/backup.md)** | Export everything you made to one file and import it elsewhere. |
| 🖥 | **[Desktop app](docs/desktop.md)** | The whole app in its own window, with installers for macOS, Windows and Linux on the [releases page](https://github.com/snuffish/hallucinate/releases). |

More: [keyboard shortcuts](docs/keys.md) · [development & project structure](docs/development.md) ·
[ARCHITECTURE.md](ARCHITECTURE.md) · [PERF.md](PERF.md) · [CHANGELOG.md](CHANGELOG.md)

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/studio.jpg" alt="The studio: Preview and Live monitors, Take with cut or fade, show scenes and projector controls" width="100%"><br><sub><b>Studio</b> · Preview, Live and projectors</sub></td>
    <td align="center"><img src="docs/screenshots/assistant.jpg" alt="The assistant panel over a running scene" width="100%"><br><sub><b>AI assistant</b> · scenes and shows on request</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/editor.jpg" alt="The live GLSL editor next to the scene it edits" width="100%"><br><sub><b>Code editor</b> · live GLSL</sub></td>
    <td align="center"><img src="docs/screenshots/visual-maker.jpg" alt="The visual maker: a block graph rendering live behind it" width="100%"><br><sub><b>Visual maker</b> · scenes from blocks</sub></td>
  </tr>
</table>

## 📄 License

[MIT](LICENSE). Audio and video fetched through yt-dlp stay under their owners' terms; see [Audio sources](docs/audio.md#audio-sources).

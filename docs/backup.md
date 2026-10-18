# 💾 Back up & move your setup

[← Back to the README](../README.md)

## Export

**☰ → Export scenes & settings** saves everything you made and set up to one `.json` file: your saved scenes, your
edits to built-in scenes, *My Shader*, the visual maker graph, live parameter values, the Studio show (cues with
their effects and backgrounds, plan, autopilot and director settings), favourites and the auto-switch rotation, volume and *pitch follows tempo*, the
widget layout and *Use the video's sound*.

It doesn't include recently played tracks, the loaded media, the assistant's conversations
(export one as Markdown from the conversation list instead), the Look sliders, which aren't saved between sessions
anyway, or the device [settings](settings.md) (render quality, microphone processing, when the controls hide), which
belong to the computer rather than the setup. Files over 5 MB aren't imported.

## Import

**☰ → Import…** (or drop the `.json` file on the page) replaces those with the file's and reloads the app.

- Before anything changes, your current setup is downloaded as `hallucinate-before-import-….json`, so an import can
  always be undone by importing that file.
- Sections missing from the file stay as they are.
- A file that doesn't check out (made by a newer version, or edited by hand into something invalid) is refused and
  nothing is changed.
- Other open Hallucinate tabs reload with the import, so they can't write their old state back.

The [desktop app](desktop.md) keeps its data apart from the browser's; export and import is how you move a setup
between them.

## Shaders that don't compile here

Shaders that don't compile on this computer (another GPU or driver, or a different app version) aren't lost: the
library lists them under **Doesn't compile here**, where *Fix in editor* loads one into *My Shader*; save it to the
library under the same name once it works. They stay saved, and in your exports, until you delete them.

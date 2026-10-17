# 🎧 Audio: sources, player & synesthesia

[← Back to the README](../README.md)

## Audio sources

- **File** – click *Open audio file* or drag & drop any mp3/wav/flac/ogg/m4a onto the page.
- **SoundCloud** – search SoundCloud, or paste a track / playlist / artist link, and click a result.
  The picker opens on your *recently played* tracks (last 25; *Recent* brings the list back, *Clear history*
  forgets it), so you can replay one without searching again. Results play in order like a queue. Needs
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed (`sudo pacman -S yt-dlp` or `pip install yt-dlp`): the local
  server fetches the track into a temp cache (`$TMPDIR/hallucinate-soundcloud`) so the browser can analyse it, which
  SoundCloud's own embedded player doesn't allow. Some tracks (SoundCloud Go+ / region-locked) can't be fetched.
  For personal use; respect artists' rights.
- **Microphone / line-in** – reacts to whatever the mic hears.
- **Tab / system audio** – share a browser tab (Spotify web, YouTube, SoundCloud…) or your screen and tick
  *Share audio* (Chromium-based browsers). In the [desktop app](desktop.md) this depends on the OS.
- **Demo beat** – a built-in synthesised techno loop.
- **A video's sound** – see [Media](media.md#youtube).

## ⏯ Audio player

Files and SoundCloud tracks get a player in the panel: seek bar, play/pause, ±10 s, previous / next track
(SoundCloud results act as the queue; ⏮ restarts the track after 3 s), loop, volume and mute, and **tempo**
from 0.5× to 2× (click the value or double-click the slider to reset). By default tempo keeps the pitch;
tick *Pitch follows tempo* for a vinyl / nightcore effect. The demo beat gets play/pause, volume and tempo (its BPM).
Volume is applied after the analyser, so the visuals react the same at any listening volume, even when muted.

## 🌈 Synesthesia (sound ↔ light mapping)

<img src="screenshots/look-drift.jpg" alt="The Look widget: reactivity, speed, trails, colour, synesthesia and the other sliders, with Drift and its speed switched on" width="220" align="right">

Based on crossmodal-correspondence research (people reliably pair loud ↔ bright, high/bright timbre ↔ light and
warm, low/muffled ↔ dark and cool, fast/energetic music ↔ saturated warm colours).

- **Tone** – the spectral centroid (loudness-weighted average frequency) mapped from ~1.1 kHz (dark: piano,
  ambient) to ~5.5 kHz (bright: hi-hat-heavy house, psytrance) and smoothed over a few seconds. Shown in the panel.
- **Mood** – tempo (80 → 160 BPM) plus how loud the music is over the last few seconds, smoothed over ~4 s more.
  When nothing plays, mood and tone both drift back to neutral.
- **Synesthesia slider** – how strongly the tone and the mood grade every scene: dark sound → dimmer, cooler, hazier,
  longer trails; bright sound → lighter, warmer, crisper, more colour fringing; energetic mood → more saturated and
  warmer. At 0 it is off: the picture's colour is left untouched. Trails and fringing only grow or shrink from what you
  set, so at 0 they stay at 0.
- Both values are also available to your own shaders (`uBright`, `uMood`) and as *tone* / *mood* outputs on the
  visual maker's Audio block.

## 🎨 The Look widget

Look sliders: Reactivity, Speed, Trails, Colour, Colour cycling, Synesthesia, Fringing and Drift
speed. Resolution isn't part of the Look: it is in [Settings → Display & performance](settings.md#display--performance)
(lower it if frames drop).

The app opens with a laser look:

| Slider | Default | Randomize and Drift pick from |
|---|---|---|
| Reactivity | 1 | 0.6–1.4 |
| Speed | 1 | 0.5–1.6 |
| Trails | 0.35 | 0–0.6 |
| Colour | 0 | 0–1 |
| Colour cycling | 0.2 | 0–1 |
| Synesthesia | 0.3 | 0–0.6 |
| Fringing | 0 | 0–0.006 |

By hand every slider still reaches its full range.

- **Fringing** – how far each line splits into red, green and blue copies towards the edges of the picture.
- **Trails** – an afterglow: a line keeps glowing where it was drawn and fades there, without moving. At 0 there is
  no afterglow; higher values fade more slowly. The trail keeps the line's colour.
- **Drift** – the Look sliders glide to new random values on their own, each at its own pace, so the look keeps
  changing smoothly; *Drift speed* sets how fast. A slider you move by hand drifts on from there.
- **Randomize** (R) jumps the Look sliders to new values in the ranges above instead. Tick *Randomize also picks a random
  scene* to change the scene too. Shift+R steps back to the look (and scene) before each randomize, up to 20 steps.

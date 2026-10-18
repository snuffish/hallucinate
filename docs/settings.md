# ⚙ Settings

[← Back to the README](../README.md)

Open Settings with **⚙** in the Hallucinate widget, **☰ → Settings…**, or the **,** key. Esc closes it.

Settings hold how *this computer* renders, listens and shows the controls, and how the assistant reaches Claude. They
are defaults, not live controls (the player keeps volume and tempo), with one exception: Display & performance is the
live control for how the picture renders, and a change there applies at once.
Display, Audio and Interface are kept in this browser (or in the [desktop app](desktop.md)'s own profile), Assistant
on the local server. None of them are in Export: a setup moved to a projector laptop shouldn't bring the GPU and
microphone settings of the computer it came from.

## Display & performance

These apply at once, so you can recover mid-show when frames start dropping.

| Setting | What it does | Default |
| --- | --- | --- |
| Resolution | The share of the screen's pixels the scenes render at: on the main screen, in the studio's Preview monitor (so Preview looks exactly like Live) and in every projector window. At 100 % laser lines stay one pixel thin; lower is faster and softer. Randomize and Drift leave it alone. | 100 % |
| Pixel density | Caps the pixel ratio everything renders at: the main screen, the studio's Preview monitor and every projector window. On a HiDPI screen 1× draws a quarter of the pixels of 2×: much faster, a little softer. | Up to 2× |

If the frame rate drops, lower these first; the [performance monitor](../PERF.md) (Shift+P) says whether the GPU is
what holds it back.

## Audio

| Setting | What it does | Default |
| --- | --- | --- |
| Smoothing | How much the bands and the spectrum average the sound over time: higher is calmer, lower follows every transient. Kicks and the tempo are heard the same at any setting. Live. | 0.60 |
| Echo cancellation, Noise suppression, Automatic gain | The browser's voice processing for the microphone / line-in. Off, because it ducks and gates music; turn them on for a laptop mic in a noisy room. They apply when the microphone starts: with the mic on, *Restart the microphone* applies them now. | Off |
| Use the video's sound as the music | The same switch as in the YouTube picker. | Off |

## Interface

| Setting | What it does | Default |
| --- | --- | --- |
| Hide the controls | How long the controls stay up while music plays and the mouse is still: 3, 5, 10 or 30 s, or never. H hides them at any time. | 3 s |
| Show shortcut badges | The small key labels on buttons. The shortcut sheet (?) always lists every key. | On |
| Show the assistant's reasoning | The same switch as 💭 in the assistant's panel. | Off |

*Reset layout* (Shift+H) puts every widget back, and *Show the "Press ? for help" hint again* brings back the first-start
hint.

## Assistant

These live on the local server, not in the browser, and apply to the next reply without a restart.

| Setting | What it does |
| --- | --- |
| Connection | Automatic (an API key if there is one, else Claude Code), the Anthropic API, or your Claude subscription through Claude Code. |
| Model | Empty for the default (`claude-opus-5-5` on the API, Claude Code's own otherwise). The API takes Anthropic's model ids; Claude Code also takes aliases like `opus`. |
| Effort, Director effort | `low` … `max`. Lower is faster and uses fewer tokens. The Director's follows Effort unless set. |
| API key | Desktop app only: encrypted with your system's keychain and never shown again. With `npm run dev`, export `ANTHROPIC_API_KEY`. |

An environment variable the server was started with (`ASSISTANT_MODEL`, `ANTHROPIC_API_KEY`, …) wins, and Settings shows
that field as locked. The `claude` and `yt-dlp` programs are shown but can only be set with `CLAUDE_BIN` and `YTDLP`.
Assistant settings can only be changed on the computer Hallucinate runs on. See [AI assistant](assistant.md#setup).

## Data

*Export scenes & settings* and *Import…* are the same as in the ☰ menu ([Back up & move your setup](backup.md)).
*Clear recently played* forgets the SoundCloud and YouTube pickers' recent lists. *Reset settings to defaults* resets
Display, Audio and Interface; your scenes, show, layout and the Assistant settings stay as they are.

## Several tabs

A change in one Hallucinate tab shows up in the others at once, so closing an older tab never undoes it.

# ⚙ Settings

[← Back to the README](../README.md)

Open Settings with **⚙** in the Hallucinate widget, **☰ → Settings…**, or the **,** key. Esc closes it.

Settings hold how *this computer* renders, listens and shows the controls. They are defaults, not live controls: the
Look widget keeps the Resolution slider and the player keeps volume and tempo. They are kept in this browser (or in the
[desktop app](desktop.md)'s own profile) and are **left out of Export**: a setup moved to a projector laptop shouldn't
bring the GPU and microphone settings of the computer it came from.

## Display

| Setting | What it does | Default |
| --- | --- | --- |
| Start resolution | Where the Look widget's Resolution slider starts each time Hallucinate opens. Takes effect at the next start. | 75 % |
| Pixel density | Caps the pixel ratio everything renders at: the main screen, the studio's Preview monitor and every projector window. On a HiDPI screen 1× draws a quarter of the pixels of 2×: much faster, a little softer. | Up to 2× |

If the frame rate drops, lower these first; the [performance monitor](../PERF.md) (Shift+P) says whether the GPU is
what holds it back.

## Audio

| Setting | What it does | Default |
| --- | --- | --- |
| Smoothing | How much the analysis averages the sound over time: higher is calmer, lower follows every transient. Live. | 0.60 |
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

Shows which way Hallucinate reaches Claude and with which model. See [AI assistant](assistant.md#setup) for setting it up.

## Data

*Export scenes & settings* and *Import…* are the same as in the ☰ menu ([Back up & move your setup](backup.md)).
*Clear recently played* forgets the SoundCloud and YouTube pickers' recent lists. *Reset settings to defaults* resets
everything on this page; your scenes, show and layout stay as they are.

## Several tabs

A change in one Hallucinate tab shows up in the others at once, so closing an older tab never undoes it.

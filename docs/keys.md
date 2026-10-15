# ⌨️ Keys

[← Back to the README](../README.md)

Press **?** in the app for the same list. Every button with a shortcut also shows its key as a badge.

| Key | Action |
| --- | --- |
| Space | play / pause |
| Shift + ← / → | seek −10 s / +10 s |
| ↑ / ↓ | volume |
| [ / ] | tempo −5 % / +5 % |
| M | mute |
| ← / → , 1–9, 0 | change scene (← / → steer in the game) |
| L | scene library (inside: `/` search, Tab categories, arrows move, Enter play) |
| I | AI assistant (inside: Alt+N new conversation, Alt+↑ / ↓ switch, Ctrl/⌘+K find one) |
| O | studio & projector (inside: 1–9 / ← → preview, T take, Esc close) |
| T | take Preview live |
| B | blackout / restore |
| P | collapse / expand the Parameters widget |
| G | Beat Racer |
| E | shader editor |
| N | visual maker (node graph; Delete or Backspace removes a block) |
| A | toggle auto-switch |
| R | randomize the look (also the scene with *Randomize also picks a random scene* ticked) |
| Shift+R | back to the look before the last randomize (again to step further back) |
| C | start / stop recording (downloads a .webm with audio) |
| F | fullscreen |
| H | hide the controls (they also auto-hide after 3 s of no mouse movement) |
| Shift+H | reset the widget layout |
| ? | help & every shortcut |
| Esc | close the open panel (in the library: leave the search field first) |

The shortcuts are defined in one place, `src/hotkeys/registry.ts`; see [ARCHITECTURE.md](../ARCHITECTURE.md) for how to
add one.

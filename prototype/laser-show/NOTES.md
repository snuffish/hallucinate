# Laser-show prototype: Beam Fan and Light Sheet

PROTOTYPE, throwaway. The question: **does the laser-show direction hold on a projector?**
Paste `beam-fan.glsl` or `light-sheet.glsl` into My Shader as-is. `BPM` fakes ticks until `uTick`/`uTicks` exist;
swapping them in is the one-line `ticks()` change marked in each file.

## Verdict

- **On screen (headless stills, `stills/`): yes.** Both read as lasers: thin lines on black, and nothing lights
  the whole frame.
- **On a projector: not checked yet.** Fill in after a projector run: ______

## What worked

- **Beam Fan.** Lines that keep a constant pixel width plus a short halo look right at any size. The fan opening with the
  bass, the sweep, the tick chase and the kick strobe all read clearly. When the music is quiet it's a narrow, dim fan
  that keeps moving (`stills/beam-fan-quiet.png`).
- **Light Sheet.** Drawing the sheet as scan lines receding to a horizon works. Perspective bunches the lines into a
  bright edge-on line at the horizon for free. The ripple spread across lines (near = bass, far = treble) reads as
  "the spectrum".

## What didn't

- **Haze is invisible at safe levels.** It peaks at about 0.03 before tonemapping. That keeps it from becoming a wash, but
  it vanishes on screen, so Light Sheet comes out as hard lines, not "soft and hazy". This is the main thing to judge on
  the projector. Raising `HAZE` may show a grey veil there instead of haze.
- **Light Sheet's kick lights a large area.** Every line brightens about 1.8×, and the lines cover around 40% of the
  frame. It is not a full-frame flash, but at fast tempos it could break the spirit of the strobe rule. The rule needs an
  area threshold (e.g. "no more than N% of the frame jumps by more than X, more than 3×/s").
- **The display pass adds grain** (±0.0075, `renderer.ts` DISPLAY) to every pixel, so black is never pure. That is
  probably visible as shimmer on a projector in a dark room.

## Measured ms per frame (built-in profiler, 1080p, RTX 3060)

- Beam Fan: ______ ms (estimated well under 1 ms: 3 beam evaluations and 1 spectrum read per pixel)
- Light Sheet: ______ ms (estimated under 1 ms: 28 lines × 1 spectrum read and about 6 trig/exp calls, plus 2 noise calls)

## COMMON candidates (both scenes needed them)

- `beam(d, w)`: a thin luminous line, with a hard core plus a short exponential halo, in pixel units
  (`w = WIDTH / uRes.y`). It is the direction's basic drawing call.
- `ticks()`: becomes `uTick`/`uTicks` once those are scene inputs. No helper is needed then.

## Changes the direction needs

- Add a `beam()` glow-falloff helper to COMMON. Every laser scene will want the same line profile.
- Gate the display grain by brightness (none on black), or "pure black" isn't.
- Haze needs a decision: either drop it from the direction (hard lines only), or make it a lit volume only around
  lines (glow near the sheet) and not a field.
- Define strobe safety by lit area, not "full frame", so that scenes made of many lines are covered.

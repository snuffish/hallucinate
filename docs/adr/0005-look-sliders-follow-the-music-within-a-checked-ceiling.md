# Look sliders follow the music within a checked ceiling

A Look slider can follow the music: Speed, Trails, Colour, Synesthesia or Fringing moves with one part of it (the
bass, mids, highs, level, the kick, the tone or the mood), by a depth either way, through an envelope that rises over
an attack and falls over a release. This is what VJ tools call audio modulation, kept narrow so the safety rules
([ADR 0002](0002-the-look-serves-the-laser-set.md)) still know the worst case:

- A followed slider never goes above the higher of where you set it and the top of its Randomize range. The music
  can't take a slider anywhere you and Randomize couldn't.
- It rises no faster than 50 ms, and Colour no faster than 150 ms and at most ±0.1 of the wheel, so a kick can't swap
  the colour in a frame.
- Reactivity can't follow: it already scales the sound, and following would square it.
- One source per slider, a fixed envelope shape. The worst case is every slider that can follow, following the kick at
  full depth as fast as it may (`STRONGEST_ROUTES`), and the strobe rule checks every scene with it, as a third Look.

This doesn't reopen what [ADR 0003](0003-effects-belong-to-the-show-scene.md) rejected for effects ("any effect setting
following any part of the music"): that was free routing with no known worst case. Here the routing is fixed per
slider and the worst case is named and checked.

## Considered Options

- **Free routing** (any source to any control, curves, LFOs): rejected, as for effects. No known worst case.
- **No ceiling, only a smaller depth**: rejected. A slider set high by hand plus the music could pass every range the
  rules were checked at.
- **Check the worst case only at the default Look**: rejected. The music adds to the sliders, so the strongest Look
  plus the strongest following is the case that matters.

## Consequences

- The `e2e-scenes` job renders a third Look per scene, about half as long again.
- Show scenes don't keep routes yet: Live and Preview follow the screen's. The Look slots do keep them.
- Randomize and Drift move the hand value; the music moves around it.

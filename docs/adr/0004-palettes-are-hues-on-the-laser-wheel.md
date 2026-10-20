# Palettes are hues on the laser wheel

The Look gets a palette: 2–5 colours that every scene's colours walk instead of the whole laser wheel, so a show
scene can stay within, say, blue and magenta. Every scene already takes its colour from `laser(t)`, so the palette
lives there, in the shared shader header, and no scene changes. A palette's colours are **hues on the laser wheel**,
not free RGB colours: between two of them `laser()` walks the hue the short way round the wheel, so every colour it
returns is still a pure, full-strength laser colour. The strongest picture the safety rules check
([ADR 0002](0002-the-look-serves-the-laser-set.md)) therefore stays the same: a palette can only pick from colours
the wheel already shows. A palette can also step: hold each colour and ease to the next over the last 30% of it, so
Colour cycling never switches the colour in one frame.

## Considered Options

- **Free RGB colours**: rejected. A dim colour next to a bright one is a new worst case for the strobe rule, and an
  RGB blend between two pure colours dims the line (red to green passes a dull olive).
- **A palette per scene**: rejected, for the reason effects belong to the show scene ([ADR 0003](0003-effects-belong-to-the-show-scene.md)):
  every use of a scene would share it.
- **Hard steps**: rejected. Cycling across a step would change the colour in one frame, a flash on every step.

## Consequences

- Show scenes keep their palette beside their look. A show saved before palettes takes the app's palette on Live,
  and an older copy of the app drops the field. Nothing is migrated.
- Randomize and Drift leave the palette alone.
- A scene of your own that colours through `laser()` follows the palette; one that uses `rainbow()`, `neon()` or its
  own colours doesn't. `laserWheel(t)` is the whole wheel, whatever the palette.
- The colours of the controls (the Colour swatch, the XY pad, the studio's cue swatches) come from a TypeScript twin of
  the shader's wheel and palette (`src/engine/laser-colour.ts`), kept equal by its tests.

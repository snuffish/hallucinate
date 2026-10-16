# The Look serves the laser set

The Look was built for the old psychedelic set: its defaults smeared, split and recoloured the thin lines that the
laser set ([ADR 0001](0001-replace-all-built-in-scenes.md)) draws on pure black. We tuned the Look for the laser set
instead of keeping it neutral. Trails became an afterglow that stays where the line was drawn, so the old zooming,
spinning trail tunnel is gone. The defaults, and the ranges Randomize and Drift pick from, are set for crisp lines.
The safety rules (strobe, edges 75% black) are checked with the Look applied, at its defaults and at the strongest
values Randomize or Drift can reach.

## Considered Options

- **Keep the trail tunnel and only lower the defaults**: rejected. The tunnel was the old set's look. Even with short
  trails, its zoom pushes light into the edges that must stay black.
- **Make the trail motion a second control**: rejected. It adds a slider that the built-in set never wants.
- **Change `rainbow` to pure colours for every scene**: rejected. The built-in scenes moved to a new laser palette,
  and `rainbow` stays as it was, so your own scenes and visual-maker graphs don't change colour without you knowing.

## Consequences

- A show scene saved with the old long trails now plays as a long afterglow, not a tunnel. Nothing is migrated.
- A scene of your own that relied on the tunnel for its motion loses that motion. It has to make the motion itself.

# Master trims turn down Live

In the studio, a **Master look** row beside the master fader holds Live's master trims: Reactivity, Speed, Trails
and Fringing as a share (0–100%) of what each show scene's look sets, and a colour shift of up to half the wheel either
way. They act on whatever is Live and on the Preview monitor (which shows what Take puts on Live), in the order a
laser desk uses: the show scene's look first, then the master. Neutral (100%, 0°) changes nothing, and they are kept
with the show. Like a lighting desk's grand master, they let the operator tame a whole show at once, say for a smaller
room, without editing every show scene.

## Considered Options

- **The main Look as offsets on every show scene**: rejected. Every slider would mean something different depending on
  whether a show scene is Live, and Take would no longer put a show scene on Live as it was saved.
- **Trims that can also boost (above 100%)**: rejected. A trim that only turns down can only lower what the safety rules
  checked ([ADR 0002](0002-the-look-serves-the-laser-set.md)); a boost would be a new worst case on every show scene.
- **Not now**: rejected. Without it, taming a show means editing each show scene's look.

## Consequences

- The colour shift moves every show scene round the wheel, and with a palette ([ADR 0004](0004-palettes-are-hues-on-the-laser-wheel.md))
  it moves where the colours start along it; the colours stay pure laser colours.
- A show file saved before the trims opens neutral; an older copy of the app drops them. Nothing is migrated.
- The main screen, outside Live, is not trimmed: its Look widget is the main look.

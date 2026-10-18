# The background belongs to the show scene, and sits behind the trails, under the Look

A show scene can have a background: what shows behind its lines instead of pure black. It is one of a colour, a
gradient between two colours, or your media (the dropped image or video). Like the effects
([ADR 0003](0003-effects-belong-to-the-show-scene.md)) it belongs to the show scene, and the main screen keeps its
own next to the Look and the effects. It is drawn in a pass of its own after the trails and before the Look, behind
the lines: where a line is lit, the background gives way. So the Look grades it with the picture, the trails never
smear it, and in a Take each picture keeps its own background through the crossfade. Effects reshape the lines, not
the background.

It stays dim and safe. It shows at most 30% of full brightness, and it fades to black before the border band, the
same way the effects do, so the edges stay as black as the scene keeps them
([ADR 0002](0002-the-look-serves-the-laser-set.md)). It moves only with slow inputs: Breathe dims it in calm music
(the mood) and turns a gradient with the music's clock. It never reads the bass or the kick, which jump on every
hit, so a kick or a tick can't flash it.

## Considered Options

- **A background on the scene**: rejected. Like effects, every use of the scene would share it, so it would not make
  one show scene unique.
- **A background on Live as a whole**: rejected for now. It would carry across a Take instead of belonging to what
  was cued.
- **Drawn before the effects or the trails**: rejected. The effects would fold and bend the background along with
  the lines, and the trails would smear a moving video into the afterglow.
- **Drawn after the Look**: rejected. The crossfade happens before the Look, so the outgoing picture would have to
  borrow the incoming show scene's background, and the Look's grade would not reach it.
- **Moving with the bass or the kicks**: rejected. A background covers most of the frame, so a change on a kick
  would light far more of it than the strobe rule allows.
- **A full-brightness background**: rejected. The laser set draws lines on black; a bright background would drown
  them and light the edges that must stay black.

## Consequences

- Randomize and Drift don't touch the background, and the director and the assistant write show scenes without one.
- A show file with backgrounds opens in an older copy of the app without them. Nothing is migrated.
- Library previews show scenes without a background.
- A media background shows the media without switching to Scan Trace when you load it.

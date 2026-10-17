# Effects belong to the show scene, and shape its picture before the crossfade

To make one show scene look unlike another made from the same scene, a show scene keeps its own effects: built-in
steps such as a mirror or a glow, in order, each switched on or off and each at most once. They shape the scene's
picture before the Take crossfade and before the Look. So in a Take each picture keeps its own effects, unlike the
Look, which the outgoing picture borrows from the incoming show scene. Each effect moves with the music in one fixed
way, scaled by Reactivity. Near the edges every effect fades back to the scene's own picture, so no stack of effects
can light the border that must stay 75% black ([ADR 0002](0002-the-look-serves-the-laser-set.md)).

## Considered Options

- **Effects on the scene**: rejected. Every use of a scene would get the same effects, so they would not make one
  show scene unique.
- **Effects on Live as a whole**, like a filter on OBS's program: rejected for now. They would carry across a Take
  instead of belonging to what was cued. It can come later as a separate feature.
- **Effects after the Look**: rejected. The crossfade happens before the Look, so the outgoing picture would have to
  borrow the incoming show scene's effects.
- **Effects you write yourself**: rejected for now. Only the built-in ones can be checked against the safety rules
  before a show.
- **Any effect setting following any part of the music** (free routing): rejected. Bigger controls, and no known
  worst case to check.
- **Allow an effect twice, or test every combination**: rejected. Two Glows could double the picture on a kick
  where one passes, and every order of every combination is too many to test. Each effect is tested alone at its
  strongest instead, and the edge fade covers any combination.

## Consequences

- Randomize and Drift don't touch effects, and the director and the assistant write show scenes without them.
- A show file with effects opens in an older copy of the app without its effects. Nothing is migrated.
- Library previews show scenes without effects.

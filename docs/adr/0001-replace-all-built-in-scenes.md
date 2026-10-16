# Replace every built-in scene, and drop Beat Racer

The 40 built-in scenes (generative and Media alike) had no shared look and lived in one large file full of copied
shader code, so we removed them all, along with Beat Racer, rather than curating them. A smaller set with one art
direction replaces them, one module per scene. Beat Racer went with them: it was a scene with its own game logic, and
keeping it would have meant keeping one leftover from the old set. It also brought a hotkey, a HUD and assistant actions.

## Considered Options

- **Curate the old set** (keep the best, rewrite the rest): rejected. It keeps the old look as the baseline that every
  new scene has to fit next to.
- **Keep the Media scenes and Beat Racer as features**: rejected. A Media scene is only a shader that reads your media,
  and any new scene can still do that.

## Consequences

- Cues in a saved show that pointed at a removed scene show as "missing scene" and must be re-cued by hand. Favourites,
  parameters and edits saved under old names become inert. Nothing is migrated.
- One of your own scenes named like a new built-in is renamed "Name (mine)" when the app loads, and its parameters,
  favourite, auto-switch exclusion and last-scene mark move with it. Show scenes in a saved show that named it are not
  moved: they now play the built-in of that name.
- Until the new scenes land, the app has no built-in scenes and starts on My Shader.

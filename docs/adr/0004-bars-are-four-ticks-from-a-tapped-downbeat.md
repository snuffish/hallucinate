# Bars are four ticks from a tapped downbeat

Takes, studio steps, plans and the built-in scenes need to land on the bar, but the listener only hears kicks and a
tempo, and gets the tempo wrong in ways no algorithm avoids every time (half or double, kicks between beats). We
decided that a bar is always four ticks, that its downbeat is set by tapping along and then kept by the tick clock,
and that a tempo set by hand wins over the heard one. Until someone taps, bars count from when the tempo was first
heard, so they still keep their place across takes. Ticks re-anchor only on kicks that land near them, so a kick
between beats can no longer shift the bars.

## Considered Options

- **Detect the downbeat from the music**: rejected for now. It needs joint beat and downbeat tracking (the research
  state of the art is a neural model, see [the research note](../research/audio-reactivity.md)), and it would still be
  wrong sometimes with no way to correct it. Tapping is one key and always right. Detection can come later and set the
  same downbeat.
- **Time signatures other than 4/4**: rejected. The laser set's music is four to the bar, and scenes, plans and the
  docs already count in fours.
- **Start bars at each take**, as the studio's beat count did: rejected. Bars would drift against the music's phrases
  after any take made between bars.
- **Let the heard tempo always win**: rejected. A tapped or locked tempo would be overwritten by the next wrong guess.

## Consequences

- A tempo is steady, unsure or none. Anything that waits for a bar (takes, steps, plans) waits only when it is
  steady, and otherwise acts at once or counts in seconds.
- Music in 3/4 or 7/8 gets bars that don't match it. Steps can still be counted in seconds.
- A kick between ticks still jumps the hue and counts towards auto-switch; it just doesn't move the ticks.
- A heard tempo stays folded into 85–175 BPM; Halve and Double leave that range by hand. A locked tempo is not
  forgotten after a long stretch without kicks, so its ticks and bars carry on through an ambient interlude.

# Hallucinate

Live visuals that react to music: what the app hears in the music, and how that becomes what is on screen and on the
projectors.

## The music

**Music**:
The one sound source the visuals react to: a file, a SoundCloud track, a video's sound, the microphone, a shared tab or
the demo beat.
_Avoid_: audio, input, track (a track is one kind of music)

**Playing**:
The music is sounding now. A paused, stopped or finished file is still the music, but not playing; a live input is
playing while connected, even in a quiet room.
_Avoid_: active, on, kind

**Listener**:
What hears the music and says what it sounds like, once a frame.
_Avoid_: analyser, audio engine

**Hearing**:
What the music sounds like right now: its bands, kicks, ticks, tempo, tone, energy and mood.
_Avoid_: features, audio state

**Hearing monitor**:
An overlay that shows the hearing as it happens, why the Listener hears it that way, and the scene inputs the picture
gets from it: the tempo and how sure it is, kicks and ticks as they land, the bands and the spectrum. It only shows,
never changes anything.
_Avoid_: audio monitor, analyser view, debug panel

**Kick**:
A clear bass hit heard in the music, on the beat: the bass notes of a rolling bassline between the kicks are not kicks. Kicks jump the hue, as far as colour cycling allows, and count towards auto-switch.
_Avoid_: beat, onset

**Tick**:
One beat of the steady tempo clock: it runs at the tempo, re-anchors on each kick and keeps going through breakdowns,
but not through long passages without kicks. Ticks drive the studio's autopilot and the director, and only come while
the music is playing.
_Avoid_: beat, tempo beat

**Tempo**:
The music's beats per minute, heard from the gaps between kicks: held through breakdowns, and forgotten when the next
music starts or the music has gone a long while without kicks.
_Avoid_: BPM estimate, playback tempo (that is the playback speed)

**Confidence**:
How sure the Listener is of the tempo: how clearly the kicks repeat at it. It drains while the tempo is held through
a breakdown.
_Avoid_: clarity, certainty

**Tone**:
How bright the music sounds, from dark and muffled to bright and crisp; follows the track over seconds, not single
hits.
_Avoid_: brightness, timbre, bright

**Energy**:
How loud the music is, steadily, over the last few seconds.
_Avoid_: level, loudness, volume

**Mood**:
How energetic the music feels, from calm to energetic: its tempo sets where a track sits, its energy moves it from
moment to moment.
_Avoid_: vibe

## The picture

**Scene**:
A picture that moves with the music, with its own parameters and a category. Built-in scenes ship with the app;
your own are saved from the editor. Any scene may also show your video or images.
_Avoid_: visual, shader, preset

**Effect**:
A built-in step that reshapes a scene's picture, such as a mirror or a glow, moving with the music in its own way. A
show scene keeps its effects in order, each switched on or off, and they shape the picture before the Look does.
_Avoid_: filter (the library's category tabs), layer, FX, post-processing

**Look**:
The sliders that shape how a scene reacts and colours: reactivity, speed, trails, hue, colour cycling, fringing,
synesthesia.
_Avoid_: style, settings

**Reactivity**:
How strongly the picture follows the music's bands and kicks. The tone and the mood are not scaled by it.
_Avoid_: sensitivity, gain

**Trails**:
How long a line keeps glowing where it was drawn after the scene has moved on, like an afterglow.
_Avoid_: feedback, motion trails

**Fringing**:
How far each line splits into red, green and blue copies towards the edges of the picture.
_Avoid_: aberration, chromatic aberration

**Synesthesia**:
How strongly the tone and the mood grade the picture: dark sound dim, cool and lingering, bright sound light, warm
and crisp, energetic music saturated.
_Avoid_: colour grade (that is what it does)

**Drift**:
The Look sliders wandering to random values on their own, each at its own pace, within the Randomize ranges.
_Avoid_: auto-look, wander

**Laser palette**:
The wheel of pure, fully saturated colours that the built-in scenes colour their lines from. Your own scenes can use
it, or the softer rainbow.
_Avoid_: rainbow (that is the softer one)

**Show scene**:
A scene with its parameter values, its effects and the look it keeps, as the studio plays it.
_Avoid_: cue (the code's name for it), preset

**Live**:
The show scene the audience sees: on the projectors, and on the screen while the studio is open.
_Avoid_: program, output

**Preview**:
The show scene that would go Live at the next take, shown exactly as it will look there.
_Avoid_: next, cue

**Scene input**:
A value every scene's shader reads each frame: the music's clock, the bands, the kick pulse, the hue, the tone and
the mood.
_Avoid_: shared uniform, audio uniform

**Take**:
Putting the Preview on Live, as a cut or a crossfade.
_Avoid_: go, switch

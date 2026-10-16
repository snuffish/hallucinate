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

**Kick**:
A clear bass hit heard in the music. Kicks jump the hue, drop Beat Racer's walls and count towards auto-switch.
_Avoid_: beat, onset

**Tick**:
One beat of the steady tempo clock: it runs at the tempo, re-anchors on each kick and keeps going through breakdowns.
Ticks drive the studio's autopilot and the director, and only come while the music is playing.
_Avoid_: beat, tempo beat

**Tempo**:
The music's beats per minute, heard from the gaps between kicks and held until the next music starts.
_Avoid_: BPM estimate

**Tone**:
How bright the music sounds, from dark and muffled to bright and crisp; follows the track over seconds, not single
hits.
_Avoid_: brightness, timbre, bright

**Energy**:
How loud the music is, steadily, over the last few seconds.
_Avoid_: level, loudness, volume

**Mood**:
How energetic the music feels, from calm to energetic: mostly its tempo, partly its energy.
_Avoid_: vibe

## The picture

**Look**:
The sliders that shape how a scene reacts and colours: reactivity, speed, trails, hue, colour cycling, fringing,
synesthesia.
_Avoid_: style, settings

**Reactivity**:
How strongly the picture follows the music's bands and kicks. The tone and the mood are not scaled by it.
_Avoid_: sensitivity, gain

**Synesthesia**:
How strongly the tone and the mood grade the picture: dark sound dim, cool and lingering, bright sound light, warm
and crisp, energetic music saturated.
_Avoid_: colour grade (that is what it does)

**Show scene**:
A scene with its parameter values and the look it keeps, as the studio plays it.
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

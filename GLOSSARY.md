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

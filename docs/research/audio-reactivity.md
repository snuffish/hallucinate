# Audio reactivity: how the listener hears the music, and what to do with it

Research note, 2026-10-18, at commit `e2b5b73`. Terms follow [GLOSSARY.md](../../GLOSSARY.md): the **music** is heard
by the **listener**, which reports a **hearing** (bands, **kicks**, **ticks**, **tempo**, **tone**, **energy**,
**mood**) once a frame; scenes read it as **scene inputs**. "Onset", "beat" and "BPM" appear only where this note
talks about the literature or about code identifiers that use those words.

## Summary

- **One small pipeline, on the main thread.** A single Web Audio `AnalyserNode` (fftSize 2048, smoothing 0.6, default
  -100/-30 dB range) feeds a pure `Listener` once per `requestAnimationFrame`, and the result is written into every
  output's frame by `composeFrame` (src/engine/audio.ts:30-34, src/app/controller.ts:916-928, src/engine/look.ts:36).
  No worklet, no library: package.json lists no DSP dependency.
- **Kicks are a bass-energy threshold, not an onset detector.** A kick fires when the mean 25-140 Hz byte level rises
  12% (+0.02) above its 1 s average, re-armed with hysteresis and capped at one per 0.28 s (src/engine/listener.ts:118-126,
  :13). Nothing measures change across the spectrum (spectral flux) or the high bands.
- **The tempo is the median gap between the last 12 kicks, with no octave handling and no confidence.** It is rounded
  to an integer and replaced on every kick after the fifth (src/engine/listener.ts:132-141). Missed or off-beat kicks
  change it directly; nothing folds it into a sensible range or says how sure it is.
- **The tick clock is good engineering on a weak signal.** `TempoClock` keeps counting through breakdowns and re-anchors
  on kicks (src/state/tempo-clock.ts:32-53), but any kick at least half a beat after the last tick re-anchors it, so a
  syncopated kick can shift the phase by half a beat. There is no bar or downbeat: `uTicks` counts from wherever it
  started, while scenes and plans already assume 4-tick bars (src/scenes/wire-solid.ts:43, src/state/show-plan.ts:14).
- **Monitoring today is a meter strip:** three band bars, a tone marker, a kick dot, "~N BPM" and a mood word, at
  about 30 Hz (src/components/widgets/sections.tsx:80-97, src/app/controller.ts:946-953). There is no spectrum view,
  no kick versus tick display, no tempo confidence, no tap tempo and no latency figure.
- **Tests are good for what exists:** synthetic-bin unit tests for tempo, ticks, breakdowns, frame rate and tone
  (src/engine/listener.test.ts:41-178), the tick clock (src/state/tempo-clock.test.ts), and one e2e check that `uTick`
  and `uTicks` sweep on the demo beat (e2e/tick.spec.ts:24-41). No test uses real recordings or syncopated rhythms.
- **Top recommendations:** (1) a Listener monitor panel with a recorded analysis trace; (2) tap / halve / double /
  lock tempo, plus octave folding and a confidence value; (3) a bar counter (downbeat set by tap, then kept by the
  tick clock) so takes and plans land on the bar as docs/studio.md:72 already promises.

## Current pipeline walkthrough

```
 music source                     AudioEngine (src/engine/audio.ts)
 ───────────────                  ─────────────────────────────────────────────────────────
 file / SoundCloud / video  ──► MediaElementSource ─┐
 microphone (no AGC/NS/EC)  ──► MediaStreamSource ──┼──► AnalyserNode ──► (nothing)        :74-80
 tab / system audio         ──► MediaStreamSource ──┤      fftSize 2048, τ 0.6             :31-32
 demo beat (124 BPM synth)  ──► GainNode ───────────┘   ├► recordDest (recording)          :76
                                                        └► output gain ► speakers           :36-39, :77
                                                           (volume after the analyser)
        │ once per requestAnimationFrame: getByteFrequencyData + getByteTimeDomainData     :134-140
        ▼
 Listener.hear(bins, playing, realDt, now)            (src/engine/listener.ts:67-86)
   ├─ band means (bytes) bass 25-140 · mid 140-2k · high 2k-12k Hz            :11, :97-100, :193-199
   ├─ adaptive normalisation (2.5 s average, attack 30/s, release 6/s)          :104-113
   ├─ tone: spectral centroid 60 Hz-16 kHz, log-mapped 1.1-5.5 kHz, 2.5 s       :146-162
   ├─ kick: bass > 1.12 × 1 s average + 0.02, > 0.15, re-armed, ≥ 0.28 s apart  :118-126
   │     └─ tempo: median of the last ≤ 11 inter-kick gaps, needs 5 kicks       :132-141
   │           └─ TempoClock.setBpm  ── tick / tickPhase / ticks               :77-80
   ├─ energy: (2.5 s level − 0.15) / 0.4 · mood: tempo 65% + energy 35%, 4 s    :81-83
   └─ spectrum texture: 256 log-spaced bins + 256 waveform samples (RG bytes)   :176-189
        │
        ▼
 Controller.step (src/app/controller.ts:909-958)
   ├─ onBeats: kick → auto-switch count (32 kicks); tick → studio autopilot / director   :785-792
   ├─ composeFrame(program, motion, hearing, look, …) per output       (src/engine/look.ts:36-65)
   │     reactivity scales bands & kick flash; clock pace, hue walk, effects' turn, grade
   ├─ LiveSlot.route → main screen renderer + projector frame (postMessage)   :937-941
   └─ every 2nd frame → UI meters (bass, mid, high, tone, kick dot, ~BPM, mood)          :946-953
        │
        ▼
 Shaders: scene inputs uBass uMid uHigh uLevel uBeat uTick uTicks uBright uMood uTime uHue
          + uSpec texture (src/engine/scene-inputs.ts:13-25, src/engine/renderer.ts:739-744)
```

### 1. Capture (src/engine/audio.ts)

- One `AudioContext` and one `AnalyserNode` per app, created lazily (src/engine/audio.ts:26-40). `fftSize = 2048`
  (:31) gives 1024 bins; at 48 kHz that is ~23.4 Hz a bin and a 42.7 ms window (the unit tests assume the same:
  src/engine/listener.test.ts:4-6). The sample rate is whatever the context picked (`ctx.sampleRate`, :34).
- `minDecibels` / `maxDecibels` are never set, so the spec defaults apply: -100 dB and -30 dB
  ([W3C Web Audio 1.1 §1.8.2](https://www.w3.org/TR/webaudio-1.1/#AnalyserNode-attributes)). Every byte the listener
  reads is a dB value squeezed into that 70 dB range.
- `smoothingTimeConstant` is 0.6 (:23, :32), set from Settings → Audio → Smoothing, 0-0.95
  (src/state/prefs.ts:22, src/components/Settings.tsx:111-114, src/app/controller.ts:352). The spec default would be
  0.8. The code itself notes that kicks are heard in the same smoothed bins, so a calmer setting also blunts them
  (src/engine/audio.ts:47-49).
- The listening volume sits after the analyser, so the visuals react the same at any volume, even when muted
  (src/engine/audio.ts:36-39, docs/audio.md).
- Microphone input turns off echo cancellation, noise suppression and automatic gain by default (src/engine/audio.ts:91,
  src/state/prefs.ts:23-25), so the browser cannot gate or duck the music.
- `read()` copies byte frequency and byte time-domain data once a frame, or returns `null` with no source
  (src/engine/audio.ts:134-140). No float data is read.
- The demo beat is a scheduled synth with a kick every quarter note at `124 × rate` BPM (src/engine/audio.ts:128, :185,
  :199). It is the only source whose real tempo the app knows.

Per the spec, the analyser applies a Blackman window (α = 0.16), takes |X[k]|, smooths each bin as
X̂[k] = τ·X̂₋₁[k] + (1-τ)·|X[k]|, converts to dB, and maps to bytes as
⌊255/(dB_max - dB_min)·(Y[k] - dB_min)⌋ clipped to 0-255; the time domain is ⌊128·(1 + x[k])⌋
([§1.8.6 FFT windowing and smoothing over time](https://www.w3.org/TR/webaudio-1.1/#fft-windowing-and-smoothing-over-time),
[§1.8.3 methods](https://www.w3.org/TR/webaudio-1.1/#AnalyserNode-methods)). Calls within the same render quantum
return the previous data; otherwise each call computes new, smoothed data (§1.8.3).

### 2. Bands, level, energy (src/engine/listener.ts)

- `band()` is the mean of the byte bins between two frequencies, divided by 255 (src/engine/listener.ts:193-199). It
  averages dB values, so it is a log-domain loudness, not an energy or RMS.
- Bands: bass 25-140 Hz, mid 140-2000 Hz, high 2000-12000 Hz (:11). `level` = 0.5·bass + 0.35·mid + 0.15·high (:100).
- Adaptive normalisation per band (:104-113): a 2.5 s running average (`ease(dt, 2.5)`), a relative term
  `(raw - 0.85·avg) / (0.5·avg)` clamped 0-1, mixed as `0.7·rel + 0.5·raw` and capped at 1; under 0.02 the band is 0.
  It rises fast (30/s) and falls slower (6/s). The average is floored at 0.05.
- `energy` is absolute: `(avg.level - 0.15) / 0.4`, clamped (:81). Because it reads the dB bytes, it depends on the
  -100/-30 dB range and on the source's gain.
- With no source, the bands decay at 3/s and the spectrum texture goes flat (:72-76).

### 3. Tone and mood

- Tone: amplitude-weighted spectral centroid over 60 Hz-16 kHz, with bytes turned back into linear amplitude through
  the analyser's dB range (:146-173). It is mapped log-wise from 1.1 kHz (dark) to 5.5 kHz (bright) and smoothed over
  2.5 s; it holds during quiet (level < 0.04) passages (:157) and drifts to neutral at 4 s once nothing plays (:84).
- Mood = 0.65 × tempo position between 80 and 160 BPM + 0.35 × energy, smoothed over 4 s; neutral (0.5) with no
  tempo or while not playing (:20, :82-83).
- Both go to words in thirds for the meters, the assistant and the director (:203-217).

### 4. Kicks

```
kickAvg += (bass - kickAvg) · (1 - e^(-dt/1s))
armed    ← bass < kickAvg
kick     ← armed ∧ bass > 1.12·kickAvg + 0.02 ∧ bass > 0.15 ∧ now - lastKick > 0.28 s
```
(src/engine/listener.ts:118-126). On a kick: `beat = 1` (decays as e^(-5t), :69), `kick = true` for that frame, and
the tempo is updated. The 0.28 s gap caps kicks at ~214 a minute (:13), which also keeps kick flashes under the
three-a-second strobe rule the scenes are tested against (docs/scenes.md:9-11,
[WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).

### 5. Tempo

`hearTempo` (src/engine/listener.ts:132-141) keeps the last 12 kick times, needs 5, sorts the gaps, takes the median
and rounds `60 / median` to an integer. It writes `hearing.bpm` and `TempoClock.setBpm` on every kick after that.
`reset()` clears it when a new source starts (:88-92, src/app/controller.ts:689-695). Pausing, seeking or changing the
player's tempo does not reset it; the median simply re-converges.

### 6. Ticks (src/state/tempo-clock.ts)

- `setBpm` changes the rate but keeps the phase (:17-22).
- `onDetectedBeat(now)`: a kick counts as a tick if at least half an interval has passed since the last tick, and in
  every case moves the next tick to `now + interval` (:32-38).
- `advance(now)`: ticks that fell due, at most one after a stall (:47-53). `phase(now)`: `(now - last) / interval`,
  clamped (:41-44).
- The listener only ticks while the music is playing (src/engine/listener.ts:77-80); `ticks` is never reset, even
  for a new source.

### 7. From hearing to frames

- `Controller.step` hears on real elapsed time but moves the show on `dt` capped at 0.1 s (src/app/controller.ts:907-916).
- `onBeats`: each kick counts towards auto-switch (32 kicks, src/state/app-state.ts:7), with a 45 s fallback
  (:8, src/app/controller.ts:925); each tick goes to the studio (src/app/controller.ts:785-792).
- Studio autopilot counts ticks to the next take and resets the count at every take (src/app/studio.ts:365, :376-381);
  it also moves on by wall clock when ticks never come (:461-473, src/state/show-plan.ts:9-10).
- The director samples energy, bass and tone on every studio beat (src/director/director.ts:104-107) and sends tempo,
  mood, tone and an energy trend to Claude (src/director/digest.ts:37-38). The studio only emits beats while the
  autopilot is on with two or more show scenes (src/app/studio.ts:376-378), so the director's energy history only grows
  then.
- `composeFrame` (src/engine/look.ts:36-65), once per output: bands and level × Reactivity capped at 1.5, the kick
  flash capped at 1 (:37-42); the clock's pace eases towards `speed·(0.55 + 0.9·level + 0.35·beat)` (:45-47); the hue
  walks and jumps on a kick by Colour cycling (:49); the effects' turn runs on with bass and kicks (:29, :50); tone
  and mood grade colour, trails and fringing through Synesthesia (:56-79). Tick phase and count pass through unscaled
  (:55).
- Effects read the frame's inputs: Glow swells with `uBass` and ducks on `uBeat` (src/engine/effects.ts:137), Wave
  rings out on `uBeat` (:162-165), Kaleidoscope turns with the turn (:89-104).
- The projector receives the whole `ProgramState`, spectrum included, by `postMessage` (src/engine/output-link.ts:121-122).
- Built-in scenes read `uBeat`, `uTick`, `uTicks`, `uBass`, `uLevel` and `spec()`; none reads `uMid`, `uHigh`,
  `uBright` or `uMood` directly (grep of src/scenes/*.ts). They reach the picture only through the Look's grade.

## Signals reference

| Signal (Hearing field → scene input) | How it is computed | Range | Updates | Consumers | Code |
|---|---|---|---|---|---|
| bins.freq | AnalyserNode byte spectrum, Blackman, τ 0.6, -100…-30 dB | 1024 × 0-255 | each rAF frame | Listener only | src/engine/audio.ts:31-34, :134-140 |
| bins.time | AnalyserNode byte waveform | 2048 × 0-255, 128 = 0 | each frame | spectrum texture | src/engine/audio.ts:138 |
| bass / mid / high → uBass uMid uHigh | mean dB byte in band, adaptive normalised, attack 30/s, release 6/s | 0-1 (≤ 1.5 after Reactivity) | each frame | composeFrame, meters, scenes, Glow, director (bass) | src/engine/listener.ts:97-113, src/engine/look.ts:38-40 |
| level → uLevel | 0.5 bass + 0.35 mid + 0.15 high, normalised the same way | 0-1 (≤ 1.5) | each frame | clock pace, Light Sheet | src/engine/listener.ts:100, src/engine/look.ts:45 |
| beat → uBeat | 1 on a kick, × e^(-5 dt) | 0-1 | each frame | kick flash, turn, fringing, Glow, Wave, every built-in scene, kick dot | src/engine/listener.ts:69, :123, src/engine/look.ts:42 |
| kick | bass threshold above its 1 s average, hysteresis, ≥ 0.28 s apart | boolean, one frame | on event | hue jump, auto-switch count, tempo, tick re-anchor | src/engine/listener.ts:118-126, src/app/controller.ts:787-790 |
| bpm (tempo) | round(60 / median of ≤ 11 inter-kick gaps), from 5 kicks | integer or null; kicks capped at ~214/min | each kick | tick clock, mood, meters, studio bar, assistant, director | src/engine/listener.ts:132-141 |
| tick | TempoClock: due ticks + kicks ≥ ½ interval after the last tick; only while playing | boolean, one frame | on event | studio autopilot, director cycles | src/state/tempo-clock.ts:32-53, src/engine/listener.ts:77-78 |
| tickPhase → uTick | (now - last tick) / interval, clamped | 0-1 | each frame while playing | Light Sheet, Point Storm, Ring Run, Scan Trace | src/state/tempo-clock.ts:41-44 |
| ticks → uTicks | running count, never reset | 0… | on tick | every built-in scene except Light Sheet (mod 3 / mod 4 patterns) | src/engine/listener.ts:80 |
| bright (tone) → uBright | log-mapped spectral centroid 1.1-5.5 kHz, 2.5 s | 0-1 | each frame (held in quiet) | grade, trails, fringing, meters, assistant, director | src/engine/listener.ts:146-162 |
| centroid | smoothed spectral centroid | Hz | each frame | meter tooltip only | src/engine/listener.ts:159, src/app/controller.ts:952 |
| energy | (2.5 s level average - 0.15) / 0.4 | 0-1 | each frame | mood, director trend | src/engine/listener.ts:81 |
| mood → uMood | 0.65 tempo(80-160) + 0.35 energy, 4 s | 0-1 | each frame | grade, mood word | src/engine/listener.ts:82-83 |
| spectrum → uSpec | 256 log-spaced bins 23 Hz-16 kHz with a treble tilt (R) + downsampled waveform (G) | 256 × RG bytes | each frame | `spec()` / `wave()` in shaders, visual maker's Spectrum node | src/engine/listener.ts:176-189, src/scenes/header.ts:29-30, src/engine/nodes.ts:94 |

## Monitoring today

- **Audio widget:** Bass / Mid / High bars, a Tone marker (tooltip: tone word and centroid in kHz), a dot whose
  opacity follows `beat`, `~N BPM` or `— BPM`, and the mood word (src/components/widgets/sections.tsx:80-97). They are
  pushed into the UI store every second frame (src/app/controller.ts:946-953, src/state/ui-state.ts:60-61).
- **Studio beat bar:** ticks counted towards the next take, and the tempo (src/components/Studio.tsx:62, :154-160).
- **Performance overlay:** time spent in "Audio analysis" per frame (src/engine/profiler.ts:13-19), not what it heard.
- **Director digest:** tempo, mood, tone and per-cycle energy / bass / brightness series sent to the model
  (src/director/digest.ts:37-38). Not shown as a graph.
- **For your own shaders:** the editor's cheat sheet lists `spec(x)` and `wave(x)` (src/components/Editor.tsx:138), and
  the e2e test shows a one-line shader can display `uTick` and `uTicks` (e2e/tick.spec.ts:4).

What is missing: the spectrum or the uSpec texture, the raw (un-normalised) bands and their averages, the kick
threshold, kicks and ticks as separate events, the inter-kick gaps the tempo comes from, any confidence, the energy
and mood over time, frame timing, and latency.

## Weaknesses (each from the code)

1. **Tempo octave and syncopation errors.** The tempo is the median inter-kick gap with no folding to a preferred range
   and no check of 2:1 or 3:2 relations (src/engine/listener.ts:137-138). If every other kick is missed (high Smoothing
   blunts them, src/engine/audio.ts:47-49) the median gap doubles and the tempo halves. Kick patterns that are not one
   per beat (half-time, breakbeats, many drum & bass patterns) give gaps of 1.5 or 2 beats, and the median follows them.
   Tempo octave ambiguity is a known, largely unsolved problem even for research systems
   ([McKinney & Moelants, ISMIR 2004](https://archives.ismir.net/ismir2004/paper/000197.pdf);
   [Gouyon et al. 2006](https://repositori.upf.edu/items/d312940d-f18a-402f-88ed-64c3df34a354)).
2. **No confidence, no lock.** `bpm` is replaced on every kick after the fifth and rounded (:138-140), so it can jitter
   by ±1 and the tick clock's rate follows. Nothing says how consistent the gaps were, and the user cannot correct it.
   The meter's `~` is the only hint (src/components/widgets/sections.tsx:94).
3. **Off-beat kicks move the tick phase.** Any kick ≥ ½ interval after the last tick counts as a tick and re-anchors
   the next one (src/state/tempo-clock.ts:34-36), so a kick on the off-beat shifts the grid by half a beat. A kick that
   arrives just after a scheduled tick moves `next` but not `last`, so `phase` reaches 1 and holds there until the
   late tick (:36, :43). There is no phase-error gating or gradual correction.
4. **False kicks on non-percussive bass.** The kick is a rise in mean 25-140 Hz dB level (src/engine/listener.ts:120).
   A new bass-line note or a sub swell that rises 12% above its 1 s average passes too; nothing looks at how sudden the
   rise was or at the rest of the spectrum. Music whose rhythm is in the snare, hats or a melody gives no kicks at all,
   so no tempo and no ticks; the studio then falls back on wall-clock steps (src/app/studio.ts:461-473) and the docs
   suggest switching to seconds (docs/studio.md:51-52). Spectral-flux style onset functions, which sum positive changes
   across bins, are the standard remedy ([Bello et al. 2005](https://www.cs.bu.edu/fac/snyder/cs583/Literature%20and%20Resources/bello_onset_tutorial.pdf);
   [Dixon, DAFx 2006](https://dafx.de/paper-archive/details/_kscRgr98aSFW4l-j1YJuA)).
5. **Frame-rate coupling.** The listener reads the analyser once per rAF frame (src/app/controller.ts:916), so kick
   timing is quantised to the frame (the 8 fps test accepts 115-130 for 124, src/engine/listener.test.ts:50-55).
   The analyser's own smoothing is applied per computed frame (spec §1.8.6), so the same τ means a shorter time constant
   at 120 Hz than at 60 Hz or 30 Hz; the listener's own constants use `dt` and do not have this problem
   (src/engine/listener.ts:51). In a hidden tab rAF is throttled, nothing is heard, and the tick clock catches up by
   one tick (src/state/tempo-clock.ts:46-50).
6. **Latency is unmeasured and uncompensated.** Delay before a kick shows: half the 42.7 ms window, the smoothing
   (τ 0.6 per frame ≈ 33 ms time constant at 60 fps: -16.7 ms / ln 0.6), up to one frame waiting for rAF, render and
   display, plus a `postMessage` hop and another frame for projectors (src/engine/output-link.ts:121-122). Meanwhile
   the sound reaches the listener's ears `AudioContext.outputLatency` later than the analyser sees it
   ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)), which can be large over
   Bluetooth. The code reads neither `outputLatency` nor `baseLatency`, and ticks are not scheduled ahead.
7. **Normalisation is in the dB-byte domain with fixed constants.** Bands, energy and the kick threshold all work on
   bytes from a fixed -100/-30 dB range (src/engine/audio.ts:33-34). A quiet line-in sits low in that range, a hot
   master clips at 255, and `energy`'s 0.15 / 0.4 constants (src/engine/listener.ts:81) are tuned for one gain staging.
   The 2.5 s band average adapts, but `kick` also needs bass > 0.15 absolute (:120).
8. **No bar, downbeat or phrase.** `ticks` counts from an arbitrary start and is never reset (src/engine/listener.ts:80,
   :88-92). Scenes use `mod(uTicks, 4.)` as if it were a bar (src/scenes/wire-solid.ts:43, :50), plans describe 32 beats
   as "8 bars of 4/4" (src/state/show-plan.ts:14), and docs/studio.md:72 says the autopilot takes plan steps "on the
   bar", but the beat count restarts at each take (src/app/studio.ts:365), so takes land on a tick, not on bar 1.
9. **Tempo shapes the mood, so tempo errors leak into colour.** A halved tempo moves mood by up to 65% of its range
   towards calm (src/engine/listener.ts:82-83) and so the grade's saturation and warmth (src/engine/look.ts:71-78).
10. **Auto-switch and the hue jump count kicks, not ticks.** A breakdown holds the scene by design
    (src/app/controller.ts:781-790), but a passage with false kicks also switches scenes faster.
11. **Silence handling is reasonable.** Bands go to 0 under 0.02 (src/engine/listener.ts:111), kicks need bass > 0.15,
    tone holds, mood and tone relax when nothing plays, ticks stop. One gap: a live input in a quiet room is still
    "playing" (src/app/music-source.ts:48-55), so ticks keep running at the last tempo indefinitely.
12. **Test coverage is synthetic only.** All listener tests use a clean four-on-the-floor kick over a static bed
    (src/engine/listener.test.ts:14-23). Nothing exercises off-beat kicks, half-time, bass lines, gain changes or real
    audio, so the weaknesses above are untested rather than tested-and-accepted.

## Opportunities (fan-out)

Effort: S ≈ under a day, M ≈ a few days, L ≈ a week or more. "Depends on" names what must exist first.

### A. A Listener monitor (make it visible)

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **Listener panel** (a widget or overlay like the Perf overlay, src/engine/profiler.ts): the 256-bin log spectrum from `listener.spectrum` with the three band edges drawn on it; raw vs normalised band bars; the bass level with `kickAvg` and the kick threshold line | See why a kick did or did not fire; tune Smoothing by eye | S-M | Expose `raw`, `avg`, `kickAvg` read-only from the Listener (today private, src/engine/listener.ts:57-63) |
| **Event strip:** a scrolling 8-10 s timeline with kicks (one colour), ticks (another), tick phase as a sawtooth, and the inter-kick gaps as labels | Shows off-beat re-anchoring, missed kicks and half-tempo at a glance | M | A small ring buffer of events in the Listener |
| **Tempo readout with confidence:** tempo, the spread of the gaps (e.g. inter-quartile range / median), kicks in the window, and a "steady / unsure / none" state | Tells the VJ whether to trust beat units or switch to seconds (docs/studio.md:51) | S | Weakness 2 |
| **Ground-truth check on the demo beat:** show "detected 124 / actual 124" while the demo plays (src/engine/audio.ts:128) | A free self-test of the whole chain, also usable in e2e | S | — |
| **Tap tempo comparison:** tap a key, show tapped vs detected tempo and the phase offset between taps and ticks | Measures octave and phase errors live; becomes the input for B2 | S | — |
| **Latency figure:** show `ctx.baseLatency + ctx.outputLatency` and frame time; a calibration mode that flashes on the tick while you tap along | Makes weakness 6 visible; gives an offset to apply | S-M | — |
| **Energy / mood / tone history:** the last few minutes as sparklines, the same series the director sees (src/director/history.ts) | Lets a human read the build-ups and drops the director is told about | S | — |
| **Record and replay the hearing:** log `Bins` (or just the derived hearing) per frame to a file; replay it through `Listener.hear` in tests and in the monitor | Real-music regression tests for the listener; reproducible bug reports | M | Listener is already pure and driven by `(bins, playing, dt, now)` (src/engine/listener.ts:1-7) |

### B. Better hearing (improve the analysis itself)

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **B1. Octave folding and a range prior:** fold the median gap into a preferred range (e.g. 80-160 BPM, the same range mood uses, src/engine/listener.ts:20) unless the user locked it; prefer the candidate whose ticks line up with most kicks | Fewer half / double tempo errors; mood stops jumping | S | Tests with half-time and missed-kick patterns |
| **B2. Tap, halve, double, nudge, lock:** buttons / hotkeys that set or scale the tempo, shift the phase, and stop the listener from replacing it until the next source | The VJ fixes in one press what no algorithm gets right every time; standard in DJ and VJ tools | S | A `locked` flag next to `hearing.bpm`; the TempoClock already keeps phase on a rate change (src/state/tempo-clock.ts:20) |
| **B3. Tempo confidence and smoothing:** keep the gap histogram, report confidence, only change the tempo when a new value wins consistently | Stops ±1 BPM jitter; gives the monitor and director something to say | S | — |
| **B4. Phase-gated re-anchoring:** only re-anchor on kicks within, say, ±20% of a tick, and correct gradually; kicks elsewhere still flash but do not move the grid | Ticks stay on the beat through syncopation (weakness 3) | S-M | Tests with off-beat kicks |
| **B5. A spectral-flux onset function** (half-wave rectified bin-to-bin increase, summed, with an adaptive threshold), from an unsmoothed second analyser or from float data | Kicks / onsets on music without a strong kick, better timing, and a novelty curve for tempo; recommended by Bello et al. 2005 and Dixon 2006 (Sources) | M | The code already names the second analyser idea and its tuning cost (src/engine/audio.ts:47-49); strobe rule must be rechecked (docs/scenes.md:9-11) |
| **B6. Autocorrelation / tempogram tempo** over the onset function, the first stage of the Ellis 2007 dynamic-programming tracker (onset strength → global tempo → beat sequence; librosa defaults: start_bpm 120, tightness 100) | Tempo from all onsets, not just kicks; robust to missed kicks | M-L | B5 |
| **B7. Analysis off the rAF:** run the listener on a fixed hop in an AudioWorklet (or a timer) and post the hearing to the main thread | Frame-rate-independent kicks and smoothing, keeps hearing while hidden | M-L | Changes the "once a frame" contract in the glossary (Listener) |
| **B8. Gain-independent bands:** derive bands from float dB data relative to a running peak or percentile instead of fixed byte constants | Same behaviour on a quiet line-in and a hot master | M | Retuning; meters and strobe tests |
| **B9. Latency compensation:** schedule ticks `outputLatency + render` ahead, i.e. flash the tick when the beat is heard, not when it is analysed | Visual hits feel on time on Bluetooth and on projectors | S-M | A latency figure (A) |

### C. Features the hearing unlocks

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **C1. Bar counter and downbeat:** a `bar` / `beatInBar` next to `ticks`, set by "tap the one" (or B6-style downbeat detection later), kept by the tick clock; a new scene input such as `uBar` | Takes, plan steps, auto-switch and `mod(uTicks, 4.)` scenes land on bar 1, as docs/studio.md:72 promises | S-M | B2 (tap), B4 (stable phase) |
| **C2. Quantised takes:** the Take button and hotkey wait for the next bar (or 4 / 8 / 16 bars) when the music has a confident tempo | Hand-made transitions land on the phrase | S | C1 |
| **C3. Phrase-aware autopilot and director:** steps counted in bars from the downbeat; the director told "bar 13 of 16" | Changes on 8- / 16-bar phrase boundaries, where dance music changes | S | C1 |
| **C4. Build / drop / breakdown detection:** from the energy series and kick density: kicks stopping + energy holding = breakdown; rising high band + rising energy = build; kicks returning with an energy jump = drop | Big moments (a take, a Look change, a Glow burst) on the drop; richer director digest | M | A history buffer (exists for the director, src/director/history.ts); B3 helps |
| **C5. Tempo-synced motion for effects and scenes:** expose the tick phase at ½, 1, 2, 4-beat periods (or `uBar` phase) so a Kaleidoscope turn or a Wave can cycle exactly once a bar | Motion that locks to the music rather than drifting with `uTime` | S | C1 for bar periods. Must stay within ADR 0003: each effect moves "with the music in one fixed way" |
| **C6. Per-band routing to effect settings** (bass → Glow strength, high → Wave, …) | Expressive control | M | **Contradicts ADR 0003**, which rejected free routing because it has no known worst case to check against the strobe and black-edge rules. Worth reopening only with fixed, testable routings, not free routing |
| **C7. External clock in:** MIDI clock / Song Position over the Web MIDI API, or Ableton Link via a local bridge (Link has no official browser implementation) | Ticks and bars locked to the DJ's or band's gear: no detection error at all | M (MIDI) / L (Link) | B2's lock path; the desktop app's local server (docs/desktop.md) could host a Link bridge |
| **C8. Analyse files ahead:** for a file or SoundCloud track, decode it once (OfflineAudioContext) and compute tempo, beat grid and downbeats offline before it plays | Correct tempo and bars from the first second, and seeking keeps the grid | M-L | B5/B6 algorithms; madmom-style joint beat + downbeat tracking is the research state of the art (Böck et al. 2016) but is Python / neural |
| **C9. Hearing-driven assistant answers:** let the assistant read the monitor's numbers ("your tempo is unsure; switch to seconds?") | Turns monitoring into advice | S | A, B3 |

## Recommendation

1. **Build the Listener monitor with a recorded trace (A: panel, event strip, confidence, demo ground truth, replay).**
   It costs little because the Listener is already pure, it makes every later change measurable, and recorded
   traces from real music become the regression tests the listener lacks (weakness 12).
2. **Make the tempo correctable and steadier (B1-B4).** Tap / halve / double / nudge / lock, octave folding,
   confidence, and phase-gated re-anchoring. Small, local changes in src/engine/listener.ts and
   src/state/tempo-clock.ts, and they fix the failure modes users will see first (half tempo, drifting ticks).
3. **Add bars (C1, then C2-C3).** A downbeat set by tap and kept by the tick clock lets takes, plans, auto-switch and
   `uTicks`-based scenes land on bar 1, and makes the docs' "on the bar" true.

After that: spectral-flux kicks (B5) for music without a four-on-the-floor kick, then build / drop detection (C4) for
the director, then MIDI clock (C7) for live rigs. Leave per-band routing (C6) until ADR 0003 is reopened.

## Sources

Code (this repo, commit e2b5b73): src/engine/audio.ts, src/engine/listener.ts, src/state/tempo-clock.ts,
src/engine/look.ts, src/engine/scene-inputs.ts, src/engine/effects.ts, src/app/controller.ts, src/app/studio.ts,
src/app/music-source.ts, src/director/director.ts, src/director/digest.ts, src/state/show-plan.ts, src/state/prefs.ts,
src/components/widgets/sections.tsx, src/components/Studio.tsx, src/scenes/*.ts, src/engine/listener.test.ts,
src/state/tempo-clock.test.ts, e2e/tick.spec.ts, GLOSSARY.md, docs/audio.md, docs/studio.md, docs/scenes.md,
docs/settings.md, docs/adr/0003-effects-belong-to-the-show-scene.md. package.json has no audio-analysis dependency.

- W3C, Web Audio API 1.1, AnalyserNode: defaults (fftSize 2048, minDecibels -100, maxDecibels -30,
  smoothingTimeConstant 0.8), Blackman window α 0.16, smoothing formula, byte conversion, same-render-quantum rule.
  https://www.w3.org/TR/webaudio-1.1/#AnalyserNode and
  https://www.w3.org/TR/webaudio-1.1/#fft-windowing-and-smoothing-over-time
- MDN, `AudioContext.outputLatency`. https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
- MDN, Web MIDI API (MIDIMessageEvent timeStamp, secure context, limited availability).
  https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API
- Ableton Link (tempo, beat and phase sync over a LAN; C++ library and LinkKit only).
  https://ableton.github.io/link/
- J. P. Bello, L. Daudet, S. Abdallah, C. Duxbury, M. Davies, M. Sandler, "A Tutorial on Onset Detection in Music
  Signals", IEEE Trans. Speech and Audio Processing 13(5):1035-1047, 2005.
  https://www.cs.bu.edu/fac/snyder/cs583/Literature%20and%20Resources/bello_onset_tutorial.pdf
- S. Dixon, "Onset Detection Revisited", DAFx-06, 2006 (spectral flux performs on par with phase and complex-domain
  methods). https://dafx.de/paper-archive/details/_kscRgr98aSFW4l-j1YJuA
- D. P. W. Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research 36(1):51-60, 2007.
  https://www.ee.columbia.edu/~dpwe/LabROSA/projects/beattrack/
- librosa `beat_track` (Ellis 2007; onset strength → tempo → DP; start_bpm 120, tightness 100).
  https://librosa.org/doc/0.10.0/_modules/librosa/beat.html
- M. Müller, FMP notebooks, beat tracking by dynamic programming (assumes roughly constant tempo; tempo doubling and
  halving penalised symmetrically). https://audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S3_BeatTracking.html
- M. E. P. Davies, M. D. Plumbley, "Context-dependent beat tracking of musical audio", IEEE TASLP 15(3), 2007; the
  causal tracker in aubio. https://dev.aubio.org/browser/src/tempo/beattracking.h
- M. McKinney, D. Moelants, "Extracting the perceptual tempo from music", ISMIR 2004 (tempo is perceived at different
  metrical levels). https://archives.ismir.net/ismir2004/paper/000197.pdf
- F. Gouyon et al., "An experimental comparison of audio tempo induction algorithms", IEEE TASLP 2006 (over 80%
  accuracy if the metrical level is not required). https://repositori.upf.edu/items/d312940d-f18a-402f-88ed-64c3df34a354
- S. Böck, F. Krebs, G. Widmer, "Joint Beat and Downbeat Tracking with Recurrent Neural Networks", ISMIR 2016; madmom
  `DBNDownBeatTrackingProcessor`. https://archives.ismir.net/ismir2016/paper/000186.pdf
- W3C, WCAG 2.2, Understanding SC 2.3.1 Three Flashes or Below Threshold.
  https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

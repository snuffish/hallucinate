# Audio reactivity: how the listener hears the music, and what to do with it

Research note, 2026-10-18, at commit `ffc913b` (after #66, "The Listener hears psytrance"; first written at `e2b5b73`).
Terms follow [GLOSSARY.md](../../GLOSSARY.md): the **music** is heard by the **listener**, which reports a **hearing**
(bands, **kicks**, **ticks**, **tempo**, **tone**, **energy**, **mood**) once a frame; scenes read it as **scene
inputs**. **Speed** is how fast a file plays; a **tap** is a key pressed along with the music; a **bar** is four ticks
from the **downbeat**; a tempo is **steady**, **unsure** or **none**, and may be **locked**. "Onset", "beat",
"pulse" and "BPM" appear only where this note talks about the literature or about code identifiers that use those
words.

## Summary

- **One small pipeline, on the main thread.** A single Web Audio `AnalyserNode` (fftSize 2048, unsmoothed, default
  -100/-30 dB range) feeds a pure `Listener` once per `requestAnimationFrame`, and the result is written into every
  output's frame by `composeFrame` (src/engine/audio.ts:29-33, src/app/controller.ts:916-927, src/engine/look.ts:36).
  The Listener smooths the bands and the spectrum texture itself, by the Smoothing setting; kicks and the tone are
  heard in the unsmoothed bins (src/engine/listener.ts:153-158, :170-184). No worklet, no library: package.json lists
  no DSP dependency.
- **Kicks are low-band rises on a heard pulse.** Since #66 a `KickHearer` sums the positive rise over 20-280 Hz since
  two frames ago (a spectral flux over the kick's bins), finds the period those rises repeat at by autocorrelation and
  where they fall by a comb, and calls a rise a kick only when it peaks within about 6% of a pulse of where the next
  pulse is due (src/engine/kick-hearer.ts:100-133, :140-160, :180-253). The notes of a rolling bassline between the
  kicks no longer count. Nothing measures change in the mid or high bands.
- **The tempo is the kick gaps, folded into 85-175 BPM, with no confidence, tap or lock.** The median of the last 11
  gaps, averaged with the gaps within 10% of it, rounded and halved or doubled into the tempo range, replaced on every
  kick after the fifth (src/engine/listener.ts:188-210, :261-266). It is forgotten after 90 s of playing without kicks
  (:98-99). Nothing says how sure it is, and nobody can correct it.
- **The tick clock is unchanged.** `TempoClock` keeps counting through breakdowns and re-anchors on every kick at
  least half a tick after the last tick (src/state/tempo-clock.ts:32-53). Kicks off the pulse no longer reach it, but
  the clock itself still trusts any kick it gets. There is no bar or downbeat: `uTicks` counts from wherever it
  started, while scenes and plans already assume 4-tick bars (src/scenes/wire-solid.ts:43, src/state/show-plan.ts:14).
- **Monitoring in the app is still a meter strip:** three band bars, a tone marker, a kick dot, "~N BPM" and a mood
  word, at about 30 Hz (src/components/widgets/sections.tsx:80-97, src/app/controller.ts:946-954). No spectrum, no
  kick versus tick display, no tempo confidence, no tap and no latency figure.
- **Tests now include real music.** Synthetic-bin unit tests cover half-time, doubled and drum & bass tempos, the
  tempo range, a rolling bassline, forgetting, pauses, frame rate, Smoothing and tone (src/engine/listener.test.ts).
  Eight reference clips are recorded through an offline analyser and replayed through the Listener against their
  right answers, with known failures listed (tools/reference/, reference/clips.json, docs/reference-clips.md).
- **Plan (decided, [ADR 0004](../adr/0004-bars-are-four-ticks-from-a-tapped-downbeat.md)):** first trust (tap, halve,
  double, nudge and lock the tempo; a confidence; a monitor that shows kicks against ticks), then bars (four ticks
  from a tapped downbeat, a new scene input, takes and steps on the bar). See [Recommendation](#recommendation).

## Current pipeline walkthrough

```
 music source                     AudioEngine (src/engine/audio.ts)
 ───────────────                  ─────────────────────────────────────────────────────────
 file / SoundCloud / video  ──► MediaElementSource ─┐
 microphone (no AGC/NS/EC)  ──► MediaStreamSource ──┼──► AnalyserNode ──► (nothing)        :65-71
 tab / system audio         ──► MediaStreamSource ──┤      fftSize 2048, τ 0 (unsmoothed)   :29-31
 demo beat (124 BPM synth)  ──► GainNode ───────────┘   ├► recordDest (recording)          :67
                                                        └► output gain ► speakers           :36-38, :68
                                                           (file and demo only; volume after the analyser)
        │ once per requestAnimationFrame: getByteFrequencyData + getByteTimeDomainData     :125-131
        ▼
 Listener.hear(bins, playing, realDt, now)            (src/engine/listener.ts:88-114)
   ├─ smooth the bins by Settings → Smoothing (linear magnitude, per frame)    :170-184
   ├─ band means (smoothed bytes) bass 25-140 · mid 140-2k · high 2k-12k Hz    :14, :134-138, :272-278
   ├─ adaptive normalisation (2.5 s average, attack 30/s, release 6/s)          :142-151
   ├─ tone: spectral centroid 60 Hz-16 kHz (unsmoothed), log-mapped 1-8 kHz    :153-155, :215-231
   ├─ kick: KickHearer on the unsmoothed bins (src/engine/kick-hearer.ts)       :157-162
   │     ├─ rise: positive change over 20-280 Hz since two frames ago            kick-hearer :140-160
   │     ├─ pulse: autocorrelation of 6 s of rises, prior at 120 BPM; comb phase kick-hearer :180-253
   │     └─ kick: a peaked rise within ±6% of the due pulse, ≥ 0.28 s apart      kick-hearer :107-133
   │           └─ tempo: median gap of the last ≤ 12 kicks, folded to 85-175    :188-210, :261-266
   │                 └─ TempoClock.setBpm  ── tick / tickPhase / ticks         :100-103
   ├─ forget the tempo after 90 s playing without a kick                       :98-99
   ├─ energy: (2.5 s level − 0.45) / 0.35 · mood: tempo 55% (10 s) + energy 45%, 2 s   :104-108
   └─ spectrum texture: 256 log-spaced bins (smoothed) + 256 waveform samples   :164, :245-257
        │
        ▼
 Controller.step (src/app/controller.ts:908-961)
   ├─ onBeats: kick → auto-switch count (32 kicks); tick → studio autopilot / director   :785-792
   ├─ composeFrame(program, motion, hearing, look, …) per output       (src/engine/look.ts:36-65)
   │     reactivity scales bands & kick flash; clock pace, hue walk, effects' turn, grade
   ├─ LiveSlot.route → main screen renderer + projector frame (postMessage)   :938-941
   └─ every 2nd frame → UI meters (bass, mid, high, tone, kick dot, ~BPM, mood)          :946-954
        │
        ▼
 Shaders: scene inputs uBass uMid uHigh uLevel uBeat uTick uTicks uBright uMood uTime uHue
          + uSpec texture (src/engine/scene-inputs.ts:13-25, src/engine/renderer.ts:739-744)
```

### 1. Capture (src/engine/audio.ts)

- One `AudioContext` and one `AnalyserNode` per app, created lazily (src/engine/audio.ts:25-39). `fftSize = 2048`
  (:30) gives 1024 bins; at 48 kHz that is ~23.4 Hz a bin and a 42.7 ms window (the unit tests and the reference
  recordings assume the same: src/engine/listener.test.ts:4-6, docs/reference-clips.md). The sample rate is whatever
  the context picked (`ctx.sampleRate`, :33).
- `minDecibels` / `maxDecibels` are never set, so the spec defaults apply: -100 dB and -30 dB
  ([W3C Web Audio 1.1 §1.8.2](https://www.w3.org/TR/webaudio-1.1/#AnalyserNode-attributes)). Every byte the listener
  reads is a dB value squeezed into that 70 dB range.
- `smoothingTimeConstant` is 0 (:31): the analyser hands over unsmoothed bins, and the Listener applies Settings →
  Audio → Smoothing (0-0.95, default 0.6) itself, to the bands and the spectrum texture only (src/state/prefs.ts:22,
  src/components/Settings.tsx:111-114, src/app/controller.ts:352, src/engine/listener.ts:116-120). Before #66 the
  Smoothing went to the analyser and blunted kicks too; fixed by #66, and tested (src/engine/listener.test.ts:327-338).
- The listening volume sits after the analyser, so the visuals react the same at any volume, even when muted
  (src/engine/audio.ts:35-38, docs/audio.md). Only the file and the demo beat are audible; the microphone and a shared
  tab go to the analyser and the recording only (:65-71, :88, :103).
- Microphone input turns off echo cancellation, noise suppression and automatic gain by default (src/engine/audio.ts:82,
  src/state/prefs.ts:23-25), so the browser cannot gate or duck the music.
- `read()` copies byte frequency and byte time-domain data once a frame, or returns `null` with no source
  (src/engine/audio.ts:125-131). No float data is read.
- The demo beat is a scheduled synth with a kick every quarter note at `124 × rate` BPM (src/engine/audio.ts:47-50,
  :119, :190). It is the only source whose real tempo the app knows.

Per the spec, the analyser applies a Blackman window (α = 0.16), takes |X[k]|, smooths each bin as
X̂[k] = τ·X̂₋₁[k] + (1-τ)·|X[k]| (with τ = 0 here, no smoothing), converts to dB, and maps to bytes as
⌊255/(dB_max - dB_min)·(Y[k] - dB_min)⌋ clipped to 0-255; the time domain is ⌊128·(1 + x[k])⌋
([§1.8.6 FFT windowing and smoothing over time](https://www.w3.org/TR/webaudio-1.1/#fft-windowing-and-smoothing-over-time),
[§1.8.3 methods](https://www.w3.org/TR/webaudio-1.1/#AnalyserNode-methods)). Calls within the same render quantum
return the previous data (§1.8.3). The Listener's `smooth()` redoes the same smoothing on linear magnitude recovered
from the bytes and maps back to bytes (src/engine/listener.ts:167-184).

### 2. Bands, level, energy (src/engine/listener.ts)

- `band()` is the mean of the byte bins between two frequencies, divided by 255 (src/engine/listener.ts:271-278). It
  averages dB values, so it is a log-domain loudness, not an energy or RMS. The bands read the smoothed bins (:134-137).
- Bands: bass 25-140 Hz, mid 140-2000 Hz, high 2000-12000 Hz (:14). `level` = 0.5·bass + 0.35·mid + 0.15·high (:269).
- Adaptive normalisation per band (:140-151): a 2.5 s running average (`ease(dt, 2.5)`), a relative term
  `(raw - 0.85·avg) / (0.5·avg)` clamped 0-1, mixed as `0.7·rel + 0.5·raw` and capped at 1; under 0.02 the band is 0.
  It rises fast (30/s) and falls slower (6/s). The average is floored at 0.05.
- `energy` is absolute: `(avg.level - 0.45) / (0.8 - 0.45)`, clamped (:29-31, :104). #66 set the two ends from the
  reference clips (beatless ambient ≈ 0.42, the loudest psytrance drop ≈ 0.77-0.80). Because it reads the dB bytes, it
  still depends on the -100/-30 dB range and on the source's gain.
- With no source, the bands decay at 3/s and the spectrum texture goes flat (:93-97).

### 3. Tone and mood

- Tone: amplitude-weighted spectral centroid over 60 Hz-16 kHz of the unsmoothed bins, with bytes turned back into
  linear amplitude through the analyser's dB range (:215-242). It is mapped log-wise from 1 kHz (dark) to 8 kHz
  (bright), a range #66 set from the reference clips so bright psytrance (≈ 4-5.5 kHz) is not pinned at the top
  (:19-23), and smoothed over 2.5 s; it holds while the unsmoothed level is under 0.04 (:154, :226) and drifts to
  neutral at 4 s once nothing plays (:111).
- Mood = 0.55 × the tempo's position between 80 and 160 BPM, itself followed over 10 s, + 0.45 × energy, smoothed
  over 2 s (:25-28, :32-34, :105-108). A forgotten tempo counts as neutral (0.5); while not playing the mood relaxes to
  0.5 (:110).
- Both go to words in thirds for the meters, the assistant and the director (:280-296).

### 4. Kicks (src/engine/kick-hearer.ts)

```
rise     = Σ over 20-280 Hz of max(0, bin now − bin two frames ago)           (byte steps)
rises    → 10 ms cells, 6 s kept, the last 4 s counting most
period   = argmax over 40-200 BPM of the autocorrelation at the lag and its 2× and 3× multiples
           × a log-normal prior centred on 120 BPM (σ 0.9 octaves); half the lag wins if it repeats ≥ 0.9 as strongly
phase    = where a comb of pulses at that period collects the most rise
kick     ← the rise peaked last frame ∧ it lies within ±max(6% of a pulse, 25 ms) of the due pulse
           ∧ rise ≥ 15% of the usual rise on the pulse ∧ rise ≥ 8 ∧ ≥ 0.28 s since the last kick
```

(src/engine/kick-hearer.ts:14-40, :100-133, :140-173, :180-265). The pulse is read every 0.25 s once 1 s of rises is
in (:103-106). It needs the rises to be periodic enough (`PULSE_CLARITY`, :31, :216) and is dropped after 2 s without
that (:135-138). Once four kicks in a row land a pulse apart, the pulse is settled: its period changes only after
another is heard for 8 readings in a row, and its phase only moves while unsettled (:228-251). Each kick pulls the due
pulse 10% towards itself (:129). On a kick the Listener sets `beat = 1` (decays as e^(-5t), src/engine/listener.ts:90),
`kick = true` for that frame, and updates the tempo (:157-162).

The 0.28 s gap caps kicks at ~214 a minute (src/engine/kick-hearer.ts:17, :130), which also keeps kick flashes under the
three-a-second strobe rule the scenes are tested against (docs/scenes.md:9-11,
[WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).

### 5. Tempo

`hearTempo` (src/engine/listener.ts:186-210) keeps the last 12 kick times, needs 5, sorts the gaps, takes the median,
averages it with the gaps within 10% of it (a missed or extra kick is left out), rounds `60 / gap` and folds it into
85-175 BPM by halving or doubling (`foldTempo`, :35, :260-266). It writes `hearing.bpm` and `TempoClock.setBpm` on every
kick after that. `reset()` clears it (and the KickHearer) when a new source starts (:122-129,
src/app/controller.ts:689-695), and the Listener resets itself after 90 s of playing without a kick (:36, :98-99); a
pause does not count towards that (:98, src/engine/listener.test.ts:184-191). Seeking or changing the Speed does not
reset it; the kicks re-converge. A tempo change by a DJ now takes about 6-7 s to follow, against 1.6-2.5 s before #66;
a test records this as an expected failure (src/engine/listener.test.ts:106-129).

### 6. Ticks (src/state/tempo-clock.ts)

- `setBpm` changes the rate but keeps the phase (:17-22).
- `onDetectedBeat(now)`: a kick counts as a tick if at least half an interval has passed since the last tick, and in
  every case moves the next tick to `now + interval` (:30-38).
- `advance(now)`: ticks that fell due, at most one after a stall (:46-53). `phase(now)`: `(now - last) / interval`,
  clamped (:40-44).
- The listener only ticks while the music is playing (src/engine/listener.ts:100-103); `ticks` is never reset, even
  for a new source or a forgotten tempo (:123-129).
- The KickHearer keeps its own phase (`due`, src/engine/kick-hearer.ts:70) separate from the tick clock's; the two
  only meet through the kicks it lets through.

### 7. From hearing to frames

- `Controller.step` hears on real elapsed time but moves the show on `dt` capped at 0.1 s (src/app/controller.ts:906-916).
- `onBeats`: each kick counts towards auto-switch (32 kicks, src/state/app-state.ts:7), with a 45 s fallback
  (:8, src/app/controller.ts:925); each tick goes to the studio (src/app/controller.ts:785-792).
- Studio autopilot counts ticks to the next take and resets the count at every take (src/app/studio.ts:365, :375-381);
  it also moves on by wall clock when ticks never come (:460-473, src/state/show-plan.ts:9-10).
- The director samples energy, bass and tone on every studio tick (src/director/director.ts:104-106) and sends tempo,
  mood, tone and an energy trend to Claude (src/director/digest.ts:37-38). The studio only emits ticks while the
  autopilot is on with two or more show scenes (src/app/studio.ts:376-378), so the director's energy history only grows
  then.
- `composeFrame` (src/engine/look.ts:36-65), once per output: bands and level × Reactivity capped at 1.5, the kick
  flash capped at 1 (:37-42); the clock's pace eases towards `speed·(0.55 + 0.9·level + 0.35·beat)` (:45-47); the hue
  walks and jumps on a kick by Colour cycling (:49); the effects' turn runs on with bass and kicks (:29, :50); tone
  and mood grade colour, trails and fringing through Synesthesia (:56-79). Tick phase and count pass through unscaled
  (:55).
- Effects read the frame's inputs: Glow swells with `uBass` and ducks on `uBeat` (src/engine/effects.ts:137), Wave
  rings out on `uBeat` (:161-166), Kaleidoscope turns with the turn (:88-104).
- The projector receives the whole `ProgramState`, spectrum included, by `postMessage` (src/engine/output-link.ts:121-122).
- Built-in scenes read `uBeat`, `uTick`, `uTicks`, `uBass`, `uLevel` and `spec()`; none reads `uMid`, `uHigh`,
  `uBright` or `uMood` directly (grep of src/scenes/*.ts; only the editor's template reads `uMid`). They reach the
  picture only through the Look's grade.

## Signals reference

| Signal (Hearing field → scene input) | How it is computed | Range | Updates | Consumers | Code |
|---|---|---|---|---|---|
| bins.freq | AnalyserNode byte spectrum, Blackman, unsmoothed, -100…-30 dB | 1024 × 0-255 | each rAF frame | Listener only | src/engine/audio.ts:29-33, :125-131 |
| bins.time | AnalyserNode byte waveform | 2048 × 0-255, 128 = 0 | each frame | spectrum texture | src/engine/audio.ts:129 |
| smoothed bins | bins.freq smoothed per frame on linear magnitude by Smoothing (0-0.95) | 1024 × 0-255 | each frame | bands, spectrum texture | src/engine/listener.ts:170-184 |
| bass / mid / high → uBass uMid uHigh | mean smoothed dB byte in band, adaptive normalised, attack 30/s, release 6/s | 0-1 (≤ 1.5 after Reactivity) | each frame | composeFrame, meters, scenes, Glow, director (bass) | src/engine/listener.ts:134-151, src/engine/look.ts:38-40 |
| level → uLevel | 0.5 bass + 0.35 mid + 0.15 high, normalised the same way | 0-1 (≤ 1.5) | each frame | clock pace, Light Sheet | src/engine/listener.ts:138, :269, src/engine/look.ts:45 |
| beat → uBeat | 1 on a kick, × e^(-5 dt) | 0-1 | each frame | kick flash, turn, fringing, Glow, Wave, every built-in scene, kick dot | src/engine/listener.ts:90, :159, src/engine/look.ts:42 |
| kick | a peaked 20-280 Hz rise on the heard pulse (unsmoothed bins), ≥ 0.28 s apart | boolean, one frame | on event | hue jump, auto-switch count, tempo, tick re-anchor | src/engine/kick-hearer.ts:100-133, src/app/controller.ts:787-790 |
| bpm (tempo) | round(60 / mean of the gaps within 10% of the median of ≤ 11 kick gaps), from 5 kicks, folded to 85-175; forgotten after 90 s playing without kicks | integer in 85-175, or null | each kick | tick clock, mood, meters, studio bar, assistant, director | src/engine/listener.ts:98-99, :188-210, :261-266 |
| tick | TempoClock: due ticks + kicks ≥ ½ interval after the last tick; only while playing | boolean, one frame | on event | studio autopilot, director cycles | src/state/tempo-clock.ts:32-53, src/engine/listener.ts:100-101 |
| tickPhase → uTick | (now - last tick) / interval, clamped | 0-1 | each frame while playing | Light Sheet, Point Storm, Ring Run, Scan Trace | src/state/tempo-clock.ts:41-44, src/engine/listener.ts:102 |
| ticks → uTicks | running count, never reset | 0… | on tick | every built-in scene except Light Sheet (mod 3 / mod 4 patterns) | src/engine/listener.ts:103 |
| bright (tone) → uBright | log-mapped spectral centroid 1-8 kHz of the unsmoothed bins, 2.5 s | 0-1 | each frame (held in quiet) | grade, trails, fringing, meters, assistant, director | src/engine/listener.ts:215-231 |
| centroid | smoothed spectral centroid | Hz | each frame | meter tooltip only | src/engine/listener.ts:228, src/app/controller.ts:953 |
| energy | (2.5 s level average - 0.45) / 0.35 | 0-1 | each frame | mood, director trend | src/engine/listener.ts:104 |
| mood → uMood | 0.55 tempo(80-160, over 10 s) + 0.45 energy, 2 s | 0-1 | each frame | grade, mood word | src/engine/listener.ts:105-108 |
| spectrum → uSpec | 256 log-spaced smoothed bins 23 Hz-16 kHz with a treble tilt (R) + downsampled waveform (G) | 256 × RG bytes | each frame | `spec()` / `wave()` in shaders, visual maker's Spectrum node | src/engine/listener.ts:245-257, src/scenes/header.ts:29-30, src/engine/nodes.ts:94 |

## Monitoring today

- **Audio widget:** Bass / Mid / High bars, a Tone marker (tooltip: tone word and centroid in kHz), a dot whose
  opacity follows `beat`, `~N BPM` or `— BPM`, and the mood word (src/components/widgets/sections.tsx:80-97). They are
  pushed into the UI store every second frame (src/app/controller.ts:946-954, src/state/ui-state.ts:60-61).
- **Studio tick bar:** ticks counted towards the next take, and the tempo (src/components/Studio.tsx:62, :154-160).
- **Performance overlay:** time spent in "Audio analysis" per frame (src/engine/profiler.ts:13, :19), not what it heard.
- **Director digest:** tempo, mood, tone and per-cycle energy / bass / brightness series sent to the model
  (src/director/digest.ts:37-38). Not shown as a graph.
- **For your own shaders:** the editor's cheat sheet lists `spec(x)` and `wave(x)` (src/components/Editor.tsx:138), and
  the e2e test shows a one-line shader can display `uTick` and `uTicks` (e2e/tick.spec.ts:4).
- **Offline, since #66:** `npm run clips:record` records what an analyser set up like the app's hears in each
  reference clip, and the real-music test replays it through `Listener.hear` and logs the tempo, kicks per beat of the
  published tempo, how well the ticks fit a steady grid, and tone and mood in the drop and the breakdown
  (tools/reference/record-clips.ts, tools/reference/replay.ts:30-49, tools/reference/measure.ts,
  docs/reference-clips.md). This is a developer's test run, not a live view.

What is missing in the app: the spectrum or the uSpec texture, the raw (un-normalised) bands and their averages, the
kick rise and the pulse the KickHearer hears (all private, src/engine/listener.ts:73-86,
src/engine/kick-hearer.ts:50-75), kicks and ticks as separate events, the kick gaps the tempo comes from, any
confidence, the energy and mood over time, frame timing, and latency.

## Weaknesses (each from the code)

1. **Tempo octave and syncopation errors: mostly fixed by #66, not correctable.** The tempo is folded into 85-175 BPM
   (src/engine/listener.ts:35, :260-266), the KickHearer prefers pulses near 120 BPM and takes half the period when the
   rises repeat as strongly there (src/engine/kick-hearer.ts:28, :209, :212-215), and rises off the pulse are not
   kicks (:121-123). So a half-time grid at 72 reads 144 and kicks at 190 read 95 (src/engine/listener.test.ts:51-64).
   What is left is the octave inside the range: drum & bass may read 87 or 174, and a half-time track published at
   82 reads 164 (docs/reference-clips.md). Folding chooses by range, not by the music, and nobody can halve or double
   it by hand. Tempo octave ambiguity is a known, largely unsolved problem even for research systems
   ([McKinney & Moelants, ISMIR 2004](https://archives.ismir.net/ismir2004/paper/000197.pdf);
   [Gouyon et al. 2006](https://repositori.upf.edu/items/d312940d-f18a-402f-88ed-64c3df34a354)).
2. **No confidence, no lock, slow to follow.** `bpm` is replaced on every kick after the fifth (:207-209). Averaging
   the agreeing gaps (:202-206) steadies it, and the number of agreeing gaps is a ready confidence, but nothing reports
   it and the user cannot correct the tempo. The meter's `~` is the only hint (src/components/widgets/sections.tsx:94).
   A DJ's tempo change now takes 6-7 s to follow (src/engine/listener.test.ts:106-129), and forgetting after 90 s
   without kicks also drops a tempo the user would have wanted kept through an ambient interlude (:98-99).
3. **Kicks re-anchor the ticks unconditionally.** Any kick ≥ ½ interval after the last tick counts as a tick and
   re-anchors the next one (src/state/tempo-clock.ts:34-36). Since #66 the KickHearer only lets through kicks near
   its own pulse (src/engine/kick-hearer.ts:122), so an off-beat bass note no longer shifts the ticks. But the
   KickHearer's phase can still move, while unsettled, to wherever the comb hears the most rise for three readings
   (:243-251), and the tick clock follows whatever it is given. A kick that arrives just after a scheduled tick moves
   `next` but not `last`, so `phase` reaches 1 and holds there until the late tick (src/state/tempo-clock.ts:36, :43).
   There is no phase-error gating or gradual correction in the tick clock.
4. **False kicks and missing kicks: the rolling bassline is fixed by #66, two cases remain.** The kick is a peaked
   low-band rise on a periodic pulse, so a bass note between kicks no longer counts
   (src/engine/listener.test.ts:84-105). But periodic piano or arpeggio notes that rise in the 20-280 Hz band are heard
   as kicks, so on both ambient reference clips the tempo is never forgotten (tools/reference/listener-music.test.ts:43-45,
   :49, :52). And music without a steady low-band pulse gives no kicks at all, so no tempo and no ticks: two Lazy Mix
   clips are expected to fail for that (:40-42, :47-48). The studio then falls back on wall-clock steps
   (src/app/studio.ts:460-473) and the docs suggest switching to seconds (docs/studio.md:53-54). Rises are only summed
   over the kick's bins; a spectral flux over the whole spectrum is the standard remedy for music whose rhythm is
   elsewhere ([Bello et al. 2005](https://www.cs.bu.edu/fac/snyder/cs583/Literature%20and%20Resources/bello_onset_tutorial.pdf);
   [Dixon, DAFx 2006](https://dafx.de/paper-archive/details/_kscRgr98aSFW4l-j1YJuA)).
5. **Frame-rate coupling, smaller since #66.** The listener reads the analyser once per rAF frame
   (src/app/controller.ts:916), so kick timing is quantised to the frame (the 8 fps test accepts 115-130 for 124,
   src/engine/listener.test.ts:131-136). The rises are written into 10 ms cells and the kick window widens by the frame
   gap, so the pulse reads the same at any frame rate (src/engine/kick-hearer.ts:20, :122, :162-173). The rise itself
   compares with two frames ago, so its size still depends on the frame rate (:151). The Listener's Smoothing is applied
   once per `hear()`, not by `dt` (src/engine/listener.ts:177-179), so the same setting is calmer at 120 Hz than at
   30 Hz; it now shapes only the look. In a hidden tab rAF is throttled, nothing is heard, and the tick clock catches
   up by one tick (src/state/tempo-clock.ts:46-51).
6. **Latency is unmeasured and uncompensated.** Delay before a kick shows: half the 42.7 ms window, one more frame
   while the KickHearer waits to see the rise turn (src/engine/kick-hearer.ts:107-112), up to one frame waiting for
   rAF, render and display, plus a `postMessage` hop and another frame for projectors
   (src/engine/output-link.ts:121-122). The analyser no longer smooths (fixed by #66), but the bands still carry the
   Listener's Smoothing (τ 0.6 per frame ≈ 33 ms time constant at 60 fps: -16.7 ms / ln 0.6). Meanwhile the sound
   reaches the listener's ears `AudioContext.outputLatency` later than the analyser sees it
   ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)), which can be large over
   Bluetooth. The code reads neither `outputLatency` nor `baseLatency`, and ticks are not scheduled ahead.
7. **Normalisation is in the dB-byte domain with fixed constants.** Bands, energy and the kick's rise all work on
   bytes from a fixed -100/-30 dB range (src/engine/audio.ts:32-33). A quiet line-in sits low in that range, a hot
   master clips at 255, and `energy`'s 0.45 / 0.8 ends (src/engine/listener.ts:31) were tuned on the reference clips
   through the default range. The kick no longer needs an absolute bass level (fixed by #66), but it needs a rise of
   at least 8 byte steps summed over its bins (src/engine/kick-hearer.ts:16, :123).
8. **No bar, downbeat or phrase.** `ticks` counts from an arbitrary start and is never reset (src/engine/listener.ts:103,
   :123-129). Scenes use `mod(uTicks, 4.)` as if it were a bar (src/scenes/wire-solid.ts:43, :50), plans describe 32
   ticks as "8 bars of 4/4" (src/state/show-plan.ts:14), and docs/studio.md:74 says the autopilot takes plan steps "on
   the bar", but the tick count restarts at each take (src/app/studio.ts:365), so takes land on a tick, not on bar 1.
9. **Tempo shapes the mood, so tempo errors leak into colour.** The tempo's part of the mood is 55%, followed over
   10 s (src/engine/listener.ts:34, :106-107), and so moves the grade's saturation and warmth
   (src/engine/look.ts:71-78). Since #66 a brief mishearing barely shows and a halved tempo is folded back, but an
   octave error inside the range (87 against 174) still moves the mood by its full tempo share.
10. **Auto-switch and the hue jump count kicks, not ticks.** A breakdown holds the scene by design
    (src/app/controller.ts:782-790), but a passage with false kicks (weakness 4) also switches scenes faster.
11. **Silence handling is reasonable.** Bands go to 0 under 0.02 (src/engine/listener.ts:149), kicks need a rise on a
    periodic pulse, tone holds, mood and tone relax when nothing plays, ticks stop. A live input in a quiet room is
    still "playing" (src/app/music-source.ts:48-55), but since #66 its tempo is forgotten after 90 s without kicks and
    the ticks stop (src/engine/listener.ts:98-99), unless something periodic is heard as kicks (weakness 4).
12. **Tests: real music now, still gaps.** Synthetic tests cover half-time, doubled and 174 BPM kicks, the range,
    a rolling bassline, forgetting and pauses (src/engine/listener.test.ts:42-215), and eight recorded reference clips
    are replayed against their right answers (tools/reference/listener-music.test.ts). Nothing exercises kicks that
    are themselves off the tick (breakbeats, a kick pattern with a skipped beat), gain changes, or a tempo that must
    hold through a long kickless stretch, and the known failures (tone in breakdowns, two clips without a steady kick,
    false kicks in ambient, slow tempo changes) are listed rather than fixed.

## Opportunities (fan-out)

Effort: S ≈ under a day, M ≈ a few days, L ≈ a week or more. "Depends on" names what must exist first. Rows marked
**partly exists** say what #66 already built.

### A. A Listener monitor (make it visible)

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **Listener panel** (a widget or overlay like the Perf overlay, src/engine/profiler.ts): the 256-bin log spectrum from `listener.spectrum` with the three band edges drawn on it; raw vs normalised band bars; the kick rise against the threshold the KickHearer uses, and its pulse | See why a kick did or did not fire; tune Smoothing by eye | S-M | Expose `raw`, `avg` and the KickHearer's rise, pulse and threshold read-only (today private, src/engine/listener.ts:73-86, src/engine/kick-hearer.ts:50-75) |
| **Event strip:** a scrolling 8-10 s timeline with kicks (one colour), ticks (another), tick phase as a sawtooth, and the kick gaps as labels | Shows off-pulse re-anchoring, missed kicks and an octave error at a glance | M | A small ring buffer of events in the Listener; the replay already gathers kick and tick times (tools/reference/replay.ts:23-28) |
| **Tempo readout with confidence:** tempo, the share of kick gaps that agree with the median (already counted, src/engine/listener.ts:202-205), and a steady / unsure / none state | Tells the VJ whether to trust tick units or switch to seconds (docs/studio.md:53) | S | Weakness 2 |
| **Ground-truth check on the demo beat:** show "heard 124 / actual 124" while the demo plays (src/engine/audio.ts:49, :119) | A free self-test of the whole chain, also usable in e2e | S | — |
| **Tap comparison:** tap a key, show tapped vs heard tempo and the phase offset between taps and ticks | Measures octave and phase errors live; becomes the input for B2 | S | — |
| **Latency figure:** show `ctx.baseLatency + ctx.outputLatency` and frame time; a calibration mode that flashes on the tick while you tap along | Makes weakness 6 visible; gives an offset to apply | S-M | — |
| **Energy / mood / tone history:** the last few minutes as sparklines, the same series the director sees (src/director/history.ts) | Lets a human read the build-ups and drops the director is told about | S | — |
| **Record and replay the hearing: partly exists.** Reference clips are recorded offline through an analyser like the app's and replayed through `Listener.hear` in tests (tools/reference/record-clips.ts, tools/reference/replay.ts:30-49). Missing: recording the live music's bins in the app, and replaying a recording in the monitor | Reproducible bug reports from a real set; new regression traces without a clip on the list | S-M | — |

### B. Better hearing (improve the analysis itself)

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **B1. Octave folding and a range prior: partly exists.** The tempo folds into 85-175 (src/engine/listener.ts:260-266) and the pulse has a 120 BPM prior and a halving check (src/engine/kick-hearer.ts:28, :209-215). Missing: choosing between two readings both in range by how well their ticks line up with the kicks | Fewer 87 / 174 errors | S | Tests with drum & bass and half-time patterns |
| **B2. Tap, halve, double, nudge, lock:** keys that set or scale the tempo, shift the phase, and stop the listener from replacing it | The VJ fixes in one press what no algorithm gets right every time; standard in DJ and VJ tools | S | A locked flag next to `hearing.bpm`; the TempoClock already keeps phase on a rate change (src/state/tempo-clock.ts:20) |
| **B3. Tempo confidence: partly exists.** The agreeing gaps are averaged (src/engine/listener.ts:202-206). Missing: reporting their share as steady / unsure / none, and only changing the tempo when a new value wins consistently | A state the monitor, the studio and the director can act on | S | — |
| **B4. Phase-gated re-anchoring: partly exists.** Kicks are gated to the KickHearer's own pulse (src/engine/kick-hearer.ts:122). Missing: gating in the tick clock itself, so a kick only re-anchors a tick it lands near, and correcting gradually | Ticks stay put if the KickHearer's phase moves (weakness 3) | S-M | Tests with off-tick kicks |
| **B5. A spectral-flux onset function: partly exists.** The KickHearer is a flux over 20-280 Hz on unsmoothed bins (src/engine/kick-hearer.ts:140-160); the analyser is now unsmoothed for it (src/engine/audio.ts:31). Missing: flux over the whole spectrum | Kicks or onsets on music without a strong kick; a novelty curve for tempo; recommended by Bello et al. 2005 and Dixon 2006 (Sources) | M | Strobe rule must be rechecked (docs/scenes.md:9-11) |
| **B6. Autocorrelation / tempogram tempo: partly exists.** The pulse is an autocorrelation of the low-band rises with a comb for its phase and a tempo prior (src/engine/kick-hearer.ts:180-265), close to the first stages of the Ellis 2007 tracker (librosa defaults: start_bpm 120, tightness 100). The tempo itself still comes from the kick gaps | Tempo from all onsets, not just kicks; robust to missed kicks | M | B5 for onsets beyond the kick |
| **B7. Analysis off the rAF:** run the listener on a fixed hop in an AudioWorklet (or a timer) and post the hearing to the main thread | Frame-rate-independent kicks and smoothing, keeps hearing while hidden | M-L | Changes the "once a frame" contract in the glossary (Listener) |
| **B8. Gain-independent bands:** derive bands from float dB data relative to a running peak or percentile instead of fixed byte constants | Same behaviour on a quiet line-in and a hot master | M | Retuning against the reference clips; meters and strobe tests |
| **B9. Latency compensation:** schedule ticks `outputLatency + render` ahead, i.e. flash the tick when it is heard, not when it is analysed | Visual hits feel on time on Bluetooth and on projectors | S-M | A latency figure (A) |

### C. Features the hearing unlocks

| Idea | Value | Effort | Depends on |
|---|---|---|---|
| **C1. Bar counter and downbeat:** a bar count and position next to `ticks`, the downbeat set by tap (or detected later), kept by the tick clock; a new scene input | Takes, plan steps, auto-switch and `mod(uTicks, 4.)` scenes land on bar 1, as docs/studio.md:74 promises | S-M | B2 (tap), B4 (stable phase) |
| **C2. Quantised takes:** the Take button and key wait for the next bar when the tempo is steady | Hand-made transitions land on the phrase | S | C1, B3 |
| **C3. Phrase-aware autopilot and director:** steps counted in bars from the downbeat; the director told "bar 13 of 16" | Changes on 8- / 16-bar phrase boundaries, where dance music changes | S | C1 |
| **C4. Build / drop / breakdown detection:** from the energy series and kick density: kicks stopping + energy holding = breakdown; rising high band + rising energy = build; kicks returning with an energy jump = drop | Big moments (a take, a Look change, a Glow burst) on the drop; richer director digest | M | A history buffer (exists for the director, src/director/history.ts); the reference clips already mark drops and breakdowns (reference/clips.json) |
| **C5. Tempo-synced motion for effects and scenes:** expose the tick phase at ½, 1, 2, 4-tick periods (or the bar's phase) so a Kaleidoscope turn or a Wave can cycle exactly once a bar | Motion that locks to the music rather than drifting with `uTime` | S | C1 for bar periods. Must stay within ADR 0003: each effect moves "with the music in one fixed way" |
| **C6. Per-band routing to effect settings** (bass → Glow strength, high → Wave, …) | Expressive control | M | **Contradicts ADR 0003**, which rejected free routing because it has no known worst case to check against the strobe and black-edge rules |
| **C7. External clock in:** MIDI clock / Song Position over the Web MIDI API, or Ableton Link via a local bridge (Link has no official browser implementation) | Ticks and bars locked to the DJ's or band's gear: no hearing error at all | M (MIDI) / L (Link) | B2's lock path; the desktop app's local server (docs/desktop.md) could host a Link bridge |
| **C8. Analyse files ahead:** for a file or SoundCloud track, decode it once (OfflineAudioContext) and compute tempo, ticks and downbeats before it plays | Correct tempo and bars from the first second, and seeking keeps the grid | M-L | The reference recorder already renders clips through an OfflineAudioContext analyser (tools/reference/record-clips.ts:45-60), but only for tests; madmom-style joint beat + downbeat tracking is the research state of the art (Böck et al. 2016) but is Python / neural |
| **C9. Hearing-driven assistant answers:** let the assistant read the monitor's numbers ("your tempo is unsure; switch to seconds?") | Turns monitoring into advice | S | A, B3 |

## Recommendation

Decided with the user and recorded in
[ADR 0004: Bars are four ticks from a tapped downbeat](../adr/0004-bars-are-four-ticks-from-a-tapped-downbeat.md).

**Goal order.** Trust first: the VJ can see what the listener hears and correct it. Then musical structure: bars.
Build / drop detection (C4), spectral-flux onsets over the whole spectrum (B5), MIDI clock and Ableton Link (C7) and
analysing files ahead (C8) are deferred. ADR 0003 stays closed: no free per-band routing (C6).

### 1. Correct the tempo (B2, B3, B4)

- **Tap, halve, double, nudge, lock.** Keys: **Q** tap, **K** lock, **-** / **=** halve / double, **{** / **}** nudge
  ±1 BPM. A run of taps sets the tempo and the downbeat; a single tap moves only the downbeat. The **[** / **]** keys,
  today "Tempo −5 % / +5 %" (src/hotkeys/registry.ts:41-42), are renamed Speed, so the word tempo means only what is
  heard or set.
- **A set tempo beats the heard one.** A tapped, halved, doubled, nudged or locked tempo is not replaced by the next
  kicks. A lock and a downbeat last through a pause and a seek, and clear when the next music starts (where
  `reset()` runs today, src/app/controller.ts:689-695). A locked tempo is not forgotten after 90 s without kicks
  (today src/engine/listener.ts:98-99), so its ticks and bars carry on through an ambient interlude. A heard tempo
  stays folded into 85-175; only Halve and Double leave that range.
- **Tempo confidence.** The tempo is steady, unsure or none; a locked tempo is steady. Anything that waits for a bar
  waits only when the tempo is steady, and otherwise acts at once or counts in seconds.
- **Ticks re-anchor only on kicks near the expected tick.** A kick between ticks still jumps the hue and counts
  towards auto-switch, but no longer moves the ticks (src/state/tempo-clock.ts:32-38). The Listener stays once a
  frame, but compensates for frame time.

### 2. Bars (C1, C2, C3)

- A bar is always four ticks. The downbeat is set by a tap; until then, bars count from when the tempo was first
  heard, so they keep their place across takes.
- Bars become a scene input, and the built-in scenes move from `mod(uTicks, 4.)` to it (src/scenes/wire-solid.ts:43,
  :50 and the others).
- A take waits for the next downbeat when the tempo is steady; pressing Take again takes at once.
- Studio steps and plans count in bars, falling back to seconds when the tempo is not steady (src/state/show-plan.ts:14,
  src/app/studio.ts:375-381). This makes docs/studio.md:74's "on the bar" true.

### 3. Monitor (A)

- The Audio widget (src/components/widgets/sections.tsx:80-97) grows the tempo with its confidence, a kick-against-tick
  strip, tap controls, and the demo beat's 124 BPM check.
- It opens a detailed overlay: the spectrum, the raw bands, the kick rise against its threshold, and a latency figure.
- A manual latency offset setting.

### 4. Traces

New replay tests on the existing reference tooling (tools/reference/, docs/reference-clips.md): half-time, off-tick
kicks, and a locked tempo held through a kickless stretch.

## Sources

Code (this repo, commit ffc913b): src/engine/audio.ts, src/engine/listener.ts, src/engine/kick-hearer.ts,
src/state/tempo-clock.ts, src/engine/look.ts, src/engine/scene-inputs.ts, src/engine/effects.ts, src/app/controller.ts,
src/app/studio.ts, src/app/music-source.ts, src/director/director.ts, src/director/digest.ts, src/state/show-plan.ts,
src/state/prefs.ts, src/hotkeys/registry.ts, src/components/widgets/sections.tsx, src/components/Studio.tsx,
src/scenes/*.ts, src/engine/listener.test.ts, src/state/tempo-clock.test.ts, e2e/tick.spec.ts, tools/reference/*.ts,
reference/clips.json, GLOSSARY.md, docs/audio.md, docs/studio.md, docs/scenes.md, docs/settings.md,
docs/reference-clips.md, docs/adr/0003-effects-belong-to-the-show-scene.md,
docs/adr/0004-bars-are-four-ticks-from-a-tapped-downbeat.md. package.json has no audio-analysis dependency.

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

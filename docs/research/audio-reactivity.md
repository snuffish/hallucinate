# Audio reactivity: onsets, beats, tempo and monitoring

Research notes, 2026-10-18. They answer: *"Any good approaches regarding audio-reactive-responsiveness? FFT analyzer
or something? Does the sound engine hit the beats? I also would like to be able to track/monitor the frequency, beat,
BPM and all what it entails."*

Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). A **Kick** is a bass hit on the pulse (an onset that the beat
tracker accepts). A **Tick** is one beat of the steady tempo clock. The **Tempo** is the BPM, and the **Hearing** is
what the **Listener** reports each frame. "Onset" and "beat" are used only for the general literature.

Claims about external sources cite the numbered [Sources](#sources). "Derived" means worked out here from a cited
formula. "Unverified" means no primary source was checked for it.

## TL;DR

- **Does the sound engine hit the beats today?** Yes. Since #66 the Listener runs a real beat tracker and does
  more than react to energy. It measures spectral flux in the kick band, finds the tempo by autocorrelation with a
  log-Gaussian tempo prior and the beat phase with a comb, and only counts a rise as a Kick when it lands where the
  next pulse is due. A flywheel clock then keeps the Ticks going through breakdowns. Scenes read this as `uBeat`
  (kick pulse), `uTick` (beat phase 0..1) and `uTicks` (beat count).
- **But the hits are reactive and not latency-compensated.** Every Kick and every Tick re-anchor is timestamped when
  the analysis frame sees it, in `requestAnimationFrame` time. Nothing accounts for the analyser window, for
  frame-rate quantisation, for `baseLatency`/`outputLatency` [4] or for display lag. With files, the analyser even
  runs *ahead* of what you hear, while with mic or tab input it runs *behind*. "On the beat" is therefore only
  approximate, and the error depends on the setup.
- **The building blocks are sound for this genre:** rectified spectral flux [10][11], an autocorrelation tempo with a
  120 BPM prior in the style of Ellis [13] (0.9 octaves wide here, 1.4 in the paper), and octave folding into
  85–175 BPM so that half-time 72 reads 144. The real-music reference tests show 4/4 psytrance passing on BPM, Kicks
  and Ticks (`tools/reference/listener-music.test.ts`).
- **Biggest gaps compared with what you asked for:** there is no monitoring view beyond three band meters, a beat
  dot and "~BPM" (`src/components/widgets/sections.tsx:80-96`). There is no BPM confidence, no onset function or
  threshold to look at, no latency figures, no tap tempo or BPM lock, and no bar or downbeat phase. The spectrum is
  8-bit and clips at −30 dB, which the code itself works around.
- **Libraries:** none of them is a clear win. Essentia.js is AGPL-3.0, while aubio and BTrack are GPL-3.0, so none
  of them fits an MIT app that you ship. Meyda (MIT) has no beat or tempo tracking.
  `realtime-bpm-analyzer` (Apache-2.0) only estimates BPM, in a 90–180 range. `web-audio-beat-detector` (MIT) is
  offline-only, which makes it interesting for files.
- **Recommended path (small to large):** first a *Hearing monitor* overlay. Then a latency offset with predictive
  Ticks and tap tempo or BPM lock. Then a float spectrum and extra onset inputs. Only if needed, move the analysis
  into an AudioWorklet, and do offline beat-grid analysis for files.

## Current state in hallucinate

**Signal path.** `AudioEngine` (`src/engine/audio.ts`) sends every source into one `AnalyserNode` with
`fftSize = 2048` and `smoothingTimeConstant = 0` (`audio.ts:30-31`). `minDecibels` and `maxDecibels` keep the spec
defaults of −100 and −30 dB [1]. The source connects to the analyser and, only when it is audible, to a volume
`GainNode` *after* the analyser (`audio.ts:65-68`). That is why volume and mute don't change the visuals
(docs/audio.md:27). Once per animation frame `read()` calls `getByteFrequencyData` and `getByteTimeDomainData`
(`audio.ts:125-130`). The controller passes the bins to `listener.hear(bins, playing, elapsed, now/1000)`, where
`now` is the rAF timestamp (`src/app/controller.ts:916`). The analysis therefore runs on the main thread, at the
display frame rate, in `performance.now()` time rather than `AudioContext` time.

**What the Listener derives** (`src/engine/listener.ts`, the pure owner of every threshold):

| Feature | How | Where |
|---|---|---|
| Bands `bass` 25–140 Hz, `mid` 140–2000 Hz, `high` 2–12 kHz, plus `level` | Mean of the dB-scaled byte bins in each range, after the Listener's own smoothing in the linear domain (Settings → Smoothing, default 0.6) | `listener.ts:14`, `:131-138`, `:170-185`, `:272-278` |
| Adaptive normalisation (AGC) | Each band is compared with a 2.5 s running average and mixed with its absolute level. Attack is ~33 ms and release ~167 ms (time constants) | `listener.ts:140-149` |
| Kick | `KickHearer`: positive flux over 20–280 Hz bins measured against two frames earlier. The rises are kept in 10 ms cells for 6 s. A recency-weighted autocorrelation is summed over 3 multiples and weighted by a log-Gaussian prior at 120 BPM with σ = 0.9 octaves. A "half-lag" check guards against period doubling, and a comb places the phase. A Kick is a local peak of the rise that falls inside a ±6 % window around the predicted pulse and is strong enough. Rises off the pulse (rolling bass, hats) are rejected. | `src/engine/kick-hearer.ts:14-31`, `:100-131`, `:182-254` |
| `beat` (→ `uBeat`) | Set to 1 on a Kick, then decays as `exp(-5·dt)` | `listener.ts:90`, `:158-162` |
| Tempo (`bpm`) | Median of the gaps between the last 12 Kicks, averaged over the gaps within ±10 % of it and **folded into 85–175 BPM**. Held through breakdowns and forgotten after 90 s without Kicks. | `listener.ts:16-18`, `:35-36`, `:188-209`, `:261-266` |
| Tick, `tickPhase` (→ `uTick`), `ticks` (→ `uTicks`) | `TempoClock`: a flywheel at the tempo that re-anchors on each Kick | `src/state/tempo-clock.ts:21-55`, `listener.ts:100-103` |
| Tone (`bright`), `centroid` | Spectral centroid from 60 Hz to 16 kHz, mapped on a log scale from 1 to 8 kHz and eased over 2.5 s | `listener.ts:215-232` |
| Energy, mood | Band level over seconds, plus the tempo | `listener.ts:104-114` |
| Spectrum texture | 256 log-spaced spectrum bins and 256 waveform samples for the shaders | `listener.ts:245-258` |

Shader inputs are declared once in `src/engine/scene-inputs.ts:13-25`: `uBass`, `uMid`, `uHigh`, `uLevel`, `uBeat`,
`uTick`, `uTicks`, `uBright` and `uMood`, plus the spectrum texture.

**Psytrance-specific tuning (#57, #62, #63, #66).** These are the changes aimed at psytrance:

- Kicks are told apart from the rolling bassline between them by their periodicity, not by their level
  (`kick-hearer.ts:1-7`).
- The kick band reaches up to 280 Hz "which still rises when the sub is clipped" (`kick-hearer.ts:14`).
- The half-lag check stops 145 from being read as 72.5 (`kick-hearer.ts:212-215`).
- The tempo range is 85–175 BPM, with half and double readings folded into it (`listener.ts:35`, `:261`).
- The tone's 8 kHz ceiling leaves room above bright psytrance (`listener.ts:19-23`).

The real-music suite replays analyser recordings of reference clips through the Listener
(`docs/reference-clips.md`). It checks tempo within ±1 BPM, 0.9–1.1 Kicks per beat, and 90 % of Ticks within 40 ms of
the beat grid. The known failures are listed in the test's `EXPECTED_TO_FAIL`, for example "periodic piano heard as
kicks" in ambient clips (`tools/reference/listener-music.test.ts:31-53`).

**Gaps against the request:**

1. **Monitoring.** The Audio widget shows Bass, Mid and High bars, a tone marker, a beat dot, `~N BPM` and the mood
   (`sections.tsx:80-96`). It is updated every 2nd frame (`controller.ts:946-955`). There is no spectrum view, onset
   curve, threshold, Tick timeline, confidence or latency readout. `PerfOverlay` (Shift+P,
   `src/components/PerfOverlay.tsx:16`) is a precedent for a diagnostics overlay.
2. **No confidence.** `bpm` is a number or `null`. The KickHearer computes a clarity (`acf/energy`) and a "settled"
   state (`kick-hearer.ts:216`, `:232`) but does not expose them. The Listener deliberately hides its state
   (`listener.ts:3-4`).
3. **No latency handling.** There are no reads of `baseLatency`, `outputLatency` or `getOutputTimestamp` (grep
   across `src/`). A Kick is confirmed one frame after its peak (`kick-hearer.ts:107-112`). The `TempoClock`
   re-anchors at that detection time (`tempo-clock.ts:32-38`), so `uTick` = 0 trails the audible attack by the
   detection delay.
4. **8-bit, clipped spectrum.** Byte data clip at `maxDecibels` = −30 dB [3]. By the spec's formulas [2], a
   full-scale sine reads about −13.6 dB in its peak bin: |X| ≈ ½ · 0.42 (Blackman mean) (derived). Loud kicks
   therefore saturate, which is what `kick-hearer.ts:14` works around.
5. **Coarse low-end resolution.** At 48 kHz the bins are 23.4 Hz wide (derived: 48000 / 2048), so the bass band is
   only bins 1–6 and the kick band bins 1–12. In the frequency domain, kick and sub-bass cannot be separated.
6. **Frame-rate-bound timing.** Onset times are quantised to the display frame (16.7 ms at 60 fps). The rises are
   resampled into 10 ms cells, but they still only update once per frame (`kick-hearer.ts:162-172`).
7. **No bar or downbeat phase.** `uTicks` counts beats, but its `mod 4` is not aligned to the bar.
8. **Tempo range versus faster psytrance.** `foldTempo` halves anything above 175, so 190 reads 95 (a test in
   `listener.test.ts:59`). Hi-tech and darkpsy at 180+ BPM would display at half tempo. Those tempos are a genre
   convention (unverified).

## Building blocks: what the AnalyserNode gives you

From the W3C Web Audio API spec [1][2][3]:

- `fftSize` is a power of two from 32 to 32768, 2048 by default. `frequencyBinCount` = `fftSize`/2. The analysis
  uses "the most recent `fftSize` sample-frames" [1].
- The pipeline is: down-mix to mono, apply a **Blackman window** (α = 0.16), run the FFT with 1/N scaling, smooth
  over time with **X̂[k] = τ·X̂₋₁[k] + (1−τ)·|X[k]|** where τ = `smoothingTimeConstant` (default 0.8), then convert
  to dB with Y[k] = 20·log₁₀ X̂[k] [2].
- `getFloatFrequencyData` returns Y[k] in dB, unclipped. `getByteFrequencyData` returns
  ⌊255/(dBmax−dBmin) · (Y[k]−dBmin)⌋, clipped to 0..255 [3].
- If you call either method twice within the same render quantum, the second call returns the cached result [3].
  The render quantum is 128 frames by default; the 1.1 spec adds `renderSizeHint` [6].
- `getByteTimeDomainData` returns ⌊128·(1+x)⌋. `getFloatTimeDomainData` returns raw samples [3].
- For onsets, the time-frequency trade-off matters. A 2048-sample window is 42.7 ms at 48 kHz, and its centre trails
  the newest sample by about 21 ms (derived). A larger FFT sharpens frequency but smears onsets further.

Practical consequences (opinion):

- Read **float** data when you need dynamics and the byte scale only for display.
- Do smoothing yourself, as the Listener already does, so that onset detection sees unsmoothed bins.
- Bucket bands **log-spaced** (octaves or ⅓-octaves, or mel-like). Linear bins over-weight the treble: 2–12 kHz is
  ~427 bins, while 25–140 Hz is 6.
- For the kick specifically, a time-domain low-pass or band-pass envelope (BiquadFilterNode, or a worklet) gives
  millisecond timing that a 2048-point FFT cannot. `realtime-bpm-analyzer` takes this route, with a 150–200 Hz
  low-pass and time-domain peaks [19].

## Onset and beat detection approaches

**Onset detection functions (ODFs).** Bello et al.'s tutorial [10] sorts them into energy- and amplitude-based,
spectral (HFC, spectral difference or flux), phase-based and probabilistic families.

- **HFC** (high-frequency content) weights each bin by its frequency. It is "notably successful" on percussive
  onsets but "less robust at detecting the onsets of low-pitched and nonpercussive events" [10]. That makes it good
  for hats and snares and wrong for kicks.
- **Spectral flux** sums the half-wave-rectified increase in bin magnitude between frames. Dixon [11] found that it
  performed as well as phase- and complex-domain functions while being "the simplest and fastest". In his tests the
  L1 norm on *linear* magnitude was favoured over log magnitude (STFT N=2048, 10 ms hop).
- Bello's guidance is to "choose the method with minimal complexity that satisfies the requirements". For very
  percussive signals, time-domain methods are usually adequate [10].

**Peak picking with an adaptive threshold.** Dixon [11] normalises the ODF to mean 0 and SD 1. A frame is an onset
when all three hold:

1. It is a local maximum over ±w frames.
2. It is at least the local mean over [n−m·w, n+w] plus δ.
3. It is at least a decaying threshold g_α.

Dixon uses w = 3 and m = 3. Condition 2 looks *ahead* w frames, so a causal version adds w frames of latency
(derived).

**Onset ≠ beat.** An onset detector fires on every hit, including the 16th-note bassline. A beat tracker needs a
tempo hypothesis and a phase, and keeps the onsets that agree with them. That is exactly the KickHearer's design:
pulse-gated onsets. Scheirer [12] built tempo and phase from band envelopes with banks of resonant comb filters,
"performed causally, and can be used predictively to guess when beats will occur in the future". Ellis [13]
estimates a global tempo first and then finds the optimal beat sequence by dynamic programming over the onset
envelope, with a backtrace over the whole signal. Ellis is therefore offline.

**Causal or real-time trackers.** aubio's tempo object implements Davies & Plumbley's causal tracker [15][16].
BTrack is "a causal beat tracking algorithm for real-time use" (Stark, Davies, Plumbley, DAFx-09) and exposes
`beatDueInCurrentFrame()` [17]. Both predict the next beat rather than only reacting to it. That is the property you
need for compensating latency.

**What to add here, beyond Kicks (opinion).** Per-band onset pulses can come from:

- **Snare or clap:** mid-band flux, roughly 150 Hz–4 kHz.
- **Hats:** HFC, or high-band flux above about 6 kHz.

Each one gets the same rise-and-decay envelope as `uBeat`. Off-pulse hits are fine for these, because they decorate
rather than drive the clock.

## BPM and tempo tracking

**Methods:**

- **Autocorrelation of the ODF**, optionally with a perceptual prior. Ellis weights the autocorrelation with a
  log-Gaussian window centred on τ₀ = 0.5 s (120 BPM), σ = 1.4 octaves. That was the best of the settings tried,
  agreeing 77 % with listener-tapped tempos [13]. The KickHearer uses the same form with σ = 0.9
  (`kick-hearer.ts:28`, `:209`).
- **Comb-filter resonators** [12].
- **IOI histograms**, which cluster the intervals between detected peaks. `realtime-bpm-analyzer` groups peak
  intervals into tempo candidates with counts [19]. The Listener's median-of-Kick-gaps is a robust variant
  (`listener.ts:188-209`).
- **Percival & Tzanetakis** (2014): autocorrelation plus cross-correlation with pulse trains. It is in Essentia as
  `PercivalBpmEstimator` [21].

**Octave errors.** A periodic Kick grid also correlates at 2× and 3× its period, so the 145 and 72.5 BPM readings
compete. The defences:

1. A tempo prior [13].
2. Checking whether the half lag correlates nearly as strongly (`kick-hearer.ts:212-215`).
3. Folding into a fixed range, which the Listener does at 85–175 and `realtime-bpm-analyzer` at 90–180 [19].

For four-on-the-floor psytrance in the brief's 138–150 range (unverified as a genre statistic), folding is safe.
Faster subgenres (180+) are the remaining trap; see Gap 8.

**Confidence.** Each library reports it differently:

- aubio exposes `aubio_tempo_get_confidence` [15].
- Essentia's `BeatTrackerMultiFeature` returns a 0–5.32 confidence [20].
- `realtime-bpm-analyzer` reports candidate counts and a `bpmStable` event [19].

Here the KickHearer's normalised autocorrelation peak (`acf[bestLag]/energy`), its `steady` count and its "settled"
flag are natural confidence signals that already exist.

**Tap tempo / BPM lock (fallback).** `TempoClock.setBpm()` and `onDetectedBeat()` (`tempo-clock.ts:17-38`) already
have the right shape for taps. Taps would set the period from the mean tap interval and the phase from the last tap.
A lock flag would stop the Listener from overwriting either. This is valuable live, when a DJ mix drifts or the kick
drops out for long (opinion).

## Syncing to what the listener hears (latency)

What the spec gives you:

- `baseLatency` is the processing latency from the destination node to the audio subsystem. The spec's example is
  (2·128)/44100 ≈ 5.8 ms [4].
- `outputLatency` is the estimated time from the UA requesting playback to the device producing the sound. It is
  platform-dependent and "may change while the context is running", so query it frequently [4].
- `getOutputTimestamp()` returns `{contextTime, performanceTime}`, which maps the audio clock onto the
  `performance.now()` clock, the one rAF uses [5].
- `latencyHint` (`"interactive"` by default) trades latency for power [7].
- Browser support (MDN browser-compat-data [9]): `outputLatency` Chrome 102 / Firefox 70 / Safari 18.4;
  `getOutputTimestamp` Chrome 57 / Firefox 70 / Safari 14.1. Electron 44's Chromium is well past these.

**Where hallucinate's offset comes from** (derived from the code and the spec; magnitudes unverified):

| Term | Files / demo (analyser before the output) | Mic / tab capture (sound heard elsewhere) |
|---|---|---|
| Analysis window centre | +~21 ms late | +~21 ms late |
| Frame quantisation and peak confirmation | +up to 1–2 frames late (`kick-hearer.ts:107-112`) | same |
| Display pipeline (compositor, projector) | late, unknown | late, unknown |
| Audio output (`baseLatency` + `outputLatency`) | the analysis is **early** by this much | n/a (the capture path adds its own delay) |

So with a file on wired speakers the terms may partly cancel. With Bluetooth output the visuals may *lead*, and with
mic input they *lag* (magnitudes unverified). Because the sign varies by setup, the fix is predictive (opinion):

1. **Measure:** read `ctx.baseLatency + ctx.outputLatency` each second for files and the demo. Add a user
   **AV offset** slider in ms that covers display, projector and capture lag, plus a "tap along to calibrate" helper
   that averages the tap−Tick error.
2. **Predict instead of react:** the `TempoClock` already knows when the next Tick is due. Present Ticks and
   `uTick` at `audibleTime = analysisTime + offset`. That means firing the visual Tick when the *predicted* beat
   becomes audible, not when the Kick is detected. Pull the anchor back by the known detection delay when
   re-anchoring.
3. **Keep reactive Kicks for the "punch":** when the analysis is early (files), a small delay queue can line `uBeat`
   up with the sound. When it is late, nothing reactive can be early, so let Tick-driven motion carry the timing.
4. **Files have a superpower:** files and SoundCloud tracks are local, since the server caches them. The whole track
   can be analysed offline (`OfflineAudioContext`, as `npm run clips:record` already does) into a beat grid. That
   grid is scheduled against `getOutputTimestamp()` for zero-lag Ticks. Ellis's DP [13] is offline by design and
   short to implement.

## Libraries compared

| Library | Real-time? | Licence (MIT-compatible?) | Size | Notes |
|---|---|---|---|---|
| **Meyda** 5.6.3 [18] | Yes. Features per buffer; uses the deprecated `createScriptProcessor` (ScriptProcessorNode is deprecated in the spec [8]) | MIT ✅ | ~16 KB min | Features only: RMS, energy, centroid, flux, loudness, MFCC, chroma. **No onset picking, beat or tempo.** Its own `spectralFlux.js` says "there are major issues with it" and indexes from −bufferSize/2. |
| **Essentia.js** 0.1.3 [20][21] | Mixed. Has `RhythmExtractor2013`, `BeatTrackerMultiFeature` (Zapata et al. 2014), `PercivalBpmEstimator` and `SuperFluxExtractor`, all on a signal vector; the README claims real-time and offline use | **AGPL-3.0 ❌** | WASM 1.99 MB (539 KB gzip) | Beat trackers require 44.1 kHz input [20]. Last npm release 2021. Whether they suit a sliding real-time window is unverified. |
| **aubio** (C), aubiojs (WASM port) [15][16] | Yes, causal | aubio **GPL-3.0+ ❌**. The aubiojs repo says MIT but compiles GPL aubio, so treat it as GPL (opinion, not legal advice). | aubiojs ~427 KB unpacked | `get_bpm`, `get_confidence`, `get_last` (beat time), `get_period`. aubiojs last published 2022. |
| **BTrack** [17] | Yes, causal | **GPL-3.0 ❌** | C++ (needs a WASM build) | `beatDueInCurrentFrame()`; hop 512 / frame 1024. Python and Vamp bindings. No official JS. |
| **realtime-bpm-analyzer** 5.0.16 [19] | Yes, AudioWorklet | Apache-2.0 ✅ (keep the NOTICE) | ~160 KB unpacked | BPM only: low-pass, peaks above stepped thresholds, interval grouping, 90–180 range, `bpmStable` after 20 s by default. No beat phase in its event types. Credits Sullivan's and Tornqvist's algorithms. |
| **web-audio-beat-detector** 8.2.39 [22] | **No.** Offline on an `AudioBuffer` | MIT ✅ | ~42 KB unpacked | `analyze()` gives the BPM; `guess()` gives `{bpm, offset, tempo}` with the first-beat offset. Default range 90–180. Usable for files as a whole-track beat-grid seed. |

Verdict (opinion): the in-house Listener is already more capable for this genre than any MIT or Apache option.
Borrow ideas (worklet timing, confidence, offline grid) rather than dependencies.

## Monitoring panel: what to show

A "Hearing monitor" overlay in the spirit of `PerfOverlay`, as one hotkey toggle. The rows and their sources are
below; the layout is opinion.

| Row | What | Made possible by |
|---|---|---|
| Spectrum | Log-frequency spectrum in dB, with a peak-hold line and the band edges (25 / 140 / 2000 / 12000 Hz) drawn on it. Float data, so you can see clipping. | `getFloatFrequencyData` [3]; the Listener's `spectrum` texture as a cheaper fallback |
| Band meters | `bass` / `mid` / `high` / `level` next to their running average (the AGC baseline) | `Hearing`, plus `avg` exposed |
| Onset function | A scrolling ~6 s trace of the kick-band rise, with the threshold line (`pulseRise · KICK_STRENGTH`, `KICK_MIN_RISE`) and the predicted-pulse windows shaded | KickHearer's `rises`, `due`, `period` and window (`kick-hearer.ts:14-31`) |
| Kicks versus Ticks | Two tick rows on the same timeline: detected Kicks, and Ticks as fired. The gap between them shows the phase error. | `Hearing.kick`, `Hearing.tick` |
| Tempo | BPM to 0.1, the raw (unfolded) BPM, a confidence bar (`acf/energy`), "settled" and "locked" badges, and a ×2 / ÷2 button | `hearTempo`, KickHearer `readPulse` |
| Autocorrelation | Small plot of the ACF over 40–200 BPM with the prior curve on top. This makes octave errors visible. | KickHearer `acf` |
| Tone / energy / mood | Centroid in kHz, plus the three values | `Hearing` |
| Latency | `baseLatency`, `outputLatency`, the user offset, frame time p50, and the analysis window in ms | [4][5]; `FrameProfiler` |

Design note (opinion): the Listener's rule that "nothing outside reads the analysis' state" (`listener.ts:3-4`) is
worth keeping. Add one read-only `diagnostics()` snapshot method filled only while the monitor is open, so the
normal frame pays nothing.

## Recommended path for this repo

*Recommendation.* Each stage stands alone. Every stage should be checked against the reference clips
(`npm run clips:record` and the listener-music suite) and against the strobe and edge safety rules (ADR 0002/0003)
before it ships.

1. **Hearing monitor (small).** Build the overlay above, with a read-only diagnostics snapshot. There is no change to
   behaviour, and it gives you the frequency, beat and BPM monitoring you asked for. It also makes the later stages
   measurable.
2. **Tempo controls and latency (small to medium):**
   - BPM confidence in `Hearing`.
   - Tap tempo and BPM lock, plus ×2 and ÷2 nudges.
   - An AV-offset setting that defaults to `baseLatency + outputLatency` for files and the demo.
   - Predictive Ticks: re-anchor at the estimated onset rather than the detection frame, and present at
     audible time.
   - New scene inputs as single rows in `SCENE_INPUTS`: `uBpm`, and possibly `uBar` (phase over 4 Ticks, unaligned
     until stage 4).
3. **Better spectrum and onsets (medium):**
   - Switch the analysis to `getFloatFrequencyData`, or raise `maxDecibels`, and retune the byte-step thresholds
     (`KICK_MIN_RISE`) against the clips.
   - Bucket the bands on a log scale.
   - Add snare and hat onset pulses (`uSnare`, `uHat`) from mid-band flux and HFC [10][11], after a safety review
     (the strobe rule).
4. **Timing off the frame clock (large):**
   - Compute the kick envelope and flux in an AudioWorklet, timestamped with `currentFrame` [6]. Post compact
     onset events and a decimated ODF to the Listener, which stays pure and testable.
   - For files, add an offline beat grid (Ellis DP [13], or `web-audio-beat-detector` for a seed) scheduled through
     `getOutputTimestamp` [5].
   - Downbeat or bar detection belongs here, if at all.

## Open questions

- Should the tempo range move or widen for 180+ BPM psytrance subgenres, or should the display show the folded and
  the raw value side by side (Gap 8)?
- Is bar and downbeat alignment wanted for scenes, for example a change every 4 or 16 bars? It is a separate,
  harder problem.
- How large are the real offsets on the show rig (projector processing, Bluetooth, tab capture)? Only measurement
  can tell. The browser cannot see projector lag.
- Does the monitor belong in the main window only, or also in the studio?
- Is breaking the "Listener hides its state" rule for a diagnostics snapshot acceptable, or should the monitor
  re-derive what it shows?
- Is an AGPL or GPL dependency ever acceptable, for example in a separately licensed desktop-only build? The default
  assumption here is no.

## Sources

1. W3C, *Web Audio API 1.1*, Working Draft 22 Sep 2026, §1.8 AnalyserNode (attributes, defaults):
   https://www.w3.org/TR/webaudio-1.1/#AnalyserNode
2. Same, §1.8.6 FFT windowing and smoothing over time:
   https://www.w3.org/TR/webaudio-1.1/#fft-windowing-and-smoothing-over-time
3. Same, §1.8.3 methods (`getByteFrequencyData`, `getFloatFrequencyData`, time-domain):
   https://www.w3.org/TR/webaudio-1.1/#dom-analysernode-getbytefrequencydata
4. Same, §1.2.2 `baseLatency` / `outputLatency`: https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-baselatency ·
   https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-outputlatency
5. Same, §1.2.3 `getOutputTimestamp()`: https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp
6. Same, render quantum size and AudioWorklet (`AudioWorkletProcessor`, `process()`, `currentFrame`):
   https://www.w3.org/TR/webaudio-1.1/#render-quantum-size ·
   https://www.w3.org/TR/webaudio-1.1/#AudioWorkletProcessor ·
   https://www.w3.org/TR/webaudio-1.1/#dom-audioworkletglobalscope-currentframe
7. Same, `latencyHint`: https://www.w3.org/TR/webaudio-1.1/#dom-audiocontextoptions-latencyhint
8. Same, "The ScriptProcessorNode Interface - DEPRECATED": https://www.w3.org/TR/webaudio-1.1/#ScriptProcessorNode
9. MDN browser-compat-data, `api/AudioContext.json`:
   https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json
10. J. P. Bello, L. Daudet, S. Abdallah, C. Duxbury, M. Davies, M. Sandler, "A Tutorial on Onset Detection in Music
    Signals", IEEE Trans. Speech and Audio Processing 13(5):1035–1047, 2005. https://doi.org/10.1109/TSA.2005.851998
    (text read from https://www.cs.bu.edu/fac/snyder/cs583/Literature%20and%20Resources/bello_onset_tutorial.pdf)
11. S. Dixon, "Onset Detection Revisited", Proc. DAFx-06, Montreal, 2006.
    https://www.dafx.de/paper-archive/2006/papers/p_133.pdf
12. E. D. Scheirer, "Tempo and beat analysis of acoustic musical signals", J. Acoust. Soc. Am. 103(1):588–601, 1998.
    https://doi.org/10.1121/1.421129 (abstract only was read)
13. D. P. W. Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research, 2007 (vol. 36(1) pp. 51–60:
    unverified). https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf
14. G. Percival, G. Tzanetakis, "Streamlined tempo estimation based on autocorrelation and cross-correlation with
    pulses", IEEE/ACM TASLP 22(12):1765–1776, 2014 (as cited by [21]; not read).
15. aubio, `src/tempo/tempo.h` (API, GPL-3.0-or-later): https://github.com/aubio/aubio/blob/master/src/tempo/tempo.h
16. aubio, `src/tempo/beattracking.h` (cites Davies & Plumbley, "Causal tempo tracking of audio", ISMIR 2004; Davies,
    Brossier, Plumbley, AES 118th Conv. 2005): https://github.com/aubio/aubio/blob/master/src/tempo/beattracking.h
17. A. Stark, BTrack README (causal real-time beat tracker; Stark, Davies, Plumbley, DAFx-09; GPL-3.0):
    https://github.com/adamstark/BTrack
18. Meyda 5.6.3, npm package source (`dist/esm/extractors/spectralFlux.js`, `createScriptProcessor` use; MIT):
    https://github.com/meyda/meyda · https://www.npmjs.com/package/meyda
19. realtime-bpm-analyzer 5.0.16, README and `dist/core/*.d.ts` (AudioWorklet, low-pass 150/200 Hz, 90–180 BPM, 20 s
    stabilisation, Apache-2.0): https://github.com/dlepaux/realtime-bpm-analyzer
20. Essentia reference, `RhythmExtractor2013` and `BeatTrackerMultiFeature` (44.1 kHz requirement, confidence 0–5.32,
    Zapata, Davies, Gómez 2014): https://essentia.upf.edu/reference/std_RhythmExtractor2013.html ·
    https://essentia.upf.edu/reference/std_BeatTrackerMultiFeature.html
21. Essentia reference, `PercivalBpmEstimator`: https://essentia.upf.edu/reference/std_PercivalBpmEstimator.html;
    essentia.js 0.1.3 npm package (AGPL-3.0, `essentia-wasm.web.wasm` 1,987,689 bytes):
    https://github.com/MTG/essentia.js
22. web-audio-beat-detector 8.2.39 README (offline `AudioBuffer`, `analyze` / `guess`, 90–180 default; MIT per npm):
    https://github.com/chrisguttandin/web-audio-beat-detector

**Unverified in this pass:**

- The psytrance tempo norms (138–150, hi-tech or darkpsy 180+).
- Ellis 2007's volume and pages.
- The real magnitudes of output, Bluetooth, capture and projector latency.
- Whether Essentia's whole-signal rhythm algorithms suit a sliding real-time window.
- Whether aubiojs's MIT label survives its GPL dependency (a legal question).
- realtime-bpm-analyzer internals beyond its published types and README.

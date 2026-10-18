# Implementation plan: close the AI assistant's tool gaps

**Status:** Phases 1–2 done in PR #83 (branch `assistant-context`); Phases 3–5 wait on the open questions
**Source:** [docs/research/assistant-tool-gaps.md](docs/research/assistant-tool-gaps.md) (gap ids G1–G24 below refer to it)
**Branch:** a new branch per phase, cut from `main` (not `footer-player`)

---

## Context & Goal

The assistant reads, edits and creates scenes, sets parameters and the Look, and runs the studio show. Five gaps make
it act on the wrong thing or report the wrong thing:

1. Auto-switch moves the scene on screen while every scene tool defaults to "the scene on screen" (G1, G2).
2. Plan steps are cut at `maxSeconds` (90 s by default) while the prompt promises "a few minutes" (prompt `:45`).
3. It can't see or set effects (G3, G4).
4. `look_at_scene` shows the bare scene with ticks frozen, not the picture the audience sees (G5–G7).
5. Nothing tells it, or checks, the laser-set safety rules (G11, prompt `:6`).

**Goal:** fix these in five small PRs, ordered so each one is useful by itself. Phases 1–4 are S-sized. Phase 5 is M.
G15–G24 (playback, yt-dlp, rename, cost measurement, reference images, settings) are **out of scope** for this
plan.

---

## Proposed Changes

### Phase 1: Prompt-only fixes ([server/system-prompt.ts](server/system-prompt.ts))

No code changes outside the prompt. This phase fixes what the model believes today.

| Line | Change |
|---|---|
| `:6` | Replace "psychedelic" with the laser-set art direction: thin, fully saturated lines on pure black (ADR 0001). |
| `:15` | Add effects to how a frame is built: scene → effects → Look/trails/grading. |
| new section after `:34` | **Safety**: in silence the edges stay mostly black; a kick or a tick must not brighten much of the frame at once (the strobe rule from `e2e/builtin-scenes.spec.ts:90-126`, stated in words, not as numbers). Keep `set_look` inside the Randomize ranges (`src/state/look-drift.ts:10-18`), e.g. Fringing ≤ 0.006, Trails ≤ 0.6, unless the user asks for more. |
| `:39-40` | Use the glossary words: "tick", not "beat"; "tone", not "timbre" (`GLOSSARY.md`). |
| `:44` | A show scene also holds effects. Until Phase 3 lands, say that the assistant can't set effects, so it doesn't fake a mirror in GLSL. |
| `:45` | State that each step also has `maxSeconds` (default 90). Set it to at least beats × 60 / BPM. Phase 2 makes this automatic, after which this line is shortened. |
| `:50` | Auto-switch can change the scene between replies. Pass `scene` explicitly when acting on a scene from earlier. |
| new bullet | While Live is pinned, `set_look`, `switch_scene` and `set_parameters` change the main screen, not Live. Use `update_show_scene` to change Live (G13). |
| `:58` | FOLLOW-UPS on every reply **except** director cycles (`src/director/digest.ts:35` already says "tool calls only"). |

The prompt must stay one constant string (the caching structure the note confirms). A test asserts it has no
`${…}` besides `COMMON`.

### Phase 2: Context the model is missing (read-only; [src/assistant/executor.ts](src/assistant/executor.ts), [src/assistant/tools.ts](src/assistant/tools.ts))

1. **`get_app_state`** (`executor.ts:256-266`) adds:
   - `look.auto`, `look.drift`, `look.driftSpeed`, `look.randomScene` (G1, G2)
   - `effects`: the main screen's stack (`app.state.effects`), as `[{id, on, settings}]` (G3)
   - `playing.description` (G9)
   - `screen`: `'preview' | 'live'` when Live is pinned (`live-slot.ts:93-114`) (G13)
   - `listening`: `{ playing, energy, bass, mid, high }`, rounded to 2 decimals, read from `app.hearing`
     (`listener.ts:33-48`). This is a separate field so `soundNow`, which the director shares, stays the same (G8).
2. **`get_show`** `cueView` (`executor.ts:155-158`) adds `effects: c.effects` (G4, read half).
3. **`find_scenes {query?, category?}`**, a new read-only tool. It returns `[{name, category, kind, description}]`
   and matches the way the library search does (`Library.tsx:43`, `:159`). `get_app_state` keeps the names-only
   list so it stays cheap (G9).
4. **`get_help {topic?}`**, a new read-only tool. Without a topic it returns the topic ids and titles. With one, it
   returns the body plus `shortcutRows(topic.hotkeys)` (`src/help/topics.ts:16-205`) (G10).
5. **Plan ceilings.** In `set_autopilot_plan` (`executor.ts:415-433`), when the BPM is known, raise each step's
   `maxSeconds` to `ceil(beats × 60 / bpm × 1.25)` (capped at 600), and return a `note` when it raised any.
   The stored `PlanSchema` stays as it is. Prompt line `:45` is then shortened.
6. **Scene-changed note.** When the scene on screen differs from the one at the conversation's last reply, prefix
   the next user message with `(The scene on screen changed since your last reply: now "X".)`. This reuses the
   `Screen` and `notes.ts` mechanism that the reopen note uses (`notes.ts:12-27`). `NOTE_LINE` and `describeNote`
   learn the new prefix (G1).

### Phase 3: Write tools for the Look and effects

1. **`set_look`** accepts `auto`, `drift`, `randomScene` (booleans, through `app.setLookFlag`,
   `controller.ts:602-606`) and `driftSpeed`. Each has its own undo through the existing `look` touched pair,
   extended to flags. `AppPort` (`src/app/app-port.ts:15-19`) gains `setLookFlag`, and `fake-app.ts` gets the same
   (G2).
2. **Pause auto-switch while a chat runs.** `autoSwitching()` (`controller.ts:499-501`) also checks
   `!this.ui.get().assistantBusy`. That flag already exists and the director already waits on it
   (`director.ts:128`) (G1).
3. **`set_effects {effects: [{id, on?, settings?}] | null}`**, one tool that takes the whole stack (Anthropic's
   "consolidate related operations" guidance). It passes the stack through `cleanStack` (`effects.ts:218`), so
   settings are clamped to the catalogue's ranges, which the safety spec checks at their tops. It writes through a
   new `AppController.setEffectStack(stack)` that wraps the private `setEffects` (`controller.ts:618-623`). Undo
   uses the same read/write pair pattern. `AppPort` gains `setEffectStack` and `state.effects` (G3).
4. **Effects on show scenes**: `add_show_scene` and `update_show_scene` take an optional `effects` with the same
   shape, cleaned the same way, plus `add_show_scene {from: "screen"}`, which uses `studio.capture()` like the UI's
   add (`studio.ts:227-240`) (G4). **This reverses an ADR 0003 consequence** (see Open questions). If you approve
   it, it comes with a short ADR 0004 or an amendment to 0003.
5. Prompt: describe `set_effects` and remove the Phase 1 "can't set effects" caveat.

### Phase 4: Make `look_at_scene` show the real picture ([executor.ts:245-253](src/assistant/executor.ts#L245-L253))

1. New input `{as?: 'scene' | 'screen' | cue id}`, default `'screen'`:
   - `'scene'`: today's bare render (`renderer.snapshotAsync`).
   - `'screen'`: `composeStill(i, …, app.state.look, s.trails ?? 1, spectrum, undefined, app.state.effects)` plus
     `renderer.stillAsync`, the same path the profiler's `still` uses (`controller.ts:124-134`).
   - a show scene: the same, with that show scene's look and effects.
   `AppPort.renderer` gains `stillAsync` (G5).
2. Step the tick inputs with `times`: `uTick = fract(t × bpm / 60)` and `uTicks = floor(t × bpm / 60)`, with
   bpm = the heard BPM or 120 (G6).
3. `audio?: 'stand-in' | 'live'`. `'live'` passes the listener's current `spectrum` and `hearing` bands instead of
   `stillSpectrum()` and the stand-in values (G7).
4. Number each image in the result text ("Image 1: t = 14 s …"), as the Vision docs suggest, and correct the
   "also gets afterglow and grading" sentence to match the `as` that was used.

### Phase 5: `check_scene` (safety verdict) (M)

1. Move the in-page verdict that `e2e/builtin-scenes.spec.ts:70-113` runs over `__profiler.still` and `stillChange`
   into `src/engine/safety-check.ts` as a pure function over ImageData pairs. The e2e spec then imports it, so there
   is one implementation.
2. New tool `check_scene {scene?, as?}`. It renders silence plus kick and tick pairs at `STRONGEST_LOOK` with the
   given effects, and returns `{ pass, edgeBlack, kickDoubled, tickDoubled, advice }`.
3. `create_scene`, `write_scene_code` and `edit_scene_code` run it after a successful compile and attach the verdict
   to their result **as a report, never a block** (see Open questions).
4. Prompt: "If check_scene fails, fix it before you reply."

---

## Verification Plan

Per phase, before the PR:

- `npm run lint`, `npm run typecheck` and `npm test` (vitest). Phases 2–5 extend `src/assistant/executor.test.ts` against
  `fakeApp`:
  - P2: `get_app_state` carries `auto`, `effects` and `listening`; `find_scenes` matches by description;
    `get_help` with an unknown id gives an error that lists the ids; a 256-beat step at 128 BPM gets
    `maxSeconds ≥ 150`; the scene-changed note is added and is parsed back out by `splitNotes`.
  - P3: `set_look {auto:false}` undoes back to `true`; an out-of-range effect setting is clamped by `set_effects`;
    undo conflicts work the same way they do for `set_look`; `autoSwitching()` returns false while
    `assistantBusy` is set (controller test or a fake-clock test).
  - P4: `as:'screen'` calls `stillAsync` with the screen's look and effects; `times:[0, 0.25]` at 120 BPM gives
    `uTick` 0 and 0.5.
  - P5: the moved verdict gives the same pass or fail on the built-ins as before (the e2e spec stays green).
- `npm run test:e2e`: `e2e/builtin-scenes.spec.ts` and the assistant specs.
- Manual check with the `run` skill: ask the assistant "make it brighter" with auto-switch on and confirm it acts on
  the named scene. Ask it to "add a mirror" and confirm the Effects widget updates and Undo reverts it. Ask it for a
  256-beat plan at a known BPM and confirm the step isn't cut at 90 s.
- Update `docs/assistant.md` (the tool count and list), `CHANGELOG.md` and `src/help/topics.ts` (the assistant topic)
  in each PR that adds tools.

---

## Open questions (need your decision before Phase 3 and Phase 5)

1. **Effects on show scenes (Phase 3.4):** this reverses ADR 0003's consequence that "the assistant writes show
   scenes without them". Allow it (recommended: the safety spec already checks every effect at its strongest) or
   main screen only?
2. **Auto-switch while chatting (Phase 3.2):** pause only while a run is in flight (recommended), or turn it off
   for as long as the panel is open?
3. **`set_look` beyond the Randomize ranges:** warn in the result when a value is past them (recommended; your own
   sliders go further), or clamp?
4. **`check_scene`:** report only (recommended; your own scenes aren't checked today) or refuse to save a failing
   scene?

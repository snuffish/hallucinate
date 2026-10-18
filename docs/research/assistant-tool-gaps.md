# Research: what the AI assistant can't do yet

Status: research only. No code has changed. Written 2026-10-18.

Question: does the built-in AI assistant lack useful tools or other features? This note compares what the assistant can
do (its system prompt and its 18 tools) with what the app lets the user do by hand.

Every claim about the code has a `file:line`. Every claim about the model and the API links to Anthropic's own docs
(`docs.claude.com` now redirects with a 302 to `platform.claude.com/docs`, so the links below point there) or to the
SDK source in `node_modules`.

---

## Summary

The assistant is strong at its core job: it reads, edits and creates scenes, sets parameters and the Look, and runs the
studio show, and nearly every change can be undone. But five things limit it. It **can't see or touch effects**, which
came after the tools were written. It **can't stop auto-switch**, which by default moves the screen away from the
scene it is working on. Its **screenshots don't show what the audience sees**. It **knows almost nothing about the
music beyond BPM and two mood words**. And it has **no way to check its scenes against the app's safety rules**. The
prompt also has a few stale or missing statements. The worst one makes the plans it writes play shorter than it
intends.

### Top 5, by priority

1. **The scene can change under the assistant (Confirmed gap).** Auto-switch is on by default (`src/state/app-state.ts:39`)
   and moves to another scene after 32 kicks or 45 s (`src/app/controller.ts:789`, `:925`). It pauses only for the code
   editor, the autopilot and non-visual scenes (`src/app/controller.ts:499-501`), not while the assistant works.
   Meanwhile every scene tool defaults to "the scene on screen" (`src/assistant/tools.ts:9`,
   `src/assistant/executor.ts:141`), and `set_parameters` can *only* act on the scene on screen
   (`src/assistant/executor.ts:302`). So a follow-up such as "make it brighter" can edit whatever scene auto-switch
   moved to. `get_app_state` doesn't report the auto-switch flag (`src/assistant/executor.ts:260`), and no tool can turn
   it off (`src/assistant/tools.ts:39`). **Value: high. Cost: S.** Report `auto` and `drift` in `get_app_state`, let
   `set_look` set them, and either pause auto-switch while a conversation is running or have the scene tools return
   (and the prompt require) the scene's name.
2. **Plans play shorter than the prompt says (Confirmed gap).** The prompt says "128-256 beats is a few minutes"
   (`server/system-prompt.ts:45`). Every plan step has a `maxSeconds` wall-clock ceiling that defaults to 90 s
   (`src/state/show-plan.ts:9`, `:17`), and the studio moves on when that ceiling passes even while the beats keep
   coming (`src/app/studio.ts:473`). At 128 BPM a 256-beat step is 120 s, so it is cut at 90 s. Neither the prompt nor
   the tool description connects the two. **Value: high. Cost: S** (a prompt line, or set the default from the beats
   and the BPM).
3. **Effects are invisible to the assistant (Confirmed gap).** The user can add, remove, reorder, switch and set
   Mirror, Kaleidoscope, Glow and Wave (`src/engine/effects.ts:69-180`, `src/app/controller.ts:610-614`). The assistant
   can't read them: `get_app_state` and `get_show` leave them out (`src/assistant/executor.ts:256-266`, `:155-158`). It
   can't set them either, and the show scenes it adds get none (`src/app/studio.ts:242-244`). The UI's "add show
   scene" captures the screen's effects (`src/app/studio.ts:227-240`). The prompt never mentions effects. **Value:
   high. Cost: S-M.** The controller methods already exist.
4. **`look_at_scene` doesn't show what the audience sees (Confirmed gap).** It renders the bare scene through a
   neutral display pass, with no Look, no effects, no afterglow and no fringing (`src/assistant/executor.ts:249`,
   `src/engine/renderer.ts:452-475`). Its `times` move only `uTime`, so motion driven by ticks never shows
   (`src/assistant/executor.ts:248`, `src/engine/scene-inputs.ts:21-22`). That is exactly the motion the prompt tells
   the model to use (`server/system-prompt.ts:39`). The app already has a full-pipeline still renderer (`composeStill`
   plus `stillAsync`, used by the profiler API at `src/app/controller.ts:124-141`) and a live spectrum
   (`src/engine/listener.ts:55`). **Value: high. Cost: S.**
5. **No safety check, and no art direction, for what the assistant makes (Confirmed gap and Suggestion).** The
   built-in scenes have to pass a strobe rule and an edge rule (edges ≥ 75% black in silence, a kick or a tick doubles
   < 25% of the frame: `e2e/builtin-scenes.spec.ts:90-126`, `docs/scenes.md:6-11`), with the Look only up to the
   Randomize/Drift ranges (`src/state/look-drift.ts:10-25`, ADR 0002). The prompt states none of this. It calls the
   scenes "psychedelic" (`server/system-prompt.ts:6`), but the built-in set is now a laser show (ADR 0001). `set_look`
   also accepts the full slider ranges, for example Fringing up to 0.04 against a checked maximum of 0.006
   (`src/state/app-state.ts:26-35`). The e2e verdict runs in the page through the profiler API
   (`e2e/builtin-scenes.spec.ts:90-113`), so a `check_scene` tool could reuse it. **Value: high (photosensitivity).
   Cost: M.**

Next in line: cheap read-only context. That means scene descriptions, which the library shows and searches but the
assistant never gets (`src/scenes/scene.ts:12`, `src/components/Library.tsx:43`, `:159`), a help lookup over
`HELP_TOPICS` (`src/help/topics.ts:16-178`), and the live audio analysis (`src/engine/listener.ts:33-48`).

---

## 1. How the assistant is wired

- **One declaration per tool** (schema, description, panel labels, director flag) in `src/assistant/tools.ts:41-221`.
  The server hands the definitions to the model (`server/assistant.ts:17`, `:32`). The browser runs them
  (`src/assistant/executor.ts:255-443`), because only the page has the renderer, the editors and the library
  (`server/assistant.ts:2-4`).
- **API key backend:** TanStack client tools, generated one per definition (`src/assistant/client-tools.ts:11-14`).
  **Subscription backend:** the Claude Code CLI runs with no built-in tools (`--tools ''`) and gets only these tools
  from a small MCP server (`server/claude-cli-adapter.ts:49-62`, `server/cli-bridge.ts:161-162`). The CLI relays each
  call to the browser (`server/cli-bridge.ts:74-85`).
- **Two run modes:** `chat` gets all 18 tools and up to 30 turns. `director` gets three tools and 6 turns
  (`server/assistant.ts:29-38`, `src/assistant/tools.ts:229`). Both use the same system prompt
  (`server/assistant.ts:82`).
- **Undo:** every change records one undo step. The undo refuses when something else changed the target since
  (`src/assistant/executor.ts:170-189`). `switch_scene` and `take_show_scene` record none.
- Inputs are parsed with the tool's own zod schema before they run (`src/assistant/executor.ts:445-456`).
  `docs/assistant.md:59` says "nine for scenes, nine for the studio", which is correct.

## 2. Tool inventory

| # | Tool | Input schema | What it does | Undo | Director | Source |
|---|---|---|---|---|---|---|
| 1 | `get_app_state` | `{}` | Playing scene (name, kind, category, edited, params with ranges and values), Look numbers incl. synesthesia, `{source, bpm, mood, tone}`, media name/kind, editor open, every scene name by category with marks | – | – | `tools.ts:42-49`, `executor.ts:256-266` |
| 2 | `read_scene_code` | `{scene?}` | The scene's body, with a note for visual-maker (read-only) and built-in scenes | – | – | `tools.ts:50-57`, `executor.ts:268-274` |
| 3 | `write_scene_code` | `{scene?, code}` | Replaces the whole body, compiles, saves. On error the old version keeps running and the errors come back | yes | – | `tools.ts:58-68`, `executor.ts:235-243`, `:276-278` |
| 4 | `edit_scene_code` | `{scene?, edits: [{find, replace}] (≥1)}` | Exact, unique replacements, applied in order, then compile like #3. A miss reports where it nearly matched | yes | – | `tools.ts:69-82`, `executor.ts:101-121`, `:280-285` |
| 5 | `create_scene` | `{name, code}` | New scene in "Mine", then plays it. Fails on a name clash or a compile error | yes (removes it) | – | `tools.ts:83-93`, `executor.ts:287-299` |
| 6 | `set_parameters` | `{values: {name\|label\|"Group/Label": value}}` | Sets `@param` values **of the scene on screen only**. Ambiguous labels are an error | yes | – | `tools.ts:94-101`, `executor.ts:53-84`, `:301-310` |
| 7 | `set_look` | `{hue?, cycle?, trails?, speed?, reactivity?, aberration?, synesthesia?}` (numbers) | Main screen's Look sliders, clamped to the full slider ranges | yes | – | `tools.ts:39`, `:102-109`, `executor.ts:312-317`, `controller.ts:595-600` |
| 8 | `switch_scene` | `{scene}` | Crossfades the main screen to a scene | **no** | – | `tools.ts:110-117`, `executor.ts:319-324` |
| 9 | `look_at_scene` | `{scene?, times?: number[] (1-3, default [14])}` | 512×288 JPEG stills of the bare scene with stand-in audio | – | – | `tools.ts:118-128`, `executor.ts:245-253`, `:326-337` |
| 10 | `get_show` | `{}` | Show scenes (id, name, scene, category, missing, hue, values, look), Preview/Live, transition, autopilot, plan, studio open, Live pinned, user touched | – | ✓ | `tools.ts:130-138`, `executor.ts:155-169` |
| 11 | `add_show_scene` | `{scene, name?, values?, look?}` | Adds a show scene (no effects), which becomes the Preview | yes | – | `tools.ts:139-151`, `executor.ts:343-352` |
| 12 | `update_show_scene` | `{cue, name?, scene?, values?, look?}` | Merges a change into a show scene. Live shows it at its next take | yes | ✓ | `tools.ts:152-166`, `executor.ts:354-377` |
| 13 | `reorder_show` | `{order: id[] (all, once)}` | New list order | yes | – | `tools.ts:167-174`, `executor.ts:379-384`, `studio.ts:262-267` |
| 14 | `remove_show_scene` | `{cue}` | Removes a show scene (the library scene stays) | yes | – | `tools.ts:175-182`, `executor.ts:386-391` |
| 15 | `set_transition` | `{mode?: cut\|fade, seconds?: 0.2-8}` | How takes transition | yes | – | `tools.ts:183-190`, `executor.ts:393-400` |
| 16 | `set_autopilot` | `{on?, unit?: beats\|seconds, beats?: 16\|32\|64\|128, seconds?: 5-600}` | Autopilot on/off and its clock | yes | – | `tools.ts:191-203`, `executor.ts:402-413` |
| 17 | `set_autopilot_plan` | `{plan: {steps[1-64]: {cue, beats 8-512, mode?, seconds?, maxSeconds 15-600 = 90}, note ≤160, loop = true} \| null}` | Replaces the plan and turns the autopilot on | yes | ✓ | `tools.ts:204-212`, `show-plan.ts:12-23`, `executor.ts:415-433` |
| 18 | `take_show_scene` | `{cue?}` | Takes a show scene (or the Preview) live now | **no** | – | `tools.ts:213-220`, `executor.ts:435-442` |

(Paths without a folder: `src/assistant/`, `src/app/`, `src/state/`.)

## 3. What the app lets the user do, and whether the assistant can

| Area | User can | Where | Assistant |
|---|---|---|---|
| Scenes | play (keys 1-0, ←/→, library), edit code, save to library, delete own, revert built-in, ★ favourite, take out of rotation, search by name/category/description | `controller.ts:453-461`, `Library.tsx:43`, `:120-170`, `Editor.tsx:99-103`, `scene-library.ts:149-156` | play, read, edit, create. **No** delete, revert, favourite, rotation, descriptions |
| Parameters | set, reset one/all; in the studio the panel edits the **Preview** show scene | `controller.ts:569-592`, `studio.ts:498-512` | set on the scene on screen only |
| Look | 7 sliders, Randomize (R) / back (Shift+R), Drift + drift speed, auto-switch (A), "also random scene" | `controller.ts:595-648`, `app-state.ts:11-40` | 7 sliders. **No** auto/drift/drift speed/randomize |
| Effects | add, remove, reorder, on/off, settings (4 effects) | `effects.ts:69-180`, `controller.ts:610-614` | **none** |
| Media | drop or pick image/video, YouTube via yt-dlp, clear, "use the video's sound" | `controller.ts:699-758` | sees name and kind only |
| Sound sources | file, mic, tab/system audio, SoundCloud (yt-dlp), demo beat | `controller.ts:655-687`, `music-source.ts:60-94` | sees source, BPM, mood, tone |
| Player bar | play/pause, stop, seek, ±10 s, loop, volume, mute, tempo ±5% / pitch follows | `transport.ts:51-110`, `hotkeys/registry.ts:36-43` | **none** |
| Studio | add (from screen, with effects), Preview, Take, move, rename, update-from-Live, duplicate, remove, transition, autopilot, plan undo, **Director on/off and interval**, Parameters Preview/Live tab, screens/projector, **master fader, Blackout** | `Studio.tsx:92-231`, `studio.ts:235-458`, `:516-535` | add/update/reorder/remove/take, transition, autopilot, plan. **No** master/blackout, Preview select, duplicate, director, projector |
| Screen mode | Preview or Live while Live is pinned | `live-slot.ts:93-114` | not reported in `get_app_state` (only `livePinned` in `get_show`) |
| Help | 12 topics + shortcut sheet | `help/topics.ts:16-178`, `hotkeys/registry.ts:35-86` | **none** (prompt promises "explain how things work") |
| Settings, export/import, record (C), fullscreen (F), perf monitor (Shift+P), GPU test | | `controller.ts:796-874`, `:422` | none (most need a user gesture or are per-device; low value) |
| Visual maker | wire blocks, examples, "send to code" | `docs/visual-maker.md` | read-only (`executor.ts:232`) |
| DMX / laser output | not in the app (see `docs/research/dmx-output.md`) | – | n/a |

## 4. Gap table

Status: **Confirmed gap** means the cited code shows it. **Suggestion** means a feature that would help but that no
current code promises. Cost: **S** < ½ day, **M** 1-2 days, **L** more.

| # | Gap | Status | Evidence | Value | Cost |
|---|---|---|---|---|---|
| G1 | Auto-switch can move the scene the tools default to. The flag is hidden and can't be set | Confirmed gap | `app-state.ts:39`, `controller.ts:499-501`, `:789`, `:925`, `executor.ts:141`, `:260`, `:302` | high | S |
| G2 | No control of auto-switch, Drift, drift speed, Randomize, "also random scene" (`set_look` drops `driftSpeed` and every flag) | Confirmed gap | `tools.ts:39`, `app-state.ts:24`, `controller.ts:602-648` | med | S |
| G3 | Main-screen effects: can't read or set them | Confirmed gap | `executor.ts:256-266`, `controller.ts:610-614` | high | S-M |
| G4 | Show scene effects: not in `get_show`, can't be set, assistant-added show scenes get none (unlike the UI's add) | Confirmed gap (ADR 0003 lists "the assistant writes show scenes without them" as a consequence, so revisiting it is a decision) | `executor.ts:155-158`, `studio.ts:227-244`, `docs/adr/0003-effects-belong-to-the-show-scene.md:28` | high | S-M |
| G5 | `look_at_scene` skips the Look, effects, afterglow and fringing | Confirmed gap | `executor.ts:249`, `renderer.ts:452-475` (neutral display uniforms), vs `controller.ts:124-134` (`composeStill` + `stillAsync`) | high | S |
| G6 | `look_at_scene` `times` vary only `uTime`. `uTick` stays 0.3 and `uTicks` 6, `uBeat` 0.4 | Confirmed gap | `executor.ts:248`, `scene-inputs.ts:14-25` | high | S |
| G7 | `look_at_scene` can't use the real music (the live spectrum and Hearing) | Confirmed gap | `renderer.ts:489-493` (`spectrum` argument exists), `listener.ts:55` | med | S |
| G8 | Live audio: only BPM and two words. No bands, energy, kick rate, "playing", track name | Confirmed gap | `listener.ts:33-48` vs `:210-217`, `executor.ts:261` | high | S |
| G9 | Scene descriptions not given (the library shows and searches them) | Confirmed gap | `scene.ts:12`, `executor.ts:128-136`, `Library.tsx:43`, `:159` | high | S |
| G10 | Help: the prompt promises to "explain how things work" but has no help content or tool | Confirmed gap | `server/system-prompt.ts:6`, `help/topics.ts:16-178`, `topics.ts` `shortcutRows` | high | S |
| G11 | Safety check for assistant-made scenes, Look values and effect stacks | Suggestion | `e2e/builtin-scenes.spec.ts:90-126` (in-page verdict over `__profiler.still/stillChange`), `controller.ts:119-141` | high | M |
| G12 | `set_parameters` ignores the studio's Parameters tab, which edits the Preview show scene | Confirmed gap | `executor.ts:301-310`, `studio.ts:498-512`, `controller.ts:569-585` | med | S |
| G13 | While Live is pinned, `set_look` / `switch_scene` / `set_parameters` change the main screen, not Live. The prompt is silent | Confirmed gap | `live-slot.ts:1-11`, `:106-114`, `executor.ts:167` | med | S (prompt + a field) |
| G14 | Studio: no master fader/Blackout, Preview select, duplicate, update-from-Live, Director on/off and interval | Confirmed gap | `studio.ts:282-296`, `:332`, `:439-458`, `Studio.tsx:120-231`, `director.ts:19-20` | med | S-M |
| G15 | Playback: play/pause, seek, loop, volume, tempo; start the demo beat or the mic | Suggestion | `transport.ts:51-110`, `controller.ts:655-687`. Tab audio needs a user gesture: `getDisplayMedia` without transient activation throws `InvalidStateError` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)) | med | M |
| G16 | Search and play SoundCloud, or pick a YouTube video as media, through the local yt-dlp routes | Suggestion | `server/ytdlp-bridge.ts:253-260`, `server/routes.ts:27` | med | M |
| G17 | Media: can't see the dropped picture (a `look_at_media`) or clear it | Suggestion | `executor.ts:262`, `controller.ts:708-740` | med | S |
| G18 | Scene library management: delete own scene, revert a built-in, favourite, rotation | Confirmed gap | `Library.tsx:120-170`, `Editor.tsx:99-103`, `scene-library.ts:149-156` | low-med | S |
| G19 | Rename a scene | Suggestion (the app has no rename either, only load-time clash renames: `state/scene-renames.ts:17-29`) | – | low | M |
| G20 | Measure a scene's cost (fps, ms per frame) against "Keep it fast" | Suggestion | `server/system-prompt.ts:34`, `controller.ts:119-155`, `:868-874` | med | M |
| G21 | The user can't attach a reference image. The panel is text-only, and the CLI adapter is text-only and forwards only the latest user text | Suggestion | `components/Assistant.tsx:355`, `server/claude-cli-adapter.ts:90-99`, `:106` | med | M |
| G22 | Assistant-side undo (revert its own last change on request) | Suggestion (the user has Undo: `docs/assistant.md:17-18`) | `assistant/undo.ts` | low | S |
| G23 | Visual maker graphs: read-only, no graph tools | Confirmed gap (by design) | `executor.ts:232` | low | L |
| G24 | Settings, export/import, recording, fullscreen, projector windows | Suggestion, mostly out of scope (per-device settings, downloads or user gestures) | `controller.ts:422`, `:796-874`, `studio.ts:516-535` | low | – |

Tool design note for new tools: Anthropic's guidance is to "consolidate related operations into fewer tools", for
example with an `action` parameter, and to "provide extremely detailed descriptions"
([Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), "Best practices for
tool definitions"). So effects fit best as one `set_effects` that takes the whole stack, and playback as one
`playback {action}`, rather than six small tools each.

## 5. The system prompt (`server/system-prompt.ts`)

### Stale or incorrect

| Line | Says | Code says | Fix |
|---|---|---|---|
| `:45` | "128-256 beats is a few minutes" | Each step is cut at `maxSeconds` (default 90 s) while the music plays (`show-plan.ts:9`, `:17`, `studio.ts:473`). At 128 BPM, 128 beats is 60 s and 256 beats is 120 s, which is cut to 90 | Say so, and to set `maxSeconds` ≥ beats × 60 / BPM |
| `:44` | a show scene is "a library scene plus stored parameter values and look sliders" | It also holds effects (`studio.ts:23-31`, `:227-233`, ADR 0003) | Mention effects (and G4) |
| `:15` | "the display tonemaps, adds the trails' afterglow and colour grading afterwards" | The effects run between the scene and the trails (`renderer.ts:1-9`) | Add effects |
| `:6` | "renders psychedelic … shader scenes" | The built-in set is a laser show: thin lines on pure black, strobe-safe (ADR 0001, `docs/scenes.md:6-11`) | Give the laser-set art direction |
| `:52` | `look_at_scene` "renders with stand-in audio" | True. Its own result text says only afterglow and grading are missing (`executor.ts:334`), but the Look, effects and fringing are missing too (G5) | Fix the text, or the tool |
| `:58-60` | FOLLOW-UPS line on "every reply" | Director cycles ask for "tool calls only" (`director/digest.ts:35`), and their text is thrown away | Exempt director cycles |
| `:39-40` | "each beat of the tempo", "bright timbre" | The glossary calls these **ticks** and **tone**, and lists "beat" and "timbre" as words to avoid (`GLOSSARY.md:30-33`, `:39-42`) | Use the glossary words |

### Missing guidance

- **Safety and art direction:** the edge rule and the strobe rule (`e2e/builtin-scenes.spec.ts:120-122`), pure black
  backgrounds, and keeping `set_look` inside the ranges that Randomize and Drift stay in (`look-drift.ts:10-25`; for
  example Fringing ≤ 0.006, Trails ≤ 0.6).
- **Auto-switch** (G1): say that it can move the screen, and name the scene in every tool call.
- **Live pinned and the studio's Parameters tab** (G12, G13): which tools change Live and which change only the main
  screen.
- **Effects:** what they are and that they belong to the show scene, or at least that the assistant can't change
  them, so it says so instead of rewriting a scene to fake a mirror.
- **Tool names never mentioned:** `set_look`, `switch_scene` and `read_scene_code` appear only in their own
  descriptions (`grep` of `server/system-prompt.ts`). That works, but "the global look" (`:6`) is the only pointer to
  `set_look`.

### Prompt caching (API backend)

- **The structure follows the docs.** The cache prefix runs "`tools`, `system`, then `messages`"
  ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), "How prompt caching
  works"). The tool list is fixed per mode (`server/assistant.ts:32`). The system prompt is one constant string
  (`server/system-prompt.ts:6`), sent as the single system block (`server/assistant.ts:82`). Per-message notes ride in
  the user message, not the system prompt (`src/assistant/notes.ts:1-5`), so the system prompt stays byte-identical.
- **Markers:** `promptCache: 'short'` (`server/assistant.ts:36`) makes TanStack's adapter mark the last tool, the last
  block of the last user message (which includes `tool_result` blocks) and then the system block, at most 4 markers
  (`node_modules/@tanstack/ai-anthropic/dist/esm/prompt-cache.js:85-107`, v0.22.0). That stays within "up to 4 cache
  breakpoints". Because the message marker moves forward each step, it stays within the 20-block lookback (same doc,
  "How automatic prefix checking works").
- **Length:** the prompt is about 11 KB of text (7.5 KB file plus the 3.8 KB header it embeds), with the tool schemas
  on top. That is well above the 512-token minimum for Claude Opus 5.5, the default model (`server/config.ts:16`). The
  doc's "Cache limitations" section gives that minimum. The token count here is an estimate, not a measurement.
- **The 5-minute TTL doesn't fit slow director cycles.** "By default, the cache has a 5-minute lifetime". 1-hour
  writes cost 2× base input, 5-minute writes 1.25×, and hits on Opus 5.5 0.05× (doc, "Pricing"). The director's timer
  can be set to 300 or 600 s (`src/director/director.ts:20`), so each such cycle writes tools plus system afresh. A
  chat left alone for more than 5 minutes rewrites its whole history too. Suggestion: `promptCache: 'long'` for
  director runs whose interval is ≥ 5 min. Weigh it for chat too.
- **Effort changes invalidate the cache.** The doc lists `output_config.effort` and thinking changes among the things
  that invalidate the cache ("What invalidates the cache"). Chat and director use separate efforts
  (`server/assistant.ts:34`), but they also have separate tool lists, so they never shared a cache. Changing the
  effort mid-conversation costs one rewrite. No action needed.
- **Subscription backend:** Claude Code manages its own caching. The app only keeps its `--system-prompt` stable
  (`server/claude-cli-adapter.ts:56`) and reports the cache reads it gets back (`:278-297`).
- **Screenshots are cheap.** An image costs ⌈w/28⌉×⌈h/28⌉ visual tokens
  ([Vision](https://platform.claude.com/docs/en/build-with-claude/vision), "Resolution and token cost"), so a 512×288
  frame costs 19×11 = 209 tokens. Larger or more frames are affordable. Images already come before the text
  (`executor.ts:332-335`), which the doc recommends. For several frames the doc suggests labelling each one ("Image
  1:"). Today one text line lists all the times after the images.

---

## 6. Recommendation

Suggested order:

1. **Prompt-only fixes (S):** plan `maxSeconds`, effects, the laser art direction and the safety ranges, auto-switch,
   Live pinned, the director exemption from FOLLOW-UPS, and the glossary words.
2. **Context in `get_app_state` (S):** `auto`/`drift`/`driftSpeed`, the effect stack, screen mode, scene
   descriptions, and a richer `audio` (`playing`, track name, bands, energy, kicks per minute over the last seconds).
   Add effects to `get_show`'s show scenes.
3. **Make `look_at_scene` honest (S):** an option to render through `composeStill` with the screen's Look and
   effects (or a show scene's), to step `uTick`/`uTicks` with `times`, and to use the live spectrum and Hearing.
4. **Write tools (S-M):** `set_look` flags, one `set_effects` (stack in, stack out, with undo like `set_look`),
   effects on `add_show_scene`/`update_show_scene` (or an `add_show_scene {from: "screen"}` that captures like the UI),
   master/blackout, and `get_help {topic}` over `HELP_TOPICS` plus `shortcutRows`.
5. **`check_scene` (M):** move the e2e verdict (`e2e/builtin-scenes.spec.ts:70-113`) into `src/` and run it after
   create/write/edit, or on demand.
6. Later: playback and source tools, yt-dlp search, measuring a scene's cost, reference images from the user.

## Open questions

1. Should the assistant be allowed to set effects on show scenes, which reverses ADR 0003's consequence, or only on
   the main screen?
2. Should a conversation pause auto-switch while it runs, or only report it?
3. Should `set_look` be clamped to the Randomize/Drift ranges, or only warn past them? The user's sliders go further.
4. Should `check_scene` block saving a scene that fails, or only report? Built-ins must pass. The user's own scenes
   aren't checked today.

## Sources

Code (this repo, branch `footer-player`): `server/system-prompt.ts`, `server/assistant.ts`, `server/adapters.ts`,
`server/claude-cli-adapter.ts`, `server/cli-bridge.ts`, `server/routes.ts`, `server/ytdlp-bridge.ts`,
`server/config.ts`, `src/assistant/tools.ts`, `src/assistant/executor.ts`, `src/assistant/client-tools.ts`,
`src/assistant/notes.ts`, `src/app/controller.ts`, `src/app/studio.ts`, `src/app/live-slot.ts`,
`src/app/scene-library.ts`, `src/app/transport.ts`, `src/app/music-source.ts`, `src/engine/effects.ts`,
`src/engine/listener.ts`, `src/engine/look.ts`, `src/engine/renderer.ts`, `src/engine/scene-inputs.ts`,
`src/scenes/header.ts`, `src/scenes/scene.ts`, `src/state/app-state.ts`, `src/state/look-drift.ts`,
`src/state/show-plan.ts`, `src/director/director.ts`, `src/director/digest.ts`, `src/help/topics.ts`,
`src/hotkeys/registry.ts`, `src/components/Library.tsx`, `src/components/Editor.tsx`, `src/components/Studio.tsx`,
`src/components/Assistant.tsx`, `e2e/builtin-scenes.spec.ts`, `docs/assistant.md`, `docs/scenes.md`, `GLOSSARY.md`,
ADRs 0001-0003.

SDK source: `node_modules/@tanstack/ai-anthropic/dist/esm/prompt-cache.js` (@tanstack/ai-anthropic 0.22.0).

Anthropic docs:
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Define tools (best practices): https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Vision (image token cost): https://platform.claude.com/docs/en/build-with-claude/vision

Web platform: MDN, `MediaDevices.getDisplayMedia()`:
https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia

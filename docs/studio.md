# 📺 Studio & projector — press O

[← Back to the README](../README.md)

<img src="screenshots/studio.jpg" alt="The studio: Preview and Live monitors, Take with cut or fade, show scenes, the parameters dock and projector controls" width="100%">

Run a show like OBS's Studio Mode and put it on a projector. The two monitors are **Preview** (green) and **Live** (red).

## 1. Build the show

*+ Add scene…* adds any library scene, or *What's on Live now* (the current scene, its live parameter values and the
look sliders). Rename, reorder (▲▼), duplicate, and use ⤓ *Update from Live* to store a look you've just tweaked live.

## 2. Preview → Live

Click a show scene (or 1–9, ←/→) to put it in **Preview**, then **Take** (T) sends it to **Live** with a *Cut* or a
*Fade* (0.2–8 s). Double-click a scene to take it straight away. Preview then moves on to the next scene, so you can
keep pressing T.

## 3. Projector

*Detect displays* (asks once for the browser's *window management* permission, Chrome/Edge), pick the projector,
*Open projector*, then double-click that window (or press F there) for fullscreen. The projector renders the show
itself at its own resolution — it isn't a scaled-down video — and follows live code / visual-maker edits. *Identify*
shows each projector's resolution on it. Without display access, open it as a normal window and drag it onto the
projector.

## 4. Master / Blackout

**Blackout** (B) fades Live and every projector to black and back, over the fade time.

## 5. Autopilot

The autopilot steps through the show every 16 / 32 / 64 / 128 beats (random auto-switch pauses while it's on). A bar
under it counts the beats gone and left until the next take.

These beats come from a tempo clock: it takes its speed from the BPM detected on the kick drum, re-anchors on every
real kick, and keeps counting through breakdowns and silence, so the show moves on even when the bass stops.
(Everything else that reacts "on the beat", the `uBeat` uniform and auto-switch, follows the detected kicks
themselves.)

For music without a usable beat (ambient, a talk, a film), switch the unit box from *beats* to *seconds*: the autopilot
then runs on a plain timer, every 10 s … 5 min, with or without music, and every plan step gets the same time.

## 6. Close the studio and keep browsing

Once a show scene is Live, closing the studio pins it: projectors keep rendering the Live scene while whatever you do
on screen (switch scenes, tweak sliders) is only a preview. The panel shows *● LIVE · name* meanwhile; `T` still takes
the next Preview scene straight to Live. Reopening the studio puts Live back on screen.

The **Screen** widget switches this screen between your **Preview** and **● Live** without opening the studio: Live
shows exactly what the projectors get (Live's scene, parameters and look), and the scene you browsed to stays the
preview for when you switch back.

## 7. Plans and the Director

Instead of list order, the autopilot can follow a **plan**: an ordered queue of show scenes, each with its own beat
count and transition. Plans come from the [AI assistant](assistant.md) ("build a 30-minute set that starts calm and
peaks at the end") or from **Director** mode.

Tick *Director: plan every 64 / 128 / 256 beats* (or, with the unit box on *seconds*, every 30 s … 10 min on a timer)
and Claude reads a short digest of the music (tempo, mood, tone, the energy of the last few cycles) and the show, writes
the next steps, and the autopilot takes them on the bar. On beats it also plans at least every two minutes, tempo or
not.

- The plan shows as chips under the beat bar (the red one is playing; click one to preview it, ↶ brings the previous
  plan back, × drops it); the line below says what the director last decided and how many beats until its next cycle.
- Every step also has a wall-clock ceiling (90 s by default) so the show moves on even when no tempo has been detected
  yet.
- A take or an edit by hand is reported to the director in its next cycle and it respects it; the director never takes
  Live by itself and never edits scene code.
- Each cycle is a fresh, short conversation (the app remembers the recent decisions), so a long set costs the same per
  cycle at the end as at the start; the token count so far is in the status line.

The Director needs the local server and a Claude backend; see [AI assistant](assistant.md#setup).

## While the studio is open

The main canvas is the Live monitor and the Parameters widget becomes a dock. Like OBS's Studio Mode, the dock edits
the **selected (Preview) show scene** by default — tweaks show on the Preview monitor, are saved in that show scene and
go live when you Take it — and its *Live* tab edits what's live.

The show is saved in the browser. The projector must run in the same browser on the same computer (e.g. an extended
display); keep the main window open (not minimised) — it drives the projector. To stream or record, capture the
projector window in OBS (*Window Capture*), or use *Record* (C) here.

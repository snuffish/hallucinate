# 🖼️ Media — drop an image or video

[← Back to the README](../README.md)

Drop any image (png, jpg, gif, webp…) or video (mp4, webm, mov…) on the page, or use *Open file* in the panel's
Media section. Every scene can sample it with `media(p)` (a test pattern stands in until you drop one). The built-in
**Media** scenes that were built for it have been removed with the other built-ins
([ADR 0001](adr/0001-replace-all-built-in-scenes.md)); new ones will come in the library's *Media* category.

## YouTube

*YouTube* in the Media section searches YouTube (or paste a video, playlist or Shorts link) and remembers the videos
you used. The local server fetches the video with yt-dlp (up to 720p; needs ffmpeg to merge picture and sound) into a
temp cache, so the first load of a long video takes a moment and later ones are instant. Live streams aren't
supported. Downloads show live progress (percentage, size, speed, time left) in the picker and at the top of the
panel — also for SoundCloud — and × cancels; a cancelled download resumes where it stopped next time.

Needs the local server (`npm run dev` or the [desktop app](desktop.md)); the web demo hides it.

## Video sound

Videos loop, muted (the music drives the visuals). Tick **Use the video's sound as the music** (Media section or the
YouTube picker) to make a video — e.g. a music video — the audio source: the player then controls it (seek, tempo,
volume), the picture follows, and a YouTube result list continues with the next video when one ends.

## In code and the visual maker

In code, `media(p)` returns the picture at a centered position — it fills the screen and is mirrored beyond its edges,
so warped coordinates never run out — and `untone(col)` shows it in its true colours. In the
[visual maker](visual-maker.md) use the **Media** block (see the *Media warp* example).

[Projector windows](studio.md) get the file itself and play it in sync, at full quality.

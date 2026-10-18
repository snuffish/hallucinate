# 🎚️ Reference clips

[← Back to development](development.md)

The Listener is tested against real music: a set of short clips cut from real tracks and mixes, each with its right
answers (BPM, a drop, a breakdown). The music is copyrighted, so only the list of clips is committed; the audio is
rebuilt locally into `reference/clips/`, which git ignores (as it does `reference/recordings/`).

```sh
npm run clips                      # fetch and cut every clip on the list into reference/clips/
npm run clips:suggest              # suggest clips from the Lazy Mix (prints Markdown)
npm run clips:suggest -- <source>  # ... from another source on the list, or from an audio file
```

Both need [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg (`YTDLP` / `FFMPEG` point at other binaries).

## The list: `reference/clips.json`

An example of the format (the clip and its numbers are made up):

```json
{
  "sources": {
    "lazy-mix": { "title": "Unknown Reality – Lazy Mix", "url": "https://soundcloud.com/brainalien/unknown-reality-lazy-mix" }
  },
  "clips": [
    { "name": "example-breakdown", "source": "lazy-mix", "start": "12:34", "length": 60, "type": "breakdown",
      "bpm": 140, "drop": ["0:35", 60], "breakdown": [0, "0:35"] }
  ]
}
```

- **sources**: an id for each source, with its title and a link yt-dlp can fetch (SoundCloud, YouTube, …).
- **clips**: one entry per clip.
  - `name`: letters, digits, `-` and `_`; the audio is `reference/clips/<name>.flac`.
  - `source`: a source id.
  - `start`: where the clip starts in the source; `length`: how long it is. Seconds, `m:ss` or `h:mm:ss`.
  - `type`: `drop` (a full section with kicks), `breakdown` (a breakdown with a drop next to it), `ambient` (a
    passage without kicks) or `transition` (from one track into the next).
  - `bpm`: the tempo, **given by ear**, never worked out by code. For a transition, the tempo after it. An ambient
    clip may have `null`.
  - `drop`, `breakdown`: the stretch of the clip that is the drop / the breakdown, as `[from, to]` from the clip's own
    start, or `null`. A drop clip needs a drop; a breakdown clip needs both.

The list is checked when either command runs, and every problem is named at once.

## Fetch and cut

`npm run clips` fetches each source that still has a clip missing, once, into a temp folder, cuts its clips with
ffmpeg (re-encoded to flac, so each cut is exact) and deletes the download, so a full mix is never kept. Clips already
in `reference/clips/` are skipped; delete one to cut it again. A missing yt-dlp or ffmpeg, or a source that can't be
fetched, is reported with the reason, the other sources are still done, and the command exits with an error.

## Choosing clips

`npm run clips:suggest` fetches the mix into a temp folder (deleted afterwards), reads its loudness and the energy
below about 120 Hz second by second, and suggests up to three 60-second clips of each type, each with a short reason:

- **drop**: the loudest stretches where kicks and bass never stop.
- **breakdown**: a stretch of 8–60 s without kicks between two stretches with kicks, cut to end 25 s into the drop.
- **ambient**: the longest stretches without kicks.
- **transition**: where the kick and bass pattern (how the bass jumps, and its level) differs before and after.

Kicks count as "in" while the low band is close to the full mix's loudness, and as gone when it falls 12 dB or more
below it. The suggestions are a starting point: listen to each, pick the clips, and give each one's BPM, drop and
breakdown by ear.

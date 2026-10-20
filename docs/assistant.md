# ✦ AI assistant — press I

[← Back to the README](../README.md)

<img src="screenshots/assistant.jpg" alt="The assistant panel over a running scene, with example prompts and the subscription backend connected" width="100%">

A chat bubble at the bottom, next to the panel (✦, or I), opens a panel where Claude creates and edits scenes for you,
right in the app, while everything else stays where it is. It:

- reads a scene's code, edits it in place or rewrites it (and sees its own compile errors), and creates new scenes in
  your library;
- sets live parameters and the look sliders, switches scenes, and looks at a rendered frame to check its work;
- searches the library by description to pick a scene that fits ("a calm one with rings"), reads the app's own help to
  answer how something works, and sees the main screen's effects, the Look's switches and the live levels of the music;
- runs the [studio](studio.md): it adds, changes, reorders and removes show scenes, sets the transition and the
  autopilot, writes a plan for the autopilot and takes show scenes live ("build a show from the Space scenes and plan an
  hour", "swap the next two scenes", "longer fades").

Every change shows up live. **Undo** in the panel reverts the assistant's newest change (edits, new scenes, parameters,
look, show), and Claude is told with your next message, as it is when the scene on screen changed since its last
reply (auto-switch, or you); built-in scenes can also be reverted to their original in the
[code editor](editor.md). **Stop** interrupts it.

A tool chip that changed something opens to **what changed**: a code diff for a scene's code (with *Open in editor*
and *Put back the code from before*), from → to for parameters, Look sliders, the transition and the autopilot, and
the show scenes added, removed, changed or moved and the plan before and after. Unlike Undo, this stays with the
conversation after a reload; the scene's [History](editor.md#history) keeps every version the assistant made too. What
the [director](studio.md) changed is listed in the studio, under its status. After each reply the assistant suggests three things you could ask
next, as buttons under the reply, like the examples on an empty chat.

## Features

- **Several conversations at once.** **New** (Alt+N) starts another while the others keep working; the title at the
  top opens the list (working ones first, then pinned, then by day) with search (`Ctrl/⌘ K`), rename, pin, export as
  Markdown and delete; `Alt ↑ / ↓` steps through them. They are kept in this browser (IndexedDB; the 50 newest, pinned
  ones stay), so they survive a reload. On the subscription backend at most three run at once; a fourth waits its turn.
- **Notifications.** Close the panel while Claude works: the bubble's ring turns, then a badge counts the
  conversations with a reply waiting and a card next to the bubble peeks at it (click it to open that conversation).
  With the tab in the background, the window title shows the count.
- **Token usage** under each reply and for the whole conversation: how big the conversation is (context), the input the
  prompt cache didn't serve (new in), the output, and the cost as reported (on a subscription, the CLI's
  API-equivalent figure, not billed). The tooltip has every part. Long conversations get a hint to start a new one.
  See [What a reply costs](#what-a-reply-costs).
- **Reasoning.** 💭 shows Claude's reasoning (rendered, with a word count and Copy) or folds it away; the setting is
  remembered.
- **Type while it works**: your message waits (dimmed, × to drop it) and goes out when the reply is done. **Retry**
  after an error; **Copy** on replies and code blocks. Drag the panel's corner to resize it (double-click for the
  natural size), and its frame to move it away from the bubble (double-click the frame to bring it back).

## Setup

The assistant needs the local server (`npm run dev`, `npm run preview` or the [desktop app](desktop.md)). There are
two ways to reach Claude, picked automatically — the credentials never reach the browser:

```sh
# With a Claude subscription: install Claude Code (the `claude` command), sign in once, then simply
npm run dev

# With an Anthropic API key (billed to your account):
export ANTHROPIC_API_KEY=sk-ant-…
npm run dev
```

In the [desktop app](desktop.md) you can also paste the key into **Settings → Assistant** instead: it is encrypted
with your system's keychain, kept in the app's profile and never shown again.

On the subscription backend Claude Code runs with **no built-in tools, none of your settings and a throw-away working
directory**: it can only use this app's tools (eleven for scenes and the app, nine for the studio).

## Settings and environment variables

**Settings → Assistant** (⚙ or `,`) sets the connection, the model and the efforts, and shows which way Hallucinate
reaches Claude right now. A change applies to the next reply, without a restart. The same can be set with environment
variables; one the server was started with wins, and Settings shows that field as locked.

| Variable | Settings | What it does |
| --- | --- | --- |
| `ASSISTANT_MODEL` | Model | the model (default `claude-opus-5-5` on the API; the CLI's default otherwise, which also takes aliases like `opus`) |
| `ASSISTANT_EFFORT` | Effort | `low`, `medium`, `high`, `xhigh` or `max`, default `high`; lower is faster and cheaper |
| `ASSISTANT_DIRECTOR_EFFORT` | Director effort | the effort of the studio director's cycles; same as the effort unless set |
| `ASSISTANT_BACKEND` | Connection | `api` or `claude-code` to force one backend |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | API key (desktop app) | selects the API backend |
| `CLAUDE_BIN`, `YTDLP` | shown only | the `claude` and `yt-dlp` programs to run; never settable from the page, since the server runs them |
| `ASSISTANT_DEBUG` | | `1` logs the CLI arguments and tool traffic |

Settings saved from the page live in `~/.config/hallucinate/config.json` (`%APPDATA%\hallucinate` on Windows) for
`npm run dev`, and in the app's profile for the desktop app. They can only be changed from the computer the server runs
on: with `HOST=0.0.0.0`, a device on the network sees them but can't change them.

The director's cycles get only the show tools (read the show, write the plan, tweak a show scene's look); on the
subscription backend each cycle is one short `claude` run and its session is dropped afterwards. On the API backend the
system prompt and tool list are cached between runs.

## What a reply costs

Every step of a reply (each tool call, then the answer) sends the whole conversation to Claude again, so a change as
small as one parameter is two steps that each read the conversation so far. Most of that comes from the prompt cache,
which costs about a tenth of normal input; what costs is what the reply adds: new input (written to the cache) and
output (about five times the price of input). That's why the panel shows the conversation's size, the new input and the
output rather than a summed "in", and why the assistant edits scenes in place rather than resending them whole, and
gets a short note of what is on screen when you reopen a conversation instead of looking everything up again.

To see a subscription conversation's cost step by step, from Claude Code's own logs:

```sh
node scripts/assistant-usage.mjs            # the newest conversation
node scripts/assistant-usage.mjs --list     # all of them
```


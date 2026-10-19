import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';
import { HOTKEYS, type HotkeyDef, type HotkeyId, type HotkeyWhen } from '../hotkeys/registry';

// What the `?` buttons explain, one entry per area. Kept short on purpose: docs/ is the long
// reference. Shortcut lists come from the hotkey registry, so they can't drift from what the keys do.

export interface HelpTopic {
  id: string;
  title: string;
  body: string[];          // paragraphs
  hotkeys: HotkeyId[];     // the shortcuts that matter here, in display order
}

const NEEDS_SERVER = STATIC_DEMO ? [STATIC_DEMO_NOTE] : [];

export const HELP_TOPICS = {
  panel: {
    id: 'panel',
    title: 'Controls & layout',
    body: [
      'Pick a sound source, then shape the visuals: every scene reacts to the bass, mids and highs of whatever is playing.',
      'Each group of controls is its own widget. Drag one by its title bar: drop it on an edge of the screen to dock it there, or anywhere else to let it float. Double-click a title bar to put that widget back. The layout is remembered.',
      'Resize a widget by its corner, or in a side dock by its bottom edge; drag the inner edge of a side dock to make the whole dock wider. Double-click a grip for the natural size.',
      'Close widgets you don\'t need with ×; bring them back (and the AI assistant\'s bubble) from the ☰ Widgets menu, which also resets the layout.',
      'Settings (⚙ or ,) holds how this computer renders and listens, when the controls hide, and the export and import of your setup.',
      'Export scenes & settings (☰ menu) saves your scenes, edits to built-ins, My Shader, the visual maker graph, parameter values, the Studio show, favourites, player settings and layout to one file. Import… (or drop the file on the page) replaces them and reloads; your current setup is downloaded first as a backup.',
      'The controls fade away while the music plays and you leave the mouse alone; move it to bring them back.',
      'Every button with a shortcut shows its key. Hold a modifier to see which badges light up.',
      'Randomize (R) rolls the Look sliders to new values within laser-friendly ranges. Tick "Randomize also picks a random scene" to change the scene too. Shift+R goes back to the look before each roll.',
    ],
    hotkeys: ['help', 'hidePanel', 'resetLayout', 'fullscreen', 'randomize', 'randomizeBack', 'record'],
  },
  sources: {
    id: 'sources',
    title: 'Sound sources',
    body: [
      STATIC_DEMO
        ? 'Open an audio file (or drop one anywhere), use the microphone, share a tab\'s audio, or play the built-in demo beat.'
        : 'Open an audio file (or drop one anywhere), use the microphone, search SoundCloud, share a tab\'s audio, or play the built-in demo beat.',
      '"Tab / system audio" works for Spotify, YouTube or anything playing in another tab: tick "Share audio" when the browser asks.',
      'The player is the bar along the bottom: seek along its top edge, play, stop, ±10 s, loop and volume; the 1.00× chip holds tempo and pitch.',
      'The visuals react the same at any volume, even when muted.',
    ],
    hotkeys: ['playPause', 'seekBack', 'seekFwd', 'volumeUp', 'volumeDown', 'tempoDown', 'tempoUp', 'mute'],
  },
  look: {
    id: 'look',
    title: 'The look',
    body: [
      'These sliders apply to every scene: how strongly it reacts, how fast it moves, how long the afterglow of its trails lasts, its colour, and Fringing, how far each line splits into red, green and blue.',
      'Synesthesia grades the picture by the sound: dark sound goes dim and cool, bright sound light and warm, and an energetic mood more vivid. At 0 it is off.',
      'Each slider shows its value: click it to type one (Enter sets it, Escape doesn\'t). Double-click a slider to put it back. Drag with Shift held for a ten times finer move, even halfway through a drag; once a slider has focus the wheel steps it (Shift: one step), and so do the arrow keys. The dot beside Colour is the colour on screen now, cycling included.',
      'The XY pads each move two sliders at once, one across and one up: pick which with the menus above a pad. A tag on a slider (1↔, 2↕) says which pad axis it is also on. Drag on a pad to set both, Shift for finer; the wheel steps the one going up; double-click resets both. Fold the pads away with XY pads.',
      'The lock beside a slider keeps Randomize, Shift+R, Drift and Intensity off it. A show scene you take, a slot, the assistant and your own hand still move it.',
      'Intensity moves Reactivity, Trails and Fringing together, from the gentlest to the strongest look Randomize can reach.',
      'The slots A–D keep looks to come back to: click an empty one (or Shift+click any) to store the look now, click a filled one (or press Alt+1–4) to glide to it over a second. Shift+R comes back from a slot as from a Randomize. They go with an Export.',
      'Drift lets the sliders glide to new random values (within the same laser-friendly ranges as Randomize) on their own, each at its own pace, for a look that keeps slowly changing; Drift speed sets how fast. Move a slider yourself and it drifts on from there.',
      'The Look stays as you left it the next time the app opens.',
      'If the frame rate drops, lower Resolution in Settings → Display & performance.',
    ],
    hotkeys: ['randomize', 'randomizeBack', 'lookSlotA', 'lookSlotB', 'lookSlotC', 'lookSlotD', 'auto'],
  },
  effects: {
    id: 'effects',
    title: 'Effects',
    body: [
      'Effects reshape the picture on the main screen before the Look does: add one from the menu, switch it on or off with its checkbox, and set it with the controls under it. Each effect can be added once.',
      'The effects run from the top of the list down, so their order changes the picture: a Wave before a Kaleidoscope bends what gets folded, after it bends the mandala. Drag an effect by its ⠿ handle to another place, or focus the handle and move it with ↑ and ↓.',
      'They belong to what is on screen, like the Look: they stay when the scene changes, by hand, by auto-switch or from the library, and come back after a reload. Randomize and Drift leave them alone.',
      'Mirror reflects the left half onto the right, the top half onto the bottom, or both. It holds still on the beat.',
      'Kaleidoscope folds the picture into 3 to 12 segments around the centre, every other one mirrored, and turns the mandala at its spin speed. It turns faster with the bass and each kick sends it a step further on, as strongly as Reactivity says, and it never turns back; at spin speed 0 it holds still.',
      'Glow lays a soft bloom of light around the lines: Strength sets how bright, Radius how far it spreads. It swells with the bass and gives way to each kick, dipping while the lines flash and blooming back after. It costs the most of the effects to draw; if the frame rate drops, lower its Radius or Resolution in Settings.',
      'Wave ripples and bends the picture: Amount sets how far it bends, Wavelength how far apart the ripples are. On each kick a ripple runs outward from the centre, as strongly as Reactivity says.',
      'Near the edges every effect fades back to the scene\'s own picture, so the border stays as dark as the scene keeps it.',
    ],
    hotkeys: [],
  },
  library: {
    id: 'library',
    title: 'Scene library',
    body: [
      'Every scene with a live preview. Click a preview to play it, or filter by category and search. The built-ins are a laser show in Beams, Geometry, Fields and Media; your own are under Mine.',
      '★ makes a scene come up twice as often in auto-switch; the checkbox takes it out of the rotation. "Edit code" opens it in the code editor.',
    ],
    hotkeys: ['librarySearch', 'libraryTabNext', 'libraryRight', 'libraryDown', 'libraryPick', 'closeOverlay'],
  },
  editor: {
    id: 'editor',
    title: 'Code editor',
    body: [
      'The GLSL code of the scene on screen. It recompiles as you type; an error keeps the last working version running.',
      'Edits to built-in scenes are kept as your version ("Revert to original" undoes them). "Save to library" stores the code as a new scene.',
      'Tag a uniform or const with // @param to get a live control, and put a // @group Name line before related ones to give them a heading that folds. The cheat sheet lists the audio inputs and helpers.',
    ],
    hotkeys: ['editor', 'scenePrev', 'sceneNext', 'closeOverlay'],
  },
  nodes: {
    id: 'nodes',
    title: 'Visual maker',
    body: [
      'Build a scene by wiring blocks instead of writing code. Click a block on the left to add it, then drag from an output ● to an input ● to connect them.',
      'Type numbers into unconnected inputs. "Peek" hides the graph, "Examples…" loads ready-made graphs, and "Send to code" turns the graph into GLSL.',
    ],
    hotkeys: ['visualMaker', 'deleteNode', 'closeOverlay'],
  },
  studio: {
    id: 'studio',
    title: 'Studio & projector',
    body: [
      'Run a show: click a show scene to put it in Preview (green), then Take sends it to Live (red) with a cut or a fade.',
      'Open a projector window on another display: it renders the show itself at its own resolution. Blackout fades Live to black.',
      'Autopilot takes the next scene every few beats (or seconds).',
      ...(STATIC_DEMO ? ['The Director, which plans the show with Claude, needs the local server.'] : ['The Director lets Claude plan the show from the music.']),
    ],
    hotkeys: ['take', 'blackout', 'studioPrev', 'studioNext', 'studio', 'closeOverlay'],
  },
  perf: {
    id: 'perf',
    title: 'Performance monitor',
    body: [
      'Where each frame\'s time goes, over the last 3 s. On top: the frame rate, the typical frame and the slowest 1 in 20 (p95), against the budget: the time one refresh of the display allows (16.7 ms at 60 Hz).',
      'The verdict says what holds the frame rate back. Keeping up: nothing to do. Hitches (1 frame in 20 too slow): work outside the frame loop, such as garbage collection or thumbnails. Main thread: a stage below fills the frame. Probably the GPU: frames are slow but the main thread is nearly idle, so run Test GPU.',
      'Main thread: what each stage of the frame costs on average and at p95. Audio analysis is the Listener; Clock & look moves the scene; Draw calls only hands the frame to the GPU (not the GPU\'s own time); Projector link sends frames to projector windows; Studio & Preview is the studio\'s monitors; Publish to UI and React & microtasks update the controls.',
      'Test GPU renders the scene for a few seconds at half the pixels, then puts it back (the picture softens meanwhile). Clearly faster at half: the GPU\'s pixels are the cost, so lower Resolution (Settings) or simplify the scene. No faster: look at projectors, the Preview monitor or other tabs.',
      'Open the app with ?perf to start with it on, or ?perf=trace to add the stages to a DevTools Performance recording.',
    ],
    hotkeys: ['perf', 'hearingMonitor'],
  },
  hearing: {
    id: 'hearing',
    title: 'Hearing monitor',
    body: [
      'What the app hears in the music, why it hears it that way, and what the scene gets from it. It only shows; nothing here changes the picture.',
      'On top: the tempo (with what the kicks gave when it was folded into 85–175 BPM), the kick and tick lights, and whether it is hearing kicks, holding the tempo through a breakdown, or has no tempo. Confidence is how clearly the kicks repeat at the tempo: it drains while no kick confirms it. Below 30 frames a second it warns that kicks go unheard and the tempo wanders.',
      'The plot: pick what it draws with the chips, each with its value now. Click a chip to show or hide it, double-click to show only it, or start from a preset (Overview, Kicks, Kicks → scene, Bands, Tempo). It looks 6, 20 or 60 s back, a lane per group; hover it to read the values at that moment, and Pause holds it still. Your pick is kept for next time.',
      'Kicks lane: the rise in the bass, the threshold a kick must reach (yellow), the windows where a kick was due (shaded), and the kicks (pink) against the ticks (green). Ticks trailing their kicks show how late the beat clock follows. What if: drag the slider to see which rises a lower or higher threshold would let through (orange); it only shows, the Listener keeps its own.',
      'Bands are the levels as heard; the scene chips (uBass, uBeat, uTick…) are what the shader reads, after the Look: Reactivity scales the bands and the kick up to 1.5.',
      'Spectrum: the sound as heard, by frequency in Hz, bass on the left; the top is where loud sound clips. Tempo candidates: how strongly the kicks repeat at each tempo, against how clear a repeat must be to count (yellow) and the usual tempos the Listener prefers (grey). A half or double tempo as tall as the heard one is where half- and double-time readings come from.',
      'Move it: drag it anywhere by any part but its buttons, chips and slider; it opens there next time. A double-click puts it back in the corner.',
    ],
    hotkeys: ['hearingMonitor', 'perf'],
  },
  log: {
    id: 'log',
    title: 'System log',
    body: [
      'Everything the app has to say, as it happens: the page\'s console (and errors nothing caught), the local server (each request it answered, the assistant\'s traffic), the desktop app\'s main process (its console, windows crashing or hanging, the GPU process going away, permissions refused) and the app\'s own events (the scene, the music, the tempo locking and letting go, projectors, the GPU). It records from the moment the page loads, so it has the lines from before you opened it; while it is closed, a badge in the corner counts the errors you haven\'t seen.',
      'Show what you need: the level buttons switch errors, warnings, info and debug on and off, each with its count; the menu picks one source; the search box keeps the lines containing your text. Pause holds the lines still while new ones keep coming in behind it. A line with more to it (a stack, a whole object) opens with a click. The same line again right after shows ×2, ×3… instead of repeating.',
      'Clear empties it. Copy puts the lines shown on the clipboard and Export saves them as a .log file, with every line that matches, not only the 500 drawn.',
      'The field at the bottom takes commands: help lists them, and help <name> says what one takes. level, source and filter set what is shown; clear, copy and export do what their buttons do. Every assistant tool runs here by name, exactly as the assistant runs it: state (what is on screen), switch_scene scene="Ring Run", set_look {"hue": 0.3}. Give a tool its input as key=value pairs or as JSON. undo takes back the last change a tool made, here or in the assistant. ↑ and ↓ step through the commands you typed, Tab completes a name.',
      'The server\'s lines appear only when the app runs from its own server (npm run dev, the desktop app), on that computer. Move it: drag it by any part but its buttons, fields and lines; a double-click puts it back in the corner.',
    ],
    hotkeys: ['systemLog', 'hearingMonitor', 'perf'],
  },
  screen: {
    id: 'screen',
    title: 'Screen: preview or Live',
    body: [
      'After you take a show scene in the studio and close it, Live stays pinned: the projectors keep showing it while this screen is free to browse other scenes. That is the preview.',
      'Switch to Live to watch exactly what the projectors get, with Live\'s parameters and look; switch back to Preview to line up the next scene. Take (T) still sends the studio\'s next scene Live either way.',
      'With nothing pinned the screen already is Live, and with the studio open the screen is its Live monitor, so the switch only matters while Live is pinned.',
    ],
    hotkeys: ['take', 'blackout', 'studio'],
  },
  assistant: {
    id: 'assistant',
    title: 'AI assistant',
    body: [
      'Ask Claude to create or change scenes, set parameters and the look, or build and plan a studio show. Changes show up live.',
      'Keep several conversations: New starts another while the others keep working, and the title at the top opens them all, with search, rename, pin, export and delete. They are kept in this browser (the 50 newest; pinned ones stay).',
      'Close the panel while Claude works: the bubble turns while it does, then shows how many replies are waiting and a peek at the newest. Type while it works and your message is sent next.',
      'Undo reverts the newest change any conversation made, and Claude hears about it with your next message. 💭 shows Claude\'s reasoning. Token use shows under each reply and for the whole chat; drag the panel\'s corner to resize it.',
      ...NEEDS_SERVER,
    ],
    hotkeys: ['assistant', 'assistantNew', 'assistantPrev', 'assistantNext', 'assistantSearch', 'closeOverlay'],
  },
  params: {
    id: 'params',
    title: 'Live parameters',
    body: [
      'The controls this scene exposes. Changes apply instantly and are remembered per scene. Groups start folded: click a heading to open it, or use ⊞ / ⊟ to open or fold them all.',
      'Double-click a slider to reset it; Reset resets them all. Drag the title bar to move or dock the widget, double-click it to send it back.',
    ],
    hotkeys: ['params'],
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    body: [
      'Display & performance: the Resolution and pixel density everything renders at (the main screen, the studio\'s Preview and projectors). They apply at once: lower them if the frame rate drops.',
      'Audio: how much the analysis smooths the sound, and the browser\'s microphone processing, off by default because it ducks and gates music.',
      'Interface: when the controls hide, the key badges on buttons and the assistant\'s reasoning.',
      ...(STATIC_DEMO ? [] : ['Assistant: which way Hallucinate reaches Claude, the model and effort, and (in the desktop app) an API key, kept encrypted. A variable set in the environment wins and locks its field.']),
      'These settings belong to this computer: they are kept here and left out of Export. Data exports and imports your setup and clears the recently played lists.',
    ],
    hotkeys: ['settings', 'closeOverlay'],
  },
  soundcloud: {
    id: 'soundcloud',
    title: 'SoundCloud',
    body: [
      'Search, or paste a track, playlist or artist link, and click a result. The results play in order like a queue.',
      'The local server fetches tracks with yt-dlp; some (Go+ or region-locked) can\'t be fetched. "Recent" lists what you played.',
      ...NEEDS_SERVER,
    ],
    hotkeys: ['closeOverlay'],
  },
  youtube: {
    id: 'youtube',
    title: 'YouTube',
    body: [
      'Search, or paste a video, playlist or Shorts link. The video becomes the picture Scan Trace draws and your own shaders sample with media(p).',
      'Tick "Use the video\'s sound as the music" to make it the audio source too. The first load of a long video takes a moment.',
      ...NEEDS_SERVER,
    ],
    hotkeys: ['closeOverlay'],
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

// The sheet's group order.
export const SHEET_GROUPS: HotkeyDef['group'][] = ['Playback', 'Scenes', 'Look', 'Panels', 'Studio'];

// Where a shortcut works, for keys that only apply in one place.
const WHEN_NOTES: Partial<Record<HotkeyWhen, string>> = {
  library: 'in the library',
  studio: 'in the studio',
  nodesOpen: 'in the visual maker',
  paramsVisible: 'while parameters show',
};

export interface ShortcutRow { label: string; note?: string; keys: HotkeyDef[] }

// One row per label: entries that share a label (Delete / Backspace) are shown together.
export function shortcutRows(ids: readonly HotkeyId[]): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  for (const id of ids) {
    const def: HotkeyDef = HOTKEYS[id];
    const note = WHEN_NOTES[def.when];
    const row = rows.find((r) => r.label === def.label && r.note === note);
    if (row) row.keys.push(def);
    else rows.push({ label: def.label, note, keys: [def] });
  }
  return rows;
}

// Every shortcut in a group, in registry order.
export function groupRows(group: HotkeyDef['group']): ShortcutRow[] {
  return shortcutRows((Object.keys(HOTKEYS) as HotkeyId[]).filter((id) => HOTKEYS[id].group === group));
}

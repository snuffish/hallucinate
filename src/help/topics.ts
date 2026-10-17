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
      'Drift lets the sliders glide to new random values (within the same laser-friendly ranges as Randomize) on their own, each at its own pace, for a look that keeps slowly changing; Drift speed sets how fast. Move a slider yourself and it drifts on from there.',
      'If the frame rate drops, lower Resolution in Settings → Display & performance.',
    ],
    hotkeys: ['randomize', 'randomizeBack', 'auto'],
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

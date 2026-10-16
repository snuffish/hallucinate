// What the React tree sees. Published by the render loop at ≤30 Hz and by actions immediately.
// Everything here is a plain value, so selectors can compare with Object.is.

import type { GameHud } from '../engine/game';
import type { OutputStatus } from '../engine/output-link';
import type { ParamSpec, ParamValues } from '../engine/params';
import type { PerfReport } from '../engine/profiler';
import type { HelpTopicId } from '../help/topics';
import type { Look, SourceButton } from './app-state';
import type { WidgetId } from './layout';

export type Overlay = 'library' | 'editor' | 'nodes' | 'studio' | 'soundcloud' | 'youtube' | 'settings' | null;

// A panel's help popover, or the sheet with every shortcut.
export type HelpId = HelpTopicId | 'sheet';

// What is being dragged around the screen ('resize': a widget's or a dock's resize grip).
export type DragId = WidgetId | 'bubble' | 'resize';

export interface Meters { bass: number; mid: number; high: number; bright: number; centroid: number; beat: number }
export type MoodLabel = '' | 'mood: calm' | 'mood: groovy' | 'mood: energetic';

export interface TransportView {
  mode: 'element' | 'demo' | null;
  hasQueue: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
}

export interface MediaView { name: string; kind: 'image' | 'video' | null; width: number; height: number; loaded: boolean }

export interface DownloadView { id: 'sc' | 'yt'; title: string; percent: number; text: string }

export interface ParamsView {
  title: string;
  key: string;              // the scene's `paramKey`: which scene's folded groups apply
  specs: ParamSpec[];
  values: ParamValues;
  inStudio: boolean;        // shown in the studio's parameters dock (and editing the Preview slot there)
}

// A reply that landed while the chat was closed: the card beside the bubble.
export interface AssistantPeek { chatId: string; title: string; text: string; error: boolean; key: number }

// What the main screen shows while the studio is closed and a show scene is Live.
export type ScreenMode = 'preview' | 'live';

export interface UIState {
  started: boolean;
  nowText: string;
  activeSource: SourceButton | null;
  sceneIndex: number;
  sceneName: string;        // "3 · Hyper Tunnel"
  sceneVersion: number;     // bumps when the scene list changes (add/remove/edit), for lists
  look: Look;
  meters: Meters;
  bpm: number | null;
  moodLabel: MoodLabel;
  toneTitle: string;
  overlay: Overlay;
  assistantOpen: boolean;   // the chat bubble; independent of the overlays
  assistantBusy: boolean;   // a chat run is in flight (the director waits for it)
  assistantRunning: number; // conversations working right now
  assistantUnread: number;  // conversations with a reply the user hasn't seen
  assistantPeek: AssistantPeek | null;
  assistantFocus: string | null;   // a conversation to show when the panel opens (the peek was clicked)
  assistantConfig: number;  // bumps when Settings → Assistant saved: the panel asks the server again
  help: HelpId | null;      // the open help popover; closed whenever an overlay, the panel or the assistant changes
  liveName: string | null;  // the pinned Live slot (studio closed after a take); projectors follow it, not the screen
  screenMode: ScreenMode;   // while Live is pinned: the screen shows your preview (browse freely) or Live (what projectors get)
  widgetsHidden: boolean;   // H: every control widget hidden for this session (not persisted)
  dragging: DragId | null;
  paramsVisible: boolean;
  params: ParamsView;
  hud: GameHud | null;
  perf: PerfReport | null;  // Shift+P: the performance overlay, ~2 Hz while on; null = off (not persisted)
  recording: boolean;
  transport: TransportView;
  media: MediaView;
  mediaSound: boolean;
  downloads: DownloadView[];
  outputs: OutputStatus[];
  toast: { text: string; key: number } | null;
  startupErrors: string[];
}

export const initialUIState = (look: Look): UIState => ({
  started: false,
  nowText: 'No audio yet',
  activeSource: null,
  sceneIndex: 0,
  sceneName: '',
  sceneVersion: 0,
  look,
  meters: { bass: 0, mid: 0, high: 0, bright: 0.5, centroid: 0, beat: 0 },
  bpm: null,
  moodLabel: '',
  toneTitle: '',
  overlay: null,
  assistantOpen: false,
  assistantBusy: false,
  assistantRunning: 0,
  assistantUnread: 0,
  assistantPeek: null,
  assistantFocus: null,
  assistantConfig: 0,
  help: null,
  liveName: null,
  screenMode: 'preview',
  widgetsHidden: false,
  dragging: null,
  paramsVisible: false,
  params: { title: 'Parameters', key: '', specs: [], values: {}, inStudio: false },
  hud: null,
  perf: null,
  recording: false,
  transport: { mode: null, hasQueue: false, playing: false, currentTime: 0, duration: 0, loop: false },
  media: { name: '', kind: null, width: 1, height: 1, loaded: false },
  mediaSound: false,
  downloads: [],
  outputs: [],
  toast: null,
  startupErrors: [],
});

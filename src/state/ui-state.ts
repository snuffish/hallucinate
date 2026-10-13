// What the React tree sees. Published by the render loop at ≤30 Hz and by actions immediately.
// Everything here is a plain value, so selectors can compare with Object.is.

import type { GameHud } from '../engine/game';
import type { OutputStatus } from '../engine/output-link';
import type { ParamSpec, ParamValues } from '../engine/params';
import type { Look, SourceButton } from './app-state';

export type Overlay = 'library' | 'editor' | 'nodes' | 'studio' | 'assistant' | 'soundcloud' | 'youtube' | null;

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
  specs: ParamSpec[];
  values: ParamValues;
  docked: boolean;
}

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
  panelCollapsed: boolean;
  paramsVisible: boolean;
  paramsCollapsed: boolean;
  params: ParamsView;
  hud: GameHud | null;
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
  panelCollapsed: false,
  paramsVisible: false,
  paramsCollapsed: false,
  params: { title: 'Parameters', specs: [], values: {}, docked: false },
  hud: null,
  recording: false,
  transport: { mode: null, hasQueue: false, playing: false, currentTime: 0, duration: 0, loop: false },
  media: { name: '', kind: null, width: 1, height: 1, loaded: false },
  mediaSound: false,
  downloads: [],
  outputs: [],
  toast: null,
  startupErrors: [],
});

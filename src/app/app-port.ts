// What the sessions (the studio, the director, the assistant's tools and conversations) use of the
// app, and nothing more. The controller is the real one; the tests use one in-memory fake of it
// (fake-app.ts), so when the controller or the fake drifts from what the sessions need, it doesn't
// compile.

import type { MediaLayer } from '../engine/media';
import type { OutputLink } from '../engine/output-link';
import type { Renderer } from '../engine/renderer';
import type { Prefs } from '../state/prefs';
import type { Store } from '../state/store';
import type { AppController } from './controller';
import type { EditorCore } from './editor';
import type { MusicSource } from './music-source';

export type AppPort = Pick<AppController,
  | 'state' | 'ui' | 'live' | 'library' | 'sceneIndex' | 'currentScene' | 'overlay'
  | 'toast' | 'setHooks' | 'showParams' | 'setScene' | 'sceneByName' | 'setLook' | 'setIntensity' | 'setPalette'
  | 'captureScene' | 'applyScene' | 'hearing'
> & {
  readonly music: Pick<MusicSource, 'playing'>;
  readonly media: MediaLayer;                                     // the studio's Preview renderer shows it too
  readonly renderer: Pick<Renderer, 'snapshotAsync'>;
  readonly output: Pick<OutputLink, 'screens' | 'open'>;
  readonly editor: Pick<EditorCore, 'target' | 'compileInto'>;
  readonly prefs: Pick<Store<Prefs>, 'get'>;
};

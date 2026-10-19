// Imported first by main.ts: imports run before the importing module's body, so the main process's console
// is in the System log before any other module of the app runs.

import { captureMainProcess } from './main-log';

captureMainProcess();

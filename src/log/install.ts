// Imported first by main.tsx: imports run before the importing module's body, so the console is captured
// before any other module of the app runs, and a startup error is in the System log too.

import { captureConsole } from './console-capture';
import { systemLog } from './system-log';

captureConsole(systemLog);

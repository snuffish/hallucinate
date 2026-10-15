// Electron main process: Hallucinate as a desktop app.
//
// It starts the app's local server (desktop/server.ts: the built app plus the /api handlers `vite preview`
// mounts) on 127.0.0.1 and opens it in a window, so the renderer runs exactly as in the browser. What a
// browser would ask the user (microphone, screen sharing, display access, pop-ups) is answered here.
//
// HALLUCINATE_DEV_URL (set by `npm run desktop`) loads the Vite dev server instead, which hosts the API itself.
// HALLUCINATE_USER_DATA and HALLUCINATE_PORT give the desktop e2e test its own profile and port.

import { app, BrowserWindow, desktopCapturer, dialog, session, shell, systemPreferences, type WebContents } from 'electron';
import { join } from 'node:path';
import { fixPath } from './env';
import { PREFERRED_PORT, startServer, type AppServer } from './server';

const ROOT = join(import.meta.dirname, '..');
const DEV_URL = process.env.HALLUCINATE_DEV_URL;
const PORT = Number(process.env.HALLUCINATE_PORT) || PREFERRED_PORT;
if (process.env.HALLUCINATE_USER_DATA) app.setPath('userData', process.env.HALLUCINATE_USER_DATA);
const GRANTED = new Set(['media', 'display-capture', 'window-management', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'speaker-selection']);

let server: AppServer | null = null;
let appUrl = '';
let main: BrowserWindow | null = null;

// The browser's autoplay rule needs a click before audio starts; a desktop app doesn't.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// One Hallucinate at a time: a second one would take another port, which is another origin with an empty library.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.focus();
  });
  app.whenReady().then(start).catch((err: unknown) => {
    dialog.showErrorBox('Hallucinate could not start', err instanceof Error ? err.stack ?? err.message : String(err));
    app.exit(1);
  });
}

async function start(): Promise<void> {
  if (DEV_URL) {
    appUrl = new URL(DEV_URL).origin;
  } else {
    await fixPath();   // so `claude` and `yt-dlp` are found when the app was started from the Dock / a menu
    // yt-dlp borrows this process as its JavaScript runtime (node:<execPath>); make the Electron binary act as Node.
    server = await startServer({ dist: join(ROOT, 'dist'), preferredPort: PORT, env: { ELECTRON_RUN_AS_NODE: '1' } });
    appUrl = `http://127.0.0.1:${server.port}`;
  }
  setUpSession();
  main = createWindow();
  if (server?.fellBack) {
    void dialog.showMessageBox(main, {
      type: 'warning',
      message: `Port ${PORT} is in use, so Hallucinate runs on port ${server.port} this time.`,
      detail: 'Your scenes, shows and settings belong to the usual port and are not visible now; nothing is lost. Close whatever uses that port and restart Hallucinate to get them back.',
    });
  }
}

function sameOrigin(url: string): boolean {
  try { return new URL(url).origin === appUrl; } catch { return false; }
}

function openOutside(url: string): void {
  try {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
  } catch { /* not a URL */ }
}

function setUpSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!sameOrigin(details.requestingUrl ?? wc.getURL()) || !GRANTED.has(permission)) return callback(false);
    // macOS asks the user for the microphone once per app; Electron has to trigger that prompt itself.
    const media = permission === 'media' && 'mediaTypes' in details ? details.mediaTypes ?? [] : [];
    if (process.platform === 'darwin' && media.includes('audio')) {
      systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
      return;
    }
    callback(true);
  });
  // getDisplayMedia ("Tab / system audio"). macOS: the system's own picker where available. Windows: the
  // whole screen plus loopback system audio. Linux: Electron can't capture system audio, so the app reports
  // that no audio was shared.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const screen = sources[0];
      if (!screen) return callback(null);
      callback(process.platform === 'win32' && request.audioRequested ? { video: screen, audio: 'loopback' } : { video: screen });
    }, () => callback(null));
  }, { useSystemPicker: true });
}

function guard(contents: WebContents): void {
  // Only the projector page opens as an app window; links go to the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url) && new URL(url).pathname.endsWith('/output.html')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { backgroundColor: '#000000', autoHideMenuBar: true, title: 'Hallucinate — Projector', webPreferences: webPreferences() },
      };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openOutside(url);
  });
}

function webPreferences() {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: 'Hallucinate',
    backgroundColor: '#000000',
    autoHideMenuBar: process.platform !== 'darwin',
    show: false,
    webPreferences: webPreferences(),
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (main === win) main = null; });   // guard() runs from web-contents-created
  void win.loadURL(`${appUrl}/`);
  return win;
}

// Every window, the main one and projectors alike, gets the guard exactly once (twice would open links twice).
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'window') guard(contents);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!main && appUrl) main = createWindow();
});

// Closing the server ends open streams, which stops running assistant replies (the `claude` process) and
// downloads nobody waits for any more; give that a moment before the process goes.
let closing = false;
app.on('before-quit', (event) => {
  if (!server || closing) return;
  closing = true;
  event.preventDefault();
  const done = () => { server = null; app.quit(); };
  void Promise.race([server.close(), new Promise((r) => setTimeout(r, 2000))]).then(done, done);
});

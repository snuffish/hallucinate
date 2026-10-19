// Electron main process: Hallucinate as a desktop app.
//
// It starts the app's local server (desktop/server.ts: the built app plus the /api handlers `vite preview`
// mounts) on 127.0.0.1 and opens it in a window, so the renderer runs exactly as in the browser. What a
// browser would ask the user (microphone, screen sharing, display access, pop-ups) is answered here.
//
// HALLUCINATE_DEV_URL (set by `npm run desktop`) loads the Vite dev server instead, which hosts the API itself.
// HALLUCINATE_USER_DATA and HALLUCINATE_PORT give the desktop e2e test its own profile and port.

import './install-log';   // first: the System log hears the main process from here on
import { app, BrowserWindow, desktopCapturer, dialog, safeStorage, session, shell, systemPreferences, type WebContents } from 'electron';
import { join } from 'node:path';
import { fileConfigStore, type Secrets } from '../server/config';
import { fixEnv } from './env';
import { desktopLine, goneLine, windowName } from './main-log';
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
    desktopLine('error', `Hallucinate could not start: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
    dialog.showErrorBox('Hallucinate could not start', err instanceof Error ? err.stack ?? err.message : String(err));
    app.exit(1);
  });
}

async function start(): Promise<void> {
  if (DEV_URL) {
    appUrl = new URL(DEV_URL).origin;
  } else {
    await fixEnv();   // so `claude`, `yt-dlp` and the shell's API key are found when the app was started from the Dock / a menu
    // yt-dlp borrows this process as its JavaScript runtime (node:<execPath>); make the Electron binary act as Node.
    const config = fileConfigStore(join(app.getPath('userData'), 'config.json'), keychain());
    server = await startServer({ dist: join(ROOT, 'dist'), preferredPort: PORT, env: { ELECTRON_RUN_AS_NODE: '1' }, config });
    appUrl = `http://127.0.0.1:${server.port}`;
  }
  setUpSession();
  desktopLine('info', `Hallucinate ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform}) serving the app at ${appUrl}`);
  main = createWindow();
  if (server?.fellBack) {
    desktopLine('warn', `Port ${PORT} is in use: running on port ${server.port}, where your saved library isn't`);
    void dialog.showMessageBox(main, {
      type: 'warning',
      message: `Port ${PORT} is in use, so Hallucinate runs on port ${server.port} this time.`,
      detail: 'Your scenes, shows and settings belong to the usual port and are not visible now; nothing is lost. Close whatever uses that port and restart Hallucinate to get them back.',
    });
  }
}

// The assistant's settings (Settings → Assistant) keep an API key encrypted with the OS keychain. Linux
// without a keyring has none (Electron's `basic_text` fallback uses a fixed password, so it doesn't
// count): the key field is then off and ANTHROPIC_API_KEY in the shell still works.
function keychain(): Secrets | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return null;
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64')),
  };
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
    const url = details.requestingUrl ?? wc.getURL();
    if (!sameOrigin(url) || !GRANTED.has(permission)) {
      desktopLine('warn', `Refused the permission "${permission}" to ${url}`);
      return callback(false);
    }
    // macOS asks the user for the microphone once per app; Electron has to trigger that prompt itself.
    const media = permission === 'media' && 'mediaTypes' in details ? details.mediaTypes ?? [] : [];
    if (process.platform === 'darwin' && media.includes('audio')) {
      systemPreferences.askForMediaAccess('microphone').then((granted) => {
        if (!granted) desktopLine('warn', 'macOS refused the microphone: allow Hallucinate in System Settings → Privacy & Security → Microphone');
        callback(granted);
      }, () => callback(false));
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

// Every window, the main one and projectors alike, gets the guard exactly once (twice would open links twice),
// and its troubles go to the System log.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'window') return;
  guard(contents);
  watch(contents);
});

function watch(contents: WebContents): void {
  const name = () => windowName(contents.getURL());
  contents.on('did-finish-load', () => desktopLine('debug', `${name()} loaded`));
  contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) desktopLine('error', `${name()} couldn't load ${url}: ${description} (${code})`);   // -3: a newer navigation took over
  });
  contents.on('unresponsive', () => desktopLine('warn', `${name()} is not responding`));
  contents.on('responsive', () => desktopLine('info', `${name()} is responding again`));
  contents.on('preload-error', (_e, path, err) => desktopLine('error', `${name()}'s preload ${path} failed: ${err.message}`, err.stack));
}

// A window's page or a helper process (the GPU, the network service, audio) going away.
app.on('render-process-gone', (_event, contents, details) => {
  const { level, text } = goneLine(`${windowName(contents.getURL())}'s page`, details);
  desktopLine(level, text);
});
app.on('child-process-gone', (_event, details) => {
  const { level, text } = goneLine('A helper process', details);
  desktopLine(level, text);
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
  desktopLine('info', 'Quitting');
  closing = true;
  event.preventDefault();
  const done = () => { server = null; app.quit(); };
  void Promise.race([server.close(), new Promise((r) => setTimeout(r, 2000))]).then(done, done);
});

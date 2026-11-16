// An Electron app for test/desktop/crash-reports.test.ts: crash reports started as
// desktop/main.ts starts them (desktop/crash-reports.ts), in a window under den-kit's
// window rules (desktop/window-rules.ts) with den-kit's preload (desktop/preload.ts)
// and a page that starts them as den-kit's page does (test/desktop/crash-page.ts).
// The test passes in, through the environment: the app's data folder (USER_DATA),
// the Sentry DSN (DSN), whether the person allowed crash reports (ALLOWED), a key
// that must not reach a report (KEY), and the preload and the page's script (PRELOAD,
// PAGE). globalThis.crashTest lets the test change the answer and look inside.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CrashReports, crashRelease, type Redaction } from '../../desktop/crash-reports.ts';
import { SandboxServer } from '../../desktop/sandbox.ts';
import { applyWindowRules, beforeReady } from '../../desktop/window-rules.ts';

const env = process.env;
app.setName('den-kit');
app.setPath('userData', env.USER_DATA!);
// Inside the test's folder on every system, so the test removes only what it made.
app.setPath('crashDumps', join(env.USER_DATA!, 'Crashpad'));
beforeReady(app);
// The test's Sentry is on this machine, with the test's own certificate.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP sentry.test 127.0.0.1');
app.commandLine.appendSwitch('ignore-certificate-errors');
// Errors in the main process are read from the reports; without this, Sentry would show each in a dialog.
process.on('uncaughtException', () => {});

let allowed = env.ALLOWED === 'yes';
const reports = new CrashReports({
  dsn: env.DSN!,
  release: crashRelease(app.getVersion()),
  allowed: () => allowed,
  redactions: (): Redaction[] => [
    [homedir(), '~'],
    [env.KEY!, '[key]'],
  ],
  sentry: () => import('@sentry/electron/main'),
  clear: () => {
    for (const dir of [app.getPath('crashDumps'), join(app.getPath('userData'), 'sentry')])
      rmSync(dir, { recursive: true, force: true });
  },
});
let startedBeforeReady = false;
void reports.launch().then(() => {
  startedBeforeReady = allowed && !app.isReady();
});

void app.whenReady().then(async () => {
  const sandbox = new SandboxServer({ port: 0, content: () => null, refused: () => {} });
  const server = createServer((req, res) => {
    if (sandbox.handle(req, res)) return;
    if (req.url === '/page.js')
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(env.PAGE!));
    else
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><title>den-kit</title><script type="module" src="/page.js"></script>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  sandbox.port = (server.address() as { port: number }).port;
  const appOrigin = `http://127.0.0.1:${sandbox.port}`;
  // What desktop/main.ts gives den-kit's preload, for a build that sends crash reports.
  ipcMain.on('den-kit:runtime', event => {
    event.returnValue = {
      token: 'token',
      apiKey: null,
      analytics: { kinds: ['crashes'], contact: null, crashReports: allowed },
    };
  });
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: env.PRELOAD!,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--den-kit-origin=${appOrigin}`],
    },
  });
  // Every connection of the window's session goes through den-kit's refusing proxy.
  await applyWindowRules({
    session: session.defaultSession,
    contents: win.webContents,
    sandbox,
    appOrigin,
    direct: [],
    permitted: () => false,
  });
  (globalThis as unknown as { crashTest: unknown }).crashTest = {
    startedBeforeReady: () => startedBeforeReady,
    /** Sentry's channel for the page's reports has a listener once Sentry started. */
    listening: () => ipcMain.listenerCount('sentry-ipc.envelope'),
    folders: () => ({
      crashDumps: app.getPath('crashDumps'),
      queue: join(app.getPath('userData'), 'sentry'),
    }),
    /** The person's answer in Settings, as desktop/main.ts follows it. */
    allow: async (on: boolean) => {
      allowed = on;
      await reports.follow();
    },
    /** An error nobody catches, thrown from the app's own code. */
    throwInMain: (message: string) => {
      setTimeout(() => {
        throw new Error(message);
      });
    },
    crashPage: () => win.webContents.forcefullyCrashRenderer(),
  };
  await win.loadURL(`${appOrigin}/`);
});

// The desktop app's page: den-kit in the app's window. The preload bridge
// (desktop/preload.ts) gives the page the local AI bridge's token, the BrowserPod
// key of this build and the app's own services (ChatGPT sign-in, updates,
// pictures of the window, storage in the app's data folder, the works' sandbox
// origins, files from URLs); this file turns them into the Host (src/host) and
// starts the editor.
import type { Host, Lifecycle, PodFactory } from '../../src/host/index.ts';
import type { AIAccount, AIAccountInfo } from '../../src/host/ai.ts';
import { startEditor } from '../../src/editor/start.ts';
import { BridgeClient } from './bridge-client.ts';
import { desktopStorage } from './storage.ts';
import { desktopSandbox } from './sandbox.ts';
import { desktopWording } from './ai-wording.ts';
import { windowCapture } from './window-capture.ts';
import { desktopProjectError } from './project-errors.ts';
import type { DesktopInfo } from './api.ts';

// A service worker another app left on this address would keep the page from being cross-origin isolated (see browserpod.ts).
if (!globalThis.crossOriginIsolated && 'serviceWorker' in navigator)
  void import('./browserpod.ts').then(m => m.clearForeignServiceWorkers());

const shell = window.denKitShell!;
const listen = (event: string, listener: () => void) => {
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
};
const accountInfo = (info: DesktopInfo): AIAccountInfo => ({
  settings: info.settings,
  models: info.models,
  codex: info.codex,
  aiBusy: info.aiBusy,
  signedIn: info.chatGPTSignedIn,
  login: info.login,
  loginError: info.loginError,
});
const account: AIAccount = {
  info: async () => accountInfo(await shell.info()),
  saveSettings: async settings => accountInfo(await shell.saveSettings(settings)),
  signIn: () => shell.signIn(),
  cancelSignIn: () => shell.cancelSignIn(),
  signOut: () => shell.signOut(),
  reconnect: async () => accountInfo(await shell.reconnectAI()),
  openUsage: () => shell.openUsage(),
};
const quitTasks = new Set<() => Promise<void>>();
const lifecycle: Lifecycle = {
  info: async () => {
    const info = await shell.info();
    return { version: info.version, update: info.update };
  },
  checkForUpdates: async () => {
    const info = await shell.checkForUpdates();
    return { version: info.version, update: info.update };
  },
  installUpdate: () => shell.installUpdate(),
  onUpdate: listener => listen('den-kit:update', listener),
  onShowSettings: listener => listen('den-kit:show-settings', listener),
  beforeQuit(task) {
    quitTasks.add(task);
    return () => quitTasks.delete(task);
  },
};
// The main process runs this before the app quits or restarts (desktop/main.ts).
(window as unknown as { __denKitBeforeQuit: () => Promise<void> }).__denKitBeforeQuit =
  async () => {
    for (const task of quitTasks) await task();
  };
const apiKey = shell.runtime.apiKey;
const workspace: PodFactory = apiKey
  ? {
      kind: 'browserpod',
      create: async (work, progress) =>
        (await import('./browserpod.ts')).bootBrowserPod({
          apiKey,
          audience: 'desktop',
          work,
          log: progress,
        }),
      explain: error => desktopProjectError(error),
    }
  : {
      kind: null,
      create: () => Promise.reject(new Error('Project tools are unavailable.')),
      reason: 'Project tools are unavailable in this app build.',
      fix: 'Contact the app maintainer for an updated build.',
    };
const host: Host = {
  storage: desktopStorage(shell),
  ai: new BridgeClient({ token: shell.runtime.token, wording: desktopWording, account }),
  account: null,
  workspace,
  sandbox: desktopSandbox(shell),
  fetch: { get: (url, maxBytes) => shell.fetch(url, maxBytes) },
  screenCapture: windowCapture(rect => shell.capturePage(rect)),
  consent: null,
  lifecycle,
};
// Checks open the page with ?noStart to begin on the starter instead of the start screen.
const session = startEditor(host, {
  mount: '#app',
  noStart: new URLSearchParams(location.search).has('noStart'),
});
// Acceptance checks (scripts/check-desktop.ts) drive the same session.
(window as unknown as { __kit: typeof session }).__kit = session;

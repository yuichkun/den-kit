import {
  app,
  autoUpdater as squirrel,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  session,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CodexClient } from '../bridge/codex/client.ts';
import { CODEX_VERSION } from '../bridge/codex/protocol.ts';
import { createBridge, type Bridge } from '../bridge/server.ts';
import type { DesktopInfo, DesktopSettings } from './page/api.ts';
import type { PageRect } from '../src/host/index.ts';
import { APP_ORIGIN, APP_PORT, rendererServer } from './renderer-server.ts';
import { readSettings, validatedSettings, writeSettings } from './settings.ts';
import { allowedPermission } from './permissions.ts';
import { openChatGPTSignIn } from './sign-in.ts';
import { DesktopUpdates } from './updates.ts';
import { signInPending } from '../src/editor/settings-presentation.ts';

interface OperatorConfig {
  browserPodKey?: string;
}
let window: BrowserWindow | null = null;
let bridge: Bridge | null = null;
let codex: CodexClient;
let settings: DesktopSettings;
let operator: OperatorConfig = {};
let updates = new DesktopUpdates({ updater: null, native: null });
let quitting = false;
let shutdownComplete = false;

// One stable application identity and storage root for development, installed versions and updates.
app.setName('den-kit');
// Explicit local override for isolated acceptance checks, including packaged builds.
if (process.env.KIT_DESKTOP_USER_DATA)
  app.setPath('userData', resolve(process.env.KIT_DESKTOP_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(start)
    .catch(error => {
      dialog.showErrorBox(
        'den-kit could not start',
        /EADDRINUSE/.test(String(error))
          ? 'den-kit could not start because a local service is already in use. Close other copies of den-kit and try again. If the problem continues, restart your computer.'
          : 'den-kit could not start. Try opening it again. If the problem continues, report it to the app maintainer.',
      );
      app.quit();
    });
}

function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    new URL(event.senderFrame.url).origin !== APP_ORIGIN
  )
    throw new Error('This operation is only available to the den-kit window.');
}
function info(): DesktopInfo {
  return {
    version: app.getVersion(),
    settings: { ...settings },
    codex: codex.status,
    aiBusy: codex.busy,
    chatGPTSignedIn: codex.chatGPTSignedIn,
    models: codex.models.map(m => ({
      id: m.id,
      name: m.displayName,
      isDefault: m.isDefault,
      efforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort).filter(e => e !== 'ultra'),
    })),
    podConfigured: !!operator.browserPodKey,
    login: codex.login.state,
    loginError: codex.login.error,
    update: updates.status,
  };
}

/** Updates install only into a writable app outside the disk image; offer the move before anything is running. */
async function offerMoveToApplications(): Promise<'moved' | 'declined' | 'not-needed'> {
  if (
    !app.isPackaged ||
    process.platform !== 'darwin' ||
    process.env.KIT_DESKTOP_USER_DATA ||
    app.isInApplicationsFolder()
  )
    return 'not-needed';
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move den-kit to your Applications folder?',
    detail:
      'den-kit can install updates only when it is in the Applications folder. Your work is not affected.',
  });
  if (response !== 0) return 'declined';
  try {
    return app.moveToApplicationsFolder() ? 'moved' : 'declined';
  } catch {
    dialog.showErrorBox(
      'den-kit could not be moved',
      'Drag den-kit into the Applications folder in Finder, then open it from there.',
    );
    return 'declined';
  }
}

function setupUpdates(): DesktopUpdates {
  if (!app.isPackaged || process.platform !== 'darwin')
    return new DesktopUpdates({ updater: null, native: null });
  const isolated = !!process.env.KIT_DESKTOP_USER_DATA;
  // Isolated update checks may point at a local feed; they never touch the published releases.
  const feed = isolated ? process.env.KIT_DESKTOP_UPDATE_URL : undefined;
  if (isolated && !feed) return new DesktopUpdates({ updater: null, native: null });
  if (!isolated && !app.isInApplicationsFolder())
    return new DesktopUpdates({ updater: null, native: null, disabled: 'move' });
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  return new DesktopUpdates({
    updater: autoUpdater,
    native: squirrel,
    relaunch: !isolated,
    firstCheckMs: isolated ? 1000 : undefined,
    onChange: status => {
      if (window && !window.isDestroyed()) window.webContents.send('den-kit:update', status);
    },
  });
}

/** Saves the work while the renderer is alive, then closes Codex and the local listener. */
async function shutdown() {
  let podFlushError: unknown;
  if (window && !window.isDestroyed()) {
    // The page saves the work and flushes the pod (desktop/page/main.ts).
    await window.webContents.executeJavaScript('window.__denKitBeforeQuit?.()').catch(error => {
      podFlushError = error;
    });
    await window.webContents.session.flushStorageData();
  }
  await bridge?.close();
  if (podFlushError) throw podFlushError;
}

async function installUpdate() {
  if (codex.busy) throw new Error('Finish the current AI request before restarting.');
  if (quitting) throw new Error('den-kit is already closing.');
  await updates.install(async () => {
    quitting = true;
    try {
      await shutdown();
    } catch (error) {
      app.exit(1);
      throw error;
    } // Same outcome as a failed normal quit.
    // Let quitAndInstall close the window and quit without running the shutdown again.
    shutdownComplete = true;
    updates.dispose();
  });
}

async function start() {
  const root = app.getAppPath();
  const resources = app.isPackaged ? process.resourcesPath : resolve(root, '../resources');
  const icon = nativeImage.createFromPath(join(resources, 'icon.png'));
  app.dock?.setIcon(icon);
  app.setAboutPanelOptions({
    applicationName: 'den-kit',
    applicationVersion: app.getVersion(),
    iconPath: join(resources, 'icon.png'),
  });
  if ((await offerMoveToApplications()) === 'moved') return; // The moved copy relaunches itself.
  updates = setupUpdates();
  const data = app.getPath('userData');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  settings = readSettings(data);
  try {
    operator = JSON.parse(readFileSync(join(resources, 'operator.json'), 'utf8'));
  } catch {
    /* build reports missing operator configuration */
  }
  const home = join(data, 'codex');
  const cwd = join(data, 'codex-work');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  codex = new CodexClient({
    kitRoot: root,
    home: { path: home, isolated: true },
    workdir: cwd,
    // Packaged apps carry the CLI for their own architecture; an unpackaged staging run picks the host's.
    command: {
      command: join(
        app.isPackaged ? join(resources, 'codex') : resolve(root, '../codex', process.arch),
        'bin',
        process.platform === 'win32' ? 'codex.exe' : 'codex',
      ),
      args: [],
      source: 'kit',
      version: CODEX_VERSION,
    },
    model: settings.model || undefined,
    effort: settings.effort || undefined,
    fork: settings.fork,
    loginInstruction: 'Open Settings and choose Sign in with ChatGPT.',
  });
  bridge = await createBridge({
    port: APP_PORT,
    origins: [APP_ORIGIN],
    codex,
    // Serve the production renderer, not Vite. The loopback bridge is local to this machine.
    handleHttp: rendererServer(join(root, 'renderer')),
  });

  ipcMain.on('den-kit:runtime', event => {
    try {
      trusted(event);
      event.returnValue = { token: bridge!.token, apiKey: operator.browserPodKey ?? null };
    } catch {
      event.returnValue = null;
    }
  });
  const handle = (name: string, action: (arg: unknown) => unknown) =>
    ipcMain.handle(name, (event, arg) => {
      trusted(event);
      return action(arg);
    });
  handle('den-kit:info', () => info());
  handle('den-kit:settings', async value => {
    const next = validatedSettings(value);
    if (next.model && !codex.models.some(m => m.id === next.model || m.model === next.model))
      throw new Error('Select a model from the available list.');
    const model = next.model
      ? codex.models.find(m => m.id === next.model || m.model === next.model)
      : codex.models.find(m => m.isDefault);
    if (
      next.effort &&
      model &&
      !model.supportedReasoningEfforts.some(e => e.reasoningEffort === next.effort)
    )
      throw new Error('This model does not support that reasoning effort.');
    if (codex.busy) throw new Error('Finish the current AI request before changing settings.');
    if (signInPending(codex.login.state))
      throw new Error('Complete or cancel ChatGPT sign-in before changing settings.');
    writeSettings(data, next);
    settings = next;
    await codex.configure(next);
    return info();
  });
  handle('den-kit:sign-in', () => openChatGPTSignIn(codex, url => shell.openExternal(url)));
  handle('den-kit:cancel-sign-in', () => codex.cancelSignIn());
  handle('den-kit:sign-out', () => codex.signOut());
  handle('den-kit:reconnect-ai', async () => {
    if (codex.busy) throw new Error('Finish the current AI request before reconnecting.');
    if (signInPending(codex.login.state))
      throw new Error('Complete or cancel ChatGPT sign-in before reconnecting.');
    await codex.retry();
    return info();
  });
  handle('den-kit:usage', () => shell.openExternal('https://chatgpt.com/codex/settings/usage'));
  handle('den-kit:check-updates', async () => {
    await updates.check();
    return info();
  });
  handle('den-kit:install-update', () => installUpdate());
  handle('den-kit:capture', async value => {
    const rect = value as PageRect;
    if (
      !rect ||
      !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k as keyof PageRect]))
    )
      throw new Error('Invalid picture area.');
    const bounds = window!.getContentBounds();
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width < 1 ||
      rect.height < 1 ||
      rect.width > bounds.width ||
      rect.height > bounds.height ||
      rect.x + rect.width > bounds.width + 1 ||
      rect.y + rect.height > bounds.height + 1
    )
      throw new Error('Picture area is outside den-kit.');
    return (
      await window!.webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    ).toDataURL();
  });

  const ses = session.defaultSession;
  ses.setPermissionCheckHandler(
    (wc, name, origin, details) =>
      wc === window?.webContents && allowedPermission(origin, name, details.isMainFrame),
  );
  ses.setPermissionRequestHandler((wc, name, callback, details) =>
    callback(
      wc === window?.webContents &&
        allowedPermission(details.requestingUrl, name, details.isMainFrame),
    ),
  );
  ses.on('will-download', (_event, item, wc) => {
    if (wc !== window?.webContents) {
      item.cancel();
      return;
    }
    item.setSaveDialogOptions({
      title: 'Export den-kit work',
      defaultPath: join(app.getPath('documents'), item.getFilename()),
    });
  });

  window = new BrowserWindow({
    title: 'den-kit',
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#11151b',
    webPreferences: {
      preload: join(root, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--den-kit-origin=${APP_ORIGIN}`],
      webSecurity: true,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  window.once('ready-to-show', () => window?.show());
  // Save before macOS destroys the renderer when the person closes the window.
  window.on('close', event => {
    if (!shutdownComplete) {
      event.preventDefault();
      if (!quitting) app.quit();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'den-kit',
        submenu: [
          { role: 'about' },
          ...(updates.enabled
            ? [
                {
                  label: 'Check for Updates…',
                  click: () => {
                    window?.webContents.send('den-kit:open-settings');
                    void updates.check();
                  },
                },
              ]
            : []),
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => window?.webContents.send('den-kit:open-settings'),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      app.isPackaged
        ? { label: 'View', submenu: [{ role: 'togglefullscreen' }] }
        : { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  await window.loadURL(APP_ORIGIN);
  void codex.start();
  updates.start();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (shutdownComplete || !bridge) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // A downloaded update is installed by Squirrel.Mac once the app has quit.
  void shutdown()
    .then(() => {
      shutdownComplete = true;
      updates.dispose();
      app.quit();
    })
    .catch(() => app.exit(1));
});

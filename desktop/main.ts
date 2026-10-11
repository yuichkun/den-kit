import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, session, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CodexClient } from '../bridge/codex/client.ts';
import { CODEX_VERSION } from '../bridge/codex/protocol.ts';
import { createBridge, type Bridge } from '../bridge/server.ts';
import type { DesktopInfo, DesktopSettings } from '../src/desktop/api.ts';
import type { PageRect } from '../src/editor/screen-share.ts';
import { APP_ORIGIN, APP_PORT, rendererServer } from './renderer-server.ts';
import { readSettings, validatedSettings, writeSettings } from './settings.ts';
import { allowedPermission } from './permissions.ts';

interface OperatorConfig { browserPodKey?: string }
let window: BrowserWindow | null = null;
let bridge: Bridge | null = null;
let codex: CodexClient;
let settings: DesktopSettings;
let operator: OperatorConfig = {};
let quitting = false;
let shutdownComplete = false;

// One stable application identity and storage root for development, installed versions and updates.
app.setName('den-kit');
// Explicit local override for isolated acceptance checks, including packaged builds.
if (process.env.KIT_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.KIT_DESKTOP_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  void app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('den-kit could not start', /EADDRINUSE/.test(String(error))
      ? 'den-kit could not start because a local service is already in use. Close other copies of den-kit and try again. If the problem continues, restart your computer.'
      : 'den-kit could not start. Try opening it again. If the problem continues, report it to the app maintainer.');
    app.quit();
  });
}

function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== APP_ORIGIN) throw new Error('This operation is only available to the den-kit window.');
}
function info(): DesktopInfo {
  return {
    version: app.getVersion(), settings: { ...settings }, codex: codex.status, aiBusy: codex.busy, chatGPTSignedIn: codex.chatGPTSignedIn,
    models: codex.models.map(m => ({ id: m.id, name: m.displayName, isDefault: m.isDefault, efforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort).filter(e => e !== 'ultra') })),
    podConfigured: !!operator.browserPodKey, login: codex.login.state, loginError: codex.login.error,
  };
}

async function start() {
  const root = app.getAppPath();
  const resources = app.isPackaged ? process.resourcesPath : resolve(root, '../resources');
  const icon = nativeImage.createFromPath(join(resources, 'icon.png'));
  app.dock?.setIcon(icon);
  app.setAboutPanelOptions({ applicationName: 'den-kit', applicationVersion: app.getVersion(), iconPath: join(resources, 'icon.png') });
  const data = app.getPath('userData');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  settings = readSettings(data);
  try { operator = JSON.parse(readFileSync(join(resources, 'operator.json'), 'utf8')); } catch { /* build reports missing operator configuration */ }
  const home = join(data, 'codex');
  const cwd = join(data, 'codex-work');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  codex = new CodexClient({
    kitRoot: root, home: { path: home, isolated: true }, workdir: cwd,
    command: { command: join(resources, 'codex', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'), args: [], source: 'kit', version: CODEX_VERSION },
    model: settings.model || undefined, effort: settings.effort || undefined, fork: settings.fork,
    loginInstruction: 'Open Settings and choose Sign in with ChatGPT.',
  });
  bridge = await createBridge({
    port: APP_PORT, origins: [APP_ORIGIN], codex,
    // Serve the production renderer, not Vite. The loopback bridge is local to this machine.
    handleHttp: rendererServer(join(root, 'renderer')),
  });

  ipcMain.on('den-kit:runtime', event => {
    try { trusted(event); event.returnValue = { token: bridge!.token, apiKey: operator.browserPodKey ?? null }; }
    catch { event.returnValue = null; }
  });
  const handle = (name: string, action: (arg: unknown) => unknown) => ipcMain.handle(name, (event, arg) => { trusted(event); return action(arg); });
  handle('den-kit:info', () => info());
  handle('den-kit:settings', async value => {
    const next = validatedSettings(value);
    if (next.model && !codex.models.some(m => m.id === next.model || m.model === next.model)) throw new Error('Select a model from the available list.');
    const model = next.model ? codex.models.find(m => m.id === next.model || m.model === next.model) : codex.models.find(m => m.isDefault);
    if (next.effort && model && !model.supportedReasoningEfforts.some(e => e.reasoningEffort === next.effort)) throw new Error('This model does not support that reasoning effort.');
    if (codex.busy) throw new Error('Finish the current AI request before changing settings.');
    if (codex.login.state === 'waiting') throw new Error('Complete or cancel ChatGPT sign-in before changing settings.');
    writeSettings(data, next);
    settings = next;
    await codex.configure(next);
    return info();
  });
  handle('den-kit:sign-in', async () => {
    const url = await codex.signIn();
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'auth.openai.com') { await codex.cancelSignIn(); throw new Error('Unexpected ChatGPT sign-in address.'); }
    await shell.openExternal(url);
  });
  handle('den-kit:cancel-sign-in', () => codex.cancelSignIn());
  handle('den-kit:sign-out', () => codex.signOut());
  handle('den-kit:reconnect-ai', async () => {
    if (codex.busy) throw new Error('Finish the current AI request before reconnecting.');
    if (codex.login.state === 'waiting') throw new Error('Complete or cancel ChatGPT sign-in before reconnecting.');
    await codex.retry();
    return info();
  });
  handle('den-kit:usage', () => shell.openExternal('https://chatgpt.com/codex/settings/usage'));
  handle('den-kit:capture', async value => {
    const rect = value as PageRect;
    if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k as keyof PageRect]))) throw new Error('Invalid picture area.');
    const bounds = window!.getContentBounds();
    if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.width > bounds.width || rect.height > bounds.height || rect.x + rect.width > bounds.width + 1 || rect.y + rect.height > bounds.height + 1) throw new Error('Picture area is outside den-kit.');
    return (await window!.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })).toDataURL();
  });

  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((wc, name, origin, details) => wc === window?.webContents && allowedPermission(origin, name, details.isMainFrame));
  ses.setPermissionRequestHandler((wc, name, callback, details) => callback(wc === window?.webContents && allowedPermission(details.requestingUrl, name, details.isMainFrame)));
  ses.on('will-download', (_event, item, wc) => {
    if (wc !== window?.webContents) { item.cancel(); return; }
    item.setSaveDialogOptions({ title: 'Export den-kit work', defaultPath: join(app.getPath('documents'), item.getFilename()) });
  });

  window = new BrowserWindow({
    title: 'den-kit', width: 1440, height: 960, minWidth: 1000, minHeight: 700, show: false,
    backgroundColor: '#11151b',
    webPreferences: {
      preload: join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true,
      additionalArguments: [`--den-kit-origin=${APP_ORIGIN}`],
      webSecurity: true, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== APP_ORIGIN) event.preventDefault(); });
  window.once('ready-to-show', () => window?.show());
  // Save before macOS destroys the renderer when the person closes the window.
  window.on('close', event => { if (!shutdownComplete) { event.preventDefault(); if (!quitting) app.quit(); } });
  window.on('closed', () => { window = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'den-kit', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => window?.webContents.send('den-kit:open-settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    app.isPackaged ? { label: 'View', submenu: [{ role: 'togglefullscreen' }] } : { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  await window.loadURL(APP_ORIGIN);
  void codex.start();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (shutdownComplete || !bridge) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // Capture/save state while the renderer is still alive, then close Codex and the local listener.
  void (async () => {
    let podFlushError: unknown;
    if (window && !window.isDestroyed()) {
      await window.webContents.executeJavaScript('window.__kit?.saveNow()').catch(() => undefined);
      await window.webContents.executeJavaScript('window.__kit?.pod?.flush()').catch(error => { podFlushError = error; });
      await window.webContents.session.flushStorageData();
    }
    await bridge?.close();
    if (podFlushError) throw podFlushError;
    shutdownComplete = true;
    app.quit();
  })().catch(() => app.exit(1));
});

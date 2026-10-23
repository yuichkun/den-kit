import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, DesktopRuntime } from './page/api.ts';

// Only the app's top-level page receives the API; code-part iframes receive no Node/IPC powers.
const originArgument = process.argv
  .find(arg => arg.startsWith('--den-kit-origin='))
  ?.slice('--den-kit-origin='.length);
const expectedOrigin =
  originArgument && /^http:\/\/127\.0\.0\.1:\d+$/.test(originArgument)
    ? originArgument
    : 'http://127.0.0.1:5247';
if (process.isMainFrame && location.origin === expectedOrigin) {
  const api: DesktopAPI = {
    runtime: ipcRenderer.sendSync('den-kit:runtime') as DesktopRuntime,
    capturePage: rect => ipcRenderer.invoke('den-kit:capture', rect),
    info: () => ipcRenderer.invoke('den-kit:info'),
    saveSettings: settings => ipcRenderer.invoke('den-kit:settings', settings),
    signIn: () => ipcRenderer.invoke('den-kit:sign-in'),
    cancelSignIn: () => ipcRenderer.invoke('den-kit:cancel-sign-in'),
    signOut: () => ipcRenderer.invoke('den-kit:sign-out'),
    reconnectAI: () => ipcRenderer.invoke('den-kit:reconnect-ai'),
    openUsage: () => ipcRenderer.invoke('den-kit:usage'),
    checkForUpdates: () => ipcRenderer.invoke('den-kit:check-updates'),
    installUpdate: () => ipcRenderer.invoke('den-kit:install-update'),
  };
  contextBridge.exposeInMainWorld('denKitShell', api);
  ipcRenderer.on('den-kit:open-settings', () =>
    window.dispatchEvent(new Event('den-kit:show-settings')),
  );
  // The page reads the new state through info(); event details do not cross the isolated world.
  ipcRenderer.on('den-kit:update', () => window.dispatchEvent(new Event('den-kit:update')));
}

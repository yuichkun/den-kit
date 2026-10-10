import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, DesktopRuntime } from '../src/desktop/api.ts';

// Only the app's top-level page receives the API; code-part iframes receive no Node/IPC powers.
if (process.isMainFrame && location.origin === 'http://127.0.0.1:5247') {
  const api: DesktopAPI = {
    runtime: ipcRenderer.sendSync('den-kit:runtime') as DesktopRuntime,
    capturePage: rect => ipcRenderer.invoke('den-kit:capture', rect),
    info: () => ipcRenderer.invoke('den-kit:info'),
    saveSettings: settings => ipcRenderer.invoke('den-kit:settings', settings),
    signIn: () => ipcRenderer.invoke('den-kit:sign-in'),
    cancelSignIn: () => ipcRenderer.invoke('den-kit:cancel-sign-in'),
    signOut: () => ipcRenderer.invoke('den-kit:sign-out'),
    openUsage: () => ipcRenderer.invoke('den-kit:usage'),
  };
  contextBridge.exposeInMainWorld('denKitShell', api);
  ipcRenderer.on('den-kit:open-settings', () => window.dispatchEvent(new Event('den-kit:open-settings')));
}

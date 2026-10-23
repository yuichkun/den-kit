// The preload bridge between the desktop app's main process and its page
// (desktop/preload.ts): what the page may ask the main process for.
import type { PageRect, UpdateStatus } from '../../src/host/index.ts';
import type { AIModel, AISettings, CodexStatus } from '../../src/host/ai.ts';

export type { UpdateStatus };
export type DesktopSettings = AISettings;
export type DesktopModel = AIModel;
export interface DesktopInfo {
  version: string;
  settings: DesktopSettings;
  models: DesktopModel[];
  codex: CodexStatus;
  aiBusy: boolean;
  chatGPTSignedIn: boolean;
  podConfigured: boolean;
  login: 'idle' | 'starting' | 'waiting' | 'checking' | 'canceling' | 'complete' | 'error';
  loginError?: string;
  update: UpdateStatus;
}
export interface DesktopRuntime {
  token: string;
  apiKey: string | null;
}
export interface DesktopAPI {
  runtime: DesktopRuntime;
  capturePage(rect: PageRect): Promise<string>;
  info(): Promise<DesktopInfo>;
  saveSettings(settings: DesktopSettings): Promise<DesktopInfo>;
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  reconnectAI(): Promise<DesktopInfo>;
  openUsage(): Promise<void>;
  checkForUpdates(): Promise<DesktopInfo>;
  /** Saves the work, then quits and installs the downloaded update. */
  installUpdate(): Promise<void>;
}

declare global {
  interface Window {
    denKitShell?: DesktopAPI;
  }
}
export const desktop = (): DesktopAPI | null =>
  typeof window === 'undefined' ? null : (window.denKitShell ?? null);

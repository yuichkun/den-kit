import type { CodexStatus } from '../ai/protocol.ts';
import type { PageRect } from '../editor/screen-share.ts';

export interface DesktopSettings { model: string; effort: string; fork: boolean }
export interface DesktopModel { id: string; name: string; isDefault: boolean; efforts: string[] }
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
}
export interface DesktopRuntime { token: string; apiKey: string | null }
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
}

declare global { interface Window { denKitShell?: DesktopAPI } }
export const desktop = (): DesktopAPI | null => typeof window === 'undefined' ? null : window.denKitShell ?? null;

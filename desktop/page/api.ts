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
  /** The host's storage in the app's data folder (desktop/storage.ts). */
  storage(request: StorageRequest): Promise<unknown>;
  /** A file from a public URL (desktop/fetch.ts). */
  fetch(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string; url: string }>;
  /** Open or close a work's sandbox origin (desktop/sandbox.ts). */
  sandbox(request: SandboxRequest): Promise<void>;
  /** A work's code part tried to reach something it may not. */
  onSandboxRefused(
    listener: (refusal: { work: string; blocked: string; directive: string }) => void,
  ): () => void;
}
export type StorageRequest =
  | { op: 'read' | 'remove'; key: string }
  | { op: 'write'; key: string; value: string }
  | { op: 'keys'; prefix: string }
  | { op: 'readContent'; hash: string }
  | { op: 'writeContent'; hash: string; bytes: Uint8Array };
export type SandboxRequest =
  | {
      op: 'open';
      work: string;
      settings: {
        portal: string | null;
        origins: string[];
        devices: string[];
        files: Record<string, { hash: string; type: string }>;
      };
    }
  | { op: 'close'; work: string };

declare global {
  interface Window {
    denKitShell?: DesktopAPI;
  }
}
export const desktop = (): DesktopAPI | null =>
  typeof window === 'undefined' ? null : (window.denKitShell ?? null);

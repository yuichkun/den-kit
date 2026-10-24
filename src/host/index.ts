// What a host provides to den-kit (docs/architecture.md, "Interfaces"). Types
// only: den-kit's modules use a Host and never ask which host they run in
// (docs/principles.md, principle 4). A feature some hosts lack is a null here,
// never a check for a host. Each host implements these outside src/.
import type { AI } from './ai.ts';
import type { PodFactory } from './workspace.ts';

export type * from './ai.ts';
export type * from './workspace.ts';

export interface Host {
  /** Work records, which conversation belongs to which work, and settings. */
  storage: Storage;
  /** The AI, or null when this host offers none. */
  ai: AI | null;
  /** The person's account apart from AI sign-in, or null when the host has no accounts. */
  account: Account | null;
  /** The pod the work's files run in; its `kind` is null when the host provides none. */
  workspace: PodFactory;
  /** Where code parts are served from, or null when this host cannot isolate them. */
  sandbox: Sandbox | null;
  /** Files from URLs for asset import, or null when the host cannot fetch them. */
  fetch: Fetch | null;
  /** Pictures of den-kit as the person sees it, or null when the host cannot take them. */
  screenCapture: ScreenCapture | null;
  /** Asking for and keeping the person's consent to analytics, or null when nothing is sent. */
  consent: Consent | null;
  /** Updates, quitting and restarting, or null when the host does not manage them. */
  lifecycle: Lifecycle | null;
}

/** Text records by key (keys are den-kit's own), and the contents of work files by hash. */
export interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** The keys that start with `prefix`. */
  keys(prefix: string): Promise<string[]>;
  /** Contents of a work's files, by their SHA-256 (sha256-…); null when not kept here. */
  readContent(hash: string): Promise<Uint8Array | null>;
  writeContent(hash: string, bytes: Uint8Array): Promise<void>;
}

export interface Account {
  /** Signed in or not, and what is available to the person. */
  state(): Promise<{ signedIn: boolean; features: string[] }>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

/** What a work's code parts may use, as the person allowed it for that work (kept in the host's settings, never in the work). */
export interface Allowed {
  /** Origins they may connect to (https://api.example.com). */
  origins: string[];
  /** Devices they may use. */
  devices: Device[];
}
export type Device = 'microphone' | 'camera' | 'midi';

/**
 * An origin for each work, apart from den-kit's, that serves its code parts and the files they read, keeps their
 * frames from navigating away, and lets through only the origins and devices the person allowed for the work.
 */
export interface Sandbox {
  /**
   * Serve a work: its code parts from `devServer` (the workspace's, while it runs), or else from `build`
   * (the code parts as last built), and its files by path. `files` and `build` name contents in the host's storage.
   * Settles once the host serves these settings; until then it serves what it was told before.
   */
  open(
    work: string,
    settings: Allowed & {
      devServer: string | null;
      files: Record<string, { hash: string; type: string }>;
      build: Record<string, { hash: string; type: string }>;
    },
  ): Promise<void>;
  close(work: string): void;
  /** The work's own origin, where its frames load from. */
  origin(work: string): string;
  /** Whether it serves contents from the host's storage (`files` and `build`), or only the dev server. */
  readonly servesContents: boolean;
  /** Where a work's file is served under its origin, or null when this host serves none. */
  fileUrl(work: string, path: string): string | null;
  /** A work's code part tried to reach something it may not. */
  onRefused(
    listener: (refusal: { work: string; blocked: string; directive: string }) => void,
  ): () => void;
}

export interface Fetch {
  /** A file from a public address, up to `maxBytes`; refused for private addresses, redirects included. */
  get(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string; url: string }>;
}

/** A part of den-kit's page, in CSS pixels. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A picture of the page: JPEG (screens are photos to compress, and a tool result carries at most 2 MB). */
export interface Picture {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  source: 'tab' | 'shell';
}
export type ShareRefusal = { state: 'unsupported' | 'refused' | 'error'; message: string };
export interface ScreenCapture {
  /** Where pictures come from: a shared browser tab, or the app's own window. */
  readonly source: 'tab' | 'shell';
  /** Whether pictures can be taken at all; a message says why not. */
  readonly unsupported: string | null;
  /** What den-kit says while the host asks the person to share; null when it does not ask. */
  readonly asking: string | null;
  /** What the share button says: off, it offers sharing; on, it says what the AI sees. */
  title(on: boolean): string;
  /** Start sharing after the person's click; the host may ask the person first. */
  start(): Promise<true | ShareRefusal>;
  stop(): void;
  /**
   * A picture of a part of the page, at most `maxSide` pixels on its long side.
   * `wanted` turns false when sharing stopped: the host stops preparing it and throws.
   */
  picture(rect: PageRect, maxSide: number, wanted: () => boolean): Promise<Picture>;
  /** Sharing ended from outside den-kit (the browser's own Stop sharing). */
  onEnded(listener: () => void): () => void;
}

export interface Consent {
  /** null until the person has chosen. */
  state(): Promise<boolean | null>;
  set(allowed: boolean): Promise<void>;
}

/** In-app updates. `off` where the host does not update itself; `move` when the app runs where it cannot update. */
export type UpdateStatus =
  | { state: 'off' | 'move' | 'idle' | 'checking' | 'current' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'preparing' | 'ready'; version: string }
  | { state: 'error'; message: string };

export interface Lifecycle {
  info(): Promise<{ version: string; update: UpdateStatus }>;
  checkForUpdates(): Promise<{ version: string; update: UpdateStatus }>;
  /** Runs the beforeQuit tasks, then quits and installs the downloaded update. */
  installUpdate(): Promise<void>;
  onUpdate(listener: () => void): () => void;
  /** The host asks den-kit to show its settings (an app menu item). */
  onShowSettings(listener: () => void): () => void;
  /** Work to finish before the host quits or restarts, such as saving. */
  beforeQuit(task: () => Promise<void>): () => void;
}

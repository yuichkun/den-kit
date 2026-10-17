import type { UpdateStatus } from '../src/desktop/api.ts';

/** The part of electron-updater's AppUpdater that den-kit uses. */
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (value?: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}
/** Electron's Squirrel.Mac updater. electron-updater reports a download before Squirrel has staged it. */
export interface NativeUpdaterLike { on(event: 'update-downloaded', listener: () => void): unknown }
type Timer = ReturnType<typeof setTimeout>;
interface Timers { after(ms: number, run: () => void): Timer; every(ms: number, run: () => void): Timer; clear(timer: Timer): void }
const SYSTEM_TIMERS: Timers = { after: (ms, run) => setTimeout(run, ms), every: (ms, run) => setInterval(run, ms), clear: timer => clearTimeout(timer) };
export interface UpdatesOptions {
  updater: AppUpdaterLike | null;
  native: NativeUpdaterLike | null;
  /** `move` when updates need the app in the Applications folder, `off` when updates are not used. */
  disabled?: 'off' | 'move';
  /** Whether Restart now reopens den-kit after installing. Isolated checks pass false so it never opens outside their profile. */
  relaunch?: boolean;
  onChange?: (status: UpdateStatus) => void;
  firstCheckMs?: number;
  intervalMs?: number;
  timers?: Timers;
}

export const UPDATE_CHECK_FAILED = 'den-kit could not check for updates. It will try again later.';
export const UPDATE_DOWNLOAD_FAILED = 'The update could not be downloaded. den-kit will try again later.';

const versionOf = (value: unknown) => typeof (value as { version?: unknown })?.version === 'string' ? (value as { version: string }).version : '';

/** Downloads updates in the background, installs them on a normal quit, and offers an explicit restart. */
export class DesktopUpdates {
  #status: UpdateStatus;
  readonly #options: UpdatesOptions;
  #timers: Timer[] = [];
  #checking: Promise<void> | null = null;

  constructor(options: UpdatesOptions) {
    this.#options = options;
    this.#status = { state: options.disabled ?? (options.updater && options.native ? 'idle' : 'off') };
  }

  get status(): UpdateStatus { return this.#status; }
  get enabled() { return !!this.#updater && !!this.#options.native && !this.#options.disabled; }
  get #updater() { return this.#options.updater; }

  start() {
    const updater = this.#updater;
    if (!this.enabled || !updater) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // Read only by quitAndInstall (Restart now). An ordinary quit installs the staged update without reopening den-kit.
    updater.autoRunAppAfterInstall = this.#options.relaunch ?? true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.#set({ state: 'checking' }));
    updater.on('update-not-available', () => this.#set({ state: 'current' }));
    updater.on('update-available', info => this.#set({ state: 'downloading', version: versionOf(info), percent: 0 }));
    updater.on('download-progress', progress => {
      if (this.#status.state !== 'downloading') return;
      const percent = Number((progress as { percent?: unknown })?.percent);
      this.#set({ ...this.#status, percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.floor(percent))) : this.#status.percent });
    });
    updater.on('update-downloaded', info => this.#set({ state: 'preparing', version: versionOf(info) || this.#version() }));
    // Restarting is only safe once Squirrel.Mac has staged the update; until then quitAndInstall waits indefinitely.
    this.#options.native!.on('update-downloaded', () => { if (this.#status.state !== 'ready') this.#set({ state: 'ready', version: this.#version() }); });
    updater.on('error', error => this.#failed(error));
    const timers = this.#options.timers ?? SYSTEM_TIMERS;
    this.#timers.push(timers.after(this.#options.firstCheckMs ?? 15_000, () => void this.check()));
    this.#timers.push(timers.every(this.#options.intervalMs ?? 6 * 60 * 60_000, () => void this.check()));
  }

  /** Checks once; a download in progress or a staged update is left alone. */
  async check(): Promise<UpdateStatus> {
    const updater = this.#updater;
    if (!this.enabled || !updater || ['downloading', 'preparing', 'ready'].includes(this.#status.state)) return this.#status;
    this.#checking ??= (async () => {
      this.#set({ state: 'checking' });
      try { await updater.checkForUpdates(); }
      catch (error) { this.#failed(error); }
      finally { this.#checking = null; }
    })();
    await this.#checking;
    return this.#status;
  }

  /** Quits and installs the staged update. `prepare` saves the work first; quitting must be allowed afterwards. */
  async install(prepare: () => Promise<void>) {
    if (this.#status.state !== 'ready' || !this.#updater) throw new Error('The update is not ready to install yet.');
    await prepare();
    this.#updater.quitAndInstall();
  }

  dispose() {
    const timers = this.#options.timers ?? SYSTEM_TIMERS;
    for (const timer of this.#timers.splice(0)) timers.clear(timer);
  }

  #version() { return 'version' in this.#status ? this.#status.version : ''; }

  #failed(error: unknown) {
    if (this.#status.state === 'ready') return; // A staged update still installs on quit.
    const text = error instanceof Error ? error.message : String(error);
    if (/read-only volume/i.test(text)) { this.#set({ state: 'move' }); return; }
    this.#set({ state: 'error', message: ['downloading', 'preparing'].includes(this.#status.state) ? UPDATE_DOWNLOAD_FAILED : UPDATE_CHECK_FAILED });
  }

  #set(status: UpdateStatus) {
    this.#status = status;
    this.#options.onChange?.(status);
  }
}

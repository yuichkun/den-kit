import { describe, expect, it, vi } from 'vite-plus/test';
import {
  DesktopUpdates,
  UPDATE_CHECK_FAILED,
  UPDATE_DOWNLOAD_FAILED,
  type AppUpdaterLike,
} from '../../../desktop/updates.ts';
import type { UpdateStatus } from '../../../src/desktop/api.ts';

function fakes() {
  const handlers = new Map<string, (value?: unknown) => void>();
  const native = new Map<string, () => void>();
  const updater: AppUpdaterLike & { emit(event: string, value?: unknown): void } = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowPrerelease: true,
    allowDowngrade: true,
    on(event, listener) {
      handlers.set(event, listener);
      return this;
    },
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    emit(event, value) {
      handlers.get(event)?.(value);
    },
  };
  const scheduled: { ms: number; repeat: boolean; run: () => void }[] = [];
  const timers = {
    after: (ms: number, run: () => void) => {
      scheduled.push({ ms, repeat: false, run });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    every: (ms: number, run: () => void) => {
      scheduled.push({ ms, repeat: true, run });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    clear: vi.fn(),
  };
  const changes: UpdateStatus[] = [];
  const updates = new DesktopUpdates({
    updater,
    native: { on: (event, listener) => native.set(event, listener) },
    timers,
    onChange: status => changes.push(status),
  });
  return {
    updater,
    updates,
    scheduled,
    timers,
    changes,
    staged: () => native.get('update-downloaded')!(),
  };
}

describe('desktop updates', () => {
  it('downloads in the background, installs on quit and checks on a schedule', () => {
    const { updater, updates, scheduled } = fakes();
    updates.start();
    expect(updater).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      autoRunAppAfterInstall: true,
      allowPrerelease: false,
      allowDowngrade: false,
    });
    expect(scheduled.map(({ ms, repeat }) => ({ ms, repeat }))).toEqual([
      { ms: 15_000, repeat: false },
      { ms: 6 * 60 * 60_000, repeat: true },
    ]);
    scheduled[0]!.run();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('offers a restart only after Squirrel has staged the downloaded update', async () => {
    const { updater, updates, changes, staged } = fakes();
    updates.start();
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('download-progress', { percent: 41.7 });
    expect(updates.status).toEqual({ state: 'downloading', version: '0.2.0', percent: 41 });
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(updates.status).toEqual({ state: 'preparing', version: '0.2.0' });
    await expect(updates.install(async () => undefined)).rejects.toThrow('not ready');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    staged();
    expect(updates.status).toEqual({ state: 'ready', version: '0.2.0' });
    expect(changes.at(-1)).toEqual({ state: 'ready', version: '0.2.0' });
  });

  it('saves the work before quitting to install and keeps a staged update through later errors', async () => {
    const { updater, updates, staged } = fakes();
    updates.start();
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('update-downloaded', { version: '0.2.0' });
    staged();
    updater.emit('error', new Error('network down'));
    expect(updates.status.state).toBe('ready');
    const order: string[] = [];
    (updater.quitAndInstall as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push('install'),
    );
    await updates.install(async () => {
      order.push('save');
    });
    expect(order).toEqual(['save', 'install']);
  });

  it('does not install when saving the work fails', async () => {
    const { updater, updates, staged } = fakes();
    updates.start();
    updater.emit('update-available', { version: '0.2.0' });
    staged();
    await expect(
      updates.install(async () => {
        throw new Error('flush failed');
      }),
    ).rejects.toThrow('flush failed');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('reports check and download failures in plain words and recovers on the next check', async () => {
    const { updater, updates } = fakes();
    updates.start();
    (updater.checkForUpdates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.github.com'),
    );
    expect(await updates.check()).toEqual({ state: 'error', message: UPDATE_CHECK_FAILED });
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('error', new Error('sha512 checksum mismatch'));
    expect(updates.status).toEqual({ state: 'error', message: UPDATE_DOWNLOAD_FAILED });
    updater.emit('update-not-available');
    expect(updates.status).toEqual({ state: 'current' });
  });

  it('asks for the Applications folder when Squirrel refuses a read-only location', () => {
    const { updater, updates } = fakes();
    updates.start();
    updater.emit('error', new Error('Cannot update while running on a read-only volume.'));
    expect(updates.status).toEqual({ state: 'move' });
  });

  it('leaves a download in progress alone and shares one check between callers', async () => {
    const { updater, updates } = fakes();
    updates.start();
    let finish!: () => void;
    (updater.checkForUpdates as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const first = updates.check();
    const second = updates.check();
    finish();
    await Promise.all([first, second]);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    updater.emit('update-available', { version: '0.2.0' });
    await updates.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('stays off without an updater and never relaunches outside an isolated check profile', () => {
    expect(new DesktopUpdates({ updater: null, native: null }).status).toEqual({ state: 'off' });
    expect(new DesktopUpdates({ updater: null, native: null, disabled: 'move' }).status).toEqual({
      state: 'move',
    });
    const { updater } = fakes();
    new DesktopUpdates({
      updater,
      native: { on: () => undefined },
      relaunch: false,
      timers: { after: () => 0 as never, every: () => 0 as never, clear: () => undefined },
    }).start();
    expect(updater.autoRunAppAfterInstall).toBe(false);
  });

  it('clears its timers when disposed', () => {
    const { updates, timers } = fakes();
    updates.start();
    updates.dispose();
    expect(timers.clear).toHaveBeenCalledTimes(2);
  });
});

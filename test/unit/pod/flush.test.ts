import { shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import type { PodHost, PodRunResult, Portal } from '../../../src/host/workspace.ts';
import { DEV_PORT, PodSession, type WorkspaceSession } from '../../../src/workspace/pod-session.ts';
import { kitFiles } from '../../../src/screen/kit-files.ts';

const success = (): PodRunResult => ({ exitCode: 0, output: '', timedOut: false, ms: 1 });
const pods: PodSession[] = [];
beforeEach(() =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }),
);
afterEach(() => {
  for (const pod of pods.splice(0)) pod.dispose();
  vi.useRealTimers();
});

function harness(sync: () => Promise<PodRunResult> = async () => success()) {
  const session = {
    catalog,
    doc: shallowRef(starter('bass', catalog)),
  } as unknown as WorkspaceSession;
  const files = new Map<string, string>();
  let portal: ((p: Portal) => void) | null = null;
  let finishPreview: (() => void) | null = null;
  let previewRunning = true;
  let releaseCommand: (() => void) | null = null;
  const run = vi.fn<PodHost['run']>(async command => {
    if (command === 'sync') return sync();
    if (command === 'hang')
      return new Promise(resolve => {
        releaseCommand = () => resolve(success());
      });
    return success();
  });
  const host: PodHost = {
    kind: 'fake',
    home: '/home/test',
    network() {},
    run,
    start(name) {
      const done = new Promise<void>(resolve => {
        finishPreview = resolve;
      });
      queueMicrotask(() => portal?.({ port: DEV_PORT, url: 'https://preview.example.test/' }));
      return {
        name,
        done,
        get running() {
          return previewRunning;
        },
        output: () => '',
      };
    },
    async writeFile(path, text) {
      files.set(path, text);
    },
    async readFile(path) {
      return files.get(path) ?? null;
    },
    onPortal(listener) {
      portal = listener;
      return () => {
        portal = null;
      };
    },
    dispose() {
      previewRunning = false;
      finishPreview?.();
      releaseCommand?.();
    },
  };
  const create = vi.fn(async () => host);
  const pod = new PodSession(session, { kind: 'fake', create }, kitFiles());
  pods.push(pod);
  return { pod, host, session, files, run, create, release: () => releaseCommand?.() };
}

async function boot(h: ReturnType<typeof harness>) {
  const ready = h.pod.ensure();
  await vi.advanceTimersByTimeAsync(1000);
  await ready;
}
const snapshot = (h: ReturnType<typeof harness>) =>
  JSON.stringify({
    state: h.pod.state.value,
    message: h.pod.message.value,
    fix: h.pod.fix.value,
    portal: h.pod.portal.value,
    log: h.pod.log.value,
    document: h.session.doc.value,
  });

describe('project disk synchronization at shutdown', () => {
  it('does not boot a cold pod or change its state merely to flush', async () => {
    const h = harness();
    const before = snapshot(h);
    await h.pod.flush();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(snapshot(h)).toBe(before);
  });

  it('synchronizes completed file writes in the existing pod without changing the work or UI state', async () => {
    const h = harness();
    await boot(h);
    await h.pod.writeFile('new.txt', 'fresh disk data');
    const before = snapshot(h);
    const files = new Map(h.files);
    await h.pod.flush();
    expect(h.run).toHaveBeenLastCalledWith('sync', { cwd: '/home/test', timeoutMs: 2500 });
    expect(h.files).toEqual(files);
    expect(snapshot(h)).toBe(before);
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('bypasses a hung command queue so shutdown synchronization can still complete', async () => {
    const h = harness();
    await boot(h);
    const command = h.pod.bash('hang');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.run.mock.calls.some(([script]) => script === 'hang')).toBe(true);
    const before = snapshot(h);
    await h.pod.flush();
    expect(h.run).toHaveBeenLastCalledWith('sync', { cwd: '/home/test', timeoutMs: 2500 });
    expect(snapshot(h)).toBe(before);
    expect(h.pod.log.value.at(-1)?.running).toBe(true);
    h.release();
    await command;
  });

  it.each([
    ['nonzero exit', async () => ({ ...success(), exitCode: 1 })],
    ['command timeout', async () => ({ ...success(), timedOut: true, exitCode: null })],
    [
      'host rejection',
      async () => {
        throw new Error('SDK detail with an operator secret');
      },
    ],
  ] as const)(
    'reports %s instead of claiming that disk data was synchronized',
    async (_name, sync) => {
      const h = harness(sync);
      await boot(h);
      const before = snapshot(h);
      await expect(h.pod.flush()).rejects.toThrow('Project storage synchronization failed.');
      expect(snapshot(h)).toBe(before);
    },
  );

  it('enforces a five-second ceiling when the host ignores its own command timeout', async () => {
    const h = harness(() => new Promise(() => undefined));
    await boot(h);
    const before = snapshot(h);
    let settled = false;
    const failure = h.pod.flush().then(
      () => {
        settled = true;
        return null;
      },
      error => {
        settled = true;
        return error as Error;
      },
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await failure)?.message).toBe('Project storage synchronization failed.');
    expect(snapshot(h)).toBe(before);
  });
});

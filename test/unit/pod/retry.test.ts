import { shallowRef, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';
import { pluginSpec } from '../../../src/screen/build.ts';
import type { PodHost, PodProcess, Portal } from '../../../src/host/workspace.ts';
import { DEV_PORT, PodSession, type WorkspaceSession } from '../../../src/workspace/pod-session.ts';
import { templateFiles } from '../../../src/workspace/template.ts';

class PreviewProcess implements PodProcess {
  readonly name = 'dev';
  readonly done: Promise<void>;
  running = true;
  private finish!: () => void;
  constructor() {
    this.done = new Promise(resolve => {
      this.finish = resolve;
    });
  }
  output() {
    return this.running ? 'preview running' : 'preview stopped';
  }
  crash() {
    if (this.running) {
      this.running = false;
      this.finish();
    }
  }
}

function harness(initial: 'ready' | 'hang' = 'ready') {
  const doc = starter('bass', catalog);
  doc.project = {
    files: { ...templateFiles(), 'src/parts/mine.ts': 'export default { mount() {} };' },
  };
  const session = {
    doc: shallowRef(doc),
    controls: (d: PatchDocument) => pluginSpec(d, catalog, { probes: [] }).controls,
  } as unknown as WorkspaceSession;
  const files = new Map<string, string>([
    ['/home/test/work/node_modules/preserved-package/index.js', 'installed package kept'],
  ]);
  const starts: PreviewProcess[] = [];
  const commands: Array<{ script: string; cwd?: string }> = [];
  const portalListeners = new Set<(portal: Portal) => void>();
  let next = initial;
  let installationFails = false;
  const unrelated = new PreviewProcess();
  const host: PodHost = {
    kind: 'fake',
    home: '/home/test',
    async run(script, options) {
      commands.push({ script, cwd: options?.cwd });
      const output = script.includes('find .')
        ? [...files.keys()]
            .filter(path => path.startsWith('/home/test/work/') && !path.includes('/node_modules/'))
            .map(path => `./${path.slice('/home/test/work/'.length)}`)
            .join('\n')
        : script.includes('npm install')
          ? 'packages are up to date'
          : '';
      return {
        exitCode: installationFails && script.includes('npm install') ? 1 : 0,
        output,
        timedOut: false,
        ms: 1,
      };
    },
    start() {
      const process = new PreviewProcess();
      starts.push(process);
      if (next === 'ready')
        queueMicrotask(() => {
          for (const listener of portalListeners)
            listener({ port: DEV_PORT, url: `https://preview.example.test/${starts.length}/` });
        });
      return process;
    },
    async writeFile(path, text) {
      files.set(path, text);
    },
    async readFile(path) {
      return files.get(path) ?? null;
    },
    onPortal(listener) {
      portalListeners.add(listener);
      return () => {
        portalListeners.delete(listener);
      };
    },
    dispose() {
      for (const process of starts) process.crash();
    },
  };
  const create = vi.fn(async () => host);
  const pod = new PodSession(session, { kind: 'fake', create });
  return {
    session,
    files,
    starts,
    commands,
    create,
    host,
    pod,
    unrelated,
    setNext(value: 'ready' | 'hang') {
      next = value;
    },
    failInstallation(value: boolean) {
      installationFails = value;
    },
  };
}

const pods: PodSession[] = [];
beforeEach(() =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }),
);
afterEach(() => {
  for (const pod of pods.splice(0)) pod.dispose();
  vi.useRealTimers();
});
async function boot(h: ReturnType<typeof harness>, ms = 1000) {
  pods.push(h.pod);
  const ready = h.pod.ensure();
  await vi.advanceTimersByTimeAsync(ms);
  await ready;
}
async function exhaustCrashBudget(h: ReturnType<typeof harness>) {
  for (let i = 0; i < 3; i++) {
    h.starts.at(-1)!.crash();
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(h.pod.state.value).toBe('failed');
}

describe('explicit project preview retry', () => {
  it('repairs a preview after cached ensure has completed and preserves the work and installed disk', async () => {
    const h = harness();
    await boot(h);
    await exhaustCrashBudget(h);
    const document = JSON.stringify(h.session.doc.value);
    const files = new Map(h.files);
    const starts = h.starts.length;
    expect(h.pod.retryable).toBe(true);
    expect(h.pod.fix.value).toMatch(/check the project.*terminal output/i);
    // This is the failure the Retry action must recover: ensure has a fulfilled cached boot.
    expect(await h.pod.ensure()).toBe(h.host);
    expect(h.starts.length).toBe(starts);
    const retry = h.pod.retry();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(h.pod.state.value).toBe('ready');
    expect(h.pod.retryable).toBe(false);
    expect(h.pod.fix.value).toBeUndefined();
    expect(h.starts.length).toBe(starts + 1);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.session.doc.value)).toBe(document);
    expect(h.files).toEqual(files);
  });

  it('resets the crash budget and deduplicates simultaneous retries', async () => {
    const h = harness();
    await boot(h);
    await exhaustCrashBudget(h);
    const starts = h.starts.length;
    const retries = [h.pod.retry(), h.pod.retry(), h.pod.retry()];
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(retries);
    expect(h.starts.length).toBe(starts + 1);
    expect(h.pod.state.value).toBe('ready');
    h.starts.at(-1)!.crash();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.starts.length).toBe(starts + 2);
    expect(h.pod.state.value).toBe('ready');
  });

  it('requires reopening for a preview startup timeout instead of interrupting or duplicating it', async () => {
    const h = harness('hang');
    await boot(h, 181_000);
    expect(h.pod.state.value).toBe('failed');
    expect(h.starts[0]!.running).toBe(true);
    expect(h.pod.retryable).toBe(false);
    expect(h.pod.fix.value).toMatch(/Close and reopen den-kit/);
    h.setNext('ready');
    const before = JSON.stringify(h.session.doc.value);
    const retry = h.pod.retry().then(
      () => null,
      error => error as Error & { fix?: string },
    );
    await vi.advanceTimersByTimeAsync(1000);
    const error = await retry;
    expect(error).toBeInstanceOf(Error);
    expect(`${error?.message} ${error?.fix}`).toMatch(/reopen|restart/i);
    expect(h.pod.state.value).toBe('failed');
    expect(h.starts[0]!.running).toBe(true);
    expect(h.starts.length).toBe(1);
    await h.pod.ensure();
    expect(h.starts.length).toBe(1);
    expect(h.unrelated.running).toBe(true);
    expect(h.commands.some(command => /\b(?:kill|pkill)\b/.test(command.script))).toBe(false);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.session.doc.value)).toBe(before);
  });

  it('keeps dependency repair guidance while a live preview survives an installation failure', async () => {
    const h = harness();
    await boot(h);
    const preview = h.starts[0]!;
    const originalPackage = JSON.parse(h.session.doc.value.project!.files['package.json']!);
    const changePackage = (name: string) => {
      const doc = h.session.doc.value;
      (h.session.doc as Ref<PatchDocument>).value = {
        ...doc,
        project: {
          files: {
            ...doc.project!.files,
            'package.json': JSON.stringify({ ...originalPackage, name }),
          },
        },
      };
    };
    h.failInstallation(true);
    changePackage('installation-fails');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.pod.state.value).toBe('failed');
    expect(h.pod.message.value).toMatch(/dependency installation failed/i);
    expect(h.pod.fix.value).toMatch(/internet connection.*project dependencies/i);
    expect(h.pod.fix.value).not.toMatch(/reopen/i);
    expect(preview.running).toBe(true);
    expect(h.pod.retryable).toBe(false);
    expect(h.starts).toHaveLength(1);
    h.failInstallation(false);
    changePackage('installation-repaired');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.pod.state.value).toBe('ready');
    expect(h.pod.fix.value).toBeUndefined();
    expect(h.starts).toEqual([preview]);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

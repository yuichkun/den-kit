// den-kit's BrowserPod adapter (desktop/page/browserpod.ts) running its real code
// against a stand-in with BrowserPod's API (test/fakes/pod/mock-browserpod.ts),
// which follows BrowserPod's documented behaviour and takes the harder reading
// where the documentation is silent: run() resolves at exit with no status (a
// bare thenable, as BrowserPod 3.4.0's), output arrives as raw byte pieces in
// resizable buffers (which a browser's TextDecoder refuses), `env` replaces the
// whole environment, createFile() wipes, read() returns less than asked. Then the
// whole pod session (npm install, the Vite dev server, TypeScript, ESLint)
// through the adapter.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { shallowRef } from 'vue';
import type { BrowserPod } from '@leaningtech/browserpod';
import { catalog } from '../../src/sound/blocks/index.ts';
import { starter } from '../../src/work/starters.ts';
import type { KitSession } from '../../src/editor/session.ts';
import {
  BrowserPodHost,
  bootBrowserPod,
  isolationProblem,
  parseEnv,
  plainBytes,
  resetBrowserPodForTest,
} from '../../desktop/page/browserpod.ts';
import { PodSession } from '../../src/workspace/pod-session.ts';
import { starterPart } from '../../src/workspace/template.ts';
import { MockBrowserPod, resizableBuffer } from '../fakes/pod/mock-browserpod.ts';
import { kitFiles } from '../../src/screen/kit-files.ts';

const resizable = (buffer: ArrayBufferLike) =>
  (buffer as { resizable?: boolean }).resizable === true;
/** A browser's TextDecoder: it refuses resizable buffers, which Node's accepts. */
const NodeDecoder = globalThis.TextDecoder;
class BrowserDecoder extends NodeDecoder {
  override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
    const buffer =
      input instanceof ArrayBuffer ? input : ArrayBuffer.isView(input) ? input.buffer : null;
    if (buffer && resizable(buffer))
      throw new TypeError(
        "Failed to execute 'decode' on 'TextDecoder': The provided ArrayBuffer value must not be resizable",
      );
    return super.decode(input, options);
  }
}
beforeAll(() => {
  globalThis.TextDecoder = BrowserDecoder;
});
afterAll(() => {
  globalThis.TextDecoder = NodeDecoder;
});

describe("BrowserPod adapter (against a stand-in with BrowserPod's API)", () => {
  let root: string, home: string, mock: MockBrowserPod, host: BrowserPodHost;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'den-kit-mock-bp-'));
    home = join(root, 'home', 'user');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
    mock = new MockBrowserPod({ home });
    host = new BrowserPodHost(mock as unknown as BrowserPod);
    await host.init();
  });
  afterAll(() => {
    mock?.dispose();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('says why a tab is not cross-origin isolated, and what fixes it', () => {
    const good = {
      href: 'http://127.0.0.1:5180/?x',
      secure: true,
      framed: false,
      headers: { coop: 'same-origin', coep: 'require-corp' },
      serviceWorker: false,
    };
    expect(
      isolationProblem({ ...good, href: 'http://192.168.1.5:5180/', secure: false }),
    ).toMatchObject({
      reason: expect.stringContaining('http://192.168.1.5:5180 is not a secure address'),
      fix: expect.stringContaining('http://127.0.0.1:5180/'),
    });
    expect(isolationProblem({ ...good, framed: true })).toMatchObject({
      reason: expect.stringContaining('inside another page'),
      fix: 'Open http://127.0.0.1:5180/ in a tab of its own (Chrome recommended).',
    });
    expect(isolationProblem({ ...good, headers: null }).fix).toContain('still running');
    expect(isolationProblem({ ...good, headers: { coop: null, coep: null } })).toMatchObject({
      reason: 'the server sends COOP "none" and COEP "none" with this page',
      fix: expect.stringContaining('Another server may be answering on http://127.0.0.1:5180'),
    });
    expect(
      isolationProblem({ ...good, headers: { coop: 'same-origin', coep: 'credentialless' } })
        .reason,
    ).toContain('this tab was not isolated');
    expect(isolationProblem({ ...good, serviceWorker: true })).toMatchObject({
      reason: expect.stringContaining('a service worker left on this address by another app'),
      fix: expect.stringContaining('Unregister for http://127.0.0.1:5180'),
    });
    expect(isolationProblem(good)).toMatchObject({
      fix: expect.stringContaining('incognito window'),
    });
  });
  it("copies output out of resizable buffers (BrowserPod's memory) before decoding it", () => {
    const memory = resizableBuffer(8, 64);
    new Uint8Array(memory).set([0, 104, 105, 33, 0, 0, 0, 0]);
    const whole = plainBytes(memory);
    expect([resizable(whole.buffer), whole.byteLength]).toEqual([false, 8]);
    const part = plainBytes(new Uint8Array(memory, 1, 3));
    expect([resizable(part.buffer), new BrowserDecoder().decode(part)]).toEqual([false, 'hi!']);
    expect(() => new BrowserDecoder().decode(memory)).toThrow(/must not be resizable/);
  });
  it('reads env and export -p lines', () => {
    expect(parseEnv('HOME=/home/user\nPATH=/usr/bin:/bin\nPWD=/x\nA=b=c\n  junk')).toEqual({
      HOME: '/home/user',
      PATH: '/usr/bin:/bin',
      A: 'b=c',
    });
    expect(
      parseEnv(
        'declare -x HOME="/home/user"\ndeclare -x Q="say \\"hi\\" \\$x"\ndeclare -x SHLVL="1"',
      ),
    ).toEqual({ HOME: '/home/user', Q: 'say "hi" $x' });
  });
  it("reads the pod's own environment first (without passing one), then passes it back with every command", async () => {
    expect(mock.runs[0]!.env).toBeUndefined();
    expect(host.home).toBe(home);
    const r = await host.run(
      'printf "%s|%s|%s" "$HOME" "$CI" "$(command -v node >/dev/null && echo node-found)"',
      { cwd: home },
    );
    expect(r).toMatchObject({ exitCode: 0, output: `${home}|1|node-found`, timedOut: false });
    const env = mock.runs.at(-1)!.env!;
    expect(env.some(v => v.startsWith('PATH='))).toBe(true);
    expect(env).toContain(`HOME=${home}`);
  });
  it('gives the exit status, the output (both streams) and works in the folder asked', async () => {
    expect(await host.run('echo out; echo err >&2; exit 3', { cwd: home })).toMatchObject({
      exitCode: 3,
      output: 'out\nerr',
    });
    expect((await host.run('pwd', { cwd: root })).output).toBe(root);
    // A command's own exit or cd ends in its own shell; the marker still comes.
    expect((await host.run('cd /; exit 0', { cwd: home })).exitCode).toBe(0);
  });
  it('preserves terminal order across alternating stdout and stderr writes before exit', async () => {
    const r = await host.run(
      'for ((i=0; i<50; i++)); do printf "out-%s\\n" "$i"; printf "err-%s\\n" "$i" >&2; done; exit 3',
      { cwd: home },
    );
    expect(r).toMatchObject({
      exitCode: 3,
      output: Array.from({ length: 50 }, (_, i) => `out-${i}\nerr-${i}`).join('\n'),
    });
  });
  it('output in pieces that split lines and characters, progress lines, and a look-alike marker', async () => {
    const pieces: string[] = [];
    const r = await host.run(
      "printf 'Hello, café☕ world\\n'; printf '[1/2]\\r[2/2]\\n'; echo '<<den-kit-exit:fake:0>>'; exit 4",
      { cwd: home, onOutput: t => pieces.push(t) },
    );
    expect(r.exitCode).toBe(4);
    expect(r.output).toBe('Hello, café☕ world\n[2/2]\n<<den-kit-exit:fake:0>>');
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.join('')).not.toMatch(/�/);
  });
  it('a command that runs too long is interrupted and said so', async () => {
    const t0 = Date.now();
    const r = await host.run('sleep 20', { cwd: home, timeoutMs: 800 });
    expect(r).toMatchObject({ timedOut: true, exitCode: null });
    expect(Date.now() - t0).toBeLessThan(6000);
  });
  it('files: written whole (a shorter text leaves no old tail), read back in pieces, folders made, missing files are null', async () => {
    const long = `${'å'.repeat(3000)}\nend\n`;
    await host.writeFile(`${home}/work/src/parts/a.ts`, long);
    expect(await host.readFile(`${home}/work/src/parts/a.ts`)).toBe(long);
    await host.writeFile(`${home}/work/src/parts/a.ts`, 'short');
    expect(await host.readFile(`${home}/work/src/parts/a.ts`)).toBe('short');
    await host.writeFile(`${home}/work/empty.txt`, '');
    expect(await host.readFile(`${home}/work/empty.txt`)).toBe('');
    expect(await host.readFile(`${home}/work/missing.ts`)).toBeNull();
  });
  it('a server started in the background is announced as a portal, with the port it asked for', async () => {
    const portals: Array<{ url: string; port: number }> = [];
    const off = host.onPortal(p => portals.push(p));
    await host.writeFile(
      `${home}/server.mjs`,
      "import { createServer } from 'node:http';\nconst s = createServer((q, r) => r.end('hi')); s.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${s.address().port}/`));\n",
    );
    const proc = host.start('srv', 'node server.mjs', { cwd: home, env: { PORT: '5173' } });
    const end = Date.now() + 10_000;
    while (!portals.length && Date.now() < end) await new Promise(r => setTimeout(r, 100));
    expect(portals[0]?.port).toBe(5173);
    expect(await (await fetch(portals[0]!.url)).text()).toBe('hi');
    expect(proc.running).toBe(true);
    off();
    mock.dispose();
    await proc.done;
    expect(proc.running).toBe(false);
  });
});

describe('the pod session through the BrowserPod adapter', () => {
  let root: string, mock: MockBrowserPod, pod: PodSession;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'den-kit-mock-bp-session-'));
    const home = join(root, 'home', 'user');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
    mock = new MockBrowserPod({ home });
    const kit = {
      catalog,
      doc: shallowRef(starter('bass', catalog)),
      commit: () => ({ ok: true, ops: [], created: [] }),
    } as unknown as KitSession;
    pod = new PodSession(
      kit,
      {
        kind: 'fake',
        create: async () => {
          const h = new BrowserPodHost(mock as unknown as BrowserPod);
          await h.init();
          return h;
        },
      },
      kitFiles(),
    );
  });
  afterAll(() => {
    pod?.dispose();
    mock?.dispose();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('boots (git, npm install, Vite), runs TypeScript and ESLint, reads a new part back, and serves it', async () => {
    await pod.ensure();
    expect(pod.state.value).toBe('ready');
    expect((await pod.bash('git log --oneline', { who: 'ai' })).output).toContain('den-kit: start');
    expect((await pod.bash('npm run check && npm run lint', { who: 'ai' })).exitCode).toBe(0);
    await pod.writeFile('src/parts/meter.ts', starterPart('meter'));
    const { files } = await pod.collect();
    expect(files['src/parts/meter.ts']).toBe(starterPart('meter'));
    const page = await fetch(`${pod.portal.value}?part=meter`);
    expect(page.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect((await fetch(`${pod.portal.value}src/parts/meter.ts`)).status).toBe(200);
  }, 240_000);
  it("the dev server starts with src/parts made and looks for new folders (BrowserPod's file watching does not see folders made later)", async () => {
    const dev = mock.runs.find(r => r.args.some(a => a.endsWith('/.den-kit/run/dev.sh')));
    expect(dev?.env).toEqual(
      expect.arrayContaining(['KIT_WATCH_NEW_FOLDERS=1', 'KIT_HMR_CLIENT_PORT=443', 'PORT=5173']),
    );
    const { readFileSync } = await import('node:fs');
    expect(
      readFileSync(
        dev!.args.find(a => a.endsWith('dev.sh'))!,
        'utf8',
      ),
    ).toMatch(/^mkdir -p src\/parts && npm run dev/);
    // A part in a folder made after the server started is served, and so is its change.
    await pod.bash("mkdir -p src/lib && echo 'export const n = 1;' > src/lib/n.ts", { who: 'ai' });
    expect(await (await fetch(`${pod.portal.value}src/lib/n.ts`)).text()).toContain('n = 1');
    await new Promise(r => setTimeout(r, 1500));
    await pod.bash("echo 'export const n = 2;' > src/lib/n.ts", { who: 'ai' });
    const end = Date.now() + 10_000;
    let text = '';
    while (Date.now() < end && !text.includes('n = 2')) {
      text = await (await fetch(`${pod.portal.value}src/lib/n.ts`)).text();
      await new Promise(r => setTimeout(r, 200));
    }
    expect(text).toContain('n = 2');
  }, 60_000);
});

describe('BrowserPod starts once per page', () => {
  // BrowserPod opens its disk once: a second BrowserPod.boot in the same page fails ("Device already opened in another tab").
  let root: string, home: string;
  const memory = WebAssembly.Memory.prototype as { toResizableBuffer?: unknown };
  const nodeHas = 'toResizableBuffer' in memory;
  beforeAll(async () => {
    // A page as Chrome gives it: isolated, with resizable WebAssembly memory (Node 22 has none).
    Object.defineProperty(globalThis, 'crossOriginIsolated', { value: true, configurable: true });
    if (!nodeHas) memory.toResizableBuffer = () => new ArrayBuffer(0);
    root = mkdtempSync(join(tmpdir(), 'den-kit-bp-once-'));
    home = join(root, 'home', 'user');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
  });
  afterAll(() => {
    resetBrowserPodForTest();
    if (!nodeHas) delete memory.toResizableBuffer;
    if (root) rmSync(root, { recursive: true, force: true });
  });
  /** A stand-in module whose boot is controlled by the test, counting boots and refusing a second one like BrowserPod. */
  function module(settle: (mock: MockBrowserPod) => Promise<unknown>) {
    const state = {
      boots: 0,
      mock: new MockBrowserPod({ home }),
      options: null as { storageKey?: string } | null,
    };
    const BrowserPod = {
      boot: async (options: { storageKey?: string }) => {
        state.options = options;
        state.boots++;
        if (state.boots > 1) throw new Error('Device already opened in another tab');
        await settle(state.mock);
        return state.mock;
      },
    };
    return {
      state,
      load: async () => ({ BrowserPod }) as unknown as typeof import('@leaningtech/browserpod'),
    };
  }

  it("a work's pod keeps the work's own disk, and a page that started one work's pod refuses another's", async () => {
    resetBrowserPodForTest();
    const { state, load } = module(async () => undefined);
    await bootBrowserPod({ apiKey: 'k', work: 'w1', testing: { load } });
    expect(state.options?.storageKey).toBe('den-kit-work-w1');
    await expect(bootBrowserPod({ apiKey: 'k', work: 'w2', testing: { load } })).rejects.toThrow(
      /belong to the work that started them/,
    );
    expect(state.boots).toBe(1);
    state.mock.dispose();
  });
  it('a slow start: den-kit says so, and asking again waits for the same start (no second boot)', async () => {
    resetBrowserPodForTest();
    let release!: () => void;
    const { state, load } = module(
      () =>
        new Promise<void>(r => {
          release = r;
        }),
    );
    await expect(
      bootBrowserPod({ apiKey: 'k', work: 's', testing: { load, limitMs: 200 } }),
    ).rejects.toThrow(/has not started after/);
    release();
    await new Promise(r => setTimeout(r, 50));
    const host = await bootBrowserPod({
      apiKey: 'k',
      work: 's',
      testing: { load, limitMs: 200 },
    });
    expect(host.home).toBe(home);
    expect(state.boots).toBe(1);
    state.mock.dispose();
  });
  it('a start that failed is said again without booting again; the fix is to reload the page', async () => {
    resetBrowserPodForTest();
    const { state, load } = module(async () => {
      throw new Error('the machine image could not be read');
    });
    const first = bootBrowserPod({ apiKey: 'k', work: 's', testing: { load } });
    await expect(first).rejects.toThrow(
      'BrowserPod did not start: the machine image could not be read',
    );
    const again = await bootBrowserPod({ apiKey: 'k', work: 's', testing: { load } }).catch(e => e);
    expect(again.message).toBe('BrowserPod did not start: the machine image could not be read');
    expect(again.fix).toMatch(/Reload the page/);
    expect(state.boots).toBe(1);
  });
  it('a browser too old for BrowserPod is said plainly, before anything loads', async () => {
    resetBrowserPodForTest();
    const { state, load } = module(async () => undefined);
    const had = memory.toResizableBuffer;
    delete memory.toResizableBuffer;
    try {
      const e = await bootBrowserPod({ apiKey: 'k', work: 's', testing: { load } }).catch(x => x);
      expect(e.message).toBe(
        'This browser is too old for BrowserPod (it lacks resizable WebAssembly memory).',
      );
      expect(e.fix).toMatch(/Update Chrome/);
      expect(state.boots).toBe(0);
    } finally {
      memory.toResizableBuffer = had;
    }
  });
  it('BrowserPod\'s "Device already opened in another tab" is said plainly', async () => {
    resetBrowserPodForTest();
    const { load } = module(async () => {
      throw new Error('Device already opened in another tab');
    });
    const e = await bootBrowserPod({ apiKey: 'k', work: 's', testing: { load } }).catch(x => x);
    expect(e.message).toMatch(/disk is open in another den-kit tab/);
    expect(e.fix).toMatch(/Close the other den-kit tabs/);
  });
});

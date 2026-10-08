// den-kit's BrowserPod adapter (src/pod/browserpod.ts) running its real code
// against a stand-in with BrowserPod's API (test/fakes/pod/mock-browserpod.ts),
// which follows BrowserPod's documented behaviour and takes the harder reading
// where the documentation is silent: run() resolves at exit with no status,
// output arrives as raw byte pieces, `env` replaces the whole environment,
// createFile() wipes, read() returns less than asked. Then the whole pod session
// (npm install, the Vite dev server, TypeScript, ESLint) through the adapter.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import type { BrowserPod } from '@leaningtech/browserpod';
import { catalog } from '../../src/blocks/index.ts';
import { starter } from '../../src/core/starters.ts';
import type { KitSession } from '../../src/editor/session.ts';
import { BrowserPodHost, isolationProblem, parseEnv } from '../../src/pod/browserpod.ts';
import { PodSession } from '../../src/pod/pod-session.ts';
import { starterPart } from '../../src/pod/template.ts';
import { MockBrowserPod } from '../fakes/pod/mock-browserpod.ts';

describe('BrowserPod adapter (against a stand-in with BrowserPod\'s API)', () => {
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
  afterAll(() => { mock?.dispose(); if (root) rmSync(root, { recursive: true, force: true }); });

  it('says why a tab is not cross-origin isolated, and what fixes it', () => {
    const good = { href: 'http://127.0.0.1:5180/?x', secure: true, framed: false, headers: { coop: 'same-origin', coep: 'require-corp' }, serviceWorker: false };
    expect(isolationProblem({ ...good, href: 'http://192.168.1.5:5180/', secure: false })).toMatchObject({ reason: expect.stringContaining('http://192.168.1.5:5180 is not a secure address'), fix: expect.stringContaining('http://127.0.0.1:5180/') });
    expect(isolationProblem({ ...good, framed: true })).toMatchObject({ reason: expect.stringContaining('inside another page'), fix: 'Open http://127.0.0.1:5180/ in a tab of its own (Chrome recommended).' });
    expect(isolationProblem({ ...good, headers: null }).fix).toContain('still running');
    expect(isolationProblem({ ...good, headers: { coop: null, coep: null } })).toMatchObject({ reason: 'the server sends COOP "none" and COEP "none" with this page', fix: expect.stringContaining('Another server may be answering on http://127.0.0.1:5180') });
    expect(isolationProblem({ ...good, headers: { coop: 'same-origin', coep: 'credentialless' } }).reason).toContain('this tab was not isolated');
    expect(isolationProblem({ ...good, serviceWorker: true })).toMatchObject({ reason: expect.stringContaining('a service worker left on this address by another app'), fix: expect.stringContaining('Unregister for http://127.0.0.1:5180') });
    expect(isolationProblem(good)).toMatchObject({ fix: expect.stringContaining('incognito window') });
  });
  it('reads env and export -p lines', () => {
    expect(parseEnv('HOME=/home/user\nPATH=/usr/bin:/bin\nPWD=/x\nA=b=c\n  junk')).toEqual({ HOME: '/home/user', PATH: '/usr/bin:/bin', A: 'b=c' });
    expect(parseEnv('declare -x HOME="/home/user"\ndeclare -x Q="say \\"hi\\" \\$x"\ndeclare -x SHLVL="1"')).toEqual({ HOME: '/home/user', Q: 'say "hi" $x' });
  });
  it('reads the pod\'s own environment first (without passing one), then passes it back with every command', async () => {
    expect(mock.runs[0]!.env).toBeUndefined();
    expect(host.home).toBe(home);
    const r = await host.run('printf "%s|%s|%s" "$HOME" "$CI" "$(command -v node >/dev/null && echo node-found)"', { cwd: home });
    expect(r).toMatchObject({ exitCode: 0, output: `${home}|1|node-found`, timedOut: false });
    const env = mock.runs.at(-1)!.env!;
    expect(env.some(v => v.startsWith('PATH='))).toBe(true);
    expect(env).toContain(`HOME=${home}`);
  });
  it('gives the exit status, the output (both streams) and works in the folder asked', async () => {
    expect(await host.run('echo out; echo err >&2; exit 3', { cwd: home })).toMatchObject({ exitCode: 3, output: 'out\nerr' });
    expect((await host.run('pwd', { cwd: root })).output).toBe(root);
    // A command's own exit or cd ends in its own shell; the marker still comes.
    expect((await host.run('cd /; exit 0', { cwd: home })).exitCode).toBe(0);
  });
  it('output in pieces that split lines and characters, progress lines, and a look-alike marker', async () => {
    const pieces: string[] = [];
    const r = await host.run("printf 'こんにちは、世界\\n'; printf '[1/2]\\r[2/2]\\n'; echo '<<den-kit-exit:fake:0>>'; exit 4", { cwd: home, onOutput: t => pieces.push(t) });
    expect(r.exitCode).toBe(4);
    expect(r.output).toBe('こんにちは、世界\n[2/2]\n<<den-kit-exit:fake:0>>');
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
    await host.writeFile(`${home}/server.mjs`, "import { createServer } from 'node:http';\nconst s = createServer((q, r) => r.end('hi')); s.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${s.address().port}/`));\n");
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
    const kit = { catalog, doc: shallowRef(starter('bass', catalog)), commit: () => ({ ok: true, ops: [], created: [] }) } as unknown as KitSession;
    pod = new PodSession(kit, { kind: 'fake', create: async () => { const h = new BrowserPodHost(mock as unknown as BrowserPod); await h.init(); return h; } });
  });
  afterAll(() => { pod?.dispose(); mock?.dispose(); if (root) rmSync(root, { recursive: true, force: true }); });

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
});

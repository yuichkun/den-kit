// The pod session against the test pod (this machine's bash, git, Node and npm,
// behind the same interface as BrowserPod): the screen project's whole loop with
// the real tools — npm install, the Vite dev server, TypeScript, ESLint, git —
// and the document staying the record (changes read back, undo written in).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import { catalog } from '../../src/blocks/index.ts';
import { applyIntents, applyResolvedOps, invertAll, type Intent, type ResolvedOp } from '../../src/core/ops.ts';
import type { PatchDocument } from '../../src/core/schema.ts';
import { starter } from '../../src/core/starters.ts';
import type { KitSession } from '../../src/editor/session.ts';
import { connectFakePod } from '../../src/pod/fake-host.ts';
import { PodSession } from '../../src/pod/pod-session.ts';
import { starterPart, withTemplate } from '../../src/pod/template.ts';
import { startFakePod, type FakePod } from '../fakes/pod/fake-pod.ts';

/** Just what the pod session uses of the editor's session: the document and commit. */
function session(start: PatchDocument) {
  const doc = shallowRef(start);
  const steps: ResolvedOp[][] = [];
  const s = {
    catalog, doc,
    commit(intents: Intent[]) {
      try { const r = applyIntents(doc.value, intents, catalog); doc.value = r.doc; steps.push(r.ops); return { ok: true, ops: r.ops, created: r.created }; }
      catch (error) { return { ok: false, error }; }
    },
    undo() { const ops = steps.pop(); if (ops) doc.value = applyResolvedOps(doc.value, invertAll(ops)); },
  };
  return s as unknown as KitSession & { undo(): void };
}
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));

describe('pod session (test pod: real npm, Vite, tsc, ESLint, git)', () => {
  let fake: FakePod;
  let kit: ReturnType<typeof session>;
  let pod: PodSession;

  beforeAll(async () => {
    fake = await startFakePod();
    const doc = applyIntents(starter('bass', catalog), [{ op: 'addNode', node: { id: 'kcut', type: 'ui.knob', label: 'Cutoff', config: { min: 20, max: 20000, scale: 'log', unit: 'Hz' } } }], catalog).doc;
    kit = session(doc);
    pod = new PodSession(kit, { kind: 'fake', create: () => connectFakePod(fake.url) });
  }, 30_000);
  afterAll(async () => { pod?.dispose(); await fake?.close(); });

  it('boots: writes the template, git init, npm install, starts the dev server and learns its address', async () => {
    await pod.ensure();
    expect(pod.state.value).toBe('ready');
    expect(pod.portal.value).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const t = pod.timings.value;
    expect(t.installMs).toBeGreaterThan(0); expect(t.devMs).toBeGreaterThan(0);
    expect(pod.log.value.map(e => e.command)).toEqual(expect.arrayContaining(['git init', 'npm install', 'npm run dev']));
    // The generated controls file lists the patch's knob.
    expect(await pod.readFile('src/kit/controls.ts')).toContain('"kcut": { kind: "knob", label: "Cutoff", min: 20, max: 20000, scale: "log", unit: "Hz" }');
  }, 240_000);

  it('runs commands with their exit status and output, and the usual tools work', async () => {
    const git = await pod.bash(`${'git'} log --oneline`, { who: 'ai' });
    expect(git.exitCode).toBe(0); expect(git.output).toContain('den-kit: start');
    expect((await pod.bash('exit 3', { who: 'ai' })).exitCode).toBe(3);
    const both = await pod.bash('echo out; echo err >&2', { who: 'you' });
    expect(both.output).toContain('out'); expect(both.output).toContain('err');
    const check = await pod.bash('npm run check', { who: 'ai' });
    expect(check.exitCode, check.output).toBe(0);
    const lint = await pod.bash('npm run lint', { who: 'ai' });
    expect(lint.exitCode, lint.output).toBe(0);
    const entries = pod.log.value.filter(e => e.who === 'ai');
    expect(entries.at(-1)).toMatchObject({ command: 'npm run lint', running: false, exitCode: 0 });
  }, 180_000);

  it('a command that runs too long is cut off', async () => {
    const r = await pod.bash('sleep 30', { who: 'ai', timeoutMs: 1000 });
    expect(r.timedOut).toBe(true); expect(r.exitCode).toBeNull();
  }, 30_000);

  it('a type error is reported by `npm run check` (the AI sees it)', async () => {
    await pod.writeFile('src/parts/broken.ts', "import { part } from '../kit';\nexport default part({ mount(root, kit) { kit.value('nope'); } });\n");
    const r = await pod.bash('npm run check', { who: 'ai' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toMatch(/nope/);
    await pod.bash('rm src/parts/broken.ts', { who: 'ai' });
  }, 120_000);

  it('reads the project back: the template becomes the work\'s, a new part lands, generated files stay den-kit\'s', async () => {
    await pod.writeFile('src/parts/meter.ts', starterPart('meter'));
    await pod.bash("echo '// mine' >> src/kit/controls.ts && head -c 64 /dev/urandom > logo.bin", { who: 'ai' });
    const { files, skipped } = await pod.collect();
    expect(files['src/parts/meter.ts']).toBe(starterPart('meter'));
    expect(files['package.json']).toContain('"den-kit-screen"');
    expect(files['AGENTS.md']).toContain('Code parts');
    expect(files['src/kit/controls.ts']).toBeUndefined();
    expect(Object.keys(files).some(p => p.startsWith('node_modules/') || p.startsWith('dist/'))).toBe(false);
    expect(skipped.join('\n')).toMatch(/controls\.ts \(made by den-kit/);
    expect(skipped.join('\n')).toMatch(/logo\.bin \(not text/);
    expect(await pod.readFile('src/kit/controls.ts')).not.toContain('// mine');
    const r = kit.commit([{ op: 'setProjectFiles', files }]);
    expect(r.ok).toBe(true);
    expect(kit.doc.value.project!.files['src/parts/meter.ts']).toBeDefined();
    await pod.bash('rm logo.bin', { who: 'ai' });
    // Nothing changed since: nothing to land.
    expect((await pod.collect()).files).toEqual({});
  }, 60_000);

  it('the dev server serves a part page that den-kit may embed (cross-origin isolated page)', async () => {
    const res = await fetch(`${pod.portal.value}?part=meter&el=e1&host=http://127.0.0.1:5180`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await res.text()).toContain('/src/main.ts');
    const part = await fetch(`${pod.portal.value}src/parts/meter.ts`);
    expect(part.status).toBe(200);
    expect(await part.text()).toContain('kit.frame');
  }, 30_000);

  it('an undo in den-kit is written into the pod; a hand edit too', async () => {
    kit.undo();
    await settle(800);
    expect(await pod.readFile('src/parts/meter.ts')).toBeNull();
    expect(await pod.readFile('package.json')).toContain('den-kit-screen');
    // The work has no project again (the undo took it back): the template comes with the new part.
    expect(kit.doc.value.project).toBeUndefined();
    kit.commit([{ op: 'setProjectFiles', files: withTemplate(kit.doc.value.project, { 'src/parts/dial.ts': starterPart('dial') }) }]);
    await settle(800);
    expect(await pod.readFile('src/parts/dial.ts')).toBe(starterPart('dial'));
    // The controls file follows the patch.
    kit.commit([{ op: 'setLabel', node: 'kcut', label: 'Brightness' }]);
    await settle(800);
    expect(await pod.readFile('src/kit/controls.ts')).toContain('label: "Brightness"');
  }, 60_000);

  it('a changed package.json is installed; npm run build works (dist stays in the pod)', async () => {
    const pkg = JSON.parse(kit.doc.value.project!.files['package.json']!);
    pkg.dependencies = { ...pkg.dependencies, 'is-number': '7.0.0' };
    kit.commit([{ op: 'setProjectFiles', files: { 'package.json': `${JSON.stringify(pkg, null, 2)}\n` } }]);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !(await pod.bash('test -d node_modules/is-number && echo yes', { who: 'den-kit' })).output.includes('yes')) await settle(1000);
    expect((await pod.bash('test -d node_modules/is-number && echo yes', { who: 'den-kit' })).output).toContain('yes');
    const build = await pod.bash('npm run build', { who: 'ai', timeoutMs: 180_000 });
    expect(build.exitCode, build.output).toBe(0);
    // The install updated the lockfile (it lands with the next change read back); dist/ stays in the pod.
    const { files } = await pod.collect();
    expect(Object.keys(files)).toEqual(['package-lock.json']);
    expect(files['package-lock.json']).toContain('node_modules/is-number');
  }, 300_000);

  it('commits each request in the pod\'s git', async () => {
    await pod.commit('den-kit: add a dial');
    const r = await pod.bash('git log --oneline | head -3', { who: 'den-kit' });
    expect(r.output).toContain('den-kit: add a dial');
    // Nothing new: no empty commit.
    await pod.commit('den-kit: nothing');
    expect((await pod.bash('git log --oneline | head -1', { who: 'den-kit' })).output).not.toContain('nothing');
  }, 60_000);

  it('the dev server is started again when a command stops it', async () => {
    // Only this pod's dev server (HOME is the pod's own folder; a bare `pkill -f vite` would also stop the test runner).
    const starts = () => pod.log.value.filter(e => e.command === 'npm run dev').length;
    const before = starts();
    await pod.bash('pkill -f "$HOME/work/node_modules/.bin/vite" || true; sleep 1', { who: 'ai' });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (starts() === before || pod.state.value !== 'ready')) await settle(200);
    expect(starts()).toBe(before + 1);
    expect(pod.state.value).toBe('ready');
    expect((await fetch(pod.portal.value!)).status).toBe(200);
  }, 240_000);
});

describe('pod session without a pod', () => {
  it('says why and how to fix it, and refuses commands', async () => {
    const kit = session(starter('bass', catalog));
    const pod = new PodSession(kit, { kind: null, create: () => Promise.reject(new Error('no')), reason: 'The pod (BrowserPod) is off: no API key.', fix: 'Put BROWSERPOD_API_KEY=… in .env' });
    expect(pod.state.value).toBe('unavailable');
    expect(pod.fix.value).toContain('BROWSERPOD_API_KEY');
    await expect(pod.bash('ls', { who: 'ai' })).rejects.toThrow(/off: no API key/);
  });
  it('a pod that fails to start says so, and the next try starts again', async () => {
    const kit = session(starter('bass', catalog));
    let tries = 0;
    const pod = new PodSession(kit, { kind: 'fake', create: () => { tries++; return Promise.reject(new Error('pod could not boot')); } });
    await expect(pod.ensure()).rejects.toThrow('pod could not boot');
    expect(pod.state.value).toBe('unavailable');
    expect(pod.message.value).toContain('pod could not boot');
    await expect(pod.ensure()).rejects.toThrow();
    expect(tries).toBe(2);
  });
});

// The pod session against the test pod (this machine's bash, git, Node and npm,
// behind the same interface as BrowserPod): the screen project's whole loop with
// the real tools — npm install, the Vite dev server, TypeScript, ESLint, git —
// and the document staying the record (changes read back, undo written in).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, textFiles } from '../../src/work/files.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { shallowRef } from 'vue';
import { catalog } from '../../src/sound/blocks/index.ts';
import { currentAssets, generate } from '../../src/sound/codegen.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  type Intent,
  type ResolvedOp,
} from '../../src/work/ops.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { assetsOf, type AssetMeta } from '../../src/work/ui.ts';
import { AssetStore } from '../../src/work/asset-store.ts';
import { starter } from '../../src/work/starters.ts';
import type { KitSession } from '../../src/editor/session.ts';
import { connectFakePod } from '../../dev/fake-pod.ts';
import { PodSession } from '../../src/workspace/pod-session.ts';
import { starterPart, withTemplate } from '../../src/workspace/template.ts';
import { LlmWorkspace } from '../../src/ai/llm-workspace.ts';
import { startFakePod, type FakePod } from '../fakes/pod/fake-pod.ts';
import { kitFiles } from '../../src/screen/kit-files.ts';
import { SHOWCASE_ASSETS } from '../../src/screen/showcase/assets.ts';
import { throughSandbox } from '../helpers/sandboxed.ts';

/** Where den-kit serves the files it ships (public/). */
const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

/** Just what the pod session uses of the editor's session: the document, commit, the assets' contents and what the sound reads. */
function session(start: PatchDocument) {
  const doc = shallowRef(start);
  const steps: ResolvedOp[][] = [];
  const contents = new Map<string, Uint8Array>();
  // Contents a command made are checked and kept as the editor's store does it.
  const store = new AssetStore();
  const s = {
    catalog,
    doc,
    contents,
    steps,
    assets: {
      read: async (asset: AssetMeta) =>
        contents.get(asset.hash ?? '') ??
        (asset.url ? new Uint8Array(readFileSync(join(PUBLIC, asset.url))) : null) ??
        (await store.read(asset)),
      keep: (path: string, bytes: Uint8Array) => store.keep(path, bytes),
    },
    soundAssets: () =>
      currentAssets(doc.value, catalog, generate(doc.value, catalog))
        .map(a => a.path)
        .filter(Boolean),
    commit(intents: Intent[]) {
      try {
        const r = applyIntents(doc.value, intents, catalog);
        doc.value = r.doc;
        steps.push(r.ops);
        return { ok: true, ops: r.ops, created: r.created };
      } catch (error) {
        return { ok: false, error };
      }
    },
    undo() {
      const ops = steps.pop();
      if (ops) doc.value = applyResolvedOps(doc.value, invertAll(ops));
    },
  };
  return s as unknown as KitSession & {
    undo(): void;
    contents: Map<string, Uint8Array>;
    steps: ResolvedOp[][];
  };
}
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));

/** A mono 16-bit WAV of a tone. */
function wav(frequency: number, frames = 4800): Uint8Array {
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(8000 * Math.sin((2 * Math.PI * frequency * i) / 48000)),
      true,
    );
  return new Uint8Array(view.buffer);
}
/** A command that writes the same WAV with Node, in the pod. */
const wavCommand = (path: string, frequency: number) =>
  `node -e 'const n=4800,b=Buffer.alloc(44+n*2);b.write("RIFF",0);b.writeUInt32LE(36+n*2,4);b.write("WAVE",8);b.write("fmt ",12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*${frequency}*i/48000)),44+i*2);require("fs").writeFileSync("${path}",b)'`;
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${fill}"/></svg>\n`;

describe('pod session (test pod: real npm, Vite, tsc, ESLint, git)', () => {
  let fake: FakePod;
  let kit: ReturnType<typeof session>;
  let pod: PodSession;
  /** Read the project back and keep what changed in the work, as one step of the person's. */
  const keep = () =>
    pod.keepChanges(intents => {
      const r = kit.commit(intents);
      return r.ok ? r : { ok: false, message: r.error.message };
    });

  beforeAll(async () => {
    fake = await startFakePod();
    const doc = applyIntents(
      starter('bass', catalog),
      [
        {
          op: 'addNode',
          node: {
            id: 'kcut',
            type: 'ui.knob',
            label: 'Cutoff',
            config: { min: 20, max: 20000, scale: 'log', unit: 'Hz' },
          },
        },
      ],
      catalog,
    ).doc;
    kit = session(doc);
    pod = new PodSession(
      kit,
      { kind: 'fake', create: work => connectFakePod(fake.url, work) },
      kitFiles(),
    );
  }, 30_000);
  afterAll(async () => {
    pod?.dispose();
    await fake?.close();
  });

  it('boots: writes the template, git init, npm install, starts the dev server and learns its address', async () => {
    await pod.ensure();
    expect(pod.state.value).toBe('ready');
    expect(pod.portal.value).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const t = pod.timings.value;
    expect(t.installMs).toBeGreaterThan(0);
    expect(t.devMs).toBeGreaterThan(0);
    expect(pod.log.value.map(e => e.command)).toEqual(
      expect.arrayContaining(['git init', 'npm install', 'npm run dev']),
    );
    // The generated controls file lists the patch's knob.
    expect(await pod.readFile('src/kit/controls.ts')).toContain(
      '"kcut": { kind: "knob", label: "Cutoff", min: 20, max: 20000, scale: "log", unit: "Hz" }',
    );
  }, 240_000);

  it('runs commands with their exit status and output, and the usual tools work', async () => {
    const git = await pod.bash(`${'git'} log --oneline`, { who: 'ai' });
    expect(git.exitCode).toBe(0);
    expect(git.output).toContain('den-kit: start');
    expect((await pod.bash('exit 3', { who: 'ai' })).exitCode).toBe(3);
    const both = await pod.bash('echo out; echo err >&2', { who: 'you' });
    expect(both.output).toContain('out');
    expect(both.output).toContain('err');
    const check = await pod.bash('npm run check', { who: 'ai' });
    expect(check.exitCode, check.output).toBe(0);
    const lint = await pod.bash('npm run lint', { who: 'ai' });
    expect(lint.exitCode, lint.output).toBe(0);
    const entries = pod.log.value.filter(e => e.who === 'ai');
    expect(entries.at(-1)).toMatchObject({ command: 'npm run lint', running: false, exitCode: 0 });
  }, 180_000);

  it('a command that runs too long is cut off', async () => {
    const r = await pod.bash('sleep 30', { who: 'ai', timeoutMs: 1000 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
  }, 30_000);

  it('a type error is reported by `npm run check` (the AI sees it)', async () => {
    await pod.writeFile(
      'src/parts/broken.ts',
      "import { part } from '../kit';\nexport default part({ mount(root, kit) { kit.value('nope'); } });\n",
    );
    const r = await pod.bash('npm run check', { who: 'ai' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toMatch(/nope/);
    await pod.bash('rm src/parts/broken.ts', { who: 'ai' });
  }, 120_000);

  it("reads the project back: the template becomes the work's, a new part lands, generated files stay den-kit's", async () => {
    await pod.writeFile('src/parts/meter.ts', starterPart('meter'));
    await pod.bash(
      "echo '// mine' >> src/kit/controls.ts && head -c 64 /dev/urandom > logo.bin && printf '{\"a\":1}\\0' > data.json",
      { who: 'ai' },
    );
    const steps = kit.steps.length;
    const { changes, skipped, refused } = await keep();
    expect(refused).toBeUndefined();
    expect(changes).toMatchObject({
      'src/parts/meter.ts': 'new',
      'package.json': 'new',
      'AGENTS.md': 'new',
    });
    expect(changes['src/kit/controls.ts']).toBeUndefined();
    expect(
      Object.keys(changes).some(p => p.startsWith('node_modules/') || p.startsWith('dist/')),
    ).toBe(false);
    expect(skipped.join('\n')).toMatch(/controls\.ts \(made by den-kit/);
    expect(skipped.join('\n')).toMatch(/logo\.bin \(outside assets\/, den-kit keeps only text/);
    expect(skipped.join('\n')).toMatch(/data\.json \(not text/);
    expect(await pod.readFile('src/kit/controls.ts')).not.toContain('// mine');
    // One step of the work's.
    expect(kit.steps.length).toBe(steps + 1);
    const files = textFiles(kit.doc.value.files);
    expect(files['src/parts/meter.ts']).toBe(starterPart('meter'));
    expect(files['package.json']).toContain('"den-kit-screen"');
    expect(files['AGENTS.md']).toContain('Code parts');
    await pod.bash('rm logo.bin data.json', { who: 'ai' });
    // Nothing changed since: nothing to land.
    expect((await keep()).changes).toEqual({});
    expect(kit.steps.length).toBe(steps + 1);
  }, 60_000);

  it("the dev server serves a part page that den-kit may embed (cross-origin isolated page), with the sandbox's rules", async () => {
    const res = await throughSandbox(
      pod.portal.value!,
      '/?part=meter&el=e1&host=http://127.0.0.1:5180',
    );
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-security-policy']).toContain("connect-src 'self';");
    expect(res.text).toContain('/src/main.ts');
    // The rules come from den-kit, not from the work's own files.
    const direct = await fetch(`${pod.portal.value}?part=meter`);
    expect(direct.headers.get('cross-origin-embedder-policy')).toBeNull();
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
    expect(textFiles(kit.doc.value.files)).toEqual({});
    kit.commit([
      {
        op: 'setProjectFiles',
        files: withTemplate(kit.doc.value.files, { 'src/parts/dial.ts': starterPart('dial') }),
      },
    ]);
    await settle(800);
    expect(await pod.readFile('src/parts/dial.ts')).toBe(starterPart('dial'));
    // The controls file follows the patch.
    kit.commit([{ op: 'setLabel', node: 'kcut', label: 'Brightness' }]);
    await settle(800);
    expect(await pod.readFile('src/kit/controls.ts')).toContain('label: "Brightness"');
  }, 60_000);

  it('a changed package.json is installed; npm run build works (dist stays in the pod)', async () => {
    const pkg = JSON.parse(textFiles(kit.doc.value.files)['package.json']!);
    pkg.dependencies = { ...pkg.dependencies, 'is-number': '7.0.0' };
    kit.commit([
      { op: 'setProjectFiles', files: { 'package.json': `${JSON.stringify(pkg, null, 2)}\n` } },
    ]);
    const deadline = Date.now() + 120_000;
    while (
      Date.now() < deadline &&
      !(
        await pod.bash('test -d node_modules/is-number && echo yes', { who: 'den-kit' })
      ).output.includes('yes')
    )
      await settle(1000);
    expect(
      (await pod.bash('test -d node_modules/is-number && echo yes', { who: 'den-kit' })).output,
    ).toContain('yes');
    // Nothing else ran while the pod reached the network: the dev server stopped for the install and started again.
    const installs = fake.runs.filter(r => r.script.includes('npm install --ignore-scripts'));
    expect(installs.at(-1)!.alongside).toEqual([]);
    const restarted = Date.now() + 60_000;
    while (!pod.portal.value && Date.now() < restarted) await settle(200);
    expect(pod.portal.value).toBeTruthy();
    const build = await pod.bash('npm run build', { who: 'ai', timeoutMs: 180_000 });
    expect(build.exitCode, build.output).toBe(0);
    // The install updated the lockfile (it lands with the next change read back); dist/ stays in the pod.
    expect((await keep()).changes).toEqual({ 'package-lock.json': 'changed' });
    expect(textFiles(kit.doc.value.files)['package-lock.json']).toContain('node_modules/is-number');
  }, 300_000);

  it("commits each request in the pod's git", async () => {
    await pod.commit('den-kit: add a dial');
    const r = await pod.bash('git log --oneline | head -3', { who: 'den-kit' });
    expect(r.output).toContain('den-kit: add a dial');
    // Nothing new: no empty commit.
    await pod.commit('den-kit: nothing');
    expect(
      (await pod.bash('git log --oneline | head -1', { who: 'den-kit' })).output,
    ).not.toContain('nothing');
  }, 60_000);

  it('the dev server is started again when a command stops it', async () => {
    // Only this pod's dev server (HOME is the pod's own folder; a bare `pkill -f vite` would also stop the test runner).
    const starts = () => pod.log.value.filter(e => e.command === 'npm run dev').length;
    const before = starts();
    await pod.bash('pkill -f "$HOME/work/node_modules/.bin/vite" || true; sleep 1', { who: 'ai' });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (starts() === before || pod.state.value !== 'ready'))
      await settle(200);
    expect(starts()).toBe(before + 1);
    expect(pod.state.value).toBe('ready');
    expect((await fetch(pod.portal.value!)).status).toBe(200);
  }, 240_000);

  it("the work's assets are in the project, its stored ones outside its git: code imports them, a replaced or removed one follows, and a text file under assets/ reads back like any other", async () => {
    const add = async (path: string, bytes: Uint8Array, mime = 'image/png') => {
      const hash = await sha256(bytes);
      kit.contents.set(hash, bytes);
      const asset = {
        id: path,
        name: path.split('/').at(-1)!,
        mime,
        bytes: bytes.length,
        hash,
        width: 1,
        height: 1,
      };
      expect(kit.commit([{ op: 'addAsset', asset }]).ok).toBe(true);
    };
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ),
      c => c.charCodeAt(0),
    );
    await add('assets/dot.png', png);
    kit.commit([
      {
        op: 'setProjectFiles',
        files: {
          'src/parts/dot.ts': "import dot from '../../assets/dot.png';\nexport const url = dot;\n",
        },
      },
    ]);
    await settle(800);
    const head = await pod.bash('od -An -tx1 -N8 assets/dot.png', { who: 'den-kit' });
    expect(head.output.replace(/\s+/g, ' ').trim()).toBe('89 50 4e 47 0d 0a 1a 0a');
    const build = await pod.bash('npm run build', { who: 'den-kit', timeoutMs: 180_000 });
    expect(build.exitCode, build.output).toBe(0);
    const ignored = async (path: string) =>
      (await pod.bash(`git check-ignore -q ${path} && echo ignored`, { who: 'den-kit' })).output;
    expect(await ignored('assets/dot.png')).toContain('ignored');
    // A text file under assets/ is a project file: a command leaves it, or changes it, and it reads back.
    kit.commit([{ op: 'setProjectFiles', files: { 'assets/curve.json': '{"a":1}\n' } }]);
    await settle(800);
    expect(await ignored('assets/curve.json')).not.toContain('ignored');
    await pod.bash('true', { who: 'ai' });
    expect((await keep()).changes).not.toHaveProperty(['assets/curve.json']);
    await pod.bash(`printf '{"a":2}\\n' > assets/curve.json`, { who: 'ai' });
    expect((await keep()).changes['assets/curve.json']).toBe('changed');
    expect(textFiles(kit.doc.value.files)['assets/curve.json']).toBe('{"a":2}\n');
    kit.commit([{ op: 'setProjectFiles', files: { 'assets/curve.json': null } }]);
    await settle(800);
    // A text file that takes a stored asset's path stays in the project.
    await add('assets/table.json', new TextEncoder().encode('{"stored":1}'), 'application/json');
    await settle(800);
    kit.commit([{ op: 'setProjectFiles', files: { 'assets/table.json': '{"text":1}\n' } }]);
    await settle(800);
    expect(await pod.readFile('assets/table.json')).toBe('{"text":1}\n');
    expect((await keep()).changes).not.toHaveProperty(['assets/table.json']);
    kit.commit([{ op: 'setProjectFiles', files: { 'assets/table.json': null } }]);
    await settle(800);
    // Replaced at the same path, then removed.
    kit.commit([{ op: 'removeAsset', id: 'assets/dot.png' }]);
    await add('assets/dot.png', new TextEncoder().encode('another picture'));
    await settle(800);
    expect(await pod.readFile('assets/dot.png')).toBe('another picture');
    kit.commit([{ op: 'removeAsset', id: 'assets/dot.png' }]);
    await settle(800);
    expect(await pod.readFile('assets/dot.png')).toBeNull();
    kit.commit([{ op: 'setProjectFiles', files: { 'src/parts/dot.ts': null } }]);
    await settle(800);
  }, 300_000);

  it("builds a document's code parts only while the project holds that document's files", async () => {
    const built = async (doc: PatchDocument) => {
      const b = await pod.buildParts(doc);
      return b && b !== 'changed' ? Object.keys(b) : b;
    };
    // What the commands so far changed lands in the work first.
    await keep();
    await settle(800);
    expect(await built(kit.doc.value)).toContain('index.html');
    // A command's change that is not read back yet is in the project, not in the work.
    await pod.bash("printf '// more\\n' >> src/parts/dial.ts", { who: 'ai' });
    const before = kit.doc.value;
    expect(await built(before)).toBe('changed');
    await keep();
    await settle(800);
    expect(textFiles(kit.doc.value.files)['src/parts/dial.ts']).toContain('// more');
    expect(await built(before)).toBe('changed');
    expect(await built(kit.doc.value)).toContain('index.html');
    // An asset is part of what it is built from.
    const bytes = new TextEncoder().encode('a picture');
    const hash = await sha256(bytes);
    kit.contents.set(hash, bytes);
    const withAsset = kit.doc.value;
    kit.commit([
      {
        op: 'addAsset',
        asset: {
          id: 'assets/late.png',
          name: 'late.png',
          mime: 'image/png',
          bytes: bytes.length,
          hash,
          width: 1,
          height: 1,
        },
      },
    ]);
    await settle(800);
    expect(await built(withAsset)).toBe('changed');
    expect(await built(kit.doc.value)).toContain('index.html');
  }, 300_000);

  it('puts back what a command did to a stored asset that fails the checks a file added by hand passes, and says why', async () => {
    // assets/late.png ("a picture") is one of the work's stored assets (the test before added it): its name says PNG, its contents do not.
    const after = async (command: string) => {
      await pod.bash(command, { who: 'ai' });
      const { changes, skipped } = await keep();
      return {
        changes,
        said: skipped.filter(s => s.startsWith('assets/late.png')),
        now: await pod.readFile('assets/late.png'),
      };
    };
    const putBack = {
      changes: {},
      said: [
        "assets/late.png (assets/late.png is named as a PNG picture, but its contents are not; den-kit does not use it — den-kit put the work's version back)",
      ],
      now: 'a picture',
    };
    expect(await after("printf 'other' > assets/late.png")).toEqual(putBack);
    // As large as before, in the same second den-kit put it back.
    expect(await after("printf 'b picture' > assets/late.png")).toEqual(putBack);
    expect(await after('true')).toEqual({ changes: {}, said: [], now: 'a picture' });
    // The project holds the work again: its parts build.
    expect(await pod.buildParts(kit.doc.value)).not.toBe('changed');
  }, 300_000);

  it("keeps a picture a command changed: its new contents replace the asset's as one step, its source and licence stay, den-kit does not write it again, and undo puts the old contents back", async () => {
    const bytes = new TextEncoder().encode(svg('#00f'));
    const hash = await sha256(bytes);
    kit.contents.set(hash, bytes);
    const logo = {
      id: 'assets/logo.svg',
      name: 'logo.svg',
      mime: 'image/svg+xml',
      bytes: bytes.length,
      hash,
      width: 10,
      height: 10,
      source: { title: 'Logo', license: 'CC0' },
    };
    expect(kit.commit([{ op: 'addAsset', asset: logo }]).ok).toBe(true);
    await settle(800);
    const written = async () =>
      (
        await pod.bash(
          `node -e 'process.stdout.write(String(require("fs").statSync("assets/logo.svg").mtimeMs))'`,
          { who: 'den-kit' },
        )
      ).output;
    const steps = kit.steps.length;
    await pod.bash(`cat > assets/logo.svg <<'EOF'\n${svg('#f00')}EOF`, { who: 'ai' });
    const at = await written();
    expect(await keep()).toEqual({ changes: { 'assets/logo.svg': 'changed' }, skipped: [] });
    expect(kit.steps.length).toBe(steps + 1);
    const now = assetsOf(kit.doc.value.files)['assets/logo.svg']!;
    expect(now).toEqual({ ...logo, hash: await sha256(new TextEncoder().encode(svg('#f00'))) });
    expect(new TextDecoder().decode((await kit.assets.read(now))!)).toBe(svg('#f00'));
    // The project holds the work: the file stays as the command left it, nothing is read back again, the parts build.
    await settle(800);
    expect(await written()).toBe(at);
    expect((await keep()).changes).toEqual({});
    expect(await pod.buildParts(kit.doc.value)).not.toBe('changed');
    // Undo puts the old contents back, in the work and in the project.
    kit.undo();
    await settle(800);
    expect(assetsOf(kit.doc.value.files)['assets/logo.svg']).toEqual(logo);
    expect(await pod.readFile('assets/logo.svg')).toBe(svg('#00f'));
    expect((await keep()).changes).toEqual({});
  }, 300_000);

  it('kit_bash keeps a sound a command made under assets/ with the text files it changed, as one step, says what it kept, and takes out a picture that is not one', async () => {
    const ai = new LlmWorkspace({
      catalog,
      images: false,
      read: () => kit.doc.value,
      land: intents => {
        const r = kit.commit(intents);
        return r.ok ? { ok: true } : { ok: false, message: r.error.message };
      },
      compile: async () => ({ ok: true, ms: 1 }),
      render: () => Promise.reject(new Error('no rendering here')),
      look: () => Promise.reject(new Error('no looking here')),
      pod: pod.access(),
    });
    const steps = kit.steps.length;
    const r = await ai.call('kit_bash', {
      command: `${wavCommand('assets/kick.wav', 110)} && printf '// kick\\n' >> src/main.ts && printf 'not a picture' > assets/fake.png`,
    });
    expect(r.text).toContain('Kept in the work: assets/kick.wav (new), src/main.ts (changed).');
    expect(r.text).toContain(
      'Not kept: assets/fake.png (assets/fake.png is named as a PNG picture, but its contents are not; den-kit does not use it — den-kit took it out of the project).',
    );
    expect(kit.steps.length).toBe(steps + 1);
    const kick = assetsOf(kit.doc.value.files)['assets/kick.wav']!;
    expect(kick).toMatchObject({
      mime: 'audio/wav',
      bytes: wav(110).length,
      source: { title: 'Made by a command in the project' },
    });
    expect(await kit.assets.read(kick)).toEqual(wav(110));
    expect(textFiles(kit.doc.value.files)['src/main.ts']).toContain('// kick');
    expect(await pod.readFile('assets/fake.png')).toBeNull();
    // The new asset is the work's like any other: outside the project's git, and not read back again.
    expect(
      (await pod.bash('git check-ignore -q assets/kick.wav && echo ignored', { who: 'den-kit' }))
        .output,
    ).toContain('ignored');
    expect((await keep()).changes).toEqual({});
    // One undo takes both back, in the work and in the project.
    kit.undo();
    await settle(800);
    expect(assetsOf(kit.doc.value.files)['assets/kick.wav']).toBeUndefined();
    expect(await pod.readFile('assets/kick.wav')).toBeNull();
    expect(await pod.readFile('src/main.ts')).not.toContain('// kick');
    expect((await keep()).changes).toEqual({});
  }, 120_000);

  it('does not keep a change to a sound the patch plays: puts it back and says how to change the sound on the patch', async () => {
    const bytes = wav(220);
    const hash = await sha256(bytes);
    kit.contents.set(hash, bytes);
    expect(
      kit.commit([
        {
          op: 'addAsset',
          asset: {
            id: 'assets/loop.wav',
            name: 'loop.wav',
            mime: 'audio/wav',
            bytes: bytes.length,
            hash,
          },
        },
        {
          op: 'addNode',
          node: { id: 'sampler1', type: 'den.samplePlayer', config: { sound: 'assets/loop.wav' } },
        },
        {
          op: 'connect',
          from: { node: 'sampler1', port: 'out' },
          to: { node: 'out1', port: 'right' },
        },
      ]).ok,
    ).toBe(true);
    await settle(800);
    expect(kit.soundAssets()).toContain('assets/loop.wav');
    const digest = async () =>
      `sha256-${
        (
          await pod.bash(
            `node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync("assets/loop.wav")).digest("hex"))'`,
            { who: 'den-kit' },
          )
        ).output
      }`;
    await pod.bash(wavCommand('assets/loop.wav', 440), { who: 'ai' });
    expect(await digest()).not.toBe(hash);
    expect(await keep()).toEqual({
      changes: {},
      skipped: [
        "assets/loop.wav (the sound plays it, so den-kit put it back: save the new contents under another name and point sampler1's sound at that file)",
      ],
    });
    expect(await digest()).toBe(hash);
    expect(assetsOf(kit.doc.value.files)['assets/loop.wav']!.hash).toBe(hash);
    // Under another name it is a new asset, which the patch can then play.
    await pod.bash(wavCommand('assets/loop-high.wav', 440), { who: 'ai' });
    expect((await keep()).changes).toEqual({ 'assets/loop-high.wav': 'new' });
  }, 120_000);

  it('removes an asset a command removed when nothing uses it; one something uses is put back, with where it is used', async () => {
    // assets/logo.svg goes on the plugin; assets/loop-high.wav (the test before made it) is not used.
    expect(
      kit.commit([
        {
          op: 'addElement',
          element: {
            id: 'logo1',
            kind: 'image',
            asset: 'assets/logo.svg',
            fit: 'contain',
            rect: { x: 0, y: 0, w: 40, h: 40 },
          },
        },
      ]).ok,
    ).toBe(true);
    await settle(800);
    const steps = kit.steps.length;
    const here = async (path: string) =>
      (await pod.bash(`test -f ${path} && echo here || echo gone`, { who: 'den-kit' })).output;
    await pod.bash('rm assets/logo.svg assets/loop-high.wav', { who: 'ai' });
    expect(await keep()).toEqual({
      changes: { 'assets/loop-high.wav': 'deleted' },
      skipped: ['assets/logo.svg (used by logo1, so den-kit put it back: change those first)'],
    });
    expect(kit.steps.length).toBe(steps + 1);
    expect(assetsOf(kit.doc.value.files)['assets/loop-high.wav']).toBeUndefined();
    expect(await pod.readFile('assets/logo.svg')).toBe(svg('#00f'));
    expect((await keep()).changes).toEqual({});
    // Undo brings it back, in the work and in the project.
    kit.undo();
    await settle(800);
    expect(assetsOf(kit.doc.value.files)['assets/loop-high.wav']).toBeDefined();
    expect(await here('assets/loop-high.wav')).toContain('here');
  }, 120_000);

  it('leaves out a file den-kit does not keep as text, says why, and keeps the rest of each command', async () => {
    const steps = kit.steps.length;
    await pod.bash(
      "printf '#!/bin/sh\\necho hi\\n' > gen.sh && printf 'all:\\n\\ttrue\\n' > Makefile && printf '<svg/>' > src/icon.svg && printf '// one\\n' >> src/main.ts",
      { who: 'ai' },
    );
    const first = await keep();
    expect(first.changes).toEqual({ 'src/main.ts': 'changed' });
    expect(first.skipped).toHaveLength(3);
    for (const path of ['gen.sh', 'Makefile', 'src/icon.svg'])
      expect(first.skipped).toContain(
        `${path} (outside assets/, den-kit keeps only text files, with names such as .ts, .js, .json or .md: rename it, or put a picture, sound or other asset under assets/)`,
      );
    // They stay in the project, and the next command's changes land too.
    expect(await pod.readFile('gen.sh')).toBe('#!/bin/sh\necho hi\n');
    await pod.bash("printf '// two\\n' >> src/main.ts", { who: 'ai' });
    expect((await keep()).changes).toEqual({ 'src/main.ts': 'changed' });
    expect(textFiles(kit.doc.value.files)['src/main.ts']).toMatch(/\/\/ one\n\/\/ two\n$/);
    expect(kit.steps.length).toBe(steps + 2);
    await pod.bash('rm gen.sh Makefile src/icon.svg', { who: 'ai' });
  }, 60_000);

  it("the person's command lands as one step of theirs; when the work refuses what a command changed, the project's assets go back to the work's", async () => {
    const steps = kit.steps.length;
    const r = await pod.runForYou(wavCommand('assets/tone.wav', 330));
    expect(r).toMatchObject({ changed: ['assets/tone.wav'], skipped: [] });
    expect(kit.steps.length).toBe(steps + 1);
    expect(assetsOf(kit.doc.value.files)['assets/tone.wav']).toBeDefined();
    await pod.bash(
      `cat > assets/logo.svg <<'EOF'\n${svg('#0f0')}EOF\n${wavCommand('assets/new.wav', 550)}\nrm assets/tone.wav`,
      { who: 'ai' },
    );
    expect(
      await pod.keepChanges(() => ({ ok: false, message: 'The work changed meanwhile.' })),
    ).toEqual({
      changes: {
        'assets/logo.svg': 'changed',
        'assets/new.wav': 'new',
        'assets/tone.wav': 'deleted',
      },
      skipped: [],
      refused: 'The work changed meanwhile.',
    });
    expect(await pod.readFile('assets/logo.svg')).toBe(svg('#00f'));
    expect(await pod.readFile('assets/new.wav')).toBeNull();
    expect(
      (await pod.bash('test -f assets/tone.wav && echo here', { who: 'den-kit' })).output,
    ).toContain('here');
    expect((await keep()).changes).toEqual({});
    expect(kit.steps.length).toBe(steps + 1);
  }, 120_000);

  it("a copy of one of the work's assets keeps where that one came from, a file den-kit ships included", async () => {
    const knob = SHOWCASE_ASSETS['assets/den-kit/brass-knob.svg']!;
    expect(kit.commit([{ op: 'addAsset', asset: knob }]).ok).toBe(true);
    await settle(800);
    await pod.bash(
      'cp assets/den-kit/brass-knob.svg assets/knob-copy.svg && cp assets/logo.svg assets/logo-copy.svg',
      { who: 'ai' },
    );
    expect((await keep()).changes).toEqual({
      'assets/knob-copy.svg': 'new',
      'assets/logo-copy.svg': 'new',
    });
    const assets = assetsOf(kit.doc.value.files);
    expect(assets['assets/knob-copy.svg']!.source).toEqual(knob.source);
    expect(assets['assets/logo-copy.svg']!.source).toEqual({ title: 'Logo', license: 'CC0' });
  }, 120_000);

  it('refuses an asset that would take the work over its limits, without reading its contents', async () => {
    // Assets whose contents are not here make the work hold 490 MB (it holds at most 500 MB).
    const mb = 1024 * 1024;
    expect(
      kit.commit(
        [100, 100, 100, 100, 90].map((size, i): Intent => ({
          op: 'addAsset',
          asset: {
            id: `assets/fill${i}.bin`,
            name: `fill${i}.bin`,
            mime: 'application/octet-stream',
            bytes: size * mb,
            hash: `sha256-${String(i + 1).repeat(64)}`,
          },
        })),
      ).ok,
    ).toBe(true);
    await settle(800);
    const reads = () => fake.commands.filter(c => c.includes("base64 < 'assets/big.bin'")).length;
    await pod.bash(`head -c ${12 * mb} /dev/zero > assets/big.bin`, { who: 'ai' });
    expect(await keep()).toEqual({
      changes: {},
      skipped: [
        "assets/big.bin (A work's files hold at most 500 MB — den-kit took it out of the project)",
      ],
    });
    expect(reads()).toBe(0);
    expect(await pod.readFile('assets/big.bin')).toBeNull();
    kit.undo();
    await settle(800);
  }, 120_000);
});

describe('pod session without a pod', () => {
  it('says why and how to fix it, and refuses commands', async () => {
    const kit = session(starter('bass', catalog));
    const pod = new PodSession(
      kit,
      {
        kind: null,
        create: () => Promise.reject(new Error('no')),
        reason: 'The pod (BrowserPod) is off: no API key.',
        fix: 'Put BROWSERPOD_API_KEY=… in .env',
      },
      kitFiles(),
    );
    expect(pod.state.value).toBe('unavailable');
    expect(pod.fix.value).toContain('BROWSERPOD_API_KEY');
    await expect(pod.bash('ls', { who: 'ai' })).rejects.toThrow(/off: no API key/);
  });
  it('a pod that fails to start says so, and the next try starts again', async () => {
    const kit = session(starter('bass', catalog));
    let tries = 0;
    const pod = new PodSession(
      kit,
      {
        kind: 'fake',
        create: () => {
          tries++;
          return Promise.reject(new Error('pod could not boot'));
        },
      },
      kitFiles(),
    );
    await expect(pod.ensure()).rejects.toThrow('pod could not boot');
    expect(pod.state.value).toBe('unavailable');
    expect(pod.message.value).toContain('pod could not boot');
    await expect(pod.ensure()).rejects.toThrow();
    expect(tries).toBe(2);
  });
});

describe("each work's pod (test pod)", () => {
  let fake: FakePod;
  beforeAll(async () => {
    fake = await startFakePod();
  });
  afterAll(async () => {
    await fake?.close();
  });

  it('reaches the internet only while den-kit installs packages (npm, from the npm registry, no install scripts), and serves only the work it started for', async () => {
    const kit = session(starter('bass', catalog));
    const work = kit.doc.value.id;
    const asked: string[] = [];
    const pod = new PodSession(
      kit,
      {
        kind: 'fake',
        create: w => {
          asked.push(w);
          return connectFakePod(fake.url, w);
        },
      },
      kitFiles(),
    );
    try {
      await pod.ensure();
      expect(pod.state.value).toBe('ready');
      // The pod is the work's own: den-kit asked for this work's disk.
      expect(asked).toEqual([work]);
      const offline = async () => {
        const curl = await pod.bash('curl -sS -m 10 -o /dev/null https://github.com', {
          who: 'ai',
        });
        expect(curl.exitCode, curl.output).not.toBe(0);
        const node = await pod.bash(
          `node -e "fetch('https://github.com').then(()=>process.exit(0),()=>process.exit(3))"`,
          { who: 'ai' },
        );
        expect(node.exitCode, node.output).toBe(3);
      };
      await offline();
      // A command cannot install from the internet (with an empty cache, npm needs the registry); den-kit's install can.
      expect(
        (
          await pod.bash('npm install --no-save --cache "$(mktemp -d)" is-number@7.0.0', {
            who: 'ai',
          })
        ).exitCode,
      ).not.toBe(0);
      // A process a command left in the background stops before the pod reaches the network.
      await pod.bash('sleep 300 > /dev/null 2>&1 & echo $! > .left-running', { who: 'ai' });
      const installed = await pod.installPackages('is-number@7.0.0');
      expect(installed.exitCode, installed.output).toBe(0);
      expect(
        (
          await pod.bash(
            'kill -0 "$(cat .left-running)" 2>/dev/null && echo running || echo gone',
            {
              who: 'den-kit',
            },
          )
        ).output,
      ).toContain('gone');
      // den-kit's install ran with nothing else running (the AI's own try above ran beside the dev server, offline).
      const ourInstall = fake.runs.find(
        r => r.script.includes('--ignore-scripts') && r.script.includes('--no-save is-number'),
      );
      expect(ourInstall!.alongside).toEqual([]);
      await offline();
      // den-kit's installs: the boot's and the one above, from the npm registry, without install scripts.
      const ours = fake.commands.filter(c => c.includes('--registry=https://registry.npmjs.org/'));
      expect(ours.length).toBeGreaterThanOrEqual(2);
      for (const c of ours) expect(c).toContain('npm install --ignore-scripts');
      // Another work opened in the same window: the pod is not used for it, and its files do not go onto this disk.
      const other = { ...starter('bass', catalog), id: 'another-work' };
      kit.doc.value = applyIntents(
        other,
        [
          {
            op: 'setProjectFiles',
            files: withTemplate(other.files, { 'src/parts/other.ts': starterPart('other') }),
          },
        ],
        catalog,
      ).doc;
      await expect(pod.ensure()).rejects.toThrow(/belong to the work that started them/);
      expect(pod.state.value).toBe('unavailable');
      await settle(500);
      expect(existsSync(join(fake.homeOf(work), 'work', 'src/parts/other.ts'))).toBe(false);
    } finally {
      pod.dispose();
    }
  }, 300_000);

  it("a work's disk is its own: what one work leaves in its pod, another does not see", async () => {
    const a = await connectFakePod(fake.url, 'work-a');
    const b = await connectFakePod(fake.url, 'work-b');
    expect((await a.run('echo secret > ~/left-by-a.txt')).exitCode).toBe(0);
    expect((await a.run('test -e ~/left-by-a.txt')).exitCode).toBe(0);
    expect((await b.run('test -e ~/left-by-a.txt')).exitCode).toBe(1);
    a.dispose?.();
    b.dispose?.();
  }, 60_000);
});

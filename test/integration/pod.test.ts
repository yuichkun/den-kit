// The pod session against the test pod (this machine's bash, git, Node and npm,
// behind the same interface as BrowserPod): the screen project's whole loop with
// the real tools — npm install, the Vite dev server, TypeScript, ESLint, git —
// and the document staying the record (changes read back, undo written in).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, textFiles } from '../../src/work/files.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { shallowRef } from 'vue';
import { catalog } from '../../src/sound/blocks/index.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  type Intent,
  type ResolvedOp,
} from '../../src/work/ops.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import type { AssetMeta } from '../../src/work/ui.ts';
import { starter } from '../../src/work/starters.ts';
import type { KitSession } from '../../src/editor/session.ts';
import { connectFakePod } from '../../dev/fake-pod.ts';
import { PodSession } from '../../src/workspace/pod-session.ts';
import { starterPart, withTemplate } from '../../src/workspace/template.ts';
import { startFakePod, type FakePod } from '../fakes/pod/fake-pod.ts';
import { kitFiles } from '../../src/screen/kit-files.ts';
import { throughSandbox } from '../helpers/sandboxed.ts';

/** Just what the pod session uses of the editor's session: the document, commit and the assets' contents. */
function session(start: PatchDocument) {
  const doc = shallowRef(start);
  const steps: ResolvedOp[][] = [];
  const contents = new Map<string, Uint8Array>();
  const s = {
    catalog,
    doc,
    contents,
    assets: { read: async (asset: AssetMeta) => contents.get(asset.hash ?? '') ?? null },
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
  return s as unknown as KitSession & { undo(): void; contents: Map<string, Uint8Array> };
}
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));

describe('pod session (test pod: real npm, Vite, tsc, ESLint, git)', () => {
  let fake: FakePod;
  let kit: ReturnType<typeof session>;
  let pod: PodSession;

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
    await pod.bash("echo '// mine' >> src/kit/controls.ts && head -c 64 /dev/urandom > logo.bin", {
      who: 'ai',
    });
    const { files, skipped } = await pod.collect();
    expect(files['src/parts/meter.ts']).toBe(starterPart('meter'));
    expect(files['package.json']).toContain('"den-kit-screen"');
    expect(files['AGENTS.md']).toContain('Code parts');
    expect(files['src/kit/controls.ts']).toBeUndefined();
    expect(
      Object.keys(files).some(p => p.startsWith('node_modules/') || p.startsWith('dist/')),
    ).toBe(false);
    expect(skipped.join('\n')).toMatch(/controls\.ts \(made by den-kit/);
    expect(skipped.join('\n')).toMatch(/logo\.bin \(not text/);
    expect(await pod.readFile('src/kit/controls.ts')).not.toContain('// mine');
    const r = kit.commit([{ op: 'setProjectFiles', files }]);
    expect(r.ok).toBe(true);
    expect(textFiles(kit.doc.value.files)['src/parts/meter.ts']).toBeDefined();
    await pod.bash('rm logo.bin', { who: 'ai' });
    // Nothing changed since: nothing to land.
    expect((await pod.collect()).files).toEqual({});
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
    const { files } = await pod.collect();
    expect(Object.keys(files)).toEqual(['package-lock.json']);
    expect(files['package-lock.json']).toContain('node_modules/is-number');
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

  it("the work's assets are in the project, outside its git: code imports them, and a replaced or removed one follows", async () => {
    const add = async (path: string, bytes: Uint8Array) => {
      const hash = await sha256(bytes);
      kit.contents.set(hash, bytes);
      const asset = {
        id: path,
        name: path.split('/').at(-1)!,
        mime: 'image/png',
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
    expect(
      (await pod.bash('git status --porcelain -- assets', { who: 'den-kit' })).output.trim(),
    ).toBe('');
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
    kit.commit([{ op: 'setProjectFiles', files: (await pod.collect()).files }]);
    await settle(800);
    expect(await built(kit.doc.value)).toContain('index.html');
    // A command's change that is not read back yet is in the project, not in the work.
    await pod.bash("printf '// more\\n' >> src/parts/dial.ts", { who: 'ai' });
    const before = kit.doc.value;
    expect(await built(before)).toBe('changed');
    kit.commit([{ op: 'setProjectFiles', files: (await pod.collect()).files }]);
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

// Where the editor's code parts come from (src/editor/code-parts.ts): the work's own
// origin, which passes them through to the workspace's dev server while it runs, and
// otherwise serves them as last built, when that build was made from the files the
// work has now. The build is kept by work in the host's storage.
import { describe, expect, it } from 'vite-plus/test';
import { nextTick, ref } from 'vue';
import type { Host, Sandbox, Storage } from '../../../src/host/index.ts';
import { CodeParts } from '../../../src/editor/code-parts.ts';
import { KitSession } from '../../../src/editor/session.ts';
import { starter } from '../../../src/work/starters.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';

function hostStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>(),
    contents = new Map<string, Uint8Array>();
  return {
    data,
    read: async key => data.get(key) ?? null,
    write: async (key, value) => void data.set(key, value),
    remove: async key => void data.delete(key),
    keys: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)),
    readContent: async hash => contents.get(hash) ?? null,
    writeContent: async (hash, bytes) => void contents.set(hash, bytes),
  };
}

function setup(
  storage = hostStorage(),
  work = 'work-a',
  isolated = true,
  answer = () => Promise.resolve(),
) {
  const opened: Array<Parameters<Sandbox['open']>[1]> = [];
  const sandbox: Sandbox = {
    open: (_, settings) => {
      opened.push(settings);
      return answer();
    },
    close: () => undefined,
    origin: id => `http://${id}.localhost:5247`,
    servesContents: true,
    fileUrl: (id, path) => `http://${id}.localhost:5247/__den-kit/files/${path}`,
    onRefused: () => () => undefined,
  };
  const host = { storage, sandbox: isolated ? sandbox : null } as unknown as Host;
  const session = new KitSession({
    host,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, setAssets() {}, unload() {}, running: false } as never,
  });
  session.replace({ ...starter('bass', catalog), id: work }, 'Bass', false);
  session.commit([
    { op: 'setProjectFiles', files: { 'src/parts/meter.ts': 'export default 1;\n' } },
  ]);
  // A workspace that is there, with no dev server until a test starts one.
  const pod = {
    available: true,
    portal: ref<string | null>(null),
    reloads: ref(0),
    state: ref('idle'),
    message: ref(''),
    ensure: async () => undefined,
    report: () => undefined,
    wanted: () =>
      new Map(
        Object.entries(session.doc.value.files).flatMap(([path, f]) =>
          'text' in f ? [[path, f.text] as [string, string]] : [],
        ),
      ),
  };
  const parts = new CodeParts(session, pod as never, host);
  return { session, pod, parts, opened, storage };
}

const built = () => ({
  'index.html': new TextEncoder().encode(
    '<script type="module" src="./assets/index-1.js"></script>',
  ),
  'assets/index-1.js': new TextEncoder().encode('export {};'),
});
const settled = async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
  await nextTick();
};

describe("the editor's code parts", () => {
  it("wait for the workspace's dev server, then load from the work's own origin", async () => {
    const { pod, parts, opened } = setup();
    await settled();
    expect(parts.source.portal.value).toBeNull();
    expect(opened.at(-1)).toMatchObject({ devServer: null, build: {} });
    pod.portal.value = 'https://p-5173.portal.example';
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    expect(opened.at(-1)).toMatchObject({ devServer: 'https://p-5173.portal.example' });
  });

  it("load from the work's own origin only once the sandbox serves the dev server", async () => {
    const answers: Array<() => void> = [];
    const { pod, parts } = setup(
      hostStorage(),
      'work-a',
      true,
      () => new Promise<void>(r => answers.push(r)),
    );
    pod.portal.value = 'https://p-5173.portal.example';
    await settled();
    expect(parts.source.portal.value).toBeNull();
    answers.at(-1)!();
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    // The dev server again, at another address: not until the sandbox serves that one.
    pod.portal.value = 'https://p-5174.portal.example';
    await settled();
    expect(parts.source.portal.value).toBeNull();
    answers.at(-1)!();
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
  });

  it('show as last built while there is no dev server, when built from the files the work has now', async () => {
    const { session, pod, parts, opened } = setup();
    await parts.keep(built(), parts.builtFrom());
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    const build = opened.at(-1)!.build;
    expect(build['index.html']).toMatchObject({ type: 'text/html' });
    expect(build['assets/index-1.js']).toMatchObject({ type: 'text/javascript' });
    expect(build['index.html']!.hash).toMatch(/^sha256-/);
    expect(opened.at(-1)!.devServer).toBeNull();
    // The dev server comes up: the frames load again, from it.
    const before = parts.source.reloads.value;
    pod.portal.value = 'https://p-5173.portal.example';
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    expect(parts.source.reloads.value).toBeGreaterThan(before);
    pod.portal.value = null;
    await settled();
    expect(parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    // A source changed since the build: the build is not what the work has, so the parts wait for the workspace.
    session.commit([
      { op: 'setProjectFiles', files: { 'src/parts/meter.ts': 'export default 2;\n' } },
    ]);
    await settled();
    expect(parts.source.portal.value).toBeNull();
  });

  it('do not run where the host cannot keep them apart (no sandbox), and say so', async () => {
    const { pod, parts } = setup(hostStorage(), 'work-a', false);
    pod.portal.value = 'https://p-5173.portal.example';
    await settled();
    expect(parts.source.available).toBe(false);
    expect(parts.source.portal.value).toBeNull();
    expect(parts.source.message.value).toMatch(/cannot keep code parts apart/);
  });

  it('keep the build by work in the host storage: it is there after a restart, and not for another work', async () => {
    const first = setup();
    await first.parts.keep(built(), first.parts.builtFrom());
    const again = setup(first.storage);
    await settled();
    expect(again.parts.source.portal.value).toBe('http://work-a.localhost:5247/');
    const other = setup(first.storage, 'work-b');
    await settled();
    expect(other.parts.source.portal.value).toBeNull();
  });
});

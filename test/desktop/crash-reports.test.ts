// Crash reports in Electron (desktop/crash-reports.ts, docs/usage.md): with the
// person's yes, Sentry starts before the app is ready, and errors nobody caught in the
// main process and in den-kit's page reach Sentry without the computer's name, the IP
// address, breadcrumbs, the person's home folder or the app's keys, around den-kit's
// refusing proxy; turning crash reports off stops all sending, reports waiting to be
// sent included; a launch without a yes starts no Sentry and removes what an earlier
// launch left; a yes in Settings starts them at once. Runs test/desktop/crash-app.ts,
// with a Sentry stand-in on this machine.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build, type BuildOptions } from 'esbuild';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { MAIN_INTEGRATIONS, crashRelease } from '../../desktop/crash-reports.ts';
import { PAGE_INTEGRATIONS } from '../../desktop/page/crash-reports.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'den-kit-crash-test-'));
const data = join(dir, 'data');
/** A stand-in for one of the app's keys. */
const KEY = 'test-key-5f0c2e9a7b31d4';

interface Item {
  header: Record<string, unknown>;
  payload: Buffer;
}
interface Envelope {
  header: Record<string, unknown>;
  items: Item[];
  /** Everything but attachments, as text. */
  text: string;
}
const received: Envelope[] = [];
/** How the Sentry stand-in answers: as Sentry does, or by dropping the connection. */
let answer: 'ok' | 'drop' = 'ok';
let port = 0;
let server: ReturnType<typeof createServer>;

/** A Sentry envelope: a header line, then each item's header line and payload. */
function parse(body: Buffer): Envelope {
  let at = 0;
  const line = () => {
    const end = body.indexOf(10, at);
    const text = body.subarray(at, end < 0 ? body.length : end);
    at = end < 0 ? body.length : end + 1;
    return text;
  };
  const header = JSON.parse(line().toString('utf8')) as Record<string, unknown>;
  const items: Item[] = [];
  let text = JSON.stringify(header);
  while (at < body.length) {
    const head = line().toString('utf8');
    if (!head) continue;
    const itemHeader = JSON.parse(head) as Record<string, unknown>;
    let payload: Buffer;
    if (typeof itemHeader.length === 'number') {
      payload = body.subarray(at, at + itemHeader.length);
      at += itemHeader.length + 1;
    } else payload = line();
    items.push({ header: itemHeader, payload });
    text += `\n${head}`;
    if (itemHeader.type !== 'attachment') text += `\n${payload.toString('utf8')}`;
  }
  return { header, items, text };
}

/** The events the stand-in received, with the text of their envelopes. */
const events = () =>
  received.flatMap(envelope =>
    envelope.items
      .filter(item => item.header.type === 'event')
      .map(item => ({
        event: JSON.parse(item.payload.toString('utf8')) as Record<string, any>,
        envelope,
      })),
  );

async function until<T>(find: () => T | undefined, what: string, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(r => setTimeout(r, 100));
  }
}

const eventWith = (text: string) =>
  until(
    () =>
      events().find(({ event }) =>
        (event.exception?.values ?? []).some((v: { value?: string }) => v.value?.includes(text)),
      ),
    `a report of "${text}"`,
  );

/** A message that names a file in the person's home folder and one of the app's keys. */
const message = (where: string) =>
  `${where}: could not read ${join(homedir(), 'Music', 'song.wav')} with ${KEY}`;

let app: ElectronApplication;
let page: Page;
/** Where the app keeps crash dumps and reports waiting to be sent. */
let folders: { crashDumps: string; queue: string };

async function launch(allowed: boolean) {
  app = await electron.launch({
    args: [join(dir, 'main.cjs')],
    env: {
      // The app reaches the Sentry stand-in directly, as it reaches Sentry where there is no proxy.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !/^(https?|all|no)_proxy$/i.test(name)),
      ),
      USER_DATA: data,
      DSN: `https://publickey@sentry.test:${port}/1`,
      ALLOWED: allowed ? 'yes' : 'no',
      KEY,
      PRELOAD: join(dir, 'preload.cjs'),
      PAGE: join(dir, 'page.js'),
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
}

const test = <T>(name: string, ...args: unknown[]) =>
  app.evaluate(
    (_electron, [name, args]) => (globalThis as any).crashTest[name as string](...(args as [])),
    [name, args] as const,
  ) as Promise<T>;
const throwInMain = (text: string) => test('throwInMain', text);
const throwInPage = (text: string) =>
  page.evaluate(text => (window as any).throwInPage(text), text);
/** Files in a folder and its subfolders. */
const filesIn = (folder: string): string[] =>
  existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => join(entry.parentPath, entry.name))
    : [];

before(async () => {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=sentry.test',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  server = createServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (req, res) => {
      if (answer === 'drop') {
        req.socket.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.url?.startsWith('/api/1/envelope/'))
          received.push(
            parse(req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body),
          );
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    },
  );
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
  // Bundled like the desktop app: its main process, den-kit's preload and a page.
  const node: BuildOptions = {
    platform: 'node',
    format: 'cjs',
    bundle: true,
    external: ['electron'],
    target: 'node24',
    logLevel: 'error',
  };
  await build({
    ...node,
    entryPoints: [join(root, 'test/desktop/crash-app.ts')],
    outfile: join(dir, 'main.cjs'),
  });
  await build({
    ...node,
    entryPoints: [join(root, 'desktop/preload.ts')],
    outfile: join(dir, 'preload.cjs'),
  });
  await build({
    entryPoints: [join(root, 'test/desktop/crash-page.ts')],
    outfile: join(dir, 'page.js'),
    platform: 'browser',
    format: 'esm',
    bundle: true,
    target: 'es2022',
    logLevel: 'error',
  });
});

after(async () => {
  await app?.close().catch(() => undefined);
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('crash reports in Electron', () => {
  describe('with the person’s yes', () => {
    before(async () => {
      await launch(true);
      folders = await test('folders');
    });
    after(() => app.close());

    it('Sentry starts before the app is ready and listens for the page’s reports', async () => {
      assert.equal(await test('startedBeforeReady'), true);
      assert.equal(await test('listening'), 1);
    });

    it('an error nobody caught in the main process reaches Sentry with only what it takes to read it', async () => {
      await throwInMain(message('main'));
      const { event, envelope } = await eventWith('main: could not read');
      const value = event.exception.values[0].value as string;
      assert.match(value, /~[/\\]Music[/\\]song\.wav/);
      assert.match(value, /\[key\]/);
      assert.ok(!envelope.text.includes(homedir()), 'the home folder is out of the report');
      assert.ok(!envelope.text.includes(KEY), 'the key is out of the report');
      for (const field of ['server_name', 'user', 'request', 'extra'])
        assert.equal(event[field], undefined, field);
      assert.deepEqual(event.breadcrumbs ?? [], []);
      assert.equal(event.contexts.culture, undefined);
      assert.equal(event.contexts.device?.boot_time, undefined);
      assert.equal(event.sdk.settings.infer_ip, 'never');
      assert.deepEqual(new Set(event.sdk.integrations), MAIN_INTEGRATIONS);
      // What it takes to tell releases, systems and CPU types apart.
      assert.equal(event.release, crashRelease(await app.evaluate(({ app }) => app.getVersion())));
      assert.equal(event.contexts.app.app_arch, process.arch);
      assert.ok(event.contexts.os.name, 'the OS');
      assert.ok(event.exception.values[0].stacktrace.frames.length > 0, 'the stack');
    });

    it('an error nobody caught in den-kit’s page reaches Sentry through den-kit’s preload, scrubbed the same way', async () => {
      await page.waitForFunction(() => (window as any).__SENTRY__RENDERER_INIT__ === true);
      await throwInPage(message('page'));
      const { event, envelope } = await eventWith('page: could not read');
      assert.match(event.exception.values[0].value, /~[/\\]Music[/\\]song\.wav with \[key\]/);
      assert.ok(!envelope.text.includes(homedir()));
      assert.ok(!envelope.text.includes(KEY));
      assert.equal(event.tags['event.process'], 'renderer');
      assert.equal(event.release, crashRelease(await app.evaluate(({ app }) => app.getVersion())));
      for (const field of ['server_name', 'user', 'request', 'extra'])
        assert.equal(event[field], undefined, field);
      assert.deepEqual(event.breadcrumbs ?? [], []);
      assert.deepEqual(
        new Set(event.sdk.integrations),
        new Set([...PAGE_INTEGRATIONS, ...MAIN_INTEGRATIONS]),
      );
    });

    it('turning crash reports off stops all sending at once, reports waiting to be sent included', async () => {
      const waiting = () => filesIn(folders.queue).filter(file => !file.endsWith('.json'));
      // A report that cannot be sent waits on disk.
      answer = 'drop';
      await throwInMain(message('waiting'));
      await until(() => waiting().length > 0 || undefined, 'a report waiting to be sent');
      await test('allow', false);
      answer = 'ok';
      const before = received.length;
      await throwInMain(message('after'));
      await throwInPage(message('after'));
      // Sentry tries the waiting report again 5 seconds after it failed.
      await until(() => waiting().length === 0 || undefined, 'the waiting report to go');
      await new Promise(r => setTimeout(r, 2000));
      assert.equal(received.length, before, 'nothing reached Sentry');
    });

    it('a native crash of the page reaches Sentry with its crash dump', async () => {
      await test('allow', true);
      await test('crashPage');
      const { event } = await until(
        () =>
          events().find(({ envelope }) =>
            envelope.items.some(item => item.header.attachment_type === 'event.minidump'),
          ),
        'a report with a crash dump',
      );
      assert.equal(event.tags['event.process'], 'renderer');
      assert.equal(event.platform, 'native');
      for (const field of ['server_name', 'user', 'request', 'extra'])
        assert.equal(event[field], undefined, field);
    });
  });

  describe('without a yes', () => {
    before(async () => {
      // What an earlier launch left: a crash dump and a report waiting to be sent.
      for (const file of [
        join(folders.crashDumps, 'pending', 'left.dmp'),
        join(folders.queue, 'queue', 'left'),
      ]) {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, 'left');
      }
      await launch(false);
    });
    after(() => app.close());

    it('a launch starts no Sentry, sends nothing and removes what an earlier launch left', async () => {
      assert.deepEqual(filesIn(folders.crashDumps), []);
      assert.deepEqual(filesIn(folders.queue), []);
      assert.equal(await test('listening'), 0);
      assert.equal(await page.evaluate(() => (window as any).__SENTRY__RENDERER_INIT__), undefined);
      const before = received.length;
      await throwInMain(message('no'));
      await throwInPage(message('no'));
      await new Promise(r => setTimeout(r, 2000));
      assert.equal(received.length, before);
    });

    it('a yes in Settings starts crash reports at once, in the main process and the page', async () => {
      await test('allow', true);
      await page.evaluate(() => (window as any).startCrashReports());
      await throwInMain(message('main after yes'));
      await throwInPage(message('page after yes'));
      await eventWith('main after yes');
      const { event } = await eventWith('page after yes');
      assert.equal(event.tags['event.process'], 'renderer');
    });
  });
});

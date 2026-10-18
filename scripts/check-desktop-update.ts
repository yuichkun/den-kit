// Maintainer check on a Mac: an installed older den-kit finds, downloads and installs two newer versions through the
// real updater, the first when den-kit quits normally (without reopening it) and the second through Restart now, and
// keeps the work. It builds all three versions locally and serves them from 127.0.0.1, so no release is published and
// the person's own den-kit profile is never used. Squirrel.Mac installs only signed updates, so a
// Developer ID Application identity must be available in the keychain. Run `npm run desktop:build` first.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseVersion } from './release-version.ts';
import { appDirectory } from './check-desktop-artifacts.ts';
import type { MacArch } from './codex-native.ts';
import { waitForShell } from './desktop-shell.ts';
import { denKitRunning, listProcesses } from './clean-desktop.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const stagedPackage = join(root, '.desktop-build/app/package.json');
if (process.platform !== 'darwin') throw new Error('The update check runs on macOS.');
if (!existsSync(stagedPackage)) throw new Error('Run npm run desktop:build first.');
if (denKitRunning(listProcesses()))
  throw new Error('Quit den-kit first: the update check shares its updater caches.');
const arch: MacArch = process.arch === 'arm64' ? 'arm64' : 'x64';
// electron-updater and Squirrel.Mac keep their state in ~/Library/Caches; remove only what this check creates there.
const createdCaches = ['den-kit-updater', 'com.escentier.den-kit', 'com.escentier.den-kit.ShipIt']
  .map(name => join(homedir(), 'Library/Caches', name))
  .filter(path => !existsSync(path));
const staged = readFileSync(stagedPackage, 'utf8');
const older = JSON.parse(staged).version as string;
const parts = parseVersion(older);
if (!parts) throw new Error(`The staged version ${older} is not a plain release version.`);
const [second, third] = [1, 2].map(n => `${parts[0]}.${parts[1]}.${parts[2] + n}`) as [
  string,
  string,
];
const work = mkdtempSync(join(tmpdir(), 'den-kit-update-check-'));
const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer()
      .on('error', fail)
      .listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        server.close(error => (error ? fail(error) : done(port)));
      });
  });

function build(version: string, output: string) {
  writeFileSync(stagedPackage, JSON.stringify({ ...JSON.parse(staged), version }, null, 2));
  execFileSync(
    join(root, 'node_modules/.bin/electron-builder'),
    [
      '--config',
      'electron-builder.yml',
      '--mac',
      'zip',
      `--${arch}`,
      '--publish',
      'never',
      `-c.directories.output=${output}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
const bundleVersion = (app: string) =>
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();

let server: ReturnType<typeof createHttpServer> | undefined;
let running: ElectronApplication | undefined;
const requests: string[] = [];
// The app's own output, printed only when the check fails.
const output: string[] = [];
const step = (text: string) => console.error(`Update check: ${text}`);
try {
  step(`building ${older}, ${second} and ${third} for ${arch}`);
  for (const version of [older, second, third]) build(version, join(work, version));
  writeFileSync(stagedPackage, staged);
  const feed = join(work, 'feed');
  const serve = (version: string) => {
    rmSync(feed, { recursive: true, force: true });
    mkdirSync(feed);
    for (const name of readdirSync(join(work, version)).filter(
      n => n === 'latest-mac.yml' || /\.zip(\.blockmap)?$/.test(n),
    ))
      copyFileSync(join(work, version, name), join(feed, name));
  };
  // An installed copy outside the build output, as a person would have it (ditto keeps the signature intact).
  const app = join(work, 'installed', 'den-kit.app');
  mkdirSync(join(work, 'installed'));
  execFileSync('ditto', [join(work, older, appDirectory(arch), 'den-kit.app'), app]);
  for (const bundle of [
    app,
    ...[second, third].map(version => join(work, version, appDirectory(arch), 'den-kit.app')),
  ])
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
  assert.equal(bundleVersion(app), older);

  server = createHttpServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1));
    requests.push(name);
    const file = resolve(feed, name);
    if (!file.startsWith(feed + '/') || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  const feedPort = await new Promise<number>(done =>
    server!.listen(0, '127.0.0.1', () => done((server!.address() as { port: number }).port)),
  );
  const env = {
    ...process.env,
    KIT_DESKTOP_USER_DATA: join(work, 'profile'),
    KIT_DESKTOP_CHECK_PORT: String(await freePort()),
    KIT_DESKTOP_UPDATE_URL: `http://127.0.0.1:${feedPort}/`,
  };
  const launch = async () => {
    const launched = (running = await electron.launch({
      executablePath: join(app, 'Contents/MacOS/den-kit'),
      env,
      timeout: 60000,
    }));
    for (const stream of [launched.process().stdout, launched.process().stderr])
      stream?.on('data', data => output.push(String(data)));
    const page = await launched.firstWindow();
    await page.waitForFunction(
      () => !!(window as unknown as { __kit?: unknown }).__kit,
      undefined,
      { timeout: 60000 },
    );
    return { launched, page };
  };
  const appState = (page: Page) =>
    page.evaluate(async () => ({
      version: (await window.denKitShell!.info()).version,
      name: (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit
        .doc.value.name,
    }));
  const untilStaged = async (page: Page, version: string) => {
    const { update } = await waitForShell(
      page,
      info => ['ready', 'error', 'move'].includes(info.update.state),
      { timeout: 300000, interval: 1000 },
    );
    assert.deepEqual(update, { state: 'ready', version });
    await page.locator('[data-testid=desktop-update-ready]').waitFor({ timeout: 10000 });
  };
  const installed = async (version: string) => {
    const deadline = Date.now() + 120000;
    while (bundleVersion(app) !== version && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 1000));
    assert.equal(
      bundleVersion(app),
      version,
      `Squirrel.Mac did not install ${version} after den-kit quit.`,
    );
    execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  };
  const exitOf = (launched: ElectronApplication) =>
    new Promise<void>(done => launched.process().once('exit', () => done()));

  // 1. An ordinary quit (⌘Q) installs the staged update and leaves den-kit closed.
  serve(second);
  step(`installed ${older}; serving ${second} from 127.0.0.1`);
  let { launched, page } = await launch();
  await page.evaluate(() => {
    const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit;
    k.doc.value = { ...k.doc.value, name: 'Update check work' };
  });
  await untilStaged(page, second);
  step(`${second} is staged; quitting den-kit normally`);
  let exited = exitOf(launched);
  await launched
    .evaluate(({ app: electronApp }) => {
      electronApp.quit();
    })
    .catch(() => undefined);
  await exited;
  running = undefined;
  await installed(second);
  // Squirrel.Mac reopens den-kit only when Restart now asks it to. ps may show the path under /private/var.
  await new Promise(r => setTimeout(r, 10000));
  assert.ok(
    !listProcesses().includes(`${basename(work)}/installed/den-kit.app/Contents/MacOS/den-kit`),
    'den-kit reopened after an ordinary quit.',
  );

  // 2. Restart now installs the next update. Isolated checks do not reopen den-kit, so nothing runs outside this profile.
  serve(third);
  step(`installed ${second} on quit; serving ${third}`);
  ({ launched, page } = await launch());
  assert.deepEqual(await appState(page), { version: second, name: 'Update check work' });
  await untilStaged(page, third);
  step(`${third} is staged; installing with Restart now`);
  exited = exitOf(launched);
  // The page may close before evaluate returns.
  await page
    .evaluate(() => {
      void window.denKitShell!.installUpdate();
    })
    .catch(() => undefined);
  await exited;
  running = undefined;
  await installed(third);

  step(`installed ${third}; reopening`);
  ({ launched, page } = await launch());
  const after = await appState(page);
  await launched.close();
  running = undefined;
  assert.deepEqual(after, { version: third, name: 'Update check work' });
  console.log(
    JSON.stringify({
      arch,
      quit: `${older} → ${second}`,
      restartNow: `${second} → ${third}`,
      reopenedAfterQuit: false,
      served: [...new Set(requests)],
      work: 'kept after both installs',
    }),
  );
} catch (error) {
  if (output.length)
    console.error(`den-kit output:\n${output.join('').split('\n').slice(-60).join('\n')}`);
  throw error;
} finally {
  // Close the app before removing its profile, so a failure is reported instead of a cleanup error.
  await running?.close().catch(() => undefined);
  writeFileSync(stagedPackage, staged);
  server?.close();
  for (const path of createdCaches) rmSync(path, { recursive: true, force: true });
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.error(
      `Could not remove ${work}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

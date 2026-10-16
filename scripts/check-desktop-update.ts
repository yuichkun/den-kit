// Maintainer check on a Mac: an installed older den-kit finds, downloads and installs a newer one through the real
// updater, and keeps the work. It builds both versions locally and serves them from 127.0.0.1, so no release is
// published and the person's own den-kit profile is never used. Squirrel.Mac installs only signed updates, so a
// Developer ID Application identity must be available in the keychain. Run `npm run desktop:build` first.
import { _electron as electron, type ElectronApplication } from 'playwright';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseVersion } from './release-version.ts';
import { appDirectory } from './check-desktop-artifacts.ts';
import type { MacArch } from './codex-native.ts';
import { waitForShell } from './desktop-shell.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const stagedPackage = join(root, '.desktop-build/app/package.json');
if (process.platform !== 'darwin') throw new Error('The update check runs on macOS.');
if (!existsSync(stagedPackage)) throw new Error('Run npm run desktop:build first.');
const arch: MacArch = process.arch === 'arm64' ? 'arm64' : 'x64';
const staged = readFileSync(stagedPackage, 'utf8');
const older = JSON.parse(staged).version as string;
const parts = parseVersion(older);
if (!parts) throw new Error(`The staged version ${older} is not a plain release version.`);
const newer = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const work = mkdtempSync(join(tmpdir(), 'den-kit-update-check-'));
const freePort = () => new Promise<number>((done, fail) => {
  const server = createServer().on('error', fail).listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    server.close(error => error ? fail(error) : done(port));
  });
});

function build(version: string, output: string) {
  writeFileSync(stagedPackage, JSON.stringify({ ...JSON.parse(staged), version }, null, 2));
  execFileSync(join(root, 'node_modules/.bin/electron-builder'), ['--config', 'electron-builder.yml', '--mac', 'zip', `--${arch}`, '--publish', 'never', `-c.directories.output=${output}`], { cwd: root, stdio: 'inherit' });
}
const bundleVersion = (app: string) => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();

let server: ReturnType<typeof createHttpServer> | undefined;
let running: ElectronApplication | undefined;
const requests: string[] = [];
// The app's own output, printed only when the check fails.
const output: string[] = [];
const step = (text: string) => console.error(`Update check: ${text}`);
try {
  step(`building ${older} and ${newer} for ${arch}`);
  build(older, join(work, 'older'));
  build(newer, join(work, 'newer'));
  writeFileSync(stagedPackage, staged);
  const feed = join(work, 'feed');
  mkdirSync(feed);
  for (const name of readdirSync(join(work, 'newer')).filter(n => n === 'latest-mac.yml' || /\.zip(\.blockmap)?$/.test(n))) copyFileSync(join(work, 'newer', name), join(feed, name));
  // An installed copy outside the build output, as a person would have it (ditto keeps the signature intact).
  const app = join(work, 'installed', 'den-kit.app');
  mkdirSync(join(work, 'installed'));
  execFileSync('ditto', [join(work, 'older', appDirectory(arch), 'den-kit.app'), app]);
  for (const bundle of [app, join(work, 'newer', appDirectory(arch), 'den-kit.app')]) execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
  assert.equal(bundleVersion(app), older);

  server = createHttpServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1));
    requests.push(name);
    const file = resolve(feed, name);
    if (!file.startsWith(feed + '/') || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(readFileSync(file));
  });
  const feedPort = await new Promise<number>(done => server!.listen(0, '127.0.0.1', () => done((server!.address() as { port: number }).port)));
  const env = { ...process.env, KIT_DESKTOP_USER_DATA: join(work, 'profile'), KIT_DESKTOP_CHECK_PORT: String(await freePort()), KIT_DESKTOP_UPDATE_URL: `http://127.0.0.1:${feedPort}/` };
  const launch = async () => {
    const launched = running = await electron.launch({ executablePath: join(app, 'Contents/MacOS/den-kit'), env, timeout: 60000 });
    for (const stream of [launched.process().stdout, launched.process().stderr]) stream?.on('data', data => output.push(String(data)));
    const page = await launched.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { __kit?: unknown }).__kit, undefined, { timeout: 60000 });
    return { launched, page };
  };

  step(`installed ${older}; serving ${newer} from 127.0.0.1`);
  let { launched, page } = await launch();
  await page.evaluate(() => { const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit; k.doc.value = { ...k.doc.value, name: 'Update check work' }; });
  const { update: ready } = await waitForShell(page, info => ['ready', 'error', 'move'].includes(info.update.state), { timeout: 300000, interval: 1000 });
  assert.deepEqual(ready, { state: 'ready', version: newer });
  await page.locator('[data-testid=desktop-update-ready]').waitFor({ timeout: 10000 });
  step(`${newer} is staged; restarting to install it`);
  const exited = new Promise<void>(done => launched.process().once('exit', () => done()));
  // Isolated checks install on quit without relaunching outside this profile. The page may close before evaluate returns.
  await page.evaluate(() => { void window.denKitShell!.installUpdate(); }).catch(() => undefined);
  await exited;
  running = undefined;
  const deadline = Date.now() + 120000;
  while (bundleVersion(app) !== newer && Date.now() < deadline) await new Promise(r => setTimeout(r, 1000));
  assert.equal(bundleVersion(app), newer, 'Squirrel.Mac did not install the update after quitting.');
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);

  step(`installed ${newer}; reopening`);
  ({ launched, page } = await launch());
  const after = await page.evaluate(async () => ({ version: (await window.denKitShell!.info()).version, name: (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc.value.name }));
  await launched.close();
  running = undefined;
  assert.deepEqual(after, { version: newer, name: 'Update check work' });
  console.log(JSON.stringify({ arch, from: older, to: newer, served: [...new Set(requests)], work: 'kept after install' }));
} catch (error) {
  if (output.length) console.error(`den-kit output:\n${output.join('').split('\n').slice(-60).join('\n')}`);
  throw error;
} finally {
  // Close the app before removing its profile, so a failure is reported instead of a cleanup error.
  await running?.close().catch(() => undefined);
  writeFileSync(stagedPackage, staged);
  server?.close();
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
  catch (error) { console.error(`Could not remove ${work}: ${error instanceof Error ? error.message : String(error)}`); }
}

// Checks electron-builder's macOS output before anything is published: both architectures, the update feed,
// the bundled Codex CLI, and (with --signed / --notarized) the Developer ID signature and notarization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAC_ARCHES, machoArch, type MacArch } from './codex-native.ts';
import { describeFailure, withNetworkRetries } from './notarize.ts';

export interface UpdateFile {
  url: string;
  sha512: string;
  size: number;
}
export interface UpdateInfo {
  version: string;
  files: UpdateFile[];
}

/** Reads the subset of latest-mac.yml written by electron-builder that the updater depends on. */
export function parseUpdateInfo(text: string): UpdateInfo {
  const info: UpdateInfo = { version: '', files: [] };
  let inFiles = false;
  for (const line of text.split('\n')) {
    const top = /^(\w+):\s*(.*)$/.exec(line);
    if (top) {
      inFiles = top[1] === 'files';
      if (top[1] === 'version') info.version = unquote(top[2]!);
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s+-\s+url:\s*(.+)$/.exec(line);
    if (item) {
      info.files.push({ url: unquote(item[1]!), sha512: '', size: 0 });
      continue;
    }
    const field = /^\s+(sha512|size):\s*(.+)$/.exec(line);
    const current = info.files.at(-1);
    if (field && current) {
      if (field[1] === 'sha512') current.sha512 = unquote(field[2]!);
      else current.size = Number(field[2]);
    }
  }
  return info;
}
const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

export const packageNames = (version: string) =>
  MAC_ARCHES.flatMap(arch => [`den-kit-${version}-${arch}.dmg`, `den-kit-${version}-${arch}.zip`]);
/** electron-builder's unpacked app directory for each architecture. */
export const appDirectory = (arch: MacArch) => (arch === 'arm64' ? 'mac-arm64' : 'mac');

/** codesign and spctl report on stderr, stapler on stdout. */
function report(command: string, args: string[]) {
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(describeFailure(`${command} ${args.join(' ')}`, run));
  return `${run.stdout}${run.stderr}`;
}

function plist(app: string, key: string) {
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print :${key}`, join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
}

async function checkApp(
  app: string,
  arch: MacArch,
  version: string,
  options: { signed: boolean; notarized: boolean; team?: string },
) {
  assert.equal(
    machoArch(join(app, 'Contents/MacOS/den-kit')),
    arch,
    `${app} is not a ${arch} app.`,
  );
  assert.equal(
    machoArch(join(app, 'Contents/Resources/codex/bin/codex')),
    arch,
    `${app} bundles a Codex CLI for the wrong architecture.`,
  );
  assert.equal(plist(app, 'CFBundleShortVersionString'), version);
  assert.doesNotMatch(
    plist(app, 'NSMicrophoneUsageDescription'),
    /voice/i,
    'den-kit does not offer voice input.',
  );
  // English variants only (en_GB, Chromium's gendered en_* packs); macOS and Chromium would otherwise use the system language.
  for (const resources of [
    join(app, 'Contents/Resources'),
    join(app, 'Contents/Frameworks/Electron Framework.framework/Resources'),
  ]) {
    const localizations = readdirSync(resources).filter(name => name.endsWith('.lproj'));
    assert.ok(
      localizations.includes('en.lproj'),
      `${resources} is missing the English localization.`,
    );
    assert.deepEqual(
      localizations.filter(name => !/^en(_[A-Z]+)*\.lproj$/.test(name)),
      [],
      `${resources} must contain only English localizations.`,
    );
  }
  const feed = readFileSync(join(app, 'Contents/Resources/app-update.yml'), 'utf8');
  assert.match(feed, /provider: github/);
  assert.match(feed, /owner: yuichkun/);
  assert.match(feed, /repo: den-kit/);
  const operator = JSON.parse(readFileSync(join(app, 'Contents/Resources/operator.json'), 'utf8'));
  assert.ok(
    typeof operator.browserPodKey === 'string' && operator.browserPodKey.length > 0,
    'The operator BrowserPod key is missing.',
  );
  if (!options.signed) return;
  report('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  for (const binary of [app, join(app, 'Contents/Resources/codex/bin/codex')]) {
    const details = report('codesign', ['-dv', '--verbose=4', binary]);
    assert.match(
      details,
      /Authority=Developer ID Application: /,
      `${binary} is not signed with a Developer ID Application identity.`,
    );
    assert.match(
      details,
      /flags=0x10000\(runtime\)/,
      `${binary} is not signed with the hardened runtime.`,
    );
    if (options.team)
      assert.match(
        details,
        new RegExp(`TeamIdentifier=${options.team}\\b`),
        `${binary} is signed by another team.`,
      );
  }
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', app], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const key of ['com.apple.security.cs.allow-jit', 'com.apple.security.device.audio-input'])
    assert.ok(entitlements.includes(key), `${key} is missing.`);
  for (const key of [
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.disable-library-validation',
  ])
    assert.ok(!entitlements.includes(key), `${key} must not be granted.`);
  if (!options.notarized) return;
  // stapler compares the stapled ticket with the one at Apple's ticket service, so a dropped connection is retried.
  await withNetworkRetries(`xcrun stapler validate -v ${app}`, () =>
    spawnSync('xcrun', ['stapler', 'validate', '-v', app], { encoding: 'utf8' }),
  );
  assert.match(
    report('spctl', ['--assess', '--type', 'execute', '-vv', app]),
    /source=Notarized Developer ID/,
    `${app} is not accepted as a notarized Developer ID app.`,
  );
}

export async function checkArtifacts(
  dir: string,
  options: { signed: boolean; notarized: boolean; team?: string; version: string },
) {
  for (const name of packageNames(options.version))
    assert.ok(existsSync(join(dir, name)), `${name} is missing.`);
  const info = parseUpdateInfo(readFileSync(join(dir, 'latest-mac.yml'), 'utf8'));
  assert.equal(info.version, options.version, 'latest-mac.yml describes another version.');
  const zips = MAC_ARCHES.map(arch => `den-kit-${options.version}-${arch}.zip`);
  assert.deepEqual(
    info.files
      .map(file => file.url)
      .filter(url => url.endsWith('.zip'))
      .sort(),
    zips.sort(),
    'latest-mac.yml must list the zip of each architecture.',
  );
  for (const file of info.files) {
    const path = join(dir, file.url);
    assert.ok(existsSync(path), `${file.url} from latest-mac.yml is missing.`);
    assert.equal(
      statSync(path).size,
      file.size,
      `${file.url} does not match its size in latest-mac.yml.`,
    );
    assert.equal(
      createHash('sha512').update(readFileSync(path)).digest('base64'),
      file.sha512,
      `${file.url} does not match its checksum in latest-mac.yml.`,
    );
  }
  for (const arch of MAC_ARCHES)
    await checkApp(join(dir, appDirectory(arch), 'den-kit.app'), arch, options.version, options);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const dir = resolve(args.find(arg => !arg.startsWith('--')) ?? 'release');
    const team = args.find(arg => arg.startsWith('--team='))?.slice('--team='.length);
    const root = fileURLToPath(new URL('..', import.meta.url));
    const version = JSON.parse(readFileSync(join(root, '.desktop-build/app/package.json'), 'utf8'))
      .version as string;
    await checkArtifacts(dir, {
      signed: args.includes('--signed') || args.includes('--notarized'),
      notarized: args.includes('--notarized'),
      team,
      version,
    });
    console.log(
      `den-kit ${version} packages for ${MAC_ARCHES.join(' and ')} passed${args.includes('--notarized') ? ' signing and notarization' : args.includes('--signed') ? ' signing' : ''} checks.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

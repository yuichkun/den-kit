import { afterEach, expect, it } from 'vite-plus/test';
import { AppInfo } from 'app-builder-lib/out/appInfo.js';
import type { Packager } from 'app-builder-lib/out/packager.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LINK_EXECUTABLE, requirePackagedLinkApp } from '../../../scripts/link-paths.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'den-kit-link-launch-'));
  roots.push(root);
  return root;
}

it.each(['arm64', 'x64'] as const)('finds the %s bundle named by electron-builder', arch => {
  // Use the pinned packager's naming rule, not the launcher's guessed display name.
  const info = new AppInfo(
    {
      metadata: { name: 'den-kit-link-prototype', version: '0.1.2' },
      config: { productName: 'den-kit Link Prototype', executableName: LINK_EXECUTABLE },
    } as Packager,
    undefined,
  );
  const root = fixtureRoot();
  const app = join(
    root,
    'release-link',
    arch === 'arm64' ? 'mac-arm64' : 'mac',
    `${info.productFilename}.app`,
  );
  const binaries = join(app, 'Contents', 'MacOS');
  mkdirSync(binaries, { recursive: true });
  writeFileSync(join(binaries, info.productFilename), 'packaged executable');
  expect(requirePackagedLinkApp(root, arch)).toBe(app);
});

it('rejects an incomplete bundle and reports the expected path', () => {
  const root = fixtureRoot();
  const app = join(root, 'release-link/mac-arm64/den-kit-link-prototype.app');
  mkdirSync(app, { recursive: true });
  expect(() => requirePackagedLinkApp(root, 'arm64')).toThrow(app);
  expect(() => requirePackagedLinkApp(root, 'arm64')).toThrow('vp run desktop:link:package');
});

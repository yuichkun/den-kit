import { afterEach, expect, it } from 'vite-plus/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedMacApp } from '../../../scripts/desktop-paths.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['arm64', 'x64'] as const)(
  'reads the operator and executable from the %s package',
  arch => {
    const root = mkdtempSync(join(tmpdir(), 'den-kit-package-paths-'));
    roots.push(root);
    // Build both electron-builder layouts, so selecting the other architecture is observable.
    for (const [folder, builtArch] of [
      ['mac-arm64', 'arm64'],
      ['mac', 'x64'],
    ]) {
      const contents = join(root, 'release', folder, 'den-kit.app', 'Contents');
      mkdirSync(join(contents, 'Resources'), { recursive: true });
      mkdirSync(join(contents, 'MacOS'), { recursive: true });
      writeFileSync(
        join(contents, 'Resources/operator.json'),
        JSON.stringify({ browserPodKey: `test-${builtArch}` }),
      );
      writeFileSync(join(contents, 'MacOS/den-kit'), builtArch);
    }
    const app = packagedMacApp(root, arch);
    expect(JSON.parse(readFileSync(join(app, 'Contents/Resources/operator.json'), 'utf8'))).toEqual(
      { browserPodKey: `test-${arch}` },
    );
    expect(readFileSync(join(app, 'Contents/MacOS/den-kit'), 'utf8')).toBe(arch);
  },
);

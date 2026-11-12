import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../bridge/env.ts';
import { isProblem, resolveCodex } from '../bridge/codex/process.ts';
import { MAC_ARCHES, stageMacCodex } from './codex-native.ts';
import { BUNDLED_PACKAGES, desktopLicenses } from './licenses.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const staging = join(root, '.desktop-build');
const app = join(staging, 'app');
const resources = join(staging, 'resources');
// One native Codex CLI per architecture; electron-builder copies the matching one into Resources/codex.
const codex = join(staging, 'codex');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const env: NodeJS.ProcessEnv = { ...process.env };
loadEnvFile(join(root, '.env'), env);
if (!env.BROWSERPOD_API_KEY?.trim())
  throw new Error(
    'BrowserPod is required. The operator must set BROWSERPOD_API_KEY before building a desktop app; users must not supply their own key.',
  );
rmSync(staging, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
mkdirSync(resources, { recursive: true });
// The metafiles say which packages each bundle holds, for the license notices.
const main = await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'desktop/main.ts')],
  outfile: join(app, 'main.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  target: 'node24',
  sourcemap: true,
  metafile: true,
});
const preload = await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'desktop/preload.ts')],
  outfile: join(app, 'preload.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  target: 'node24',
  metafile: true,
});
// The builds' package lists are for the license notices, not for the app.
cpSync(join(root, 'dist'), join(app, 'renderer'), {
  recursive: true,
  filter: source => basename(source) !== BUNDLED_PACKAGES,
});
cpSync(join(root, 'build/icon.png'), join(resources, 'icon.png'));
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'den-kit',
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      main: 'main.cjs',
      dependencies: {},
    },
    null,
    2,
  ),
);
// Prevent the packager from walking up to the repository's development node_modules.
mkdirSync(join(app, 'node_modules'));

// Only operator-controlled service credentials. No ChatGPT login, local config or logs are ever packaged.
// Shipping the BrowserPod key breaks principle 1 in docs/principles.md.
writeFileSync(
  join(resources, 'operator.json'),
  JSON.stringify({ browserPodKey: env.BROWSERPOD_API_KEY || undefined }),
  { mode: 0o600 },
);
let codexVersion: string | null = null;
if (process.platform === 'darwin') {
  // Both Mac architectures ship from one build, so stage both Codex binaries from the locked packages.
  for (const arch of MAC_ARCHES)
    codexVersion = await stageMacCodex({ root, arch, destination: join(codex, arch) });
} else {
  const command = resolveCodex(root, {});
  if (isProblem(command)) throw new Error(command.error);
  // Keep the native CLI's relative layout, including its helper binaries and notices.
  cpSync(dirname(dirname(command.command)), join(codex, process.arch), { recursive: true });
  chmodSync(
    join(codex, process.arch, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    0o755,
  );
  codexVersion = command.version;
}
// Help → Licenses (scripts/licenses.ts).
writeFileSync(
  join(resources, 'licenses.html'),
  desktopLicenses({
    root,
    builds: [join(root, 'dist', BUNDLED_PACKAGES), join(root, 'dist/player', BUNDLED_PACKAGES)],
    metafiles: [main.metafile, preload.metafile],
    codex: {
      version: codexVersion ?? 'unknown',
      folders:
        process.platform === 'darwin'
          ? MAC_ARCHES.map(arch => join(codex, arch))
          : [join(codex, process.arch)],
    },
  }),
);
console.log(
  `Desktop built for ${process.platform === 'darwin' ? `macOS ${MAC_ARCHES.join(' and ')}` : `${process.platform}/${process.arch}`}; Codex ${codexVersion ?? 'version unknown'} bundled; BrowserPod configured.`,
);

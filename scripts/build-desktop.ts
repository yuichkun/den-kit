import { build } from 'esbuild';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../bridge/env.ts';
import { isProblem, resolveCodex } from '../bridge/codex/process.ts';
import { MAC_ARCHES, stageMacCodex } from './codex-native.ts';

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
await build({
  entryPoints: [join(root, 'desktop/main.ts')],
  outfile: join(app, 'main.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  target: 'node24',
  sourcemap: true,
});
await build({
  entryPoints: [join(root, 'desktop/preload.ts')],
  outfile: join(app, 'preload.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  target: 'node24',
});
cpSync(join(root, 'dist'), join(app, 'renderer'), { recursive: true });
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
// Preserve the licenses of bundled production dependencies (including transitive packages and fonts).
const notices = join(resources, 'licenses');
mkdirSync(notices);
cpSync(join(root, 'LICENSE-MIT'), join(notices, 'den-kit-MIT.txt'));
cpSync(join(root, 'LICENSE-APACHE'), join(notices, 'den-kit-Apache-2.0.txt'));
const seen = new Set<string>();
function licenses(name: string) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = join(root, 'node_modules', name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const dep = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const file of readdirSync(dir).filter(n =>
    /^(licen[sc]e|copying|notice)([.-]|$)/i.test(n),
  )) {
    cpSync(join(dir, file), join(notices, `${name.replace(/[/@]/g, '_')}-${file}`), {
      recursive: true,
    });
  }
  for (const child of Object.keys(dep.dependencies ?? {})) licenses(child);
}
for (const name of [...Object.keys(pkg.dependencies), '@openai/codex']) licenses(name);
writeFileSync(
  join(notices, 'README.txt'),
  'den-kit: MIT OR Apache-2.0. Native OpenAI Codex CLI: Apache-2.0; see den-kit-Apache-2.0.txt for the license text. Electron and Chromium notices are supplied with the framework. BrowserPod SDK/service use is subject to the operator’s commercial BrowserPod license. This folder preserves bundled package notices; formal publication review remains separate.\n',
);

// Only operator-controlled service credentials. No ChatGPT login, local config or logs are ever packaged.
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
console.log(
  `Desktop built for ${process.platform === 'darwin' ? `macOS ${MAC_ARCHES.join(' and ')}` : `${process.platform}/${process.arch}`}; Codex ${codexVersion ?? 'version unknown'} bundled; BrowserPod configured.`,
);

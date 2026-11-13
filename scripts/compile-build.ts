// Build-time inputs shared by the editor and the player's isolated compiler:
// the public module registry, the worklet runtime and codebox type declarations.
import { build } from 'esbuild';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('..', import.meta.url));
const den = dirname(dirname(fileURLToPath(import.meta.resolve('@denaudio/den'))));

/** Every public den entry, read from the package's exports. */
export function denModules(): string[] {
  const exports = JSON.parse(readFileSync(join(den, 'package.json'), 'utf8')).exports;
  return Object.keys(exports).map(key =>
    key === '.' ? '@denaudio/den' : `@denaudio/den/${key.slice(2)}`,
  );
}

let runtime: Promise<string> | undefined;
function workletRuntime() {
  runtime ??= build({
    stdin: {
      contents:
        "import { makeWorkletNamespaceFromMeta } from '@unworklet/core/worklet'; globalThis.__uwkMakeNs = makeWorkletNamespaceFromMeta;",
      resolveDir: kit,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
  }).then(result => result.outputFiles[0]!.text);
  return runtime;
}

/** Type declarations for codebox checking, without the DOM. */
function typeFiles() {
  const files: Record<string, string> = {};
  const core = realpathSync(join(kit, 'node_modules/@unworklet/core'));
  const pkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  files['/project/node_modules/@unworklet/core/package.json'] = readFileSync(
    join(core, 'package.json'),
    'utf8',
  );
  for (const entry of readdirSync(join(core, 'dist')))
    if (entry.endsWith('.d.mts'))
      files[`/project/node_modules/@unworklet/core/dist/${entry}`] = readFileSync(
        join(core, 'dist', entry),
        'utf8',
      );
  const lib = join(kit, 'node_modules/typescript/lib');
  for (const entry of readdirSync(lib))
    if (/^lib\.(es\d{4}|es5|decorators)[\w.]*\.d\.ts$/.test(entry))
      files[`/project/node_modules/typescript/lib/${entry}`] = readFileSync(
        join(lib, entry),
        'utf8',
      );
  return { files, packages: { '@unworklet/core': { version: pkg.version as string } } };
}

export async function compilerVirtualSource(id: string): Promise<string | null> {
  if (id === '\0virtual:kit-modules') {
    const modules = ['@unworklet/core', ...denModules()];
    return (
      modules.map((name, i) => `import * as m${i} from ${JSON.stringify(name)};`).join('\n') +
      `\nexport default {${modules.map((name, i) => `${JSON.stringify(name)}:m${i}`).join(',')}};`
    );
  }
  if (id === '\0virtual:kit-runtime')
    return `export default ${JSON.stringify(await workletRuntime())};`;
  if (id === '\0virtual:kit-types') return `export default ${JSON.stringify(typeFiles())};`;
  return null;
}

/** A worker with no imports: it can run under an opaque frame's network-denying CSP. */
export async function playerCompilerBundle() {
  const result = await build({
    absWorkingDir: kit,
    entryPoints: ['src/sound/compile/compiler.worker.ts'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    // A classic Blob worker can load under the opaque frame's origin. Binaryen
    // uses top-level await, so wrap the self-contained module in an async function.
    format: 'esm',
    banner: { js: '(async () => {' },
    footer: {
      js: `})().then(() => postMessage({ type: 'player-compiler-ready' }), error => postMessage({ type: 'player-compiler-error', message: String(error) }));`,
    },
    target: 'es2022',
    minify: true,
    // Binaryen also supports Node; this bundle runs only in a browser worker.
    define: { 'globalThis.process': 'undefined', 'import.meta.url': 'self.location.href' },
    external: ['node:*'],
    plugins: [
      {
        name: 'den-kit-compiler-inputs',
        setup(plugin) {
          plugin.onResolve({ filter: /^wavefile$/ }, () => ({
            path: join(kit, 'src/sound/compile/wavefile-default.ts'),
          }));
          plugin.onResolve({ filter: /^virtual:kit-/ }, args => ({
            path: args.path,
            namespace: 'kit',
          }));
          plugin.onLoad({ filter: /.*/, namespace: 'kit' }, async args => ({
            contents: (await compilerVirtualSource(`\0${args.path}`))!,
            resolveDir: kit,
          }));
        },
      },
    ],
  });
  for (const output of Object.values(result.metafile.outputs)) {
    if (
      output.exports.length ||
      output.imports.some(entry => entry.kind !== 'dynamic-import' || entry.path !== 'node:module')
    )
      throw new Error('The player compiler must be self-contained.');
  }
  return result;
}

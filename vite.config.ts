import { defineConfig, lazyPlugins } from 'vite-plus';
import type { Plugin } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import { build } from 'esbuild';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = dirname(fileURLToPath(import.meta.url));
const den = dirname(dirname(fileURLToPath(import.meta.resolve('@denaudio/den'))));
const bridgePort = Number(process.env.KIT_BRIDGE_PORT ?? 5181);

/** Every public den entry, read from the root package exports (same source of truth as the playground). */
export function denModules(): string[] {
  const exports = JSON.parse(readFileSync(join(den, 'package.json'), 'utf8')).exports as Record<
    string,
    unknown
  >;
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

/** Type declarations for codebox checking: @unworklet/core plus the ES libs (no DOM: codebox runs in the worklet). */
function typeFiles() {
  const files: Record<string, string> = {};
  const core = realpathSync(join(kit, 'node_modules/@unworklet/core'));
  const pkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  files['/project/node_modules/@unworklet/core/package.json'] = readFileSync(
    join(core, 'package.json'),
    'utf8',
  );
  for (const entry of readdirSync(join(core, 'dist')))
    if (/\.d\.mts$/.test(entry))
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

function kitVirtual(): Plugin {
  let serving = false;
  return {
    name: 'den-kit-virtual',
    enforce: 'pre',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    resolveId(id) {
      if (id.startsWith('virtual:kit-')) return `\0${id}`;
    },
    async load(id) {
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
      // Set by scripts/dev.ts (and the e2e harness) after the bridge is listening; null in builds.
      if (id === '\0virtual:kit-bridge')
        return `export default ${JSON.stringify({ token: process.env.KIT_BRIDGE_TOKEN ?? null })};`;
      // The pod (BrowserPod) boots in the page, so its key goes to the page (.env, read by scripts/dev.ts) — only
      // from the dev server: a build never carries it. KIT_FAKE_POD_URL is set only by the e2e harness (a test stand-in).
      if (id === '\0virtual:kit-pod')
        return `export default ${JSON.stringify(serving ? { apiKey: process.env.BROWSERPOD_API_KEY || null, fakeUrl: process.env.KIT_FAKE_POD_URL || null } : { apiKey: null, fakeUrl: null })};`;
    },
  };
}

const alias = [
  // See src/compile/wavefile-default.ts (needed by @unworklet/offline in the render worker).
  { find: /^wavefile$/, replacement: join(kit, 'src/compile/wavefile-default.ts') },
];

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: kit,
  plugins: lazyPlugins(() => [
    kitVirtual(),
    vue({ template: { compilerOptions: { isCustomElement: tag => tag.startsWith('dk-') } } }),
  ]),
  resolve: { alias, dedupe: ['@unworklet/core'] },
  worker: { format: 'es', plugins: () => [kitVirtual()] },
  server: {
    port: Number(process.env.KIT_PORT ?? 5180),
    strictPort: true,
    host: '127.0.0.1',
    // Cross-origin isolation: the pod (BrowserPod) needs SharedArrayBuffer.
    headers: ISOLATION,
    fs: { allow: [kit] },
    proxy: {
      '/__kit/ws': { target: `ws://127.0.0.1:${bridgePort}`, ws: true },
      '/__kit/token': { target: `http://127.0.0.1:${bridgePort}` },
    },
  },
  // Pre-bundle up front so the first visit does not trigger a reload.
  // BrowserPod is loaded only when a work first needs the pod: listed here so Vite prepares it at start
  // (found later, Vite would prepare it then and reload the page in the middle of the AI's first command).
  optimizeDeps: {
    include: [
      'vue',
      '@vue-flow/core',
      '@vue-flow/background',
      '@unworklet/core',
      '@unworklet/core/worklet',
      '@unworklet/offline',
      'typescript',
      '@leaningtech/browserpod',
      ...denModules(),
    ],
    rolldownOptions: { transform: { target: 'es2022' } },
  },
  preview: { headers: ISOLATION },
  build: { target: 'es2022', chunkSizeWarningLimit: 20000, reportCompressedSize: false },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          maxWorkers: 1,
          testTimeout: 180000,
          hookTimeout: 180000,
        },
      },
    ],
  },
  // In templates, Vue removes white space that holds a line break between two elements and keeps other
  // white space as one space. So a space that shows between inline elements stays on one line
  // (<!-- prettier-ignore -->), and text shown with white-space: pre-wrap is bound with v-text.
  fmt: {
    singleQuote: true,
    semi: true,
    arrowParens: 'avoid',
    printWidth: 100,
    sortPackageJson: false,
    // The pod's own tooling files: npm writes package.json and package-lock.json there, and ESLint reads eslint.config.js.
    ignorePatterns: [
      'pod-template/package.json',
      'pod-template/package-lock.json',
      'pod-template/eslint.config.js',
    ],
  },
  // Types are checked by vue-tsc (the typecheck script): Oxlint's type-aware checks do not read .vue files.
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    // The pod template runs on its own Vite, not Vite+.
    overrides: [
      { files: ['pod-template/**'], rules: { 'vite-plus/prefer-vite-plus-imports': 'off' } },
    ],
  },
});

// The player's own build (dist/player/, after den-kit's): player.html and its files
// at relative paths, with a manifest that lists them, so den-kit can copy the player
// into a work's playable build (src/editor/playable.ts).
import { defineConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledPackages } from './scripts/licenses.ts';
import { compilerVirtualSource, playerCompilerBundle } from './scripts/compile-build.ts';

const kit = dirname(fileURLToPath(import.meta.url));
// The packages the player bundles, for the desktop app's license notices (scripts/licenses.ts).
const packages = bundledPackages(kit, ['typescript', '@unworklet/core']);

export default defineConfig({
  root: kit,
  base: './',
  // den-kit's own public files (the showcase) are not the player's.
  publicDir: false,
  plugins: [
    {
      name: 'den-kit-player-compiler',
      resolveId(id) {
        if (id === 'virtual:player-compiler') return '\0' + id;
        if (id === 'virtual:kit-runtime') return '\0' + id;
      },
      async load(id) {
        if (id === '\0virtual:kit-runtime') return compilerVirtualSource(id);
        if (id !== '\0virtual:player-compiler') return;
        const result = await playerCompilerBundle();
        packages.addFiles(Object.keys(result.metafile.inputs));
        const ref = this.emitFile({
          type: 'asset',
          name: 'player-compiler.js',
          source: result.outputFiles[0]!.text,
        });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      },
    },
    vue({ template: { compilerOptions: { isCustomElement: tag => tag.startsWith('dk-') } } }),
    packages.plugin(),
  ],
  resolve: { dedupe: ['@unworklet/core'] },
  worker: { format: 'es', plugins: () => [packages.worker()] },
  build: {
    outDir: join(kit, 'dist/player'),
    emptyOutDir: true,
    target: 'es2022',
    manifest: 'manifest.json',
    chunkSizeWarningLimit: 20000,
    reportCompressedSize: false,
    rolldownOptions: { input: { player: join(kit, 'player.html') } },
  },
});

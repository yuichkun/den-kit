// The player's own build (dist/player/, after den-kit's): player.html and its files
// at relative paths, with a manifest that lists them, so den-kit can copy the player
// into a work's playable build (src/editor/playable.ts).
import { defineConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: kit,
  base: './',
  // den-kit's own public files (the showcase) are not the player's.
  publicDir: false,
  plugins: [
    vue({ template: { compilerOptions: { isCustomElement: tag => tag.startsWith('dk-') } } }),
  ],
  resolve: { dedupe: ['@unworklet/core'] },
  worker: { format: 'es' },
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

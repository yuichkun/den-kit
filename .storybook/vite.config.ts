// The Vite config the stories build with. Of den-kit's own config, whose proxies and pre-bundled
// packages serve the editor and the pod, they need only the Vue plugin, for den-kit's own
// screens, and its ES workers. Of `build`, Storybook reads only `target`.
import { defineConfig, type Plugin } from 'vite-plus';
import vue from '@vitejs/plugin-vue';

/**
 * The stories make no sound (src/editor/story-frame.ts): the compiler's worker is left out, so
 * the build carries neither it nor what it compiles with.
 */
function noCompiler(): Plugin {
  const empty = '\0den-kit-stories:no-compiler';
  return {
    name: 'den-kit-stories-no-compiler',
    enforce: 'pre',
    resolveId: id =>
      id === 'virtual:kit-runtime'
        ? '\0' + id
        : id.endsWith('/compiler.worker.ts?worker')
          ? empty
          : undefined,
    load: id =>
      id === empty
        ? 'export default class { postMessage() {} terminate() {} }'
        : id === '\0virtual:kit-runtime'
          ? 'export default "";'
          : undefined,
  };
}

export default defineConfig({
  plugins: [
    noCompiler(),
    vue({ template: { compilerOptions: { isCustomElement: tag => tag.startsWith('dk-') } } }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});

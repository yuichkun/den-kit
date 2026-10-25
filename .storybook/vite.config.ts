// The Vite config the stories build with. The controls need nothing of den-kit's own config:
// its plugins, proxies and pre-bundled packages serve the editor and the pod. Of `build`,
// Storybook reads only `target`.
import { defineConfig } from 'vite-plus';

export default defineConfig({ build: { target: 'es2022' } });

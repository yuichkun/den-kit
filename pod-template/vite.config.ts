import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// den-kit runs this dev server inside the pod and shows its pages (the code
// parts) on the plugin. den-kit's sandbox serves them from the work's own origin
// and passes requests and the live-reload WebSocket through to this server; the
// sandbox sets the rules for those pages in its own responses.
export default defineConfig({
  plugins: [watchNewFolders()],
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    allowedHosts: true,
    hmr: { overlay: false },
  },
  build: { target: 'es2022' },
});

/**
 * In the pod (KIT_WATCH_NEW_FOLDERS), the file watcher does not see a folder made
 * after the dev server started, so changes to files in it would not reload the
 * page: look for new folders every second and watch them.
 */
function watchNewFolders(): Plugin {
  return {
    name: 'den-kit:watch-new-folders',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.KIT_WATCH_NEW_FOLDERS) return;
      const seen = new Set<string>();
      const scan = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || ['node_modules', 'dist', '.git'].includes(entry.name))
            continue;
          const path = join(dir, entry.name);
          if (!seen.has(path)) {
            seen.add(path);
            server.watcher.add(path);
          }
          scan(path);
        }
      };
      const look = () => {
        try {
          scan(server.config.root);
        } catch {
          /* a folder went away meanwhile */
        }
      };
      look();
      const timer = setInterval(look, 1000);
      server.httpServer?.on('close', () => clearInterval(timer));
    },
  };
}

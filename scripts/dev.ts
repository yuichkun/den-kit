// `npm run kit:dev`: Vite dev server for the editor (and, from CP2, the local AI bridge).
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.KIT_PORT ?? 5180);
try {
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  console.log(`\n  den-kit  →  ${server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`}\n  (Chrome recommended; audio must run at 48 kHz)\n`);
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/EADDRINUSE|already in use/i.test(message) ? `Port ${port} is busy. Stop the other process or run with KIT_PORT=5190 npm run kit:dev.` : message);
  process.exit(1);
}

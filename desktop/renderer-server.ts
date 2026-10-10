import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Fixed origin: changing it would lose access to works and the BrowserPod disk. */
export const APP_PORT = 5247;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

export function rendererServer(root: string) {
  const base = resolve(root);
  return (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.headers.host !== `127.0.0.1:${APP_PORT}` || !['GET', 'HEAD'].includes(req.method ?? '')) {
        res.writeHead(403).end(); return;
      }
      let name: string;
      try { name = decodeURIComponent(new URL(req.url ?? '/', APP_ORIGIN).pathname); }
      catch { res.writeHead(400).end(); return; }
      const file = resolve(base, `.${name === '/' ? '/index.html' : name}`);
      if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
      let size: number;
      try { const s = await stat(file); if (!s.isFile()) throw new Error('not a file'); size = s.size; }
      catch { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': size,
        'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
        'x-content-type-options': 'nosniff', 'cache-control': 'no-cache',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  };
}

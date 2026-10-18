import { afterEach, expect, it } from 'vite-plus/test';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererServer } from '../../desktop/renderer-server.ts';

const resources: Array<{ server: Server; dir: string }> = [];
afterEach(async () => {
  for (const { server, dir } of resources.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
it('isolates the renderer and refuses foreign hosts, writes and paths outside its bundle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'den-kit-renderer-'));
  const root = join(dir, 'renderer');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<h1>den-kit</h1>');
  writeFileSync(join(dir, 'auth.json'), 'must not be served');
  const server = createServer(rendererServer(root));
  resources.push({ server, dir });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const get = (path: string, host = '127.0.0.1:5247', method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
      (resolve, reject) => {
        const req = request(
          { hostname: '127.0.0.1', port, path, method, headers: { Host: host } },
          res => {
            let body = '';
            res.on('data', d => {
              body += d;
            });
            res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
  const page = await get('/');
  expect(page.status).toBe(200);
  expect(page.body).toContain('den-kit');
  expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(page.headers['cross-origin-embedder-policy']).toBe('require-corp');
  expect((await get('/%2e%2e%2fauth.json')).status).toBe(403);
  expect((await get('/', 'attacker.test:5247')).status).toBe(403);
  expect((await get('/', '127.0.0.1:5247', 'POST')).status).toBe(403);
  expect((await get('/missing')).status).toBe(404);
  expect((await get('/%')).status).toBe(400);
  expect((await get('/', '127.0.0.1:5247', 'HEAD')).body).toBe('');
});

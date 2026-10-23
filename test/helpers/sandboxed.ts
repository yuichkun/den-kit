// A page of a work's dev server as den-kit's frame gets it: through the sandbox
// (desktop/sandbox.ts) under the work's own origin, with the sandbox's rules.
import { createServer, request } from 'node:http';
import { SandboxServer } from '../../desktop/sandbox.ts';

export async function throughSandbox(
  devServer: string,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const sandbox = new SandboxServer({
    port: 0,
    requireSecret: false,
    content: () => null,
    refused: () => undefined,
  });
  const server = createServer((req, res) => {
    if (!sandbox.handle(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  sandbox.port = (server.address() as { port: number }).port;
  sandbox.open('work', { portal: devServer, origins: [], devices: [], files: {} });
  try {
    return await new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: sandbox.port,
          path,
          headers: { host: `work.localhost:${sandbox.port}` },
        },
        res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (text += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [k, String(v)]),
              ),
              text,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

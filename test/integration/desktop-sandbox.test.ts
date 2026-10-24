// The desktop sandbox's server (desktop/sandbox.ts) on a real socket: each open
// work answers under its own host name, only with the launch's secret; it passes
// requests and WebSockets through to the workspace's dev server and puts its own
// rules in every response, whatever the dev server sends; without one, it serves
// the code parts as last built; it serves the work's files by path and hears what
// the browser refused. What the window adds (the
// proxy, WebRTC, DNS prefetching, frames, devices) is checked in Electron by
// test/desktop.
import { createHash } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WebSocket, WebSocketServer } from 'ws';
import {
  SandboxServer,
  FILES_PATH,
  REPORT_PATH,
  SECRET_HEADER,
  mayNavigate,
  proxyConfig,
  validOrigin,
} from '../../desktop/sandbox.ts';
import { workPermission } from '../../desktop/permissions.ts';

const closing: Array<() => void> = [];
afterEach(() => {
  for (const c of closing.splice(0)) c();
});
async function listen(server: Server): Promise<number> {
  closing.push(() => server.close());
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}

/** The analytics script BrowserPod's portal adds to its pages. */
const BEACON = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v8c78" data-cf-beacon='{"token":"t"}' crossorigin="anonymous"></script>`;

/**
 * A dev server behind a portal: it sends headers of its own (which the sandbox must drop), its pages
 * carry the portal's analytics script, and it echoes WebSockets.
 */
async function devServer() {
  const seen: Array<{ url?: string; headers: Record<string, unknown> }> = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const script = req.url?.endsWith('.js');
    res.writeHead(200, {
      'content-type': script ? 'text/javascript' : 'text/html',
      'content-security-policy': "default-src *; script-src * 'unsafe-eval'",
      'set-cookie': 'portal=1',
      'access-control-allow-origin': '*',
    });
    res.end(script ? `// ${BEACON}` : `<p>part ${req.url}</p>${BEACON}`);
  });
  const wss = new WebSocketServer({ server, handleProtocols: p => [...p][0] ?? false });
  wss.on('connection', (ws, req) => {
    ws.send(`hello ${req.url}`);
    ws.on('message', m => ws.send(`echo ${String(m)}`));
  });
  closing.push(() => wss.close());
  return { port: await listen(server), seen };
}

async function sandboxServer() {
  const kick = new TextEncoder().encode('RIFF....WAVE');
  const hash = `sha256-${createHash('sha256').update(kick).digest('hex')}`;
  const contents = new Map([[hash, kick]]);
  /** Keeps a content in the host's storage; its hash. */
  const add = (text: string) => {
    const data = new TextEncoder().encode(text);
    const h = `sha256-${createHash('sha256').update(data).digest('hex')}`;
    contents.set(h, data);
    return h;
  };
  const refused: Array<{ work: string; blocked: string; directive: string }> = [];
  let port = 0;
  const server = createServer((req, res) => {
    if (!sandbox.handle(req, res)) res.writeHead(418).end('den-kit page');
  });
  server.on('upgrade', (req, socket, head) => {
    if (!sandbox.upgrade(req, socket, head)) socket.destroy();
  });
  port = await listen(server);
  const sandbox: SandboxServer = new SandboxServer({
    port,
    content: h => contents.get(h) ?? null,
    refused: (work, r) => refused.push({ work, ...r }),
  });
  return { sandbox, port, server, refused, hash, kick, add };
}

/** A request with its own Host header (fetch cannot set one): the status, headers and body. */
function get(
  port: number,
  host: string,
  path: string,
  secret?: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Map<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? 'GET',
        headers: { host, ...(secret ? { [SECRET_HEADER]: secret } : {}), ...init.headers },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: new Map(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
}

describe('the sandbox server', () => {
  it('answers only for open works, and only with the secret', async () => {
    const { sandbox, port } = await sandboxServer();
    sandbox.open('work-a', { portal: null, origins: [], devices: [], files: {} });
    const host = `work-a.localhost:${port}`;
    expect((await get(port, host, '/')).status).toBe(403);
    expect((await get(port, host, '/', 'wrong')).status).toBe(403);
    expect((await get(port, `work-b.localhost:${port}`, '/', sandbox.secret)).status).toBe(404);
    // Without a workspace there is nothing to pass through yet.
    expect((await get(port, host, '/', sandbox.secret)).status).toBe(404);
    // The den-kit page's own host is not the sandbox's.
    expect((await get(port, `127.0.0.1:${port}`, '/', sandbox.secret)).status).toBe(418);
    sandbox.close('work-a');
    expect((await get(port, host, '/', sandbox.secret)).status).toBe(404);
  });

  it("passes requests through to the dev server and puts its own rules in place of the dev server's headers", async () => {
    const { sandbox, port } = await sandboxServer();
    const dev = await devServer();
    sandbox.open('work-a', {
      portal: `http://127.0.0.1:${dev.port}`,
      origins: ['https://api.example.com', 'http://insecure.example.com', 'https://x.example/path'],
      devices: ['midi'],
      files: {},
    });
    const r = await get(port, `work-a.localhost:${port}`, '/?part=reels&el=c1', sandbox.secret, {
      headers: { cookie: 'den-kit=1', origin: 'http://127.0.0.1:5247' },
    });
    expect(r.status).toBe(200);
    // The portal's analytics script is taken out of its pages; other files pass as they are.
    expect(r.body.toString()).toBe('<p>part /?part=reels&el=c1</p>');
    expect(r.headers.get('content-length')).toBe(String(r.body.length));
    expect(
      (await get(port, `work-a.localhost:${port}`, '/src/main.js', sandbox.secret)).body.toString(),
    ).toBe(`// ${BEACON}`);
    const csp = r.headers.get('content-security-policy')!;
    expect(csp).toContain("connect-src 'self' https://api.example.com wss://api.example.com;");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain('unsafe-eval;');
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('set-cookie')).toBeUndefined();
    expect(r.headers.get('access-control-allow-origin')).toBeUndefined();
    // Neither the secret nor the page's cookies and origin reach the dev server.
    const sent = dev.seen.at(-1)!.headers;
    expect(sent[SECRET_HEADER]).toBeUndefined();
    expect(sent.cookie).toBeUndefined();
    expect(sent.origin).toBeUndefined();
    expect(sent.host).toBe(`127.0.0.1:${dev.port}`);
    // Only well-formed https origins count; their hosts go around the proxy.
    expect(sandbox.allowedHosts()).toEqual(['api.example.com']);
  });

  it("passes the dev server's WebSocket (live reload) through, with its subprotocol", async () => {
    const { sandbox, port } = await sandboxServer();
    const dev = await devServer();
    sandbox.open('work-a', {
      portal: `http://127.0.0.1:${dev.port}`,
      origins: [],
      devices: [],
      files: {},
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=t`, 'vite-hmr', {
      headers: { host: `work-a.localhost:${port}`, [SECRET_HEADER]: sandbox.secret },
    });
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('message', m => {
        messages.push(String(m));
        if (messages.length === 1) ws.send('ping');
        if (messages.length === 2) resolve();
      });
      ws.on('error', reject);
    });
    expect(ws.protocol).toBe('vite-hmr');
    expect(messages).toEqual(['hello /?token=t', 'echo ping']);
    ws.close();
    // Without the secret, no WebSocket either.
    const refused = new WebSocket(`ws://127.0.0.1:${port}/`, {
      headers: { host: `work-a.localhost:${port}` },
    });
    await expect(
      new Promise((resolve, reject) => {
        refused.on('open', resolve);
        refused.on('error', reject);
      }),
    ).rejects.toThrow(/403/);
  });

  it('ends the WebSockets it passes through, so the server it runs on can close', async () => {
    const { sandbox, port, server } = await sandboxServer();
    const dev = await devServer();
    sandbox.open('work-a', {
      portal: `http://127.0.0.1:${dev.port}`,
      origins: [],
      devices: [],
      files: {},
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr', {
      headers: { host: `work-a.localhost:${port}`, [SECRET_HEADER]: sandbox.secret },
    });
    await new Promise((resolve, reject) => {
      ws.once('message', resolve);
      ws.once('error', reject);
    });
    const ended = new Promise(resolve => ws.once('close', resolve));
    sandbox.closeConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await ended;
  });

  it('serves the code parts as last built while there is no dev server, and the dev server while there is', async () => {
    const { sandbox, port, add } = await sandboxServer();
    const build = {
      'index.html': { hash: add('<p>built</p>'), type: 'text/html' },
      'assets/index-1.js': { hash: add('console.log(1)'), type: 'text/javascript' },
    };
    sandbox.open('work-a', { portal: null, origins: [], devices: [], files: {}, build });
    const host = `work-a.localhost:${port}`;
    const page = await get(port, host, '/?part=meter&el=m1', sandbox.secret);
    expect(page.status).toBe(200);
    expect(page.body.toString()).toBe('<p>built</p>');
    expect(page.headers.get('content-type')).toBe('text/html');
    expect(page.headers.get('content-security-policy')).toContain("frame-src 'none'");
    const script = await get(port, host, '/assets/index-1.js', sandbox.secret);
    expect(script.body.toString()).toBe('console.log(1)');
    expect(script.headers.get('content-type')).toBe('text/javascript');
    expect((await get(port, host, '/assets/none.js', sandbox.secret)).status).toBe(404);
    expect((await get(port, host, '/constructor', sandbox.secret)).status).toBe(404);
    expect((await get(port, host, '/', sandbox.secret, { method: 'POST' })).status).toBe(404);
    // While the person edits: the dev server.
    const dev = await devServer();
    sandbox.open('work-a', {
      portal: `http://127.0.0.1:${dev.port}`,
      origins: [],
      devices: [],
      files: {},
      build,
    });
    expect((await get(port, host, '/?part=meter', sandbox.secret)).body.toString()).toBe(
      '<p>part /?part=meter</p>',
    );
  });

  it("serves the work's files by path, and hears what the browser refused", async () => {
    const { sandbox, port, refused, hash, kick } = await sandboxServer();
    sandbox.open('work-a', {
      portal: null,
      origins: [],
      devices: [],
      files: { 'assets/kick.wav': { hash, type: 'audio/wav' } },
    });
    const host = `work-a.localhost:${port}`;
    const r = await get(port, host, `${FILES_PATH}assets/kick.wav`, sandbox.secret);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(r.body)).toEqual(kick);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await get(port, host, `${FILES_PATH}assets/none.wav`, sandbox.secret)).status).toBe(
      404,
    );
    expect((await get(port, host, `${FILES_PATH}constructor`, sandbox.secret)).status).toBe(404);
    const report = await get(port, host, REPORT_PATH, sandbox.secret, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'blocked-uri': 'https://tracker.example/collect',
          'effective-directive': 'connect-src',
        },
      }),
    });
    expect(report.status).toBe(204);
    expect(refused).toEqual([
      { work: 'work-a', blocked: 'https://tracker.example/collect', directive: 'connect-src' },
    ]);
  });
});

describe('the rules the window applies', () => {
  it("a code part's frame stays on its own origin; den-kit's frames may open a work or den-kit's own services", async () => {
    const { sandbox, port } = await sandboxServer();
    sandbox.open('work-a', { portal: null, origins: [], devices: [], files: {} });
    sandbox.open('work-b', { portal: null, origins: [], devices: [], files: {} });
    const own = { origin: 'http://127.0.0.1:5247', hosts: ['*.browserpod.io'] };
    const a = `http://work-a.localhost:${port}`;
    const inPart = { url: `${a}/?part=x`, origin: a };
    expect(mayNavigate(sandbox, inPart, `${a}/?part=x&r=2`, own)).toBe(true);
    expect(mayNavigate(sandbox, inPart, 'https://evil.example/', own)).toBe(false);
    expect(mayNavigate(sandbox, inPart, `http://work-b.localhost:${port}/`, own)).toBe(false);
    expect(mayNavigate(sandbox, inPart, 'https://rt.browserpod.io/', own)).toBe(false);
    const fresh = { url: 'about:blank', origin: 'http://127.0.0.1:5247' };
    expect(mayNavigate(sandbox, fresh, `${a}/?part=x`, own)).toBe(true);
    expect(mayNavigate(sandbox, fresh, `http://work-c.localhost:${port}/`, own)).toBe(false);
    expect(mayNavigate(sandbox, fresh, 'https://rt.browserpod.io/x', own)).toBe(true);
    expect(mayNavigate(sandbox, fresh, 'https://evil.example/', own)).toBe(false);
  });

  it('devices by work, and the proxy rules', () => {
    expect(workPermission(['midi'], 'midi')).toBe(true);
    expect(workPermission(['midi'], 'midiSysex')).toBe(true);
    expect(workPermission(['microphone'], 'midiSysex')).toBe(false);
    expect(workPermission(['midi'], 'media', ['audio'])).toBe(false);
    expect(workPermission(['microphone'], 'media', ['audio'])).toBe(true);
    expect(workPermission(['microphone'], 'media', ['audio', 'video'])).toBe(false);
    expect(workPermission(['microphone', 'camera'], 'media', [])).toBe(true);
    expect(workPermission(['microphone', 'camera', 'midi'], 'geolocation')).toBe(false);
    expect(proxyConfig(4000, ['*.browserpod.io', 'api.example.com'])).toEqual({
      proxyRules: 'http=127.0.0.1:4000;https=127.0.0.1:4000',
      proxyBypassRules: '*.browserpod.io,api.example.com',
    });
    expect(validOrigin('https://api.example.com')).toBe('https://api.example.com');
    expect(validOrigin('wss://live.example.com')).toBe('wss://live.example.com');
    for (const bad of ['http://x.example', 'https://u:p@x.example', 'https://x.example/a', 'nope'])
      expect(validOrigin(bad), bad).toBeNull();
  });
});

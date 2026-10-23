// The sandbox in Electron (docs/architecture.md, Sandbox; desktop/sandbox.ts and
// desktop/window-rules.ts): a work's code part reaches only the origins the person
// allowed for that work, by every way a page has to reach out, and its frame never
// navigates away; DNS prefetching, WebRTC's UDP and TURN to other hosts go nowhere;
// the sandbox serves nothing without the window's secret header, and refusals come
// back as reports; devices follow the frame's work. Runs test/desktop/app.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'den-kit-sandbox-test-'));
const hits: Array<{ host: string; path: string }> = [];
const turn = { allowed: 0, blocked: 0 };
let stunPackets = 0;
const closers: Array<() => void> = [];
let app: ElectronApplication;
let page: Page;
let ports: { record: number; dev: number; stun: number; turnAllowed: number; turnBlocked: number };

const listen = async (server: Server | TcpServer) => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  return (server.address() as { port: number }).port;
};

/** The code part: every way a page has to reach out, then every way to leave its frame. */
const PART_JS = String.raw`
const q = new URLSearchParams(location.search);
const work = q.get('work');
const out = { work };
const settle = (p, ms = 3000) => Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), ms))]);
const tries = [];
for (const name of ['allowed', 'blocked']) {
  const base = 'https://' + name + '.test:' + q.get('record');
  const tag = base + '/' + work + '/' + name;
  tries.push(settle(fetch(tag + '/fetch', { mode: 'no-cors' }).then(() => 'reached', () => 'refused')));
  tries.push(settle(new Promise(r => {
    const ws = new WebSocket(base.replace('https', 'wss') + '/' + work + '/' + name + '/ws');
    ws.onopen = () => r('open'); ws.onerror = () => r('refused');
  })));
  new Image().src = tag + '/img';
  try { navigator.sendBeacon(tag + '/beacon', 'x'); } catch {}
  const link = document.createElement('link');
  link.rel = 'prefetch'; link.href = tag + '/prefetch'; document.head.append(link);
  new Worker('/worker.js?target=' + encodeURIComponent(tag + '/worker'));
  try {
    new Worker(URL.createObjectURL(new Blob(['fetch(' + JSON.stringify(tag + '/blob-worker') + ').catch(() => {})'], { type: 'text/javascript' })));
  } catch {}
}
const dns = document.createElement('link');
dns.rel = 'dns-prefetch'; dns.href = '//prefetch.test'; document.head.append(dns);
if (work === 'allowed') {
  const pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:127.0.0.1:' + q.get('stun') },
    { urls: 'turn:allowed.test:' + q.get('turnAllowed') + '?transport=tcp', username: 'u', credential: 'p' },
    { urls: 'turn:blocked.test:' + q.get('turnBlocked') + '?transport=tcp', username: 'u', credential: 'p' },
  ] });
  pc.createDataChannel('x');
  pc.createOffer().then(o => pc.setLocalDescription(o));
}
out.gum = await settle(navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', () => 'denied'));
out.midi = await settle(navigator.requestMIDIAccess().then(() => 'granted', () => 'denied'));
out.tries = await Promise.all(tries);
parent.postMessage(out, '*');
// Leaving the frame: none of these may reach anywhere, not even an allowed origin.
await new Promise(r => setTimeout(r, 1500));
const away = 'https://allowed.test:' + q.get('record') + '/' + work + '/away';
try { window.open(away + '/popup'); } catch {}
try { top.location.href = away + '/top'; } catch {}
const form = document.createElement('form');
form.action = away + '/form'; form.method = 'GET'; document.body.append(form);
try { form.submit(); } catch {}
const meta = document.createElement('meta');
meta.httpEquiv = 'refresh'; meta.content = '0;url=' + away + '/meta'; document.head.append(meta);
setTimeout(() => { location.href = away + '/location'; }, 300);
`;

before(async () => {
  // A record server for allowed.test and blocked.test (HTTPS: the frames are a secure context).
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=allowed.test',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const record = createHttpsServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (req, res) => {
      hits.push({ host: String(req.headers.host), path: String(req.url) });
      res.writeHead(200, { 'access-control-allow-origin': '*' }).end('ok');
    },
  );
  const wss = new WebSocketServer({ server: record });
  wss.on('connection', (_ws, req) =>
    hits.push({ host: String(req.headers.host), path: String(req.url) }),
  );
  closers.push(() => wss.close());
  const stun: Socket = createSocket('udp4');
  stun.on('message', () => stunPackets++);
  await new Promise<void>(r => stun.bind(0, '127.0.0.1', r));
  closers.push(() => stun.close());
  const tcp = (name: 'allowed' | 'blocked') =>
    createTcpServer(socket => {
      turn[name]++;
      socket.destroy();
    });
  // The code parts' dev server (the sandbox passes their frames through to it).
  const dev = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://dev').pathname;
    if (path === '/part.html')
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><script type="module" src="/part.js"></script>');
    else if (path === '/part.js')
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(PART_JS);
    else if (path === '/worker.js')
      res
        .writeHead(200, { 'content-type': 'text/javascript' })
        .end("fetch(new URL(location.href).searchParams.get('target')).catch(() => {});");
    else res.writeHead(404).end();
  });
  ports = {
    record: await listen(record),
    dev: await listen(dev),
    stun: (stun.address() as { port: number }).port,
    turnAllowed: await listen(tcp('allowed')),
    turnBlocked: await listen(tcp('blocked')),
  };
  // The test app, bundled like the desktop app's main process.
  await build({
    entryPoints: [join(root, 'test/desktop/app.ts')],
    outfile: join(dir, 'main.cjs'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    external: ['electron'],
    target: 'node24',
    logLevel: 'error',
  });
  app = await electron.launch({
    args: [join(dir, 'main.cjs')],
    env: {
      ...process.env,
      DEV: `http://127.0.0.1:${ports.dev}`,
      RECORD_PORT: String(ports.record),
      PART_QUERY: `record=${ports.record}&stun=${ports.stun}&turnAllowed=${ports.turnAllowed}&turnBlocked=${ports.turnBlocked}`,
      NETLOG: join(dir, 'netlog.json'),
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => Object.keys((window as any).results ?? {}).length === 2, null, {
    timeout: 30000,
  });
  // The frames tried to leave; give those attempts time to land if they could.
  await new Promise(r => setTimeout(r, 3000));
});

after(async () => {
  await app?.close();
  for (const close of closers) close();
  rmSync(dir, { recursive: true, force: true });
});

const reached = (path: string) => hits.some(h => h.path === path);

describe('the sandbox in Electron', () => {
  it("a code part reaches the origins allowed for its work, by fetch, WebSocket, beacon and workers' fetch; nothing else", () => {
    for (const way of ['fetch', 'ws', 'beacon', 'worker', 'blob-worker'])
      assert.ok(
        reached(`/allowed/allowed/${way}`),
        `${way} to the allowed origin: ${JSON.stringify(hits)}`,
      );
    // An allowed origin opens connections only: no pictures from it (a prefetch is a fetch).
    assert.ok(!reached('/allowed/allowed/img'));
    // Nothing reaches a host that is not allowed, and the other work has no allowed host at all.
    assert.deepEqual(
      hits.filter(h => h.path.includes('/blocked') || h.path.startsWith('/devices/')),
      [],
    );
  });

  it('its frame cannot leave: no popup, top navigation, form, meta refresh or location change reaches anywhere', () => {
    assert.deepEqual(
      hits.filter(h => h.path.includes('/away/')),
      [],
    );
  });

  it('no DNS prefetching, no WebRTC over UDP, and TURN over TCP only to an allowed host', () => {
    assert.doesNotMatch(readFileSync(join(dir, 'netlog.json'), 'utf8'), /prefetch\.test/);
    assert.equal(stunPackets, 0, 'no STUN packet left over UDP');
    assert.equal(turn.blocked, 0, 'TURN to a host that is not allowed');
    assert.ok(turn.allowed > 0, 'TURN to the allowed host goes through');
  });

  it("devices follow the frame's work", async () => {
    const results = await page.evaluate(() => (window as any).results);
    assert.deepEqual(
      { gum: results.devices.gum, midi: results.devices.midi },
      { gum: 'granted', midi: 'granted' },
    );
    assert.deepEqual(
      { gum: results.allowed.gum, midi: results.allowed.midi },
      { gum: 'denied', midi: 'denied' },
    );
  });

  it("the sandbox serves only the window's requests (the secret header), and hears what the browser refused", async () => {
    const t = (await app.evaluate(() => (globalThis as any).sandboxTest)) as {
      port: number;
      secret: string;
      refused: Array<{ work: string; blocked: string }>;
    };
    const status = (secret?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: t.port,
            path: '/part.html?work=allowed',
            headers: {
              host: `allowed.localhost:${t.port}`,
              ...(secret ? { 'x-den-kit-sandbox': secret } : {}),
            },
          },
          res => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    assert.equal(await status(), 403);
    assert.equal(await status(t.secret), 200);
    assert.ok(
      t.refused.some(r => r.work === 'allowed' && r.blocked.includes('blocked.test')),
      JSON.stringify(t.refused),
    );
  });
});

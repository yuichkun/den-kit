// An Electron app for test/desktop/sandbox.test.ts: a page like den-kit's (cross-
// origin isolated, frames only from works' origins) with two works' code parts in
// frames, served by the real sandbox server (desktop/sandbox.ts) under the real
// window rules (desktop/window-rules.ts). The test passes in, through the
// environment: the code parts' dev server (DEV), the record server's port
// (RECORD_PORT) that allowed.test and blocked.test reach, the ports the code part
// tries (PART_QUERY) and where to write the net log (NETLOG). Work "allowed" may
// connect to https://allowed.test; work "devices" may use the microphone and MIDI.
import { app, BrowserWindow, session } from 'electron';
import { createServer } from 'node:http';
import { SandboxServer } from '../../desktop/sandbox.ts';
import { applyWindowRules, AUTOPLAY_POLICY, beforeReady } from '../../desktop/window-rules.ts';
import { workPermission } from '../../desktop/permissions.ts';

const env = process.env;
beforeReady(app);
// The test's names reach this machine; nothing here resolves any other name.
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP allowed.test 127.0.0.1, MAP blocked.test 127.0.0.1, MAP *.localhost 127.0.0.1',
);
app.commandLine.appendSwitch('log-net-log', env.NETLOG!);
// A fake microphone and camera; whether a frame may use them is the window's permission rule.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// The record server's certificate is the test's own.
app.commandLine.appendSwitch('ignore-certificate-errors');

void app.whenReady().then(async () => {
  const refused: Array<{ work: string; blocked: string }> = [];
  const sandbox = new SandboxServer({
    port: 0,
    content: () => null,
    refused: (work, r) => refused.push({ work, blocked: r.blocked }),
  });
  const server = createServer((req, res) => {
    if (sandbox.handle(req, res)) return;
    if (req.headers.host !== `127.0.0.1:${sandbox.port}`) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'content-security-policy': `frame-src http://*.localhost:${sandbox.port}`,
    });
    res.end(`<!doctype html><title>den-kit test page</title><body>
<script>
  window.results = {};
  addEventListener('message', e => { if (e.data && e.data.work) window.results[e.data.work] = e.data; });
  for (const work of ['allowed', 'devices']) {
    const f = document.createElement('iframe');
    f.src = 'http://' + work + '.localhost:${sandbox.port}/part.html?work=' + work + '&${env.PART_QUERY}';
    f.allow = work === 'devices' ? "microphone 'src'; midi 'src'" : '';
    f.sandbox = 'allow-scripts allow-same-origin';
    document.body.appendChild(f);
  }
</script>`);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!sandbox.upgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  sandbox.port = (server.address() as { port: number }).port;
  const record = `https://allowed.test:${env.RECORD_PORT}`;
  sandbox.open('allowed', { portal: env.DEV!, origins: [record], devices: [], files: {} });
  sandbox.open('devices', {
    portal: env.DEV!,
    origins: [],
    devices: ['microphone', 'midi'],
    files: {},
  });
  const appOrigin = `http://127.0.0.1:${sandbox.port}`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, autoplayPolicy: AUTOPLAY_POLICY },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await applyWindowRules({
    session: session.defaultSession,
    contents: win.webContents,
    sandbox,
    appOrigin,
    direct: [],
    permitted: (url, name, mainFrame, media) => {
      const work = mainFrame ? null : sandbox.workOf(url);
      return !!work && workPermission(sandbox.devices(work), name, media);
    },
  });
  (globalThis as unknown as { sandboxTest: unknown }).sandboxTest = {
    port: sandbox.port,
    secret: sandbox.secret,
    refused,
  };
  await win.loadURL(`${appOrigin}/`);
});

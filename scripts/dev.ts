// `npm run kit:dev`: the local AI bridge (127.0.0.1:5181) and the Vite dev server
// for the editor (127.0.0.1:5180), in one process. The bridge starts first and the
// page receives its per-launch token through virtual:kit-bridge.
import { createServer } from 'vite';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadEnvFile, maskSecret } from '../bridge/env.ts';
import { createBridge } from '../bridge/server.ts';
import { JevClient } from '../bridge/jev.ts';
import { Telemetry } from '../bridge/telemetry.ts';
import { CodexClient } from '../bridge/codex/client.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
loadEnvFile(join(root, '.env'));
const port = Number(process.env.KIT_PORT ?? 5180);
const bridgePort = Number(process.env.KIT_BRIDGE_PORT ?? 5181);
const budget = Number(process.env.KIT_JEV_BUDGET_MS);

const telemetry = new Telemetry(join(root, '.logs'));
// The LLM path: the pinned Codex app-server (KIT_CODEX=off to run without it).
const codex = process.env.KIT_CODEX === 'off' ? undefined : new CodexClient({
  kitRoot: root, model: process.env.KIT_CODEX_MODEL, effort: process.env.KIT_CODEX_EFFORT, fork: process.env.KIT_CODEX_FORK === '1', telemetry,
  log: line => console.log(`  [bridge] ${line}`),
});

let bridge;
try {
  bridge = await createBridge({
    port: bridgePort,
    token: randomBytes(24).toString('base64url'),
    origins: [`http://127.0.0.1:${port}`],
    jev: new JevClient({ apiKey: process.env.TYPESAFE_API_KEY, baseUrl: process.env.KIT_JEV_BASE, defaultBudgetMs: Number.isFinite(budget) && budget > 0 ? budget : undefined }),
    telemetry,
    warmUp: true,
    codex,
    log: line => console.log(`  [bridge] ${line}`),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/EADDRINUSE/.test(message) ? `Bridge port ${bridgePort} is busy (another kit:dev?). Stop it or run with KIT_BRIDGE_PORT=5191 npm run kit:dev.` : `Could not start the AI bridge: ${message}`);
  process.exit(1);
}
process.env.KIT_BRIDGE_TOKEN = bridge.token;
process.env.KIT_BRIDGE_PORT = String(bridge.port);

try {
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  const jev = bridge.status().jev;
  console.log(`\n  den-kit  →  ${server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`}\n  (Chrome recommended; audio must run at 48 kHz)`);
  console.log(`  AI bridge → 127.0.0.1:${bridge.port}  ·  Jev ${jev.state === 'off' ? 'off (set TYPESAFE_API_KEY in kit/.env)' : `key ${maskSecret(process.env.TYPESAFE_API_KEY)}`}  ·  logs kit/.logs`);
  // The pod boots in the page (BrowserPod runs in the browser tab); its key goes to the page.
  console.log(`  Pod → ${process.env.BROWSERPOD_API_KEY ? `BrowserPod, key ${maskSecret(process.env.BROWSERPOD_API_KEY)} (starts in the page when a work needs it)` : 'off (put BROWSERPOD_API_KEY in kit/.env to give the AI a pod: bash, git, Node, npm)'}`);
  if (codex) {
    // Start Codex after the editor is up; its state shows in the editor (and here).
    let last = '';
    codex.onStatus(s => {
      const line = s.state === 'ok' ? `LLM ready: ${s.model ?? 'Codex'}${s.plan ? ` (ChatGPT ${s.plan})` : ''}` : s.state === 'login' ? `LLM: Codex is not signed in → ${s.fix ?? ''}` : s.state === 'error' ? `LLM error: ${s.detail ?? ''}${s.fix ? ` → ${s.fix}` : ''}` : '';
      if (line && line !== last) { last = line; console.log(`  [bridge] ${line}`); }
    });
    void codex.start();
  } else console.log('  LLM off (KIT_CODEX=off)');
  console.log('');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await Promise.allSettled([server.close(), bridge.close()]); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  await bridge.close();
  const message = error instanceof Error ? error.message : String(error);
  console.error(/EADDRINUSE|already in use/i.test(message) ? `Port ${port} is busy. Stop the other process or run with KIT_PORT=5190 npm run kit:dev.` : message);
  process.exit(1);
}

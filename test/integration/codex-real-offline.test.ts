// The pinned Codex binary itself, offline: does the real 0.160.1 app-server
// accept exactly what den-kit sends, and connect to den-kit's MCP server? CODEX_HOME
// is an empty temp directory (not signed in) and every proxy variable points at a
// closed port except for loopback, so nothing leaves the machine and no model is
// ever called. Skipped where the binary is missing.
import { describe, expect, it } from 'vite-plus/test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcPeer } from '../../bridge/codex/rpc.ts';
import { isProblem, resolveCodex, spawnAppServer } from '../../bridge/codex/process.ts';
import { CodexClient, text, threadStartParams } from '../../bridge/codex/client.ts';
import type {
  RpcNotification,
  ThreadStartResponse,
  TurnStartResponse,
} from '../../bridge/codex/protocol.ts';
import { developerInstructions, toolsFor } from '../../src/ai/llm-spec.ts';
import { MCP_PATH, MCP_TOKEN_ENV, mcpHandler } from '../../bridge/mcp.ts';
import { KIT_ROOT } from '../helpers/fake-codex.ts';

const command = resolveCodex(KIT_ROOT, {});
const DEAD = 'http://127.0.0.1:9';
const offline = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CODEX_HOME: home,
  HTTPS_PROXY: DEAD,
  HTTP_PROXY: DEAD,
  ALL_PROXY: DEAD,
  https_proxy: DEAD,
  http_proxy: DEAD,
  all_proxy: DEAD,
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
});
const until = async (fn: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise(r => setTimeout(r, 20));
  }
};

describe.skipIf(isProblem(command))('the real pinned Codex app-server (offline)', () => {
  it('accepts den-kit’s initialize, thread/start (isolated, its tools from den-kit’s MCP server), turn/start, steer, interrupt and unsubscribe', async () => {
    if (isProblem(command)) return;
    const dir = mkdtempSync(join(tmpdir(), 'kit-codex-real-'));
    const home = join(dir, 'home'),
      work = join(dir, 'work');
    mkdirSync(work);
    const asked: string[] = [];
    const mcp = mcpHandler({
      token: 'offline-check-token',
      version: 'test',
      tools: () => toolsFor(),
      call: async () => ({ success: false, text: 'not in this test' }),
    });
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => asked.push(String(JSON.parse(body || '{}').method)));
      if (!mcp.handle(req, res)) res.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${MCP_PATH}`;
    const proc = spawnAppServer(command, {
      home,
      cwd: work,
      env: { ...offline(home), [MCP_TOKEN_ENV]: mcp.token },
    });
    const notifications: RpcNotification[] = [];
    const peer: RpcPeer = new RpcPeer(proc.child.stdout, proc.child.stdin, {
      onRequest: r => peer.respondError(r.id, -32601, 'not in this test'),
      onNotification: n => notifications.push(n),
    });
    try {
      await peer.request(
        'initialize',
        {
          clientInfo: { name: 'den-kit', title: 'den-kit', version: '0.1.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
        { timeoutMs: 60000 },
      );
      peer.notify('initialized');
      expect(
        await peer.request('account/read', { refreshToken: false }, { timeoutMs: 20000 }),
      ).toMatchObject({ account: null, requiresOpenaiAuth: true });
      const models = await peer.request<{ data: Array<{ isDefault: boolean }> }>(
        'model/list',
        { limit: 100 },
        { timeoutMs: 20000 },
      );
      expect(models.data.some(m => m.isDefault)).toBe(true);

      const started = await peer.request<ThreadStartResponse>(
        'thread/start',
        threadStartParams({
          cwd: work,
          instructions: developerInstructions(
            'den.lfo — LFO (modulation): a low-frequency oscillator',
          ),
          mcp: { url },
        }),
        { timeoutMs: 20000 },
      );
      // Codex connected to den-kit's MCP server with the token and read its tools.
      expect(asked).toEqual(expect.arrayContaining(['initialize', 'tools/list']));
      expect(started.instructionSources).toEqual([]);
      expect(started.sandbox.type).toBe('readOnly');
      expect(started.approvalPolicy).toBe('never');
      await new Promise(r => setTimeout(r, 200));
      expect(
        notifications.filter(
          n =>
            n.method === 'warning' && /unrecognized configuration/.test(JSON.stringify(n.params)),
        ),
      ).toEqual([]);

      const threadId = started.thread.id;
      const turn = await peer.request<TurnStartResponse>(
        'turn/start',
        { threadId, input: [text('hello')], effort: 'low' },
        { timeoutMs: 20000 },
      );
      expect(turn.turn.status).toBe('inProgress');
      expect(
        await peer.request(
          'turn/steer',
          { threadId, input: [text('and more')], expectedTurnId: turn.turn.id },
          { timeoutMs: 20000 },
        ),
      ).toEqual({ turnId: turn.turn.id });
      // A saved thread's turn can be interrupted once Codex says it started.
      await until(() => notifications.some(n => n.method === 'turn/started'), 20000);
      await peer.request(
        'turn/interrupt',
        { threadId, turnId: turn.turn.id },
        { timeoutMs: 20000 },
      );
      await until(
        () =>
          notifications.some(
            n =>
              n.method === 'turn/completed' &&
              (n.params as { turn: { status: string } }).turn.status === 'interrupted',
          ),
        20000,
      );
      expect(await peer.request('thread/unsubscribe', { threadId }, { timeoutMs: 20000 })).toEqual({
        status: 'unsubscribed',
      });
    } finally {
      peer.close('test done');
      await proc.stop();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);

  it('CodexClient boots the pinned binary and reports “not signed in” with the model it would use', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-codex-real-'));
    const client = new CodexClient({
      kitRoot: KIT_ROOT,
      env: offline(join(dir, 'home')),
      home: { path: join(dir, 'home'), isolated: true },
      workdir: dir,
    });
    try {
      await client.start();
      expect(client.status).toMatchObject({
        state: 'login',
        model: expect.any(String),
        images: true,
      });
      expect(client.status.fix).toContain('vp run codex:login');
    } finally {
      await client.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});

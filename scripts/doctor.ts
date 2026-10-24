// `vp run doctor`: checks the local setup step by step and says how to fix each problem.
//   Node, dependencies, ports ·
//   Codex (pinned CLI, isolated CODEX_HOME, sign-in, app-server, thread isolation).
// `vp run doctor --deep` also makes one real Codex request with a ping tool, then
// tries what den-kit needs beyond one request: a sub-agent calling den-kit's tool from its
// own conversation, two requests at once (two windows), a tool call held as long as a
// kit_bash command may run, pictures with a request and added while it works (sketches,
// shared screens), a saved conversation read back (thread/items/list) and token counts
// (about two minutes in all). Codex reaches the tools as in the app: from an MCP server
// with a per-launch token (bridge/mcp.ts).
// It records the whole JSON-RPC conversation to .logs/codex-deep-*.jsonl.
// Every run writes its results to .logs/doctor-*.json (secrets masked).
import { execFile } from 'node:child_process';
import { findPackageJSON } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnvFile } from '../bridge/env.ts';
import { RpcPeer } from '../bridge/codex/rpc.ts';
import {
  codexEnv,
  codexHome,
  codexWorkdir,
  isProblem,
  LOGIN_COMMAND,
  resolveCodex,
  spawnAppServer,
  type CodexCommand,
} from '../bridge/codex/process.ts';
import { describeRpcError, text, threadStartParams } from '../bridge/codex/client.ts';
import { MCP_PATH, MCP_TOKEN_ENV, mcpHandler } from '../bridge/mcp.ts';
import type { ToolOutput } from '../bridge/protocol.ts';
import {
  CODEX_VERSION,
  DECLINE,
  EXPECTED_ITEMS,
  explainCodexError,
  type GetAccountResponse,
  type InitializeResponse,
  type ModelListResponse,
  type RpcNotification,
  type ThreadStartResponse,
  type TurnError,
  type UserInput,
} from '../bridge/codex/protocol.ts';
import { toolsFor, type ToolSpec } from '../src/ai/llm-spec.ts';
import { inNodeRange } from './node-range.ts';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
/** What den-kit's ping tool answers. */
const PONG: ToolOutput = { success: true, text: 'pong-from-den-kit' };
const deep = process.argv.includes('--deep');
const kit = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
loadEnvFile(join(kit, '.env'));
const results: Array<{ status: Status; name: string; detail: string; fix?: string }> = [];
const report = (status: Status, name: string, detail: string, fix?: string) => {
  results.push({ status, name, detail, fix });
};
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

// 1. Node, in the range of package.json engines
const nodeRange = json(join(kit, 'package.json')).engines.node as string;
if (inNodeRange(process.versions.node, nodeRange))
  report('PASS', 'Node.js', `v${process.versions.node}`);
else
  report(
    'FAIL',
    'Node.js',
    `v${process.versions.node}`,
    `Install Node ${nodeRange} (package.json engines), such as the version in .node-version.`,
  );

// 2. Dependencies
const core = join(kit, 'node_modules/@unworklet/core/package.json');
if (!existsSync(core))
  report(
    'FAIL',
    'den-kit dependencies',
    'missing node_modules at the repo root',
    'Run `vp install --frozen-lockfile` in the den-kit repo root.',
  );
else {
  const v = json(core).version;
  report(
    v === '0.4.1' ? 'PASS' : 'FAIL',
    '@unworklet/core',
    v,
    v === '0.4.1'
      ? undefined
      : 'den-kit is pinned to unworklet 0.4.1: run `vp install --frozen-lockfile` at the repo root.',
  );
}
try {
  const denEntry = fileURLToPath(import.meta.resolve('@denaudio/den'));
  const denPackage = json(join(dirname(denEntry), '..', 'package.json'));
  report(
    denPackage.version === '0.1.0' ? 'PASS' : 'FAIL',
    '@denaudio/den',
    denPackage.version,
    'Run `vp install --frozen-lockfile` in the den-kit repo root.',
  );
  const ownCore = realpathSync(findPackageJSON('@unworklet/core', import.meta.url)!);
  const denCore = realpathSync(
    findPackageJSON('@unworklet/core', import.meta.resolve('@denaudio/den'))!,
  );
  report(
    ownCore === denCore ? 'PASS' : 'FAIL',
    'single @unworklet/core',
    ownCore === denCore
      ? 'den and den-kit resolve the same installed module'
      : 'den and den-kit resolve different copies',
    'Run `vp install --frozen-lockfile` in the den-kit repo root.',
  );
} catch {
  report(
    'FAIL',
    '@denaudio/den',
    'the npm package or its core dependency is missing',
    'Run `vp install --frozen-lockfile` in the den-kit repo root.',
  );
}
for (const [name, path] of [
  ['vue', 'node_modules/vue/package.json'],
  ['@vue-flow/core', 'node_modules/@vue-flow/core/package.json'],
  ['vite-plus', 'node_modules/vite-plus/package.json'],
] as const) {
  report(
    existsSync(join(kit, path)) ? 'PASS' : 'FAIL',
    name,
    existsSync(join(kit, path)) ? json(join(kit, path)).version : 'not installed',
    'Run `vp install --frozen-lockfile` from the repo root.',
  );
}

// 3. Ports (editor and AI bridge)
const portFree = (port: number) =>
  new Promise<boolean>(resolve => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
for (const [name, env, fallback] of [
  ['editor port', 'KIT_PORT', 5180],
  ['AI bridge port', 'KIT_BRIDGE_PORT', 5181],
] as const) {
  const port = Number(process.env[env] ?? fallback);
  const free = await portFree(port);
  report(
    free ? 'PASS' : 'WARN',
    `${name} ${port}`,
    free ? 'free' : 'in use',
    free ? undefined : `Another dev may be running; stop it or set ${env}.`,
  );
}

// 4. Codex (the LLM path)
if (process.env.KIT_CODEX === 'off') report('SKIP', 'Codex', 'KIT_CODEX=off');
else await checkCodex();

const width = Math.max(...results.map(r => r.name.length));
for (const r of results)
  console.log(
    `${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}${r.fix && r.status !== 'PASS' ? `\n      → ${r.fix}` : ''}`,
  );
const failed = results.filter(r => r.status === 'FAIL').length;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
try {
  mkdirSync(join(kit, '.logs'), { recursive: true });
  writeFileSync(
    join(kit, '.logs', `doctor-${stamp}.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        deep,
        node: process.versions.node,
        platform: `${process.platform}-${process.arch}`,
        results,
      },
      null,
      1,
    ),
  );
} catch {
  /* the report is optional */
}
console.log(
  failed
    ? `\n${failed} problem(s) to fix.`
    : `\nAll checks passed. Start with \`vp run dev\`.${deep ? '' : ' (Add `--deep` to try one real Codex request.)'}`,
);
process.exit(failed ? 1 : 0);

// ---- Codex ---------------------------------------------------------------------------------------
function run(
  command: CodexCommand,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(
      command.command,
      [...command.args, ...args],
      { env, timeout: 30000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 1
          : 0;
        resolve({
          code,
          out: `${stdout}\n${stderr}`
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !/PATH aliases|bubblewrap/i.test(l))
            .join('\n'),
        });
      },
    );
  });
}

async function checkCodex() {
  const command = resolveCodex(kit);
  if (isProblem(command)) {
    report('FAIL', 'Codex CLI', command.error, command.fix);
    return;
  }
  const home = codexHome(kit);
  mkdirSync(home.path, { recursive: true }); // Codex refuses a CODEX_HOME that does not exist
  const env = codexEnv(home.path);
  const version = await run(command, ['--version'], env);
  if (!version.out.includes(`codex-cli ${CODEX_VERSION}`)) {
    report(
      'FAIL',
      'Codex CLI',
      version.out.split('\n')[0] || `exit ${version.code}`,
      `den-kit is pinned to ${CODEX_VERSION}: run \`vp install --frozen-lockfile\`.`,
    );
    return;
  }
  report(
    'PASS',
    'Codex CLI',
    `${CODEX_VERSION} (${command.source === 'kit' ? 'node_modules' : 'KIT_CODEX_BIN'})`,
  );
  report(
    home.isolated ? 'PASS' : 'WARN',
    'CODEX_HOME',
    home.isolated
      ? '.codex-home (separate from your own ~/.codex)'
      : `${home.path} (KIT_CODEX_HOME)`,
    home.isolated
      ? undefined
      : 'Your own Codex settings apply (MCP servers, skills, AGENTS.md); unset KIT_CODEX_HOME to keep den-kit isolated.',
  );
  const login = await run(command, ['login', 'status'], env);
  if (login.code !== 0)
    report(
      'FAIL',
      'Codex sign-in',
      login.out.split('\n')[0] || 'not signed in',
      `Run \`${LOGIN_COMMAND}\` (opens ChatGPT sign-in), then rerun the doctor.`,
    );
  else report('PASS', 'Codex sign-in', login.out.split('\n')[0]!);

  const workdir = codexWorkdir(kit);
  /** The deep checks' threads (their tool calls and turns), and the tokens each thread used so far. */
  const watches = new Map<string, Watch>();
  const usage = new Map<string, number>();
  const live = {
    pinged: 0,
    declined: [] as string[],
    items: [] as string[],
    reply: '',
    error: null as TurnError | null,
    done: null as null | ((status: string) => void),
  };
  const ping: ToolSpec = {
    name: 'kit_ping',
    description: 'Connectivity check: call this once, with no arguments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
  const mcp = mcpHandler({
    token: randomBytes(32).toString('hex'),
    version: 'den-kit-doctor',
    tools: () => (deep ? [ping] : toolsFor()),
    call: async (thread, tool, args) => {
      const watched = thread ? (watches.get(thread) ?? subAgentWatch(watches, thread)) : undefined;
      if (watched) return watched.tool(tool, args, thread!);
      if (tool !== 'kit_ping') return { success: false, text: 'Only kit_ping is available.' };
      live.pinged++;
      return PONG;
    },
  });
  const mcpServer = createHttpServer((req, res) => {
    if (!mcp.handle(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>(resolve => mcpServer.listen(0, '127.0.0.1', resolve));
  const mcpAt = {
    url: `http://127.0.0.1:${(mcpServer.address() as { port: number }).port}${MCP_PATH}`,
  };
  const proc = spawnAppServer(command, {
    home: home.path,
    cwd: workdir,
    env: { ...process.env, [MCP_TOKEN_ENV]: mcp.token },
  });
  const notes: RpcNotification[] = [];
  const recording: Array<{ at: number; dir: string; line: string }> = [];
  const peer: RpcPeer = new RpcPeer(
    proc.child.stdout,
    proc.child.stdin,
    {
      onRequest: r => {
        if (Object.hasOwn(DECLINE, r.method)) {
          live.declined.push(r.method);
          peer.respond(r.id, DECLINE[r.method]);
        } else if (r.method === 'currentTime/read')
          peer.respond(r.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        else peer.respondError(r.id, -32601, `den-kit does not support ${r.method}.`);
      },
      onNotification: n => {
        notes.push(n);
        const p = (n.params ?? {}) as Record<string, any>;
        if (n.method === 'thread/tokenUsage/updated' && typeof p.threadId === 'string')
          usage.set(p.threadId, Number(p.tokenUsage?.total?.totalTokens) || 0);
        const watched =
          typeof p.threadId === 'string'
            ? (watches.get(p.threadId) ?? subAgentWatch(watches, p.threadId))
            : undefined;
        if (watched) {
          watched.note(n.method, p);
          return;
        }
        if (n.method === 'item/started' && p.item?.type) live.items.push(p.item.type);
        if (n.method === 'item/completed' && p.item?.type === 'agentMessage')
          live.reply = String(p.item.text ?? '');
        if (n.method === 'error' && !p.willRetry) live.error = p.error ?? null;
        if (n.method === 'turn/completed') live.done?.(String(p.turn?.status ?? 'completed'));
        if (n.method === 'turn/completed' && p.turn?.error) live.error = p.turn.error;
      },
    },
    { trace: deep ? (dir, line) => recording.push({ at: Date.now(), dir, line }) : undefined },
  );
  try {
    const init = await peer.request<InitializeResponse>(
      'initialize',
      {
        clientInfo: { name: 'den-kit', title: 'den-kit doctor', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
      { timeoutMs: 60000 },
    );
    peer.notify('initialized');
    const account = await peer.request<GetAccountResponse>(
      'account/read',
      { refreshToken: false },
      { timeoutMs: 20000 },
    );
    const models = await peer
      .request<ModelListResponse>('model/list', { limit: 100 }, { timeoutMs: 20000 })
      .catch(() => null);
    const wanted = process.env.KIT_CODEX_MODEL?.trim();
    const model = wanted
      ? models?.data.find(m => m.id === wanted || m.model === wanted)
      : models?.data.find(m => m.isDefault);
    if (wanted && !model)
      report(
        'WARN',
        'Codex model',
        `KIT_CODEX_MODEL=${wanted} is not in the model list`,
        `Available: ${(models?.data ?? [])
          .filter(m => !m.hidden)
          .map(m => m.id)
          .join(', ')}`,
      );
    const who = account.account
      ? account.account.type === 'chatgpt'
        ? `ChatGPT ${account.account.planType}`
        : account.account.type
      : 'not signed in';
    report(
      account.account ? 'PASS' : 'WARN',
      'Codex app-server',
      `${init.userAgent.split(' ')[0]} · ${who} · ${model?.displayName ?? wanted ?? 'default model'}${model?.inputModalities.includes('image') ? ' (sees images)' : ''}`,
    );
    const started = await peer.request<ThreadStartResponse>(
      'thread/start',
      threadStartParams({
        model: wanted || null,
        cwd: workdir,
        instructions: deep
          ? 'This is a den-kit connectivity check. Call the kit_ping tool exactly once (no arguments), then reply with the single word: pong.'
          : 'den-kit doctor',
        mcp: mcpAt,
      }),
      { timeoutMs: 20000 },
    );
    await new Promise(r => setTimeout(r, 200));
    const ignored = notes.filter(
      n => n.method === 'warning' && /unrecognized configuration/i.test(JSON.stringify(n.params)),
    );
    if (started.instructionSources.length)
      report(
        home.isolated ? 'FAIL' : 'WARN',
        'Codex isolation',
        `instruction files loaded: ${started.instructionSources.join(', ')}`,
        home.isolated
          ? 'Remove AGENTS.md (or other instruction files) from .codex-home.'
          : 'They come from your KIT_CODEX_HOME.',
      );
    else
      report(
        ignored.length ? 'WARN' : 'PASS',
        'Codex isolation',
        `no instruction files · working dir outside the repo · sandbox ${started.sandbox.type} · approvals ${String(started.approvalPolicy)}${ignored.length ? ' · some settings were ignored' : ''}`,
        ignored.length ? JSON.stringify(ignored[0]!.params).slice(0, 200) : undefined,
      );
    if (!account.account) report('SKIP', 'Codex live request', 'sign in first');
    else if (!deep)
      report(
        'SKIP',
        'Codex live request',
        'run `vp run doctor --deep` to make one real request (uses a little of your ChatGPT usage)',
      );
    else {
      const t0 = Date.now();
      const finished = new Promise<string>(resolve => {
        live.done = resolve;
      });
      await peer.request(
        'turn/start',
        { threadId: started.thread.id, input: [text('den-kit connectivity check: please ping.')] },
        { timeoutMs: 20000 },
      );
      const status = await Promise.race([
        finished,
        new Promise<string>(r => setTimeout(() => r('timeout'), 180000)),
      ]);
      const ms = Date.now() - t0;
      const unexpected = [...new Set(live.items.filter(t => !EXPECTED_ITEMS.has(t)))];
      if (status !== 'completed')
        report(
          'FAIL',
          'Codex live request',
          status === 'timeout'
            ? 'no answer within 3 minutes'
            : `${status}: ${explainCodexError(live.error, `Run \`${LOGIN_COMMAND}\` again.`).message}`,
          explainCodexError(live.error, `Run \`${LOGIN_COMMAND}\` again.`).fix,
        );
      else if (unexpected.length || live.declined.length)
        report(
          'FAIL',
          'Codex live request',
          `Codex tried other tools: ${[...unexpected, ...live.declined].join(', ')}`,
          'den-kit allows only its own tools; send .logs/codex-deep-*.jsonl to the developer.',
        );
      else if (live.pinged !== 1)
        report(
          'WARN',
          'Codex live request',
          `kit_ping was called ${live.pinged} times (expected once) · ${ms} ms`,
          'The model did not follow the instruction exactly; den-kit still works.',
        );
      else
        report(
          'PASS',
          'Codex live request',
          `${(ms / 1000).toFixed(1)} s · kit_ping round trip · reply “${live.reply.slice(0, 40)}”`,
        );
      if (status === 'completed')
        await deepChecks({
          peer,
          workdir,
          mcp: mcpAt,
          model: wanted || null,
          images: !!model?.inputModalities.includes('image'),
          live: started.thread.id,
          watches,
          usage,
        });
    }
    peer
      .request('thread/unsubscribe', { threadId: started.thread.id }, { timeoutMs: 5000 })
      .catch(() => {});
  } catch (error) {
    report(
      'FAIL',
      'Codex app-server',
      describeRpcError(error),
      proc.stderrTail().split('\n').pop() || undefined,
    );
  } finally {
    peer.close('doctor done');
    await proc.stop();
    mcpServer.close();
    if (deep && recording.length) {
      const file = join(
        kit,
        '.logs',
        `codex-deep-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
      );
      try {
        mkdirSync(join(kit, '.logs'), { recursive: true });
        writeFileSync(file, recording.map(r => JSON.stringify(r)).join('\n') + '\n');
        report('PASS', 'Codex recording', file.replace(`${kit}/`, ''));
      } catch {
        /* optional */
      }
    }
  }
}

// ---- What den-kit needs beyond one request ---------------------------------------------------
interface Watch {
  /** Answers a tool call made in this thread or by one of its sub-agents (`thread` says which). */
  tool(tool: string, args: unknown, thread: string): Promise<ToolOutput>;
  note(method: string, p: Record<string, any>): void;
  ended: Promise<string>;
  status: string | null;
  reply: string;
  error: TurnError | null;
  items: string[];
  /** The turn running now (turn/started). */
  turnId: string | null;
  /** The sub-agents it started, by their own thread id. */
  agents: Set<string>;
}
function watching(watches: Map<string, Watch>, id: string, tool: Watch['tool']): Watch {
  let end!: (status: string) => void;
  const w: Watch = {
    tool,
    ended: new Promise<string>(resolve => {
      end = resolve;
    }),
    status: null,
    reply: '',
    error: null,
    items: [],
    turnId: null,
    agents: new Set(),
    note(method, p) {
      // A sub-agent's own thread: its tool calls count for this one, its turns do not.
      if (p.threadId !== id) return;
      if (method === 'turn/started' && p.turn?.id) w.turnId = String(p.turn.id);
      if (
        method === 'item/started' &&
        p.item?.type === 'subAgentActivity' &&
        p.item.kind === 'started'
      )
        w.agents.add(String(p.item.agentThreadId));
      if (method === 'item/started' && p.item?.type) w.items.push(p.item.type);
      if (method === 'item/completed' && p.item?.type === 'agentMessage')
        w.reply = String(p.item.text ?? '');
      if (method === 'error' && !p.willRetry) w.error = p.error ?? null;
      if (method === 'turn/completed') {
        if (p.turn?.error) w.error = p.turn.error;
        w.status = String(p.turn?.status ?? 'completed');
        end(w.status);
      }
    },
  };
  watches.set(id, w);
  return w;
}
/** The watch of the thread that started this sub-agent. */
function subAgentWatch(watches: Map<string, Watch>, thread: string): Watch | undefined {
  for (const w of watches.values()) if (w.agents.has(thread)) return w;
  return undefined;
}
/** A one-colour PNG (the picture check). */
function solidPng([r, g, b]: [number, number, number], size = 32): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) row.set([r, g, b], 1 + i * 3);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function deepChecks(c: {
  peer: RpcPeer;
  workdir: string;
  mcp: { url: string };
  model: string | null;
  images: boolean;
  /** The live request's conversation (saved): the one read back. */
  live: string;
  watches: Map<string, Watch>;
  usage: Map<string, number>;
}) {
  const { peer } = c;
  /** How long the held tool call waits (a kit_bash command runs up to 2 minutes unless it asks for more). */
  const WAIT_MS = Number(process.env.KIT_DOCTOR_TOOL_WAIT_MS) || 75000;
  const PING_RULE =
    'This is a den-kit check. Call the kit_ping tool exactly once (no arguments), then reply with the single word: pong.';
  const PICTURE_RULE =
    'This is a den-kit picture check. Call the kit_ping tool exactly once (no arguments). Then reply with the colours of all the pictures you were given, as lowercase colour words separated by spaces (for example: green yellow).';
  const SUB_AGENT_RULE =
    'This is a den-kit sub-agent check. Do not call kit_ping yourself. Start exactly one sub-agent whose only task is to call the kit_ping tool exactly once (no arguments) and then finish. Wait for it to finish, then reply with the single word: pong.';
  const thread = async (instructions: string) =>
    (
      await peer.request<ThreadStartResponse>(
        'thread/start',
        threadStartParams({ model: c.model, cwd: c.workdir, instructions, mcp: c.mcp }),
        { timeoutMs: 20000 },
      )
    ).thread.id;
  const turn = (threadId: string, input: UserInput[]) =>
    peer.request('turn/start', { threadId, input }, { timeoutMs: 20000 });
  const within = (p: Promise<string>, ms: number) =>
    Promise.race([p, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), ms))]);
  const why = (w: Watch, status: string) =>
    status === 'timeout'
      ? 'no answer within 3 minutes'
      : `${status}: ${explainCodexError(w.error, `Run \`${LOGIN_COMMAND}\` again.`).message}`;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  const opened: string[] = [];
  try {
    // A sub-agent gets den-kit's tools from the MCP server, and its calls say which conversation made them.
    const s = await thread(SUB_AGENT_RULE);
    opened.push(s);
    const from: string[] = [];
    const team = watching(c.watches, s, async (_tool, _args, caller) => {
      from.push(caller);
      return PONG;
    });
    await turn(s, [
      text(
        'den-kit sub-agent check: start one sub-agent that calls kit_ping once, wait for it, then reply pong.',
      ),
    ]);
    const teamDone = await within(team.ended, 180000);
    const child = [...team.agents][0];
    if (teamDone !== 'completed')
      report(
        'FAIL',
        'Codex sub-agents',
        why(team, teamDone),
        'Sub-agents cannot work: send .logs/codex-deep-*.jsonl to the developer.',
      );
    else if (!child)
      report(
        'WARN',
        'Codex sub-agents',
        'the model did not start a sub-agent',
        'Requests still work; they run without sub-agents.',
      );
    else if (!from.includes(child))
      report(
        'FAIL',
        'Codex sub-agents',
        `the sub-agent's tool call ${from.length ? 'came from another conversation' : 'did not arrive'}`,
        'den-kit cannot hold a sub-agent to its scope: send .logs/codex-deep-*.jsonl to the developer.',
      );
    else
      report(
        'PASS',
        'Codex sub-agents',
        "a sub-agent called den-kit's tool from its own conversation",
      );

    // Two requests at once (two windows); one holds its tool call as a long kit_bash command does.
    const [a, b] = await Promise.all([thread(PING_RULE), thread(PING_RULE)]);
    opened.push(a, b);
    const held = watching(
      c.watches,
      a,
      () => new Promise<ToolOutput>(resolve => setTimeout(() => resolve(PONG), WAIT_MS)),
    );
    const quick = watching(c.watches, b, async () => PONG);
    const t0 = Date.now();
    await Promise.all([
      turn(a, [text('den-kit connectivity check (request A): please ping.')]),
      turn(b, [text('den-kit connectivity check (request B): please ping.')]),
    ]);
    const first = await within(quick.ended, 180000);
    const odd = () => [
      ...new Set([...held.items, ...quick.items].filter(t => !EXPECTED_ITEMS.has(t))),
    ];
    if (first !== 'completed')
      report(
        'FAIL',
        'Codex two requests',
        `the second of two requests at once: ${why(quick, first)}`,
        'Two windows cannot ask the AI at the same time: ask in one window at a time and tell the developer.',
      );
    else if (held.status)
      report(
        'WARN',
        'Codex two requests',
        'the second request ended only after the first: they took turns',
        'Requests from two windows run one after another; den-kit still works.',
      );
    else
      report(
        'PASS',
        'Codex two requests',
        `two requests at once: one finished in ${seconds(Date.now() - t0)} while the other's tool call was held`,
      );

    // Pictures: one with the request, one added while it works (a sketch sent with a request, or while it runs).
    if (!c.images)
      report(
        'SKIP',
        'Codex pictures',
        'the model does not take pictures: sketches and shared screens go as words only',
      );
    else {
      const p = await thread(PICTURE_RULE);
      opened.push(p);
      let steered: string | null = null;
      const pictures: Watch = watching(c.watches, p, async () => {
        try {
          await peer.request(
            'turn/steer',
            {
              threadId: p,
              input: [
                text('Here is one more picture.'),
                { type: 'image', url: solidPng([0, 0, 255]) },
              ],
              expectedTurnId: pictures.turnId,
            },
            { timeoutMs: 20000 },
          );
          steered = 'ok';
        } catch (error) {
          steered = describeRpcError(error);
        }
        return PONG;
      });
      await turn(p, [
        text('den-kit picture check: what colour is this picture?'),
        { type: 'image', url: solidPng([255, 0, 0]) },
      ]);
      const done = await within(pictures.ended, 180000);
      const said = pictures.reply.toLowerCase();
      if (done !== 'completed')
        report(
          'FAIL',
          'Codex pictures',
          why(pictures, done),
          'Sketches and shared screens cannot reach the AI; send .logs/codex-deep-*.jsonl to the developer.',
        );
      else if (steered !== 'ok')
        report(
          'WARN',
          'Codex pictures',
          `a picture added while it worked did not go through (${steered ?? 'the model did not call kit_ping'})`,
          'A sketch sent while the AI works may reach it as words only.',
        );
      else if (said.includes('red') && said.includes('blue'))
        report(
          'PASS',
          'Codex pictures',
          `with the request and added while it worked: “${pictures.reply.slice(0, 40)}”`,
        );
      else
        report(
          'WARN',
          'Codex pictures',
          `the reply did not name both colours: “${pictures.reply.slice(0, 60)}”`,
          'The model may not look at every picture; sketches also go as words.',
        );
    }

    // A saved conversation reads back: den-kit shows it again after a restart.
    try {
      const items = await peer.request<{ data: unknown[] }>(
        'thread/items/list',
        { threadId: c.live, limit: 50 },
        { timeoutMs: 20000 },
      );
      report(
        items.data.length ? 'PASS' : 'WARN',
        'Codex conversation',
        items.data.length
          ? `a saved conversation reads back (${items.data.length} items)`
          : 'the conversation read back empty',
        'An earlier conversation may not show again after a restart; requests still work.',
      );
    } catch (error) {
      report(
        'WARN',
        'Codex conversation',
        `a saved conversation cannot be read back (${describeRpcError(error)})`,
        'An earlier conversation does not show again after a restart; requests still work.',
      );
    }

    // The held tool call: the request goes on after it.
    const last = await within(held.ended, WAIT_MS + 180000);
    if (last !== 'completed')
      report(
        'FAIL',
        'Codex long tool wait',
        `a tool call answered after ${seconds(WAIT_MS)}: ${why(held, last)}`,
        'A request could end while a long kit_bash command runs: tell the developer.',
      );
    else
      report(
        'PASS',
        'Codex long tool wait',
        `a tool call answered after ${seconds(WAIT_MS)}; the request went on (a kit_bash command holds one while it runs)`,
      );
    if (odd().length)
      report(
        'FAIL',
        'Codex two requests',
        `Codex tried other tools: ${odd().join(', ')}`,
        'den-kit allows only its own tools; send .logs/codex-deep-*.jsonl to the developer.',
      );

    // Token counts (per request in the AI panel).
    const total = [...c.usage.values()].reduce((sum, n) => sum + n, 0);
    report(
      total ? 'PASS' : 'WARN',
      'Codex token counts',
      total
        ? `${total.toLocaleString('en-US')} tokens for these checks`
        : 'Codex sent no token counts',
      total ? undefined : 'The AI panel cannot show tokens per request; everything else works.',
    );
  } catch (error) {
    report('FAIL', 'Codex two requests', describeRpcError(error));
  } finally {
    for (const id of opened)
      peer.request('thread/unsubscribe', { threadId: id }, { timeoutMs: 5000 }).catch(() => {});
  }
}

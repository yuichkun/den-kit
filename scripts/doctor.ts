// `npm run kit:doctor`: checks the local setup step by step and says how to fix each problem.
//   Node, dependencies, ports · Jev (key present, masked; three tiny live requests) ·
//   Codex (pinned CLI, isolated CODEX_HOME, sign-in, app-server, thread isolation).
// `npm run kit:doctor -- --deep` also makes one real Codex request with a ping tool and
// records the whole JSON-RPC conversation to kit/.logs/codex-deep-*.jsonl.
// Every run writes its results to kit/.logs/doctor-*.json (secrets masked).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnvFile, maskSecret } from '../bridge/env.ts';
import { JevClient, JEV_MODEL } from '../bridge/jev.ts';
import { RpcPeer } from '../bridge/codex/rpc.ts';
import { codexEnv, codexHome, codexWorkdir, isProblem, LOGIN_COMMAND, resolveCodex, spawnAppServer, type CodexCommand } from '../bridge/codex/process.ts';
import { describeRpcError, text, threadStartParams } from '../bridge/codex/client.ts';
import { CODEX_VERSION, DECLINE, EXPECTED_ITEMS, explainCodexError, type GetAccountResponse, type InitializeResponse, type ModelListResponse, type RpcNotification, type ThreadStartResponse, type TurnError } from '../bridge/codex/protocol.ts';
import { KIT_TOOLS, type ToolSpec } from '../src/ai/llm-spec.ts';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
const deep = process.argv.includes('--deep');
const kit = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
loadEnvFile(join(kit, '.env'));
const den = dirname(kit);
const results: Array<{ status: Status; name: string; detail: string; fix?: string }> = [];
const report = (status: Status, name: string, detail: string, fix?: string) => { results.push({ status, name, detail, fix }); };
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

// 1. Node
const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
if (major >= 24 || (major === 22 && minor >= 18)) report(major >= 24 ? 'PASS' : 'WARN', 'Node.js', `v${process.versions.node}`, major >= 24 ? undefined : 'den targets Node 24 (see .node-version); 22.18+ works for den-kit.');
else report('FAIL', 'Node.js', `v${process.versions.node}`, 'Install Node 24 (e.g. `fnm install 24` or `nvm install 24`).');

// 2. Dependencies
const core = join(den, 'node_modules/@unworklet/core/package.json');
if (!existsSync(core)) report('FAIL', 'den dependencies', 'missing node_modules at the repo root', 'Run `npm ci` in the den repo root.');
else { const v = json(core).version; report(v === '0.4.1' ? 'PASS' : 'FAIL', '@unworklet/core', v, v === '0.4.1' ? undefined : 'den-kit is pinned to unworklet 0.4.1: run `npm ci` at the repo root.'); }
if (existsSync(join(kit, '@unworklet')) || existsSync(join(kit, 'node_modules/@unworklet/core'))) report('FAIL', 'single @unworklet/core', 'kit/node_modules has its own copy', 'Delete kit/node_modules/@unworklet and run `npm run kit:setup`.');
for (const [name, path] of [['vue', 'node_modules/vue/package.json'], ['@vue-flow/core', 'node_modules/@vue-flow/core/package.json'], ['vite', 'node_modules/vite/package.json']] as const) {
  report(existsSync(join(kit, path)) ? 'PASS' : 'FAIL', name, existsSync(join(kit, path)) ? json(join(kit, path)).version : 'not installed', 'Run `npm run kit:setup` from the repo root.');
}

// 3. Ports (editor and AI bridge)
const portFree = (port: number) => new Promise<boolean>(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
for (const [name, env, fallback] of [['editor port', 'KIT_PORT', 5180], ['AI bridge port', 'KIT_BRIDGE_PORT', 5181]] as const) {
  const port = Number(process.env[env] ?? fallback);
  const free = await portFree(port);
  report(free ? 'PASS' : 'WARN', `${name} ${port}`, free ? 'free' : 'in use', free ? undefined : `Another kit:dev may be running; stop it or set ${env}.`);
}

// 4. Jev (TypeSafe System One): key from the environment or kit/.env, never printed.
const key = process.env.TYPESAFE_API_KEY;
if (!key) report('WARN', 'Jev key', 'not set — the fast path will use the built-in lexicon only', 'Add `TYPESAFE_API_KEY=…` to kit/.env (this file is git-ignored), then rerun `npm run kit:doctor`.');
else {
  report('PASS', 'Jev key', maskSecret(key));
  const jev = new JevClient({ apiKey: key, baseUrl: process.env.KIT_JEV_BASE });
  const times: number[] = [];
  let failure: string | undefined;
  let warning: string | undefined;
  for (let i = 0; i < 3 && !failure; i++) {
    const r = await jev.ask({ state: 'den-kit doctor', questions: { ping: { type: 'noul', instructions: 'Is this message a connectivity check?' } } }, { budgetMs: 8000 });
    if (r.ok) { times.push(r.ms); warning ??= r.modelWarning; } else failure = `${r.error.kind}: ${r.error.message}`;
  }
  if (failure) {
    const fix = /^auth/.test(failure) ? 'The key was rejected: check TYPESAFE_API_KEY in kit/.env (no quotes or spaces).'
      : /^(network|timeout)/.test(failure) ? 'Check the network / proxy; den-kit still works with the lexicon only.'
      : /^busy/.test(failure) ? 'Jev is rate-limited or overloaded right now; try again in a minute.' : undefined;
    report('FAIL', 'Jev request', failure, fix);
  } else {
    const sorted = [...times].sort((a, b) => a - b);
    report(warning ? 'WARN' : 'PASS', 'Jev request', `${JEV_MODEL} · ${times.join(' / ')} ms (median ${sorted[1]} ms)`, warning);
  }
}

// 5. Codex (the LLM path)
if (process.env.KIT_CODEX === 'off') report('SKIP', 'Codex', 'KIT_CODEX=off');
else await checkCodex();

const width = Math.max(...results.map(r => r.name.length));
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}${r.fix && r.status !== 'PASS' ? `\n      → ${r.fix}` : ''}`);
const failed = results.filter(r => r.status === 'FAIL').length;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
try { mkdirSync(join(kit, '.logs'), { recursive: true }); writeFileSync(join(kit, '.logs', `doctor-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), deep, node: process.versions.node, platform: `${process.platform}-${process.arch}`, results }, null, 1)); } catch { /* the report is optional */ }
console.log(failed ? `\n${failed} problem(s) to fix.` : `\nAll checks passed. Start with \`npm run kit:dev\`.${deep ? '' : ' (Add `-- --deep` to try one real Codex request.)'}`);
process.exit(failed ? 1 : 0);

// ---- Codex ---------------------------------------------------------------------------------------
function run(command: CodexCommand, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(command.command, [...command.args, ...args], { env, timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout}\n${stderr}`.split('\n').map(l => l.trim()).filter(l => l && !/PATH aliases|bubblewrap/i.test(l)).join('\n') });
    });
  });
}

async function checkCodex() {
  const command = resolveCodex(kit);
  if (isProblem(command)) { report('FAIL', 'Codex CLI', command.error, command.fix); return; }
  const home = codexHome(kit);
  mkdirSync(home.path, { recursive: true }); // Codex refuses a CODEX_HOME that does not exist
  const env = codexEnv(home.path);
  const version = await run(command, ['--version'], env);
  if (!version.out.includes(`codex-cli ${CODEX_VERSION}`)) { report('FAIL', 'Codex CLI', version.out.split('\n')[0] || `exit ${version.code}`, `den-kit is pinned to ${CODEX_VERSION}: run \`npm run kit:setup\`.`); return; }
  report('PASS', 'Codex CLI', `${CODEX_VERSION} (${command.source === 'kit' ? 'kit/node_modules' : 'KIT_CODEX_BIN'})`);
  report(home.isolated ? 'PASS' : 'WARN', 'CODEX_HOME', home.isolated ? 'kit/.codex-home (separate from your own ~/.codex)' : `${home.path} (KIT_CODEX_HOME)`, home.isolated ? undefined : 'Your own Codex settings apply (MCP servers, skills, AGENTS.md); unset KIT_CODEX_HOME to keep den-kit isolated.');
  const login = await run(command, ['login', 'status'], env);
  if (login.code !== 0) report('FAIL', 'Codex sign-in', login.out.split('\n')[0] || 'not signed in', `Run \`${LOGIN_COMMAND}\` (opens ChatGPT sign-in), then rerun the doctor.`);
  else report('PASS', 'Codex sign-in', login.out.split('\n')[0]!);

  const workdir = codexWorkdir(kit);
  const proc = spawnAppServer(command, { home: home.path, cwd: workdir });
  const notes: RpcNotification[] = [];
  const recording: Array<{ at: number; dir: string; line: string }> = [];
  const live = { pinged: 0, declined: [] as string[], items: [] as string[], reply: '', error: null as TurnError | null, done: null as null | ((status: string) => void) };
  const peer: RpcPeer = new RpcPeer(proc.child.stdout, proc.child.stdin, {
    onRequest: r => {
      const params = (r.params ?? {}) as { tool?: string };
      if (r.method === 'item/tool/call' && params.tool === 'kit_ping') { live.pinged++; peer.respond(r.id, { contentItems: [{ type: 'inputText', text: 'pong-from-den-kit' }], success: true }); }
      else if (r.method === 'item/tool/call') peer.respond(r.id, { contentItems: [{ type: 'inputText', text: 'Only kit_ping is available.' }], success: false });
      else if (Object.hasOwn(DECLINE, r.method)) { live.declined.push(r.method); peer.respond(r.id, DECLINE[r.method]); }
      else if (r.method === 'currentTime/read') peer.respond(r.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
      else peer.respondError(r.id, -32601, `den-kit does not support ${r.method}.`);
    },
    onNotification: n => {
      notes.push(n);
      const p = (n.params ?? {}) as Record<string, any>;
      if (n.method === 'item/started' && p.item?.type) live.items.push(p.item.type);
      if (n.method === 'item/completed' && p.item?.type === 'agentMessage') live.reply = String(p.item.text ?? '');
      if (n.method === 'error' && !p.willRetry) live.error = p.error ?? null;
      if (n.method === 'turn/completed') live.done?.(String(p.turn?.status ?? 'completed'));
      if (n.method === 'turn/completed' && p.turn?.error) live.error = p.turn.error;
    },
  }, { trace: deep ? (dir, line) => recording.push({ at: Date.now(), dir, line }) : undefined });
  try {
    const init = await peer.request<InitializeResponse>('initialize', { clientInfo: { name: 'den-kit', title: 'den-kit doctor', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: 60000 });
    peer.notify('initialized');
    const account = await peer.request<GetAccountResponse>('account/read', { refreshToken: false }, { timeoutMs: 20000 });
    const models = await peer.request<ModelListResponse>('model/list', { limit: 100 }, { timeoutMs: 20000 }).catch(() => null);
    const wanted = process.env.KIT_CODEX_MODEL?.trim();
    const model = wanted ? models?.data.find(m => m.id === wanted || m.model === wanted) : models?.data.find(m => m.isDefault);
    if (wanted && !model) report('WARN', 'Codex model', `KIT_CODEX_MODEL=${wanted} is not in the model list`, `Available: ${(models?.data ?? []).filter(m => !m.hidden).map(m => m.id).join(', ')}`);
    const who = account.account ? (account.account.type === 'chatgpt' ? `ChatGPT ${account.account.planType}` : account.account.type) : 'not signed in';
    report(account.account ? 'PASS' : 'WARN', 'Codex app-server', `${init.userAgent.split(' ')[0]} · ${who} · ${model?.displayName ?? wanted ?? 'default model'}${model?.inputModalities.includes('image') ? ' (sees images)' : ''}`);
    const ping: ToolSpec = { name: 'kit_ping', description: 'Connectivity check: call this once, with no arguments.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
    const started = await peer.request<ThreadStartResponse>('thread/start', threadStartParams({ model: wanted || null, cwd: workdir, instructions: deep ? 'This is a den-kit connectivity check. Call the kit_ping tool exactly once (no arguments), then reply with the single word: pong.' : 'den-kit doctor', tools: deep ? [ping] : KIT_TOOLS }), { timeoutMs: 20000 });
    await new Promise(r => setTimeout(r, 200));
    const ignored = notes.filter(n => n.method === 'warning' && /unrecognized configuration/i.test(JSON.stringify(n.params)));
    if (started.instructionSources.length) report(home.isolated ? 'FAIL' : 'WARN', 'Codex isolation', `instruction files loaded: ${started.instructionSources.join(', ')}`, home.isolated ? 'Remove AGENTS.md (or other instruction files) from kit/.codex-home.' : 'They come from your KIT_CODEX_HOME.');
    else report(ignored.length ? 'WARN' : 'PASS', 'Codex isolation', `no instruction files · working dir outside the repo · sandbox ${started.sandbox.type} · approvals ${String(started.approvalPolicy)}${ignored.length ? ' · some settings were ignored' : ''}`, ignored.length ? JSON.stringify(ignored[0]!.params).slice(0, 200) : undefined);
    if (!account.account) report('SKIP', 'Codex live request', 'sign in first');
    else if (!deep) report('SKIP', 'Codex live request', 'run `npm run kit:doctor -- --deep` to make one real request (uses a little of your ChatGPT usage)');
    else {
      const t0 = Date.now();
      const finished = new Promise<string>(resolve => { live.done = resolve; });
      await peer.request('turn/start', { threadId: started.thread.id, input: [text('den-kit connectivity check: please ping.')] }, { timeoutMs: 20000 });
      const status = await Promise.race([finished, new Promise<string>(r => setTimeout(() => r('timeout'), 180000))]);
      const ms = Date.now() - t0;
      const unexpected = [...new Set(live.items.filter(t => !EXPECTED_ITEMS.has(t)))];
      if (status !== 'completed') report('FAIL', 'Codex live request', status === 'timeout' ? 'no answer within 3 minutes' : `${status}: ${explainCodexError(live.error, `Run \`${LOGIN_COMMAND}\` again.`).message}`, explainCodexError(live.error, `Run \`${LOGIN_COMMAND}\` again.`).fix);
      else if (unexpected.length || live.declined.length) report('FAIL', 'Codex live request', `Codex tried other tools: ${[...unexpected, ...live.declined].join(', ')}`, 'den-kit allows only its own tools; send kit/.logs/codex-deep-*.jsonl to the developer.');
      else if (live.pinged !== 1) report('WARN', 'Codex live request', `kit_ping was called ${live.pinged} times (expected once) · ${ms} ms`, 'The model did not follow the instruction exactly; den-kit still works.');
      else report('PASS', 'Codex live request', `${(ms / 1000).toFixed(1)} s · kit_ping round trip · reply “${live.reply.slice(0, 40)}”`);
    }
    peer.request('thread/unsubscribe', { threadId: started.thread.id }, { timeoutMs: 5000 }).catch(() => {});
  } catch (error) {
    report('FAIL', 'Codex app-server', describeRpcError(error), proc.stderrTail().split('\n').pop() || undefined);
  } finally {
    peer.close('doctor done');
    await proc.stop();
    if (deep && recording.length) {
      const file = join(kit, '.logs', `codex-deep-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
      try { mkdirSync(join(kit, '.logs'), { recursive: true }); writeFileSync(file, recording.map(r => JSON.stringify(r)).join('\n') + '\n'); report('PASS', 'Codex recording', file.replace(`${kit}/`, 'kit/')); } catch { /* optional */ }
    }
  }
}

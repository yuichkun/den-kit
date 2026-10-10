#!/usr/bin/env node
// A stand-in for the pinned `codex` CLI (0.160.1): `--version`, `login status`,
// `login` and `app-server` (JSON-RPC lines on stdio). It behaves like the real
// server did in offline probes (see README.md here) and checks every message
// den-kit sends against the generated protocol types; violations are logged to
// FAKE_CODEX_LOG (and stderr) so tests fail on them.
//
// Turns are scripted: FAKE_CODEX_SCENARIOS names a module whose default export is
// Scenario[]; the first whose `match` fits the user text runs (see scenarios.ts).
//
// Environment:
//   CODEX_HOME            must exist (like the real CLI); auth.json there = signed in
//   FAKE_CODEX_AUTH       chatgpt | none (overrides auth.json)
//   FAKE_CODEX_LOG        JSONL file: every message received, every violation
//   FAKE_CODEX_SCENARIOS  scenario module path
//   FAKE_CODEX_FAULT      crash-on-start | hang-initialize | garbage | exit-after-init
//   FAKE_CODEX_SPLIT      1: write every message in two chunks (tests line buffering)
//   FAKE_CODEX_STARTUP_MS delay before the first reply
//   FAKE_CODEX_LATE_INTERRUPT_MS  reply delay for interrupting a finished turn (real: ~9.5 s)
//   FAKE_CODEX_FORK       refuse: thread/fork fails ("no rollout found", like an ephemeral thread may)
import { appendFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type CodexErrorInfo = string | Record<string, unknown>;
export interface TurnApi {
  readonly threadId: string;
  readonly turnId: string;
  /** The text that started the turn. */
  readonly text: string;
  /** Pictures that came with it (data: URLs), and with each steer. */
  readonly images: string[];
  /** This turn's conversation is a copy of another (thread/fork): its id. */
  readonly forkedFrom: string | null;
  /** Texts steered into the turn so far. */
  readonly steers: string[];
  readonly interrupted: boolean;
  say(text: string, chunks?: number): Promise<void>;
  think(): Promise<void>;
  /** A kit_* tool round trip through den-kit. */
  call(tool: string, args: unknown): Promise<{ success: boolean; text: string; images: number }>;
  /** Any server → client request (approvals, requestUserInput, …); resolves with den-kit's answer. */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params: Record<string, unknown>): void;
  /** An `error` notification for this turn. */
  error(info: CodexErrorInfo, message: string, willRetry: boolean): void;
  rateLimits(usedPercent: number, resetsAt?: number): void;
  /** thread/tokenUsage/updated for this conversation (adds to its running total). */
  usage(input: number, output: number, cached?: number, reasoning?: number): void;
  waitForSteer(ms: number): Promise<string | null>;
  sleep(ms: number): Promise<void>;
  /** Write a raw line (malformed-input tests). */
  raw(line: string): void;
  crash(code?: number): never;
}
export type ScenarioResult = void | 'completed' | { status: 'failed'; message: string; info: CodexErrorInfo };
export interface Scenario { name: string; match: RegExp | ((text: string) => boolean); run(api: TurnApi): Promise<ScenarioResult> }

const env = process.env;
const args = process.argv.slice(2);
const home = env.CODEX_HOME;
const logFile = env.FAKE_CODEX_LOG;
const log = (record: Record<string, unknown>) => { if (logFile) try { appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), ...record })}\n`); } catch { /* ignore */ } };
const violation = (message: string, data?: unknown) => { log({ violation: message, data }); process.stderr.write(`fake-codex VIOLATION: ${message}\n`); };
const signedIn = () => env.FAKE_CODEX_AUTH ? env.FAKE_CODEX_AUTH === 'chatgpt' : !!home && existsSync(join(home, 'auth.json'));

// ---- CLI ---------------------------------------------------------------------------------------
if (home && !existsSync(home)) {
  process.stderr.write(`Error loading configuration: CODEX_HOME points to "${home}", but that path does not exist\n`);
  process.exit(1);
}
if (args[0] === '--version') { process.stdout.write('codex-cli 0.160.1\n'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') {
  if (signedIn()) { process.stdout.write('Logged in using ChatGPT\n'); process.exit(0); }
  process.stdout.write('Not logged in\n'); process.exit(1);
}
if (args[0] === 'login') {
  writeFileSync(join(home!, 'auth.json'), JSON.stringify({ fake: true }));
  process.stdout.write('Successfully logged in\n');
  process.exit(0);
}
if (args[0] !== 'app-server') { process.stderr.write(`fake-codex: unsupported arguments ${args.join(' ')}\n`); process.exit(2); }

// ---- app-server --------------------------------------------------------------------------------
if (env.FAKE_CODEX_FAULT === 'crash-on-start') { process.stderr.write('fake-codex: crashing on start\n'); process.exit(3); }
const scenarios: Scenario[] = env.FAKE_CODEX_SCENARIOS ? (await import(pathToFileURL(env.FAKE_CODEX_SCENARIOS).href)).default : [];
const split = env.FAKE_CODEX_SPLIT === '1';
const startupMs = Number(env.FAKE_CODEX_STARTUP_MS ?? 0);
const lateInterruptMs = Number(env.FAKE_CODEX_LATE_INTERRUPT_MS ?? 9500);

let writing = Promise.resolve();
function write(message: unknown) {
  const line = `${JSON.stringify(message)}\n`;
  if (!split) { process.stdout.write(line); return; }
  // Two chunks, cut inside a multi-byte character when the line has one.
  const bytes = Buffer.from(line);
  const wide = bytes.findIndex(b => b >= 0x80);
  const at = wide >= 0 ? wide + 1 : Math.max(1, Math.floor(bytes.length / 2));
  writing = writing.then(async () => { process.stdout.write(bytes.subarray(0, at)); await new Promise(r => setTimeout(r, 2)); process.stdout.write(bytes.subarray(at)); });
}
const notify = (method: string, params: Record<string, unknown>) => write({ method, params, emittedAtMs: Date.now() });
const respond = (id: unknown, result: unknown) => write({ id, result });
const refuse = (id: unknown, message: string) => write({ error: { code: -32600, message }, id });

if (env.FAKE_CODEX_FAULT === 'garbage') { process.stdout.write('this is not json\n{"half": \n\n[1,2,3]\n'); }

let initialized = false, sawInitialized = false;
let login: { id: string; timer?: ReturnType<typeof setTimeout> } | null = null;
let serial = 0;
const pending = new Map<string | number, { resolve: (v: unknown) => void; method: string; turn: TurnState | null }>();
/** Requests the fake resolved itself (turn ended): a reply crossing that on the wire is a benign race. */
const resolvedIds = new Set<string | number>();
interface TurnState { id: string; thread: ThreadState; active: boolean; interrupted: boolean; steers: string[]; steersRead: number; steerWaiters: Array<(t: string) => void>; started: number; images: string[] }
interface ThreadState { id: string; turn: TurnState | null; tools: Set<string>; unsubscribed: boolean; forkedFrom: string | null; usage: { input: number; cached: number; output: number; reasoning: number } }
const textOf = (input: unknown) => (input as Array<{ type: string; text?: string }>).filter(i => i.type === 'text').map(i => i.text).join('\n');
const imagesOf = (input: unknown) => (input as Array<{ type: string; url?: string }>).filter(i => i.type === 'image').map(i => i.url!);
const threads = new Map<string, ThreadState>();

const MODELS = [
  { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', upgrade: null, upgradeInfo: null, availabilityNux: null, displayName: 'GPT-6.1-Sol', description: 'Latest workhorse model for coding and everyday work.', modelSpecialty: null, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'medium', description: 'Balanced' }], defaultReasoningEffort: 'low', inputModalities: ['text', 'image'], supportsPersonality: false, multiAgentVersion: 'v2', additionalSpeedTiers: ['fast'], serviceTiers: [], defaultServiceTier: null, availableAccessPrograms: null, isDefault: true },
  { id: 'gpt-6-luna', model: 'gpt-6-luna', upgrade: null, upgradeInfo: null, availabilityNux: null, displayName: 'GPT-6-Luna', description: 'Fast model for routine work.', modelSpecialty: null, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }], defaultReasoningEffort: 'low', inputModalities: ['text'], supportsPersonality: false, multiAgentVersion: null, additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, availableAccessPrograms: null, isDefault: false },
];

// ---- conformance checks (from the generated 0.160.1 types) ----------------------------------------
const THREAD_START_KEYS = new Set(['model', 'modelProvider', 'allowProviderModelFallback', 'serviceTier', 'cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'permissions', 'config', 'serviceName', 'baseInstructions', 'developerInstructions', 'personality', 'multiAgentMode', 'ephemeral', 'historyMode', 'sessionStartSource', 'threadSource', 'projectId', 'daybreakEnabled', 'environments', 'dynamicTools', 'selectedCapabilityRoots', 'mockExperimentalField', 'experimentalRawEvents']);
const THREAD_FORK_KEYS = new Set(['threadId', 'lastTurnId', 'beforeTurnId', 'path', 'model', 'modelProvider', 'serviceTier', 'cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'permissions', 'config', 'baseInstructions', 'developerInstructions', 'ephemeral', 'threadSource', 'excludeTurns', 'deferGoalContinuation']);
const TURN_START_KEYS = new Set(['threadId', 'disabledPluginIds', 'clientUserMessageId', 'input', 'turnTrigger', 'toolOutput', 'responsesapiClientMetadata', 'additionalContext', 'environments', 'cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'permissions', 'model', 'serviceTier', 'serviceTierForTurn', 'effort', 'summary', 'personality', 'outputSchema', 'collaborationMode', 'multiAgentMode', 'cyberAccessProgram']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function checkInput(input: unknown, where: string): string | null {
  if (!Array.isArray(input) || !input.length) return `${where}: input must be a non-empty array`;
  for (const item of input) {
    if (isObj(item) && item.type === 'image') {
      if (typeof item.url !== 'string' || !item.url.startsWith('data:image/')) return `${where}: image items must be {type:"image", url} with a data:image/ URL`;
      continue;
    }
    if (!isObj(item) || item.type !== 'text' || typeof item.text !== 'string') return `${where}: input items must be {type:"text", text} or {type:"image", url}`;
    if (!Array.isArray(item.text_elements)) return `${where}: missing field \`text_elements\``;
  }
  if (!(input as Array<{ type: string }>).some(i => i.type === 'text')) return `${where}: input needs a text item`;
  return null;
}
function checkThreadStart(p: Record<string, unknown>): string | null {
  for (const key of Object.keys(p)) if (!THREAD_START_KEYS.has(key)) return `thread/start: unknown field \`${key}\``;
  if (p.sandbox !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(String(p.sandbox))) return 'thread/start: bad sandbox';
  if (p.approvalPolicy !== undefined && !['untrusted', 'on-request', 'never'].includes(String(p.approvalPolicy)) && !isObj(p.approvalPolicy)) return 'thread/start: bad approvalPolicy';
  if (p.environments !== undefined && p.environments !== null && !Array.isArray(p.environments)) return 'thread/start: environments must be an array';
  if (p.config !== undefined && p.config !== null && !isObj(p.config)) return 'thread/start: config must be an object';
  if (isObj(p.config) && p.config.web_search !== undefined && !['disabled', 'cached', 'indexed', 'live'].includes(String(p.config.web_search))) return 'failed to load configuration: unknown variant in `web_search`';
  if (p.dynamicTools !== undefined && p.dynamicTools !== null) {
    if (!Array.isArray(p.dynamicTools)) return 'thread/start: dynamicTools must be an array';
    for (const t of p.dynamicTools) {
      if (!isObj(t) || t.type !== 'function' || typeof t.name !== 'string' || typeof t.description !== 'string' || !isObj(t.inputSchema)) return 'thread/start: bad dynamic tool';
      if (!/^[a-zA-Z0-9_-]+$/.test(t.name)) return `dynamic tool name must match ^[a-zA-Z0-9_-]+$ to match Responses API: ${t.name}`;
    }
  }
  return null;
}
function checkReply(method: string, result: unknown): string | null {
  if (method === 'item/tool/call') {
    if (!isObj(result) || typeof result.success !== 'boolean' || !Array.isArray(result.contentItems)) return 'tool call reply must be {contentItems, success}';
    for (const c of result.contentItems) {
      if (!isObj(c)) return 'bad content item';
      if (c.type === 'inputText' ? typeof c.text !== 'string' : c.type === 'inputImage' ? typeof c.imageUrl !== 'string' || !String(c.imageUrl).startsWith('data:image/') : true) return `bad content item ${JSON.stringify(c).slice(0, 80)}`;
    }
  } else if (method === 'item/tool/requestUserInput') {
    if (!isObj(result) || !isObj(result.answers)) return 'requestUserInput reply must be {answers}';
    for (const a of Object.values(result.answers)) if (!isObj(a) || !Array.isArray(a.answers) || !a.answers.every(x => typeof x === 'string')) return 'requestUserInput answers must be {answers: string[]}';
  } else if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    if (!isObj(result) || !['accept', 'acceptForSession', 'decline', 'cancel'].includes(String(result.decision))) return `${method} reply must carry a decision`;
  } else if (method === 'item/permissions/requestApproval') {
    if (!isObj(result) || !isObj(result.permissions) || !['turn', 'session'].includes(String(result.scope))) return 'permissions reply must be {permissions, scope}';
  } else if (method === 'mcpServer/elicitation/request') {
    if (!isObj(result) || !['accept', 'decline', 'cancel'].includes(String(result.action)) || !('content' in result) || !('_meta' in result)) return 'elicitation reply must be {action, content, _meta}';
  } else if (method === 'currentTime/read') {
    if (!isObj(result) || typeof result.currentTimeAt !== 'number') return 'currentTime/read reply must be {currentTimeAt}';
  }
  return null;
}

// ---- turns ------------------------------------------------------------------------------------------
function serverRequest(method: string, params: Record<string, unknown>, turn: TurnState | null): Promise<unknown> {
  const id = ++serial + 1000;
  return new Promise(resolve => { pending.set(id, { resolve, method, turn }); write({ id, method, params }); });
}

function endTurn(turn: TurnState, status: 'completed' | 'interrupted' | 'failed', error: { message: string; codexErrorInfo: CodexErrorInfo | null; additionalDetails: null; misalignment: null } | null = null) {
  if (!turn.active) return;
  turn.active = false;
  turn.thread.turn = null;
  for (const [id, p] of pending) if (p.turn === turn) { pending.delete(id); resolvedIds.add(id); notify('serverRequest/resolved', { threadId: turn.thread.id, requestId: id }); p.resolve(undefined); }
  notify('thread/status/changed', { threadId: turn.thread.id, status: { type: 'idle' } });
  notify('turn/completed', { threadId: turn.thread.id, turn: { id: turn.id, items: [], itemsView: 'notLoaded', status, error, startedAt: Math.floor(turn.started / 1000), completedAt: Math.floor(Date.now() / 1000), durationMs: Date.now() - turn.started } });
}

function api(turn: TurnState, text: string): TurnApi {
  const live = () => turn.active;
  const ids = { threadId: turn.thread.id, turnId: turn.id };
  return {
    threadId: turn.thread.id, turnId: turn.id, text,
    get images() { return turn.images; },
    forkedFrom: turn.thread.forkedFrom,
    get steers() { return turn.steers; },
    get interrupted() { return turn.interrupted; },
    async say(message, chunks = 3) {
      if (!live()) return;
      const itemId = randomUUID();
      notify('item/started', { item: { type: 'agentMessage', id: itemId, text: '', phase: null, memoryCitation: null, delivery: null, questions: null }, ...ids, startedAtMs: Date.now() });
      const size = Math.max(1, Math.ceil(message.length / chunks));
      for (let i = 0; i < message.length && live(); i += size) { notify('item/agentMessage/delta', { ...ids, itemId, delta: message.slice(i, i + size) }); await new Promise(r => setTimeout(r, 5)); }
      if (live()) notify('item/completed', { item: { type: 'agentMessage', id: itemId, text: message, phase: null, memoryCitation: null, delivery: null, questions: null }, ...ids, completedAtMs: Date.now() });
    },
    async think() {
      if (!live()) return;
      const itemId = randomUUID();
      notify('item/started', { item: { type: 'reasoning', id: itemId, summary: [], content: [] }, ...ids, startedAtMs: Date.now() });
      await new Promise(r => setTimeout(r, 10));
      if (live()) notify('item/completed', { item: { type: 'reasoning', id: itemId, summary: ['Thinking'], content: [] }, ...ids, completedAtMs: Date.now() });
    },
    async call(tool, args) {
      if (!live()) return { success: false, text: 'turn is over', images: 0 };
      const itemId = `call_${randomUUID().slice(0, 8)}`;
      const started = Date.now();
      notify('item/started', { item: { type: 'dynamicToolCall', id: itemId, namespace: null, tool, arguments: args, status: 'inProgress', contentItems: null, success: null, durationMs: null }, ...ids, startedAtMs: started });
      const reply = await serverRequest('item/tool/call', { ...ids, callId: itemId, namespace: null, tool, arguments: args }, turn) as { contentItems?: Array<{ type: string; text?: string }>; success?: boolean } | undefined;
      if (!reply) return { success: false, text: 'resolved without a reply', images: 0 };
      if (live()) notify('item/completed', { item: { type: 'dynamicToolCall', id: itemId, namespace: null, tool, arguments: args, status: reply.success ? 'completed' : 'failed', contentItems: reply.contentItems, success: reply.success, durationMs: Date.now() - started }, ...ids, completedAtMs: Date.now() });
      return { success: !!reply.success, text: (reply.contentItems ?? []).filter(c => c.type === 'inputText').map(c => c.text).join('\n'), images: (reply.contentItems ?? []).filter(c => c.type === 'inputImage').length };
    },
    request: (method, params) => live() ? serverRequest(method, { ...ids, ...params }, turn) : Promise.resolve(undefined),
    notify: (method, params) => notify(method, params),
    error(info, message, willRetry) { if (live()) notify('error', { error: { message, codexErrorInfo: info, additionalDetails: null, misalignment: null }, willRetry, ...ids }); },
    usage(input, output, cached = 0, reasoning = 0) {
      const u = turn.thread.usage;
      u.input += input; u.output += output; u.cached += cached; u.reasoning += reasoning;
      const breakdown = (i: number, o: number, c: number, r: number) => ({ totalTokens: i + o, inputTokens: i, cachedInputTokens: c, cacheWriteInputTokens: 0, outputTokens: o, reasoningOutputTokens: r });
      notify('thread/tokenUsage/updated', { threadId: turn.thread.id, turnId: turn.id, tokenUsage: { total: breakdown(u.input, u.output, u.cached, u.reasoning), last: breakdown(input, output, cached, reasoning), modelContextWindow: 272000 } });
    },
    rateLimits(usedPercent, resetsAt) { notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', limitName: null, normalModelSlug: null, primary: { usedPercent, windowDurationMins: 300, resetsAt: resetsAt ?? Math.floor(Date.now() / 1000) + 3600 }, secondary: null, credits: null, individualLimit: null, spendControlReached: null, planType: 'plus', rateLimitReachedType: null } }); },
    waitForSteer(ms) {
      // Steers are read in order; one that arrived before the wait is returned at once.
      if (turn.steers.length > turn.steersRead) return Promise.resolve(turn.steers[turn.steersRead++]!);
      return new Promise(resolve => {
        const timer = setTimeout(() => { turn.steerWaiters = turn.steerWaiters.filter(w => w !== got); resolve(null); }, ms);
        const got = (t: string) => { clearTimeout(timer); turn.steersRead++; resolve(t); };
        turn.steerWaiters.push(got);
      });
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    raw: line => process.stdout.write(line),
    crash(code = 1) { process.stderr.write('fake-codex: crashing mid-turn\n'); process.exit(code); },
  };
}

async function runTurn(turn: TurnState, text: string) {
  const scenario = scenarios.find(s => typeof s.match === 'function' ? s.match(text) : s.match.test(text));
  log({ turn: turn.id, scenario: scenario?.name ?? '(default)', text });
  try {
    const result = scenario ? await scenario.run(api(turn, text)) : await api(turn, text).say('OK.');
    if (!turn.active) return;
    if (result && typeof result === 'object' && result.status === 'failed') {
      notify('error', { error: { message: result.message, codexErrorInfo: result.info, additionalDetails: null, misalignment: null }, willRetry: false, threadId: turn.thread.id, turnId: turn.id });
      endTurn(turn, 'failed', { message: result.message, codexErrorInfo: result.info, additionalDetails: null, misalignment: null });
    } else endTurn(turn, 'completed');
  } catch (error) {
    log({ scenarioError: String(error) });
    endTurn(turn, 'failed', { message: `fake scenario threw: ${String(error)}`, codexErrorInfo: 'other', additionalDetails: null, misalignment: null });
  }
}

// ---- requests from den-kit --------------------------------------------------------------------------
async function handle(message: Record<string, unknown>) {
  log({ in: message });
  const { id, method } = message;
  if (typeof method !== 'string') {
    // A reply to one of our requests.
    const p = pending.get(id as number);
    if (!p) { if (resolvedIds.has(id as number)) log({ lateReply: id }); else violation('reply to an unknown request id', message); return; }
    pending.delete(id as number);
    if ('error' in message) { if (!['item/tool/call'].includes(p.method)) log({ replyError: p.method, error: message.error }); else violation('tool call answered with a JSON-RPC error', message); p.resolve(undefined); return; }
    const problem = checkReply(p.method, message.result);
    if (problem) violation(problem, message.result);
    p.resolve(message.result);
    return;
  }
  if (id === undefined) {
    if (method === 'initialized') { if (!initialized) violation('initialized sent before initialize'); sawInitialized = true; }
    return; // unknown notifications are ignored, like the real server
  }
  if (typeof id !== 'number' && typeof id !== 'string') { violation('request id must be a number or string', message); return; }
  const params = (isObj(message.params) ? message.params : {}) as Record<string, unknown>;
  if (method === 'initialize') {
    const ci = params.clientInfo as Record<string, unknown> | undefined;
    const caps = params.capabilities as Record<string, unknown> | undefined;
    if (!isObj(ci) || typeof ci.name !== 'string' || typeof ci.version !== 'string' || !('title' in ci)) violation('initialize: clientInfo {name, title, version} required', params);
    if (!isObj(caps) || typeof caps.experimentalApi !== 'boolean' || typeof caps.requestAttestation !== 'boolean') violation('initialize: capabilities {experimentalApi, requestAttestation} required', params);
    if (env.FAKE_CODEX_FAULT === 'hang-initialize') return;
    initialized = true;
    respond(id, { userAgent: 'den-kit/0.160.1 (fake)', codexHome: home ?? '', platformFamily: 'unix', platformOs: 'macos' });
    notify('remoteControl/status/changed', { status: 'disabled', serverName: 'fake', installationId: randomUUID(), environmentId: null });
    if (env.FAKE_CODEX_FAULT === 'exit-after-init') setTimeout(() => process.exit(4), 50);
    return;
  }
  if (!initialized || !sawInitialized) { refuse(id, 'Not initialized'); return; }
  switch (method) {
    case 'account/read': respond(id, signedIn() ? { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' }, requiresOpenaiAuth: true, workspaceRouting: null } : { account: null, requiresOpenaiAuth: true, workspaceRouting: null }); return;
    case 'account/login/start': {
      if (params.type !== 'chatgpt') { violation('den-kit must sign in with ChatGPT, not an API key', params); refuse(id, 'unsupported login'); return; }
      const loginId = randomUUID();
      login = { id: loginId };
      respond(id, { type: 'chatgpt', loginId, authUrl: `https://auth.openai.com/oauth/authorize?state=${loginId}` });
      if (env.FAKE_CODEX_LOGIN === 'success') login.timer = setTimeout(() => {
        if (login?.id !== loginId) return;
        writeFileSync(join(home!, 'auth.json'), '{"fake":true}');
        notify('account/login/completed', { loginId, success: true, error: null });
        notify('account/updated', { authMode: 'chatgpt', planType: 'plus' });
        login = null;
      }, 80);
      return;
    }
    case 'account/login/cancel': {
      if (login && login.id === params.loginId) { if (login.timer) clearTimeout(login.timer); login = null; }
      respond(id, { status: 'canceled' });
      notify('account/login/completed', { loginId: params.loginId, success: false, error: 'Canceled' });
      return;
    }
    case 'account/logout':
      rmSync(join(home!, 'auth.json'), { force: true });
      respond(id, {}); notify('account/updated', { authMode: null, planType: null }); return;
    case 'model/list': respond(id, { data: MODELS, nextCursor: null }); return;
    case 'account/rateLimits/read':
      if (!signedIn()) { refuse(id, 'codex account authentication required to read rate limits'); return; }
      respond(id, { ordinaryUsageAllowed: true, rateLimits: { limitId: 'codex', limitName: null, normalModelSlug: null, primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 }, secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: null }, credits: null, individualLimit: null, spendControlReached: null, planType: 'plus', rateLimitReachedType: null }, rateLimitsByLimitId: null, rateLimitResetCredits: null, accountId: null, rateLimitUpsell: null });
      return;
    case 'thread/start': {
      const problem = checkThreadStart(params);
      if (problem) { violation(problem, params); refuse(id, problem); return; }
      const thread: ThreadState = { id: randomUUID(), turn: null, tools: new Set(((params.dynamicTools as Array<{ name: string }> | undefined) ?? []).map(t => t.name)), unsubscribed: false, forkedFrom: null, usage: { input: 0, cached: 0, output: 0, reasoning: 0 } };
      threads.set(thread.id, thread);
      const t = { id: thread.id, environments: params.environments ?? null, extra: null, sessionId: thread.id, forkedFromId: null, parentThreadId: null, preview: '', ephemeral: !!params.ephemeral, model: params.model ?? 'gpt-6.1-sol', modelProvider: 'openai', status: { type: 'idle' }, cwd: params.cwd ?? '/', cliVersion: '0.160.1', turns: [] };
      respond(id, { thread: t, model: t.model, modelProvider: 'openai', serviceTier: null, disabledPluginIds: [], cwd: t.cwd, runtimeWorkspaceRoots: [], instructionSources: env.FAKE_CODEX_INSTRUCTION_SOURCES ? env.FAKE_CODEX_INSTRUCTION_SOURCES.split(',') : [], approvalPolicy: params.approvalPolicy ?? 'on-request', approvalsReviewer: 'user', sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite', networkAccess: false }, activePermissionProfile: null, reasoningEffort: null, multiAgentMode: 'explicitRequestOnly' });
      notify('thread/started', { thread: t });
      return;
    }
    case 'thread/fork': {
      for (const key of Object.keys(params)) if (!THREAD_FORK_KEYS.has(key)) { violation(`thread/fork: unknown field \`${key}\``); refuse(id, `unknown field \`${key}\``); return; }
      const source = threads.get(String(params.threadId));
      if (env.FAKE_CODEX_FORK === 'refuse' || !source) { refuse(id, `no rollout found for thread id ${String(params.threadId)}`); return; }
      if (params.ephemeral !== true) violation('thread/fork: den-kit forks must be ephemeral', params);
      // The copy keeps the source's tools (fork has no dynamicTools).
      const thread: ThreadState = { id: randomUUID(), turn: null, tools: new Set(source.tools), unsubscribed: false, forkedFrom: source.id, usage: { ...source.usage } };
      threads.set(thread.id, thread);
      const t = { id: thread.id, environments: null, extra: null, sessionId: thread.id, forkedFromId: source.id, parentThreadId: null, preview: '', ephemeral: true, model: params.model ?? 'gpt-6.1-sol', modelProvider: 'openai', status: { type: 'idle' }, cwd: params.cwd ?? '/', cliVersion: '0.160.1', turns: [] };
      respond(id, { thread: t, model: t.model, modelProvider: 'openai', serviceTier: null, disabledPluginIds: [], cwd: t.cwd, runtimeWorkspaceRoots: [], instructionSources: [], approvalPolicy: params.approvalPolicy ?? 'on-request', approvalsReviewer: 'user', sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite', networkAccess: false }, activePermissionProfile: null, reasoningEffort: null, multiAgentMode: 'explicitRequestOnly' });
      notify('thread/started', { thread: t });
      return;
    }
    case 'turn/start': {
      for (const key of Object.keys(params)) if (!TURN_START_KEYS.has(key)) { violation(`turn/start: unknown field \`${key}\``); refuse(id, `unknown field \`${key}\``); return; }
      const problem = checkInput(params.input, 'turn/start');
      if (problem) { violation(problem, params); refuse(id, problem); return; }
      const thread = threads.get(String(params.threadId));
      if (!thread) { refuse(id, `thread not found: ${String(params.threadId)}`); return; }
      const text = textOf(params.input);
      if (thread.turn) {
        // Like the real server: a turn/start on a busy thread steers the running turn.
        thread.turn.steers.push(text);
        thread.turn.steerWaiters.shift()?.(text);
        respond(id, { turn: { id: thread.turn.id, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } });
        return;
      }
      const turn: TurnState = { id: randomUUID(), thread, active: true, interrupted: false, steers: [], steersRead: 0, steerWaiters: [], started: Date.now(), images: imagesOf(params.input) };
      thread.turn = turn;
      respond(id, { turn: { id: turn.id, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } });
      notify('thread/status/changed', { threadId: thread.id, status: { type: 'active', activeFlags: [] } });
      notify('turn/started', { threadId: thread.id, turn: { id: turn.id, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: Math.floor(Date.now() / 1000), completedAt: null, durationMs: null } });
      const userItem = { type: 'userMessage', id: randomUUID(), clientId: null, content: params.input };
      notify('item/started', { item: userItem, threadId: thread.id, turnId: turn.id, startedAtMs: Date.now() });
      notify('item/completed', { item: userItem, threadId: thread.id, turnId: turn.id, completedAtMs: Date.now() });
      void runTurn(turn, text);
      return;
    }
    case 'turn/steer': {
      const problem = checkInput(params.input, 'turn/steer');
      if (problem) { violation(problem, params); refuse(id, problem); return; }
      if (typeof params.expectedTurnId !== 'string') { violation('turn/steer: expectedTurnId is required', params); refuse(id, 'missing field `expectedTurnId`'); return; }
      const turn = threads.get(String(params.threadId))?.turn;
      if (!turn?.active) { refuse(id, 'no active turn to steer'); return; }
      if (turn.id !== params.expectedTurnId) { refuse(id, `expected active turn id \`${params.expectedTurnId}\` but found \`${turn.id}\``); return; }
      const text = textOf(params.input);
      turn.images.push(...imagesOf(params.input));
      turn.steers.push(text);
      turn.steerWaiters.shift()?.(text);
      respond(id, { turnId: turn.id });
      return;
    }
    case 'turn/interrupt': {
      const turn = threads.get(String(params.threadId))?.turn;
      if (!turn?.active || turn.id !== params.turnId) { setTimeout(() => respond(id, {}), lateInterruptMs); log({ lateInterrupt: params.turnId }); return; }
      turn.interrupted = true;
      respond(id, {});
      endTurn(turn, 'interrupted');
      return;
    }
    case 'thread/unsubscribe': {
      const thread = threads.get(String(params.threadId));
      if (!/^[0-9a-f-]{36}$/i.test(String(params.threadId))) { refuse(id, `invalid thread id: ${String(params.threadId)}`); return; }
      if (thread) thread.unsubscribed = true;
      respond(id, { status: thread ? 'unsubscribed' : 'notSubscribed' });
      return;
    }
    default: refuse(id, `Invalid request: unknown variant \`${method}\``);
  }
}

let buffer = '';
const ready = startupMs > 0 ? new Promise(r => setTimeout(r, startupMs)) : Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    let message: unknown;
    try { message = JSON.parse(line); } catch { violation('den-kit sent a line that is not JSON', line.slice(0, 200)); continue; }
    if (!isObj(message)) { violation('den-kit sent a message that is not an object', message); continue; }
    if ('jsonrpc' in message) violation('the app-server protocol omits "jsonrpc"', message);
    void ready.then(() => handle(message as Record<string, unknown>));
  }
});
process.stdin.on('end', () => { log({ event: 'stdin closed' }); setTimeout(() => process.exit(0), 20); });
process.on('SIGTERM', () => { log({ event: 'SIGTERM' }); process.exit(0); });

// The bridge's Codex app-server client. One app-server process for the whole
// bridge; one ephemeral thread per conversation; one turn per LLM request.
//
// Lifecycle: start → initialize → account/read → model/list → ok. Not signed in
// → `login` (the client watches CODEX_HOME/auth.json and restarts when it
// appears). The process exiting → every running request fails with a clear
// message and the process restarts with backoff.
//
// Every server request is answered (an unanswered one stalls the turn): kit_*
// tool calls go to the browser that owns the turn (with a deadline), requests
// for powers den-kit never grants are declined, anything unknown gets an error.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { CodexStatus, LlmError, LlmEvent, LlmQuestion, LlmRole, TokenUsage, ToolOutput } from '../../src/ai/protocol.ts';
import { toolDeadlineMs, toolsFor, type ToolSpec } from '../../src/ai/llm-spec.ts';
import type { Telemetry } from '../telemetry.ts';
import { RpcClosed, RpcError, RpcPeer, RpcTimeout } from './rpc.ts';
import { codexHome, codexWorkdir, isProblem, LOGIN_COMMAND, resolveCodex, spawnAppServer, type AppServerProcess, type CodexCommand } from './process.ts';
import {
  CODEX_VERSION, DECLINE, EXPECTED_ITEMS, RPC_METHOD_NOT_FOUND, explainCodexError,
  type AgentMessageDeltaNotification, type DynamicToolCallParams, type DynamicToolCallResponse, type ErrorNotification, type GetAccountRateLimitsResponse,
  type GetAccountResponse, type InitializeResponse, type ItemNotification, type Model, type ModelListResponse, type RateLimitSnapshot, type RequestId,
  type RpcNotification, type RpcRequest, type ServerRequestResolvedNotification, type ThreadStartParams, type ThreadStartResponse, type ToolRequestUserInputParams,
  type ThreadForkParams, type ThreadTokenUsageUpdatedNotification, type TokenUsageBreakdown,
  type TurnError, type TurnNotification, type TurnStartResponse, type UserInput,
} from './protocol.ts';

/** Where one request's progress goes (the bridge forwards it to the browser tab that asked). */
export interface TurnSink {
  event(event: LlmEvent): void;
  toolCall(call: { callId: string; tool: string; args: unknown }): void;
}

export interface CodexClientOptions {
  kitRoot: string;
  env?: NodeJS.ProcessEnv;
  /** The binary to run (tests: the fake app-server); default: resolveCodex(). */
  command?: CodexCommand;
  home?: { path: string; isolated: boolean };
  workdir?: string;
  /** KIT_CODEX_MODEL; default: the model Codex marks as default. */
  model?: string;
  /** KIT_CODEX_EFFORT (low, medium, high, …); default: the model's own. */
  effort?: string;
  /** Tools registered on every thread instead of each role's own (doctor --deep uses a ping tool). */
  tools?: ToolSpec[];
  /** KIT_CODEX_FORK=1: a member asked for the lead's whole conversation starts from a copy of it (thread/fork); otherwise from den-kit's account of it. */
  fork?: boolean;
  telemetry?: Telemetry;
  log?: (line: string) => void;
  /** Every JSON-RPC line in and out (doctor --deep records the real conversation). */
  trace?: (direction: 'in' | 'out', line: string) => void;
  timeouts?: Partial<Timeouts>;
  restart?: Partial<{ baseMs: number; maxMs: number; maxFailures: number }>;
  authPollMs?: number;
  /** Maximum time to complete browser sign-in, including account confirmation. */
  loginTimeoutMs?: number;
  /** Desktop UI supplies its own sign-in instructions instead of a terminal command. */
  loginInstruction?: string;
  /** Turns running at once across the bridge (a lead and its members count each). */
  maxTurns?: number;
}
interface Timeouts {
  /** A continuous run of connection failures must end, even if Codex retries forever. */
  retryMs: number;
  /** No model progress, excluding time spent waiting for a tool or user answer. */
  idleMs: number;
  /** First start creates CODEX_HOME state and can take several seconds. */
  initializeMs: number;
  requestMs: number;
  /** The browser answers tool calls (compile ≤ 20 s, render ≤ 45 s). */
  toolMs: number;
  interruptMs: number;
  /** After a stop, how long to wait for Codex to confirm before ending the request here. */
  settleMs: number;
}

interface ThreadState { id: string; turn: TurnState | null; generation: number; /** The kit_* tools this conversation has. */ tools: Set<string> }
interface TurnState {
  retryTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  key: string;
  sink: TurnSink;
  thread: ThreadState | null;
  turnId: string | null;
  started: number;
  stopRequested: boolean;
  interruptSent: boolean;
  stopReason?: string;
  steers: Array<{ key: string; text: string; images?: string[]; sink: TurnSink }>;
  calls: Map<string, { rpcId: RequestId; timer: ReturnType<typeof setTimeout>; tool: string; args: unknown }>;
  questions: Set<string>;
  error: TurnError | null;
  tools: number;
  done: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
}
interface Question { key: string; rpcId: RequestId; turn: TurnState; timer: ReturnType<typeof setTimeout> | null }

/** Features that would give the model powers den-kit does not want (checked against the real 0.160.1 server). */
export const THREAD_CONFIG = {
  web_search: 'disabled',
  features: Object.fromEntries(['apps', 'browser_use', 'computer_use', 'goals', 'hooks', 'image_generation', 'in_app_browser', 'memories', 'multi_agent', 'plugins', 'remote_plugin', 'shell_tool', 'skill_search', 'sleep_tool', 'tool_suggest', 'unified_exec', 'view_image'].map(k => [k, false])),
};

/** The thread den-kit asks for: ephemeral, no environment (no shell, no files), read-only, never asks for approval, only kit_* tools. */
export function threadStartParams(options: { model?: string | null; cwd: string; instructions: string; tools: ToolSpec[] }): ThreadStartParams {
  return {
    ...(options.model ? { model: options.model } : {}),
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    environments: [],
    config: THREAD_CONFIG,
    developerInstructions: options.instructions,
    dynamicTools: options.tools.map(t => ({ type: 'function', name: t.name, description: t.description, inputSchema: t.inputSchema })),
  };
}

export const text = (value: string): UserInput => ({ type: 'text', text: value, text_elements: [] });
/** A request's input: its text, then its pictures (data: URLs). */
export const userInput = (value: string, images?: readonly string[]): UserInput[] => [text(value), ...(images ?? []).map((url): UserInput => ({ type: 'image', url }))];
/** Turns running at once across the bridge: a lead and up to three members, or a few separate requests. */
export const MAX_TURNS = 4;

/** A member's copy of the lead's conversation: the same isolation as a new thread (no shell, no files, no approvals), the member's rules. */
export function forkParams(options: { threadId: string; model?: string | null; cwd: string; instructions: string }): ThreadForkParams {
  return {
    threadId: options.threadId,
    ...(options.model ? { model: options.model } : {}),
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    config: THREAD_CONFIG,
    developerInstructions: options.instructions,
  };
}

const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
function tokens(b: TokenUsageBreakdown): TokenUsage {
  return { input: count(b.inputTokens), cached: count(b.cachedInputTokens), output: count(b.outputTokens), reasoning: count(b.reasoningOutputTokens), total: count(b.totalTokens) };
}
const failure = (message: string): DynamicToolCallResponse => ({ contentItems: [{ type: 'inputText', text: message }], success: false });

export function describeRpcError(error: unknown): string {
  if (error instanceof RpcTimeout || error instanceof RpcClosed) return error.message;
  if (error instanceof RpcError) return `${error.method}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export class CodexClient {
  private statusValue: CodexStatus = { state: 'off', detail: 'Codex has not started.' };
  private listeners = new Set<(status: CodexStatus) => void>();
  private proc: AppServerProcess | null = null;
  private peer: RpcPeer | null = null;
  private generation = 0;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private booting: Promise<void> | null = null;
  private restarting: Promise<void> | null = null;
  private modelId: string | null = null;
  private threads = new Map<string, ThreadState>();
  private turns = new Map<string, TurnState>();
  private calls = new Map<string, TurnState>();
  private questions = new Map<string, Question>();
  private serial = 0;
  readonly home: { path: string; isolated: boolean };
  readonly workdir: string;
  /** Tools that replace each role's own (doctor --deep). */
  private readonly toolOverride: ToolSpec[] | null;
  private readonly options: CodexClientOptions;
  private readonly timeouts: Timeouts;
  private readonly restartPolicy: { baseMs: number; maxMs: number; maxFailures: number };
  readonly stats = { boots: 0, exits: 0, turns: 0, toolCalls: 0, declined: 0, unexpectedItems: 0, malformed: 0 };
  private modelCatalog: Model[] = [];
  private loginId: string | null = null;
  private signInState: 'idle' | 'starting' | 'waiting' | 'checking' | 'complete' | 'error' = 'idle';
  private signInError: string | undefined;
  private chatGPTAccount = false;
  private authAttempt = 0;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private loginPoll: ReturnType<typeof setInterval> | null = null;
  private earlyLogin: { loginId: string; success: boolean; error?: string } | null = null;
  private accountRefreshing: { peer: RpcPeer; attempt: number; again: boolean; promise: Promise<void> } | null = null;

  constructor(options: CodexClientOptions) {
    this.options = options;
    const env = options.env ?? process.env;
    this.home = options.home ?? codexHome(options.kitRoot, env);
    this.workdir = options.workdir ?? codexWorkdir(options.kitRoot);
    this.toolOverride = options.tools ?? null;
    this.timeouts = { retryMs: 30000, idleMs: 180000, initializeMs: 30000, requestMs: 20000, toolMs: 90000, interruptMs: 8000, settleMs: 10000, ...options.timeouts };
    this.restartPolicy = { baseMs: 1000, maxMs: 30000, maxFailures: 5, ...options.restart };
  }

  get status(): CodexStatus { return { ...this.statusValue }; }
  get chatGPTSignedIn() { return this.chatGPTAccount; }
  get ready() { return this.statusValue.state === 'ok' && !!this.peer; }
  get busy() { return this.turns.size > 0; }
  get models(): Model[] { return this.modelCatalog.map(m => ({ ...m })); }
  get login() { return { state: this.signInState, error: this.signInError }; }
  private get signingIn() { return this.signInState === 'starting' || this.signInState === 'waiting' || this.signInState === 'checking'; }

  /** Existing Codex sign-in, hosted by the bundled app-server. Tokens never enter the renderer. */
  async signIn(): Promise<string> {
    if (this.busy) throw new Error('Finish the current AI request before signing in.');
    await this.start();
    if (!this.peer) throw new Error('Codex is not available. Try reconnecting.');
    if (this.signingIn) await this.cancelSignIn();
    const peer = this.peer;
    if (!peer) throw new Error('Codex is not available. Try reconnecting.');
    const attempt = ++this.authAttempt;
    this.stopAuthWatch();
    this.signInState = 'starting'; this.signInError = undefined; this.earlyLogin = null;
    this.loginTimer = setTimeout(() => {
      if (this.authAttempt !== attempt) return;
      const id = this.loginId;
      this.finishSignIn('error', 'ChatGPT sign-in timed out. Try signing in again.');
      if (id && this.peer === peer) void peer.request('account/login/cancel', { loginId: id }, { timeoutMs: this.timeouts.requestMs }).catch(() => undefined);
    }, this.options.loginTimeoutMs ?? 5 * 60_000);
    this.loginTimer.unref?.();
    try {
      const response = await peer.request<{ type: string; loginId: string; authUrl: string }>('account/login/start', { type: 'chatgpt' }, { timeoutMs: this.timeouts.requestMs });
      if (this.authAttempt !== attempt || this.peer !== peer) {
        if (response.loginId) void peer.request('account/login/cancel', { loginId: response.loginId }, { timeoutMs: this.timeouts.requestMs }).catch(() => undefined);
        throw new Error('ChatGPT sign-in was canceled or interrupted. Try again.');
      }
      if (response.type !== 'chatgpt' || typeof response.loginId !== 'string' || typeof response.authUrl !== 'string') throw new Error('Codex returned an unsupported sign-in response.');
      this.loginId = response.loginId;
      this.signInState = 'waiting';
      this.loginPoll = setInterval(() => { void this.refreshAccount(); }, this.options.authPollMs ?? 2000);
      this.loginPoll.unref?.();
      const early = this.earlyLogin as { loginId: string; success: boolean; error?: string } | null;
      this.earlyLogin = null;
      if (early) this.loginCompleted(early);
      return response.authUrl;
    } catch (error) {
      if (this.authAttempt === attempt) this.finishSignIn('error', `ChatGPT sign-in could not start: ${describeRpcError(error)}`);
      throw error;
    }
  }
  async cancelSignIn() {
    const id = this.loginId, peer = this.peer;
    this.finishSignIn('idle');
    if (id && peer) await peer.request('account/login/cancel', { loginId: id }, { timeoutMs: this.timeouts.requestMs });
  }
  async signOut() {
    if (this.busy) throw new Error('Finish the current AI request before signing out.');
    await this.cancelSignIn();
    if (!this.peer) throw new Error('Codex is not available. Try reconnecting.');
    await this.peer.request('account/logout', undefined, { timeoutMs: this.timeouts.requestMs });
    await this.retry();
  }
  async configure(settings: { model: string; effort: string; fork: boolean }) {
    if (this.busy) throw new Error('Finish the current AI request before changing settings.');
    if (this.signingIn) throw new Error('Complete or cancel ChatGPT sign-in before changing settings.');
    this.options.model = settings.model || undefined;
    this.options.effort = settings.effort || undefined;
    this.options.fork = settings.fork;
    await this.retry();
  }
  onStatus(listener: (status: CodexStatus) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Start (or keep) the app-server; resolves when the state settles (ok, login or error). */
  start(): Promise<void> {
    this.stopped = false;
    if (this.restarting) return this.restarting;
    return this.launch();
  }

  private launch(): Promise<void> {
    if (this.peer || this.restartTimer) return this.booting ?? Promise.resolve();
    const task = this.boot().finally(() => { if (this.booting === task) this.booting = null; });
    this.booting = task;
    return task;
  }

  /** Restart now (after signing in, after an error); requests in flight fail. */
  retry(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.stopped = false;
    const task = (async () => {
      this.failures = 0;
      if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
      await this.shutdown('Codex is restarting.');
      if (!this.stopped) await this.launch();
    })().finally(() => { if (this.restarting === task) this.restarting = null; });
    this.restarting = task;
    return task;
  }

  async stop() {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    await this.shutdown('The bridge is shutting down.');
    this.setStatus({ state: 'off', detail: 'Codex is stopped.' });
  }

  // ---- lifecycle -------------------------------------------------------------------------
  private setStatus(next: CodexStatus) {
    this.statusValue = next;
    for (const l of this.listeners) l(this.status);
  }

  private log(line: string) { this.options.log?.(line); }
  private record(event: string, data: Record<string, unknown> = {}) { this.options.telemetry?.write('codex', { event, ...data }); }

  private finishSignIn(state: 'idle' | 'complete' | 'error', error?: string) {
    ++this.authAttempt;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    if (this.loginPoll) clearInterval(this.loginPoll);
    this.loginTimer = null; this.loginPoll = null; this.loginId = null; this.earlyLogin = null;
    this.signInState = state; this.signInError = error;
    if (this.statusValue.state === 'login' && !this.stopped && this.peer) this.watchAuth();
  }

  private loginCompleted(result: { loginId: string; success: boolean; error?: string }) {
    if (this.signInState === 'starting') { this.earlyLogin = result; return; }
    if (!this.loginId || this.loginId !== result.loginId) return;
    if (!result.success) { this.finishSignIn('error', result.error ?? 'ChatGPT sign-in did not complete. Try again.'); return; }
    this.signInState = 'checking';
    void this.refreshAccount();
  }

  private refreshAccount(): Promise<void> {
    const peer = this.peer;
    const attempt = this.authAttempt;
    if (!peer || this.signInState === 'starting') return Promise.resolve();
    if (this.accountRefreshing?.peer === peer && this.accountRefreshing.attempt === attempt) {
      this.accountRefreshing.again = true;
      return this.accountRefreshing.promise;
    }
    const refresh = { peer, attempt, again: false, promise: Promise.resolve() };
    const current = () => this.peer === peer && this.authAttempt === attempt;
    this.accountRefreshing = refresh;
    refresh.promise = (async () => {
      do {
        refresh.again = false;
        const account = await peer.request<GetAccountResponse>('account/read', { refreshToken: false }, { timeoutMs: this.timeouts.requestMs });
        if (!current()) return;
        const chatGPT = account.account?.type === 'chatgpt';
        let model = { label: this.statusValue.model, images: this.statusValue.images };
        if (chatGPT && (!this.chatGPTAccount || this.signingIn)) {
          const models = await peer.request<ModelListResponse>('model/list', { limit: 100 }, { timeoutMs: this.timeouts.requestMs });
          if (!current()) return;
          this.modelCatalog = models.data.filter(m => !m.hidden);
          model = this.chooseModel(models.data);
        }
        this.chatGPTAccount = chatGPT;
        if (!account.account && account.requiresOpenaiAuth !== false) {
          this.setStatus({ state: 'login', model: model.label, images: model.images, detail: 'Codex is not signed in.', fix: this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\`.` });
          if (!this.signingIn) this.watchAuth();
        } else {
          this.stopAuthWatch();
          const plan = account.account?.type === 'chatgpt' ? account.account.planType : undefined;
          this.setStatus({ state: 'ok', model: model.label, images: model.images, ...(plan ? { plan } : {}), rateLimit: null });
          if (chatGPT && this.signingIn) {
            this.finishSignIn('complete');
            // An account change received while this read was in flight still needs a fresh read.
            if (refresh.again) void this.refreshAccount();
          }
          void peer.request<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined, { timeoutMs: this.timeouts.requestMs }).then(r => { if (this.peer === peer) this.updateRateLimit(r.rateLimits); }).catch(() => undefined);
        }
        if (account.account && !chatGPT && this.signInState === 'checking') this.finishSignIn('error', 'ChatGPT sign-in could not be confirmed. Try signing in again.');
      } while (refresh.again && current());
    })().catch(error => {
      if (!current()) return;
      this.log(`codex: account refresh failed: ${describeRpcError(error)}`);
      // Before OAuth completes, a failed poll says nothing about the browser
      // login. Keep its ID and deadline so it can complete or be canceled.
      if (this.signInState === 'waiting') return;
      if (this.signingIn) {
        const id = this.loginId;
        if (id) void peer.request('account/login/cancel', { loginId: id }, { timeoutMs: this.timeouts.requestMs }).catch(() => undefined);
        this.finishSignIn('error', 'ChatGPT sign-in could not be confirmed. Reconnect and try again.');
        this.setStatus({ state: 'error', detail: 'ChatGPT sign-in could not be confirmed.', fix: this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\`.` });
      }
    }).finally(() => { if (this.accountRefreshing === refresh) this.accountRefreshing = null; });
    return refresh.promise;
  }

  private async boot() {
    if (this.stopped) return;
    this.chatGPTAccount = false;
    this.setStatus({ state: 'starting', detail: 'Starting Codex…' });
    const command = this.options.command ?? resolveCodex(this.options.kitRoot, this.options.env);
    if (isProblem(command)) { this.setStatus({ state: 'error', detail: command.error, fix: command.fix }); return; }
    if (command.source === 'kit' && command.version !== CODEX_VERSION) {
      this.setStatus({ state: 'error', detail: `Codex ${command.version} is installed; den-kit is pinned to ${CODEX_VERSION}.`, fix: 'Run `npm ci` from the repo root.' });
      return;
    }
    const started = Date.now();
    let proc: AppServerProcess;
    try { proc = spawnAppServer(command, { home: this.home.path, cwd: this.workdir, env: this.options.env }); }
    catch (error) { this.setStatus({ state: 'error', detail: `Could not start Codex: ${error instanceof Error ? error.message : String(error)}` }); return; }
    const generation = ++this.generation;
    this.stats.boots++;
    this.proc = proc;
    const peer = new RpcPeer(proc.child.stdout, proc.child.stdin, {
      onRequest: request => this.onRequest(peer, request),
      onNotification: notification => { if (this.peer === peer) this.onNotification(notification); },
      onMalformed: (line, reason) => { this.stats.malformed++; this.log(`codex: ignored a ${reason} line: ${line.slice(0, 120)}`); this.record('malformed', { reason, line: line.slice(0, 200) }); },
    }, { trace: this.options.trace });
    this.peer = peer;
    void proc.exited.then(exit => this.onExit(proc, peer, exit));
    try {
      const init = await peer.request<InitializeResponse>('initialize', { clientInfo: { name: 'den-kit', title: 'den-kit', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: this.timeouts.initializeMs });
      peer.notify('initialized');
      const account = await peer.request<GetAccountResponse>('account/read', { refreshToken: false }, { timeoutMs: this.timeouts.requestMs });
      const models = await peer.request<ModelListResponse>('model/list', { limit: 100 }, { timeoutMs: this.timeouts.requestMs }).catch(error => { this.log(`codex: model/list failed: ${describeRpcError(error)}`); return null; });
      if (this.proc !== proc) return;
      this.chatGPTAccount = account.account?.type === 'chatgpt';
      if (this.chatGPTAccount && this.signInState === 'error') this.finishSignIn('complete');
      const model = this.chooseModel(models?.data ?? []);
      this.modelCatalog = (models?.data ?? []).filter(m => !m.hidden);
      const base = { model: model.label, images: model.images };
      this.record('boot', { generation, ms: Date.now() - started, userAgent: init.userAgent, home: this.home.isolated ? '.codex-home' : 'custom', account: account.account?.type ?? null, model: model.label });
      if (!account.account && account.requiresOpenaiAuth !== false) {
        this.setStatus({ state: 'login', detail: 'Codex is not signed in.', fix: this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\` once in another terminal (it opens ChatGPT sign-in); den-kit picks it up by itself.`, ...base });
        this.watchAuth();
        return;
      }
      this.failures = 0;
      const plan = account.account?.type === 'chatgpt' ? account.account.planType : undefined;
      this.setStatus({ state: 'ok', ...(plan ? { plan } : {}), ...base, rateLimit: null });
      void peer.request<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined, { timeoutMs: this.timeouts.requestMs })
        .then(r => { if (this.peer === peer) this.updateRateLimit(r.rateLimits); }).catch(() => { /* optional */ });
    } catch (error) {
      if (this.proc !== proc) return;
      const message = describeRpcError(error);
      this.log(`codex: start failed: ${message}`);
      this.record('boot-failed', { generation, message, stderr: proc.stderrTail() });
      // A process that exited is restarted by onExit; one that hangs is stopped and restarted here.
      if (!(error instanceof RpcClosed)) {
        this.proc = null; this.peer = null;
        peer.close(message);
        void proc.stop(500);
        this.failed(`Codex did not start: ${message}`, proc.stderrTail());
      }
    }
  }

  private chooseModel(list: Model[]): { label: string; images: boolean } {
    const wanted = this.options.model?.trim();
    const found = wanted ? list.find(m => m.id === wanted || m.model === wanted) : list.find(m => m.isDefault) ?? list.find(m => !m.hidden);
    this.modelId = wanted || null; // without an override Codex uses its own default
    if (wanted && !found) this.log(`codex: KIT_CODEX_MODEL=${wanted} is not in model/list; using it anyway`);
    return { label: found?.displayName ?? wanted ?? 'default model', images: !!found?.inputModalities.includes('image') };
  }

  private updateRateLimit(snapshot: RateLimitSnapshot | null | undefined) {
    if (!snapshot) return;
    const windows = [snapshot.primary, snapshot.secondary].filter((w): w is NonNullable<typeof w> => !!w && typeof w.usedPercent === 'number');
    if (!windows.length) return;
    const busiest = windows.reduce((a, b) => b.usedPercent > a.usedPercent ? b : a);
    const next = { usedPercent: Math.round(busiest.usedPercent), resetsAt: busiest.resetsAt ?? null };
    const cur = this.statusValue.rateLimit;
    if (cur && cur.usedPercent === next.usedPercent && cur.resetsAt === next.resetsAt) return;
    this.setStatus({ ...this.statusValue, rateLimit: next, plan: snapshot.planType ?? this.statusValue.plan });
  }

  /** Signed out: restart Codex as soon as a login lands in CODEX_HOME. */
  private watchAuth() {
    if (this.authTimer) return;
    const file = join(this.home.path, 'auth.json');
    const stamp = () => { try { const s = statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return ''; } };
    const before = stamp();
    this.authTimer = setInterval(() => {
      if (this.statusValue.state !== 'login') { this.stopAuthWatch(); return; }
      if (stamp() !== before && !this.signingIn) { this.stopAuthWatch(); this.log('codex: external login detected, restarting'); void this.retry(); }
    }, this.options.authPollMs ?? 2000);
    this.authTimer.unref?.();
  }
  private stopAuthWatch() { if (this.authTimer) { clearInterval(this.authTimer); this.authTimer = null; } }

  private onExit(proc: AppServerProcess, peer: RpcPeer, exit: { code: number | null; signal: NodeJS.Signals | null }) {
    peer.close(`Codex exited (code ${exit.code ?? exit.signal ?? '?'}).`);
    if (this.proc !== proc) return; // replaced or stopped on purpose
    this.stats.exits++;
    this.proc = null; this.peer = null;
    this.chatGPTAccount = false;
    if (this.signingIn) this.finishSignIn('error', 'ChatGPT sign-in was interrupted. Try signing in again.');
    else ++this.authAttempt;
    this.stopAuthWatch();
    const why = `Codex stopped unexpectedly (exit ${exit.code ?? exit.signal ?? '?'}).`;
    this.log(`codex: ${why} ${proc.stderrTail().split('\n').pop() ?? ''}`);
    this.record('exit', { code: exit.code, signal: exit.signal, stderr: proc.stderrTail() });
    this.failAll({ message: `${why} It restarts by itself; send the request again.`, code: 'crashed' });
    this.failed(why, proc.stderrTail());
  }

  private failed(detail: string, stderr: string) {
    if (this.stopped) return;
    this.failures++;
    const last = stderr.split('\n').filter(Boolean).pop();
    if (this.failures > this.restartPolicy.maxFailures) {
      this.setStatus({ state: 'error', detail: `${detail}${last ? ` (${last.slice(0, 160)})` : ''}`, fix: 'Run `npm run doctor` to see why, then click the Codex status to retry.' });
      return;
    }
    const delay = Math.min(this.restartPolicy.maxMs, this.restartPolicy.baseMs * 2 ** (this.failures - 1));
    this.setStatus({ state: 'starting', detail: `${detail} Restarting in ${Math.round(delay / 1000)} s…` });
    this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start(); }, delay);
    this.restartTimer.unref?.();
  }

  private async shutdown(reason: string) {
    this.stopAuthWatch();
    const proc = this.proc, peer = this.peer;
    this.proc = null; this.peer = null;
    this.booting = null;
    this.chatGPTAccount = false;
    if (this.signingIn) this.finishSignIn('error', 'ChatGPT sign-in was interrupted. Try signing in again.');
    else ++this.authAttempt;
    this.failAll({ message: reason, code: 'stopped' });
    peer?.close(reason);
    await proc?.stop();
  }

  /** End every running request and forget every thread (they belong to a process that is gone). */
  private failAll(error: LlmError) {
    for (const turn of [...this.turns.values()]) this.finish(turn, 'failed', error);
    for (const q of this.questions.values()) if (q.timer) clearTimeout(q.timer);
    this.questions.clear();
    this.threads.clear();
  }

  // ---- requests from the browser -----------------------------------------------------------
  private unavailable(): LlmError {
    const s = this.statusValue;
    if (s.state === 'login') return { message: 'Codex is not signed in.', code: 'login', fix: s.fix };
    if (s.state === 'starting') return { message: 'Codex is still starting; try again in a moment.', code: 'starting' };
    return { message: s.detail ?? 'Codex is not available.', code: s.state, fix: s.fix };
  }

  /**
   * Start a turn (in a new thread, or continuing `thread`). Progress and the final `done` go to `sink`.
   * `role` picks the new thread's tools; `images` come with the text; `fork` starts a member from a copy
   * of the lead's conversation (KIT_CODEX_FORK=1), or else from a new one that begins with `fallback`.
   */
  startTurn(request: { key: string; text: string; thread?: string; instructions: string; role?: LlmRole; images?: string[]; fork?: { thread: string; fallback: string } }, sink: TurnSink) {
    const started = Date.now();
    const fail = (error: LlmError) => sink.event({ kind: 'done', status: 'failed', error, ms: Date.now() - started });
    const peer = this.peer;
    if (!this.ready || !peer) return fail(this.unavailable());
    if (this.turns.has(request.key)) return fail({ message: 'This request is already running.', code: 'duplicate' });
    if (this.turns.size >= (this.options.maxTurns ?? MAX_TURNS)) return fail({ message: 'Several LLM requests are already running; wait for one to finish or stop it (Esc).', code: 'busy' });
    let thread = request.thread ? this.threads.get(request.thread) : undefined;
    if (thread?.turn) return fail({ message: 'This conversation is still working on the previous request.', code: 'busy' });
    const turn: TurnState = { key: request.key, sink, thread: null, turnId: null, started, stopRequested: false, interruptSent: false, steers: [], calls: new Map(), questions: new Set(), error: null, tools: 0, done: false, settleTimer: null, retryTimer: null, idleTimer: null };
    this.turns.set(request.key, turn);
    this.stats.turns++;
    void (async () => {
      try {
        let input = request.text;
        if (!thread) {
          const tools = this.toolOverride ?? toolsFor(request.role);
          const source = request.fork ? this.threads.get(request.fork.thread) : undefined;
          let forked: boolean | undefined;
          let r: ThreadStartResponse | null = null;
          if (request.fork) {
            forked = false;
            if (this.options.fork && source) {
              try {
                r = await peer.request<ThreadStartResponse>('thread/fork', forkParams({ threadId: source.id, model: this.modelId, cwd: this.workdir, instructions: request.instructions }), { timeoutMs: this.timeouts.requestMs });
                forked = true;
              } catch (error) {
                this.log(`codex: thread/fork failed (${describeRpcError(error)}); the member starts from den-kit's account of the conversation`);
                this.record('fork-failed', { message: describeRpcError(error) });
              }
            }
            if (!forked) input = `${request.fork.fallback}\n\n${request.text}`;
          }
          r ??= await peer.request<ThreadStartResponse>('thread/start', threadStartParams({ model: this.modelId, cwd: this.workdir, instructions: request.instructions, tools }), { timeoutMs: this.timeouts.requestMs });
          if (turn.done) { peer.request('thread/unsubscribe', { threadId: r.thread.id }, { timeoutMs: this.timeouts.requestMs }).catch(() => {}); return; }
          // A copy keeps the lead's tools (lead tools too: den-kit refuses those from a member).
          thread = { id: r.thread.id, turn: null, generation: this.generation, tools: new Set((forked && source ? [...source.tools] : tools.map(t => t.name))) };
          this.threads.set(thread.id, thread);
          if (r.instructionSources?.length) {
            this.log(`codex: instruction files were loaded: ${r.instructionSources.join(', ')}`);
            this.record('instruction-sources', { sources: r.instructionSources });
            sink.event({ kind: 'activity', what: 'warning', detail: `Codex also loaded ${r.instructionSources.length} instruction file(s) from CODEX_HOME.` });
          }
          sink.event({ kind: 'thread', thread: thread.id, fresh: !!request.thread, ...(forked !== undefined ? { forked } : {}) });
        }
        if (turn.stopRequested) { this.finish(turn, 'interrupted'); return; }
        turn.thread = thread;
        thread.turn = turn;
        this.progress(turn);
        const effort = this.effort();
        const r = await peer.request<TurnStartResponse>('turn/start', { threadId: thread.id, input: userInput(input, request.images), ...(effort ? { effort } : {}) }, { timeoutMs: this.timeouts.requestMs });
        if (turn.done) return;
        turn.turnId ??= r.turn.id;
        sink.event({ kind: 'started', turn: turn.turnId });
        this.record('turn', { key: turn.key, thread: thread.id, turn: turn.turnId });
        if (turn.stopRequested) this.interrupt(turn);
        for (const steer of turn.steers.splice(0)) this.sendSteer(turn, steer);
      } catch (error) {
        if (turn.done) return;
        this.finish(turn, 'failed', { message: describeRpcError(error), code: 'request' });
      }
    })();
  }

  /** Add text (and pictures) to a running request's turn. The steer request ends with `steered`, or a failed `done` (then send it as a new request). */
  steer(request: { key: string; target: string; text: string; images?: string[] }, sink: TurnSink) {
    const turn = this.turns.get(request.target);
    if (!turn || turn.done || turn.stopRequested || !this.peer) { sink.event({ kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 }); return; }
    const steer = { key: request.key, text: request.text, images: request.images, sink };
    if (!turn.turnId) { turn.steers.push(steer); return; }
    this.sendSteer(turn, steer);
  }

  private sendSteer(turn: TurnState, steer: { key: string; text: string; images?: string[]; sink: TurnSink }) {
    const peer = this.peer;
    if (!peer || !turn.thread || !turn.turnId || turn.done) { steer.sink.event({ kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 }); return; }
    peer.request('turn/steer', { threadId: turn.thread.id, input: userInput(steer.text, steer.images), expectedTurnId: turn.turnId }, { timeoutMs: this.timeouts.requestMs })
      .then(() => steer.sink.event({ kind: 'steered', target: turn.key }))
      .catch(error => steer.sink.event({ kind: 'done', status: 'failed', error: { message: describeRpcError(error), code: 'not-steerable' }, ms: 0 }));
  }

  /** Stop a running request. Codex confirms with an interrupted turn; if it does not, the request ends here anyway. */
  stopTurn(key: string, reason?: string) {
    const turn = this.turns.get(key);
    if (!turn || turn.done || turn.stopRequested) return;
    turn.stopRequested = true;
    this.clearTurnWait(turn);
    turn.stopReason = reason;
    // Answer waiting tool calls first: stdin is ordered, so Codex sees these replies before the interrupt.
    for (const [callId, call] of turn.calls) { clearTimeout(call.timer); this.calls.delete(callId); this.peer?.respond(call.rpcId, failure('The user stopped this request.')); }
    turn.calls.clear();
    if (turn.turnId) this.interrupt(turn);
    turn.settleTimer = setTimeout(() => {
      if (turn.done) return;
      // Codex did not confirm: do not reuse the thread (a new turn/start would steer the old turn).
      if (turn.thread) this.dropThread(turn.thread);
      this.finish(turn, 'interrupted', reason ? { message: reason } : undefined);
    }, this.timeouts.settleMs);
    turn.settleTimer.unref?.();
  }

  private interrupt(turn: TurnState) {
    if (turn.interruptSent || !turn.thread || !turn.turnId || !this.peer) return;
    turn.interruptSent = true;
    // Never awaited for flow: interrupting a turn that has just ended can take ~10 s to answer.
    this.peer.request('turn/interrupt', { threadId: turn.thread.id, turnId: turn.turnId }, { timeoutMs: this.timeouts.interruptMs })
      .catch(error => this.log(`codex: turn/interrupt: ${describeRpcError(error)}`));
  }

  /** The answer to a Codex question (item/tool/requestUserInput). `owner` limits it to the asking tab's requests. */
  answer(questionKey: string, answers: Record<string, string[]>, owner?: (turnKey: string) => boolean): boolean {
    const q = this.questions.get(questionKey);
    if (!q || (owner && !owner(q.turn.key))) return false;
    this.questions.delete(questionKey);
    q.turn.questions.delete(questionKey);
    if (q.timer) clearTimeout(q.timer);
    this.peer?.respond(q.rpcId, { answers: Object.fromEntries(Object.entries(answers).map(([id, list]) => [id, { answers: list }])) });
    q.turn.sink.event({ kind: 'question.resolved', question: questionKey });
    this.armIdleWait(q.turn);
    return true;
  }

  /** A tool result from the browser. Late or unknown results are dropped. */
  toolResult(callId: string, output: ToolOutput, owner?: (turnKey: string) => boolean): boolean {
    const turn = this.calls.get(callId);
    const call = turn?.calls.get(callId);
    if (!turn || !call || (owner && !owner(turn.key))) return false;
    this.calls.delete(callId);
    turn.calls.delete(callId);
    clearTimeout(call.timer);
    const content: DynamicToolCallResponse['contentItems'] = [{ type: 'inputText', text: output.text || (output.success ? 'OK' : 'Failed.') }];
    if (output.imageDataUrl && this.statusValue.images) content.push({ type: 'inputImage', imageUrl: output.imageDataUrl });
    this.peer?.respond(call.rpcId, { contentItems: content, success: output.success } satisfies DynamicToolCallResponse);
    this.armIdleWait(turn);
    return true;
  }

  /** Tool calls still waiting for the browser (re-sent after the tab reconnects). */
  pendingToolCalls(key: string): Array<{ callId: string; tool: string; args: unknown }> {
    const turn = this.turns.get(key);
    return turn ? [...turn.calls].map(([callId, c]) => ({ callId, tool: c.tool, args: c.args })) : [];
  }

  /** Whether a request is still running. */
  running(key: string) { return this.turns.has(key); }

  /** Forget a conversation (new patch, or the tab went away). */
  forget(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    if (thread.turn) this.stopTurn(thread.turn.key, 'The conversation was closed.');
    this.dropThread(thread);
  }

  private dropThread(thread: ThreadState) {
    if (this.threads.get(thread.id) !== thread) return;
    this.threads.delete(thread.id);
    if (thread.generation === this.generation) this.peer?.request('thread/unsubscribe', { threadId: thread.id }, { timeoutMs: this.timeouts.requestMs }).catch(() => { /* gone already */ });
  }

  private finish(turn: TurnState, status: 'completed' | 'interrupted' | 'failed', error?: LlmError) {
    if (turn.done) return;
    turn.done = true;
    this.clearTurnWait(turn);
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    for (const [callId, call] of turn.calls) { clearTimeout(call.timer); this.calls.delete(callId); }
    turn.calls.clear();
    for (const key of turn.questions) { const q = this.questions.get(key); if (q?.timer) clearTimeout(q.timer); this.questions.delete(key); }
    for (const steer of turn.steers.splice(0)) steer.sink.event({ kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 });
    if (turn.thread && turn.thread.turn === turn) turn.thread.turn = null;
    this.turns.delete(turn.key);
    const ms = Date.now() - turn.started;
    this.record('done', { key: turn.key, thread: turn.thread?.id, status, ms, tools: turn.tools, error: error?.code ?? error?.message });
    turn.sink.event({ kind: 'done', status, ...(error ? { error } : {}), ms });
  }

  /** KIT_CODEX_EFFORT, except "ultra": that turns on Codex's own sub-agents, and den-kit runs its own members. */
  private effort(): string | undefined {
    const effort = this.options.effort?.trim();
    if (!effort) return undefined;
    if (effort.toLowerCase() === 'ultra') {
      if (!this.warnedUltra) { this.warnedUltra = true; this.log('codex: KIT_CODEX_EFFORT=ultra is not sent (it starts Codex\'s own sub-agents; den-kit has its own members). Using the model\'s default effort.'); }
      return undefined;
    }
    return effort;
  }
  private warnedUltra = false;

  private clearTurnWait(turn: TurnState) {
    if (turn.retryTimer) clearTimeout(turn.retryTimer);
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    turn.retryTimer = null; turn.idleTimer = null;
  }

  private failTurn(turn: TurnState, error: LlmError) {
    if (turn.done || turn.stopRequested) return;
    turn.stopRequested = true;
    this.interrupt(turn);
    if (turn.thread) this.dropThread(turn.thread);
    this.finish(turn, 'failed', error);
  }

  private progress(turn: TurnState) {
    this.clearTurnWait(turn);
    this.armIdleWait(turn);
  }

  private armIdleWait(turn: TurnState) {
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    turn.idleTimer = null;
    if (turn.done || turn.stopRequested) return;
    turn.idleTimer = setTimeout(() => {
      // A tool or a blocking question has its own deadline and is not model silence.
      if (turn.calls.size || turn.questions.size) { this.armIdleWait(turn); return; }
      this.failTurn(turn, { code: 'response-timeout', message: 'ChatGPT stopped responding.', fix: 'Check your connection and send the request again.' });
    }, this.timeouts.idleMs);
    turn.idleTimer.unref?.();
  }

  private retrying(turn: TurnState, error?: TurnError) {
    if (turn.done || turn.stopRequested) return;
    turn.sink.event({ kind: 'retrying', message: error?.message ?? 'Retrying…' });
    // Repeated failure notifications do not extend the same connection attempt.
    if (turn.retryTimer) return;
    turn.retryTimer = setTimeout(() => this.failTurn(turn, {
      code: 'connection-timeout', message: 'ChatGPT could not reconnect.',
      fix: 'Check your connection and send the request again.',
    }), this.timeouts.retryMs);
    turn.retryTimer.unref?.();
  }

  // ---- from Codex ------------------------------------------------------------------------------
  private turnOf(threadId: unknown): TurnState | null {
    return typeof threadId === 'string' ? this.threads.get(threadId)?.turn ?? null : null;
  }

  private onRequest(peer: RpcPeer, request: RpcRequest) {
    if (peer !== this.peer) return;
    const params = (request.params && typeof request.params === 'object' ? request.params : {}) as Record<string, unknown>;
    switch (request.method) {
      case 'item/tool/call': this.onToolCall(peer, request.id, params as unknown as DynamicToolCallParams); return;
      case 'item/tool/requestUserInput': this.onQuestion(peer, request.id, params as unknown as ToolRequestUserInputParams); return;
      case 'currentTime/read': peer.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) }); return;
    }
    if (Object.hasOwn(DECLINE, request.method)) {
      peer.respond(request.id, DECLINE[request.method]);
      this.stats.declined++;
      this.record('declined', { method: request.method, command: typeof params.command === 'string' ? params.command.slice(0, 200) : undefined });
      this.turnOf(params.threadId)?.sink.event({ kind: 'activity', what: 'blocked', detail: request.method.includes('command') || request.method === 'execCommandApproval' ? 'a shell command' : request.method.includes('file') || request.method === 'applyPatchApproval' ? 'a file change' : request.method.includes('permissions') ? 'extra permissions' : 'an MCP request' });
      return;
    }
    this.record('unsupported-request', { method: request.method });
    peer.respondError(request.id, RPC_METHOD_NOT_FOUND, `den-kit does not support ${request.method}.`);
  }

  private onToolCall(peer: RpcPeer, rpcId: RequestId, params: DynamicToolCallParams) {
    const turn = this.turnOf(params.threadId);
    if (!turn || turn.done || (turn.turnId && params.turnId !== turn.turnId)) { peer.respond(rpcId, failure('This request is over; the tool was not run.')); return; }
    if (turn.stopRequested) { peer.respond(rpcId, failure('The user stopped this request; do not continue.')); return; }
    this.progress(turn);
    const names = turn.thread?.tools ?? new Set<string>();
    if (params.namespace || !names.has(params.tool)) { peer.respond(rpcId, failure(`Unknown tool "${params.tool}". Use only: ${[...names].join(', ')}.`)); return; }
    const callId = typeof params.callId === 'string' && params.callId ? params.callId : `call-${++this.serial}`;
    if (this.calls.has(callId)) { peer.respond(rpcId, failure('Duplicate tool call id.')); return; }
    turn.tools++;
    this.stats.toolCalls++;
    const timer = setTimeout(() => {
      if (!turn.calls.has(callId)) return;
      turn.calls.delete(callId); this.calls.delete(callId);
      peer.respond(rpcId, failure('den-kit did not answer in time (is the editor tab still open?).'));
      this.stopTurn(turn.key, 'The editor did not answer a tool call in time.');
    }, toolDeadlineMs(params.tool, params.arguments, this.timeouts.toolMs));
    timer.unref?.();
    turn.calls.set(callId, { rpcId, timer, tool: params.tool, args: params.arguments });
    this.calls.set(callId, turn);
    turn.sink.toolCall({ callId, tool: params.tool, args: params.arguments });
  }

  private onQuestion(peer: RpcPeer, rpcId: RequestId, params: ToolRequestUserInputParams) {
    const turn = this.turnOf(params.threadId);
    if (!turn || turn.done || (turn.turnId && params.turnId !== turn.turnId)) { peer.respond(rpcId, { answers: {} }); return; }
    this.progress(turn);
    const key = `q${++this.serial}`;
    const items: LlmQuestion[] = (Array.isArray(params.questions) ? params.questions : []).slice(0, 4).map(q => ({
      id: String(q.id), header: String(q.header ?? ''), question: String(q.question ?? ''),
      options: (q.options ?? []).map(o => String(o.label)).slice(0, 8), other: !!q.isOther,
    }));
    // Non-blocking questions resolve themselves with no answer, as Codex expects.
    const timer = params.isBlocking ? null : setTimeout(() => this.answer(key, {}), params.autoResolutionMs ?? 60000);
    timer?.unref?.();
    this.questions.set(key, { key, rpcId, turn, timer });
    turn.questions.add(key);
    turn.sink.event({ kind: 'question', question: key, items, blocking: !!params.isBlocking });
  }

  private onNotification(notification: RpcNotification) {
    const p = (notification.params && typeof notification.params === 'object' ? notification.params : {}) as Record<string, unknown>;
    const currentTurn = this.turnOf(p.threadId);
    if (typeof p.turnId === 'string' && currentTurn?.turnId && p.turnId !== currentTurn.turnId) return;
    switch (notification.method) {
      case 'turn/started': { const t = this.turnOf(p.threadId); const n = p as unknown as TurnNotification; if (t && !t.turnId && n.turn?.id) t.turnId = n.turn.id; return; }
      case 'turn/completed': {
        const n = p as unknown as TurnNotification;
        const t = this.turnOf(n.threadId);
        if (!t || (t.turnId && n.turn?.id && n.turn.id !== t.turnId)) return;
        const status = n.turn?.status === 'interrupted' ? 'interrupted' : n.turn?.status === 'failed' ? 'failed' : 'completed';
        if (status === 'failed') this.finish(t, 'failed', explainCodexError(n.turn?.error ?? t.error, `Run \`${LOGIN_COMMAND}\` again, then retry.`));
        else this.finish(t, status, status === 'interrupted' && t.stopReason ? { message: t.stopReason } : undefined);
        return;
      }
      case 'item/started': {
        const n = p as unknown as ItemNotification;
        const t = this.turnOf(n.threadId);
        if (!t || !n.item) return;
        if (n.item.type !== 'userMessage') this.progress(t);
        if (n.item.type === 'reasoning') t.sink.event({ kind: 'activity', what: 'thinking' });
        else if (!EXPECTED_ITEMS.has(n.item.type)) {
          this.stats.unexpectedItems++;
          this.record('unexpected-item', { type: n.item.type });
          t.sink.event({ kind: 'activity', what: 'unexpected', detail: n.item.type });
        }
        return;
      }
      case 'item/completed': {
        const n = p as unknown as ItemNotification;
        const t = this.turnOf(n.threadId);
        if (t && n.item?.type !== 'userMessage') this.progress(t);
        if (t && n.item?.type === 'agentMessage' && typeof (n.item as { text?: unknown }).text === 'string') t.sink.event({ kind: 'message', text: (n.item as { text: string }).text });
        return;
      }
      case 'item/agentMessage/delta': { const n = p as unknown as AgentMessageDeltaNotification; const t = this.turnOf(n.threadId); if (t && typeof n.delta === 'string') { this.progress(t); t.sink.event({ kind: 'delta', text: n.delta }); } return; }
      case 'item/reasoning/summaryTextDelta': case 'item/reasoning/textDelta': {
        const t = this.turnOf(p.threadId);
        if (t) { this.progress(t); t.sink.event({ kind: 'activity', what: 'thinking' }); }
        return;
      }
      case 'error': {
        const n = p as unknown as ErrorNotification;
        const t = this.turnOf(n.threadId);
        if (!t) return;
        if (n.willRetry) this.retrying(t, n.error);
        else this.failTurn(t, explainCodexError(n.error, this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\` again, then retry.`));
        return;
      }
      case 'serverRequest/resolved': {
        const n = p as unknown as ServerRequestResolvedNotification;
        for (const q of this.questions.values()) if (q.rpcId === n.requestId) {
          this.questions.delete(q.key); q.turn.questions.delete(q.key); if (q.timer) clearTimeout(q.timer);
          q.turn.sink.event({ kind: 'question.resolved', question: q.key });
        }
        for (const [callId, turn] of this.calls) { const c = turn.calls.get(callId); if (c && c.rpcId === n.requestId) { clearTimeout(c.timer); turn.calls.delete(callId); this.calls.delete(callId); } }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const n = p as unknown as ThreadTokenUsageUpdatedNotification;
        const t = this.turnOf(n.threadId);
        if (t) this.progress(t);
        if (t && n.tokenUsage?.total && n.tokenUsage.last) t.sink.event({ kind: 'usage', total: tokens(n.tokenUsage.total), last: tokens(n.tokenUsage.last), window: typeof n.tokenUsage.modelContextWindow === 'number' ? n.tokenUsage.modelContextWindow : null });
        return;
      }
      case 'account/rateLimits/updated': this.updateRateLimit((p as { rateLimits?: RateLimitSnapshot }).rateLimits); return;
      case 'account/login/completed': {
        if (typeof p.loginId === 'string') this.loginCompleted({ loginId: p.loginId, success: p.success === true, ...(p.error ? { error: String(p.error) } : {}) });
        return;
      }
      case 'account/updated': void this.refreshAccount(); return;
      case 'thread/closed': { const id = p.threadId; if (typeof id === 'string') { const thread = this.threads.get(id); if (thread?.turn) this.finish(thread.turn, 'failed', { message: 'Codex closed the conversation.', code: 'closed' }); this.threads.delete(id); } return; }
      case 'warning': case 'configWarning': case 'deprecationNotice': {
        const message = String(p.message ?? p.summary ?? '').slice(0, 300);
        if (message && !/bubblewrap|PATH aliases/i.test(message)) { this.log(`codex ${notification.method}: ${message}`); this.record('warning', { method: notification.method, message }); }
        return;
      }
      default: return;
    }
  }
}

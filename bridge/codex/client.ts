// The bridge's Codex app-server client. One app-server process for the whole
// bridge; one saved thread per conversation (Codex keeps it in CODEX_HOME, and a
// later request opens it again by its id); one turn per LLM request.
//
// Lifecycle: start → initialize → account/read → model/list → ok. Not signed in
// → `login` (the client watches CODEX_HOME/auth.json and restarts when it
// appears). The process exiting → every running request fails with a clear
// message and the process restarts with backoff.
//
// Every server request is answered (an unanswered one stalls the turn): kit_*
// tool calls go to the browser that owns the turn (with a deadline), requests
// for powers den-kit never grants are declined, anything unknown gets an error.
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CodexStatus,
  LlmError,
  LlmEvent,
  LlmQuestion,
  ConversationLine,
  TokenUsage,
  ToolOutput,
} from '../protocol.ts';
import { toolDeadlineMs, toolsFor, type ToolSpec } from '../../src/ai/llm-spec.ts';
import type { Telemetry } from '../telemetry.ts';
import { MCP_TOKEN_ENV } from '../mcp.ts';
import { RpcClosed, RpcError, RpcPeer, RpcTimeout } from './rpc.ts';
import {
  codexHome,
  codexWorkdir,
  isProblem,
  LOGIN_COMMAND,
  resolveCodex,
  spawnAppServer,
  type AppServerProcess,
  type CodexCommand,
} from './process.ts';
import {
  CODEX_VERSION,
  DECLINE,
  EXPECTED_ITEMS,
  RPC_METHOD_NOT_FOUND,
  explainCodexError,
  type AgentMessageDeltaNotification,
  type ErrorNotification,
  type GetAccountRateLimitsResponse,
  type GetAccountResponse,
  type InitializeResponse,
  type ItemNotification,
  type Model,
  type ModelListResponse,
  type RateLimitSnapshot,
  type RequestId,
  type RpcNotification,
  type RpcRequest,
  type ServerRequestResolvedNotification,
  type ThreadStartParams,
  type ThreadStartResponse,
  type ToolRequestUserInputParams,
  type ThreadResumeParams,
  type ThreadItemsListResponse,
  type ThreadTokenUsageUpdatedNotification,
  type TokenUsageBreakdown,
  type TurnError,
  type TurnNotification,
  type TurnStartResponse,
  type UserInput,
} from './protocol.ts';

/**
 * Where one request's progress goes (the bridge forwards it to the browser tab that asked). `agent`: the
 * sub-agent an event is about or that made a call (none: the request's own AI).
 */
export interface TurnSink {
  event(event: LlmEvent, agent?: string): void;
  toolCall(call: { callId: string; tool: string; args: unknown; agent?: string }): void;
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
  /** den-kit's MCP server, where its tools are (the bridge sets it before Codex starts). */
  mcp?: { url: string; token: string };
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
  /** Turns running at once across the bridge (requests from several windows). */
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

interface ThreadState {
  id: string;
  turn: TurnState | null;
  generation: number;
}
interface TurnState {
  retryTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  key: string;
  sink: TurnSink;
  thread: ThreadState | null;
  turnId: string | null;
  started: number;
  /** Codex said the turn started (turn/started): only then can it be interrupted. */
  begun: boolean;
  stopRequested: boolean;
  interruptSent: boolean;
  stopReason?: string;
  steers: Array<{
    key: string;
    text: string;
    context?: string;
    images?: string[];
    sink: TurnSink;
  }>;
  /** Tool calls waiting for the tab, answered through `answer` (the MCP request waits for it). */
  calls: Map<
    string,
    {
      answer: (output: ToolOutput) => void;
      timer: ReturnType<typeof setTimeout>;
      tool: string;
      args: unknown;
      agent?: string;
    }
  >;
  /** The sub-agents the runtime started in this request, by their conversation's id. */
  agents: Set<string>;
  questions: Set<string>;
  error: TurnError | null;
  tools: number;
  done: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
}
/** A sub-agent the runtime started inside a request: a conversation of its own, with its own turn. */
interface SubAgent {
  id: string;
  name: string;
  turn: TurnState;
  turnId: string | null;
  begun: boolean;
  ended: boolean;
  interruptSent: boolean;
}
interface Question {
  key: string;
  rpcId: RequestId;
  turn: TurnState;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Conversations of one request running at once: its own and its sub-agents'. */
export const MAX_AGENT_THREADS = 4;
/** How long Codex waits for one of den-kit's tools: a command may run 10 minutes after the pod starts. */
const MCP_TOOL_TIMEOUT_S = 21 * 60;

/**
 * The config of every conversation: web search on Codex's side, sub-agents with a limit, den-kit's tools from
 * its MCP server (approved there: den-kit checks every call itself), and the features that would give the
 * model powers den-kit does not want off (checked against the real 0.160.1 server).
 */
export function threadConfig(mcp?: { url: string } | null) {
  return {
    web_search: 'live',
    features: { ...FEATURES_OFF, multi_agent: true },
    agents: { max_concurrent_threads_per_session: MAX_AGENT_THREADS },
    ...(mcp
      ? {
          mcp_servers: {
            'den-kit': {
              url: mcp.url,
              bearer_token_env_var: MCP_TOKEN_ENV,
              required: true,
              tool_timeout_sec: MCP_TOOL_TIMEOUT_S,
              default_tools_approval_mode: 'approve',
            },
          },
        }
      : {}),
  };
}
const FEATURES_OFF: Record<string, boolean> = Object.fromEntries(
  [
    'apps',
    'browser_use',
    'computer_use',
    'goals',
    'hooks',
    'image_generation',
    'in_app_browser',
    'memories',
    'plugins',
    'remote_plugin',
    'shell_tool',
    'skill_search',
    'sleep_tool',
    'tool_suggest',
    'unified_exec',
    'view_image',
  ].map(k => [k, false]),
);

/** The thread den-kit asks for: saved, no environment (no shell, no files), read-only, never asks for approval, its tools from `mcp`. */
export function threadStartParams(options: {
  model?: string | null;
  cwd: string;
  instructions: string;
  mcp?: { url: string } | null;
}): ThreadStartParams {
  return {
    ...(options.model ? { model: options.model } : {}),
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: false,
    environments: [],
    config: threadConfig(options.mcp),
    developerInstructions: options.instructions,
  };
}

export const text = (value: string): UserInput => ({
  type: 'text',
  text: value,
  text_elements: [],
});
/**
 * A request's input: den-kit's notes about the moment (when there are any), the person's words, then
 * their pictures (data: URLs). The words are an input of their own, so a conversation read back later
 * shows what the person said.
 */
export const userInput = (
  value: string,
  images?: readonly string[],
  context?: string,
): UserInput[] => [
  ...(context ? [text(context)] : []),
  text(value),
  ...(images ?? []).map((url): UserInput => ({ type: 'image', url })),
];
/** Turns running at once across the bridge (separate requests, from different windows). */
export const MAX_TURNS = 4;

/** Opening a saved conversation again: the same isolation as a new one (no shell, no files, no approvals). */
export function resumeParams(options: {
  threadId: string;
  model?: string | null;
  cwd: string;
  instructions: string;
  mcp?: { url: string } | null;
}): ThreadResumeParams {
  return {
    threadId: options.threadId,
    ...(options.model ? { model: options.model } : {}),
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: threadConfig(options.mcp),
    developerInstructions: options.instructions,
  };
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function tokens(b: TokenUsageBreakdown): TokenUsage {
  return {
    input: count(b.inputTokens),
    cached: count(b.cachedInputTokens),
    output: count(b.outputTokens),
    reasoning: count(b.reasoningOutputTokens),
    total: count(b.totalTokens),
  };
}
const failure = (message: string): ToolOutput => ({ success: false, text: message });

/** A sub-agent's name: the last part of its path (/root/sound → sound). */
const agentName = (path: unknown) =>
  (typeof path === 'string' ? path.split('/').filter(Boolean).at(-1) : undefined) || 'sub-agent';

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
  private agents = new Map<string, SubAgent>();
  private questions = new Map<string, Question>();
  private serial = 0;
  readonly home: { path: string; isolated: boolean };
  readonly workdir: string;
  private readonly options: CodexClientOptions;
  private readonly timeouts: Timeouts;
  private readonly restartPolicy: { baseMs: number; maxMs: number; maxFailures: number };
  readonly stats = {
    boots: 0,
    exits: 0,
    turns: 0,
    toolCalls: 0,
    declined: 0,
    unexpectedItems: 0,
    malformed: 0,
  };
  private modelCatalog: Model[] = [];
  private loginId: string | null = null;
  private canceling: Promise<void> | null = null;
  private discardCanceledAccount = false;
  private pendingCancellation: { state: 'idle' | 'error'; error?: string } | null = null;
  private accountChangedDuringCancellation = false;
  private signInState: 'idle' | 'starting' | 'waiting' | 'checking' | 'complete' | 'error' = 'idle';
  private signInError: string | undefined;
  private chatGPTAccount = false;
  private authAttempt = 0;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private loginPoll: ReturnType<typeof setInterval> | null = null;
  private earlyLogin: { loginId: string; success: boolean; error?: string } | null = null;
  private accountRefreshing: {
    peer: RpcPeer;
    attempt: number;
    again: boolean;
    promise: Promise<void>;
  } | null = null;

  constructor(options: CodexClientOptions) {
    this.options = options;
    const env = options.env ?? process.env;
    this.home = options.home ?? codexHome(options.kitRoot, env);
    if (existsSync(this.cancellationFile)) this.pendingCancellation = { state: 'idle' };
    this.workdir = options.workdir ?? codexWorkdir(options.kitRoot);
    this.timeouts = {
      retryMs: 30000,
      idleMs: 180000,
      initializeMs: 30000,
      requestMs: 20000,
      toolMs: 90000,
      interruptMs: 8000,
      settleMs: 10000,
      ...options.timeouts,
    };
    this.restartPolicy = { baseMs: 1000, maxMs: 30000, maxFailures: 5, ...options.restart };
  }

  get status(): CodexStatus {
    return this.canceling
      ? { state: 'starting', detail: 'Canceling ChatGPT sign-in…' }
      : { ...this.statusValue };
  }
  get chatGPTSignedIn() {
    return this.chatGPTAccount;
  }
  get ready() {
    return (
      !this.canceling && !this.pendingCancellation && this.statusValue.state === 'ok' && !!this.peer
    );
  }
  get busy() {
    return this.turns.size > 0;
  }
  get models(): Model[] {
    return this.modelCatalog.map(m => ({ ...m }));
  }
  get login() {
    return {
      state: this.canceling ? ('canceling' as const) : this.signInState,
      error: this.signInError,
    };
  }
  private get signingIn() {
    return (
      this.signInState === 'starting' ||
      this.signInState === 'waiting' ||
      this.signInState === 'checking'
    );
  }

  /** Existing Codex sign-in, hosted by the bundled app-server. Tokens never enter the renderer. */
  async signIn(): Promise<string> {
    if (this.busy) throw new Error('Finish the current AI request before signing in.');
    await this.canceling;
    if (this.pendingCancellation)
      throw new Error('Reconnect AI to finish canceling the previous sign-in before trying again.');
    await this.start();
    if (!this.peer) throw new Error('Codex is not available. Try reconnecting.');
    if (this.chatGPTAccount)
      throw new Error('Sign out before signing in with another ChatGPT account.');
    if (this.signingIn) await this.cancelSignIn();
    const peer = this.peer;
    if (!peer) throw new Error('Codex is not available. Try reconnecting.');
    const attempt = ++this.authAttempt;
    this.stopAuthWatch();
    this.signInState = 'starting';
    this.signInError = undefined;
    this.earlyLogin = null;
    this.loginTimer = setTimeout(
      () => {
        if (this.authAttempt !== attempt) return;
        const id = this.loginId;
        this.finishSignIn('error', 'ChatGPT sign-in timed out. Try signing in again.');
        if (this.peer === peer) void this.cancelLogin(peer, id);
      },
      this.options.loginTimeoutMs ?? 5 * 60_000,
    );
    this.loginTimer.unref?.();
    try {
      const response = await peer.request<{ type: string; loginId: string; authUrl: string }>(
        'account/login/start',
        { type: 'chatgpt' },
        { timeoutMs: this.timeouts.requestMs },
      );
      if (this.authAttempt !== attempt || this.peer !== peer) {
        if (response.loginId) void this.cancelLogin(peer, response.loginId);
        throw new Error('ChatGPT sign-in was canceled or interrupted. Try again.');
      }
      if (
        response.type !== 'chatgpt' ||
        typeof response.loginId !== 'string' ||
        typeof response.authUrl !== 'string'
      )
        throw new Error('Codex returned an unsupported sign-in response.');
      this.loginId = response.loginId;
      this.signInState = 'waiting';
      this.loginPoll = setInterval(() => {
        void this.refreshAccount();
      }, this.options.authPollMs ?? 2000);
      this.loginPoll.unref?.();
      const early = this.earlyLogin as { loginId: string; success: boolean; error?: string } | null;
      this.earlyLogin = null;
      if (early) this.loginCompleted(early);
      return response.authUrl;
    } catch (error) {
      if (this.authAttempt === attempt) {
        this.finishSignIn('error', `ChatGPT sign-in could not start: ${describeRpcError(error)}`);
        void this.cancelLogin(peer, null);
      }
      throw error;
    }
  }
  async cancelSignIn() {
    if (this.canceling) {
      if (this.discardCanceledAccount) return this.canceling;
      // A queued user click can join cleanup started by a confirmation error.
      // Upgrade that transaction instead of losing the explicit cancellation.
      this.discardCanceledAccount = true;
      this.pendingCancellation = { state: 'idle' };
      writeFileSync(this.cancellationFile, 'pending\n', { mode: 0o600 });
      this.finishSignIn('idle');
      return this.canceling;
    }
    const id = this.loginId,
      peer = this.peer;
    // The UI may still show Cancel when its queued message reaches a just-
    // confirmed login. Only an in-app attempt is cancelable, not startup auth.
    const cancelable =
      this.signInState === 'starting' ||
      this.signInState === 'complete' ||
      (this.signInState === 'error' && !this.chatGPTAccount);
    this.finishSignIn('idle');
    if (id || cancelable) await this.cancelLogin(peer, id, true);
  }

  /** Stop the callback process and unwind credentials from the canceled login
   * before accepting another sign-in or publishing AI readiness. */
  private cancelLogin(
    peer: RpcPeer | null,
    id: string | null,
    discardAccount = false,
  ): Promise<void> {
    if (this.canceling) return this.canceling;
    if (this.peer !== peer && !discardAccount) return Promise.resolve();
    this.discardCanceledAccount = discardAccount || !!this.pendingCancellation;
    // Explicit cancellation withdraws the sign-in. A failed confirmation merely
    // ends its callback flow: an already saved account can still be rechecked.
    if (discardAccount)
      this.pendingCancellation ??= {
        state: this.signInState === 'error' ? 'error' : 'idle',
        error: this.signInError,
      };
    this.stopAuthWatch();
    const task = (async () => {
      try {
        if (this.discardCanceledAccount)
          writeFileSync(this.cancellationFile, 'pending\n', { mode: 0o600 });
        let restart = !id;
        try {
          if (id && peer)
            await peer.request(
              'account/login/cancel',
              { loginId: id },
              { timeoutMs: this.timeouts.requestMs },
            );
        } catch (error) {
          restart = true;
          this.log(`codex: canceling sign-in by restarting: ${describeRpcError(error)}`);
        }
        if (this.stopped) return;
        // boot() removes credentials saved before cancellation completed,
        // after the old process can no longer write them again.
        const discardBeforeRestart = this.discardCanceledAccount;
        if ((restart || discardBeforeRestart) && (discardBeforeRestart || this.peer === peer))
          await this.retry();
        // Explicit cancellation may also arrive after that boot read its account.
        if (this.discardCanceledAccount && !discardBeforeRestart && this.pendingCancellation)
          await this.retry();
        if (this.pendingCancellation) throw new Error('The canceled account could not be cleared.');
      } catch (error) {
        if (this.stopped) return;
        this.log(`codex: cancellation cleanup failed: ${describeRpcError(error)}`);
        this.finishSignIn(
          'error',
          'Sign-in cancellation could not be completed. Reconnect AI before trying again.',
        );
        this.setStatus({
          state: 'error',
          detail: 'Sign-in cancellation could not be completed.',
          fix: 'Reconnect AI to finish canceling sign-in.',
        });
      }
    })().finally(() => {
      if (this.canceling !== task) return;
      const discard = this.discardCanceledAccount;
      this.discardCanceledAccount = false;
      this.canceling = null;
      this.setStatus(this.statusValue);
      const changed = this.accountChangedDuringCancellation;
      this.accountChangedDuringCancellation = false;
      if (changed && !discard && !this.pendingCancellation && !this.stopped)
        void this.refreshAccount(true);
    });
    this.canceling = task;
    return task;
  }
  private get cancellationFile() {
    return join(this.home.path, 'den-kit-canceled-login');
  }
  async signOut() {
    if (this.busy) throw new Error('Finish the current AI request before signing out.');
    if (this.signingIn || this.canceling || this.pendingCancellation) await this.cancelSignIn();
    else this.finishSignIn('idle');
    if (!this.peer) throw new Error('Codex is not available. Try reconnecting.');
    await this.peer.request('account/logout', undefined, { timeoutMs: this.timeouts.requestMs });
    await this.retry();
  }
  async configure(settings: { model: string; effort: string }) {
    if (this.busy) throw new Error('Finish the current AI request before changing settings.');
    if (this.signingIn || this.canceling || this.pendingCancellation)
      throw new Error('Complete or cancel ChatGPT sign-in before changing settings.');
    this.options.model = settings.model || undefined;
    this.options.effort = settings.effort || undefined;
    await this.retry();
  }
  onStatus(listener: (status: CodexStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start (or keep) the app-server; resolves when the state settles (ok, login or error). */
  start(): Promise<void> {
    this.stopped = false;
    if (this.restarting) return this.restarting;
    return this.launch();
  }

  private launch(): Promise<void> {
    if (this.peer || this.restartTimer) return this.booting ?? Promise.resolve();
    const task = this.boot().finally(() => {
      if (this.booting === task) this.booting = null;
    });
    this.booting = task;
    return task;
  }

  /** Restart now (after signing in, after an error); requests in flight fail. */
  retry(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.stopped = false;
    const task = (async () => {
      this.failures = 0;
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      await this.shutdown('Codex is restarting.');
      if (!this.stopped) await this.launch();
    })().finally(() => {
      if (this.restarting === task) this.restarting = null;
    });
    this.restarting = task;
    return task;
  }

  async stop() {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.shutdown('The bridge is shutting down.');
    this.setStatus({ state: 'off', detail: 'Codex is stopped.' });
  }

  // ---- lifecycle -------------------------------------------------------------------------
  private setStatus(next: CodexStatus) {
    this.statusValue = next;
    for (const l of this.listeners) l(this.status);
  }

  private log(line: string) {
    this.options.log?.(line);
  }
  private record(event: string, data: Record<string, unknown> = {}) {
    this.options.telemetry?.write('codex', { event, ...data });
  }

  private finishSignIn(state: 'idle' | 'complete' | 'error', error?: string) {
    ++this.authAttempt;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    if (this.loginPoll) clearInterval(this.loginPoll);
    this.loginTimer = null;
    this.loginPoll = null;
    this.loginId = null;
    this.earlyLogin = null;
    this.signInState = state;
    this.signInError = error;
    if (this.statusValue.state === 'login' && !this.stopped && this.peer) this.watchAuth();
  }

  private loginCompleted(result: { loginId: string; success: boolean; error?: string }) {
    if (this.signInState === 'starting') {
      this.earlyLogin = result;
      return;
    }
    if (!this.loginId || this.loginId !== result.loginId) return;
    if (!result.success) {
      this.finishSignIn('error', result.error ?? 'ChatGPT sign-in did not complete. Try again.');
      return;
    }
    this.signInState = 'checking';
    void this.refreshAccount(true);
  }

  private refreshAccount(accountChanged = false): Promise<void> {
    const peer = this.peer;
    const attempt = this.authAttempt;
    if (this.canceling || this.pendingCancellation) {
      this.accountChangedDuringCancellation ||= accountChanged;
      return Promise.resolve();
    }
    if (!peer || this.signInState === 'starting') return Promise.resolve();
    if (this.accountRefreshing?.peer === peer && this.accountRefreshing.attempt === attempt) {
      // Timer ticks share the pending read. Only new account evidence queues
      // another read, so a slow failing RPC cannot perpetually extend itself.
      this.accountRefreshing.again ||= accountChanged;
      return this.accountRefreshing.promise;
    }
    const refresh = { peer, attempt, again: false, promise: Promise.resolve() };
    const current = () => this.peer === peer && this.authAttempt === attempt;
    let confirming = false;
    this.accountRefreshing = refresh;
    refresh.promise = (async () => {
      do {
        refresh.again = false;
        confirming = this.signInState === 'checking';
        const account = await peer.request<GetAccountResponse>(
          'account/read',
          { refreshToken: false },
          { timeoutMs: this.timeouts.requestMs },
        );
        if (!current()) return;
        const chatGPT = account.account?.type === 'chatgpt';
        let model = { label: this.statusValue.model, images: this.statusValue.images };
        if (chatGPT && (!this.chatGPTAccount || this.signingIn)) {
          confirming = true;
          if (this.signingIn) this.signInState = 'checking';
          const models = await peer.request<ModelListResponse>(
            'model/list',
            { limit: 100 },
            { timeoutMs: this.timeouts.requestMs },
          );
          if (!current()) return;
          this.modelCatalog = models.data.filter(m => !m.hidden);
          model = this.chooseModel(models.data);
        }
        this.chatGPTAccount = chatGPT;
        if (!account.account && account.requiresOpenaiAuth !== false) {
          this.setStatus({
            state: 'login',
            model: model.label,
            images: model.images,
            detail: 'Codex is not signed in.',
            fix: this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\`.`,
          });
          if (!this.signingIn) this.watchAuth();
        } else {
          this.stopAuthWatch();
          const plan = account.account?.type === 'chatgpt' ? account.account.planType : undefined;
          this.setStatus({
            state: 'ok',
            model: model.label,
            images: model.images,
            ...(plan ? { plan } : {}),
            rateLimit: null,
          });
          if (chatGPT && (this.signingIn || this.signInState === 'error')) {
            this.finishSignIn('complete');
            // An account change received while this read was in flight still needs a fresh read.
            if (refresh.again) void this.refreshAccount();
          }
          void peer
            .request<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined, {
              timeoutMs: this.timeouts.requestMs,
            })
            .then(r => {
              if (this.peer === peer) this.updateRateLimit(r.rateLimits);
            })
            .catch(() => undefined);
        }
        if (account.account && !chatGPT && this.signInState === 'checking')
          this.finishSignIn(
            'error',
            'ChatGPT sign-in could not be confirmed. Try signing in again.',
          );
      } while (refresh.again && current());
    })()
      .catch(error => {
        if (!current()) return;
        this.log(`codex: account refresh failed: ${describeRpcError(error)}`);
        // Before OAuth completes, a failed poll says nothing about the browser
        // login. Keep its ID and deadline so it can complete or be canceled.
        if (this.signingIn && (!confirming || refresh.again)) return;
        if (this.signingIn) {
          const id = this.loginId;
          this.finishSignIn(
            'error',
            'ChatGPT sign-in could not be confirmed. Reconnect and try again.',
          );
          this.setStatus({
            state: 'error',
            detail: 'ChatGPT sign-in could not be confirmed.',
            fix: this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\`.`,
          });
          if (id) void this.cancelLogin(peer, id);
        }
      })
      .finally(() => {
        if (this.accountRefreshing !== refresh) return;
        this.accountRefreshing = null;
        // A failed read cannot consume account evidence received while it was pending.
        if (refresh.again && current()) void this.refreshAccount();
      });
    return refresh.promise;
  }

  private async boot() {
    if (this.stopped) return;
    this.chatGPTAccount = false;
    this.setStatus({ state: 'starting', detail: 'Starting Codex…' });
    const command = this.options.command ?? resolveCodex(this.options.kitRoot, this.options.env);
    if (isProblem(command)) {
      this.setStatus({ state: 'error', detail: command.error, fix: command.fix });
      return;
    }
    if (command.source === 'kit' && command.version !== CODEX_VERSION) {
      this.setStatus({
        state: 'error',
        detail: `Codex ${command.version} is installed; den-kit is pinned to ${CODEX_VERSION}.`,
        fix: 'Run `npm ci` from the repo root.',
      });
      return;
    }
    const started = Date.now();
    let proc: AppServerProcess;
    try {
      // The MCP token lives only in Codex's environment (its config names the variable).
      const mcp = this.options.mcp;
      proc = spawnAppServer(command, {
        home: this.home.path,
        cwd: this.workdir,
        env: mcp
          ? { ...(this.options.env ?? process.env), [MCP_TOKEN_ENV]: mcp.token }
          : this.options.env,
      });
    } catch (error) {
      this.setStatus({
        state: 'error',
        detail: `Could not start Codex: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    const generation = ++this.generation;
    this.stats.boots++;
    this.proc = proc;
    const peer = new RpcPeer(
      proc.child.stdout,
      proc.child.stdin,
      {
        onRequest: request => this.onRequest(peer, request),
        onNotification: notification => {
          if (this.peer === peer) this.onNotification(notification);
        },
        onMalformed: (line, reason) => {
          this.stats.malformed++;
          this.log(`codex: ignored a ${reason} line: ${line.slice(0, 120)}`);
          this.record('malformed', { reason, line: line.slice(0, 200) });
        },
      },
      { trace: this.options.trace },
    );
    this.peer = peer;
    void proc.exited.then(exit => this.onExit(proc, peer, exit));
    try {
      const init = await peer.request<InitializeResponse>(
        'initialize',
        {
          clientInfo: { name: 'den-kit', title: 'den-kit', version: '0.1.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
        { timeoutMs: this.timeouts.initializeMs },
      );
      peer.notify('initialized');
      let account = await peer.request<GetAccountResponse>(
        'account/read',
        { refreshToken: false },
        { timeoutMs: this.timeouts.requestMs },
      );
      if (this.pendingCancellation && this.proc === proc) {
        const canceled = this.pendingCancellation;
        if (account.account?.type === 'chatgpt') {
          await peer.request('account/logout', undefined, { timeoutMs: this.timeouts.requestMs });
          account = await peer.request<GetAccountResponse>(
            'account/read',
            { refreshToken: false },
            { timeoutMs: this.timeouts.requestMs },
          );
          if (account.account?.type === 'chatgpt')
            throw new Error('The canceled ChatGPT account is still signed in.');
        }
        if (this.proc !== proc) return;
        rmSync(this.cancellationFile, { force: true });
        this.pendingCancellation = null;
        this.finishSignIn(canceled.state, canceled.error);
      }
      const models = await peer
        .request<ModelListResponse>(
          'model/list',
          { limit: 100 },
          { timeoutMs: this.timeouts.requestMs },
        )
        .catch(error => {
          this.log(`codex: model/list failed: ${describeRpcError(error)}`);
          return null;
        });
      if (this.proc !== proc) return;
      this.chatGPTAccount = account.account?.type === 'chatgpt';
      if (this.chatGPTAccount && this.signInState === 'error') this.finishSignIn('complete');
      const model = this.chooseModel(models?.data ?? []);
      this.modelCatalog = (models?.data ?? []).filter(m => !m.hidden);
      const base = { model: model.label, images: model.images };
      this.record('boot', {
        generation,
        ms: Date.now() - started,
        userAgent: init.userAgent,
        home: this.home.isolated ? '.codex-home' : 'custom',
        account: account.account?.type ?? null,
        model: model.label,
      });
      if (!account.account && account.requiresOpenaiAuth !== false) {
        this.setStatus({
          state: 'login',
          detail: 'Codex is not signed in.',
          fix:
            this.options.loginInstruction ??
            `Run \`${LOGIN_COMMAND}\` once in another terminal (it opens ChatGPT sign-in); den-kit picks it up by itself.`,
          ...base,
        });
        this.watchAuth();
        return;
      }
      this.failures = 0;
      const plan = account.account?.type === 'chatgpt' ? account.account.planType : undefined;
      this.setStatus({ state: 'ok', ...(plan ? { plan } : {}), ...base, rateLimit: null });
      void peer
        .request<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined, {
          timeoutMs: this.timeouts.requestMs,
        })
        .then(r => {
          if (this.peer === peer) this.updateRateLimit(r.rateLimits);
        })
        .catch(() => {
          /* optional */
        });
    } catch (error) {
      if (this.proc !== proc) return;
      const message = describeRpcError(error);
      this.log(`codex: start failed: ${message}`);
      this.record('boot-failed', { generation, message, stderr: proc.stderrTail() });
      // A process that exited is restarted by onExit; one that hangs is stopped and restarted here.
      if (!(error instanceof RpcClosed)) {
        this.proc = null;
        this.peer = null;
        peer.close(message);
        void proc.stop(500);
        this.failed(`Codex did not start: ${message}`, proc.stderrTail());
      }
    }
  }

  private chooseModel(list: Model[]): { label: string; images: boolean } {
    const wanted = this.options.model?.trim();
    const found = wanted
      ? list.find(m => m.id === wanted || m.model === wanted)
      : (list.find(m => m.isDefault) ?? list.find(m => !m.hidden));
    this.modelId = wanted || null; // without an override Codex uses its own default
    if (wanted && !found)
      this.log(`codex: KIT_CODEX_MODEL=${wanted} is not in model/list; using it anyway`);
    return {
      label: found?.displayName ?? wanted ?? 'default model',
      images: !!found?.inputModalities.includes('image'),
    };
  }

  private updateRateLimit(snapshot: RateLimitSnapshot | null | undefined) {
    if (!snapshot) return;
    const windows = [snapshot.primary, snapshot.secondary].filter(
      (w): w is NonNullable<typeof w> => !!w && typeof w.usedPercent === 'number',
    );
    if (!windows.length) return;
    const busiest = windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
    const next = {
      usedPercent: Math.round(busiest.usedPercent),
      resetsAt: busiest.resetsAt ?? null,
    };
    const cur = this.statusValue.rateLimit;
    if (cur && cur.usedPercent === next.usedPercent && cur.resetsAt === next.resetsAt) return;
    this.setStatus({
      ...this.statusValue,
      rateLimit: next,
      plan: snapshot.planType ?? this.statusValue.plan,
    });
  }

  /** Signed out: restart Codex as soon as a login lands in CODEX_HOME. */
  private watchAuth() {
    if (this.authTimer) return;
    const file = join(this.home.path, 'auth.json');
    const stamp = () => {
      try {
        const s = statSync(file);
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return '';
      }
    };
    const before = stamp();
    this.authTimer = setInterval(() => {
      if (this.statusValue.state !== 'login') {
        this.stopAuthWatch();
        return;
      }
      if (stamp() !== before && !this.signingIn && !this.canceling && !this.pendingCancellation) {
        this.stopAuthWatch();
        this.log('codex: external login detected, restarting');
        void this.retry();
      }
    }, this.options.authPollMs ?? 2000);
    this.authTimer.unref?.();
  }
  private stopAuthWatch() {
    if (this.authTimer) {
      clearInterval(this.authTimer);
      this.authTimer = null;
    }
  }

  private onExit(
    proc: AppServerProcess,
    peer: RpcPeer,
    exit: { code: number | null; signal: NodeJS.Signals | null },
  ) {
    peer.close(`Codex exited (code ${exit.code ?? exit.signal ?? '?'}).`);
    if (this.proc !== proc) return; // replaced or stopped on purpose
    this.stats.exits++;
    this.proc = null;
    this.peer = null;
    this.chatGPTAccount = false;
    if (this.signingIn)
      this.finishSignIn('error', 'ChatGPT sign-in was interrupted. Try signing in again.');
    else ++this.authAttempt;
    this.stopAuthWatch();
    const why = `Codex stopped unexpectedly (exit ${exit.code ?? exit.signal ?? '?'}).`;
    this.log(`codex: ${why} ${proc.stderrTail().split('\n').pop() ?? ''}`);
    this.record('exit', { code: exit.code, signal: exit.signal, stderr: proc.stderrTail() });
    this.failAll({
      message: `${why} It restarts by itself; send the request again.`,
      code: 'crashed',
    });
    this.failed(why, proc.stderrTail());
  }

  private failed(detail: string, stderr: string) {
    if (this.stopped) return;
    this.failures++;
    const last = stderr.split('\n').filter(Boolean).pop();
    if (this.failures > this.restartPolicy.maxFailures) {
      this.setStatus({
        state: 'error',
        detail: `${detail}${last ? ` (${last.slice(0, 160)})` : ''}`,
        fix: 'Run `npm run doctor` to see why, then click the Codex status to retry.',
      });
      return;
    }
    const delay = Math.min(
      this.restartPolicy.maxMs,
      this.restartPolicy.baseMs * 2 ** (this.failures - 1),
    );
    this.setStatus({
      state: 'starting',
      detail: `${detail} Restarting in ${Math.round(delay / 1000)} s…`,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
    this.restartTimer.unref?.();
  }

  private async shutdown(reason: string) {
    this.stopAuthWatch();
    const proc = this.proc,
      peer = this.peer;
    this.proc = null;
    this.peer = null;
    this.booting = null;
    this.chatGPTAccount = false;
    if (this.signingIn)
      this.finishSignIn('error', 'ChatGPT sign-in was interrupted. Try signing in again.');
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
    const s = this.status;
    if (s.state === 'login')
      return { message: 'Codex is not signed in.', code: 'login', fix: s.fix };
    if (s.state === 'starting')
      return { message: 'Codex is still starting; try again in a moment.', code: 'starting' };
    return { message: s.detail ?? 'Codex is not available.', code: s.state, fix: s.fix };
  }

  /**
   * Start a turn (in a new thread, or going on with the saved `thread`). Progress and the final `done` go to
   * `sink`. `context` (den-kit's notes) and `images` come with the person's text.
   */
  startTurn(
    request: {
      key: string;
      text: string;
      context?: string;
      thread?: string;
      instructions: string;
      images?: string[];
    },
    sink: TurnSink,
  ) {
    const started = Date.now();
    const fail = (error: LlmError) =>
      sink.event({ kind: 'done', status: 'failed', error, ms: Date.now() - started });
    const peer = this.peer;
    if (!this.ready || !peer) return fail(this.unavailable());
    if (this.turns.has(request.key))
      return fail({ message: 'This request is already running.', code: 'duplicate' });
    if (this.turns.size >= (this.options.maxTurns ?? MAX_TURNS))
      return fail({
        message:
          'Several LLM requests are already running; wait for one to finish or stop it (Esc).',
        code: 'busy',
      });
    let thread = request.thread ? this.threads.get(request.thread) : undefined;
    if (thread?.turn)
      return fail({
        message: 'This conversation is still working on the previous request.',
        code: 'busy',
      });
    const turn: TurnState = {
      key: request.key,
      sink,
      thread: null,
      turnId: null,
      started,
      begun: false,
      stopRequested: false,
      interruptSent: false,
      steers: [],
      calls: new Map(),
      agents: new Set(),
      questions: new Set(),
      error: null,
      tools: 0,
      done: false,
      settleTimer: null,
      retryTimer: null,
      idleTimer: null,
    };
    this.turns.set(request.key, turn);
    this.stats.turns++;
    void (async () => {
      try {
        // A saved conversation that is not open here (the app restarted): open it again.
        if (!thread && request.thread) {
          try {
            const r = await peer.request<ThreadStartResponse>(
              'thread/resume',
              resumeParams({
                threadId: request.thread,
                model: this.modelId,
                cwd: this.workdir,
                instructions: request.instructions,
                mcp: this.options.mcp,
              }),
              { timeoutMs: this.timeouts.requestMs },
            );
            thread = { id: r.thread.id, turn: null, generation: this.generation };
            this.threads.set(thread.id, thread);
            sink.event({ kind: 'thread', thread: thread.id, fresh: false });
          } catch (error) {
            this.log(
              `codex: thread/resume failed (${describeRpcError(error)}); a new conversation starts`,
            );
            this.record('resume-failed', { message: describeRpcError(error) });
          }
          if (turn.done) return;
        }
        if (!thread) {
          const r = await peer.request<ThreadStartResponse>(
            'thread/start',
            threadStartParams({
              model: this.modelId,
              cwd: this.workdir,
              instructions: request.instructions,
              mcp: this.options.mcp,
            }),
            { timeoutMs: this.timeouts.requestMs },
          );
          if (turn.done) {
            peer
              .request(
                'thread/unsubscribe',
                { threadId: r.thread.id },
                { timeoutMs: this.timeouts.requestMs },
              )
              .catch(() => {});
            return;
          }
          thread = { id: r.thread.id, turn: null, generation: this.generation };
          this.threads.set(thread.id, thread);
          if (r.instructionSources?.length) {
            this.log(`codex: instruction files were loaded: ${r.instructionSources.join(', ')}`);
            this.record('instruction-sources', { sources: r.instructionSources });
            sink.event({
              kind: 'activity',
              what: 'warning',
              detail: `Codex also loaded ${r.instructionSources.length} instruction file(s) from CODEX_HOME.`,
            });
          }
          sink.event({ kind: 'thread', thread: thread.id, fresh: !!request.thread });
        }
        if (turn.stopRequested) {
          this.finish(turn, 'interrupted');
          return;
        }
        turn.thread = thread;
        thread.turn = turn;
        this.progress(turn);
        const effort = this.effort();
        const r = await peer.request<TurnStartResponse>(
          'turn/start',
          {
            threadId: thread.id,
            input: userInput(request.text, request.images, request.context),
            ...(effort ? { effort } : {}),
          },
          { timeoutMs: this.timeouts.requestMs },
        );
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
  steer(
    request: { key: string; target: string; text: string; context?: string; images?: string[] },
    sink: TurnSink,
  ) {
    const turn = this.turns.get(request.target);
    if (!turn || turn.done || turn.stopRequested || !this.peer) {
      sink.event({
        kind: 'done',
        status: 'failed',
        error: { message: 'That request has already finished.', code: 'not-steerable' },
        ms: 0,
      });
      return;
    }
    const steer = {
      key: request.key,
      text: request.text,
      context: request.context,
      images: request.images,
      sink,
    };
    if (!turn.turnId) {
      turn.steers.push(steer);
      return;
    }
    this.sendSteer(turn, steer);
  }

  private sendSteer(
    turn: TurnState,
    steer: { key: string; text: string; context?: string; images?: string[]; sink: TurnSink },
  ) {
    const peer = this.peer;
    if (!peer || !turn.thread || !turn.turnId || turn.done) {
      steer.sink.event({
        kind: 'done',
        status: 'failed',
        error: { message: 'That request has already finished.', code: 'not-steerable' },
        ms: 0,
      });
      return;
    }
    peer
      .request(
        'turn/steer',
        {
          threadId: turn.thread.id,
          input: userInput(steer.text, steer.images, steer.context),
          expectedTurnId: turn.turnId,
        },
        { timeoutMs: this.timeouts.requestMs },
      )
      .then(() => steer.sink.event({ kind: 'steered', target: turn.key }))
      .catch(error =>
        steer.sink.event({
          kind: 'done',
          status: 'failed',
          error: { message: describeRpcError(error), code: 'not-steerable' },
          ms: 0,
        }),
      );
  }

  /** Stop a running request. Codex confirms with an interrupted turn; if it does not, the request ends here anyway. */
  stopTurn(key: string, reason?: string) {
    const turn = this.turns.get(key);
    if (!turn || turn.done || turn.stopRequested) return;
    turn.stopRequested = true;
    this.clearTurnWait(turn);
    turn.stopReason = reason;
    for (const [callId, call] of turn.calls) {
      clearTimeout(call.timer);
      this.calls.delete(callId);
      call.answer(failure('The user stopped this request.'));
    }
    turn.calls.clear();
    // The request's own turn and each sub-agent's: interrupting one does not stop the others.
    this.interrupt(turn);
    for (const id of turn.agents) {
      const agent = this.agents.get(id);
      if (agent) this.interruptAgent(agent);
    }
    turn.settleTimer = setTimeout(() => {
      if (turn.done) return;
      // Codex did not confirm: do not reuse the thread (a new turn/start would steer the old turn).
      if (turn.thread) this.dropThread(turn.thread);
      this.finish(turn, 'interrupted', reason ? { message: reason } : undefined);
    }, this.timeouts.settleMs);
    turn.settleTimer.unref?.();
  }

  private interrupt(turn: TurnState) {
    if (turn.interruptSent || !turn.thread || !turn.turnId || !turn.begun || !this.peer) return;
    turn.interruptSent = true;
    // Never awaited for flow: interrupting a turn that has just ended can take ~10 s to answer.
    this.peer
      .request(
        'turn/interrupt',
        { threadId: turn.thread.id, turnId: turn.turnId },
        { timeoutMs: this.timeouts.interruptMs },
      )
      .catch(error => this.log(`codex: turn/interrupt: ${describeRpcError(error)}`));
  }

  private interruptAgent(agent: SubAgent) {
    if (agent.ended || agent.interruptSent || !agent.begun || !agent.turnId || !this.peer) return;
    agent.interruptSent = true;
    this.peer
      .request(
        'turn/interrupt',
        { threadId: agent.id, turnId: agent.turnId },
        { timeoutMs: this.timeouts.interruptMs },
      )
      .catch(error => this.log(`codex: turn/interrupt (sub-agent): ${describeRpcError(error)}`));
  }

  /** The answer to a Codex question (item/tool/requestUserInput). `owner` limits it to the asking tab's requests. */
  answer(
    questionKey: string,
    answers: Record<string, string[]>,
    owner?: (turnKey: string) => boolean,
  ): boolean {
    const q = this.questions.get(questionKey);
    if (!q || (owner && !owner(q.turn.key))) return false;
    this.questions.delete(questionKey);
    q.turn.questions.delete(questionKey);
    if (q.timer) clearTimeout(q.timer);
    this.peer?.respond(q.rpcId, {
      answers: Object.fromEntries(
        Object.entries(answers).map(([id, list]) => [id, { answers: list }]),
      ),
    });
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
    call.answer({
      success: output.success,
      text: output.text || (output.success ? 'OK' : 'Failed.'),
      // Pictures go only to a model that takes them.
      ...(output.imageDataUrl && this.statusValue.images
        ? { imageDataUrl: output.imageDataUrl }
        : {}),
    });
    this.armIdleWait(turn);
    return true;
  }

  /** Tool calls still waiting for the browser (re-sent after the tab reconnects). */
  pendingToolCalls(
    key: string,
  ): Array<{ callId: string; tool: string; args: unknown; agent?: string }> {
    const turn = this.turns.get(key);
    return turn
      ? [...turn.calls].map(([callId, c]) => ({
          callId,
          tool: c.tool,
          args: c.args,
          ...(c.agent ? { agent: c.agent } : {}),
        }))
      : [];
  }

  /** den-kit's tools, as its MCP server offers them. */
  tools(): ToolSpec[] {
    return toolsFor();
  }

  /** Where den-kit's MCP server is; a change restarts Codex, which reads the token at start. */
  useMcp(mcp: { url: string; token: string }) {
    const changed = this.options.mcp?.url !== mcp.url || this.options.mcp?.token !== mcp.token;
    this.options.mcp = mcp;
    if (changed && this.peer) void this.retry();
  }

  /**
   * One of den-kit's tools, called through MCP by the agent whose conversation is `thread`: the request's own
   * AI or one of its sub-agents. It runs in the tab that started the request; the answer goes back to MCP.
   */
  mcpCall(thread: string | undefined, tool: string, args: unknown): Promise<ToolOutput> {
    const agent = thread ? this.agents.get(thread) : undefined;
    const turn = agent ? agent.turn : thread ? this.turnOf(thread) : null;
    if (!turn || turn.done || agent?.ended)
      return Promise.resolve(failure('This request is over; the tool was not run.'));
    if (turn.stopRequested)
      return Promise.resolve(failure('The user stopped this request; do not continue.'));
    this.progress(turn);
    const names = this.tools().map(t => t.name);
    if (!names.includes(tool))
      return Promise.resolve(failure(`Unknown tool "${tool}". Use only: ${names.join(', ')}.`));
    const callId = `call-${++this.serial}`;
    turn.tools++;
    this.stats.toolCalls++;
    return new Promise<ToolOutput>(answer => {
      const timer = setTimeout(
        () => {
          if (!turn.calls.has(callId)) return;
          turn.calls.delete(callId);
          this.calls.delete(callId);
          answer(failure('den-kit did not answer in time (is the editor tab still open?).'));
          this.stopTurn(turn.key, 'The editor did not answer a tool call in time.');
        },
        toolDeadlineMs(tool, args, this.timeouts.toolMs),
      );
      timer.unref?.();
      const by = agent ? { agent: agent.id } : {};
      turn.calls.set(callId, { answer, timer, tool, args, ...by });
      this.calls.set(callId, turn);
      turn.sink.toolCall({ callId, tool, args, ...by });
    });
  }

  /** Whether a request is still running. */
  running(key: string) {
    return this.turns.has(key);
  }

  /** What was said in a saved conversation (the person's words and the AI's messages); null when it cannot be read. */
  async conversation(threadId: string): Promise<ConversationLine[] | null> {
    const peer = this.peer;
    if (!this.ready || !peer) return null;
    const lines: ConversationLine[] = [];
    try {
      let cursor: string | null = null;
      for (let page = 0; page < 50; page++) {
        const r: ThreadItemsListResponse = await peer.request<ThreadItemsListResponse>(
          'thread/items/list',
          { threadId, cursor, limit: 200 },
          { timeoutMs: this.timeouts.requestMs },
        );
        for (const { item } of r.data) {
          if (item.type === 'userMessage') {
            // The person's words are the last text input (den-kit's notes come first).
            const texts = ((item.content as UserInput[] | undefined) ?? []).filter(
              (c): c is Extract<UserInput, { type: 'text' }> => c.type === 'text',
            );
            const words = texts.at(-1)?.text;
            if (words) lines.push({ who: 'person', text: words });
          } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text)
            lines.push({ who: 'ai', text: item.text });
        }
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      return lines;
    } catch (error) {
      this.log(`codex: thread/items/list failed (${describeRpcError(error)})`);
      return null;
    }
  }

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
    if (thread.generation === this.generation)
      this.peer
        ?.request(
          'thread/unsubscribe',
          { threadId: thread.id },
          { timeoutMs: this.timeouts.requestMs },
        )
        .catch(() => {
          /* gone already */
        });
  }

  private finish(
    turn: TurnState,
    status: 'completed' | 'interrupted' | 'failed',
    error?: LlmError,
  ) {
    if (turn.done) return;
    turn.done = true;
    this.clearTurnWait(turn);
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    for (const [callId, call] of turn.calls) {
      clearTimeout(call.timer);
      this.calls.delete(callId);
      call.answer(failure('This request is over; the tool was not run.'));
    }
    turn.calls.clear();
    // Its sub-agents end with it.
    for (const id of turn.agents) {
      const agent = this.agents.get(id);
      if (agent) this.interruptAgent(agent);
      this.agents.delete(id);
    }
    for (const key of turn.questions) {
      const q = this.questions.get(key);
      if (q?.timer) clearTimeout(q.timer);
      this.questions.delete(key);
    }
    for (const steer of turn.steers.splice(0))
      steer.sink.event({
        kind: 'done',
        status: 'failed',
        error: { message: 'That request has already finished.', code: 'not-steerable' },
        ms: 0,
      });
    if (turn.thread && turn.thread.turn === turn) turn.thread.turn = null;
    this.turns.delete(turn.key);
    const ms = Date.now() - turn.started;
    this.record('done', {
      key: turn.key,
      thread: turn.thread?.id,
      status,
      ms,
      tools: turn.tools,
      error: error?.code ?? error?.message,
    });
    turn.sink.event({ kind: 'done', status, ...(error ? { error } : {}), ms });
  }

  /** KIT_CODEX_EFFORT, except "ultra": that runs sub-agents by Codex's own rules, outside den-kit's limits. */
  private effort(): string | undefined {
    const effort = this.options.effort?.trim();
    if (!effort) return undefined;
    if (effort.toLowerCase() === 'ultra') {
      if (!this.warnedUltra) {
        this.warnedUltra = true;
        this.log(
          "codex: KIT_CODEX_EFFORT=ultra is not sent (it runs sub-agents by Codex's own rules, outside den-kit's limits). Using the model's default effort.",
        );
      }
      return undefined;
    }
    return effort;
  }
  private warnedUltra = false;

  private clearTurnWait(turn: TurnState) {
    if (turn.retryTimer) clearTimeout(turn.retryTimer);
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    turn.retryTimer = null;
    turn.idleTimer = null;
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
      if (turn.calls.size || turn.questions.size) {
        this.armIdleWait(turn);
        return;
      }
      this.failTurn(turn, {
        code: 'response-timeout',
        message: 'ChatGPT stopped responding.',
        fix: 'Check your connection and send the request again.',
      });
    }, this.timeouts.idleMs);
    turn.idleTimer.unref?.();
  }

  private retrying(turn: TurnState, error?: TurnError) {
    if (turn.done || turn.stopRequested) return;
    turn.sink.event({ kind: 'retrying', message: error?.message ?? 'Retrying…' });
    // Repeated failure notifications do not extend the same connection attempt.
    if (turn.retryTimer) return;
    turn.retryTimer = setTimeout(
      () =>
        this.failTurn(turn, {
          code: 'connection-timeout',
          message: 'ChatGPT could not reconnect.',
          fix: 'Check your connection and send the request again.',
        }),
      this.timeouts.retryMs,
    );
    turn.retryTimer.unref?.();
  }

  // ---- from Codex ------------------------------------------------------------------------------
  private turnOf(threadId: unknown): TurnState | null {
    return typeof threadId === 'string' ? (this.threads.get(threadId)?.turn ?? null) : null;
  }

  /** The request's AI started a sub-agent, or one finished (subAgentActivity items on the request's conversation). */
  private subAgentActivity(turn: TurnState, item: Record<string, unknown>) {
    const id = item.agentThreadId;
    if (typeof id !== 'string' || !id) return;
    const known = this.agents.get(id);
    if (item.kind === 'started' && !known) {
      const agent: SubAgent = {
        id,
        name: agentName(item.agentPath),
        turn,
        turnId: null,
        begun: false,
        ended: false,
        interruptSent: false,
      };
      this.agents.set(id, agent);
      turn.agents.add(id);
      this.record('sub-agent', { key: turn.key, agent: id, name: agent.name });
      turn.sink.event({ kind: 'agent', agent: id, name: agent.name, state: 'started' }, id);
    } else if (known && (item.kind === 'completed' || item.kind === 'interrupted'))
      this.endAgent(known, item.kind);
  }

  private endAgent(agent: SubAgent, status: 'completed' | 'interrupted' | 'failed') {
    if (agent.ended) return;
    agent.ended = true;
    agent.turn.sink.event(
      { kind: 'agent', agent: agent.id, name: agent.name, state: 'ended', status },
      agent.id,
    );
  }

  /** What happens in a sub-agent's own conversation: its turn, its messages, its tokens. */
  private onAgentNotification(agent: SubAgent, method: string, p: Record<string, unknown>) {
    const turn = agent.turn;
    if (turn.done) return;
    switch (method) {
      case 'turn/started': {
        const id = (p as unknown as TurnNotification).turn?.id;
        if (!id) return;
        agent.turnId = id;
        agent.begun = true;
        // Esc before the sub-agent started: stop it now.
        if (turn.stopRequested) this.interruptAgent(agent);
        return;
      }
      case 'turn/completed': {
        const n = p as unknown as TurnNotification;
        if (agent.turnId && n.turn?.id && n.turn.id !== agent.turnId) return;
        this.progress(turn);
        this.endAgent(
          agent,
          n.turn?.status === 'interrupted'
            ? 'interrupted'
            : n.turn?.status === 'failed'
              ? 'failed'
              : 'completed',
        );
        return;
      }
      case 'item/started': {
        this.progress(turn);
        if ((p as unknown as ItemNotification).item?.type === 'reasoning')
          turn.sink.event({ kind: 'activity', what: 'thinking' }, agent.id);
        return;
      }
      case 'item/completed': {
        this.progress(turn);
        const item = (p as unknown as ItemNotification).item as { type?: string; text?: unknown };
        if (item?.type === 'agentMessage' && typeof item.text === 'string')
          turn.sink.event({ kind: 'message', text: item.text }, agent.id);
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.progress(turn);
        return;
      case 'thread/tokenUsage/updated': {
        const n = p as unknown as ThreadTokenUsageUpdatedNotification;
        if (n.tokenUsage?.total && n.tokenUsage.last)
          turn.sink.event(
            {
              kind: 'usage',
              total: tokens(n.tokenUsage.total),
              last: tokens(n.tokenUsage.last),
              window:
                typeof n.tokenUsage.modelContextWindow === 'number'
                  ? n.tokenUsage.modelContextWindow
                  : null,
            },
            agent.id,
          );
        return;
      }
    }
  }

  private onRequest(peer: RpcPeer, request: RpcRequest) {
    if (peer !== this.peer) return;
    const params = (
      request.params && typeof request.params === 'object' ? request.params : {}
    ) as Record<string, unknown>;
    switch (request.method) {
      case 'item/tool/requestUserInput':
        this.onQuestion(peer, request.id, params as unknown as ToolRequestUserInputParams);
        return;
      case 'currentTime/read':
        peer.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
    }
    if (Object.hasOwn(DECLINE, request.method)) {
      peer.respond(request.id, DECLINE[request.method]);
      this.stats.declined++;
      this.record('declined', {
        method: request.method,
        command: typeof params.command === 'string' ? params.command.slice(0, 200) : undefined,
      });
      this.turnOf(params.threadId)?.sink.event({
        kind: 'activity',
        what: 'blocked',
        detail:
          request.method.includes('command') || request.method === 'execCommandApproval'
            ? 'a shell command'
            : request.method.includes('file') || request.method === 'applyPatchApproval'
              ? 'a file change'
              : request.method.includes('permissions')
                ? 'extra permissions'
                : 'an MCP request',
      });
      return;
    }
    this.record('unsupported-request', { method: request.method });
    peer.respondError(
      request.id,
      RPC_METHOD_NOT_FOUND,
      `den-kit does not support ${request.method}.`,
    );
  }

  private onQuestion(peer: RpcPeer, rpcId: RequestId, params: ToolRequestUserInputParams) {
    const turn = this.turnOf(params.threadId);
    if (!turn || turn.done || (turn.turnId && params.turnId !== turn.turnId)) {
      peer.respond(rpcId, { answers: {} });
      return;
    }
    this.progress(turn);
    const key = `q${++this.serial}`;
    const items: LlmQuestion[] = (Array.isArray(params.questions) ? params.questions : [])
      .slice(0, 4)
      .map(q => ({
        id: String(q.id),
        header: String(q.header ?? ''),
        question: String(q.question ?? ''),
        options: (q.options ?? []).map(o => String(o.label)).slice(0, 8),
        other: !!q.isOther,
      }));
    // Non-blocking questions resolve themselves with no answer, as Codex expects.
    const timer = params.isBlocking
      ? null
      : setTimeout(() => this.answer(key, {}), params.autoResolutionMs ?? 60000);
    timer?.unref?.();
    this.questions.set(key, { key, rpcId, turn, timer });
    turn.questions.add(key);
    turn.sink.event({ kind: 'question', question: key, items, blocking: !!params.isBlocking });
  }

  private onNotification(notification: RpcNotification) {
    const p = (
      notification.params && typeof notification.params === 'object' ? notification.params : {}
    ) as Record<string, unknown>;
    const agent = typeof p.threadId === 'string' ? this.agents.get(p.threadId) : undefined;
    if (agent) {
      this.onAgentNotification(agent, notification.method, p);
      return;
    }
    const currentTurn = this.turnOf(p.threadId);
    if (typeof p.turnId === 'string' && currentTurn?.turnId && p.turnId !== currentTurn.turnId)
      return;
    switch (notification.method) {
      case 'turn/started': {
        const t = this.turnOf(p.threadId);
        const n = p as unknown as TurnNotification;
        if (!t || !n.turn?.id) return;
        t.turnId ??= n.turn.id;
        if (n.turn.id !== t.turnId) return;
        t.begun = true;
        // Esc before Codex started the turn: interrupt it now.
        if (t.stopRequested) this.interrupt(t);
        return;
      }
      case 'turn/completed': {
        const n = p as unknown as TurnNotification;
        const t = this.turnOf(n.threadId);
        if (!t || (t.turnId && n.turn?.id && n.turn.id !== t.turnId)) return;
        const status =
          n.turn?.status === 'interrupted'
            ? 'interrupted'
            : n.turn?.status === 'failed'
              ? 'failed'
              : 'completed';
        if (status === 'failed')
          this.finish(
            t,
            'failed',
            explainCodexError(
              n.turn?.error ?? t.error,
              `Run \`${LOGIN_COMMAND}\` again, then retry.`,
            ),
          );
        else
          this.finish(
            t,
            status,
            status === 'interrupted' && t.stopReason ? { message: t.stopReason } : undefined,
          );
        return;
      }
      case 'item/started': {
        const n = p as unknown as ItemNotification;
        const t = this.turnOf(n.threadId);
        if (!t || !n.item) return;
        if (n.item.type !== 'userMessage') this.progress(t);
        if (n.item.type === 'subAgentActivity') this.subAgentActivity(t, n.item);
        else if (n.item.type === 'reasoning') t.sink.event({ kind: 'activity', what: 'thinking' });
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
        if (
          t &&
          n.item?.type === 'agentMessage' &&
          typeof (n.item as { text?: unknown }).text === 'string'
        )
          t.sink.event({ kind: 'message', text: (n.item as { text: string }).text });
        return;
      }
      case 'item/agentMessage/delta': {
        const n = p as unknown as AgentMessageDeltaNotification;
        const t = this.turnOf(n.threadId);
        if (t && typeof n.delta === 'string') {
          this.progress(t);
          t.sink.event({ kind: 'delta', text: n.delta });
        }
        return;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const t = this.turnOf(p.threadId);
        if (t) {
          this.progress(t);
          t.sink.event({ kind: 'activity', what: 'thinking' });
        }
        return;
      }
      case 'error': {
        const n = p as unknown as ErrorNotification;
        const t = this.turnOf(n.threadId);
        if (!t) return;
        if (n.willRetry) this.retrying(t, n.error);
        else
          this.failTurn(
            t,
            explainCodexError(
              n.error,
              this.options.loginInstruction ?? `Run \`${LOGIN_COMMAND}\` again, then retry.`,
            ),
          );
        return;
      }
      case 'serverRequest/resolved': {
        const n = p as unknown as ServerRequestResolvedNotification;
        for (const q of this.questions.values())
          if (q.rpcId === n.requestId) {
            this.questions.delete(q.key);
            q.turn.questions.delete(q.key);
            if (q.timer) clearTimeout(q.timer);
            q.turn.sink.event({ kind: 'question.resolved', question: q.key });
          }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const n = p as unknown as ThreadTokenUsageUpdatedNotification;
        const t = this.turnOf(n.threadId);
        if (t) this.progress(t);
        if (t && n.tokenUsage?.total && n.tokenUsage.last)
          t.sink.event({
            kind: 'usage',
            total: tokens(n.tokenUsage.total),
            last: tokens(n.tokenUsage.last),
            window:
              typeof n.tokenUsage.modelContextWindow === 'number'
                ? n.tokenUsage.modelContextWindow
                : null,
          });
        return;
      }
      case 'account/rateLimits/updated':
        this.updateRateLimit((p as { rateLimits?: RateLimitSnapshot }).rateLimits);
        return;
      case 'account/login/completed': {
        if (typeof p.loginId === 'string')
          this.loginCompleted({
            loginId: p.loginId,
            success: p.success === true,
            ...(p.error ? { error: String(p.error) } : {}),
          });
        return;
      }
      case 'account/updated':
        void this.refreshAccount(true);
        return;
      case 'thread/closed': {
        const id = p.threadId;
        if (typeof id === 'string') {
          const thread = this.threads.get(id);
          if (thread?.turn)
            this.finish(thread.turn, 'failed', {
              message: 'Codex closed the conversation.',
              code: 'closed',
            });
          this.threads.delete(id);
        }
        return;
      }
      case 'warning':
      case 'configWarning':
      case 'deprecationNotice': {
        const message = String(p.message ?? p.summary ?? '').slice(0, 300);
        if (message && !/bubblewrap|PATH aliases/i.test(message)) {
          this.log(`codex ${notification.method}: ${message}`);
          this.record('warning', { method: notification.method, message });
        }
        return;
      }
      default:
        return;
    }
  }
}

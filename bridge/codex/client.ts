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
import type { CodexStatus, LlmError, LlmEvent, LlmQuestion, ToolOutput } from '../../src/ai/protocol.ts';
import { KIT_TOOLS, type ToolSpec } from '../../src/ai/llm-spec.ts';
import type { Telemetry } from '../telemetry.ts';
import { RpcClosed, RpcError, RpcPeer, RpcTimeout } from './rpc.ts';
import { codexHome, codexWorkdir, isProblem, LOGIN_COMMAND, resolveCodex, spawnAppServer, type AppServerProcess, type CodexCommand } from './process.ts';
import {
  CODEX_VERSION, DECLINE, EXPECTED_ITEMS, RPC_METHOD_NOT_FOUND, explainCodexError,
  type AgentMessageDeltaNotification, type DynamicToolCallParams, type DynamicToolCallResponse, type ErrorNotification, type GetAccountRateLimitsResponse,
  type GetAccountResponse, type InitializeResponse, type ItemNotification, type Model, type ModelListResponse, type RateLimitSnapshot, type RequestId,
  type RpcNotification, type RpcRequest, type ServerRequestResolvedNotification, type ThreadStartParams, type ThreadStartResponse, type ToolRequestUserInputParams,
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
  /** Tools registered on every thread (doctor --deep uses a ping tool). */
  tools?: ToolSpec[];
  telemetry?: Telemetry;
  log?: (line: string) => void;
  /** Every JSON-RPC line in and out (doctor --deep records the real conversation). */
  trace?: (direction: 'in' | 'out', line: string) => void;
  timeouts?: Partial<Timeouts>;
  restart?: Partial<{ baseMs: number; maxMs: number; maxFailures: number }>;
  authPollMs?: number;
  maxTurns?: number;
}
interface Timeouts {
  /** First start creates CODEX_HOME state and can take several seconds. */
  initializeMs: number;
  requestMs: number;
  /** The browser answers tool calls (compile ≤ 20 s, render ≤ 45 s). */
  toolMs: number;
  interruptMs: number;
  /** After a stop, how long to wait for Codex to confirm before ending the request here. */
  settleMs: number;
}

interface ThreadState { id: string; turn: TurnState | null; generation: number }
interface TurnState {
  key: string;
  sink: TurnSink;
  thread: ThreadState | null;
  turnId: string | null;
  started: number;
  stopRequested: boolean;
  interruptSent: boolean;
  stopReason?: string;
  steers: Array<{ key: string; text: string; sink: TurnSink }>;
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

const text = (value: string): UserInput => ({ type: 'text', text: value, text_elements: [] });
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
  private modelId: string | null = null;
  private threads = new Map<string, ThreadState>();
  private turns = new Map<string, TurnState>();
  private calls = new Map<string, TurnState>();
  private questions = new Map<string, Question>();
  private serial = 0;
  readonly home: { path: string; isolated: boolean };
  readonly workdir: string;
  readonly tools: ToolSpec[];
  private readonly toolNames: Set<string>;
  private readonly options: CodexClientOptions;
  private readonly timeouts: Timeouts;
  private readonly restartPolicy: { baseMs: number; maxMs: number; maxFailures: number };
  readonly stats = { boots: 0, exits: 0, turns: 0, toolCalls: 0, declined: 0, unexpectedItems: 0, malformed: 0 };

  constructor(options: CodexClientOptions) {
    this.options = options;
    const env = options.env ?? process.env;
    this.home = options.home ?? codexHome(options.kitRoot, env);
    this.workdir = options.workdir ?? codexWorkdir(options.kitRoot);
    this.tools = options.tools ?? KIT_TOOLS;
    this.toolNames = new Set(this.tools.map(t => t.name));
    this.timeouts = { initializeMs: 30000, requestMs: 20000, toolMs: 90000, interruptMs: 8000, settleMs: 10000, ...options.timeouts };
    this.restartPolicy = { baseMs: 1000, maxMs: 30000, maxFailures: 5, ...options.restart };
  }

  get status(): CodexStatus { return { ...this.statusValue }; }
  get ready() { return this.statusValue.state === 'ok' && !!this.peer; }
  onStatus(listener: (status: CodexStatus) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Start (or keep) the app-server; resolves when the state settles (ok, login or error). */
  start(): Promise<void> {
    this.stopped = false;
    if (this.peer || this.restartTimer) return this.booting ?? Promise.resolve();
    this.booting = this.boot().finally(() => { this.booting = null; });
    return this.booting;
  }

  /** Restart now (after signing in, after an error); requests in flight fail. */
  async retry() {
    this.failures = 0;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    await this.shutdown('Codex is restarting.');
    return this.start();
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

  private async boot() {
    if (this.stopped) return;
    this.setStatus({ state: 'starting', detail: 'Starting Codex…' });
    const command = this.options.command ?? resolveCodex(this.options.kitRoot, this.options.env);
    if (isProblem(command)) { this.setStatus({ state: 'error', detail: command.error, fix: command.fix }); return; }
    if (command.source === 'kit' && command.version !== CODEX_VERSION) {
      this.setStatus({ state: 'error', detail: `Codex ${command.version} is installed; den-kit is pinned to ${CODEX_VERSION}.`, fix: 'Run `npm run kit:setup` from the repo root.' });
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
      onNotification: notification => this.onNotification(notification),
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
      const model = this.chooseModel(models?.data ?? []);
      const base = { model: model.label, images: model.images };
      this.record('boot', { generation, ms: Date.now() - started, userAgent: init.userAgent, home: this.home.isolated ? 'kit/.codex-home' : 'custom', account: account.account?.type ?? null, model: model.label });
      if (!account.account && account.requiresOpenaiAuth !== false) {
        this.setStatus({ state: 'login', detail: 'Codex is not signed in.', fix: `Run \`${LOGIN_COMMAND}\` once in another terminal (it opens ChatGPT sign-in); den-kit picks it up by itself.`, ...base });
        this.watchAuth();
        return;
      }
      this.failures = 0;
      const plan = account.account?.type === 'chatgpt' ? account.account.planType : account.account?.type;
      this.setStatus({ state: 'ok', ...(plan ? { plan } : {}), ...base, rateLimit: null });
      void peer.request<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined, { timeoutMs: this.timeouts.requestMs })
        .then(r => this.updateRateLimit(r.rateLimits)).catch(() => { /* optional */ });
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
      if (stamp() !== before) { this.stopAuthWatch(); this.log('codex: login detected, restarting'); void this.retry(); }
    }, this.options.authPollMs ?? 2000);
    this.authTimer.unref?.();
  }
  private stopAuthWatch() { if (this.authTimer) { clearInterval(this.authTimer); this.authTimer = null; } }

  private onExit(proc: AppServerProcess, peer: RpcPeer, exit: { code: number | null; signal: NodeJS.Signals | null }) {
    peer.close(`Codex exited (code ${exit.code ?? exit.signal ?? '?'}).`);
    if (this.proc !== proc) return; // replaced or stopped on purpose
    this.stats.exits++;
    this.proc = null; this.peer = null;
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
      this.setStatus({ state: 'error', detail: `${detail}${last ? ` (${last.slice(0, 160)})` : ''}`, fix: 'Run `npm run kit:doctor` to see why, then click the Codex status to retry.' });
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

  /** Start a turn (in a new thread, or continuing `thread`). Progress and the final `done` go to `sink`. */
  startTurn(request: { key: string; text: string; thread?: string; instructions: string }, sink: TurnSink) {
    const started = Date.now();
    const fail = (error: LlmError) => sink.event({ kind: 'done', status: 'failed', error, ms: Date.now() - started });
    const peer = this.peer;
    if (!this.ready || !peer) return fail(this.unavailable());
    if (this.turns.has(request.key)) return fail({ message: 'This request is already running.', code: 'duplicate' });
    if (this.turns.size >= (this.options.maxTurns ?? 3)) return fail({ message: 'Several LLM requests are already running; wait for one to finish or stop it (Esc).', code: 'busy' });
    let thread = request.thread ? this.threads.get(request.thread) : undefined;
    if (thread?.turn) return fail({ message: 'This conversation is still working on the previous request.', code: 'busy' });
    const turn: TurnState = { key: request.key, sink, thread: null, turnId: null, started, stopRequested: false, interruptSent: false, steers: [], calls: new Map(), questions: new Set(), error: null, tools: 0, done: false, settleTimer: null };
    this.turns.set(request.key, turn);
    this.stats.turns++;
    void (async () => {
      try {
        if (!thread) {
          const r = await peer.request<ThreadStartResponse>('thread/start', this.threadParams(request.instructions), { timeoutMs: this.timeouts.requestMs });
          if (turn.done) { peer.request('thread/unsubscribe', { threadId: r.thread.id }, { timeoutMs: this.timeouts.requestMs }).catch(() => {}); return; }
          thread = { id: r.thread.id, turn: null, generation: this.generation };
          this.threads.set(thread.id, thread);
          if (r.instructionSources?.length) {
            this.log(`codex: instruction files were loaded: ${r.instructionSources.join(', ')}`);
            this.record('instruction-sources', { sources: r.instructionSources });
            sink.event({ kind: 'activity', what: 'warning', detail: `Codex also loaded ${r.instructionSources.length} instruction file(s) from CODEX_HOME.` });
          }
          sink.event({ kind: 'thread', thread: thread.id, fresh: !!request.thread });
        }
        if (turn.stopRequested) { this.finish(turn, 'interrupted'); return; }
        turn.thread = thread;
        thread.turn = turn;
        const effort = this.options.effort?.trim();
        const r = await peer.request<TurnStartResponse>('turn/start', { threadId: thread.id, input: [text(request.text)], ...(effort ? { effort } : {}) }, { timeoutMs: this.timeouts.requestMs });
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

  /** Add text to a running request's turn. The steer request ends with `steered`, or a failed `done` (then send it as a new request). */
  steer(request: { key: string; target: string; text: string }, sink: TurnSink) {
    const turn = this.turns.get(request.target);
    if (!turn || turn.done || turn.stopRequested || !this.peer) { sink.event({ kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 }); return; }
    if (!turn.turnId) { turn.steers.push({ key: request.key, text: request.text, sink }); return; }
    this.sendSteer(turn, { key: request.key, text: request.text, sink });
  }

  private sendSteer(turn: TurnState, steer: { key: string; text: string; sink: TurnSink }) {
    const peer = this.peer;
    if (!peer || !turn.thread || !turn.turnId || turn.done) { steer.sink.event({ kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 }); return; }
    peer.request('turn/steer', { threadId: turn.thread.id, input: [text(steer.text)], expectedTurnId: turn.turnId }, { timeoutMs: this.timeouts.requestMs })
      .then(() => steer.sink.event({ kind: 'steered', target: turn.key }))
      .catch(error => steer.sink.event({ kind: 'done', status: 'failed', error: { message: describeRpcError(error), code: 'not-steerable' }, ms: 0 }));
  }

  /** Stop a running request. Codex confirms with an interrupted turn; if it does not, the request ends here anyway. */
  stopTurn(key: string, reason?: string) {
    const turn = this.turns.get(key);
    if (!turn || turn.done || turn.stopRequested) return;
    turn.stopRequested = true;
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

  private threadParams(instructions: string): ThreadStartParams {
    return {
      ...(this.modelId ? { model: this.modelId } : {}),
      cwd: this.workdir,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      environments: [],
      config: THREAD_CONFIG,
      developerInstructions: instructions,
      dynamicTools: this.tools.map(t => ({ type: 'function', name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
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
    if (!turn || turn.done) { peer.respond(rpcId, failure('This request is over; the tool was not run.')); return; }
    if (turn.stopRequested) { peer.respond(rpcId, failure('The user stopped this request; do not continue.')); return; }
    if (params.namespace || !this.toolNames.has(params.tool)) { peer.respond(rpcId, failure(`Unknown tool "${params.tool}". Use only: ${[...this.toolNames].join(', ')}.`)); return; }
    const callId = typeof params.callId === 'string' && params.callId ? params.callId : `call-${++this.serial}`;
    if (this.calls.has(callId)) { peer.respond(rpcId, failure('Duplicate tool call id.')); return; }
    turn.tools++;
    this.stats.toolCalls++;
    const timer = setTimeout(() => {
      if (!turn.calls.has(callId)) return;
      turn.calls.delete(callId); this.calls.delete(callId);
      peer.respond(rpcId, failure('den-kit did not answer in time (is the editor tab still open?).'));
      this.stopTurn(turn.key, 'The editor did not answer a tool call in time.');
    }, this.timeouts.toolMs);
    timer.unref?.();
    turn.calls.set(callId, { rpcId, timer, tool: params.tool, args: params.arguments });
    this.calls.set(callId, turn);
    turn.sink.toolCall({ callId, tool: params.tool, args: params.arguments });
  }

  private onQuestion(peer: RpcPeer, rpcId: RequestId, params: ToolRequestUserInputParams) {
    const turn = this.turnOf(params.threadId);
    if (!turn || turn.done) { peer.respond(rpcId, { answers: {} }); return; }
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
        if (t && n.item?.type === 'agentMessage' && typeof (n.item as { text?: unknown }).text === 'string') t.sink.event({ kind: 'message', text: (n.item as { text: string }).text });
        return;
      }
      case 'item/agentMessage/delta': { const n = p as unknown as AgentMessageDeltaNotification; const t = this.turnOf(n.threadId); if (t && typeof n.delta === 'string') t.sink.event({ kind: 'delta', text: n.delta }); return; }
      case 'error': {
        const n = p as unknown as ErrorNotification;
        const t = this.turnOf(n.threadId);
        if (!t) return;
        if (n.willRetry) t.sink.event({ kind: 'retrying', message: n.error?.message ?? 'Retrying…' });
        else t.error = n.error ?? null;
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
      case 'account/rateLimits/updated': this.updateRateLimit((p as { rateLimits?: RateLimitSnapshot }).rateLimits); return;
      case 'account/updated': if (this.statusValue.state === 'login') void this.retry(); return;
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

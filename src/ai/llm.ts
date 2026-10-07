// The LLM path (layer 2). A request goes to Codex through the bridge; Codex
// works on the live patch with the kit_* tools, which run here in the browser
// (src/ai/llm-workspace.ts). Each edit is tried on a copy first; one that
// validates and compiles lands at once, so the user sees and hears the request
// being built. The steps of one request undo together (one ⌘Z). The user keeps
// playing and editing meanwhile; an edit that no longer fits goes back to Codex.
//
// One turn runs at a time. Another request that needs the LLM while it works
// is steered into the running turn; follow-ups continue the same conversation.
// Esc stops it (what already landed stays, ⌘Z takes it back). Loading another
// patch, or undoing the request's edit while it runs, stops it too. Codex never
// gets to ask the user: questions are answered empty and it decides itself.
import { ref, watch } from 'vue';
import type { KitSession } from '../editor/session.ts';
import { randomId } from '../core/schema.ts';
import { CompileClient, CompileFailure, compileInputs, type WorkerLike } from '../compile/compile-client.ts';
import { RenderClient, type RenderWorkerLike } from '../compile/render-client.ts';
import type { BridgeClient, LlmInbound } from './bridge-client.ts';
import type { FastPath, Outcome } from './fast-path.ts';
import { developerInstructions } from './llm-spec.ts';
import { LlmWorkspace, type WorkspaceDeps } from './llm-workspace.ts';
import type { LlmEvent, ToolOutput } from './protocol.ts';
import CompilerWorker from '../compile/compiler.worker.ts?worker';

export type LlmTransport = Pick<BridgeClient, 'llmStart' | 'llmSteer' | 'llmStop' | 'llmAnswer' | 'llmForget' | 'toolResult' | 'onLlm' | 'telemetry' | 'status' | 'codexReady' | 'online'>;

export interface LlmOptions {
  /** Replace workspace dependencies (tests). */
  deps?: Partial<WorkspaceDeps>;
  createCompileWorker?: () => WorkerLike;
  createRenderWorker?: () => RenderWorkerLike;
  /** After Esc, how long to wait for Codex to confirm before ending the request here. */
  stopGraceMs?: number;
}

interface Turn {
  id: string;
  line: Outcome;
  ws: LlmWorkspace;
  started: number;
  epoch: number;
  calls: Map<string, Promise<ToolOutput>>;
  message: string;
  tools: number;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** Why it was stopped by something other than Esc. */
  stopNote?: string;
}

const MAX_STEPS = 12;
const TOOL_ACTIVITY: Record<string, string> = {
  kit_get_patch: 'reading the patch…', kit_list_blocks: 'looking up modules…', kit_describe_block: 'looking up a module…',
  kit_apply_ops: 'editing…', kit_write_codebox: 'writing code…', kit_listen: 'listening…', kit_finish: 'finishing…',
};
const TOOL_DONE: Record<string, string> = { kit_get_patch: 'read the patch', kit_list_blocks: 'looked up modules', kit_describe_block: 'looked up a module' };
const KEPT = 'What it already changed stays; ⌘Z takes it back.';

export class LlmController {
  /** A turn is running (Esc stops it). */
  readonly busy = ref(false);
  private turn: Turn | null = null;
  /** Requests waiting for the running turn to end (a steer that came too late). */
  private queue: Outcome[] = [];
  private steering = new Map<string, Outcome>();
  private thread: string | null = null;
  /** The loaded patch the conversation is about (session.loadEpoch); a new patch starts a new conversation. */
  private threadEpoch: number | null = null;
  private compiler: CompileClient | null = null;
  private renderer: RenderClient | null = null;
  readonly session: KitSession;
  private readonly fast: FastPath;
  private readonly bridge: LlmTransport;
  private readonly options: LlmOptions;
  private readonly stopWatching: Array<() => void> = [];

  constructor(session: KitSession, fast: FastPath, bridge: LlmTransport, options: LlmOptions = {}) {
    this.session = session;
    this.fast = fast;
    this.bridge = bridge;
    this.options = options;
    bridge.onLlm(m => this.inbound(m));
    // Another patch was loaded: the request was about the old one.
    this.stopWatching.push(watch(() => session.loadEpoch.value, () => { if (this.turn) this.stop('A different patch was loaded, so it stopped.'); }, { flush: 'sync' }));
    // ⌘Z on what the running request just did: the user does not want it to go on.
    this.stopWatching.push(session.onHistory((kind, tx) => {
      if (kind === 'undo' && tx.author.kind === 'ai-llm' && this.turn && tx.author.take === this.turn.id) this.stop('You undid its edit, so it stopped.');
    }));
  }

  get ready() { return this.bridge.codexReady; }
  get off() { const c = this.bridge.status.value?.codex; return !this.bridge.online || !c || c.state === 'off'; }
  get running() { return this.turn !== null; }

  /** Why the LLM cannot take a request right now. */
  reason(): string {
    if (!this.bridge.online) return 'The LLM is not available: the AI bridge is not connected.';
    const c = this.bridge.status.value?.codex;
    if (!c || c.state === 'off') return `The LLM is off${c?.detail ? `: ${c.detail}` : '.'}`;
    if (c.state === 'login') return `The LLM is not available: Codex is not signed in. ${c.fix ?? 'Run `npm run kit:codex:login`.'}`;
    if (c.state === 'starting') return 'The LLM is still starting; try again in a moment.';
    return `The LLM is not available: ${c.detail ?? 'Codex reported an error'}.${c.fix ? ` ${c.fix}` : ''}`;
  }

  /** Send a request straight to the LLM (Shift+Enter). Always returns its history line. */
  run(text: string, options: { via?: 'typed' | 'voice' } = {}): Outcome {
    const line: Outcome = { id: randomId('rq'), text: text.trim().slice(0, 600), via: options.via, status: 'thinking', route: 'llm', ms: 0 };
    const taken = this.take(line);
    if (taken) return taken;
    const failed: Outcome = { ...line, status: 'failed', message: this.reason() };
    this.fast.upsert(failed);
    return failed;
  }

  /** Take over a prompt line the fast path could not handle; null when the LLM is not available. */
  take(line: Outcome): Outcome | null {
    if (!line.text || !this.ready) return null;
    if (this.turn && !this.turn.stopping) return this.steer(line);
    if (this.turn) { const waiting = { ...line, status: 'thinking' as const, route: 'llm' as const, live: true, message: 'waits for the running request to stop…' }; this.queue.push(waiting); this.fast.upsert(waiting); return waiting; }
    return this.start(line);
  }

  /** Esc: stop the running turn; what already landed stays (⌘Z takes it back). */
  stop(note?: string): boolean {
    const turn = this.turn;
    if (!turn || turn.stopping) return false;
    turn.stopping = true;
    turn.stopNote = note;
    this.update(turn, { activity: 'stopping…' });
    if (!this.bridge.online || !this.bridge.llmStop(turn.id)) { this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); return true; }
    turn.stopTimer = setTimeout(() => { if (this.turn === turn) this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); }, this.options.stopGraceMs ?? 15000);
    return true;
  }

  /** Forget the conversation (the next request starts a new one). */
  reset() {
    if (this.thread) this.bridge.llmForget(this.thread);
    this.thread = null; this.threadEpoch = null;
  }

  dispose() {
    for (const stop of this.stopWatching) stop();
    this.compiler?.dispose(); this.renderer?.dispose(); this.compiler = null; this.renderer = null;
  }

  // ---- turns ----------------------------------------------------------------------------
  private start(line: Outcome): Outcome {
    if (this.threadEpoch !== null && this.threadEpoch !== this.session.loadEpoch.value) this.reset();
    const epoch = this.session.loadEpoch.value;
    const turn: Turn = {
      id: line.id, ws: new LlmWorkspace(this.deps(line.id, epoch)), started: performance.now(), epoch,
      line: { ...line, status: 'thinking', route: 'llm', live: true, steps: [], activity: 'starting…', message: undefined },
      calls: new Map(), message: '', tools: 0, stopping: false, stopTimer: null,
    };
    this.turn = turn;
    this.busy.value = true;
    this.fast.upsert(turn.line);
    // Instructions are sent every time: a bridge that lost the conversation starts a new one with them.
    if (!this.bridge.llmStart(turn.id, this.compose(line.text), developerInstructions(this.blocks()), this.thread ?? undefined)) {
      this.finish(turn, { kind: 'done', status: 'failed', error: { message: 'The AI bridge is not connected.' }, ms: 0 });
    }
    return turn.line;
  }

  private steer(line: Outcome): Outcome {
    const target = this.turn!;
    const steer: Outcome = { ...line, status: 'thinking', route: 'llm', live: true, message: 'adding this to the running request…' };
    this.steering.set(steer.id, steer);
    this.fast.upsert(steer);
    if (!this.bridge.llmSteer(steer.id, target.id, this.compose(line.text, true))) this.later(steer);
    return steer;
  }

  /** Run after the current turn (a steer that arrived as it ended). */
  private later(line: Outcome) {
    this.steering.delete(line.id);
    const waiting: Outcome = { ...line, status: 'thinking', live: true, message: 'waits for the running request…' };
    this.queue.push(waiting);
    this.fast.upsert(waiting);
    if (!this.turn) this.next();
  }

  private next() {
    const line = this.queue.shift();
    if (!line) return;
    if (!this.ready) { this.fast.upsert({ ...line, status: 'failed', live: false, message: this.reason() }); this.next(); return; }
    this.start(line);
  }

  /** The request text with what Codex should know about the moment it was made. */
  private compose(text: string, steering = false): string {
    const doc = this.session.doc.value;
    const selected = this.session.selection.value.map(id => doc.nodes[id]).filter(Boolean).map(n => `${n!.id} (${this.session.catalog.find(n!.type)?.title ?? n!.type}${n!.label ? ` "${n!.label}"` : ''})`);
    const context = steering ? '[den-kit] The user adds, while you work:' : `[den-kit] You edit the live patch; each edit that checks out lands at once${this.thread ? '. It may have changed since your last turn, so read it again' : ''}.${selected.length ? ` Selected: ${selected.join(', ')}.` : ''}`;
    return `${context}\n\n${text}`;
  }

  private blocks(): string {
    return this.session.catalog.list().filter(d => d.kind !== 'comment').map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`).join('\n');
  }

  /** What the workspace of turn `id` may do; landing works only while that turn runs, on the patch it started on. */
  private deps(id: string, epoch: number): WorkspaceDeps {
    return {
      catalog: this.session.catalog,
      images: !!this.bridge.status.value?.codex.images,
      read: () => this.session.doc.value,
      land: (intents, label) => {
        const turn = this.turn;
        if (!turn || turn.id !== id || turn.stopping) return { ok: false, message: 'This request was stopped.' };
        if (this.session.loadEpoch.value !== epoch) return { ok: false, message: 'A different patch was loaded.' };
        const r = this.session.commit(intents, { author: { kind: 'ai-llm', take: id, trace: id }, label: `AI: ${label}`, group: id });
        if (!r.ok) return { ok: false, message: `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''} (the user may have changed the patch meanwhile).` };
        if (!turn.line.txId && r.ops.length) this.update(turn, { txId: this.session.history.peek()?.id });
        return { ok: true };
      },
      compile: async (generated, doc) => {
        try {
          const artifact = await this.checkCompiler().compile(generated, compileInputs(doc, generated));
          this.session.compiler.prime(artifact); // the live patch then swaps it in without compiling again
          return { ok: true, ms: artifact.compileMs };
        } catch (error) {
          if (error instanceof CompileFailure) return { ok: false, message: error.message, issues: error.issues };
          return { ok: false, message: error instanceof Error ? error.message : String(error), issues: [] };
        }
      },
      render: request => this.checkRenderer().render(request),
      ...this.options.deps,
    };
  }

  // Edits are checked and rendered on their own workers, so the live patch never waits for them.
  private checkCompiler(): CompileClient {
    this.compiler ??= new CompileClient({ createWorker: this.options.createCompileWorker ?? (() => new CompilerWorker() as unknown as WorkerLike) });
    return this.compiler;
  }
  private checkRenderer(): RenderClient {
    this.renderer ??= new RenderClient({ createWorker: this.options.createRenderWorker ?? (() => new CompilerWorker() as unknown as RenderWorkerLike) });
    return this.renderer;
  }

  // ---- from the bridge -------------------------------------------------------------------
  private inbound(m: LlmInbound) {
    if (m.t === 'welcome') {
      // Back after a disconnect: a request the bridge no longer knows was lost (the bridge restarted);
      // what was being added to it runs as new requests. Otherwise the missed messages follow.
      const turn = this.turn;
      if (turn && !m.running.includes(turn.id)) {
        const steers = [...this.steering.values()];
        this.steering.clear();
        this.queue.unshift(...steers.map(line => ({ ...line, message: 'waits for the running request…' })));
        this.finish(turn, { kind: 'done', status: 'failed', error: { message: 'The AI bridge restarted and lost this request. Send it again.' }, ms: 0 });
      }
      return;
    }
    if (m.t === 'error') { if (this.turn && m.ref === this.turn.id) this.update(this.turn, { note: m.message }); return; }
    if (m.t === 'tool.call') { if (this.turn?.id === m.id) void this.toolCall(this.turn, m.callId, m.tool, m.args); return; }
    const steer = this.steering.get(m.id);
    if (steer) { this.steerEvent(steer, m.event); return; }
    if (this.turn?.id === m.id) this.event(this.turn, m.event);
  }

  private steerEvent(line: Outcome, event: LlmEvent) {
    if (event.kind === 'steered') {
      this.steering.delete(line.id);
      this.fast.upsert({ ...line, status: 'merged', live: false, message: '→ added to the running request' });
      if (this.turn) this.step(this.turn, `you added: “${line.text.slice(0, 60)}”`);
    } else if (event.kind === 'done') this.later(line); // the turn ended first: run it next
  }

  private async toolCall(turn: Turn, callId: string, tool: string, args: unknown) {
    let pending = turn.calls.get(callId);
    if (!pending) { pending = this.runTool(turn, tool, args); turn.calls.set(callId, pending); }
    const output = await pending;
    if (this.turn === turn) this.bridge.toolResult(turn.id, callId, output);
  }

  private async runTool(turn: Turn, tool: string, args: unknown): Promise<ToolOutput> {
    turn.tools++;
    this.update(turn, { activity: TOOL_ACTIVITY[tool] ?? `${tool}…` });
    const before = turn.ws.steps.length;
    const output = await turn.ws.call(tool, args);
    if (this.turn !== turn) return output;
    const added = turn.ws.steps.slice(before);
    const step = added.length ? added.join(' · ') : TOOL_DONE[tool] ?? (output.success ? '' : `${tool} failed`);
    if (tool === 'kit_finish' && turn.ws.summary) this.update(turn, { label: turn.ws.summary });
    if (step) this.step(turn, step);
    this.update(turn, { activity: 'thinking…' });
    return output;
  }

  private event(turn: Turn, event: LlmEvent) {
    switch (event.kind) {
      case 'thread':
        this.thread = event.thread; this.threadEpoch = turn.epoch;
        if (event.fresh) this.step(turn, 'started a new conversation (the earlier one was lost)');
        return;
      case 'started': this.update(turn, { activity: 'thinking…' }); return;
      case 'delta': turn.message += event.text; this.update(turn, { reply: tail(turn.message) }); return;
      case 'message': turn.message = ''; this.update(turn, { reply: tail(event.text) }); return;
      case 'activity':
        if (event.what === 'thinking') this.update(turn, { activity: 'thinking…' });
        else this.step(turn, event.what === 'blocked' ? `blocked ${event.detail ?? 'a request'} (den-kit allows only its own tools)` : `${event.what}${event.detail ? `: ${event.detail}` : ''}`);
        return;
      case 'retrying': this.update(turn, { activity: `reconnecting to the model… (${event.message})` }); return;
      case 'question':
        // Nobody is asked to choose: an empty answer, and Codex decides itself.
        this.bridge.llmAnswer(turn.id, event.question, {});
        this.step(turn, 'skipped a question (it decides itself)');
        return;
      case 'question.resolved': return;
      case 'steered': return;
      case 'done': this.finish(turn, event); return;
    }
  }

  private finish(turn: Turn, done: Extract<LlmEvent, { kind: 'done' }>) {
    if (this.turn !== turn) return;
    this.turn = null;
    this.busy.value = false;
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    const ms = Math.round(performance.now() - turn.started);
    const ws = turn.ws;
    const landed = ws.landed > 0;
    const label = ws.summary ?? (landed ? describeSteps(ws.steps) : undefined);
    if (done.status === 'completed') this.close(turn, { status: landed ? 'applied' : 'reply', ms, label });
    else if (done.status === 'interrupted') this.close(turn, { status: 'stopped', ms, label: landed ? label : undefined, message: turn.stopNote ?? (done.error?.message ? `Stopped: ${done.error.message}` : 'Stopped.'), note: landed ? KEPT : 'Nothing was changed.' });
    else this.close(turn, { status: 'failed', ms, label: landed ? label : undefined, message: done.error?.message ?? 'The LLM request failed.', fix: done.error?.fix, note: landed ? KEPT : undefined });
    this.next();
  }

  private close(turn: Turn, patch: Partial<Outcome>) {
    const line: Outcome = { ...turn.line, live: false, activity: undefined, ...patch };
    turn.line = line;
    this.fast.upsert(line);
    this.bridge.telemetry({ kind: 'llm', id: turn.id, text: line.text, status: line.status, ms: line.ms, tools: turn.tools, landed: turn.ws.landed, steps: line.steps, message: line.message });
  }

  private step(turn: Turn, text: string) { this.update(turn, { steps: [...(turn.line.steps ?? []), text].slice(-MAX_STEPS) }); }

  private update(turn: Turn, patch: Partial<Outcome>) {
    if (this.turn !== turn) return;
    turn.line = { ...turn.line, ...patch, ms: Math.round(performance.now() - turn.started) };
    this.fast.upsert(turn.line);
  }
}

const tail = (text: string) => text.length > 700 ? `…${text.slice(-700)}` : text;
function describeSteps(steps: string[]): string {
  const edits = steps.filter(s => !/^(read|looked|listened|skipped|you added|started)/.test(s) && !/not applied$/.test(s));
  return edits.length ? edits.slice(-2).join(' · ').replace(/ ✓/g, '').slice(0, 120) : 'LLM edit';
}

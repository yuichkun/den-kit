// The LLM path (layer 2). A request goes to Codex through the bridge; Codex
// edits a draft copy of the patch with the kit_* tools, which run here in the
// browser (src/ai/llm-workspace.ts). When its turn ends the draft lands on the
// live patch as one `ai-llm` transaction, so ⌘Z takes the whole LLM edit back.
// The user keeps playing and editing meanwhile; where both changed the same
// thing, the user's version wins and the history line says so.
//
// One turn runs at a time. Another request that needs the LLM while it works
// is steered into the running turn; follow-ups continue the same conversation.
// Esc stops it (nothing is applied). Progress, the model's words, questions
// (buttons) and the result all live on the request's line in the prompt history.
import { ref } from 'vue';
import type { KitSession } from '../editor/session.ts';
import type { Author } from '../core/history.ts';
import { rebase } from '../core/rebase.ts';
import { randomId } from '../core/schema.ts';
import { CompileClient, CompileFailure, compileInputs, type WorkerLike } from '../compile/compile-client.ts';
import { RenderClient, type RenderWorkerLike } from '../compile/render-client.ts';
import type { BridgeClient, LlmInbound } from './bridge-client.ts';
import type { FastPath, Outcome, PromptAction } from './fast-path.ts';
import { developerInstructions } from './llm-spec.ts';
import { DraftWorkspace, type WorkspaceDeps } from './llm-workspace.ts';
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
  ws: DraftWorkspace;
  started: number;
  epoch: number;
  calls: Map<string, Promise<ToolOutput>>;
  message: string;
  tools: number;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

const MAX_STEPS = 12;
const TOOL_ACTIVITY: Record<string, string> = {
  kit_get_patch: 'reading the patch…', kit_list_blocks: 'looking up modules…', kit_describe_block: 'looking up a module…',
  kit_apply_ops: 'editing the draft…', kit_write_codebox: 'writing code…', kit_listen: 'listening…', kit_ask: 'asking…', kit_finish: 'finishing…',
};
const TOOL_DONE: Record<string, string> = { kit_get_patch: 'read the patch', kit_list_blocks: 'looked up modules', kit_describe_block: 'looked up a module' };

export class LlmController {
  /** A turn is running (Esc stops it). */
  readonly busy = ref(false);
  private turn: Turn | null = null;
  /** Requests waiting for the running turn to end (a steer that came too late). */
  private queue: Outcome[] = [];
  private steering = new Map<string, Outcome>();
  /** A finished turn whose draft was not applied (it did not compile): "Apply anyway". */
  private parked: Turn | null = null;
  private thread: string | null = null;
  /** The loaded patch the conversation is about (session.loadEpoch); a new patch starts a new conversation. */
  private threadEpoch: number | null = null;
  private compiler: CompileClient | null = null;
  private renderer: RenderClient | null = null;
  readonly session: KitSession;
  private readonly fast: FastPath;
  private readonly bridge: LlmTransport;
  private readonly options: LlmOptions;

  constructor(session: KitSession, fast: FastPath, bridge: LlmTransport, options: LlmOptions = {}) {
    this.session = session;
    this.fast = fast;
    this.bridge = bridge;
    this.options = options;
    bridge.onLlm(m => this.inbound(m));
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

  /** Send a request straight to the LLM (Shift+Enter, a follow-up button). Always returns its history line. */
  run(text: string, options: { via?: 'typed' | 'voice' } = {}): Outcome {
    const line: Outcome = { id: randomId('rq'), text: text.trim().slice(0, 600), via: options.via, status: 'thinking', route: 'llm', ms: 0, chips: [] };
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

  /** Esc: stop the running turn; nothing of it is applied. */
  stop(): boolean {
    const turn = this.turn;
    if (!turn || turn.stopping) return false;
    turn.stopping = true;
    this.update(turn, { activity: 'stopping…' });
    if (!this.bridge.online || !this.bridge.llmStop(turn.id)) { this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); return true; }
    turn.stopTimer = setTimeout(() => { if (this.turn === turn) this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); }, this.options.stopGraceMs ?? 15000);
    return true;
  }

  /** A button on an LLM line. */
  act(action: PromptAction, line: Outcome) {
    switch (action.kind) {
      case 'send': this.run(action.value ?? '', { via: 'typed' }); return;
      case 'ask-llm': this.run(line.text, { via: line.via }); return;
      case 'stop': this.stop(); return;
      case 'answer': {
        if (!this.turn || !action.question || !action.item) return;
        this.bridge.llmAnswer(this.turn.id, action.question, { [action.item]: [action.value ?? ''] });
        this.update(this.turn, { actions: [], message: undefined });
        return;
      }
      case 'apply-anyway': {
        const parked = this.parked;
        if (!parked || parked.id !== line.id) { this.session.toast('warn', 'That draft is no longer available.'); return; }
        this.parked = null;
        this.land(parked, Math.round(performance.now() - parked.started), true);
        return;
      }
    }
  }

  /** Forget the conversation (the next request starts a new one). */
  reset() {
    if (this.thread) this.bridge.llmForget(this.thread);
    this.thread = null; this.threadEpoch = null;
  }

  dispose() { this.compiler?.dispose(); this.renderer?.dispose(); this.compiler = null; this.renderer = null; }

  // ---- turns ----------------------------------------------------------------------------
  private start(line: Outcome): Outcome {
    const doc = this.session.doc.value;
    if (this.threadEpoch !== null && this.threadEpoch !== this.session.loadEpoch.value) this.reset();
    const turn: Turn = {
      id: line.id, ws: new DraftWorkspace(doc, this.deps()), started: performance.now(), epoch: this.session.loadEpoch.value,
      line: { ...line, status: 'thinking', route: 'llm', live: true, steps: [], activity: 'starting…', message: undefined, actions: [{ label: 'Stop', kind: 'stop' }] },
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
    const context = steering ? '[den-kit] The user adds, while you work:' : `[den-kit] Your draft is a copy of the live patch as it is now${this.thread ? '; it may have changed since your last turn, so read it again' : ''}.${selected.length ? ` Selected: ${selected.join(', ')}.` : ''}`;
    return `${context}\n\n${text}`;
  }

  private blocks(): string {
    return this.session.catalog.list().filter(d => d.kind !== 'comment').map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`).join('\n');
  }

  private deps(): WorkspaceDeps {
    return {
      catalog: this.session.catalog,
      images: !!this.bridge.status.value?.codex.images,
      compile: async (generated, doc) => {
        try {
          const artifact = await this.draftCompiler().compile(generated, compileInputs(doc, generated));
          this.session.compiler.prime(artifact); // landing this draft then swaps in without compiling again
          return { ok: true, ms: artifact.compileMs };
        } catch (error) {
          if (error instanceof CompileFailure) return { ok: false, message: error.message, issues: error.issues };
          return { ok: false, message: error instanceof Error ? error.message : String(error), issues: [] };
        }
      },
      render: request => this.draftRenderer().render(request),
      ...this.options.deps,
    };
  }

  // Drafts compile and render on their own workers, so the live patch never waits for them.
  private draftCompiler(): CompileClient {
    this.compiler ??= new CompileClient({ createWorker: this.options.createCompileWorker ?? (() => new CompilerWorker() as unknown as WorkerLike) });
    return this.compiler;
  }
  private draftRenderer(): RenderClient {
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
      case 'question': {
        const item = event.items[0];
        if (!item) return;
        const actions: PromptAction[] = item.options.map(o => ({ label: o, kind: 'answer', question: event.question, item: item.id, value: o }));
        this.update(turn, { message: item.question || item.header, actions: [...actions, { label: 'Stop', kind: 'stop' }] });
        return;
      }
      case 'question.resolved': this.update(turn, { message: undefined, actions: [{ label: 'Stop', kind: 'stop' }] }); return;
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
    if (done.status === 'completed') {
      if (this.session.loadEpoch.value !== turn.epoch && ws.changed) this.close(turn, { status: 'failed', ms, message: 'A different patch was loaded meanwhile, so the LLM’s edit was not applied.' });
      else if (!ws.changed) {
        const question = ws.question;
        this.close(turn, { status: question ? 'chips' : 'reply', ms, label: ws.summary ?? undefined, message: question?.text, actions: question ? question.options.map(o => ({ label: o, kind: 'send' as const, value: o })) : [] });
      } else if (ws.health !== 'ok') {
        this.parked = turn;
        this.close(turn, { status: 'failed', ms, message: `The LLM’s draft ${ws.health === 'silent' ? 'makes no sound' : 'does not compile'}, so it was not applied.`, note: ws.problem.split('\n').slice(0, 3).join(' '), actions: [{ label: 'Apply anyway', kind: 'apply-anyway' }] });
      } else this.land(turn, ms);
    } else if (done.status === 'interrupted') this.close(turn, { status: 'stopped', ms, message: done.error?.message ? `Stopped: ${done.error.message}` : 'Stopped. Nothing was changed.' });
    else this.close(turn, { status: 'failed', ms, message: done.error?.message ?? 'The LLM request failed.', fix: done.error?.fix });
    this.next();
  }

  /** Carry the draft over to the live patch as one undoable step. */
  private land(turn: Turn, ms: number, anyway = false) {
    const ws = turn.ws;
    const r = rebase(ws.base, ws.draft, this.session.doc.value, this.session.catalog);
    const conflicts = r.conflicts.map(c => `${c.what} — ${c.reason}`);
    if (!r.intents.length) { this.close(turn, { status: 'reply', ms, label: ws.summary ?? undefined, message: conflicts.length ? 'Nothing was applied: you changed the same things meanwhile.' : 'Nothing to change.', conflicts }); return; }
    const author: Author = { kind: 'ai-llm', take: turn.id, trace: turn.id };
    const label = ws.summary ?? describeSteps(ws.steps);
    const result = this.session.commit(r.intents, { author, label: `AI: ${label}` });
    if (!result.ok) { this.close(turn, { status: 'failed', ms, message: `Could not apply the LLM’s edit: ${result.error.message}` }); return; }
    const txId = result.ops.length ? this.session.history.peek()?.id : undefined;
    this.close(turn, { status: 'applied', ms, label, txId, conflicts, note: anyway ? 'applied although the draft did not compile' : undefined });
  }

  private close(turn: Turn, patch: Partial<Outcome>) {
    const line: Outcome = { ...turn.line, live: false, activity: undefined, actions: [], ...patch };
    turn.line = line;
    this.fast.upsert(line);
    this.bridge.telemetry({ kind: 'llm', id: turn.id, text: line.text, status: line.status, ms: line.ms, tools: turn.tools, steps: line.steps, conflicts: line.conflicts?.length ?? 0, message: line.message });
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
  const edits = steps.filter(s => !/^(compiled|compile error|listened|asked)/.test(s));
  return edits.length ? edits.slice(-2).join(' · ').slice(0, 120) : 'LLM edit';
}

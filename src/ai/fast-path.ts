// The fast path (layer 1, the default): lexicon → (if needed) one Jev request →
// deterministic plan → applied at once as one `ai-fast` transaction (⌘Z undoes
// it like any edit). Nobody is ever asked to pick an interpretation: when the
// fast path is not sure, or the request needs more than a plan, it goes to the
// LLM; without the LLM the line says why in one sentence. A patch that changed
// while Jev was thinking is asked about again. Every request leaves a
// RequestTrace (shown in the dev drawer and logged as JSONL).
//
// The lines belong to the conversation about the patch (session.conversation):
// they are saved with it, and a patch someone opens starts a new one (the old
// lines fold away as "earlier"). "もっと" / "more" repeats the last change the
// fast path made; "戻して" / "undo" takes the last AI change back. What the
// person attached (the selection) is what the request is aimed at.
import { reactive, shallowRef, ref, watch } from 'vue';
import type { KitSession } from '../editor/session.ts';
import type { Author } from '../core/history.ts';
import { randomId } from '../core/schema.ts';
import { fromPartView, partView } from '../core/parts.ts';
import { parseRequest } from './lexicon.ts';
import { buildFullRequest, buildTargetRequest, type BuiltRequest } from './jev-questions.ts';
import { readAnswers, type ReadAnswers } from './jev-answers.ts';
import {
  DEFAULT_ROUTER_SETTINGS, ambiguousTargets, availableAspects, decideFromJev, describeSelection, lexiconStage,
  type Decision, type RouteContext, type RouterSettings,
} from './router.ts';
import type { Plan } from './intents.ts';
import type { JevResult } from './protocol.ts';
import type { Attachment } from './attachments.ts';
import { SAVED_LINES, followUp, readSavedLines, savedLine } from './conversation.ts';

/** `budgetMs: null` = the bridge default (KIT_JEV_BUDGET_MS, else 1200 ms). */
export interface FastSettings extends RouterSettings { budgetMs: number | null; useJev: boolean }
/** working = fast path busy; thinking = the LLM works on it; merged = added to a running LLM request. */
export type OutcomeStatus = 'working' | 'applied' | 'nothing' | 'thinking' | 'reply' | 'stopped' | 'failed' | 'merged';
export type RouteKind = 'lexicon' | 'jev' | 'jev-target' | 'none' | 'llm';

/** What the fast path needs from the LLM path (src/ai/llm.ts). */
export interface LlmHandoff {
  readonly ready: boolean;
  /** Off on purpose (KIT_CODEX=off) or no bridge at all: not worth mentioning on every fast-path miss. */
  readonly off: boolean;
  /** Take over a line; null when the LLM is not available. */
  take(line: Outcome): Outcome | null;
  reason(): string;
}

export interface Outcome {
  id: string;
  text: string;
  /** How the request was given (shown in the history). */
  via?: 'typed' | 'voice';
  /** ⌘Z took this edit back. */
  undone?: boolean;
  status: OutcomeStatus;
  route: RouteKind;
  ms: number;
  jevMs?: number;
  label?: string;
  note?: string;
  message?: string;
  confidence?: number;
  txId?: string;
  // ---- LLM lines ----
  /** Still running (Esc stops it). */
  live?: boolean;
  /** What it is doing right now ("reading the patch…"). */
  activity?: string;
  /** Progress, oldest first ("+ lfo2, lfo2 → cut1.octaves · compiled ✓"). */
  steps?: string[];
  /** What the model said. */
  reply?: string;
  fix?: string;
  /** It changed the plugin screen (the panel offers to show it). */
  screen?: boolean;
  /** What the person pointed at (the selection when they asked). */
  attached?: Attachment[];
  /** "もっと" / "more": the request this line did again. */
  repeats?: string;
  /** Asked inside a part: which one, and the chain of uses it was entered through. */
  where?: { path: string[]; part: string; name: string };
}

export interface RequestTrace {
  kind: 'route';
  id: string;
  at: string;
  text: string;
  lang: 'ja' | 'en';
  lexicon: { items: number; full: boolean; leftover: string };
  jev?: { ok: boolean; ms: number; error?: string; asked: string[]; answers?: Record<string, { choice: string; confidence: number; agree: boolean }>; errors?: string[]; modelWarning?: string };
  decision: Decision['kind'] | 'error';
  route: RouteKind;
  confidence?: number;
  tau: number;
  plan?: string;
  /** Interpretations it weighed when it was not sure (for tuning; never shown as choices). */
  alternatives?: string[];
  stale?: boolean;
  applied: boolean;
  totalMs: number;
}

const MAX_TRACES = 30;
const MAX_HISTORY = 30;

export class FastPath {
  readonly settings = reactive<FastSettings>({ ...DEFAULT_ROUTER_SETTINGS, budgetMs: null, useJev: true });
  readonly outcome = shallowRef<Outcome | null>(null);
  /** Every request of this conversation in order (oldest first), as shown above the prompt. */
  readonly history = shallowRef<Outcome[]>([]);
  /** Lines of earlier conversations (other patches opened before), oldest first: shown folded; the AI does not see them. */
  readonly earlier = shallowRef<Outcome[]>([]);
  readonly traces = shallowRef<RequestTrace[]>([]);
  readonly busy = ref(false);
  private controller: AbortController | null = null;
  readonly session: KitSession;

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(session: KitSession) {
    this.session = session;
    // The conversation about this patch goes on after a reload.
    const saved = session.loadConversation();
    if (saved && saved.id === session.conversation.value) this.history.value = readSavedLines(saved.lines);
    // A patch someone opens starts a new conversation; the old lines fold away.
    watch(() => session.conversation.value, () => {
      this.earlier.value = [...this.earlier.value, ...this.history.value.map(savedLine)].slice(-60);
      this.history.value = [];
      this.outcome.value = null;
      this.persist();
    }, { flush: 'sync' });
    watch(this.history, () => {
      if (this.persistTimer) return;
      this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persist(); }, 250);
    });
    session.onHistory((kind, tx) => {
      if (tx.author.kind !== 'ai-fast' && tx.author.kind !== 'ai-llm') return;
      // ⌘Z on the AI edit: the result line no longer describes the patch. (An LLM request's line is found by its id.)
      const past = this.history.value.find(o => o.txId === tx.id || (tx.author.kind === 'ai-llm' && o.id === tx.author.take));
      if (kind === 'undo' && past && this.outcome.value?.id === past.id) this.outcome.value = null;
      if (past) this.remember({ ...past, undone: kind === 'undo' });
      this.session.bridge?.telemetry({ kind: kind === 'undo' ? 'undo' : 'redo', author: tx.author.kind, trace: tx.author.trace, label: tx.label });
    });
  }

  /** What a request is aimed at: its attachments (modules and controls), else the selection. */
  private aimed(attached?: readonly Attachment[]): string[] {
    const doc = this.session.doc.value;
    return attached ? attached.filter(a => a.kind !== 'cable' && doc.nodes[a.id]).map(a => a.id) : [...this.session.selection.value];
  }
  /** Plans see the place the person is working in: the main patch, or the inside of the part they went into. */
  private ctxFor(aim: readonly string[]): RouteContext { return { doc: partView(this.session.doc.value, this.session.partPath.value), catalog: this.session.catalog, selection: [...aim] }; }
  /** Inside a part, a request is about it: which part, and the chain of uses it was entered through. */
  where(): Outcome['where'] {
    const path = this.session.partPath.value, doc = this.session.doc.value;
    const part = path.length ? doc.nodes[path.at(-1)!]?.part : undefined;
    return part && doc.parts[part] ? { path: [...path], part, name: doc.parts[part]!.name } : undefined;
  }
  /** Save the conversation now (it is also saved shortly after every change). */
  persist() {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    this.session.saveConversation(this.history.value.slice(-SAVED_LINES).map(savedLine));
  }
  private get jevReady() { return this.settings.useJev && !!this.session.bridge?.jevReady; }

  private get llm(): LlmHandoff | null { return this.session.llm ?? null; }

  /** Show an outcome as the latest result and keep it in the history (by id). */
  private show(outcome: Outcome) { this.outcome.value = outcome; this.remember(outcome); }
  /** Add or update a history line (the LLM path updates its lines as it works). */
  upsert(outcome: Outcome) {
    const isNew = !this.history.value.some(o => o.id === outcome.id);
    this.remember(outcome);
    if (isNew || this.outcome.value?.id === outcome.id) this.outcome.value = outcome;
  }
  private remember(outcome: Outcome) {
    const list = this.history.value;
    const i = list.findIndex(o => o.id === outcome.id);
    this.history.value = i >= 0 ? [...list.slice(0, i), outcome, ...list.slice(i + 1)] : [...list, outcome].slice(-MAX_HISTORY);
  }

  async run(raw: string, options: { via?: 'typed' | 'voice'; /** What the person pointed at (default: the selection). */ attached?: Attachment[]; /** Internal: asked again because the patch changed meanwhile. */ again?: boolean } = {}): Promise<Outcome> {
    const text = raw.trim().slice(0, 600);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const id = randomId('rq');
    const attached = options.attached?.length ? options.attached : undefined;
    const where = this.where();
    const aim = this.aimed(options.attached);
    const ctx = () => this.ctxFor(aim);
    // "戻して" takes the last AI change back; "もっと" does the last fast change again.
    const follow = text ? followUp(text) : null;
    if (follow?.kind === 'undo') return this.undoLast(id, text, options.via, attached);
    let query = text, repeats: string | undefined;
    if (follow?.kind === 'more') {
      const last = [...this.history.value].reverse().find(o => o.status === 'applied' && o.route !== 'llm' && !o.undone);
      if (last) {
        repeats = last.repeats ?? last.text;
        query = follow.prefix && !/^(?:もっと|もう少し|少し|ちょっと|かなり|さらに)/.test(repeats) ? `${follow.prefix}${repeats}` : repeats;
      }
    }
    const lex = parseRequest(query, { screen: this.session.screenFocus.value });
    const trace: RequestTrace = { kind: 'route', id, at: new Date().toISOString(), text, lang: lex.lang, lexicon: { items: lex.items.length, full: lex.full, leftover: lex.leftover }, decision: 'nothing', route: 'none', tau: this.tau(lex.lang), applied: false, totalMs: 0 };
    const finish = (given: Decision, route: RouteKind, extra: Partial<Outcome> = {}): Outcome => {
      extra = { attached, repeats, where, ...extra };
      let decision = given;
      if (controller.signal.aborted && this.controller !== controller) {
        this.history.value = this.history.value.filter(o => o.id !== id); // replaced by the newer request
        return { id, text, status: 'nothing', route, ms: 0, message: 'Superseded by a newer request.' };
      }
      const ms = Math.round(performance.now() - started);
      // Not sure, or more than a plan can do: the LLM takes it when it is available; otherwise say why not.
      const unsure = decision.kind === 'chips' || decision.kind === 'escalate' || (decision.kind === 'nothing' && decision.llm);
      if (text && unsure) {
        if (decision.kind === 'chips') { trace.confidence = decision.confidence; trace.alternatives = decision.chips.map(c => c.label); }
        const handed = this.llm?.take({ id, text, via: options.via, status: 'thinking', route: 'llm', ms, jevMs: extra.jevMs, attached });
        trace.decision = decision.kind === 'chips' ? 'chips' : 'escalate';
        trace.totalMs = ms; trace.route = route;
        if (handed) { this.record(trace); this.busy.value = false; if (this.controller === controller) this.controller = null; return handed; }
        // Keep the fast path's own explanation; add why the LLM could not take it when that helps.
        const why = this.llm && (decision.kind !== 'nothing' || !this.llm.off) ? this.llm.reason() : '';
        const message = decision.kind === 'chips' || !('message' in decision) ? 'Not sure what to change; try saying it another way (e.g. “brighter”, “longer release”, “add reverb”).' : decision.message;
        decision = { kind: 'nothing', message: why ? `${message} ${why}` : message };
      }
      const outcome = this.realize(decision, { id, text, via: options.via, route, ms, ...extra }, trace);
      if (text && unsure) trace.decision = given.kind === 'chips' ? 'chips' : 'escalate';
      trace.totalMs = outcome.ms;
      trace.route = route;
      this.record(trace);
      this.show(outcome);
      this.busy.value = false;
      if (this.controller === controller) this.controller = null;
      return outcome;
    };
    if (!text) return finish({ kind: 'nothing', message: 'Type what you want, e.g. “brighter”, “longer release”, “add reverb”, “make a bass”.' }, 'none');
    this.busy.value = true;
    this.show({ id, text, via: options.via, status: 'working', route: 'none', ms: 0, attached, repeats, where });

    const before = this.snapshot();
    const stage = lexiconStage(lex, ctx());
    if (stage.kind === 'decided') return finish(stage.decision, 'lexicon');

    if (stage.kind === 'target') {
      if (!this.jevReady) return finish(stage.resolve(null), 'lexicon');
      const built = buildTargetRequest({ text: query, lang: lex.lang, selection: describeSelection(ctx()) }, stage.candidates, stage.word);
      const { result, read } = await this.ask(built, controller.signal, trace);
      if (controller.signal.aborted) return finish({ kind: 'nothing', message: 'Cancelled.' }, 'jev-target');
      if (!this.unchanged(before)) return this.again(raw, options, id, trace, controller);
      const t = read?.answers.target;
      const target = t && t.agree && t.confidence >= this.tau(lex.lang) && built.targetKeys[t.choice] ? built.targetKeys[t.choice]!.split('.') : null;
      return finish(stage.resolve(target ? [{ node: target[0]!, port: target[1]! }] : null), 'jev-target', { jevMs: result.ms, confidence: t?.confidence });
    }

    // Not fully understood by the lexicon: ask Jev everything at once.
    if (!this.jevReady) {
      const why = this.jevOffReason();
      return finish({ kind: 'nothing', message: `${why} Try phrases like “brighter”, “リリース長く”, “add reverb”, “ベース作って”.`, llm: true }, 'none');
    }
    const askCtx = ctx();
    const built = buildFullRequest({ text: query, lang: lex.lang, selection: describeSelection(askCtx), aspects: availableAspects(askCtx), targets: ambiguousTargets(askCtx) });
    const { result, read } = await this.ask(built, controller.signal, trace);
    if (controller.signal.aborted) return finish({ kind: 'nothing', message: 'Cancelled.' }, 'jev');
    if (!result.ok || !read) {
      const why = result.ok ? 'Jev gave no usable answer.' : `Jev: ${result.error.message}`;
      return finish({ kind: 'nothing', message: why, llm: true }, 'jev', { jevMs: result.ms });
    }
    const decision = decideFromJev(read, built, ctx(), lex.lang, this.settings, stage.fallback);
    if (!this.unchanged(before)) return this.again(raw, options, id, trace, controller);
    return finish(decision, 'jev', { jevMs: result.ms });
  }

  /** "戻して" / "undo": take the last change back when the AI made it (the person's own edits are theirs to undo). */
  private undoLast(id: string, text: string, via: 'typed' | 'voice' | undefined, attached: Attachment[] | undefined): Outcome {
    const base = { id, text, via, route: 'lexicon' as const, ms: 0, attached };
    const last = this.session.history.peek();
    let outcome: Outcome;
    if (!last) outcome = { ...base, status: 'nothing', message: 'There is nothing to take back yet.' };
    else if (last.author.kind !== 'ai-fast' && last.author.kind !== 'ai-llm') outcome = { ...base, status: 'nothing', message: `The last change was your own (${last.label}); ⌘Z takes it back.` };
    else {
      const tx = this.session.undo();
      outcome = { ...base, status: 'applied', label: `took back: ${(tx?.label ?? last.label).replace(/^AI: /, '')}` };
    }
    this.controller = null;
    this.busy.value = false;
    this.show(outcome);
    return outcome;
  }

  /** The patch changed while Jev was thinking: ask again about the patch as it is now (once; then the LLM takes it). */
  private again(raw: string, options: { via?: 'typed' | 'voice'; attached?: Attachment[]; again?: boolean }, id: string, trace: RequestTrace, controller: AbortController): Promise<Outcome> {
    trace.stale = true;
    trace.decision = 'nothing';
    this.record(trace);
    this.history.value = this.history.value.filter(o => o.id !== id);
    if (this.controller === controller) this.controller = null;
    if (!options.again) return this.run(raw, { ...options, again: true });
    this.busy.value = false;
    const line = this.llm?.take({ id, text: raw.trim().slice(0, 600), via: options.via, status: 'thinking', route: 'llm', ms: 0, attached: options.attached?.length ? options.attached : undefined });
    if (line) return Promise.resolve(line);
    const outcome: Outcome = { id, text: raw.trim().slice(0, 600), via: options.via, status: 'nothing', route: 'jev', ms: 0, message: 'The patch kept changing while Jev was thinking; say it again when you are ready.' };
    this.show(outcome);
    return Promise.resolve(outcome);
  }

  /** The time budget in effect (drawer override, else the bridge default). */
  get budgetMs() { return this.settings.budgetMs ?? this.session.bridge?.status.value?.jev.budgetMs ?? 1200; }

  cancel() { this.controller?.abort(); this.busy.value = false; }

  // ---- internals -------------------------------------------------------------------
  private tau(lang: 'ja' | 'en') { return lang === 'ja' ? Math.max(this.settings.tau, this.settings.tauJa) : this.settings.tau; }

  private jevOffReason() {
    const b = this.session.bridge;
    if (!this.settings.useJev) return 'Jev is switched off in the dev drawer.';
    if (!b || !b.online) return 'AI offline (no bridge), so only the built-in phrases work.';
    const s = b.status.value?.jev;
    if (s?.state === 'off') return 'Jev is off (no TYPESAFE_API_KEY), so only the built-in phrases work.';
    if (s?.state === 'error') return `Jev is unavailable (${s.detail ?? 'error'}).`;
    return 'Jev is not ready.';
  }

  private async ask(built: BuiltRequest, signal: AbortSignal, trace: RequestTrace): Promise<{ result: JevResult; read: ReadAnswers | null }> {
    const result = await this.session.bridge!.askJev(built.request, { budgetMs: this.settings.budgetMs ?? undefined, signal });
    const read = result.ok ? readAnswers(result.response.answers, built.request.questions as Record<string, { criteria?: unknown }>) : null;
    trace.jev = {
      ok: result.ok, ms: result.ms, asked: built.asked,
      error: result.ok ? undefined : `${result.error.kind}: ${result.error.message}`,
      modelWarning: result.ok ? result.modelWarning : undefined,
      errors: read?.errors.length ? read.errors : undefined,
      answers: read ? Object.fromEntries(Object.entries(read.answers).filter(([, v]) => v).map(([k, v]) => [k, { choice: v!.choice, confidence: Math.round(v!.confidence * 1000) / 1000, agree: v!.agree }])) : undefined,
    };
    return { result, read };
  }

  private snapshot() { const d = this.session.doc.value; return { revision: d.revision, id: d.id, selection: this.session.selection.value.join(','), epoch: this.session.loadEpoch.value, path: this.session.partPath.value.join('/') }; }
  private unchanged(s: ReturnType<FastPath['snapshot']>) { const now = this.snapshot(); return now.revision === s.revision && now.id === s.id && now.selection === s.selection && now.epoch === s.epoch && now.path === s.path; }

  private realize(decision: Decision, base: Omit<Outcome, 'status'>, trace: RequestTrace): Outcome {
    trace.decision = decision.kind;
    if (decision.kind === 'apply') {
      trace.confidence = decision.confidence;
      trace.plan = decision.plan.label;
      const r = this.apply(decision.plan, { kind: 'ai-fast', handler: base.route, trace: base.id });
      if (!r.ok) { trace.decision = 'error'; return { ...base, status: 'nothing', message: r.message }; }
      trace.applied = true;
      const plans = decision.plan.kind === 'multi' ? decision.plan.plans : [decision.plan];
      const screen = plans.some(p => p.kind === 'look' || p.kind === 'template') || undefined;
      return { ...base, status: 'applied', label: decision.plan.label, note: decision.note, confidence: decision.confidence, txId: r.txId, screen };
    }
    // ('chips' and 'escalate' never get here: run() turns them into an LLM request or a one-line 'nothing'.)
    return { ...base, status: 'nothing', message: 'message' in decision ? decision.message : undefined };
  }

  private apply(plan: Plan, author: Author): { ok: true; txId?: string } | { ok: false; message: string } {
    if (plan.kind === 'template') {
      this.session.replace({ ...plan.doc, id: this.session.doc.value.id }, `AI: ${plan.label}`, true, author);
      return { ok: true, txId: this.session.history.peek()?.id };
    }
    // Planned on the place the person is in: a knob that is a part's parameter sets the use they came through.
    const r = this.session.commit(fromPartView(this.session.doc.value, this.session.partPath.value, plan.intents), { author, label: `AI: ${plan.label}` });
    if (!r.ok) return { ok: false, message: `Could not apply “${plan.short}”: ${r.error.message}` };
    return { ok: true, txId: r.ops.length ? this.session.history.peek()?.id : undefined };
  }

  private record(trace: RequestTrace) {
    this.traces.value = [trace, ...this.traces.value].slice(0, MAX_TRACES);
    this.session.bridge?.telemetry(trace as unknown as Record<string, unknown>);
  }
}

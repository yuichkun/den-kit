// The fast path (layer 1, the default): lexicon → (if needed) one Jev request →
// deterministic plan → applied at once as one `ai-fast` transaction (⌘Z undoes
// it like any edit). Nobody is ever asked to pick an interpretation: when the
// fast path is not sure, or the request needs more than a plan, it goes to the
// LLM; without the LLM the line says why in one sentence. A patch that changed
// while Jev was thinking is asked about again. Every request leaves a
// RequestTrace (shown in the dev drawer and logged as JSONL).
import { reactive, shallowRef, ref } from 'vue';
import type { KitSession } from '../editor/session.ts';
import type { Author } from '../core/history.ts';
import { randomId } from '../core/schema.ts';
import { parseRequest } from './lexicon.ts';
import { buildFullRequest, buildTargetRequest, type BuiltRequest } from './jev-questions.ts';
import { readAnswers, type ReadAnswers } from './jev-answers.ts';
import {
  DEFAULT_ROUTER_SETTINGS, ambiguousTargets, availableAspects, decideFromJev, describeSelection, lexiconStage,
  type Decision, type RouteContext, type RouterSettings,
} from './router.ts';
import type { Plan } from './intents.ts';
import type { JevResult } from './protocol.ts';

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
  /** Every request in order (oldest first), as shown above the prompt. */
  readonly history = shallowRef<Outcome[]>([]);
  readonly traces = shallowRef<RequestTrace[]>([]);
  readonly busy = ref(false);
  private controller: AbortController | null = null;
  readonly session: KitSession;

  constructor(session: KitSession) {
    this.session = session;
    session.onHistory((kind, tx) => {
      if (tx.author.kind !== 'ai-fast' && tx.author.kind !== 'ai-llm') return;
      // ⌘Z on the AI edit: the result line no longer describes the patch. (An LLM request's line is found by its id.)
      const past = this.history.value.find(o => o.txId === tx.id || (tx.author.kind === 'ai-llm' && o.id === tx.author.take));
      if (kind === 'undo' && past && this.outcome.value?.id === past.id) this.outcome.value = null;
      if (past) this.remember({ ...past, undone: kind === 'undo' });
      this.session.bridge?.telemetry({ kind: kind === 'undo' ? 'undo' : 'redo', author: tx.author.kind, trace: tx.author.trace, label: tx.label });
    });
  }

  private get ctx(): RouteContext { return { doc: this.session.doc.value, catalog: this.session.catalog, selection: [...this.session.selection.value] }; }
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

  async run(raw: string, options: { via?: 'typed' | 'voice'; /** Internal: asked again because the patch changed meanwhile. */ again?: boolean } = {}): Promise<Outcome> {
    const text = raw.trim().slice(0, 600);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const id = randomId('rq');
    const lex = parseRequest(text);
    const trace: RequestTrace = { kind: 'route', id, at: new Date().toISOString(), text, lang: lex.lang, lexicon: { items: lex.items.length, full: lex.full, leftover: lex.leftover }, decision: 'nothing', route: 'none', tau: this.tau(lex.lang), applied: false, totalMs: 0 };
    const finish = (given: Decision, route: RouteKind, extra: Partial<Outcome> = {}): Outcome => {
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
        const handed = this.llm?.take({ id, text, via: options.via, status: 'thinking', route: 'llm', ms, jevMs: extra.jevMs });
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
    this.show({ id, text, via: options.via, status: 'working', route: 'none', ms: 0 });

    const before = this.snapshot();
    const stage = lexiconStage(lex, this.ctx);
    if (stage.kind === 'decided') return finish(stage.decision, 'lexicon');

    if (stage.kind === 'target') {
      if (!this.jevReady) return finish(stage.resolve(null), 'lexicon');
      const built = buildTargetRequest({ text, lang: lex.lang, selection: describeSelection(this.ctx) }, stage.candidates, stage.word);
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
    const ctx = this.ctx;
    const built = buildFullRequest({ text, lang: lex.lang, selection: describeSelection(ctx), aspects: availableAspects(ctx), targets: ambiguousTargets(ctx) });
    const { result, read } = await this.ask(built, controller.signal, trace);
    if (controller.signal.aborted) return finish({ kind: 'nothing', message: 'Cancelled.' }, 'jev');
    if (!result.ok || !read) {
      const why = result.ok ? 'Jev gave no usable answer.' : `Jev: ${result.error.message}`;
      return finish({ kind: 'nothing', message: why, llm: true }, 'jev', { jevMs: result.ms });
    }
    const decision = decideFromJev(read, built, this.ctx, lex.lang, this.settings, stage.fallback);
    if (!this.unchanged(before)) return this.again(raw, options, id, trace, controller);
    return finish(decision, 'jev', { jevMs: result.ms });
  }

  /** The patch changed while Jev was thinking: ask again about the patch as it is now (once; then the LLM takes it). */
  private again(raw: string, options: { via?: 'typed' | 'voice'; again?: boolean }, id: string, trace: RequestTrace, controller: AbortController): Promise<Outcome> {
    trace.stale = true;
    trace.decision = 'nothing';
    this.record(trace);
    this.history.value = this.history.value.filter(o => o.id !== id);
    if (this.controller === controller) this.controller = null;
    if (!options.again) return this.run(raw, { ...options, again: true });
    this.busy.value = false;
    const line = this.llm?.take({ id, text: raw.trim().slice(0, 600), via: options.via, status: 'thinking', route: 'llm', ms: 0 });
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

  private snapshot() { const d = this.session.doc.value; return { revision: d.revision, id: d.id, selection: this.session.selection.value.join(','), epoch: this.session.loadEpoch.value }; }
  private unchanged(s: ReturnType<FastPath['snapshot']>) { const now = this.snapshot(); return now.revision === s.revision && now.id === s.id && now.selection === s.selection && now.epoch === s.epoch; }

  private realize(decision: Decision, base: Omit<Outcome, 'status'>, trace: RequestTrace): Outcome {
    trace.decision = decision.kind;
    if (decision.kind === 'apply') {
      trace.confidence = decision.confidence;
      trace.plan = decision.plan.label;
      const r = this.apply(decision.plan, { kind: 'ai-fast', handler: base.route, trace: base.id });
      if (!r.ok) { trace.decision = 'error'; return { ...base, status: 'nothing', message: r.message }; }
      trace.applied = true;
      return { ...base, status: 'applied', label: decision.plan.label, note: decision.note, confidence: decision.confidence, txId: r.txId };
    }
    // ('chips' and 'escalate' never get here: run() turns them into an LLM request or a one-line 'nothing'.)
    return { ...base, status: 'nothing', message: 'message' in decision ? decision.message : undefined };
  }

  private apply(plan: Plan, author: Author): { ok: true; txId?: string } | { ok: false; message: string } {
    if (plan.kind === 'template') {
      this.session.replace({ ...plan.doc, id: this.session.doc.value.id }, `AI: ${plan.label}`, true, author);
      return { ok: true, txId: this.session.history.peek()?.id };
    }
    const r = this.session.commit(plan.intents, { author, label: `AI: ${plan.label}` });
    if (!r.ok) return { ok: false, message: `Could not apply “${plan.short}”: ${r.error.message}` };
    return { ok: true, txId: r.ops.length ? this.session.history.peek()?.id : undefined };
  }

  private record(trace: RequestTrace) {
    this.traces.value = [trace, ...this.traces.value].slice(0, MAX_TRACES);
    this.session.bridge?.telemetry(trace as unknown as Record<string, unknown>);
  }
}

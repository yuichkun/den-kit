// The fast path (layer 1, the default): lexicon → (if needed) one Jev request →
// deterministic plan → applied at once as one `ai-fast` transaction (⌘Z undoes
// it like any edit). Low confidence or a patch that changed while Jev was
// thinking turns into chips instead of an edit. Every request leaves a
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
  type Chip, type Decision, type RouteContext, type RouterSettings,
} from './router.ts';
import type { Plan } from './intents.ts';
import type { JevResult } from './protocol.ts';

/** `budgetMs: null` = the bridge default (KIT_JEV_BUDGET_MS, else 1200 ms). */
export interface FastSettings extends RouterSettings { budgetMs: number | null; useJev: boolean }
export type OutcomeStatus = 'working' | 'applied' | 'chips' | 'escalate' | 'nothing';
export type RouteKind = 'lexicon' | 'jev' | 'jev-target' | 'none';

export interface Outcome {
  id: string;
  text: string;
  status: OutcomeStatus;
  route: RouteKind;
  ms: number;
  jevMs?: number;
  label?: string;
  note?: string;
  message?: string;
  confidence?: number;
  chips: Chip[];
  txId?: string;
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
  stale?: boolean;
  applied: boolean;
  totalMs: number;
}

const MAX_TRACES = 30;

export class FastPath {
  readonly settings = reactive<FastSettings>({ ...DEFAULT_ROUTER_SETTINGS, budgetMs: null, useJev: true });
  readonly outcome = shallowRef<Outcome | null>(null);
  readonly traces = shallowRef<RequestTrace[]>([]);
  readonly busy = ref(false);
  private controller: AbortController | null = null;
  readonly session: KitSession;

  constructor(session: KitSession) {
    this.session = session;
    session.onHistory((kind, tx) => {
      if (tx.author.kind !== 'ai-fast') return;
      // ⌘Z on the AI edit: the result line no longer describes the patch.
      if (kind === 'undo' && this.outcome.value?.txId === tx.id) this.outcome.value = null;
      this.session.bridge?.telemetry({ kind: kind === 'undo' ? 'undo' : 'redo', trace: tx.author.trace, label: tx.label });
    });
  }

  private get ctx(): RouteContext { return { doc: this.session.doc.value, catalog: this.session.catalog, selection: [...this.session.selection.value] }; }
  private get jevReady() { return this.settings.useJev && !!this.session.bridge?.jevReady; }

  /** Interpret one request. Never throws; the outcome says what happened. */
  async run(raw: string): Promise<Outcome> {
    const text = raw.trim().slice(0, 600);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const id = randomId('rq');
    const lex = parseRequest(text);
    const trace: RequestTrace = { kind: 'route', id, at: new Date().toISOString(), text, lang: lex.lang, lexicon: { items: lex.items.length, full: lex.full, leftover: lex.leftover }, decision: 'nothing', route: 'none', tau: this.tau(lex.lang), applied: false, totalMs: 0 };
    const finish = (decision: Decision, route: RouteKind, extra: Partial<Outcome> = {}): Outcome => {
      if (controller.signal.aborted && this.controller !== controller) return { id, text, status: 'nothing', route, ms: 0, chips: [], message: 'Superseded by a newer request.' };
      const outcome = this.realize(decision, { id, text, route, ms: Math.round(performance.now() - started), chips: [], ...extra }, trace);
      trace.totalMs = outcome.ms;
      trace.route = route;
      this.record(trace);
      this.outcome.value = outcome;
      this.busy.value = false;
      if (this.controller === controller) this.controller = null;
      return outcome;
    };
    if (!text) return finish({ kind: 'nothing', message: 'Type what you want, e.g. “brighter”, “longer release”, “add reverb”, “make a bass”.' }, 'none');
    this.busy.value = true;
    this.outcome.value = { id, text, status: 'working', route: 'none', ms: 0, chips: [] };

    const before = this.snapshot();
    const stage = lexiconStage(lex, this.ctx);
    if (stage.kind === 'decided') return finish(stage.decision, 'lexicon');

    if (stage.kind === 'target') {
      if (!this.jevReady) return finish(stage.resolve(null), 'lexicon');
      const built = buildTargetRequest({ text, lang: lex.lang, selection: describeSelection(this.ctx) }, stage.candidates, stage.word);
      const { result, read } = await this.ask(built, controller.signal, trace);
      if (controller.signal.aborted) return finish({ kind: 'nothing', message: 'Cancelled.' }, 'jev-target');
      if (!this.unchanged(before)) { trace.stale = true; return finish(asChips(stage.resolve(null), 'The patch changed while Jev was thinking; pick one:'), 'jev-target', { jevMs: result.ms }); }
      const t = read?.answers.target;
      const target = t && t.agree && t.confidence >= this.tau(lex.lang) && built.targetKeys[t.choice] ? built.targetKeys[t.choice]!.split('.') : null;
      return finish(stage.resolve(target ? [{ node: target[0]!, port: target[1]! }] : null), 'jev-target', { jevMs: result.ms, confidence: t?.confidence });
    }

    // Not fully understood by the lexicon: ask Jev everything at once.
    if (!this.jevReady) {
      const why = this.jevOffReason();
      return finish(stage.fallback.length ? { kind: 'chips', message: `${why} Did you mean:`, chips: stage.fallback } : { kind: 'nothing', message: `${why} Try phrases like “brighter”, “リリース長く”, “add reverb”, “ベース作って”.` }, 'none');
    }
    const ctx = this.ctx;
    const built = buildFullRequest({ text, lang: lex.lang, selection: describeSelection(ctx), aspects: availableAspects(ctx), targets: ambiguousTargets(ctx) });
    const { result, read } = await this.ask(built, controller.signal, trace);
    if (controller.signal.aborted) return finish({ kind: 'nothing', message: 'Cancelled.' }, 'jev');
    if (!result.ok || !read) {
      const why = result.ok ? 'Jev gave no usable answer.' : `Jev: ${result.error.message}`;
      return finish(stage.fallback.length ? { kind: 'chips', message: `${why} Did you mean:`, chips: stage.fallback } : { kind: 'nothing', message: why }, 'jev', { jevMs: result.ms });
    }
    const decision = decideFromJev(read, built, this.ctx, lex.lang, this.settings, stage.fallback);
    if (!this.unchanged(before)) { trace.stale = true; return finish(asChips(decision, 'The patch changed while Jev was thinking; apply anyway?'), 'jev', { jevMs: result.ms }); }
    return finish(decision, 'jev', { jevMs: result.ms });
  }

  /** Apply an interpretation the user picked. */
  applyChip(chip: Chip) {
    const o = this.outcome.value;
    const trace = { id: o?.id ?? randomId('rq'), chip: chip.label };
    const r = this.apply(chip.plan, { kind: 'ai-fast', handler: 'chip', trace: trace.id });
    this.session.bridge?.telemetry({ kind: 'chip', id: trace.id, label: chip.label, ok: r.ok, error: r.ok ? undefined : r.message });
    if (!r.ok) { this.session.toast('warn', r.message); return; }
    this.outcome.value = { ...(o ?? { id: trace.id, text: chip.label, route: 'none', ms: 0 }), status: 'applied', label: chip.plan.label, chips: [], message: undefined, txId: r.txId };
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
    if (decision.kind === 'chips') { trace.confidence = decision.confidence; return { ...base, status: 'chips', message: decision.message, chips: decision.chips, confidence: decision.confidence }; }
    if (decision.kind === 'escalate') return { ...base, status: 'escalate', message: decision.message, chips: decision.chips };
    return { ...base, status: 'nothing', message: decision.message };
  }

  private apply(plan: Plan, author: Author): { ok: true; txId?: string } | { ok: false; message: string } {
    if (this.session.readOnly.value) return { ok: false, message: 'This tab is read-only; use “Take over” to edit here.' };
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

/** A decision computed on a patch that has since changed is offered, never applied. */
function asChips(decision: Decision, message: string): Decision {
  if (decision.kind === 'apply') return { kind: 'chips', message, chips: [{ label: decision.plan.short, plan: decision.plan }], confidence: decision.confidence };
  return decision;
}

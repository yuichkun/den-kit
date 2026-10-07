// The fast-path router: pure decisions from (request, patch, lexicon, Jev
// answers) to "apply this plan", "offer these interpretations" (chips) or
// "this needs the LLM". It never touches the session; fast-path.ts applies.
import type { Catalog } from '../core/catalog.ts';
import { applyIntents } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import {
  AMOUNTS, ASPECTS, aspectById, candidates, chooseTargets, combinePlans, existingFx, FX, planAddFx, planAdjust, planPart,
  type Amount, type Candidate, type Direction, type FxId, type Plan, type PlanResult, type Target,
} from './intents.ts';
import type { LexItem, LexResult } from './lexicon.ts';
import { ranked, type Choice, type ReadAnswers } from './jev-answers.ts';
import type { BuiltRequest, RouteId } from './jev-questions.ts';
import { buildTemplate, TEMPLATES, TEMPLATE_INFO, type TemplateId } from './templates.ts';
import { planLook } from './look-intents.ts';

export interface RouterSettings { tau: number; tauJa: number }
/** From the second kit:eval:jev run (36/36 right; Japanese answers down to 70%). */
export const DEFAULT_ROUTER_SETTINGS: RouterSettings = { tau: 0.6, tauJa: 0.7 };

export interface RouteContext { doc: PatchDocument; catalog: Catalog; selection: readonly string[] }
export interface Chip { label: string; plan: Plan }

export type Decision =
  | { kind: 'apply'; plan: Plan; confidence: number; note?: string }
  | { kind: 'chips'; message: string; chips: Chip[]; confidence?: number }
  | { kind: 'escalate'; message: string; chips: Chip[] }
  /** `llm`: the fast path could not do it, but the LLM might (it goes there when Codex is available). */
  | { kind: 'nothing'; message: string; llm?: boolean };

/** Shown when a request needs the LLM; the fast path hands such requests to it when Codex is available. */
export const NEEDS_LLM = 'This needs the LLM.';

// ---- Stage 0: lexicon ---------------------------------------------------------------
export type LexiconStage =
  | { kind: 'decided'; decision: Decision }
  | { kind: 'target'; aspect: string; word: string; candidates: Candidate[]; resolve: (targets: Target[] | null) => Decision }
  | { kind: 'jev'; fallback: Chip[] };

/** Plan one lexicon item against `doc`. */
export function planItem(item: LexItem, doc: PatchDocument, catalog: Catalog, selection: readonly string[], targets?: Target[]): PlanResult {
  if (item.kind === 'adjust') {
    const result = planAdjust(doc, catalog, { aspect: item.aspect, direction: item.direction, amount: item.amount, targets }, selection);
    // "歪ませて" on a patch with no drive knob: add a drive effect instead.
    if (!result.ok && result.reason === 'no-target' && item.aspect === 'drive' && (item.direction === 'up' || item.direction === 'set_max')) return planAddFx(doc, catalog, 'drive');
    return result;
  }
  if (item.kind === 'fx') {
    const existing = existingFx(doc, item.fx);
    if (existing) {
      const r = planAdjust(doc, catalog, { aspect: 'mix', direction: item.verb === 'less' ? 'down' : 'up', amount: item.amount, targets: [{ node: existing.id, port: 'mix' }] }, selection);
      if (r.ok && item.verb === 'add') return { ok: true, plan: { ...r.plan, label: `${FX[item.fx].title} is already there: ${r.plan.label}` } };
      return r;
    }
    if (item.verb === 'less') return { ok: false, reason: 'no-target', message: `There is no ${FX[item.fx].title.toLowerCase()} to reduce.` };
    return planAddFx(doc, catalog, item.fx);
  }
  if (item.kind === 'complex') return { ok: false, reason: 'unknown', message: NEEDS_LLM };
  if (item.kind === 'look') return planLook(doc, catalog, item.change, item.amount);
  if (item.kind === 'part') return planPart(doc, item.action, selection);
  const tdoc = buildTemplate(item.template, catalog);
  const info = TEMPLATE_INFO[item.template];
  return { ok: true, plan: { kind: 'template', template: item.template, doc: tdoc, label: `new ${info.title.toLowerCase()} patch`, short: `new ${info.title}` } };
}

/** Plan items in order, each against the result of the previous ones, as one transaction. */
export function planSequence(items: readonly LexItem[], ctx: RouteContext): { plans: Plan[]; failures: Array<{ item: LexItem; result: Extract<PlanResult, { ok: false }> }>; doc: PatchDocument } {
  const template = items.find((i): i is Extract<LexItem, { kind: 'template' }> => i.kind === 'template');
  let doc = ctx.doc;
  let selection = ctx.selection;
  const plans: Plan[] = [];
  const failures: Array<{ item: LexItem; result: Extract<PlanResult, { ok: false }> }> = [];
  if (template) { doc = buildTemplate(template.template, ctx.catalog); selection = []; }
  for (const item of items) {
    if (item.kind === 'template' || item.kind === 'complex') continue;
    let r = planItem(item, doc, ctx.catalog, selection);
    // On a fresh template the obvious module is fine (e.g. the amp envelope).
    if (!r.ok && r.reason === 'ambiguous' && template && r.candidates?.length) r = planItem(item, doc, ctx.catalog, selection, [r.candidates[0]!]);
    if (!r.ok) { failures.push({ item, result: r }); continue; }
    plans.push(r.plan);
    // (Part edits change what there is to plan on; the knob plans after them see the patch as it was.)
    if (r.plan.kind !== 'template' && r.plan.kind !== 'part') doc = applyIntents(doc, r.plan.intents, ctx.catalog).doc;
  }
  if (template) {
    const info = TEMPLATE_INFO[template.template];
    const extra = plans.length ? ` (${plans.map(p => p.short.split(' · ')[0]).join(', ')})` : '';
    return { plans: [{ kind: 'template', template: template.template, doc, label: `new ${info.title.toLowerCase()} patch${extra}`, short: `new ${info.title}${extra}` }], failures, doc };
  }
  return { plans, failures, doc };
}

export function lexiconStage(lex: LexResult, ctx: RouteContext): LexiconStage {
  if (!lex.items.length) return { kind: 'jev', fallback: [] };
  const { plans, failures } = planSequence(lex.items, ctx);
  const chips = plans.length ? [{ label: combinePlans(plans).short, plan: combinePlans(plans) }] : [];
  // Code, wiring and explanations go to the LLM; never guess them with a knob turn.
  if (lex.items.some(i => i.kind === 'complex')) return { kind: 'decided', decision: { kind: 'escalate', message: NEEDS_LLM, chips } };
  if (!lex.full) return { kind: 'jev', fallback: chips };
  const ambiguous = failures.filter(f => f.result.reason === 'ambiguous');
  if (ambiguous.length === 1 && ambiguous[0]!.item.kind === 'adjust') {
    const { item, result } = ambiguous[0]! as { item: Extract<LexItem, { kind: 'adjust' }>; result: Extract<PlanResult, { ok: false }> };
    const aspect = aspectById(item.aspect)!;
    const word = item.direction === 'down' || item.direction === 'set_min' ? aspect.down : aspect.up;
    const others = lex.items.filter(i => i !== item);
    return {
      kind: 'target', aspect: item.aspect, word, candidates: result.candidates ?? [],
      resolve: targets => {
        const options = targets?.length ? [targets] : (result.candidates ?? []).map(c => [{ node: c.node, port: c.port }]);
        const built = options.map(t => {
          const seq = planSequence(others, ctx);
          const r = planItem(item, seq.doc, ctx.catalog, ctx.selection, t);
          return r.ok ? combinePlans([...seq.plans, r.plan]) : null;
        }).filter((p): p is Plan => !!p);
        if (targets?.length && built.length) return { kind: 'apply', plan: built[0]!, confidence: 1 };
        return built.length ? { kind: 'chips', message: result.message, chips: built.slice(0, 6).map(plan => ({ label: plan.short, plan })) } : { kind: 'nothing', message: result.message };
      },
    };
  }
  if (plans.length) {
    const note = failures.length ? failures.map(f => f.result.message).join(' ') : undefined;
    return { kind: 'decided', decision: { kind: 'apply', plan: combinePlans(plans), confidence: 1, note } };
  }
  const message = failures.map(f => f.result.message).join(' ');
  const needsLlm = failures.some(f => f.result.reason === 'no-target');
  return { kind: 'decided', decision: { kind: 'nothing', message, llm: needsLlm } };
}

// ---- Stage 1: Jev ---------------------------------------------------------------------
const tauFor = (settings: RouterSettings, lang: 'ja' | 'en') => lang === 'ja' ? Math.max(settings.tau, settings.tauJa) : settings.tau;
const adjustItem = (aspect: string, direction: Direction, amount: Amount): LexItem => ({ kind: 'adjust', aspect, direction, amount, phrase: '' });

function amountFrom(c: Choice | undefined): Amount { return c && (AMOUNTS as readonly string[]).includes(c.choice) ? c.choice as Amount : 'medium'; }
/** `attack_down` → { aspect: 'attack', direction: 'down' }. */
export function aspectKey(key: string | undefined): { aspect: string; direction: Direction } | null {
  const m = key ? /^(.+)_(up|down)$/.exec(key) : null;
  return m && aspectById(m[1]!) ? { aspect: m[1]!, direction: m[2] as Direction } : null;
}

/** Alternative interpretations from the ranked answers, as ready-to-apply chips. */
export function chipsFromAnswers(read: ReadAnswers, ctx: RouteContext, extra: Chip[] = [], limit = 4): Chip[] {
  const a = read.answers;
  const chips: Chip[] = [...extra];
  const routes = ranked(a.route).slice(0, 2).map(r => r.key as RouteId);
  const amount = amountFrom(a.amount);
  for (const route of routes.length ? routes : ['adjust' as RouteId]) {
    if (route === 'adjust') {
      for (const { key } of ranked(a.aspect).slice(0, 3)) {
        const ad = aspectKey(key);
        if (!ad) continue;
        const r = planSequence([adjustItem(ad.aspect, ad.direction, amount)], ctx);
        if (r.plans[0]) chips.push({ label: r.plans[0].short, plan: r.plans[0] });
      }
    } else if (route === 'add_effect') {
      for (const { key } of ranked(a.fx).filter(r => r.key !== 'none').slice(0, 2)) {
        const r = planSequence([{ kind: 'fx', fx: key as FxId, verb: 'add', phrase: '' }], ctx);
        if (r.plans[0]) chips.push({ label: r.plans[0].short, plan: r.plans[0] });
      }
    } else if (route === 'create') {
      for (const { key } of ranked(a.template).filter(r => r.key !== 'none').slice(0, 2)) {
        const r = planSequence([{ kind: 'template', template: key as TemplateId, phrase: '' }], ctx);
        if (r.plans[0]) chips.push({ label: r.plans[0].short, plan: r.plans[0] });
      }
    }
  }
  const seen = new Set<string>();
  return chips.filter(c => !seen.has(c.label) && (seen.add(c.label), true)).slice(0, limit);
}

export function decideFromJev(read: ReadAnswers, built: BuiltRequest, ctx: RouteContext, lang: 'ja' | 'en', settings: RouterSettings, fallback: Chip[] = []): Decision {
  const a = read.answers;
  const tau = tauFor(settings, lang);
  const route = a.route;
  const chips = (message: string, confidence?: number): Decision => {
    const list = chipsFromAnswers(read, ctx, fallback);
    return list.length ? { kind: 'chips', message, chips: list, confidence } : { kind: 'nothing', message: `${message} Try rephrasing, e.g. “brighter”, “longer release”, “add reverb”, “make a bass”.`, llm: true };
  };
  if (!route) return chips('Jev gave no usable answer.');
  if (!route.agree) return chips('Jev was unsure what kind of edit this is.', route.confidence);
  if (route.choice === 'complex') return { kind: 'escalate', message: NEEDS_LLM, chips: chipsFromAnswers(read, ctx, fallback).filter(c => c.plan.kind !== 'template') };
  // A screen request the built-in phrases did not cover: the LLM builds screens.
  if (route.choice === 'screen') return { kind: 'escalate', message: NEEDS_LLM, chips: fallback };
  if (route.confidence < tau) return chips(`Not sure enough (${Math.round(route.confidence * 100)}% < ${Math.round(tau * 100)}%).`, route.confidence);

  if (route.choice === 'adjust') {
    const aspect = a.aspect, ad = aspectKey(aspect?.choice);
    if (!aspect || !ad) return chips('Jev could not tell what to change.');
    const direction = ad.direction;
    let targets: Target[] | undefined;
    let targetConfidence = 1;
    if (a.target && a.target.choice !== 'unclear' && built.targetKeys[a.target.choice]) {
      const [node, port] = built.targetKeys[a.target.choice]!.split('.');
      targets = [{ node: node!, port: port! }];
      targetConfidence = a.target.agree ? a.target.confidence : 0;
    }
    const result = planItem(adjustItem(ad.aspect, direction, amountFrom(a.amount)), ctx.doc, ctx.catalog, ctx.selection, targets);
    if (!result.ok) {
      if (result.reason === 'ambiguous') return { kind: 'chips', message: result.message, chips: (result.candidates ?? []).slice(0, 4).flatMap(c => { const r = planItem(adjustItem(ad.aspect, direction, amountFrom(a.amount)), ctx.doc, ctx.catalog, ctx.selection, [c]); return r.ok ? [{ label: r.plan.short, plan: r.plan }] : []; }) };
      return { kind: 'nothing', message: result.message, llm: result.reason === 'no-target' };
    }
    const confidence = Math.min(route.confidence, aspect.confidence, targetConfidence);
    if (!aspect.agree || confidence < tau) return { kind: 'chips', message: `Not sure enough (${Math.round(confidence * 100)}%).`, chips: chipsFromAnswers(read, ctx, [{ label: result.plan.short, plan: result.plan }, ...fallback]), confidence };
    return { kind: 'apply', plan: result.plan, confidence };
  }
  if (route.choice === 'add_effect') {
    const fx = a.fx;
    if (!fx || fx.choice === 'none' || !(fx.choice in FX)) return chips('Jev could not tell which effect.');
    const result = planItem({ kind: 'fx', fx: fx.choice as FxId, verb: 'add', phrase: '' }, ctx.doc, ctx.catalog, ctx.selection);
    if (!result.ok) return { kind: 'nothing', message: result.message };
    const confidence = Math.min(route.confidence, fx.confidence);
    if (confidence < tau) return { kind: 'chips', message: `Not sure enough (${Math.round(confidence * 100)}%).`, chips: chipsFromAnswers(read, ctx, [{ label: result.plan.short, plan: result.plan }, ...fallback]), confidence };
    return { kind: 'apply', plan: result.plan, confidence };
  }
  // create
  const template = a.template;
  if (!template || template.choice === 'none' || !(TEMPLATES as readonly string[]).includes(template.choice)) return chips('Jev could not tell which instrument to make.');
  const items: LexItem[] = [{ kind: 'template', template: template.choice as TemplateId, phrase: '' }];
  const slot = aspectKey(a.aspect?.choice);
  if (slot && a.aspect!.agree && a.aspect!.confidence >= tau) items.push(adjustItem(slot.aspect, slot.direction, amountFrom(a.amount)));
  const plan = planSequence(items, ctx).plans[0]!;
  const confidence = Math.min(route.confidence, template.confidence);
  if (!template.agree || confidence < tau) return { kind: 'chips', message: `Not sure enough (${Math.round(confidence * 100)}%).`, chips: chipsFromAnswers(read, ctx, [{ label: plan.short, plan }, ...fallback]), confidence };
  return { kind: 'apply', plan, confidence };
}

/**
 * Directional options worth offering to Jev for this patch (`brightness_up`, …):
 * those with a free knob, plus "more drive" (it falls back to adding a drive
 * effect) and, for templates, the envelope and tone slots of every template.
 */
export function availableAspects(ctx: RouteContext): string[] {
  const out: string[] = [];
  for (const a of ASPECTS) {
    const has = candidates(ctx.doc, ctx.catalog, a, ctx.selection).length > 0 || ['brightness', 'resonance', 'attack', 'release'].includes(a.id);
    if (has) out.push(`${a.id}_up`, `${a.id}_down`);
    else if (a.id === 'drive') out.push('drive_up');
  }
  return out;
}

/** Knobs Jev may need to choose between: candidates of aspects that are ambiguous here. */
export function ambiguousTargets(ctx: RouteContext): Candidate[] {
  const out: Candidate[] = [];
  for (const a of ASPECTS) {
    const choice = chooseTargets(a, candidates(ctx.doc, ctx.catalog, a, ctx.selection));
    if (choice.kind === 'ambiguous') for (const c of choice.candidates) if (!out.some(o => o.node === c.node && o.port === c.port)) out.push(c);
  }
  return out;
}

/** Selection described for Jev's state ("Filter 'Tone'"). */
export function describeSelection(ctx: RouteContext): string {
  return ctx.selection.map(id => { const n = ctx.doc.nodes[id]; return n ? `${ctx.catalog.find(n.type)?.title ?? n.type}${n.label ? ` '${n.label}'` : ''}` : null; }).filter(Boolean).slice(0, 4).join(', ');
}

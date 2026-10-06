// Stage 1 of the fast path: one Jev request that asks every question the
// router might need at once (route, aspect, direction, amount, target, effect,
// template). Jev reads literally and is sensitive to option order, so the
// decisive questions are also asked with their options reversed; options are
// described in words (never bare ids) and the state stays tiny.
import type { JevQuestion, JevRequest } from './protocol.ts';
import { ASPECTS, AMOUNTS, FX, type Candidate, type FxId } from './intents.ts';
import { TEMPLATES, TEMPLATE_INFO } from './templates.ts';

export const ROUTES = {
  adjust: 'Change how the current sound sounds by turning existing knobs (for example brighter, darker, longer release, snappier attack, more wobble, wetter, louder).',
  add_effect: 'Add an audio effect to the current sound (reverb, delay, ping-pong delay, chorus, phaser, flanger, distortion, compressor).',
  create: 'Replace the patch with a new instrument sound made from scratch (for example "make a bass", "give me a pad").',
  complex: 'Anything else: new routing or structure, custom DSP code, an explanation, several unrelated steps, or something not covered by the other options.',
} as const;
export type RouteId = keyof typeof ROUTES;

export const DIRECTIONS = {
  up: 'More of that aspect (higher, longer, stronger, brighter, faster, wetter, louder).',
  down: 'Less of that aspect (lower, shorter, weaker, darker, slower, drier, quieter).',
  set_max: 'Set it all the way to the maximum.',
  set_min: 'Set it all the way to the minimum or turn it off.',
  none: 'The request does not say which way.',
} as const;

export const AMOUNT_TEXT: Record<string, string> = {
  tiny: 'A tiny, barely noticeable change ("a touch", "slightly").',
  small: 'A small change ("a bit", "a little").',
  medium: 'A normal, clearly noticeable change ("more", "-er" words with no qualifier).',
  large: 'A large change ("much", "a lot", "really").',
  extreme: 'An extreme change ("extremely", "as much as possible").',
  unspecified: 'The request does not say how much.',
};

export interface QuestionContext {
  text: string;
  lang: 'ja' | 'en';
  /** Human description of the selection, e.g. "Filter 'Tone'". */
  selection: string;
  /** Aspects that have at least one knob in this patch. */
  aspects: readonly string[];
  /** Nodes Jev may have to choose between (only when the patch is ambiguous). */
  targets?: readonly Candidate[];
}

/** Built questions plus the maps that turn option keys back into ids. */
export interface BuiltRequest { request: JevRequest; targetKeys: Record<string, string>; asked: string[] }

const reversed = (criteria: Record<string, string>) => Object.fromEntries(Object.entries(criteria).reverse());
const choice = (instructions: string, criteria: Record<string, string>): JevQuestion => ({ type: 'choice', instructions, criteria });

export function stateFor(ctx: Pick<QuestionContext, 'text' | 'lang' | 'selection'>) {
  return { request: ctx.text.slice(0, 600), language: ctx.lang === 'ja' ? 'Japanese' : 'English', selected: ctx.selection || 'nothing' };
}

export function buildFullRequest(ctx: QuestionContext): BuiltRequest {
  const questions: Record<string, JevQuestion> = {};
  const routeQ = 'What kind of edit does the user\'s request to a synthesizer patch ask for?';
  questions.route = choice(routeQ, { ...ROUTES });
  questions.route_rev = choice(routeQ, reversed({ ...ROUTES }));

  const aspectCriteria: Record<string, string> = {};
  for (const a of ASPECTS) if (ctx.aspects.includes(a.id)) aspectCriteria[a.id] = a.doc;
  aspectCriteria.none_of_these = 'None of these aspects (or the request is not about one aspect of the sound).';
  const aspectQ = 'Which single aspect of the sound does the request want to change?';
  questions.aspect = choice(aspectQ, aspectCriteria);
  questions.aspect_rev = choice(aspectQ, reversed(aspectCriteria));

  questions.direction = choice('For that aspect, does the user want more of it or less of it? ("darker" means less brightness; "snappier attack" means a shorter attack time, so less; "longer tail" means more release.)', { ...DIRECTIONS });
  const amountQ = 'How big a change does the request ask for?';
  questions.amount = choice(amountQ, { ...AMOUNT_TEXT });
  questions.amount_rev = choice(amountQ, reversed({ ...AMOUNT_TEXT }));

  const fxCriteria: Record<string, string> = Object.fromEntries((Object.keys(FX) as FxId[]).map(id => [id, FX[id].doc]));
  fxCriteria.none = 'No effect is mentioned.';
  questions.fx = choice('If the request mentions an audio effect, which one?', fxCriteria);

  const templateCriteria: Record<string, string> = Object.fromEntries(TEMPLATES.map(id => [id, TEMPLATE_INFO[id].doc]));
  templateCriteria.none = 'No new instrument is asked for.';
  const templateQ = 'If the request asks for a new instrument sound, which kind?';
  questions.template = choice(templateQ, templateCriteria);
  questions.template_rev = choice(templateQ, reversed(templateCriteria));

  const targetKeys: Record<string, string> = {};
  if (ctx.targets && ctx.targets.length > 1) Object.assign(questions, targetQuestions(ctx.targets, targetKeys));
  return { request: { state: stateFor(ctx), questions }, targetKeys, asked: Object.keys(questions) };
}

/** Only the target question (the lexicon understood the aspect, but several knobs fit). */
export function buildTargetRequest(ctx: Pick<QuestionContext, 'text' | 'lang' | 'selection'>, targets: readonly Candidate[], aspectWord: string): BuiltRequest {
  const targetKeys: Record<string, string> = {};
  const questions = targetQuestions(targets, targetKeys, aspectWord);
  return { request: { state: stateFor(ctx), questions }, targetKeys, asked: Object.keys(questions) };
}

function targetQuestions(targets: readonly Candidate[], keys: Record<string, string>, aspectWord?: string): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  targets.slice(0, 40).forEach((t, i) => { const key = `module_${i + 1}`; keys[key] = `${t.node}.${t.port}`; criteria[key] = t.description; });
  criteria.unclear = 'The request does not say which module.';
  const q = `Which module should the change${aspectWord ? ` ("${aspectWord}")` : ''} be applied to?`;
  return { target: choice(q, criteria), target_rev: choice(q, reversed(criteria)) };
}

export const AMOUNT_IDS = [...AMOUNTS, 'unspecified'] as const;

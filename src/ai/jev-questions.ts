// Stage 1 of the fast path: one Jev request that asks every question the
// router might need at once (route, aspect, direction, amount, target, effect,
// template). Jev reads literally and is sensitive to option order, so the
// decisive questions are also asked with their options reversed; options are
// described in words (never bare ids) and the state stays tiny.
import type { JevQuestion, JevRequest } from './protocol.ts';
import { ASPECTS, AMOUNTS, FX, type Candidate, type FxId } from './intents.ts';
import { TEMPLATES, TEMPLATE_INFO } from './templates.ts';

export const ROUTES = {
  adjust: 'Tweak how the current sound sounds by turning existing knobs (for example brighter, warmer, longer release, punchier, more wobble, wetter, louder, more grit).',
  add_effect: 'Add a ready-made audio effect to the current sound (reverb/hall/space, delay/echo, ping-pong delay, chorus, phaser, flanger, distortion, compressor).',
  create: 'The user wants a different instrument or sound type, e.g. "make a bass", "I want a fat bass", "a pad please", "something like a piano".',
  complex: 'Needs real work or words: writing code or a codebox (custom DSP such as a bitcrusher), new routing or wiring, explaining the patch, or several unrelated steps.',
} as const;
export type RouteId = keyof typeof ROUTES;


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
  /** Directional aspect options that can act on this patch, e.g. `attack_down` (see availableAspects). */
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

  // Each option already carries its direction in plain words ("punchier = shorter attack"):
  // a separate up/down question made Jev read "more punch" as "more attack".
  const aspectCriteria: Record<string, string> = {};
  for (const a of ASPECTS) for (const dir of ['up', 'down'] as const) {
    const key = `${a.id}_${dir}`;
    if (ctx.aspects.includes(key)) aspectCriteria[key] = dir === 'up' ? a.upDoc : a.downDoc;
  }
  aspectCriteria.none_of_these = 'None of these changes (or the request is not about tweaking one aspect of the sound).';
  const aspectQ = 'Which change to the sound does the request ask for? Read what the words mean musically, not literally ("more punch" is a faster start).';
  questions.aspect = choice(aspectQ, aspectCriteria);
  questions.aspect_rev = choice(aspectQ, reversed(aspectCriteria));
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

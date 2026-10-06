// A fake Jev "brain" for tests: answers from a script keyed by the request
// text, independent of option order (so reversed questions agree), with an
// optional per-answer probability. Unscripted requests fall back to the default
// position-biased answers, which disagree between orders — like an unsure model.
import { defaultAnswerer, type Answerer, type FakeQuestion } from './fake-jev.ts';

export type Scripted = string | { choice: string; p: number };
export type Script = Record<string, Record<string, Scripted>>;

export function scriptedAnswerer(script: Script, fallback: Answerer = defaultAnswerer): Answerer {
  return (id, question: FakeQuestion, state) => {
    const request = typeof state === 'object' && state && 'request' in state ? String((state as { request: unknown }).request) : '';
    const entry = script[request];
    const base = id.replace(/_rev$/, '');
    const want = entry?.[base];
    if (!want || question.type !== 'choice') return fallback(id, question, state);
    const keys = Object.keys(question.criteria as Record<string, unknown>);
    const { choice, p } = typeof want === 'string' ? { choice: want, p: 0.9 } : want;
    // Target questions use generated keys; scripts name the module description fragment instead.
    const key = keys.includes(choice) ? choice : keys.find(k => String((question.criteria as Record<string, unknown>)[k]).includes(choice)) ?? keys[0]!;
    const rest = (1 - p) / Math.max(1, keys.length - 1);
    return { type: 'choice', choice: key, probabilities: Object.fromEntries(keys.map(k => [k, k === key ? p : rest])), confidence: p };
  };
}

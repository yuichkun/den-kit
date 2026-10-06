// Validation of Jev answers. Each answer is checked on its own: a broken
// answer drops only that question. Probabilities that are NaN, negative or do
// not sum to one are rejected or renormalised (and the uncertainty is kept).
// A question asked twice with reversed options is merged by averaging.
import { isObject } from './protocol.ts';

export interface Choice {
  choice: string;
  probabilities: Record<string, number>;
  /** Effective confidence: never above the probability of the chosen option. */
  confidence: number;
  /** Both orders agreed (always true for a single question). */
  agree: boolean;
  normalized?: boolean;
}

export type ChoiceResult = Choice | { error: string };

export function readChoice(raw: unknown, keys: readonly string[]): ChoiceResult {
  if (!isObject(raw)) return { error: 'answer is not an object' };
  if (raw.type !== undefined && raw.type !== 'choice') return { error: `expected a choice answer, got ${String(raw.type)}` };
  if (typeof raw.choice !== 'string' || !keys.includes(raw.choice)) return { error: `choice ${JSON.stringify(raw.choice)} is not one of the options` };
  const probabilities: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));
  let normalized = false;
  if (raw.probabilities !== undefined) {
    // Tolerate a list in option order (same length as the options).
    const given = Array.isArray(raw.probabilities) && raw.probabilities.length === keys.length ? Object.fromEntries(keys.map((k, i) => [k, (raw.probabilities as unknown[])[i]])) : raw.probabilities;
    if (!isObject(given)) return { error: 'probabilities is not an object' };
    for (const [key, value] of Object.entries(given)) {
      if (!keys.includes(key)) continue; // tolerate extra keys
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return { error: `probability for ${key} is ${String(value)}` };
      probabilities[key] = value;
    }
    const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
    if (sum <= 0) return { error: 'probabilities sum to zero' };
    if (Math.abs(sum - 1) > 0.02) { normalized = true; for (const k of keys) probabilities[k] = probabilities[k]! / sum; }
  } else probabilities[raw.choice] = 1;
  let confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : probabilities[raw.choice]!;
  confidence = Math.min(confidence, probabilities[raw.choice]!);
  if (normalized) confidence *= 0.9;
  return { choice: raw.choice, probabilities, confidence, agree: true, normalized: normalized || undefined };
}

/** Merge an answer with its reversed-order twin: average, take the argmax, flag disagreement. */
export function mergeReversed(a: ChoiceResult | undefined, b: ChoiceResult | undefined): Choice | undefined {
  const okA = a && !('error' in a) ? a : undefined;
  const okB = b && !('error' in b) ? b : undefined;
  if (!okA || !okB) {
    const one = okA ?? okB;
    // Only one order survived: usable, but less trustworthy.
    return one ? { ...one, confidence: one.confidence * 0.85 } : undefined;
  }
  const keys = Object.keys(okA.probabilities);
  const avg = Object.fromEntries(keys.map(k => [k, ((okA.probabilities[k] ?? 0) + (okB.probabilities[k] ?? 0)) / 2]));
  const best = keys.reduce((x, y) => avg[y]! > avg[x]! ? y : x, keys[0]!);
  const agree = okA.choice === okB.choice;
  const confidence = Math.min(avg[best]!, (okA.confidence + okB.confidence) / 2) * (agree ? 1 : 0.7);
  return { choice: best, probabilities: avg, confidence, agree, normalized: okA.normalized || okB.normalized || undefined };
}

/** Ranked options (best first) of a merged answer. */
export const ranked = (c: Choice | undefined) => c ? Object.entries(c.probabilities).sort((x, y) => y[1] - x[1]).map(([k, p]) => ({ key: k, p })) : [];

export interface ReadAnswers {
  answers: Record<string, Choice | undefined>;
  errors: string[];
}

/** Read every asked question; pairs named `x` and `x_rev` are merged. */
export function readAnswers(raw: Record<string, unknown>, questions: Record<string, { criteria?: unknown }>): ReadAnswers {
  const errors: string[] = [];
  const single: Record<string, ChoiceResult | undefined> = {};
  for (const [id, q] of Object.entries(questions)) {
    const keys = isObject(q.criteria) ? Object.keys(q.criteria) : [];
    if (!(id in raw)) { errors.push(`${id}: missing`); continue; }
    const r = readChoice(raw[id], keys);
    if ('error' in r) errors.push(`${id}: ${r.error}`);
    single[id] = r;
  }
  const answers: Record<string, Choice | undefined> = {};
  for (const id of Object.keys(questions)) {
    if (id.endsWith('_rev')) continue;
    answers[id] = Object.hasOwn(questions, `${id}_rev`) ? mergeReversed(single[id], single[`${id}_rev`]) : (single[id] && !('error' in single[id]!) ? single[id] as Choice : undefined);
  }
  return { answers, errors };
}

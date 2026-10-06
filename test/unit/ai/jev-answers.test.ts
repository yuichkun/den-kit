// Every malformed Jev answer is caught per question; reversed-order pairs are
// averaged and disagreement lowers confidence.
import { describe, expect, it } from 'vitest';
import { mergeReversed, readAnswers, readChoice, ranked } from '../../../src/ai/jev-answers.ts';

const keys = ['a', 'b', 'c'];
const ok = (choice: string, probabilities: Record<string, number>, confidence = 0.9) => ({ type: 'choice', choice, probabilities, confidence });

describe('readChoice', () => {
  it('accepts a well-formed answer and caps confidence at the chosen probability', () => {
    const r = readChoice(ok('a', { a: 0.7, b: 0.2, c: 0.1 }, 0.95), keys);
    expect(r).toMatchObject({ choice: 'a', confidence: 0.7, agree: true });
  });
  it.each([
    ['not an object', 'nope', /not an object/],
    ['wrong type', { type: 'score', choice: 'a' }, /expected a choice/],
    ['unknown choice', ok('z', { a: 1 }), /not one of the options/],
    ['NaN probability', ok('a', { a: NaN, b: 0.5 }), /probability for a/],
    ['negative probability', ok('a', { a: -0.1, b: 1.1 }), /probability for a/],
    ['all zero', ok('a', { a: 0, b: 0 }), /sum to zero/],
    ['probabilities not an object', { type: 'choice', choice: 'a', probabilities: [1] }, /not an object/],
    ['probabilities a string', { type: 'choice', choice: 'a', probabilities: 'high' }, /not an object/],
  ])('rejects %s', (_name, raw, message) => {
    const r = readChoice(raw, keys);
    expect('error' in r && r.error).toMatch(message);
  });
  it('renormalises sums that are not 1 and treats them as less certain', () => {
    const r = readChoice(ok('a', { a: 1.2, b: 0.4, c: 0.4 }, 1), keys);
    if ('error' in r) throw new Error(r.error);
    expect(r.normalized).toBe(true);
    expect(r.probabilities.a).toBeCloseTo(0.6);
    expect(r.confidence).toBeCloseTo(0.54);
  });
  it('ignores extra keys and fills missing ones with zero', () => {
    const r = readChoice(ok('b', { b: 0.8, c: 0.2, zz: 5 }), keys);
    if ('error' in r) throw new Error(r.error);
    expect(r.probabilities).toEqual({ a: 0, b: 0.8, c: 0.2 });
  });
  it('accepts probabilities as a list in option order', () => {
    const r = readChoice({ type: 'choice', choice: 'b', probabilities: [0.1, 0.8, 0.1] }, keys);
    expect(!('error' in r) && r.probabilities).toEqual({ a: 0.1, b: 0.8, c: 0.1 });
  });
  it('a missing or bad confidence falls back to the probability', () => {
    const r = readChoice({ type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.7 }, confidence: 'high' }, keys);
    expect(!('error' in r) && r.confidence).toBeCloseTo(0.7);
  });
});

describe('mergeReversed', () => {
  it('agreeing orders average', () => {
    const m = mergeReversed(readChoice(ok('a', { a: 0.8, b: 0.2 }), keys), readChoice(ok('a', { a: 0.6, b: 0.4 }), keys))!;
    expect(m).toMatchObject({ choice: 'a', agree: true });
    expect(m.confidence).toBeCloseTo(0.7);
  });
  it('disagreeing orders take the averaged argmax with reduced confidence', () => {
    const m = mergeReversed(readChoice(ok('a', { a: 0.55, b: 0.45 }), keys), readChoice(ok('b', { a: 0.4, b: 0.6 }), keys))!;
    expect(m.agree).toBe(false);
    expect(m.choice).toBe('b');
    expect(m.confidence).toBeLessThan(0.5);
  });
  it('one broken order: the other is used with a penalty; both broken: nothing', () => {
    const m = mergeReversed(readChoice(ok('a', { a: 0.9, b: 0.1 }), keys), { error: 'x' })!;
    expect(m.choice).toBe('a');
    expect(m.confidence).toBeCloseTo(0.765);
    expect(mergeReversed({ error: 'x' }, undefined)).toBeUndefined();
  });
});

describe('readAnswers', () => {
  it('drops only the broken questions and merges _rev pairs', () => {
    const questions = { route: { criteria: { a: 1, b: 1 } }, route_rev: { criteria: { b: 1, a: 1 } }, amount: { criteria: { a: 1, b: 1 } }, fx: { criteria: { a: 1, b: 1 } } };
    const r = readAnswers({ route: ok('a', { a: 0.9, b: 0.1 }), route_rev: ok('a', { b: 0.2, a: 0.8 }), amount: ok('a', { a: NaN }) }, questions);
    expect(r.answers.route).toMatchObject({ choice: 'a', agree: true });
    expect(r.answers.amount).toBeUndefined();
    expect(r.answers.fx).toBeUndefined();
    expect(r.errors.join('\n')).toMatch(/amount: probability/);
    expect(r.errors.join('\n')).toMatch(/fx: missing/);
    expect(ranked(r.answers.route).map(x => x.key)).toEqual(['a', 'b']);
  });
});

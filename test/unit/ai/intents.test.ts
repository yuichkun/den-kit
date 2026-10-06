// Intent operations produce valid, minimal, invertible edits on any patch that
// has the right roles, and never push a knob past its range.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { starter, STARTERS } from '../../../src/core/starters.ts';
import { applyIntents } from '../../../src/core/ops.ts';
import { validate } from '../../../src/core/validate.ts';
import { generate } from '../../../src/core/codegen.ts';
import { ASPECTS, FX, candidates, planAddFx, planAdjust, stepValue, type FxId } from '../../../src/ai/intents.ts';
import { buildTemplate, TEMPLATES } from '../../../src/ai/templates.ts';
import type { PortDef } from '../../../src/core/catalog.ts';

const bass = () => starter('bass', catalog);
const errors = (doc: Parameters<typeof validate>[0]) => validate(doc, catalog).issues.filter(i => i.severity === 'error');

describe('stepValue', () => {
  const cutoff: PortDef = { id: 'hz', type: 'signal', unit: 'Hz', min: 20, max: 20000 };
  const mix: PortDef = { id: 'mix', type: 'signal', min: 0, max: 1 };
  const gain: PortDef = { id: 'gain', type: 'signal', unit: 'gain', min: 0, max: 4, uiMax: 2 };
  it('moves Hz on a log scale, larger amounts further', () => {
    const small = stepValue(cutoff, 1000, 'up', 'small')!, large = stepValue(cutoff, 1000, 'up', 'large')!;
    expect(small).toBeGreaterThan(1000);
    expect(large).toBeGreaterThan(small);
    expect(stepValue(cutoff, 1000, 'down', 'medium')!).toBeCloseTo(1000 / (stepValue(cutoff, 1000, 'up', 'medium')! / 1000), -1);
  });
  it('is null at the end of the range and clamps to it', () => {
    expect(stepValue(cutoff, 20000, 'up')).toBeNull();
    expect(stepValue(mix, 0, 'down')).toBeNull();
    expect(stepValue(mix, 0.95, 'up', 'large')).toBe(1);
    expect(stepValue(mix, 0.3, 'set_max')).toBe(1);
    expect(stepValue(mix, 0.3, 'set_min')).toBe(0);
  });
  it('gains move in decibels and relative depths by a factor', () => {
    expect(stepValue(gain, 0.1, 'up', 'medium')!).toBeCloseTo(0.1413, 3);
    expect(stepValue(gain, 0.1, 'down', 'large')!).toBeCloseTo(0.0501, 3);
    expect(stepValue({ id: 'b', type: 'signal', min: -1e6, max: 1e6, uiMin: -2, uiMax: 2 }, 0.03, 'up', 'medium', { relative: true })).toBeCloseTo(0.045);
    expect(stepValue({ id: 'b', type: 'signal', min: -1e6, max: 1e6, uiMin: -2, uiMax: 2 }, -0.5, 'up', 'medium', { relative: true })).toBeCloseTo(-0.75);
  });
  it('never returns non-finite values', () => {
    for (const v of [0, 1e-12, 5, 1e5]) for (const d of ['up', 'down', 'set_max', 'set_min'] as const) {
      const n = stepValue(cutoff, v, d, 'extreme');
      if (n !== null) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe('planAdjust', () => {
  it('brighter on the bass moves the base cutoff (the filter cutoff itself is patched)', () => {
    const r = planAdjust(bass(), catalog, { aspect: 'brightness', direction: 'up' });
    expect(r.ok && r.plan.kind === 'adjust' && r.plan.changes.map(c => `${c.node}.${c.port}`)).toEqual(['cut1.hz']);
  });
  it('release prefers the amp envelope over the filter envelope', () => {
    const r = planAdjust(bass(), catalog, { aspect: 'release', direction: 'up' });
    expect(r.ok && r.plan.kind === 'adjust' && r.plan.changes[0]!.node).toBe('aenv1');
  });
  it('the selection wins', () => {
    const r = planAdjust(bass(), catalog, { aspect: 'release', direction: 'up' }, ['fenv1']);
    expect(r.ok && r.plan.kind === 'adjust' && r.plan.changes[0]!.node).toBe('fenv1');
  });
  it('wobble on the pad scales every LFO-driven depth together', () => {
    const r = planAdjust(starter('pad', catalog), catalog, { aspect: 'wobble', direction: 'up' });
    expect(r.ok && r.plan.kind === 'adjust' && r.plan.changes.map(c => c.node).sort()).toEqual(['flfo1', 'pdepth1', 'trem1']);
  });
  it('reports no target, ambiguity and the end of the range', () => {
    expect(planAdjust(bass(), catalog, { aspect: 'wobble', direction: 'up' })).toMatchObject({ ok: false, reason: 'no-target' });
    const add = planAddFx(starter('rhythmic', catalog), catalog, 'reverb');
    if (!add.ok || add.plan.kind !== 'addFx') throw new Error('addFx failed');
    const two = applyIntents(starter('rhythmic', catalog), add.plan.intents, catalog).doc;
    const amb = planAdjust(two, catalog, { aspect: 'mix', direction: 'up' });
    expect(amb).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(!amb.ok && amb.candidates!.map(c => c.node).sort()).toEqual(['delay1', 'reverb1']);
    const maxed = applyIntents(bass(), [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 10 }], catalog).doc;
    expect(planAdjust(maxed, catalog, { aspect: 'resonance', direction: 'set_max' })).toMatchObject({ ok: false, reason: 'at-limit' });
  });
  it('connected knobs are never targets', () => {
    for (const a of ASPECTS) for (const c of candidates(bass(), catalog, a)) expect(Object.values(bass().edges).some(e => e.to.node === c.node && e.to.port === c.port)).toBe(false);
  });
  it('every plan applies and validates on every starter', () => {
    for (const s of STARTERS) {
      const doc = starter(s, catalog);
      for (const a of ASPECTS) for (const direction of ['up', 'down'] as const) {
        const r = planAdjust(doc, catalog, { aspect: a.id, direction });
        if (!r.ok || r.plan.kind !== 'adjust') continue;
        const applied = applyIntents(doc, r.plan.intents, catalog);
        expect(errors(applied.doc), `${s} ${a.id} ${direction}`).toEqual([]);
      }
    }
  });
});

describe('planAddFx', () => {
  it.each(Object.keys(FX) as FxId[])('inserts %s before Out on every starter and the result generates code', fx => {
    for (const s of STARTERS) {
      const doc = starter(s, catalog);
      const r = planAddFx(doc, catalog, fx);
      expect(r.ok, `${s} ${fx}`).toBe(true);
      if (!r.ok || r.plan.kind !== 'addFx') continue;
      const next = applyIntents(doc, r.plan.intents, catalog).doc;
      expect(errors(next), `${s} ${fx}`).toEqual([]);
      const outLeft = Object.values(next.edges).find(e => next.nodes[e.to.node]!.type === 'kit.out' && e.to.port === 'left')!;
      expect(outLeft.from.node).toBe(r.plan.node);
      expect(generate(next, catalog).source).toContain(r.plan.node);
    }
  });
  it('refuses without an Out or with nothing feeding it', () => {
    const doc = applyIntents(bass(), [{ op: 'removeNode', id: 'out1' }], catalog).doc;
    expect(planAddFx(doc, catalog, 'reverb')).toMatchObject({ ok: false, reason: 'no-output' });
    const empty = applyIntents(bass(), [{ op: 'disconnectInput', to: { node: 'out1', port: 'left' } }], catalog).doc;
    expect(planAddFx(empty, catalog, 'reverb')).toMatchObject({ ok: false, reason: 'no-output' });
  });
});

describe('templates', () => {
  it.each(TEMPLATES)('%s builds a valid patch that generates code', id => {
    const doc = buildTemplate(id, catalog);
    expect(errors(doc)).toEqual([]);
    expect(generate(doc, catalog).source.length).toBeGreaterThan(100);
  });
});

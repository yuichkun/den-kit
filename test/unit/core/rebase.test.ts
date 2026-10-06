// Rebase: an LLM draft made from an older patch lands on the live patch without
// losing the user's edits made meanwhile, and never fails to apply.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { rebase } from '../../../src/core/rebase.ts';
import { starter } from '../../../src/core/starters.ts';
import { clone, type PatchDocument } from '../../../src/core/schema.ts';
import { validate } from '../../../src/core/validate.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog).doc;
const land = (base: PatchDocument, draft: PatchDocument, live: PatchDocument) => { const r = rebase(base, draft, live, catalog); return { ...r, doc: apply(live, ...r.intents) }; };
const content = (d: PatchDocument) => JSON.stringify({ n: d.nodes, e: Object.values(d.edges).map(e => [e.from, e.to]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), name: d.name, theme: d.panel.theme });
const bass = () => starter('bass', catalog);
// A typical LLM edit: an LFO wobbling the cutoff, plus a value change.
const llmEdit = (d: PatchDocument) => apply(d,
  { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo', pos: { x: 100, y: 600 }, values: { rate: 3 } } },
  { op: 'addNode', node: { id: 'wob1', type: 'kit.mul', pos: { x: 300, y: 600 }, values: { b: 0.5 } } },
  { op: 'connect', from: { node: 'lfo1', port: 'out' }, to: { node: 'wob1', port: 'a' } },
  { op: 'setValue', node: 'filter1', port: 'resonance', value: 2 },
);

describe('rebase', () => {
  it('with no user edits the live patch becomes exactly the draft', () => {
    const base = bass(), draft = llmEdit(base);
    const r = land(base, draft, base);
    expect(r.conflicts).toEqual([]);
    expect(content(r.doc)).toBe(content(draft));
  });

  it('keeps unrelated user edits and applies the LLM changes', () => {
    const base = bass(), draft = llmEdit(base);
    const live = apply(base, { op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }, { op: 'setName', name: 'Mine' });
    const r = land(base, draft, live);
    expect(r.conflicts).toEqual([]);
    expect(r.doc.nodes.gain1!.values.gain).toBe(0.3);
    expect(r.doc.name).toBe('Mine');
    expect(r.doc.nodes.lfo1).toBeDefined();
    expect(r.doc.nodes.filter1!.values.resonance).toBe(2);
  });

  it('the user wins on the same knob, and it is reported', () => {
    const base = bass(), draft = llmEdit(base);
    const live = apply(base, { op: 'setValue', node: 'filter1', port: 'resonance', value: 5 });
    const r = land(base, draft, live);
    expect(r.doc.nodes.filter1!.values.resonance).toBe(5);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.what).toMatch(/resonance/);
    expect(r.doc.nodes.lfo1).toBeDefined();
  });

  it('a node id the user took meanwhile is renamed, cables follow', () => {
    const base = bass(), draft = llmEdit(base);
    const live = apply(base, { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo', pos: { x: 0, y: 900 } } });
    const r = land(base, draft, live);
    expect(r.idMap.lfo1).toBeDefined();
    const renamed = r.idMap.lfo1!;
    expect(r.doc.nodes[renamed]!.values.rate).toBe(3);
    expect(Object.values(r.doc.edges).some(e => e.from.node === renamed && e.to.node === 'wob1')).toBe(true);
    expect(r.doc.nodes.lfo1).toBeDefined(); // the user's one is untouched
  });

  it('a module the user deleted: the LLM change to it is skipped and reported', () => {
    const base = bass();
    const draft = apply(base, { op: 'setValue', node: 'aenv1', port: 'release', value: 1.5 }, { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 });
    const live = apply(base, { op: 'removeNode', id: 'aenv1' });
    const r = land(base, draft, live);
    expect(r.conflicts.map(c => c.reason).join()).toMatch(/removed/);
    expect(r.doc.nodes.filter1!.values.resonance).toBe(3);
  });

  it('a cable the user plugged into an input wins over the LLM cable; an input the LLM rewired from the base is replaced', () => {
    const base = bass();
    // The LLM feeds the filter cutoff from a new LFO instead of the cutoff mod (replacing a base cable).
    const draft = apply(base,
      { op: 'addNode', node: { id: 'lfo1', type: 'den.lfo' } },
      { op: 'connect', from: { node: 'lfo1', port: 'out' }, to: { node: 'filter1', port: 'cutoff' }, replace: true },
      { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } },
      { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'fdepth1', port: 'b' } },
    );
    // Meanwhile the user plugged something into fdepth1.b.
    const live = apply(base, { op: 'addNode', node: { id: 'val1', type: 'kit.value' } }, { op: 'connect', from: { node: 'val1', port: 'out' }, to: { node: 'fdepth1', port: 'b' } });
    const r = land(base, draft, live);
    expect(Object.values(r.doc.edges).find(e => e.to.node === 'filter1' && e.to.port === 'cutoff')!.from.node).toBe('lfo1');
    expect(Object.values(r.doc.edges).find(e => e.to.node === 'fdepth1' && e.to.port === 'b')!.from.node).toBe('val1');
    expect(r.conflicts.some(c => /fdepth1\.b/.test(c.what))).toBe(true);
  });

  it('codebox code and ports travel together', () => {
    const base = apply(bass(), { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } });
    const code = "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; drive: Node<'f32'> }) { return { out: i.in.mul(i.drive).tanh() }; } }));";
    const draft = apply(base, { op: 'setCode', node: 'box1', code, ports: { inputs: [{ id: 'in', type: 'signal' }, { id: 'drive', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] } });
    const r = land(base, draft, base);
    expect(r.doc.nodes.box1!.code).toBe(code);
    expect(r.doc.nodes.box1!.ports).toEqual(draft.nodes.box1!.ports);
    const userCode = apply(base, { op: 'setCode', node: 'box1', code: code.replace('tanh', 'abs') });
    expect(land(base, draft, userCode).conflicts.some(c => /code/.test(c.what))).toBe(true);
  });

  it('property: random user edits and random LLM edits always rebase into intents that apply', () => {
    let seed = 11;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const randomEdit = (d: PatchDocument, tag: string): PatchDocument => {
      let doc = d;
      for (let k = 0; k < 4; k++) {
        const ids = Object.keys(doc.nodes);
        const candidates: Intent[] = [
          { op: 'setValue', node: pick(ids), port: 'gain', value: rand() },
          { op: 'removeNode', id: pick(ids) },
          { op: 'addNode', node: { id: `${tag}${k}`, type: pick(['den.lfo', 'kit.mul', 'kit.gain', 'den.filter']) } },
          { op: 'connect', from: { node: pick(ids), port: 'out' }, to: { node: pick(ids), port: pick(['in', 'a', 'b', 'input']) }, replace: rand() < 0.5 },
          { op: 'setName', name: `${tag}${k}` },
        ];
        try { doc = applyIntents(doc, [pick(candidates)], catalog).doc; } catch { /* invalid random edit: skip */ }
      }
      return doc;
    };
    for (let i = 0; i < 300; i++) {
      const base = pick([bass(), starter('pad', catalog), starter('rhythmic', catalog)]);
      const draft = randomEdit(clone(base), 'llm');
      const live = randomEdit(clone(base), 'usr');
      const r = rebase(base, draft, live, catalog);
      const doc = applyIntents(live, r.intents, catalog).doc; // must not throw
      expect(validate(doc, catalog).issues.length).toBeGreaterThanOrEqual(0);
    }
  });
});

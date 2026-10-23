// Modules the LLM adds without a position land in free space next to what they
// connect to, never on top of another module.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { moduleBox, placeNewNodes } from '../../../src/work/layout.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';

function rects(doc: PatchDocument) {
  const inputs = (id: string) =>
    new Set(
      Object.values(doc.edges)
        .filter(e => e.to.node === id)
        .map(e => e.to.port),
    );
  return Object.values(doc.nodes).map(n => {
    const b = moduleBox(catalog, n, inputs(n.id));
    return { id: n.id, x: n.pos.x, y: n.pos.y, w: b.width, h: b.height };
  });
}
const overlapping = (doc: PatchDocument) => {
  const r = rects(doc),
    out: string[] = [];
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i]!,
        b = r[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        out.push(`${a.id}/${b.id}`);
    }
  return out;
};

describe('placeNewNodes', () => {
  it('a modulator goes under what it feeds; nothing overlaps (the starter itself does not overlap)', () => {
    const base = starter('bass', catalog);
    expect(overlapping(base)).toEqual([]);
    const r = applyIntents(
      base,
      [
        { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } },
        { op: 'addNode', node: { id: 'wob1', type: 'kit.mul' } },
        { op: 'addNode', node: { id: 'sum2', type: 'kit.add' } },
        { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'wob1', port: 'a' } },
        { op: 'connect', from: { node: 'wob1', port: 'out' }, to: { node: 'sum2', port: 'b' } },
        {
          op: 'connect',
          from: { node: 'sum2', port: 'out' },
          to: { node: 'cut1', port: 'octaves' },
          replace: true,
        },
      ],
      catalog,
    );
    const doc = applyIntents(r.doc, placeNewNodes(r.doc, catalog, r.created), catalog).doc;
    expect(overlapping(doc)).toEqual([]);
    const cut = base.nodes.cut1!.pos,
      sum = doc.nodes.sum2!.pos;
    expect(sum.y).toBeGreaterThan(cut.y);
    expect(Math.abs(sum.x - cut.x)).toBeLessThan(600);
  });

  it('a module with no cables goes below the patch; many at once still never overlap', () => {
    const base = starter('pad', catalog);
    const r = applyIntents(
      base,
      Array.from({ length: 8 }, (_, i) => ({
        op: 'addNode' as const,
        node: { id: `box${i + 1}`, type: i % 2 ? 'den.lfo' : 'den.algorithmicReverb' },
      })),
      catalog,
    );
    const doc = applyIntents(r.doc, placeNewNodes(r.doc, catalog, r.created), catalog).doc;
    expect(overlapping(doc)).toEqual([]);
    const bottom = Math.max(...Object.values(base.nodes).map(n => n.pos.y));
    expect(doc.nodes.box1!.pos.y).toBeGreaterThan(bottom);
  });
});

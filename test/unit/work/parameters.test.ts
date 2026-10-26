import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { parameters } from '../../../src/work/parameters.ts';
import { emptyDocument } from '../../../src/work/schema.ts';

describe("the work's parameters", () => {
  it('are its controls, each with a range, unit, default and current value', () => {
    const doc = applyIntents(
      emptyDocument('t', 't'),
      [
        {
          op: 'addNode',
          node: { id: 'cut', type: 'ui.knob', label: 'Cutoff', config: { unit: 'Hz' } },
        },
        { op: 'addNode', node: { id: 'pad', type: 'ui.xy' } },
        { op: 'addNode', node: { id: 'on', type: 'ui.toggle' } },
        { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } },
        { op: 'setValue', node: 'cut', port: 'value', value: 0.25 },
      ],
      catalog,
    ).doc;
    const params = parameters(doc, catalog);
    expect(Object.keys(params)).toEqual(['cut', 'pad', 'on']);
    expect(params.cut).toMatchObject({
      kind: 'knob',
      label: 'Cutoff',
      unit: 'Hz',
      value: { value: 0.25 },
    });
    expect(params.cut!.min).toBeLessThan(params.cut!.max!);
    expect(Object.keys(params.pad!.value)).toEqual(['x', 'y']);
    expect(params.on).toMatchObject({ kind: 'switch' });
  });
});

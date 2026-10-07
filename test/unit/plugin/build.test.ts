import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { generate } from '../../../src/core/codegen.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import { pluginSpec } from '../../../src/plugin/build.ts';

const knob = (id: string, label: string, node: string, port: string, min: number, max: number, scale: string, value: number, x: number): Intent[] => [
  { op: 'addNode', node: { id, type: 'ui.knob', label, pos: { x: -300, y: x }, panel: { x, y: 120, w: 110, h: 130 }, config: { min, max, scale, unit: '' }, values: { value } } },
  { op: 'connect', from: { node: id, port: 'out' }, to: { node, port } },
];

describe('plugin window from a patch', () => {
  it('shows the panel widgets with their values, ranges and probes; widgets off the panel stay off', () => {
    const doc = applyIntents(starter('bass', catalog), [
      ...knob('kcut', 'Cutoff', 'cut1', 'hz', 40, 8000, 'log', 300, 40),
      { op: 'addNode', node: { id: 'pad1', type: 'ui.xy', label: 'Pad', pos: { x: -300, y: 600 }, panel: { x: 320, y: 20, w: 160, h: 160 } } },
      { op: 'addNode', node: { id: 'scope1', type: 'ui.scope', pos: { x: -300, y: 700 }, panel: { x: 20, y: 280, w: 200, h: 60 } } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'scope1', port: 'in' } },
      { op: 'addNode', node: { id: 'hidden1', type: 'ui.knob', pos: { x: -300, y: 900 }, config: { min: 0, max: 1 } } },
    ], catalog).doc;
    const spec = pluginSpec(doc, catalog, generate(doc, catalog));
    expect(spec).toMatchObject({ width: doc.panel.width, height: doc.panel.height, theme: doc.panel.theme });
    expect(spec.widgets.map(w => w.id)).toEqual(['kcut', 'pad1', 'scope1']);
    expect(spec.widgets[0]).toMatchObject({ type: 'ui.knob', label: 'Cutoff', config: { min: 40, max: 8000, scale: 'log', unit: '', default: 40 }, values: { value: 300 }, probe: -1 });
    expect(spec.widgets[1]!.values).toEqual({ x: 0.5, y: 0.5 }); // defaults filled in
    expect(spec.widgets[2]!.probe).toBe(0);
  });
});

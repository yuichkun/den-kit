// Shaking a sound: settings near the ones a person hears, for someone who wants
// to change a work but does not know which control to turn. Every continuous
// control on the plugin (knobs, sliders and the XY pad's two axes) moves by a
// little of its range, measured on its own scale, so a frequency knob moves by
// a ratio and a mix knob by an amount. Toggles and buttons stay as they are.
import type { Catalog } from '../../src/work/catalog.ts';
import type { Intent } from '../../src/work/ops.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { fromUnit, toUnit } from '../../src/screen/format.ts';

export interface Control {
  node: string;
  port: string;
  min: number;
  max: number;
  log: boolean;
}

/** The plugin's continuous controls, in a stable order. */
export function controlsOf(doc: PatchDocument, catalog: Catalog): Control[] {
  const controls: Control[] = [];
  for (const node of Object.values(doc.nodes).sort((a, b) => a.id.localeCompare(b.id))) {
    if (node.type !== 'ui.knob' && node.type !== 'ui.slider' && node.type !== 'ui.xy') continue;
    for (const port of catalog.inputs(node)) {
      if (port.type !== 'signal' || port.min === undefined || port.max === undefined) continue;
      if (!(port.max > port.min)) continue;
      controls.push({
        node: node.id,
        port: port.id,
        min: port.min,
        max: port.max,
        log: port.scale === 'log' && port.min > 0,
      });
    }
  }
  return controls;
}

/** A repeatable source of numbers in [0, 1) (mulberry32), so a test can shake the same way twice. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Settings near `doc`'s, as setValue intents: each continuous control moves by up to `amount`
 * of its range (0..1 on its own scale), and stays within it.
 */
export function shake(
  doc: PatchDocument,
  catalog: Catalog,
  { amount = 0.15, random = Math.random }: { amount?: number; random?: () => number } = {},
): Intent[] {
  return controlsOf(doc, catalog).flatMap(c => {
    const value = doc.nodes[c.node]!.values[c.port];
    if (typeof value !== 'number') return [];
    const at = toUnit(value, c.min, c.max, c.log);
    const next = fromUnit(at + (random() * 2 - 1) * amount, c.min, c.max, c.log);
    // Values read the same at the precision a knob shows.
    const rounded = Number(next.toPrecision(4));
    return rounded === value
      ? []
      : [{ op: 'setValue' as const, node: c.node, port: c.port, value: rounded, clamp: true }];
  });
}

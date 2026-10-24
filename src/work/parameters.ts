// The parameters a work exposes: its controls (knobs, sliders, switches,
// buttons, XY pads), each with a name, a range, a unit, a default and its current
// value. The sound plays with them; controls on the plugin screen and code parts
// read and move them, and every move is an operation on the work.
import { defaultValue, type Catalog } from './catalog.ts';
import type { NodeId, PatchDocument, PatchNode } from './schema.ts';

export type ParameterKind = 'knob' | 'slider' | 'switch' | 'button' | 'xy';
const KINDS: Readonly<Record<string, ParameterKind>> = {
  'ui.knob': 'knob',
  'ui.slider': 'slider',
  'ui.toggle': 'switch',
  'ui.button': 'button',
  'ui.xy': 'xy',
};

export interface Parameter {
  /** The control's id in the patch. */
  id: NodeId;
  kind: ParameterKind;
  label: string;
  /** Knobs and sliders: their range, scale and unit. */
  min?: number;
  max?: number;
  scale?: 'linear' | 'log';
  unit?: string;
  /** The value it starts from, and the value it has (an XY pad has x and y). */
  default: Record<string, number | boolean>;
  value: Record<string, number | boolean>;
}

const KEYS: Readonly<Record<ParameterKind, readonly string[]>> = {
  knob: ['value'],
  slider: ['value'],
  switch: ['value'],
  button: ['value'],
  xy: ['x', 'y'],
};

/** One control's parameter, or null when the node is not a control. */
export function parameterOf(node: PatchNode, catalog: Catalog): Parameter | null {
  const kind = KINDS[node.type];
  if (!kind || catalog.find(node.type)?.kind !== 'widget') return null;
  const ports = catalog.inputs(node);
  const out: Parameter = {
    id: node.id,
    kind,
    label: node.label ?? node.id,
    default: {},
    value: {},
  };
  for (const key of KEYS[kind]) {
    const port = ports.find(p => p.id === key);
    const fallback = port ? defaultValue(port) : 0;
    out.default[key] = fallback;
    out.value[key] = node.values[key] ?? fallback;
  }
  if (kind === 'knob' || kind === 'slider') {
    const port = ports.find(p => p.id === 'value');
    out.min = port?.min ?? 0;
    out.max = port?.max ?? 1;
    out.scale = port?.scale ?? 'linear';
    out.unit = String(node.config.unit ?? '');
  }
  return out;
}

/** The work's parameters, by control id, in the patch's order. */
export function parameters(doc: PatchDocument, catalog: Catalog): Record<NodeId, Parameter> {
  const out: Record<NodeId, Parameter> = {};
  for (const node of Object.values(doc.nodes)) {
    const p = parameterOf(node, catalog);
    if (p) out[p.id] = p;
  }
  return out;
}

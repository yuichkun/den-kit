// Helpers for writing showcase works as ordinary den-kit edits: every work is a
// list of intents (the same ops the editor and the LLM use), so
// nothing a work shows is special code: a person could build it by hand.
import type { Catalog } from '../core/catalog.ts';
import { withLayout } from '../core/layout.ts';
import { applyIntents, type Intent, type NewElement } from '../core/ops.ts';
import { emptyDocument, type PanelRect, type PatchDocument } from '../core/schema.ts';
import type { WidgetStyle } from '../core/ui.ts';
import { SHOWCASE_ASSETS } from './assets.ts';

export const add = (id: string, type: string, extra: Record<string, unknown> = {}): Intent => ({
  op: 'addNode',
  node: { id, type, pos: { x: 0, y: 0 }, ...extra },
});
export const wire = (from: string, to: string): Intent => {
  const [fn, fp] = from.split('.'),
    [tn, tp] = to.split('.');
  return { op: 'connect', from: { node: fn!, port: fp! }, to: { node: tn!, port: tp! } };
};
export const el = (element: NewElement): Intent => ({ op: 'addElement', element });
export const asset = (id: keyof typeof SHOWCASE_ASSETS): Intent => ({
  op: 'addAsset',
  asset: SHOWCASE_ASSETS[id]!,
});
export const r = (x: number, y: number, w: number, h: number): PanelRect => ({ x, y, w, h });

export interface ControlOptions {
  min?: number;
  max?: number;
  scale?: 'linear' | 'log';
  unit?: string;
  value?: number | boolean;
  values?: Record<string, number | boolean>;
  style?: WidgetStyle;
  out?: string;
}
/** A control on the plugin, wired to one or more `node.port` targets. */
export function control(
  id: string,
  type: string,
  label: string,
  targets: string | string[] | null,
  rect: PanelRect,
  o: ControlOptions = {},
): Intent[] {
  const ranged = type === 'ui.knob' || type === 'ui.slider';
  const node: Record<string, unknown> = { label, panel: rect };
  if (ranged)
    node.config = {
      min: o.min ?? 0,
      max: o.max ?? 1,
      scale: o.scale ?? 'linear',
      unit: o.unit ?? '',
    };
  if (o.value !== undefined || o.values)
    node.values = { ...(o.value !== undefined ? { value: o.value } : {}), ...o.values };
  if (o.style) node.style = o.style;
  const list = targets === null ? [] : Array.isArray(targets) ? targets : [targets];
  return [add(id, type, node), ...list.map(t => wire(`${id}.${o.out ?? 'out'}`, t))];
}

/** A work: the sound and the plugin, built from intents on an empty patch, its modules laid out. */
export function work(
  id: string,
  name: string,
  catalog: Catalog,
  size: [number, number],
  intents: Intent[],
): PatchDocument {
  return workInSteps(id, name, catalog, size, [intents]);
}

/**
 * A work built in steps, each a list of intents or a function of the patch so
 * far (e.g. to put a part's face on the plugin once the part exists), the way
 * a person would do it one edit after another.
 */
export function workInSteps(
  id: string,
  name: string,
  catalog: Catalog,
  size: [number, number],
  steps: Array<Intent[] | ((doc: PatchDocument) => Intent[])>,
): PatchDocument {
  let doc = applyIntents(
    emptyDocument(name, `work-${id}`),
    [{ op: 'setPanelSize', width: size[0], height: size[1] }],
    catalog,
  ).doc;
  for (const step of steps)
    doc = applyIntents(doc, typeof step === 'function' ? step(doc) : step, catalog).doc;
  return withLayout({ ...doc, revision: 0 }, catalog);
}

/** The parameters a part keeps: the ones it was made with go, these come (with their labels and ranges). */
export const onlyParams = (
  doc: PatchDocument,
  part: string,
  params: Array<{
    node: string;
    port: string;
    id: string;
    label: string;
    range?: { min: number; max: number; scale?: 'linear' | 'log'; unit?: string };
  }>,
): Intent[] => [
  ...doc.parts[part]!.params.map((p): Intent => ({ op: 'removeParam', part, id: p.id })),
  ...params.map((p): Intent => ({ op: 'addParam', part, ...p })),
];

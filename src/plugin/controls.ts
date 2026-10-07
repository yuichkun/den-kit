// A control on the plugin for a module input: a knob (or a switch for an on/off
// input) whose range, scale, unit and starting value come from the input, put
// in free space on the plugin. The inspector's "→ Plugin" and the LLM's
// addControl both make controls this way, as ordinary intents.
import type { Catalog, PortDef } from '../core/catalog.ts';
import type { Intent, NewNode } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import { CONTROL_SIZE } from '../core/face.ts';
import { CONTROL_OF } from '../core/skins.ts';
import type { WidgetStyle } from '../core/ui.ts';
import { intersects } from './edit.ts';
import type { Rect } from './spec.ts';

export type ControlType = 'ui.knob' | 'ui.slider' | 'ui.toggle' | 'ui.button';
export { CONTROL_SIZE };
const UNITS = ['Hz', 's', 'dB', 'oct', 'st', 'mix', 'gain', 'ratio', 'note'];

/**
 * A knob's range, scale and unit for an input: its UI range, and a log knob
 * that would start at 0 starts at a small step instead (1 ms, 0.01 Hz, 20 Hz),
 * so the musical part of the range is not squeezed into the first sliver.
 */
export function knobConfig(port: PortDef): { min: number; max: number; scale: 'linear' | 'log'; unit: string } {
  let min = port.uiMin ?? port.min ?? 0;
  const max = port.uiMax ?? port.max ?? 1;
  const scale = port.scale ?? 'linear';
  if (scale === 'log' && min <= 0 && max > 0) min = Math.min(max / 10, port.unit === 's' ? 0.001 : port.unit === 'Hz' ? (port.roles?.includes('rate') ? 0.01 : 20) : max / 1000);
  return { min, max, scale, unit: port.unit && UNITS.includes(port.unit) ? port.unit : '' };
}

export interface ControlRequest {
  node: string;
  port: string;
  /** Knob by default (a switch for an on/off input). */
  type?: ControlType;
  label?: string;
  /** Where it goes on the plugin; left out: the first free space. */
  panel?: Rect;
  style?: WidgetStyle;
  /** The new control's id; left out: knob1, knob2… */
  id?: string;
}
export class ControlError extends Error { constructor(message: string) { super(message); this.name = 'ControlError'; } }

/** Things on the plugin that a new control should not cover (backdrops, big pictures and full-size canvases do not count). */
export function obstacles(doc: PatchDocument, catalog: Catalog): Rect[] {
  const area = doc.panel.width * doc.panel.height;
  const out: Rect[] = [];
  for (const n of Object.values(doc.nodes)) if (n.panel && CONTROL_OF[n.type] && catalog.find(n.type)?.kind === 'widget') out.push(n.panel);
  for (const el of Object.values(doc.ui.elements)) {
    if (el.hidden || (el.kind === 'shape' && el.locked) || el.rect.w * el.rect.h > area * 0.4) continue;
    out.push(el.rect);
  }
  return out;
}

/** The first place (top to bottom, left to right, on an 8 px grid) where a w × h box fits with a gap around it; null when the plugin is full. */
export function freeSpot(doc: PatchDocument, catalog: Catalog, w: number, h: number, taken: readonly Rect[] = [], margin = 16, gap = 12): Rect | null {
  const W = doc.panel.width, H = doc.panel.height;
  const blocked = [...obstacles(doc, catalog), ...taken].map(r => ({ x: r.x - gap, y: r.y - gap, w: r.w + 2 * gap, h: r.h + 2 * gap }));
  for (let y = margin; y + h <= H - margin; y += 8) {
    for (let x = margin; x + w <= W - margin; x += 8) {
      const box = { x, y, w, h };
      if (!blocked.some(b => intersects(b, box))) return box;
    }
  }
  return null;
}

/** A fresh id for a new node: `${prefix}1`, `${prefix}2`… not used in the patch or in `taken`. */
export function freshId(doc: PatchDocument, prefix: string, taken: ReadonlySet<string> = new Set()): string {
  for (let i = 1; ; i++) { const id = `${prefix}${i}`; if (!doc.nodes[id] && !doc.ui.elements[id] && !doc.ui.groups[id] && !taken.has(id)) return id; }
}

/** The intents that add the control and wire it to the input (throws ControlError with what to do instead). */
export function controlFor(doc: PatchDocument, catalog: Catalog, req: ControlRequest, taken: { ids?: ReadonlySet<string>; rects?: readonly Rect[] } = {}): { intents: Intent[]; id: string; panel: Rect; placed: boolean } {
  const node = doc.nodes[req.node];
  if (!node) throw new ControlError(`No module "${req.node}".`);
  const port = catalog.input(node, req.port);
  if (!port) throw new ControlError(`${req.node} has no input "${req.port}". Inputs: ${catalog.inputs(node).filter(p => !p.hidden).map(p => p.id).join(', ')}.`);
  if (port.role === 'audio') throw new ControlError(`${req.node}.${req.port} is an audio input; a control cannot drive it.`);
  const gate = port.type === 'gate';
  const type: ControlType = req.type ?? (gate ? 'ui.toggle' : 'ui.knob');
  if (gate !== (type === 'ui.toggle' || type === 'ui.button')) throw new ControlError(gate ? `${req.node}.${req.port} is on/off: use ui.toggle or ui.button.` : `${req.node}.${req.port} takes a number: use ui.knob or ui.slider.`);
  const prefix = type === 'ui.knob' ? 'knob' : type === 'ui.slider' ? 'slider' : type === 'ui.toggle' ? 'toggle' : 'button';
  const id = req.id ?? freshId(doc, prefix, taken.ids);
  const [w, h] = CONTROL_SIZE[type];
  const spot = req.panel ?? freeSpot(doc, catalog, w, h, taken.rects);
  const panel = spot ?? { x: Math.max(0, doc.panel.width - w - 16), y: Math.max(0, doc.panel.height - h - 16), w, h };
  const config = knobConfig(port), { min, max } = config;
  const current = node.values[req.port];
  const widget: NewNode = { id, type, label: req.label ?? `${node.label ?? node.id} ${port.label ?? port.id}`, panel, pos: { x: node.pos.x - 220, y: node.pos.y + 40 } };
  if (gate) widget.values = { value: Boolean(current ?? port.default) };
  else {
    widget.config = config;
    widget.values = { value: Math.min(max, Math.max(min, Number(current ?? port.default ?? min))) };
  }
  if (req.style) widget.style = req.style;
  return { intents: [{ op: 'addNode', node: widget }, { op: 'connect', from: { node: id, port: 'out' }, to: { node: req.node, port: req.port } }], id, panel, placed: !!spot };
}

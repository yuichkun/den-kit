// Putting a part's face on the plugin, and taking a face from the plugin.
//
// A face goes on the plugin for one use at a time as ordinary things: a control
// per face control, wired to that use's parameter, and the decorations, all in
// one group (`<use>Face`). Putting it again replaces that group in place, so a
// face edited once can be put back on every use. Going the other way, controls
// on the plugin wired to a use's parameters and the decorations around them
// become the part's face. Everything is intents, so it undoes in one step and
// the AI does it the same way.
import { assetsOf } from '../work/ui.ts';
import type { Catalog } from '../work/catalog.ts';
import { CONTROL_SIZE, faceAssetUses, faceGroup, faceOf, wordsOnly } from '../work/face.ts';
import type { Intent, NewElement, NewNode } from '../work/ops.ts';
import { partIdFor } from '../work/parts.ts';
import {
  nextNodeId,
  type FaceControl,
  type PartFace,
  type PatchDocument,
  type PatchNode,
  type PortId,
} from '../work/schema.ts';
import { CONTROL_OF } from '../work/skins.ts';
import type { TextElement, UiElement } from '../work/ui.ts';
import { SHOWCASE_ASSETS } from './showcase/assets.ts';
import { freeSpot, freshId, knobConfig } from './controls.ts';
import type { Rect } from './spec.ts';

export class FaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceError';
  }
}

const STEM: Record<UiElement['kind'], string> = {
  text: 'text',
  shape: 'shape',
  image: 'image',
  svg: 'svg',
  led: 'led',
  canvas: 'canvas',
  code: 'code',
};

function requireUse(doc: PatchDocument, id: string): PatchNode & { part: string } {
  const use = doc.nodes[id];
  if (!use || use.type !== 'kit.part' || !use.part || !doc.parts[use.part])
    throw new FaceError(`"${id}" is not a use of a part.`);
  return use as PatchNode & { part: string };
}

/** What is on the plugin as a use's face now (its group's members). */
export function faceOnPlugin(doc: PatchDocument, use: string): string[] {
  return (doc.ui.groups[faceGroup(use)] ?? []).filter(id => doc.nodes[id] || doc.ui.elements[id]);
}

const bounds = (rects: readonly Rect[]): Rect => {
  const x0 = Math.min(...rects.map(r => r.x)),
    y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)),
    y1 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const rectOf = (doc: PatchDocument, id: string): Rect | undefined =>
  doc.ui.elements[id]?.rect ?? doc.nodes[id]?.panel;

/**
 * The intents that put the face of `useId` on the plugin: where it already is
 * (replacing it), at `at`, or in the first free space. Controls the face has
 * for parameters the part no longer has, and pictures this patch does not
 * have, are left out (and said in `notes`).
 */
export function faceIntents(
  doc: PatchDocument,
  catalog: Catalog,
  useId: string,
  options: { at?: { x: number; y: number }; taken?: ReadonlySet<string> } = {},
): { intents: Intent[]; rect: Rect; placed: boolean; notes: string[]; group: string } {
  const use = requireUse(doc, useId);
  if (use.inside !== undefined)
    throw new FaceError(
      `${use.id} is inside a part; faces go on the plugin from uses in the main patch (controls live there).`,
    );
  const def = doc.parts[use.part]!;
  const inputs = catalog.inputs(use);
  const face = faceOf(def, inputs);
  const intents: Intent[] = [],
    notes: string[] = [];
  // Out with the face that is there now; the new one takes its place.
  const old = faceOnPlugin(doc, use.id);
  const oldRect = old.length ? bounds(old.map(id => rectOf(doc, id)!).filter(Boolean)) : undefined;
  for (const id of old)
    intents.push(doc.nodes[id] ? { op: 'removeNode', id } : { op: 'removeElement', id });
  const spot = options.at
    ? { x: options.at.x, y: options.at.y, w: face.width, h: face.height }
    : oldRect
      ? { x: oldRect.x, y: oldRect.y, w: face.width, h: face.height }
      : freeSpot(
          {
            ...doc,
            nodes: Object.fromEntries(
              Object.entries(doc.nodes).filter(([id]) => !old.includes(id)),
            ),
            ui: {
              ...doc.ui,
              elements: Object.fromEntries(
                Object.entries(doc.ui.elements).filter(([id]) => !old.includes(id)),
              ),
            },
          },
          catalog,
          face.width,
          face.height,
        );
  const at = spot ?? { x: 16, y: 16, w: face.width, h: face.height };
  if (!spot)
    notes.push(
      `There was no free space for the face of ${use.id} (${face.width}×${face.height}); it went to the top left. Make the plugin bigger, or move things.`,
    );
  const taken = new Set<string>([...(options.taken ?? []), ...old]);
  const fresh = (prefix: string) => {
    const id = freshId(doc, prefix, taken);
    taken.add(id);
    return id;
  };
  const members: string[] = [];
  const widgetOf = new Map<PortId, string>();
  // Pictures and fonts: den-kit's own come in with the face; one this patch does not have leaves out what uses it.
  const lacking = new Map<string, string>();
  for (const [asset, where] of faceAssetUses(face)) {
    if (assetsOf(doc.files)[asset]) continue;
    if (SHOWCASE_ASSETS[asset]) {
      intents.push({ op: 'addAsset', asset: SHOWCASE_ASSETS[asset]! });
      continue;
    }
    for (const w of where) lacking.set(w, asset);
  }
  // Stacked as a plugin is drawn: backgrounds (shapes, pictures, canvases) under the controls, words and lamps over them.
  const under: Intent[] = [],
    controls: Intent[] = [],
    over: Intent[] = [];
  face.controls.forEach((c: FaceControl, i) => {
    const port = inputs.find(p => p.id === c.param && p.role === 'control');
    if (!port) {
      notes.push(
        `The face's control for "${c.param}" was left out: ${def.name} has no such parameter now.`,
      );
      return;
    }
    const id = fresh(
      c.type === 'ui.knob'
        ? 'knob'
        : c.type === 'ui.slider'
          ? 'slider'
          : c.type === 'ui.toggle'
            ? 'toggle'
            : 'button',
    );
    const widget: NewNode = {
      id,
      type: c.type,
      label: c.label ?? port.label ?? port.id,
      panel: { x: at.x + c.rect.x, y: at.y + c.rect.y, w: c.rect.w, h: c.rect.h },
      pos: { x: use.pos.x - 240, y: use.pos.y + i * 56 },
    };
    const current = use.values[port.id];
    if (port.type === 'gate') widget.values = { value: Boolean(current ?? port.default) };
    else {
      const config = knobConfig(port),
        { min, max } = config;
      widget.config = config;
      widget.values = {
        value: Math.min(max, Math.max(min, Number(current ?? port.default ?? min))),
      };
    }
    const missing = lacking.get(`control:${c.param}`);
    if (missing)
      notes.push(
        `The control for "${c.param}" has its plain look: its picture or font ("${missing}") is not in this patch (add it in Assets, then put the face again).`,
      );
    else if (c.style) widget.style = c.style;
    controls.push(
      { op: 'addNode', node: widget },
      {
        op: 'connect',
        from: { node: id, port: 'out' },
        to: { node: use.id, port: port.id },
        replace: true,
      },
    );
    widgetOf.set(port.id, id);
    members.push(id);
  });
  for (const e of face.elements) {
    const missing = lacking.get(`element:${e.id}`);
    if (missing) {
      notes.push(
        `A ${e.kind === 'image' ? 'picture' : 'decoration'} of the face was left out: its ${e.kind === 'text' ? 'font' : 'picture'} ("${missing}") is not in this patch (add it in Assets, then put the face again).`,
      );
      continue;
    }
    let element = {
      ...structuredClone(e),
      id: fresh(STEM[e.kind]),
      rect: { ...e.rect, x: at.x + e.rect.x, y: at.y + e.rect.y },
    } as UiElement;
    if ('bind' in element && element.bind && element.bind !== '@level') {
      const [param, rest] = element.bind.split('.');
      const widget = widgetOf.get(param!);
      if (widget) element.bind = rest ? `${widget}.${rest}` : widget;
      else if (element.kind === 'text' && wordsOnly(element)) element = wordsOnly(element)!;
      else {
        notes.push(
          `A ${element.kind === 'led' ? 'lamp' : 'readout'} of the face followed "${param}", which has no control here; it was left out.`,
        );
        continue;
      }
    }
    (element.kind === 'text' || element.kind === 'led' ? over : under).push({
      op: 'addElement',
      element: element as unknown as NewElement,
    });
    members.push(element.id);
  }
  intents.push(...under, ...controls, ...over);
  const group = faceGroup(use.id);
  if (members.length) intents.push({ op: 'group', ids: members, id: group });
  return { intents, rect: at, placed: !!spot || !!oldRect || !!options.at, notes, group };
}

/**
 * The face that the controls and decorations `ids` on the plugin make for the
 * part `useId` uses: controls wired to its parameters (others are left out),
 * decorations as they are, all relative to their bounding box. Binds to those
 * controls become binds to the parameters.
 */
export function faceFromPlugin(
  doc: PatchDocument,
  catalog: Catalog,
  useId: string,
  ids: readonly string[],
): { face: PartFace; members: string[]; notes: string[] } {
  const use = requireUse(doc, useId);
  const def = doc.parts[use.part]!;
  const notes: string[] = [];
  const params = new Set(def.params.map(p => p.id));
  const controls: Array<{ id: string; control: FaceControl }> = [];
  const elements: UiElement[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (node) {
      if (!node.panel || !CONTROL_OF[node.type]) continue;
      const wire = Object.values(doc.edges).find(
        e => e.from.node === id && e.to.node === use.id && params.has(e.to.port),
      );
      const type = node.type as FaceControl['type'];
      if (!wire || !(type in CONTROL_SIZE)) {
        notes.push(
          `${node.label ?? id} is not wired to a parameter of ${def.name}; it was left out of the face.`,
        );
        continue;
      }
      if (controls.some(c => c.control.param === wire.to.port)) {
        notes.push(`Two controls for "${wire.to.port}": ${node.label ?? id} was left out.`);
        continue;
      }
      controls.push({
        id,
        control: {
          param: wire.to.port,
          type,
          rect: { ...node.panel },
          ...(node.label ? { label: node.label } : {}),
          ...(node.style ? { style: structuredClone(node.style) } : {}),
        },
      });
      continue;
    }
    const el = doc.ui.elements[id];
    if (el) elements.push(el);
  }
  const kept = keepDecorations(
    doc,
    elements,
    new Map(controls.map(c => [c.id, c.control.param])),
    notes,
  );
  if (!controls.length && !kept.length)
    throw new FaceError(
      `Select controls wired to ${def.name}'s parameters (and the decorations that go with them) on the plugin.`,
    );
  const box = bounds([...controls.map(c => c.control.rect), ...kept.map(k => k.element.rect)]);
  const face: PartFace = {
    width: Math.max(24, Math.round(box.w)),
    height: Math.max(24, Math.round(box.h)),
    controls: controls.map(c => ({
      ...c.control,
      rect: { ...c.control.rect, x: c.control.rect.x - box.x, y: c.control.rect.y - box.y },
    })),
    elements: relative(kept, box),
  };
  return { face, members: [...controls.map(c => c.id), ...kept.map(k => k.from)], notes };
}

/**
 * The face of a part that is only a screen: decorations `ids` on the plugin as
 * they are (no controls; a text that showed a control keeps its words, a lamp
 * that followed one is left out, a lamp of the output level stays).
 */
export function screenFace(
  doc: PatchDocument,
  ids: readonly string[],
): { face: PartFace; members: string[]; notes: string[] } {
  const elements = ids.map(id => doc.ui.elements[id]).filter((e): e is UiElement => !!e);
  if (!elements.length)
    throw new FaceError(
      'Select decorations on the plugin (text, shapes, pictures, lamps) to make a screen part.',
    );
  const notes: string[] = [];
  const kept = keepDecorations(doc, elements, new Map(), notes);
  if (!kept.length)
    throw new FaceError(`Nothing selected can be on a screen part: ${notes.join(' ')}`);
  const box = bounds(kept.map(k => k.element.rect));
  return {
    face: {
      width: Math.max(24, Math.round(box.w)),
      height: Math.max(24, Math.round(box.h)),
      controls: [],
      elements: relative(kept, box),
    },
    members: kept.map(k => k.from),
    notes,
  };
}

/**
 * The intents that make decorations `ids` on the plugin a screen part: a part
 * with nothing inside but its face (named `name`, else after its first words),
 * one use of it in the main patch, and the decorations as that use's face.
 */
export function screenPartIntents(
  doc: PatchDocument,
  ids: readonly string[],
  name?: string,
): { intents: Intent[]; use: string; part: string; name: string; notes: string[] } {
  const made = screenFace(doc, ids);
  const first = made.face.elements.find(
    (e): e is TextElement => e.kind === 'text' && !!e.text.trim(),
  );
  const words = first ? first.text.trim().split('\n')[0]!.slice(0, 40) : '';
  const called =
    name?.trim().slice(0, 60) ||
    (words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Screen');
  const part = partIdFor(doc, called);
  const use = nextNodeId(doc, part);
  const ys = Object.values(doc.nodes)
    .filter(n => n.inside === undefined)
    .map(n => n.pos.y);
  const assets = Object.fromEntries(
    [...faceAssetUses(made.face).keys()]
      .filter(id => assetsOf(doc.files)[id])
      .map(id => [id, assetsOf(doc.files)[id]!]),
  );
  const intents: Intent[] = [
    {
      op: 'importPart',
      bundle: {
        part: { id: part, name: called, inputs: [], outputs: [], params: [], face: made.face },
        parts: {},
        nodes: {},
        edges: {},
        assets,
      },
      node: use,
      pos: { x: 0, y: ys.length ? Math.max(...ys) + 240 : 0 },
    },
    { op: 'group', ids: made.members, id: faceGroup(use) },
  ];
  return { intents, use, part, name: called, notes: made.notes };
}

/** Decorations for a face: binds to the face's controls (`paramOf`: control id → parameter) become binds to the parameters; one that follows anything else keeps its words (text) or is left out (lamp). */
function keepDecorations(
  doc: PatchDocument,
  elements: readonly UiElement[],
  paramOf: ReadonlyMap<string, string>,
  notes: string[],
): Array<{ from: string; element: UiElement }> {
  const kept: Array<{ from: string; element: UiElement }> = [];
  for (const e of elements) {
    let copy = structuredClone(e);
    if ('bind' in copy && copy.bind && copy.bind !== '@level') {
      const [node, rest] = copy.bind.split('.');
      const param = paramOf.get(node!);
      const what = doc.nodes[node!]?.label ?? node;
      if (param) copy.bind = rest ? `${param}.${rest}` : param;
      else if (copy.kind === 'text' && wordsOnly(copy)) {
        copy = wordsOnly(copy)!;
        notes.push(`A text showing ${what} (not on the face) keeps its words only.`);
      } else {
        notes.push(
          `The ${copy.kind === 'led' ? 'lamp' : 'readout'} of ${what} was left out: ${what} is not on the face.`,
        );
        continue;
      }
    }
    kept.push({ from: e.id, element: copy });
  }
  return kept;
}
const relative = (kept: ReadonlyArray<{ element: UiElement }>, box: Rect): UiElement[] =>
  kept.map(
    ({ element }, i) =>
      ({
        ...element,
        id: `e${i + 1}`,
        rect: { ...element.rect, x: element.rect.x - box.x, y: element.rect.y - box.y },
      }) as UiElement,
  );

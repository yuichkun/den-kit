// A part's face: its own little screen — controls for its parameters and
// decorations — that goes on the plugin for one use at a time (src/plugin/faces.ts
// puts it there as ordinary controls and decorations). This file holds what a
// face is, the default face of a part that has none, and the checks.
import type { PortDef } from './catalog.ts';
import type { FaceControl, PartDef, PartFace } from './schema.ts';
import { CONTROL_OF } from './skins.ts';
import { UiCheckError, assetUses, checkElement, checkRect, checkWidgetStyle, emptyUi, type AssetMeta, type CheckContext, type TextElement, type UiElement, type WidgetStyle } from './ui.ts';

export const FACE_LIMITS = { controls: 32, elements: 64, size: 2000 } as const;
export const FACE_CONTROL_TYPES = ['ui.knob', 'ui.slider', 'ui.toggle', 'ui.button'] as const;
/** Default sizes of controls on the plugin (w, h). */
export const CONTROL_SIZE: Readonly<Record<FaceControl['type'], [number, number]>> = { 'ui.knob': [84, 96], 'ui.slider': [44, 160], 'ui.toggle': [90, 44], 'ui.button': [90, 44] };
const MARGIN = 12, GAP = 12, TITLE = 28, PER_ROW = 6;

/** The group a use's face is in on the plugin. */
export const faceGroup = (use: string) => `${use}Face`;

/** A face for a part that has none: its name over a knob (or a switch) per parameter, six to a row. */
export function defaultFace(def: PartDef, inputs: readonly PortDef[]): PartFace {
  const params = inputs.filter(p => p.role === 'control' && def.params.some(q => q.id === p.id)).slice(0, 12);
  const controls: FaceControl[] = [];
  let x = MARGIN, y = MARGIN + TITLE, rowH = 0, right = MARGIN;
  params.forEach((p, i) => {
    const type = p.type === 'gate' ? 'ui.toggle' : 'ui.knob';
    const [w, h] = CONTROL_SIZE[type];
    if (i && i % PER_ROW === 0) { x = MARGIN; y += rowH + GAP; rowH = 0; }
    controls.push({ param: p.id, type, rect: { x, y, w, h }, ...(p.label ? { label: p.label } : {}) });
    x += w + GAP; rowH = Math.max(rowH, h); right = Math.max(right, x - GAP);
  });
  const width = Math.max(180, right + MARGIN), height = controls.length ? y + rowH + MARGIN : MARGIN * 2 + TITLE;
  const elements: UiElement[] = [
    { id: 'frame', kind: 'shape', shape: 'rect', rect: { x: 0, y: 0, w: width, h: height }, style: { fill: [{ kind: 'color', color: 'track', opacity: 0.35 }], radius: 8 } },
    { id: 'title', kind: 'text', text: def.name, rect: { x: MARGIN, y: MARGIN - 4, w: width - MARGIN * 2, h: 22 }, textStyle: { size: 13, weight: 600, color: 'fg' } },
  ];
  return { width, height, controls, elements };
}

/** The face a part shows: its own, or the default one. */
export const faceOf = (def: PartDef, inputs: readonly PortDef[]): PartFace => def.face ?? defaultFace(def, inputs);

/**
 * Check a face for part `def` whose ports are `inputs`: controls only for its
 * parameters (a knob or slider for a number, a toggle or button for on/off, one
 * each), rects and decorations as on the plugin. Text and lamps bind to a
 * control by its parameter id. With `lenient` (a file, My parts) what refers
 * to things that are not there is reported through `warn` instead of refused.
 */
export function checkFace(raw: unknown, def: PartDef, inputs: readonly PortDef[], options: { assets: Readonly<Record<string, AssetMeta>>; lenient?: boolean; warn?(message: string): void }): PartFace {
  const bad = (message: string): never => { throw new UiCheckError('bad-face', `${def.name}'s face: ${message}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('a face is {width, height, controls, elements}.');
  const f = raw as Record<string, unknown>;
  const size = (v: unknown, what: string) => typeof v === 'number' && Number.isFinite(v) && v >= 24 && v <= FACE_LIMITS.size ? Math.round(v) : bad(`${what} must be from 24 to ${FACE_LIMITS.size}.`);
  const width = size(f.width, 'width'), height = size(f.height, 'height');
  if (!Array.isArray(f.controls) || f.controls.length > FACE_LIMITS.controls) bad(`controls is a list of up to ${FACE_LIMITS.controls}.`);
  if (!Array.isArray(f.elements) || f.elements.length > FACE_LIMITS.elements) bad(`elements is a list of up to ${FACE_LIMITS.elements}.`);
  const ports = new Map(inputs.filter(p => p.role === 'control' && def.params.some(q => q.id === p.id)).map(p => [p.id, p]));
  const controls: FaceControl[] = [];
  for (const c of f.controls as unknown[]) {
    if (!c || typeof c !== 'object') bad('a control is {param, type, rect}.');
    const r = c as Record<string, unknown>;
    const port = typeof r.param === 'string' ? ports.get(r.param) : undefined;
    if (!port) {
      const why = `a control is for "${String(r.param)}", which is not one of its parameters (${[...ports.keys()].join(', ') || 'it has none'}).`;
      if (options.lenient) { options.warn?.(`${def.name}'s face: ${why}`); continue; }
      bad(why);
    }
    if (controls.some(x => x.param === port!.id)) bad(`two controls for "${port!.id}".`);
    const type = r.type as FaceControl['type'];
    if (!FACE_CONTROL_TYPES.includes(type)) bad(`control type must be one of ${FACE_CONTROL_TYPES.join(', ')}.`);
    const gate = port!.type === 'gate';
    if (gate !== (type === 'ui.toggle' || type === 'ui.button')) bad(gate ? `"${port!.id}" is on/off: use ui.toggle or ui.button.` : `"${port!.id}" takes a number: use ui.knob or ui.slider.`);
    const control: FaceControl = { param: port!.id, type, rect: checkRect(r.rect, `the control for ${port!.id}'s rect`) };
    if (r.label !== undefined) { if (typeof r.label !== 'string') bad('a control label is text.'); control.label = String(r.label).slice(0, 80); }
    if (r.style !== undefined && r.style !== null) control.style = checkWidgetStyle(CONTROL_OF[type]!, r.style, { assets: options.assets, nodes: {}, lenient: options.lenient, warn: options.warn });
    controls.push(control);
  }
  // Decorations bind to the face's controls by parameter id.
  const ctx: CheckContext = { assets: options.assets, nodes: Object.fromEntries(controls.map(c => [c.param, true])), lenient: options.lenient, warn: options.warn };
  const elements: UiElement[] = [];
  const ids = new Set<string>();
  (f.elements as unknown[]).forEach((e, i) => {
    const raw = e && typeof e === 'object' ? { ...(e as Record<string, unknown>) } : e;
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) r.id = `e${i + 1}`;
    }
    const el = checkElement(raw, ctx);
    ids.add(el.id);
    elements.push(el);
  });
  return { width, height, controls, elements };
}

/**
 * The pictures and fonts a face uses, and where: asset id → the decorations
 * (`element:<id>`) and controls (`control:<param>`) that use it.
 */
export function faceAssetUses(face: PartFace): Map<string, string[]> {
  const elements = Object.fromEntries(face.elements.map(e => [`element:${e.id}`, { ...e, id: `element:${e.id}` } as UiElement]));
  return assetUses({ ...emptyUi(), elements }, face.controls.map(c => [`control:${c.param}`, c.style] as [string, WidgetStyle | undefined]));
}

/** A text that showed a control's value, without that control: its words only (null when it was only the value). */
export function wordsOnly(el: TextElement): TextElement | null {
  const { bind: _bind, ...rest } = el;
  const text = el.text.replaceAll('{value}', '').replace(/[ \t]{2,}/g, ' ').trim();
  return text ? { ...rest, text } : null;
}

/** "its own: 3 controls, 2 decorations" / "the default: 4 knobs" — for people and the AI. */
export function describeFace(def: PartDef, inputs: readonly PortDef[]): string {
  const face = faceOf(def, inputs);
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  return def.face ? `its own (${n(face.controls.length, 'control')}, ${n(face.elements.length, 'decoration')}, ${face.width}×${face.height})` : `the default (${n(face.controls.length, 'control')} under its name, ${face.width}×${face.height})`;
}

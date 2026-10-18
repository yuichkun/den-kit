// What "Add" puts on the plugin: decorations and controls with sensible first
// looks, sized for the plugin and placed where asked. Each becomes ordinary
// intents, so inserting is one undoable step like any other edit.
import type { Intent, NewElement } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import { partNames } from '../core/project.ts';
import type { Rect } from './spec.ts';

export const CANVAS_TEMPLATE = `// A canvas: draw(ctx, f) runs every frame (in a worker).
// f.w, f.h: its size · f.t, f.dt: seconds · f.level, f.peak: the sound now (0..1)
// f.wave, f.spectrum: the waveform and a 0..1 spectrum (Float32Array)
// f.value('knob1'), f.norm('knob1'): a control's value (raw, or 0..1)
// f.color('accent'): the look's colours · f.props: your settings · f.state: kept between frames
// To play it with the mouse, export { draw, pointer(e, f) } instead: e.type is down, move,
// up, wheel, double or leave at e.x, e.y; f.setNorm('knob1', 0..1) moves a control.
export default function draw(ctx, f) {
  ctx.clearRect(0, 0, f.w, f.h);
  const r = Math.min(f.w, f.h) * (0.12 + 0.38 * Math.min(1, f.level * 4));
  ctx.fillStyle = f.color('accent');
  ctx.shadowColor = f.color('glow');
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(f.w / 2, f.h / 2, r, 0, Math.PI * 2);
  ctx.fill();
}
`;

const SVG_TEMPLATE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#e8e8e8" stroke-width="4"/><path d="M50 14 L58 42 L86 50 L58 58 L50 86 L42 58 L14 50 L42 42 Z" fill="#ff9c1a"/></svg>';

export interface Insertable {
  key: string;
  title: string;
  doc: string;
  group: 'Decoration' | 'Control';
  /** More words that find it (old names). */ also?: string;
}
export const INSERTABLES: readonly Insertable[] = [
  { key: 'text', title: 'Text', doc: 'A title, a label, a note.', group: 'Decoration' },
  {
    key: 'value',
    title: 'Value readout',
    doc: "Shows a control's value as text.",
    group: 'Decoration',
  },
  { key: 'rect', title: 'Rectangle', doc: 'A panel, a frame, a strip.', group: 'Decoration' },
  { key: 'ellipse', title: 'Ellipse', doc: 'A circle or an oval.', group: 'Decoration' },
  { key: 'line', title: 'Line', doc: 'A divider (horizontal or vertical).', group: 'Decoration' },
  {
    key: 'picture',
    title: 'Picture',
    doc: 'One of the assets (drop files to add more).',
    group: 'Decoration',
  },
  { key: 'svg', title: 'SVG drawing', doc: 'Vector markup you can edit.', group: 'Decoration' },
  {
    key: 'led',
    title: 'Lamp (LED)',
    doc: 'Lights with a switch, a knob past a point, or the sound.',
    group: 'Decoration',
  },
  {
    key: 'canvas',
    title: 'Canvas (code)',
    doc: 'Your own drawing code, reacting to the sound and controls; it can take the mouse.',
    group: 'Decoration',
    also: 'custom part',
  },
  {
    key: 'code',
    title: 'Code part (web)',
    doc: "A part of the work's web project (TypeScript, any npm package), run in the pod.",
    group: 'Decoration',
    also: 'iframe vite npm three typescript project',
  },
  {
    key: 'knob',
    title: 'Knob',
    doc: 'Turn it; wire it to anything in the patch.',
    group: 'Control',
  },
  { key: 'slider', title: 'Slider', doc: 'A fader.', group: 'Control' },
  { key: 'toggle', title: 'Switch', doc: 'On/off (a gate).', group: 'Control' },
  { key: 'button', title: 'Button', doc: 'On while held.', group: 'Control' },
  { key: 'xy', title: 'XY pad', doc: 'Two values at once.', group: 'Control' },
  { key: 'keyboard', title: 'Keyboard', doc: 'Piano keys that play the patch.', group: 'Control' },
  { key: 'pads', title: 'Pads', doc: 'Big pads that play notes.', group: 'Control' },
  { key: 'scope', title: 'Scope', doc: 'The waveform of a signal.', group: 'Control' },
  { key: 'meter', title: 'Meter', doc: 'The level of a signal.', group: 'Control' },
];

const SIZE: Record<string, [number, number]> = {
  text: [180, 36],
  value: [120, 28],
  rect: [180, 110],
  ellipse: [100, 100],
  line: [200, 8],
  svg: [96, 96],
  led: [14, 14],
  canvas: [220, 120],
  code: [240, 140],
  knob: [84, 96],
  slider: [44, 160],
  toggle: [90, 44],
  button: [90, 44],
  xy: [180, 180],
  keyboard: [380, 90],
  pads: [300, 160],
  scope: [220, 90],
  meter: [24, 120],
};

/** The intents that add `key` centred at `at` (design pixels). `picture` takes the asset id. */
export function insertIntents(
  key: string,
  at: { x: number; y: number },
  doc: PatchDocument,
  options: {
    asset?: { id: string; width?: number; height?: number };
    bind?: string;
    /** A code part's new file(s) by its name (the template comes with them while the work has no project). */ codeFiles?: (
      name: string,
    ) => Record<string, string | null>;
  } = {},
): Intent[] {
  const [w, h] =
    key === 'picture' && options.asset ? fitPicture(options.asset, doc) : (SIZE[key] ?? [120, 80]);
  const rect: Rect = { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h };
  const controls = Object.values(doc.nodes).filter(
    n =>
      n.type.startsWith('ui.') &&
      n.type !== 'ui.keyboard' &&
      n.type !== 'ui.scope' &&
      n.type !== 'ui.meter',
  );
  const bind =
    options.bind ?? controls.find(n => n.type === 'ui.knob' || n.type === 'ui.slider')?.id;
  const element = (e: NewElement): Intent[] => [{ op: 'addElement', element: { ...e, rect } }];
  switch (key) {
    case 'text':
      return element({ kind: 'text', text: 'Text', textStyle: { size: 20 } });
    case 'value':
      return bind
        ? element({
            kind: 'text',
            text: '{value}',
            bind,
            textStyle: { font: 'valueFont', size: 16 },
          })
        : element({ kind: 'text', text: '0.00', textStyle: { font: 'valueFont', size: 16 } });
    case 'rect':
      return element({
        kind: 'shape',
        shape: 'rect',
        style: { fill: [{ kind: 'color', color: 'track' }], radius: 8 },
      });
    case 'ellipse':
      return element({
        kind: 'shape',
        shape: 'ellipse',
        style: { fill: [{ kind: 'color', color: 'accent' }] },
      });
    case 'line':
      return element({
        kind: 'shape',
        shape: 'line',
        style: { stroke: { color: 'fg', width: 1, style: 'solid' } },
      });
    case 'picture':
      return options.asset
        ? element({ kind: 'image', asset: options.asset.id, fit: 'contain' })
        : [];
    case 'svg':
      return element({ kind: 'svg', svg: SVG_TEMPLATE });
    case 'led': {
      const toggle = Object.values(doc.nodes).find(n => n.type === 'ui.toggle');
      return element({
        kind: 'led',
        bind: options.bind ?? toggle?.id ?? '@level',
        color: '#ff3b30',
      });
    }
    case 'canvas':
      return element({ kind: 'canvas', code: CANVAS_TEMPLATE });
    case 'code': {
      if (!options.codeFiles) return [];
      const taken = new Set(partNames(doc.project));
      let name = 'wave';
      for (let i = 2; taken.has(name); i++) name = `wave-${i}`;
      return [
        { op: 'setProjectFiles', files: options.codeFiles(name) },
        ...element({ kind: 'code', part: name, props: {} }),
      ];
    }
    default: {
      const type = key === 'pads' ? 'ui.keyboard' : `ui.${key}`;
      const label = INSERTABLES.find(i => i.key === key)?.title ?? key;
      return [
        {
          op: 'addNode',
          node: {
            type,
            label,
            pos: { x: -320, y: 40 * Object.keys(doc.nodes).length },
            panel: rect,
            ...(key === 'pads' ? { style: { skin: { name: 'pads' } } } : {}),
          },
        },
      ];
    }
  }
}

function fitPicture(
  asset: { width?: number; height?: number },
  doc: PatchDocument,
): [number, number] {
  const w0 = asset.width ?? 200,
    h0 = asset.height ?? 200;
  const k = Math.min(1, (doc.panel.width * 0.6) / w0, (doc.panel.height * 0.6) / h0);
  return [Math.max(8, Math.round(w0 * k)), Math.max(8, Math.round(h0 * k))];
}

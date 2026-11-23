// Ready starts for the work's icon and cover, made from the work itself: its look (background,
// colours, font), its name and the shape of one of its modules. A start is a list of ordinary
// operations, so it lands as one undo step and every piece of it can be changed by hand or by
// the AI afterwards.
import { drawable, ART_SIZE, type ArtSurfaceName } from './art.ts';
import type { Intent } from './ops.ts';
import type { PatchDocument, PatchNode } from './schema.ts';

/** Modules whose shape says most about a sound, first. */
const TELLING = [
  'den.filter',
  'den.characterFilter',
  'den.stateVariableFilter',
  'den.envelope',
  'den.curvedAdsr',
  'den.virtualAnalogSource',
  'den.frequencyModulation',
  'den.oscillator',
  'den.drive',
  'den.delayFx',
  'den.pingPongDelay',
  'den.algorithmicReverb',
];
/** The module a symbol of this work draws first: the most telling one it has. */
export function tellingModule(doc: PatchDocument): PatchNode | undefined {
  const nodes = Object.values(doc.nodes).filter(n => drawable(n));
  const rank = (n: PatchNode) => {
    const i = TELLING.indexOf(n.type);
    return i < 0 ? TELLING.length : i;
  };
  return nodes.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
}

/** The icon or the cover, started over from the work's look, name and most telling module. */
export function startFromLook(doc: PatchDocument, on: ArtSurfaceName): Intent[] {
  const background = doc.ui.look.background?.length
    ? doc.ui.look.background
    : [{ kind: 'color', color: 'bg' }];
  const module = tellingModule(doc);
  const intents: Intent[] = [
    { op: 'clearArt', on },
    { op: 'setArt', on, set: { background } },
  ];
  const { width, height } = ART_SIZE[on];
  if (on === 'icon') {
    if (module)
      intents.push({
        op: 'addElement',
        on,
        element: {
          id: 'symbol1',
          kind: 'symbol',
          node: module.id,
          ink: 'accent',
          weight: 6,
          rect: { x: 64, y: 64, w: width - 128, h: height - 128 },
        },
      });
    else
      intents.push({
        op: 'addElement',
        on,
        element: {
          id: 'initial',
          kind: 'text',
          text: (doc.name.trim()[0] ?? 'D').toUpperCase(),
          textStyle: {
            font: 'font',
            size: 300,
            weight: 700,
            color: 'accent',
            align: 'center',
            valign: 'middle',
          },
          rect: { x: 0, y: 0, w: width, h: height },
        },
      });
    return intents;
  }
  intents.push(
    {
      op: 'addElement',
      on,
      element: {
        id: 'title',
        kind: 'text',
        text: doc.name,
        textStyle: {
          font: 'font',
          size: 104,
          weight: 700,
          color: 'fg',
          align: 'left',
          valign: 'bottom',
          lineHeight: 1,
        },
        rect: { x: 96, y: 300, w: 720, h: 280 },
      },
    },
    {
      op: 'addElement',
      on,
      element: {
        id: 'rule',
        kind: 'shape',
        shape: 'rect',
        style: { fill: [{ kind: 'color', color: 'accent' }] },
        rect: { x: 96, y: 612, w: 120, h: 10 },
      },
    },
  );
  if (module)
    intents.push({
      op: 'addElement',
      on,
      element: {
        id: 'symbol1',
        kind: 'symbol',
        node: module.id,
        ink: 'accent',
        weight: 3,
        rect: { x: 820, y: 160, w: 380, h: 380 },
      },
    });
  return intents;
}

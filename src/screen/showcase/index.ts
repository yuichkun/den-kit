// The showcase: works built in den-kit itself, each a full work (sound and
// plugin): instruments, effects, and installations that play by themselves.
// Each screen follows the thinking of an award-winning design (named in the
// work's file, with what it took). The start screen offers them; a work's look
// can be put on another (the Subway way: what to make × how it looks).
import type { Catalog } from '../../work/catalog.ts';
import type { Intent } from '../../work/ops.ts';
import type { PatchDocument } from '../../work/schema.ts';
import { assetUses, type WidgetStyle, assetsOf } from '../../work/ui.ts';
import { acid } from './acid.ts';
import { breath } from './breath.ts';
import { duck } from './duck.ts';
import { lofi } from './lofi.ts';
import { rain } from './rain.ts';
import { supersaw } from './supersaw.ts';
import { tapeecho } from './tapeecho.ts';
import { tide } from './tide.ts';
import { tonic } from './tonic.ts';
import { toy } from './toy.ts';

export interface Work {
  id: string;
  title: string;
  kind: 'Instrument' | 'Effect' | 'Installation';
  /** What the work is, in a line (the start screen shows it). */
  prompt: string;
  /** The award-winning design whose thinking the screen follows (the work's file says what it took). */
  reference: string;
  build(catalog: Catalog): PatchDocument;
}

export const WORKS: readonly Work[] = [
  {
    id: 'acid',
    title: 'Contour',
    kind: 'Instrument',
    prompt: 'An acid bass whose filter is a hill: drag its summit, the sweep and the decay',
    reference: 'Red Dot: Best of the Best 2016, User Interface Design: Elektron Overbridge',
    build: acid,
  },
  {
    id: 'supersaw',
    title: 'Septet',
    kind: 'Instrument',
    prompt: 'A supersaw: seven saws per note, each in its own lane, with detune and drift',
    reference: 'Red Dot 2018, Product Design: Tektronix 5 Series MSO',
    build: supersaw,
  },
  {
    id: 'tonic',
    title: 'Tonic',
    kind: 'Instrument',
    prompt:
      'A tanpura drone to sing over: four plucked strings on the tonic, the notes round a circle',
    reference: 'Apple Design Awards 2021, Innovation winner: NaadSadhana',
    build: tonic,
  },
  {
    id: 'toy',
    title: 'Shape Drums',
    kind: 'Instrument',
    prompt: 'Drums for children: eight big shapes to tap, and a beat to play along with',
    reference: 'Apple Design Awards 2024, Interaction winner: Rytmos',
    build: toy,
  },
  {
    id: 'tapeecho',
    title: 'Echo Line',
    kind: 'Effect',
    prompt: 'A tape echo drawn as one line: in, onto the tape, and back as each echo returns',
    reference: 'iF DESIGN AWARD 2022: SIG CRUISER',
    build: tapeecho,
  },
  {
    id: 'duck',
    title: 'Yield',
    kind: 'Effect',
    prompt: 'A delay that gives way while you play, drawn as road signs you can read from afar',
    reference: 'iF DESIGN AWARD 2025: ABB A400 All-in-One EV Charger',
    build: duck,
  },
  {
    id: 'lofi',
    title: 'Low Res',
    kind: 'Effect',
    prompt:
      'Lo-fi: fewer bits, a slower rate, wobble and hiss, the sound drawn on the grid it snaps to',
    reference: 'CEDEC AWARDS 2018, Visual Arts top prize: the NieR:Automata UI design team',
    build: lofi,
  },
  {
    id: 'tide',
    title: 'Tide Bells',
    kind: 'Installation',
    prompt:
      'Six bells on a shore, rung by the waves: the tide at the hour you set decides which ones',
    reference: 'Apple Design Awards 2026, Visuals and Graphics winner: Tide Guide',
    build: tide,
  },
  {
    id: 'rain',
    title: 'Rain Field',
    kind: 'Installation',
    prompt:
      'Rain all around you: drops, wind, thunder and drips, each placed nearer or further, left or right',
    reference: 'Apple Design Awards 2022, Innovation winner: Odio',
    build: rain,
  },
  {
    id: 'breath',
    title: 'Exhale',
    kind: 'Installation',
    prompt:
      'A room that breathes: a soft chord and air swell in and out at the pace of slow breath',
    reference: 'Apple Design Awards 2021, Visuals and Graphics winner: Loóna',
    build: breath,
  },
];

export const findWork = (id: string) => WORKS.find(w => w.id === id);

/**
 * The intents that put `source`'s look on `doc`: its base theme, tokens, background,
 * control skins and CSS, with the pictures and fonts these use. The layout and the
 * decorations stay (they follow the new colours where they use the look's tokens).
 */
export function lookIntents(doc: PatchDocument, source: PatchDocument): Intent[] {
  const look = source.ui.look;
  const used = assetUses(
    { ...source.ui, elements: {}, underlay: undefined },
    [] as Array<[string, WidgetStyle | undefined]>,
  );
  const assets = [...used.keys()]
    .map(id => assetsOf(source.files)[id])
    .filter(a => a && !assetsOf(doc.files)[a.id]);
  return [
    ...assets.map(asset => ({ op: 'addAsset' as const, asset: asset! })),
    { op: 'setTheme', theme: source.panel.theme },
    { op: 'setLook', look, replace: true },
  ];
}

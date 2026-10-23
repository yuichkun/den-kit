// The showcase: the evaluation prompts built in den-kit itself, each a full
// work (sound and plugin). The start screen offers them; a work's look can be
// put on another (the Subway way: what to make × how it looks).
import type { Catalog } from '../../work/catalog.ts';
import type { Intent } from '../../work/ops.ts';
import type { PatchDocument } from '../../work/schema.ts';
import { assetUses, type WidgetStyle, assetsOf } from '../../work/ui.ts';
import { acid } from './acid.ts';
import { duck } from './duck.ts';
import { fuzz } from './fuzz.ts';
import { lofi } from './lofi.ts';
import { musicbox } from './musicbox.ts';
import { neon } from './neon.ts';
import { pad } from './pad.ts';
import { rain } from './rain.ts';
import { space } from './space.ts';
import { supersaw } from './supersaw.ts';
import { tapeecho } from './tapeecho.ts';
import { toy } from './toy.ts';

export interface Work {
  id: string;
  title: string;
  kind: 'Instrument' | 'Effect';
  /** The English description of the evaluation prompt. */
  prompt: string;
  /** What reference comes with it. */
  reference: string;
  build(catalog: Catalog): PatchDocument;
}

export const WORKS: readonly Work[] = [
  {
    id: 'acid',
    title: 'Acid Line',
    kind: 'Instrument',
    prompt: 'Acid bass. Fluorescent green on black, with large cutoff and resonance controls',
    reference: 'none (words only)',
    build: acid,
  },
  {
    id: 'pad',
    title: 'Afterglow',
    kind: 'Instrument',
    prompt:
      'A slowly moving, expansive pad. A sunset look, with brightness and movement on XY controls',
    reference: 'sunset photo',
    build: pad,
  },
  {
    id: 'musicbox',
    title: 'Lullaby Box',
    kind: 'Instrument',
    prompt: 'Metallic bells like a music box, with a wooden box and brass look',
    reference: 'wood and brass textures',
    build: musicbox,
  },
  {
    id: 'toy',
    title: 'Bop Box',
    kind: 'Instrument',
    prompt: 'A percussion instrument for children to play, with eight large, colorful pads',
    reference: 'hand-drawn layout sketch',
    build: toy,
  },
  {
    id: 'tapeecho',
    title: 'Reel Echo',
    kind: 'Effect',
    prompt: 'A 1970s tape echo, with a needle VU meter and spinning reels',
    reference: 'tape machine photo',
    build: tapeecho,
  },
  {
    id: 'fuzz',
    title: 'Ember Fuzz',
    kind: 'Effect',
    prompt: 'A guitar fuzz pedal, with a footswitch and LED',
    reference: 'hand-drawn layout sketch',
    build: fuzz,
  },
  {
    id: 'lofi',
    title: 'Side B',
    kind: 'Effect',
    prompt:
      'Cassette-style lo-fi. Reduce bit depth and add wow, flutter, and hiss, with a handwritten label',
    reference: 'cassette photo',
    build: lofi,
  },
  {
    id: 'space',
    title: 'Nebula',
    kind: 'Effect',
    prompt:
      'A space-themed ambience effect, with a starfield look and particles that move with the sound',
    reference: 'starfield photo',
    build: space,
  },
  {
    id: 'duck',
    title: 'Duck Delay',
    kind: 'Effect',
    prompt:
      'A delay that ducks while playing and blooms afterward, with an instrument-style display and a gain reduction meter',
    reference: 'none (words only)',
    build: duck,
  },
  {
    id: 'neon',
    title: 'Neon Sweep',
    kind: 'Effect',
    prompt: 'An XY filter performance effect, with a neon look and a glowing finger trail',
    reference: 'neon sign photo',
    build: neon,
  },
  // Parts and ×N (U5): one small thing made once and used many times, with its own face on the plugin.
  {
    id: 'rain',
    title: 'Rainfall',
    kind: 'Instrument',
    prompt:
      'Rain hitting a window. Layer a single raindrop, with manual controls for intensity, drop pitch, splashes, and wind',
    reference: 'none (words only)',
    build: rain,
  },
  {
    id: 'supersaw',
    title: 'Supersaw',
    kind: 'Instrument',
    prompt: 'A supersaw. Layer seven slightly offset sawtooth waves, with detune and width knobs',
    reference: 'none (words only)',
    build: supersaw,
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

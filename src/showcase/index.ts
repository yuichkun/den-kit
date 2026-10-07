// The showcase: the お題 (evaluation set) built in den-kit itself, each a full
// work (sound and plugin). The start screen offers them; a work's look can be
// put on another (the Subway way: what to make × how it looks).
import type { Catalog } from '../core/catalog.ts';
import type { Intent } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import { assetUses, type WidgetStyle } from '../core/ui.ts';
import { acid } from './acid.ts';
import { duck } from './duck.ts';
import { fuzz } from './fuzz.ts';
import { lofi } from './lofi.ts';
import { musicbox } from './musicbox.ts';
import { neon } from './neon.ts';
import { pad } from './pad.ts';
import { space } from './space.ts';
import { tapeecho } from './tapeecho.ts';
import { toy } from './toy.ts';

export interface Work {
  id: string;
  title: string;
  kind: 'Instrument' | 'Effect';
  /** The お題 sentence, given as is in the evaluation. */
  prompt: string;
  /** What reference comes with it. */
  reference: string;
  build(catalog: Catalog): PatchDocument;
}

export const WORKS: readonly Work[] = [
  { id: 'acid', title: 'Acid Line', kind: 'Instrument', prompt: 'アシッドベース。黒地に蛍光グリーン 1 色で、カットオフとレゾナンスを大きく', reference: 'none (words only)', build: acid },
  { id: 'pad', title: 'Afterglow', kind: 'Instrument', prompt: 'ゆっくり揺れながら広がるパッド。夕焼けの見た目で、XY で明るさと揺れを動かす', reference: 'sunset photo', build: pad },
  { id: 'musicbox', title: 'Lullaby Box', kind: 'Instrument', prompt: 'オルゴールみたいな金属的なベル。木箱と真鍮の見た目で', reference: 'wood and brass textures', build: musicbox },
  { id: 'toy', title: 'Bop Box', kind: 'Instrument', prompt: '子どもが叩いて遊べる打楽器。カラフルで大きいパッドを 8 つ', reference: 'hand-drawn layout sketch', build: toy },
  { id: 'tapeecho', title: 'Reel Echo', kind: 'Effect', prompt: '70 年代のテープエコー。針の VU メーターと、回るリールを付けて', reference: 'tape machine photo', build: tapeecho },
  { id: 'fuzz', title: 'Ember Fuzz', kind: 'Effect', prompt: 'ギター用のファズペダル。フットスイッチと LED を付けて', reference: 'hand-drawn layout sketch', build: fuzz },
  { id: 'lofi', title: 'Side B', kind: 'Effect', prompt: 'カセット風のローファイ。ビットを落として、ヨレとヒスを足す。ラベルは手書きで', reference: 'cassette photo', build: lofi },
  { id: 'space', title: 'Nebula', kind: 'Effect', prompt: '宇宙っぽい空間系。星空の見た目で、音に合わせて粒が動く', reference: 'starfield photo', build: space },
  { id: 'duck', title: 'Duck Delay', kind: 'Effect', prompt: '弾いている間は引っ込んで、弾き止めると広がるディレイ。計測器みたいな画面で、沈んだ量をメーターで見せて', reference: 'none (words only)', build: duck },
  { id: 'neon', title: 'Neon Sweep', kind: 'Effect', prompt: 'XY でフィルターを弾くエフェクト。ネオンの見た目で、指の軌跡が光る', reference: 'neon sign photo', build: neon },
];

export const findWork = (id: string) => WORKS.find(w => w.id === id);

/**
 * The intents that put `source`'s look on `doc`: its base theme, tokens, background,
 * control skins and CSS, with the pictures and fonts these use. The layout and the
 * decorations stay (they follow the new colours where they use the look's tokens).
 */
export function lookIntents(doc: PatchDocument, source: PatchDocument): Intent[] {
  const look = source.ui.look;
  const used = assetUses({ ...source.ui, elements: {}, underlay: undefined }, [] as Array<[string, WidgetStyle | undefined]>);
  const assets = [...used.keys()].map(id => source.assets[id]).filter(a => a && !doc.assets[a.id]);
  return [
    ...assets.map(asset => ({ op: 'addAsset' as const, asset: asset! })),
    { op: 'setTheme', theme: source.panel.theme },
    { op: 'setLook', look, replace: true },
  ];
}

// Pictures that ship with den-kit for the showcase (kit/public/showcase). Each
// carries where it came from and its licence; only CC0, public domain and own
// work are used (den is a public repository).
import type { AssetMeta, AssetSource } from '../core/ui.ts';

const own = (title: string) => ({
  title,
  author: 'den-kit',
  license: 'Own work (Apache-2.0, like den)',
});
const photo = (
  id: string,
  name: string,
  bytes: number,
  width: number,
  height: number,
  source: AssetSource,
): AssetMeta => ({
  id,
  name,
  mime: 'image/jpeg',
  bytes,
  width,
  height,
  url: `/showcase/${name}`,
  source,
});
export const SHOWCASE_ASSETS: Record<string, AssetMeta> = {
  'sc-brass-knob': {
    id: 'sc-brass-knob',
    name: 'brass-knob.svg',
    mime: 'image/svg+xml',
    bytes: 6649,
    width: 200,
    height: 200,
    url: '/showcase/brass-knob.svg',
    source: own('Brass knob, drawn in SVG'),
  },
  'sc-screw': {
    id: 'sc-screw',
    name: 'screw.svg',
    mime: 'image/svg+xml',
    bytes: 747,
    width: 100,
    height: 100,
    url: '/showcase/screw.svg',
    source: own('Slotted screw head, drawn in SVG'),
  },
  'sc-sketch-pads': {
    id: 'sc-sketch-pads',
    name: 'sketch-pads.svg',
    mime: 'image/svg+xml',
    bytes: 9270,
    width: 640,
    height: 500,
    url: '/showcase/sketch-pads.svg',
    source: own('Layout sketch for the toy percussion'),
  },
  'sc-sketch-pedal': {
    id: 'sc-sketch-pedal',
    name: 'sketch-pedal.svg',
    mime: 'image/svg+xml',
    bytes: 9573,
    width: 380,
    height: 470,
    url: '/showcase/sketch-pedal.svg',
    source: own('Layout sketch for the fuzz pedal'),
  },
  // Photos and textures (see public/showcase/SOURCES.md).
  'sc-sunset': photo('sc-sunset', 'sunset-sky.jpg', 100999, 1600, 1067, {
    title: 'Clouds in Queen Valley at sunset',
    author: 'Joshua Tree National Park (NPS)',
    license: 'Public domain',
    url: 'https://commons.wikimedia.org/wiki/File:Clouds_in_Queen_Valley_at_sunset_(50066228367).jpg',
  }),
  'sc-wood': photo('sc-wood', 'wood.jpg', 143192, 1024, 1024, {
    title: 'Wood 026',
    author: 'ambientCG',
    license: 'CC0 1.0',
    url: 'https://ambientcg.com/view?id=Wood026',
  }),
  'sc-brass': photo('sc-brass', 'brass.jpg', 69807, 1024, 1024, {
    title: 'Brushed brass paint (Apollo 11 interior)',
    author: 'NASA; Smithsonian Institution',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Brushed_brass_paint_(Apollo_11)_interior.png',
  }),
  'sc-tape-machine': photo('sc-tape-machine', 'tape-machine.jpg', 243775, 1600, 822, {
    title: 'Reel-to-reel tape recorder and player, c. 1943',
    author: 'Daderot',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Reel-to-reel_tape_recorder_and_player,_c._1943,_manufacturer_unknown_-_Museum_of_Science_and_Industry_(Chicago)_-_DSC06663.JPG',
  }),
  'sc-brushed-metal': photo('sc-brushed-metal', 'brushed-metal.jpg', 90791, 1024, 1024, {
    title: 'Metal 009',
    author: 'ambientCG',
    license: 'CC0 1.0',
    url: 'https://ambientcg.com/view?id=Metal009',
  }),
  'sc-cassette': photo('sc-cassette', 'cassette.jpg', 208609, 1600, 1060, {
    title: 'Compact cassette, endless tape loop',
    author: 'DiscoA340',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Compact_Cassette_Endless_Tape_Loop.jpg',
  }),
  'sc-paper': photo('sc-paper', 'paper.jpg', 80338, 1024, 1024, {
    title: 'Blank album flyleaf, 1870',
    author: 'Nationaal Archief',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Schutblad,_Bestanddeelnr_815_65.jpg',
  }),
  'sc-starfield': photo('sc-starfield', 'starfield.jpg', 252210, 1600, 1067, {
    title: 'Night sky over the Chisos Mountains',
    author: 'NPS Photo (Big Bend National Park)',
    license: 'Public domain',
    url: 'https://commons.wikimedia.org/wiki/File:Night_Sky_Over_Chisos_Mountains_(de3b5b2d-7015-4ca5-871b-4da5a8858774).jpg',
  }),
  'sc-neon': photo('sc-neon', 'neon.jpg', 172389, 1600, 1207, {
    title: 'A neon "OPEN" sign',
    author: 'Wilfredor',
    license: 'CC0',
    url: 'https://commons.wikimedia.org/wiki/File:Is_Open.jpg',
  }),
};

/** What each bundled picture shows, for the AI choosing one (it cannot see the files). */
export const PICTURE_DOC: Readonly<Record<string, string>> = {
  'sc-brass-knob':
    "A brass knob seen from above, pointer at 12 o'clock, transparent around it (for the image knob skin).",
  'sc-screw': 'A slotted steel screw head, transparent around it (for the corners of plates).',
  'sc-sketch-pads':
    'A pencil layout sketch of a pad grid on paper (an example of a reference picture).',
  'sc-sketch-pedal':
    'A pencil layout sketch of a guitar pedal on paper (an example of a reference picture).',
  'sc-sunset':
    'Blue evening sky with orange and pink clouds, a darker band at the bottom (photo, 3:2).',
  'sc-wood': 'Warm mid-brown wood grain running sideways (texture, square, tiles).',
  'sc-brass': 'Brushed brass, olive gold (texture, square).',
  'sc-tape-machine':
    'An old reel-to-reel tape machine: two clear reels on a grey crackle deck, dark surroundings (photo, wide).',
  'sc-brushed-metal': 'Grey brushed steel, brushed sideways (texture, square, tiles).',
  'sc-cassette': 'A clear compact cassette on a light grey background (photo, 3:2).',
  'sc-paper': 'Plain off-white paper (texture, square).',
  'sc-starfield':
    'Night sky full of stars and the Milky Way over dark mountain outlines (photo, 3:2).',
  'sc-neon': 'A red neon "OPEN" sign with a green line under it, on a dark wall (photo, 4:3).',
};

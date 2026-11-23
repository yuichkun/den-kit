// Shape Drums — a drum toy for children: eight shapes to tap, and a beat to join.
// Pitched toy drums (a sine with a pitch drop plus a little filtered noise) on
// a pentatonic scale, so any two taps sound good together; a soft shaker beat
// can be switched on to play along with.
// The design follows the thinking of Rytmos (Apple Design Awards 2024,
// Interaction): play is clear without being explained, the gestures are simple
// and fun, and each thing added joins the music. Every pad is a shape in its
// own colour, nothing needs reading, and the board under the pads answers each
// hit.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, r, wire, work } from './build.ts';

/** The board under the pads: a field of dots that jump with every hit. */
export const BOARD = `// A field of dots under the pads. A hit is a jump in the output level: the
// dots swell from the middle outwards and settle again. With the beat on
// (tbeat), the row of dots along the bottom ticks along with it.
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, hits: [] });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, step = 28;
    if (f.level > s.prev * 1.35 + 0.004) s.hits.push(f.t);
    s.prev = s.prev * 0.8 + f.level * 0.2;
    s.hits = s.hits.filter(t => f.t - t < 1.2).slice(-6);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = f.color('track');
    const cx = w / 2, cy = h * 0.45;
    for (let y = step / 2; y < h; y += step)
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot(x - cx, y - cy);
        let swell = 0;
        for (const t of s.hits) {
          const front = (f.t - t) * 700, k = Math.max(0, 1 - Math.abs(d - front) / 60);
          swell += k * (1 - (f.t - t) / 1.2);
        }
        ctx.beginPath(); ctx.arc(x, y, 2.2 + Math.min(4, swell * 4), 0, Math.PI * 2); ctx.fill();
      }
  },
};
`;

/** The shapes on the pads, one per sound (drawn in a 100×100 box, filled with `c`). */
const SHAPES: Array<(c: string) => string> = [
  c => `<circle cx="50" cy="50" r="42" fill="${c}"/>`,
  c => `<rect x="12" y="12" width="76" height="76" rx="12" fill="${c}"/>`,
  c => `<path d="M50 8 L94 88 L6 88 Z" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`,
  c => `<path d="M50 4 L96 50 L50 96 L4 50 Z" fill="${c}"/>`,
  c => `<path d="M50 6 L88 28 L88 72 L50 94 L12 72 L12 28 Z" fill="${c}"/>`,
  c =>
    `<path d="M50 6 L61 38 L95 38 L68 58 L78 92 L50 72 L22 92 L32 58 L5 38 L39 38 Z" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
  c => `<path d="M6 70 A44 44 0 0 1 94 70 Z" fill="${c}"/>`,
  c => `<circle cx="50" cy="50" r="34" fill="none" stroke="${c}" stroke-width="16"/>`,
];
/** A pad's shape colour: the pad's own hue, deeper (the pads are hsl(hue 70% 80%)). */
const shapeColor = (i: number) => `hsl(${Math.round((360 * i) / 8)} 52% 44%)`;

export function toy(catalog: Catalog) {
  const knob = (accent: string) => ({
    skin: { name: 'ring', params: { thickness: 10, round: true, value: 'none' } },
    tokens: { accent },
    textStyle: { font: 'fredoka', size: 15, weight: 600, color: 'fg' },
  });
  return work(
    'toy',
    'Shape Drums',
    catalog,
    [720, 540],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
      add('penv1', 'den.envelope', {
        label: 'Pitch Env',
        values: { attack: 0, decay: 0.07, sustain: 0, release: 0.04 },
      }),
      add('pdepth1', 'kit.mul', { label: 'Bounce' }),
      add('pmod1', 'kit.pitchMod'),
      add('osc1', 'den.oscillator', { config: { waveform: 'sine' } }),
      add('noise1', 'den.seededNoise'),
      add('nfreq1', 'kit.mul', { label: 'Noise Pitch', values: { b: 3 } }),
      add('nfilter1', 'den.stateVariableFilter', { values: { q: 2.2 } }),
      add('nenv1', 'den.envelope', {
        label: 'Noise Env',
        values: { attack: 0, decay: 0.05, sustain: 0, release: 0.03 },
      }),
      add('nvca1', 'kit.mul', { label: 'Noise VCA' }),
      add('mix1', 'kit.mix', { config: { channels: 2 } }),
      add('aenv1', 'den.envelope', {
        label: 'Amp Env',
        values: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.06 },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vmix1', 'kit.voiceMix'),
      add('gain1', 'kit.gain', { values: { gain: 0.4 } }),
      add('room1', 'den.algorithmicReverb', {
        config: { roomScale: 0.7, decaySeconds: 0.9, dampingHz: 7000 },
        values: { mix: 0.16 },
      }),
      add('out1', 'kit.out'),
      wire('penv1.level', 'pdepth1.a'),
      wire('pdepth1.out', 'pmod1.semitones'),
      wire('voice1.pitch', 'pmod1.hz'),
      wire('pmod1.out', 'osc1.frequency'),
      wire('voice1.pitch', 'nfreq1.a'),
      wire('nfreq1.out', 'nfilter1.cutoffHz'),
      wire('noise1.out', 'nfilter1.input'),
      wire('nfilter1.bandpass', 'nvca1.a'),
      wire('nenv1.level', 'nvca1.b'),
      wire('osc1.out', 'mix1.in1'),
      wire('nvca1.out', 'mix1.in2'),
      wire('mix1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'vmix1.in'),
      wire('aenv1.done', 'vmix1.done'),
      wire('vmix1.out', 'gain1.in'),
      wire('room1.left', 'out1.left'),
      wire('room1.right', 'out1.right'),
      // ---- a beat to play along with: a soft shaker, on when the switch is ----
      add('beat1', 'den.musicalLfo', {
        label: 'Beat',
        config: { mode: 'tempo', waveform: 'square', beatsPerCycle: '1' },
        values: { rate: 100 },
      }),
      add('bgate1', 'kit.compare', { label: 'On the beat', values: { b: 0 } }),
      add('benv1', 'den.envelope', {
        label: 'Shake',
        values: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.05 },
      }),
      add('bnoise1', 'den.seededNoise', { label: 'Beads', config: { seed: 3 } }),
      add('bband1', 'den.stateVariableFilter', { label: 'Shaker', values: { cutoffHz: 6500, q: 1.4 } }),
      add('bvca1', 'kit.mul', { label: 'Shaker VCA' }),
      add('bon1', 'kit.mul', { label: 'Beat on' }),
      add('blevel1', 'kit.gain', { label: 'Beat level', values: { gain: 0.5 } }),
      add('sum1', 'kit.add', { label: 'Drums + beat' }),
      wire('beat1.value', 'bgate1.a'),
      wire('bgate1.out', 'benv1.gate'),
      wire('bnoise1.out', 'bband1.input'),
      wire('bband1.bandpass', 'bvca1.a'),
      wire('benv1.level', 'bvca1.b'),
      wire('bvca1.out', 'bon1.a'),
      wire('bon1.out', 'blevel1.in'),
      wire('gain1.out', 'sum1.a'),
      wire('blevel1.out', 'sum1.b'),
      wire('sum1.out', 'room1.left'),
      wire('sum1.out', 'room1.right'),
      // ---- the plugin: shapes on a board ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#fff8ec',
            fg: '#2d2a5a',
            accent: '#f2643f',
            track: '#efe2cb',
            knob: '#ffffff',
            pointer: '#2d2a5a',
            muted: '#6b6797',
            glow: '#f2643f',
            font: 'fredoka',
            labelFont: 'fredoka',
            valueFont: 'fredoka',
          },
          background: [{ kind: 'color', color: '#fff8ec' }],
          skins: {
            knob: { name: 'ring', params: { thickness: 10, round: true, value: 'none' } },
            toggle: { name: 'button', params: { radius: 30 } },
          },
        },
      },
      el({ kind: 'canvas', name: 'Board', code: BOARD, rect: r(0, 0, 720, 540) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Shape Drums',
        rect: r(40, 22, 360, 44),
        textStyle: { font: 'fredoka', size: 36, weight: 600, color: 'fg', align: 'left' },
      }),
      el({
        kind: 'text',
        name: 'Hint',
        text: 'Tap a shape. Turn on the beat and play along.',
        rect: r(40, 68, 420, 20),
        textStyle: { font: 'fredoka', size: 15, color: 'muted', align: 'left' },
      }),
      ...control('pads1', 'ui.keyboard', 'Pads', null, r(40, 104, 640, 300), {
        style: {
          skin: {
            name: 'pads',
            params: {
              count: 8,
              columns: 4,
              start: 48,
              scale: 'pentatonic',
              colors: 'pastel',
              radius: 30,
              gap: 18,
              labels: Array.from({ length: 8 }, () => '\u200b').join(','),
            },
          },
        },
      }),
      ...SHAPES.map((shape, i) => {
        const col = i % 4,
          row = Math.floor(i / 4);
        const pw = (640 - 3 * 18) / 4,
          ph = (300 - 18) / 2;
        const x = 40 + col * (pw + 18) + pw / 2,
          y = 104 + row * (ph + 18) + ph / 2;
        return el({
          kind: 'svg',
          name: `Shape ${i + 1}`,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${shape(shapeColor(i))}</svg>`,
          rect: r(Math.round(x - 34), Math.round(y - 38), 68, 68),
        });
      }),
      ...control('tbeat', 'ui.toggle', 'Beat', 'bon1.b', r(40, 436, 168, 60), {
        value: false,
        style: { textStyle: { font: 'fredoka', size: 18, weight: 600 } },
      }),
      ...control('kbounce', 'ui.knob', 'Bounce', 'pdepth1.b', r(300, 424, 100, 100), {
        min: 0,
        max: 24,
        unit: 'st',
        value: 14,
        style: knob('#d9480f'),
      }),
      ...control('kring', 'ui.knob', 'Ring', 'aenv1.decay', r(430, 424, 100, 100), {
        min: 0.05,
        max: 1.2,
        scale: 'log',
        unit: 's',
        value: 0.3,
        style: knob('#1971c2'),
      }),
      ...control('kfizz', 'ui.knob', 'Fizz', 'mix1.level2', r(560, 424, 100, 100), {
        min: 0,
        max: 2,
        value: 0.5,
        style: knob('#6741d9'),
      }),
    ],
  );
}

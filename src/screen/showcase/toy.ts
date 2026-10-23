// Evaluation prompt 4 — A percussion instrument for children to play, with eight large, colorful pads.
// Pitched toy drums (a sine with a pitch drop plus a little filtered noise),
// eight big pads on a pentatonic scale, a bright drawn screen. The hand-drawn
// layout sketch it was built from is kept as the reference picture.
import type { Catalog } from '../../work/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><g stroke="#ffb703" stroke-width="7" stroke-linecap="round">' +
  Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return `<line x1="${60 + 40 * Math.cos(a)}" y1="${60 + 40 * Math.sin(a)}" x2="${60 + 54 * Math.cos(a)}" y2="${60 + 54 * Math.sin(a)}"/>`;
  }).join('') +
  '</g><circle cx="60" cy="60" r="31" fill="#ffd166"/><circle cx="50" cy="55" r="4" fill="#5a3e00"/><circle cx="70" cy="55" r="4" fill="#5a3e00"/><path d="M47 68 Q60 80 73 68" fill="none" stroke="#5a3e00" stroke-width="4" stroke-linecap="round"/></svg>';
const CLOUD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M40 85 Q8 85 12 62 Q16 42 40 46 Q46 18 78 22 Q100 2 128 22 Q160 14 166 44 Q194 46 190 68 Q186 88 160 85 Z" fill="#ffffff" stroke="#bfe3ff" stroke-width="4"/></svg>';
const STAR = (c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 6 L62 38 L96 38 L68 58 L79 92 L50 72 L21 92 L32 58 L4 38 L38 38 Z" fill="${c}" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/></svg>`;

export function toy(catalog: Catalog) {
  const knob = (accent: string) => ({
    skin: { name: 'dot', params: { cap: '#ffffff', dot: accent, soft: 0.8, ring: true } },
    tokens: { accent, track: '#ffd9e6' },
    textStyle: {
      font: 'fredoka',
      size: 15,
      weight: 600,
      color: 'fg',
      case: 'upper' as const,
      spacing: 0.08,
    },
  });
  return work(
    'toy',
    'Bop Box',
    catalog,
    [640, 470],
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
      wire('gain1.out', 'room1.left'),
      wire('gain1.out', 'room1.right'),
      wire('room1.left', 'out1.left'),
      wire('room1.right', 'out1.right'),
      // ---- the plugin: big pads, drawn decorations ----
      asset('assets/den-kit/sketch-pads.svg'),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#fff3f8',
            fg: '#4a3a7a',
            accent: '#f0457a',
            track: '#ffe1ec',
            knob: '#ffffff',
            pointer: '#4a3a7a',
            muted: '#76669f',
            glow: '#ff9ec0',
            font: 'fredoka',
            labelFont: 'fredoka',
            valueFont: 'baloo-2',
          },
          background: [
            {
              kind: 'linear',
              angle: 160,
              stops: [
                { color: '#fff0f6', at: 0 },
                { color: '#e6f4ff', at: 0.55 },
                { color: '#fff7d6', at: 1 },
              ],
            },
          ],
          skins: { knob: { name: 'dot' } },
        },
      },
      {
        op: 'setUnderlay',
        underlay: { asset: 'assets/den-kit/sketch-pads.svg', opacity: 0.35, visible: false },
      },
      el({
        kind: 'shape',
        shape: 'ellipse',
        name: 'Blob pink',
        rect: r(-60, 300, 260, 220),
        style: { fill: [{ kind: 'color', color: '#ffd1e3' }], opacity: 0.7 },
        locked: true,
      }),
      el({
        kind: 'shape',
        shape: 'ellipse',
        name: 'Blob blue',
        rect: r(470, -50, 230, 190),
        style: { fill: [{ kind: 'color', color: '#cfe9ff' }], opacity: 0.8 },
        locked: true,
      }),
      el({ kind: 'svg', name: 'Cloud', svg: CLOUD, rect: r(352, 22, 130, 66) }),
      el({ kind: 'svg', name: 'Sun', svg: SUN, rect: r(536, 14, 88, 88) }),
      el({
        kind: 'svg',
        name: 'Star',
        svg: STAR('#ffd166'),
        rect: r(330, 400, 34, 34),
        style: { rotate: -12 },
      }),
      el({
        kind: 'svg',
        name: 'Star 2',
        svg: STAR('#7bdff2'),
        rect: r(596, 400, 26, 26),
        style: { rotate: 18 },
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Bop Box!',
        rect: r(28, 18, 330, 76),
        textStyle: {
          font: 'baloo-2',
          size: 62,
          weight: 700,
          color: 'accent',
          align: 'left',
          shadows: [
            { x: 3, y: 0, blur: 0, color: '#ffffff' },
            { x: -3, y: 0, blur: 0, color: '#ffffff' },
            { x: 0, y: 3, blur: 0, color: '#ffffff' },
            { x: 0, y: -3, blur: 0, color: '#ffffff' },
            { x: 0, y: 7, blur: 0, color: '#4a3a7a40' },
          ],
        },
        style: { rotate: -3 },
      }),
      ...control('pads1', 'ui.keyboard', 'Pads', null, r(28, 104, 584, 250), {
        style: {
          skin: {
            name: 'pads',
            params: {
              count: 8,
              columns: 4,
              start: 48,
              scale: 'pentatonic',
              colors: 'rainbow',
              radius: 26,
              gap: 14,
              labels: 'BOOM,BOP,PING,TAP,TICK,DING,BONK,POP',
            },
          },
          textStyle: { font: 'baloo-2', size: 22, weight: 700 },
        },
      }),
      ...control('kbounce', 'ui.knob', 'Bounce', 'pdepth1.b', r(40, 368, 96, 96), {
        min: 0,
        max: 24,
        unit: 'st',
        value: 14,
        style: knob('#ff8fab'),
      }),
      ...control('kring', 'ui.knob', 'Ring', 'aenv1.decay', r(150, 368, 96, 96), {
        min: 0.05,
        max: 1.2,
        scale: 'log',
        unit: 's',
        value: 0.3,
        style: knob('#7bdff2'),
      }),
      ...control('kfizz', 'ui.knob', 'Fizz', 'mix1.level2', r(260, 368, 96, 96), {
        min: 0,
        max: 2,
        value: 0.5,
        style: knob('#b28dff'),
      }),
    ],
  );
}

// Evaluation prompt 1 — Acid bass. Fluorescent green on black, with large cutoff and resonance controls.
// A mono saw/square bass through a driven ladder filter with a snappy envelope
// and glide; the screen is one colour on black, two big knobs, no pictures.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, r, wire, work } from './build.ts';

export function acid(catalog: Catalog) {
  const small = { skin: { name: 'ring', params: { thickness: 5, ticks: 0, round: false } } };
  return work(
    'acid',
    'Acid Line',
    catalog,
    [720, 400],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', {
        config: { mode: 'mono', capacity: 1, heldCapacity: 32, legato: true },
      }),
      add('glide1', 'den.pitchGlide'),
      add('mtof1', 'kit.mtof'),
      add('saw1', 'den.oscillator', { config: { waveform: 'saw' } }),
      add('sqr1', 'den.virtualAnalogSource', {
        config: { waveform: 'pulse' },
        values: { duty: 0.5 },
      }),
      add('wave1', 'kit.crossfade', { label: 'Saw / Square' }),
      add('fenv1', 'den.envelope', {
        label: 'Filter Env',
        values: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.08 },
      }),
      add('envamt1', 'kit.mul', { label: 'Env Amount' }),
      add('cut1', 'kit.cutoffMod'),
      add('ladder1', 'den.characterFilter'),
      add('aenv1', 'den.envelope', {
        label: 'Amp Env',
        values: { attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.06 },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('mix1', 'kit.voiceMix'),
      add('sat1', 'kit.tanh', { values: { drive: 1.3 } }),
      add('gain1', 'kit.gain', { values: { gain: 0.6 } }),
      add('out1', 'kit.out'),
      wire('voice1.note', 'glide1.target'),
      wire('glide1.out', 'mtof1.note'),
      wire('mtof1.out', 'saw1.frequency'),
      wire('mtof1.out', 'sqr1.frequencyHz'),
      wire('saw1.out', 'wave1.a'),
      wire('sqr1.out', 'wave1.b'),
      wire('wave1.out', 'ladder1.input'),
      wire('fenv1.level', 'envamt1.a'),
      wire('envamt1.out', 'cut1.octaves'),
      wire('cut1.out', 'ladder1.poleHz'),
      wire('ladder1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'mix1.in'),
      wire('aenv1.done', 'mix1.done'),
      wire('mix1.out', 'sat1.in'),
      wire('sat1.out', 'gain1.in'),
      wire('gain1.out', 'out1.left'),
      // ---- the plugin: one colour, two big knobs ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#030503',
            fg: '#b8ffae',
            accent: '#39ff14',
            track: '#0f2a0b',
            knob: '#071007',
            pointer: '#39ff14',
            muted: '#4f8a45',
            glow: '#39ff14',
            font: 'jetbrains-mono',
            labelFont: 'jetbrains-mono',
            valueFont: 'jetbrains-mono',
          },
          background: [
            { kind: 'color', color: '#030503' },
            {
              kind: 'radial',
              x: 0.3,
              y: 0,
              stops: [
                { color: '#39ff1418', at: 0 },
                { color: '#39ff1400', at: 1 },
              ],
            },
          ],
          skins: {
            knob: { name: 'ring', params: { thickness: 9, ticks: 31, round: false } },
            keyboard: {
              name: 'pads',
              params: {
                count: 13,
                columns: 13,
                start: 36,
                scale: 'chromatic',
                colors: 'outline',
                radius: 3,
                gap: 4,
              },
            },
          },
          css: 'dk-knob::part(label) { letter-spacing: .24em; }',
        },
      },
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Frame',
        rect: r(14, 14, 692, 372),
        style: { stroke: { color: 'accent', width: 1, style: 'solid' }, radius: 4, opacity: 0.55 },
        locked: true,
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'ACID',
        rect: r(32, 24, 220, 66),
        textStyle: {
          font: 'bebas-neue',
          size: 72,
          color: 'accent',
          align: 'left',
          spacing: 0.06,
          shadows: [{ x: 0, y: 0, blur: 14, color: 'glow' }],
        },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'MONO BASS · GLIDE · LADDER',
        rect: r(36, 88, 300, 18),
        textStyle: { size: 11, color: 'muted', align: 'left', spacing: 0.18 },
      }),
      ...control('scope1', 'ui.scope', 'OUT', null, r(404, 28, 284, 78), {
        style: {
          skin: {
            name: 'phosphor',
            params: { line: '#39ff14', surface: '#020902', glow: 9, persistence: 0.5 },
          },
          style: {
            stroke: { color: 'accent', width: 1, style: 'solid' },
            radius: 4,
            opacity: 0.95,
          },
        },
      }),
      wire('gain1.out', 'scope1.in'),
      el({
        kind: 'shape',
        shape: 'line',
        name: 'Rule',
        rect: r(32, 114, 656, 4),
        style: { stroke: { color: 'accent', width: 1, style: 'dashed' }, opacity: 0.6 },
      }),
      ...control('kcut', 'ui.knob', 'CUTOFF', 'cut1.hz', r(32, 128, 196, 196), {
        min: 40,
        max: 4000,
        scale: 'log',
        unit: 'Hz',
        value: 340,
        style: { textStyle: { size: 13 } },
      }),
      ...control('kres', 'ui.knob', 'RESONANCE', 'ladder1.resonance', r(236, 128, 196, 196), {
        min: 0,
        max: 1,
        value: 0.72,
        style: { textStyle: { size: 13 } },
      }),
      ...control('kenv', 'ui.knob', 'ENV MOD', 'envamt1.b', r(448, 128, 116, 96), {
        min: 0,
        max: 6,
        unit: 'oct',
        value: 3.4,
        style: small,
      }),
      ...control('kdec', 'ui.knob', 'DECAY', 'fenv1.decay', r(572, 128, 116, 96), {
        min: 0.03,
        max: 1.2,
        scale: 'log',
        unit: 's',
        value: 0.2,
        style: small,
      }),
      ...control('kglide', 'ui.knob', 'GLIDE', 'glide1.seconds', r(448, 228, 116, 96), {
        min: 0,
        max: 0.3,
        unit: 's',
        value: 0.06,
        style: small,
      }),
      ...control('kdrive', 'ui.knob', 'DRIVE', 'ladder1.drive', r(572, 228, 116, 96), {
        min: 1,
        max: 8,
        unit: 'gain',
        value: 2.2,
        style: small,
      }),
      ...control('tsq', 'ui.toggle', 'WAVE', 'wave1.mix', r(588, 330, 100, 46), {
        style: {
          skin: {
            name: 'switch',
            params: { style: 'slide', onText: 'SQR', offText: 'SAW', label: 'none' },
          },
        },
      }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(32, 334, 540, 42)),
    ],
  );
}

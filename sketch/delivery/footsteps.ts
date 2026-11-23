// The instrument the delivery sketch hands over: footsteps made of den blocks, as
// ordinary den-kit edits (src/screen/showcase/build.ts), so a person could build it
// by hand. A step is a burst of noise chopped into grains (Grit), shaped by a
// resonant band (Tone, Ring) and an envelope (Decay), over a low thump (Weight);
// a short delay adds the toe after the heel (Roll, Toe). Version 2 is the same
// work after the author changed it: a short heel click and finer grains.
import type { Catalog } from '../../src/work/catalog.ts';
import type { Intent } from '../../src/work/ops.ts';
import { add, control, el, r, wire, work } from '../../src/screen/showcase/build.ts';

export type FootstepsVersion = 1 | 2;

export function footsteps(catalog: Catalog, version: FootstepsVersion = 1) {
  const knob = (accent: string) => ({
    tokens: { accent },
    textStyle: {
      font: 'oswald',
      size: 13,
      weight: 400,
      color: 'muted',
      case: 'upper' as const,
      spacing: 0.12,
    },
  });
  const surface = knob('#f2b134');
  const body = knob('#7fc8a9');
  const click: Intent[] =
    version === 2
      ? [
          add('click1', 'den.stateVariableFilter', {
            label: 'Heel Click',
            values: { cutoffHz: 5200, q: 0.9 },
          }),
          add('cenv1', 'den.envelope', {
            label: 'Click Env',
            values: { attack: 0, decay: 0.012, sustain: 0, release: 0.01 },
          }),
          add('cvca1', 'kit.mul', { label: 'Click VCA' }),
          wire('noise1.out', 'click1.input'),
          wire('click1.highpass', 'cvca1.a'),
          wire('cenv1.level', 'cvca1.b'),
          wire('cvca1.out', 'mix1.in3'),
        ]
      : [];
  return work(
    'footsteps',
    'Footsteps',
    catalog,
    [620, 380],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 6, heldCapacity: 16 } }),
      // The surface: noise chopped into grains, through a resonant band.
      add('noise1', 'den.seededNoise', { config: { seed: 11 } }),
      add('gnoise1', 'den.seededNoise', { label: 'Grain Noise', config: { seed: 23 } }),
      add('glp1', 'den.filter', {
        label: 'Grain Rate',
        values: { cutoff: version === 2 ? 120 : 70, resonance: 0.7 },
      }),
      add('gclip1', 'kit.tanh', { label: 'Grain Shape', values: { drive: 30 } }),
      add('grain1', 'kit.tremolo', { label: 'Grains' }),
      add('band1', 'den.stateVariableFilter', { label: 'Surface' }),
      add('senv1', 'den.envelope', {
        label: 'Surface Env',
        values: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.08 },
      }),
      add('svca1', 'kit.mul', { label: 'Surface VCA' }),
      // The weight: a low thump with a quick drop in pitch.
      add('tpenv1', 'den.envelope', {
        label: 'Thump Pitch',
        values: { attack: 0, decay: 0.04, sustain: 0, release: 0.03 },
      }),
      add('tdepth1', 'kit.mul', { label: 'Thump Drop', values: { b: 14 } }),
      add('tpitch1', 'kit.pitchMod', { values: { hz: 58 } }),
      add('tosc1', 'den.oscillator', { config: { waveform: 'sine' } }),
      add('tenv1', 'den.envelope', {
        label: 'Thump Env',
        values: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 },
      }),
      add('tvca1', 'kit.mul', { label: 'Thump VCA' }),
      add('mix1', 'kit.mix', {
        config: { channels: version === 2 ? 3 : 2 },
        ...(version === 2 ? { values: { level3: 0.5 } } : {}),
      }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vmix1', 'kit.voiceMix'),
      add('level1', 'kit.gain', { label: 'Level' }),
      // The toe after the heel: one repeat, no feedback.
      add('toe1', 'den.delayFx', {
        label: 'Toe',
        config: { maxDelaySeconds: 0.5, tone: 'lowpass' },
        values: { feedback: 0, cutoffHz: 2400 },
      }),
      add('out1', 'kit.out'),
      wire('noise1.out', 'grain1.in'),
      wire('gnoise1.out', 'glp1.input'),
      wire('glp1.out', 'gclip1.in'),
      wire('gclip1.out', 'grain1.lfo'),
      wire('grain1.out', 'band1.input'),
      wire('band1.bandpass', 'svca1.a'),
      wire('senv1.level', 'svca1.b'),
      wire('tpenv1.level', 'tdepth1.a'),
      wire('tdepth1.out', 'tpitch1.semitones'),
      wire('tpitch1.out', 'tosc1.frequency'),
      wire('tosc1.out', 'tvca1.a'),
      wire('tenv1.level', 'tvca1.b'),
      wire('svca1.out', 'mix1.in1'),
      wire('tvca1.out', 'mix1.in2'),
      ...click,
      wire('mix1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'vmix1.in'),
      wire('senv1.done', 'vmix1.done'),
      wire('vmix1.out', 'level1.in'),
      wire('level1.out', 'toe1.left'),
      wire('toe1.left', 'out1.left'),
      wire('toe1.right', 'out1.right'),
      // ---- the plugin ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#1f2023',
            fg: '#ece6da',
            accent: '#f2b134',
            track: '#3a3c41',
            knob: '#2b2d31',
            pointer: '#ece6da',
            muted: '#a19a8e',
            glow: '#f2b13455',
            font: 'oswald',
            labelFont: 'oswald',
            valueFont: 'jetbrains-mono',
          },
          background: [
            {
              kind: 'linear',
              angle: 170,
              stops: [
                { color: '#26282c', at: 0 },
                { color: '#1a1b1e', at: 1 },
              ],
            },
          ],
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'FOOTSTEPS',
        rect: r(28, 20, 300, 44),
        textStyle: { font: 'oswald', size: 34, weight: 600, color: 'fg', spacing: 0.18 },
      }),
      el({
        kind: 'text',
        name: 'Surface label',
        text: 'SURFACE',
        rect: r(28, 78, 200, 18),
        textStyle: { font: 'oswald', size: 12, color: 'accent', spacing: 0.3 },
      }),
      el({
        kind: 'text',
        name: 'Body label',
        text: 'BODY',
        rect: r(28, 198, 200, 18),
        textStyle: { font: 'oswald', size: 12, color: '#7fc8a9', spacing: 0.3 },
      }),
      ...control('kTone', 'ui.knob', 'Tone', 'band1.cutoffHz', r(28, 98, 84, 92), {
        min: 200,
        max: 6000,
        scale: 'log',
        unit: 'Hz',
        value: 2400,
        style: surface,
      }),
      ...control('kRing', 'ui.knob', 'Ring', 'band1.q', r(120, 98, 84, 92), {
        min: 0.6,
        max: 10,
        scale: 'log',
        value: 1.2,
        style: surface,
      }),
      ...control('kDecay', 'ui.knob', 'Decay', 'senv1.decay', r(212, 98, 84, 92), {
        min: 0.03,
        max: 0.6,
        scale: 'log',
        unit: 's',
        value: 0.07,
        style: surface,
      }),
      ...control('kGrit', 'ui.knob', 'Grit', 'grain1.depth', r(304, 98, 84, 92), {
        min: 0,
        max: 1,
        value: 0.1,
        style: surface,
      }),
      ...control('kWeight', 'ui.knob', 'Weight', 'mix1.level2', r(28, 218, 84, 92), {
        min: 0,
        max: 1.5,
        value: 0.6,
        style: body,
      }),
      ...control(
        'kRoll',
        'ui.knob',
        'Roll',
        ['toe1.timeLeftSeconds', 'toe1.timeRightSeconds'],
        r(120, 218, 84, 92),
        { min: 0.04, max: 0.25, scale: 'log', unit: 's', value: 0.11, style: body },
      ),
      ...control('kToe', 'ui.knob', 'Toe', 'toe1.mix', r(212, 218, 84, 92), {
        min: 0,
        max: 0.6,
        value: 0.3,
        style: body,
      }),
      ...control('kLevel', 'ui.knob', 'Level', 'level1.gain', r(304, 218, 84, 92), {
        min: 0,
        max: 2,
        value: 0.8,
        style: body,
      }),
      ...control('pads1', 'ui.keyboard', 'Steps', null, r(412, 98, 180, 212), {
        style: {
          skin: {
            name: 'pads',
            params: {
              count: 2,
              columns: 2,
              start: 60,
              scale: 'major',
              colors: 'outline',
              radius: 10,
              gap: 10,
              labels: 'LEFT,RIGHT',
            },
          },
          textStyle: { font: 'oswald', size: 15, weight: 600, spacing: 0.2 },
        },
      }),
      el({
        kind: 'text',
        name: 'Version',
        text: version === 2 ? 'v2' : 'v1',
        rect: r(536, 30, 56, 20),
        textStyle: { font: 'jetbrains-mono', size: 12, color: 'muted', align: 'right' },
      }),
    ],
  );
}

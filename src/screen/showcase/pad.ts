// Evaluation prompt 2 — A slowly moving, expansive pad. A sunset look, with brightness and movement on XY controls.
// Two detuned saws per voice through a lowpass that opens slowly after each
// chord (the bloom), swayed by a slow free-running LFO; a chorus and a long
// reverb spread it. The XY pad plays it: across = brightness, up = sway (how
// far the LFO moves the filter, and how deep the chorus wobbles).
import type { Catalog } from '../../work/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export function pad(catalog: Catalog) {
  const knob = {
    skin: { name: 'dot', params: { cap: 'knob', dot: 'pointer', soft: 0.9, ring: true } },
    textStyle: {
      font: 'playfair-display',
      size: 14,
      italic: true,
      color: 'fg',
      shadows: [{ x: 0, y: 1, blur: 4, color: '#2b1a3add' }],
    },
  };
  return work(
    'pad',
    'Afterglow',
    catalog,
    [720, 460],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
      add('osc1', 'den.oscillator', { label: 'Saw 1', config: { waveform: 'saw' } }),
      add('det1', 'kit.pitchMod', { label: 'Detune', values: { semitones: 0.12 } }),
      add('osc2', 'den.oscillator', { label: 'Saw 2', config: { waveform: 'saw' } }),
      add('oscmix1', 'kit.mix', {
        label: 'Saws',
        config: { channels: 2 },
        values: { level1: 0.5, level2: 0.5 },
      }),
      add('fenv1', 'den.envelope', {
        label: 'Bloom',
        values: { attack: 2.4, decay: 3, sustain: 0.55, release: 3 },
      }),
      add('sway1', 'den.lfo', { label: 'Sway', values: { rate: 0.17 } }),
      add('xoct1', 'kit.scale', { label: 'X → octaves', values: { scale: 5.2, offset: 0 } }),
      add('ydepth1', 'kit.scale', { label: 'Y → sway depth', values: { scale: 2.2, offset: 0 } }),
      add('octs1', 'kit.mix', {
        label: 'Octaves',
        config: { channels: 3 },
        values: { level1: 1, level2: 0, level3: 1.6 },
      }),
      add('cut1', 'kit.cutoffMod', { values: { hz: 150 } }),
      add('lp1', 'den.filter', { label: 'Lowpass', values: { resonance: 0.9 } }),
      add('aenv1', 'den.envelope', {
        label: 'Amp Env',
        values: { attack: 1.2, decay: 1, sustain: 0.85, release: 2.6 },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vmix1', 'kit.voiceMix'),
      add('gain1', 'kit.gain', { values: { gain: 0.32 } }),
      add('ydepth2', 'kit.scale', {
        label: 'Y → chorus depth',
        values: { scale: 0.006, offset: 0.0008 },
      }),
      add('chorus1', 'den.delayFx', {
        label: 'Chorus',
        config: { maxDelaySeconds: 0.05, tone: 'flat', stereoPhaseCycles: 0.25 },
        values: {
          timeLeftSeconds: 0.014,
          timeRightSeconds: 0.021,
          feedback: 0.12,
          mix: 0.5,
          rateHz: 0.23,
        },
      }),
      add('room1', 'den.algorithmicReverb', {
        label: 'Hall',
        config: { roomScale: 1.6, decaySeconds: 5.5, dampingHz: 5200 },
        values: { mix: 0.38 },
      }),
      add('out1', 'kit.out'),
      wire('voice1.pitch', 'osc1.frequency'),
      wire('voice1.pitch', 'det1.hz'),
      wire('det1.out', 'osc2.frequency'),
      wire('osc1.out', 'oscmix1.in1'),
      wire('osc2.out', 'oscmix1.in2'),
      wire('oscmix1.out', 'lp1.input'),
      wire('xoct1.out', 'octs1.in1'),
      wire('sway1.out', 'octs1.in2'),
      wire('ydepth1.out', 'octs1.level2'),
      wire('fenv1.level', 'octs1.in3'),
      wire('octs1.out', 'cut1.octaves'),
      wire('cut1.out', 'lp1.cutoff'),
      wire('lp1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'vmix1.in'),
      wire('aenv1.done', 'vmix1.done'),
      wire('vmix1.out', 'gain1.in'),
      wire('gain1.out', 'chorus1.left'),
      wire('ydepth2.out', 'chorus1.depthSeconds'),
      wire('chorus1.left', 'room1.left'),
      wire('chorus1.right', 'room1.right'),
      wire('room1.left', 'out1.left'),
      wire('room1.right', 'out1.right'),
      // ---- the plugin: a sunset ----
      asset('assets/den-kit/sunset-sky.jpg'),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#2b1a3a',
            fg: '#fff4e8',
            accent: '#ffb36b',
            track: '#ffffff40',
            knob: '#fff4e8',
            pointer: '#ff7a59',
            muted: '#ffe0c2',
            glow: '#fff2c4',
            font: 'playfair-display',
            labelFont: 'playfair-display',
            valueFont: 'lato',
          },
          background: [
            { kind: 'image', asset: 'assets/den-kit/sunset-sky.jpg', fit: 'cover' },
            {
              kind: 'linear',
              angle: 180,
              stops: [
                { color: '#2b1a3a00', at: 0.45 },
                { color: '#2b1a3acc', at: 1 },
              ],
            },
          ],
          skins: { knob: { name: 'dot' } },
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Afterglow',
        rect: r(34, 22, 380, 70),
        textStyle: {
          font: 'playfair-display',
          size: 54,
          italic: true,
          color: 'fg',
          align: 'left',
          shadows: [{ x: 0, y: 2, blur: 18, color: '#7a2d4a99' }],
        },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'a slow pad that sways and spreads',
        rect: r(38, 88, 380, 22),
        textStyle: {
          font: 'lato',
          size: 14,
          color: 'muted',
          align: 'left',
          spacing: 0.04,
          shadows: [
            { x: 0, y: 1, blur: 3, color: '#3a1d3add' },
            { x: 0, y: 0, blur: 10, color: '#3a1d3a99' },
          ],
        },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Glass',
        rect: r(34, 124, 420, 300),
        locked: true,
        style: {
          radius: 22,
          fill: [{ kind: 'color', color: '#ffffff1f' }],
          stroke: { color: '#ffffff55', width: 1, style: 'solid' },
          shadows: [{ x: 0, y: 12, blur: 30, spread: 0, color: '#2b1a3a55', inset: false }],
        },
      }),
      // The knobs sit on a smoked glass, so their names read over the bright clouds.
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Smoked glass',
        rect: r(476, 124, 236, 316),
        locked: true,
        style: {
          radius: 22,
          fill: [{ kind: 'color', color: '#2b1a3a73' }],
          stroke: { color: '#ffffff40', width: 1, style: 'solid' },
          shadows: [{ x: 0, y: 12, blur: 30, spread: 0, color: '#2b1a3a55', inset: false }],
        },
      }),
      ...control('xy1', 'ui.xy', 'Brightness × Sway', null, r(34, 124, 420, 300), {
        values: { x: 0.55, y: 0.35 },
        style: {
          skin: {
            name: 'glow',
            params: {
              dot: 'glow',
              size: 26,
              trail: 46,
              glow: 30,
              crosshair: false,
              grid: false,
              label: 'none',
            },
          },
        },
      }),
      wire('xy1.x', 'xoct1.in'),
      wire('xy1.y', 'ydepth1.in'),
      wire('xy1.y', 'ydepth2.in'),
      el({
        kind: 'text',
        name: 'X label',
        text: 'brighter →',
        rect: r(300, 428, 154, 22),
        textStyle: {
          font: 'playfair-display',
          italic: true,
          size: 15,
          color: 'fg',
          align: 'right',
        },
      }),
      el({
        kind: 'text',
        name: 'Y label',
        text: 'more sway →',
        rect: r(-58, 262, 160, 22),
        textStyle: { font: 'playfair-display', italic: true, size: 15, color: 'fg' },
        style: { rotate: -90 },
      }),
      ...control('katt', 'ui.knob', 'Attack', 'aenv1.attack', r(492, 136, 96, 112), {
        min: 0.01,
        max: 6,
        scale: 'log',
        unit: 's',
        value: 1.2,
        style: knob,
      }),
      ...control('krel', 'ui.knob', 'Release', 'aenv1.release', r(600, 136, 96, 112), {
        min: 0.1,
        max: 10,
        scale: 'log',
        unit: 's',
        value: 2.6,
        style: knob,
      }),
      ...control('kbloom', 'ui.knob', 'Bloom', 'fenv1.attack', r(492, 264, 96, 112), {
        min: 0.05,
        max: 8,
        scale: 'log',
        unit: 's',
        value: 2.4,
        style: knob,
      }),
      ...control('kspace', 'ui.knob', 'Space', 'room1.mix', r(600, 264, 96, 112), {
        min: 0,
        max: 1,
        value: 0.38,
        style: knob,
      }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(492, 392, 204, 40), {
        style: {
          skin: { name: 'piano', params: { octaves: 1, start: 48, lit: '#ffb36b' } },
          style: { radius: 6, opacity: 0.92 },
        },
      }),
    ],
  );
}

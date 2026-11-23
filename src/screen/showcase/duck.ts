// Yield — a delay whose echoes give way while you play and come back when you stop.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop.
// The design follows the thinking of the ABB A400 EV charger's interface (iF
// DESIGN AWARD 2025): the clarity of road signs — heavy type, basic shapes,
// fixed and moving graphics together, and colours that always mean the same
// thing. Three signs: the echo (black), how far the echoes give way (amber,
// the one colour for ducking, wherever it appears), and what they are doing
// now. Each sign's number is its main setting, readable from across the room.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, r, wire, work } from './build.ts';

/** The colour that means "the echoes are giving way", everywhere on the plugin. */
const DUCK = '#f0a000';

export function duck(catalog: Catalog) {
  const slider = (fill: string) => ({
    skin: { name: 'bar', params: { radius: 0, label: 'top', fill } },
  });
  const sign = (name: string, x: number, band: string, ink: string, caption: string) => [
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} sign`,
      rect: r(x, 84, 232, 336),
      locked: true,
      style: { radius: 16, fill: [{ kind: 'color', color: '#ffffff' }], stroke: { color: '#111111', width: 3, style: 'solid' } },
    }),
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} band`,
      rect: r(x, 84, 232, 44),
      locked: true,
      style: { radius: 16, fill: [{ kind: 'color', color: band }] },
    }),
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} band edge`,
      rect: r(x, 112, 232, 16),
      locked: true,
      style: { fill: [{ kind: 'color', color: band }] },
    }),
    el({
      kind: 'text',
      name: `${name} title`,
      text: name,
      rect: r(x + 18, 92, 196, 30),
      textStyle: { font: 'bebas-neue', size: 28, color: ink, align: 'left', spacing: 0.06 },
    }),
    el({
      kind: 'text',
      name: `${name} caption`,
      text: caption,
      rect: r(x + 18, 140, 196, 14),
      textStyle: { size: 11, weight: 700, color: '#4d4d4d', align: 'left', spacing: 0.1, case: 'upper' },
    }),
  ];
  const figure = (name: string, bind: string, x: number) =>
    el({
      kind: 'text',
      name: `${name} figure`,
      text: '{value}',
      bind,
      rect: r(x + 16, 156, 200, 70),
      textStyle: { font: 'oswald', size: 58, weight: 600, color: '#111111', align: 'left' },
    });
  return work(
    'duck',
    'Yield',
    catalog,
    [768, 444],
    [
      // ---- sound ----
      add('in1', 'kit.audioIn'),
      add('dly1', 'den.delayFx', {
        config: { maxDelaySeconds: 2, tone: 'lowpass', stereoPhaseCycles: 0.5 },
        values: {
          timeLeftSeconds: 0.375,
          timeRightSeconds: 0.5,
          feedback: 0.5,
          cutoffHz: 4000,
          mix: 1,
        },
      }),
      add('duck1', 'den.dynamics', {
        label: 'Ducker',
        config: { mode: 'rms', operation: 'duck' },
        values: { thresholdDb: -32, ratio: 8, rangeDb: 24, attack: 0.008, release: 0.35 },
      }),
      add('mixl1', 'kit.mix', { label: 'Mix L', config: { channels: 2 }, values: { level2: 0.8 } }),
      add('mixr1', 'kit.mix', { label: 'Mix R', config: { channels: 2 }, values: { level2: 0.8 } }),
      add('gr1', 'kit.scale', { label: 'Ducking', values: { scale: -1, offset: 1 } }),
      add('out1', 'kit.out'),
      wire('in1.left', 'dly1.left'),
      wire('in1.right', 'dly1.right'),
      wire('dly1.left', 'duck1.left'),
      wire('dly1.right', 'duck1.right'),
      wire('in1.left', 'duck1.sidechainLeft'),
      wire('in1.right', 'duck1.sidechainRight'),
      wire('in1.left', 'mixl1.in1'),
      wire('duck1.left', 'mixl1.in2'),
      wire('in1.right', 'mixr1.in1'),
      wire('duck1.right', 'mixr1.in2'),
      wire('mixl1.out', 'out1.left'),
      wire('mixr1.out', 'out1.right'),
      wire('duck1.gain', 'gr1.in'),
      // ---- the plugin: three signs ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#ecebe6',
            fg: '#111111',
            accent: '#111111',
            track: '#dcdbd4',
            knob: '#ffffff',
            pointer: '#111111',
            muted: '#4d4d4d',
            glow: DUCK,
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'lato',
          },
          background: [{ kind: 'color', color: '#ecebe6' }],
          skins: {
            slider: { name: 'bar', params: { radius: 0, label: 'top' } },
            meter: { name: 'bar', params: { fill: DUCK, scale: false } },
          },
          css: [
            'dk-slider { position: relative; }',
            'dk-slider::part(label) { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #111; }',
            'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 12px; font-weight: 700; color: #111; }',
            'dk-slider::part(track) { max-height: 10px; margin-top: 4px; }',
          ].join('\n'),
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Yield',
        rect: r(24, 14, 200, 44),
        textStyle: { font: 'bebas-neue', size: 46, color: 'fg', align: 'left', spacing: 0.04 },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'A delay whose echoes give way while you play, and come back when you stop.',
        rect: r(24, 56, 560, 16),
        textStyle: { size: 12, color: 'muted', align: 'left' },
      }),
      // The echo: how long, how many, how bright, how loud.
      ...sign('Echo', 24, '#111111', '#ffffff', 'repeats every'),
      ...control(
        'ktime',
        'ui.slider',
        'Repeat',
        ['dly1.timeLeftSeconds', 'dly1.timeRightSeconds'],
        r(42, 238, 196, 36),
        { min: 0.05, max: 1.2, scale: 'log', unit: 's', value: 0.375, style: slider('#111111') },
      ),
      ...control('kfb', 'ui.slider', 'Feedback', 'dly1.feedback', r(42, 282, 196, 36), {
        min: 0,
        max: 0.9,
        value: 0.5,
        style: slider('#111111'),
      }),
      ...control('ktone', 'ui.slider', 'Tone', 'dly1.cutoffHz', r(42, 326, 196, 36), {
        min: 800,
        max: 12000,
        scale: 'log',
        unit: 'Hz',
        value: 4000,
        style: slider('#111111'),
      }),
      ...control('kmix', 'ui.slider', 'Echo level', ['mixl1.level2', 'mixr1.level2'], r(42, 370, 196, 36), {
        min: 0,
        max: 1.5,
        value: 0.8,
        style: slider('#111111'),
      }),
      // Giving way: how far down, from how loud, how fast back.
      figure('Echo', 'ktime', 24),
      ...sign('Give way', 274, DUCK, '#111111', 'echoes drop by up to'),
      ...control('kdepth', 'ui.slider', 'Depth', 'duck1.rangeDb', r(292, 238, 196, 36), {
        min: 0,
        max: 40,
        unit: 'dB',
        value: 24,
        style: slider(DUCK),
      }),
      ...control('kthresh', 'ui.slider', 'When louder than', 'duck1.thresholdDb', r(292, 282, 196, 36), {
        min: -60,
        max: 0,
        unit: 'dB',
        value: -32,
        style: slider(DUCK),
      }),
      ...control('krel', 'ui.slider', 'Back after', 'duck1.release', r(292, 326, 196, 36), {
        min: 0.05,
        max: 1.5,
        scale: 'log',
        unit: 's',
        value: 0.35,
        style: slider(DUCK),
      }),
      figure('Give way', 'kdepth', 274),
      // Now: how far the echoes are down at this moment, and what goes out.
      ...sign('Now', 524, '#111111', '#ffffff', 'echoes down / out'),
      ...control('grm1', 'ui.meter', 'Down', null, r(560, 168, 72, 220)),
      wire('gr1.out', 'grm1.in'),
      ...control('outm1', 'ui.meter', 'Out', null, r(668, 168, 52, 220), {
        style: { skin: { name: 'bar', params: { fill: '#111111', scale: false } } },
      }),
      wire('mixl1.out', 'outm1.in'),
      el({
        kind: 'text',
        name: 'Down label',
        text: 'down',
        rect: r(560, 394, 72, 16),
        textStyle: { size: 11, weight: 700, color: '#111111', align: 'center', case: 'upper', spacing: 0.1 },
      }),
      el({
        kind: 'text',
        name: 'Out label',
        text: 'out',
        rect: r(660, 394, 68, 16),
        textStyle: { size: 11, weight: 700, color: '#111111', align: 'center', case: 'upper', spacing: 0.1 },
      }),
    ],
  );
}

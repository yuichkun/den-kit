// Evaluation prompt 9 — A delay that ducks while playing and blooms afterward, with an instrument-style display and a gain reduction meter.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop. A bench instrument: phosphor scope, a ladder
// meter of how far the echoes sink, every value in numbers.
import type { Catalog } from '../core/catalog.ts';
import { add, control, el, r, wire, work } from './build.ts';

export function duck(catalog: Catalog) {
  const knob = {
    skin: { name: 'ring', params: { thickness: 3, ticks: 21, round: false, value: 'none' } },
    textStyle: { size: 11, case: 'upper' as const, spacing: 0.16, color: 'muted' },
  };
  const readout = (bind: string, x: number) =>
    el({
      kind: 'text',
      name: `${bind} readout`,
      text: '{value}',
      bind,
      rect: r(x, 270, 92, 22),
      textStyle: {
        font: 'share-tech-mono',
        size: 17,
        color: '#ffb000',
        shadows: [{ x: 0, y: 0, blur: 6, color: '#ffb00066' }],
      },
    });
  const names = ['ktime', 'kfb', 'ktone', 'kmix', 'kthresh', 'kdepth', 'krel'];
  return work(
    'duck',
    'Duck Delay',
    catalog,
    [780, 420],
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
      // ---- the plugin: a bench instrument ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#15181b',
            fg: '#d7e3ea',
            accent: '#5ec8ff',
            track: '#26313a',
            knob: '#2b3238',
            pointer: '#5ec8ff',
            muted: '#8fa3b3',
            glow: '#5ec8ff',
            font: 'share-tech-mono',
            labelFont: 'share-tech-mono',
            valueFont: 'share-tech-mono',
          },
          background: [
            {
              kind: 'linear',
              angle: 180,
              stops: [
                { color: '#1b1f23', at: 0 },
                { color: '#111417', at: 1 },
              ],
            },
          ],
          skins: { knob: { name: 'ring', params: { thickness: 3, ticks: 21 } } },
        },
      },
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Header',
        rect: r(0, 0, 780, 44),
        locked: true,
        style: {
          fill: [{ kind: 'color', color: '#0d1013' }],
          shadows: [{ x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff12', inset: false }],
        },
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'DUCK DELAY',
        rect: r(22, 8, 220, 28),
        textStyle: { size: 20, color: '#d7e3ea', align: 'left', spacing: 0.2 },
      }), // on the header bar: its own colours
      el({
        kind: 'text',
        name: 'Model',
        text: 'MODEL 9 · SIDECHAIN ECHO',
        rect: r(250, 12, 300, 22),
        textStyle: { size: 12, color: '#6f8494', align: 'left', spacing: 0.2 },
      }),
      el({
        kind: 'led',
        name: 'Signal',
        bind: '@level',
        color: '#3ddc84',
        threshold: 0,
        rect: r(744, 16, 12, 12),
      }),
      el({
        kind: 'text',
        name: 'Signal label',
        text: 'SIG',
        rect: r(706, 14, 34, 16),
        textStyle: { size: 11, color: '#6f8494', align: 'right' },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Screen',
        rect: r(22, 60, 560, 186),
        locked: true,
        style: {
          radius: 6,
          fill: [{ kind: 'color', color: '#04100a' }],
          stroke: { color: '#2b3a44', width: 2, style: 'solid' },
          shadows: [{ x: 0, y: 0, blur: 18, spread: 0, color: '#000000cc', inset: true }],
        },
      }),
      ...control('scope1', 'ui.scope', 'OUT', null, r(30, 68, 544, 170), {
        style: {
          skin: {
            name: 'phosphor',
            params: { line: '#7dff9a', surface: '#04100a', glow: 8, persistence: 0.7, grid: true },
          },
        },
      }),
      wire('mixl1.out', 'scope1.in'),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Meter bay',
        rect: r(600, 60, 158, 186),
        locked: true,
        style: {
          radius: 6,
          fill: [{ kind: 'color', color: '#0d1013' }],
          stroke: { color: '#2b3a44', width: 2, style: 'solid' },
        },
      }),
      ...control('grm1', 'ui.meter', 'DUCK', null, r(622, 76, 30, 140), {
        style: {
          skin: {
            name: 'led',
            params: {
              segments: 18,
              low: '#ffb000',
              mid: '#ff7a00',
              high: '#ff3b30',
              off: '#26313a',
            },
          },
        },
      }),
      wire('gr1.out', 'grm1.in'),
      ...control('outm1', 'ui.meter', 'OUT', null, r(706, 76, 30, 140), {
        style: { skin: { name: 'led', params: { segments: 18 } } },
      }),
      wire('mixl1.out', 'outm1.in'),
      el({
        kind: 'text',
        name: 'Duck label',
        text: 'DUCK',
        rect: r(610, 220, 54, 18),
        textStyle: { size: 12, color: '#ffb000' },
      }),
      el({
        kind: 'text',
        name: 'Out label',
        text: 'OUT',
        rect: r(694, 220, 54, 18),
        textStyle: { size: 12, color: '#3ddc84' },
      }),
      ...control(
        'ktime',
        'ui.knob',
        'Time',
        ['dly1.timeLeftSeconds', 'dly1.timeRightSeconds'],
        r(26, 298, 92, 104),
        { min: 0.05, max: 1.2, scale: 'log', unit: 's', value: 0.375, style: knob },
      ),
      ...control('kfb', 'ui.knob', 'Feedback', 'dly1.feedback', r(132, 298, 92, 104), {
        min: 0,
        max: 0.9,
        value: 0.5,
        style: knob,
      }),
      ...control('ktone', 'ui.knob', 'Tone', 'dly1.cutoffHz', r(238, 298, 92, 104), {
        min: 800,
        max: 12000,
        scale: 'log',
        unit: 'Hz',
        value: 4000,
        style: knob,
      }),
      ...control(
        'kmix',
        'ui.knob',
        'Echo',
        ['mixl1.level2', 'mixr1.level2'],
        r(344, 298, 92, 104),
        { min: 0, max: 1.5, value: 0.8, style: knob },
      ),
      ...control('kthresh', 'ui.knob', 'Thresh', 'duck1.thresholdDb', r(450, 298, 92, 104), {
        min: -60,
        max: 0,
        unit: 'dB',
        value: -32,
        style: knob,
      }),
      ...control('kdepth', 'ui.knob', 'Depth', 'duck1.rangeDb', r(556, 298, 92, 104), {
        min: 0,
        max: 40,
        unit: 'dB',
        value: 24,
        style: knob,
      }),
      ...control('krel', 'ui.knob', 'Release', 'duck1.release', r(662, 298, 92, 104), {
        min: 0.05,
        max: 1.5,
        scale: 'log',
        unit: 's',
        value: 0.35,
        style: knob,
      }),
      ...names.map((id, i) => readout(id, 26 + i * 106)),
    ],
  );
}

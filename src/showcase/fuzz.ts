// Evaluation prompt 6 — A guitar fuzz pedal, with a footswitch and LED.
// A guitar fuzz: tighten the lows, clip hard and lopsided (with anti-aliasing),
// tone and level, true bypass on the footswitch. The screen is a painted
// stompbox, built over its hand-drawn sketch (kept as the reference picture).
import type { Catalog } from '../core/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export function fuzz(catalog: Catalog) {
  const knob = {
    skin: {
      name: 'cap',
      params: {
        cap: '#151515',
        pointer: '#f4efe6',
        scale: '#fff6e8',
        ticks: 11,
        shape: 'line',
        label: 'bottom',
        value: 'none',
      },
    },
    textStyle: {
      font: 'oswald',
      size: 14,
      weight: 600,
      color: '#2b0d03',
      case: 'upper' as const,
      spacing: 0.14,
    },
  };
  return work(
    'fuzz',
    'Ember Fuzz',
    catalog,
    [360, 560],
    [
      // ---- sound ----
      add('in1', 'kit.audioIn'),
      add('tight1', 'den.stateVariableFilter', {
        label: 'Tighten',
        values: { cutoffHz: 140, q: 0.7 },
      }),
      add('fuzz1', 'den.drive', {
        config: { curve: 'asymmetric', quality: 'adaa', dcBlockHz: 12 },
        values: { gain: 18, mix: 1 },
      }),
      add('tone1', 'den.filter', { label: 'Tone', values: { cutoff: 2200, resonance: 0.6 } }),
      add('level1', 'kit.gain', { label: 'Level', values: { gain: 0.4 } }),
      add('bypass1', 'kit.crossfade', { label: 'Bypass' }),
      add('out1', 'kit.out'),
      wire('in1.left', 'tight1.input'),
      wire('tight1.highpass', 'fuzz1.input'),
      wire('fuzz1.out', 'tone1.input'),
      wire('tone1.out', 'level1.in'),
      wire('in1.left', 'bypass1.a'),
      wire('level1.out', 'bypass1.b'),
      wire('bypass1.out', 'out1.left'),
      // ---- the plugin: a painted stompbox ----
      asset('sc-screw'),
      asset('sc-sketch-pedal'),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#1c1714',
            fg: '#fff6e8',
            accent: '#ff3b1f',
            track: '#5a1d0c',
            knob: '#151515',
            pointer: '#f4efe6',
            muted: '#e9c9a8',
            glow: '#ff6a3a',
            font: 'oswald',
            labelFont: 'oswald',
            valueFont: 'oswald',
          },
          background: [
            {
              kind: 'radial',
              x: 0.5,
              y: 0.45,
              stops: [
                { color: '#3a2e27', at: 0 },
                { color: '#120e0c', at: 1 },
              ],
            },
          ],
        },
      },
      { op: 'setUnderlay', underlay: { asset: 'sc-sketch-pedal', opacity: 0.4, visible: false } },
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Enclosure',
        rect: r(30, 22, 300, 516),
        locked: true,
        style: {
          radius: 22,
          fill: [
            {
              kind: 'linear',
              angle: 165,
              stops: [
                { color: '#ff7a2a', at: 0 },
                { color: '#e2401a', at: 0.55 },
                { color: '#a52a0e', at: 1 },
              ],
            },
            {
              kind: 'radial',
              x: 0.3,
              y: 0.15,
              stops: [
                { color: '#ffffff40', at: 0 },
                { color: '#ffffff00', at: 0.6 },
              ],
            },
          ],
          shadows: [
            { x: 0, y: 18, blur: 30, spread: 0, color: '#000000aa', inset: false },
            { x: 0, y: 2, blur: 0, spread: 0, color: '#ffffff55', inset: true },
            { x: 0, y: -4, blur: 10, spread: 0, color: '#00000055', inset: true },
          ],
        },
      }),
      ...[
        [44, 36],
        [298, 36],
        [44, 506],
        [298, 506],
      ].map(([x, y], i) =>
        el({
          kind: 'image',
          name: `Screw ${i + 1}`,
          asset: 'sc-screw',
          fit: 'contain',
          rect: r(x!, y!, 18, 18),
          style: { rotate: i * 37 },
        }),
      ),
      ...control('klevel', 'ui.knob', 'Level', 'level1.gain', r(46, 66, 84, 104), {
        min: 0,
        max: 1,
        value: 0.4,
        style: knob,
      }),
      ...control('ktone', 'ui.knob', 'Tone', 'tone1.cutoff', r(138, 66, 84, 104), {
        min: 500,
        max: 6000,
        scale: 'log',
        unit: 'Hz',
        value: 2200,
        style: knob,
      }),
      ...control('kfuzz', 'ui.knob', 'Fuzz', 'fuzz1.gain', r(230, 66, 84, 104), {
        min: 2,
        max: 32,
        scale: 'log',
        value: 18,
        style: knob,
      }),
      el({
        kind: 'text',
        name: 'Name',
        text: 'Ember',
        rect: r(62, 226, 236, 80),
        textStyle: {
          font: 'kalam',
          size: 70,
          weight: 700,
          color: '#fff4e0',
          shadows: [{ x: 0, y: 3, blur: 0, color: '#7a1c06' }],
        },
        style: { rotate: -7 },
      }),
      el({
        kind: 'text',
        name: 'Kind',
        text: 'fuzz',
        rect: r(120, 294, 160, 40),
        textStyle: { font: 'kalam', size: 32, color: '#ffe2b8' },
        style: { rotate: -7 },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Switch plate',
        rect: r(110, 372, 140, 140),
        locked: true,
        style: {
          radius: 70,
          fill: [
            {
              kind: 'radial',
              x: 0.5,
              y: 0.4,
              stops: [
                { color: '#00000055', at: 0.55 },
                { color: '#00000000', at: 1 },
              ],
            },
          ],
        },
      }),
      ...control('fs1', 'ui.toggle', 'Stomp', 'bypass1.mix', r(120, 380, 120, 124), {
        value: true,
        style: {
          skin: { name: 'footswitch', params: { metal: '#d6d8dc', led: false, label: 'none' } },
        },
      }),
      el({ kind: 'led', name: 'LED', bind: 'fs1', color: '#ff2d1a', rect: r(172, 190, 16, 16) }),
    ],
  );
}

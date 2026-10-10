// Evaluation prompt 7 — Cassette-style lo-fi. Reduce bit depth in codebox and add wow, flutter, and hiss, with a handwritten label.
// A codebox crushes the sound (holds a sample every `rate` Hz, rounds it to
// `bits`), a short modulated delay makes it waver like a stretched tape, a
// lowpass dulls it and hiss is mixed in. The screen is a page of a scrapbook:
// paper, a cassette photo taped on with a handwritten label, ink faders.
import type { Catalog } from '../core/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export const CRUSHER = `import { defineSubgraph, f32, select, state, type Node } from '@unworklet/core';

// Lo-fi: hold a new sample \`rate\` times a second, rounded to \`bits\` bits.
export default defineSubgraph((config: { sampleRate: number }) => {
  const phase = state.f32(0).named('phase');
  const heldL = state.f32(0).named('heldL');
  const heldR = state.f32(0).named('heldR');
  return {
    tick(i: { left: Node<'f32'>; right: Node<'f32'>; bits: Node<'f32'>; rate: Node<'f32'> }) {
      const next = phase.read().add(i.rate.clamp(100, config.sampleRate).div(config.sampleRate));
      const take = next.gte(1);
      phase.write(select(take, next.sub(1), next));
      const steps = f32(2).pow(i.bits.clamp(2, 16).sub(1));
      const crush = (x: Node<'f32'>) => x.mul(steps).add(0.5).floor().div(steps);
      const left = select(take, crush(i.left), heldL.read());
      const right = select(take, crush(i.right), heldR.read());
      heldL.write(left);
      heldR.write(right);
      return { left, right };
    },
  };
});
`;

const HEART = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 90"><path d="M50 82 C18 60 6 42 10 26 C14 10 34 6 46 20 L50 26 L54 19 C66 5 88 10 90 28 C93 44 80 60 50 82 Z" fill="none" stroke="#c0392b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SCRIBBLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><path d="M4 26 C20 6 30 36 46 20 C60 6 70 34 86 18 C100 4 112 32 128 18 C142 6 152 30 168 16 C178 8 188 14 196 12" fill="none" stroke="#23395d" stroke-width="3" stroke-linecap="round"/></svg>';

export function lofi(catalog: Catalog) {
  const fader = { skin: { name: 'fader', params: { cap: 'knob', line: 'pointer', slot: 'track', capSize: 0.16, ticks: 7, label: 'bottom', value: 'bottom' } }, textStyle: { font: 'caveat', size: 21, color: 'fg' } };
  return work('lofi', 'Side B', catalog, [640, 470], [
    // ---- sound ----
    add('in1', 'kit.audioIn'),
    add('crush1', 'kit.codebox', { label: 'Crusher', code: CRUSHER, ports: { inputs: [{ id: 'left', type: 'signal' }, { id: 'right', type: 'signal' }, { id: 'bits', type: 'signal' }, { id: 'rate', type: 'signal' }], outputs: [{ id: 'left', type: 'signal' }, { id: 'right', type: 'signal' }] }, values: { bits: 8, rate: 11025 } }),
    add('wobble1', 'den.delayFx', { label: 'Wobble', config: { maxDelaySeconds: 0.05, tone: 'flat', stereoPhaseCycles: 0.1 }, values: { timeLeftSeconds: 0.012, timeRightSeconds: 0.012, feedback: 0, mix: 1, rateHz: 0.62, depthSeconds: 0.0015 } }),
    add('tonel1', 'den.filter', { label: 'Tone L', values: { cutoff: 5200, resonance: 0.6 } }),
    add('toner1', 'den.filter', { label: 'Tone R', values: { cutoff: 5200, resonance: 0.6 } }),
    add('noisel1', 'den.seededNoise', { label: 'Hiss L', config: { seed: 11 } }),
    add('noiser1', 'den.seededNoise', { label: 'Hiss R', config: { seed: 4242 } }),
    add('hpl1', 'den.stateVariableFilter', { label: 'Hiss tone L', values: { cutoffHz: 3200, q: 0.7 } }),
    add('hpr1', 'den.stateVariableFilter', { label: 'Hiss tone R', values: { cutoffHz: 3200, q: 0.7 } }),
    add('mixl1', 'kit.mix', { label: 'Mix L', config: { channels: 2 }, values: { level1: 1, level2: 0.012 } }),
    add('mixr1', 'kit.mix', { label: 'Mix R', config: { channels: 2 }, values: { level1: 1, level2: 0.012 } }),
    add('out1', 'kit.out'),
    wire('in1.left', 'crush1.left'), wire('in1.right', 'crush1.right'),
    wire('crush1.left', 'wobble1.left'), wire('crush1.right', 'wobble1.right'),
    wire('wobble1.left', 'tonel1.input'), wire('wobble1.right', 'toner1.input'),
    wire('noisel1.out', 'hpl1.input'), wire('noiser1.out', 'hpr1.input'),
    wire('tonel1.out', 'mixl1.in1'), wire('hpl1.highpass', 'mixl1.in2'), wire('toner1.out', 'mixr1.in1'), wire('hpr1.highpass', 'mixr1.in2'),
    wire('mixl1.out', 'out1.left'), wire('mixr1.out', 'out1.right'),
    // ---- the plugin: a scrapbook page ----
    asset('sc-paper'), asset('sc-cassette'),
    { op: 'setLook', look: {
      tokens: { bg: '#f1ead8', fg: '#23395d', accent: '#c0392b', track: '#23395d', knob: '#fffaf0', pointer: '#23395d', muted: '#5b6f8f', glow: '#e8b04a', font: 'caveat', labelFont: 'caveat', valueFont: 'kalam' },
      background: [{ kind: 'image', asset: 'sc-paper', fit: 'cover' }, { kind: 'color', color: '#f6e7c1', blend: 'multiply', opacity: 0.35 }],
      skins: { slider: { name: 'fader' } },
    } },
    el({ kind: 'text', name: 'Title', text: 'side B', rect: r(30, 18, 270, 76), textStyle: { font: 'kalam', size: 60, weight: 700, color: 'fg', align: 'left' }, style: { rotate: -4 } }),
    el({ kind: 'svg', name: 'Underline', svg: SCRIBBLE, rect: r(36, 92, 220, 30), style: { rotate: -4, opacity: 0.85 } }),
    el({ kind: 'text', name: 'Subtitle', text: 'fewer bits, a wobble, some hiss', rect: r(38, 128, 290, 30), textStyle: { font: 'caveat', size: 23, color: 'muted', align: 'left' } }),
    el({ kind: 'image', name: 'Cassette photo', asset: 'sc-cassette', fit: 'cover', rect: r(344, 34, 262, 174), style: { rotate: 3, stroke: { color: '#ffffff', width: 8, style: 'solid' }, shadows: [{ x: 2, y: 6, blur: 12, spread: 0, color: '#3a2a1055', inset: false }] } }),
    el({ kind: 'shape', shape: 'rect', name: 'Tape 1', rect: r(326, 22, 84, 26), locked: true, style: { rotate: -32, fill: [{ kind: 'color', color: '#efe2b8' }], opacity: 0.82, shadows: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#3a2a1033', inset: false }] } }),
    el({ kind: 'shape', shape: 'rect', name: 'Tape 2', rect: r(548, 196, 84, 26), locked: true, style: { rotate: -28, fill: [{ kind: 'color', color: '#efe2b8' }], opacity: 0.82, shadows: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#3a2a1033', inset: false }] } }),
    el({ kind: 'shape', shape: 'rect', name: 'Label', rect: r(398, 62, 156, 40), locked: true, style: { rotate: 3, radius: 3, fill: [{ kind: 'color', color: '#fffbea' }, { kind: 'linear', angle: 180, stops: [{ color: '#00000000', at: 0.62 }, { color: '#9bb6d455', at: 0.64 }, { color: '#00000000', at: 0.66 }] }], shadows: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#3a2a1044', inset: false }] } }),
    el({ kind: 'text', name: 'Label text', text: 'summer mix ’98', rect: r(398, 60, 156, 40), textStyle: { font: 'caveat', size: 25, weight: 700, color: '#c0392b' }, style: { rotate: 3 } }),
    el({ kind: 'svg', name: 'Heart', svg: HEART, rect: r(560, 300, 42, 38), style: { rotate: 12 } }),
    ...control('fbits', 'ui.slider', 'bits', 'crush1.bits', r(44, 196, 84, 250), { min: 2, max: 16, value: 8, style: fader }),
    ...control('frate', 'ui.slider', 'rate', 'crush1.rate', r(140, 196, 84, 250), { min: 1500, max: 48000, scale: 'log', unit: 'Hz', value: 11025, style: fader }),
    ...control('fwob', 'ui.slider', 'wobble', 'wobble1.depthSeconds', r(236, 196, 84, 250), { min: 0, max: 0.005, unit: 's', value: 0.0015, style: fader }),
    ...control('fhiss', 'ui.slider', 'hiss', ['mixl1.level2', 'mixr1.level2'], r(332, 226, 84, 220), { min: 0, max: 0.06, value: 0.012, style: fader }),
    ...control('ftone', 'ui.slider', 'tone', ['tonel1.cutoff', 'toner1.cutoff'], r(428, 226, 84, 220), { min: 900, max: 14000, scale: 'log', unit: 'Hz', value: 5200, style: fader }),
    el({ kind: 'text', name: 'Note', text: '← slide these', rect: r(512, 392, 120, 34), textStyle: { font: 'caveat', size: 22, color: 'muted' }, style: { rotate: -6 } }),
  ]);
}

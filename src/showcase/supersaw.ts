// お題 12 — スーパーソー。ノコギリ波を 7 本、少しずつずらして重ねる。デチューンと広がりをつまみで。
// One saw is a part (Saw): it reads its copy number, so copy k of 7 plays a
// little off the note — spread evenly from flat to sharp by Detune, plus a
// small fixed drift of its own. Used ×7 in every voice, its thick cable goes
// through Splay (Width: from one centre saw to a wall from left to right), a
// lowpass per side that opens with each note, and a hall. Detune and Drift
// are on the Saw's face on the plugin; turning them never recompiles.
import type { Catalog } from '../core/catalog.ts';
import type { PartFace } from '../core/schema.ts';
import { faceIntents } from '../plugin/faces.ts';
import { add, control, el, onlyParams, r, wire, workInSteps } from './build.ts';

/** How the knobs' names read on this plugin (the Saw's face and the others alike). */
const KNOB_TEXT = { textStyle: { font: 'michroma', size: 10, color: 'fg', case: 'upper' as const, spacing: 0.14 } };

/** The Saw's own screen: Detune and Drift under its name. */
export const SAW_FACE: PartFace = {
  width: 236, height: 152,
  controls: [
    { param: 'detune', type: 'ui.knob', rect: { x: 16, y: 46, w: 96, h: 100 }, label: 'Detune', style: KNOB_TEXT },
    { param: 'drift', type: 'ui.knob', rect: { x: 124, y: 46, w: 96, h: 100 }, label: 'Drift', style: KNOB_TEXT },
  ],
  elements: [
    { id: 'frame', kind: 'shape', shape: 'rect', rect: { x: 0, y: 0, w: 236, h: 152 }, style: { radius: 14, fill: [{ kind: 'color', color: '#1a0f2ad9' }], stroke: { color: '#ff3fd255', width: 1, style: 'solid' } } },
    { id: 'title', kind: 'text', text: 'SAW ×7', rect: { x: 16, y: 12, w: 150, h: 20 }, textStyle: { font: 'michroma', size: 14, color: 'accent', align: 'left', spacing: 0.2 } },
    { id: 'what', kind: 'text', text: 'seven saws, each a little off', rect: { x: 16, y: 30, w: 204, h: 14 }, textStyle: { size: 10, color: 'muted', align: 'left', spacing: 0.06 } },
  ],
};

export function supersaw(catalog: Catalog) {
  const knob = KNOB_TEXT;
  const panel = { radius: 14, fill: [{ kind: 'color' as const, color: '#1a0f2ad9' }], stroke: { color: '#ff3fd255', width: 1, style: 'solid' as const } };
  const inside = ['copy1', 'spread1', 'driftdir1', 'drift1', 'offset1', 'note1', 'mtof1', 'osc1'];
  return workInSteps('supersaw', 'Supersaw', catalog, [760, 440], [
    [
      // ---- one saw of seven: the note, moved by where this copy sits and a little drift of its own ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
      add('copy1', 'kit.copy', { label: 'Which saw' }),
      add('spread1', 'kit.mul', { label: 'Spread', values: { b: 0.35 } }),
      add('driftdir1', 'kit.scale', { label: 'Drift way', values: { scale: 2, offset: -1 } }),
      add('drift1', 'kit.mul', { label: 'Drift', values: { b: 0.08 } }),
      add('offset1', 'kit.add', { label: 'Off by' }),
      add('note1', 'kit.add', { label: 'Note' }),
      add('mtof1', 'kit.mtof'),
      add('osc1', 'den.oscillator', { label: 'Saw', config: { waveform: 'saw' } }),
      wire('copy1.position', 'spread1.a'), wire('copy1.random', 'driftdir1.in'), wire('driftdir1.out', 'drift1.a'),
      wire('spread1.out', 'offset1.a'), wire('drift1.out', 'offset1.b'),
      wire('voice1.note', 'note1.a'), wire('offset1.out', 'note1.b'), wire('note1.out', 'mtof1.note'), wire('mtof1.out', 'osc1.frequency'),
      // ---- the voice: Splay, a lowpass per side that opens with each note, the amp ----
      add('splay1', 'kit.splay', { label: 'Width', values: { width: 0.8 } }),
      add('fenv1', 'den.envelope', { label: 'Filter Env', values: { attack: 0.005, decay: 0.6, sustain: 0.4, release: 0.4 } }),
      add('envamt1', 'kit.mul', { label: 'Env Amount', values: { b: 2.5 } }),
      add('cut1', 'kit.cutoffMod', { values: { hz: 900 } }),
      add('lpl1', 'den.filter', { label: 'Lowpass L', values: { resonance: 0.9 } }),
      add('lpr1', 'den.filter', { label: 'Lowpass R', values: { resonance: 0.9 } }),
      add('aenv1', 'den.envelope', { label: 'Amp Env', values: { attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.5 } }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vcal1', 'kit.mul', { label: 'VCA L' }),
      add('vcar1', 'kit.mul', { label: 'VCA R' }),
      add('mixl1', 'kit.voiceMix', { label: 'Voices L' }),
      add('mixr1', 'kit.voiceMix', { label: 'Voices R' }),
      add('hall1', 'den.algorithmicReverb', { label: 'Hall', config: { roomScale: 1.2, decaySeconds: 2.8, dampingHz: 7000 }, values: { mix: 0.22 } }),
      add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.25 } }),
      add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.25 } }),
      add('out1', 'kit.out'),
      wire('osc1.out', 'splay1.in'),
      wire('splay1.left', 'lpl1.input'), wire('splay1.right', 'lpr1.input'),
      wire('fenv1.level', 'envamt1.a'), wire('envamt1.out', 'cut1.octaves'), wire('cut1.out', 'lpl1.cutoff'), wire('cut1.out', 'lpr1.cutoff'),
      wire('aenv1.level', 'vel1.a'), wire('voice1.velocity', 'vel1.b'),
      wire('lpl1.out', 'vcal1.a'), wire('vel1.out', 'vcal1.b'), wire('lpr1.out', 'vcar1.a'), wire('vel1.out', 'vcar1.b'),
      wire('vcal1.out', 'mixl1.in'), wire('vcar1.out', 'mixr1.in'), wire('aenv1.done', 'mixl1.done'), wire('aenv1.done', 'mixr1.done'),
      wire('mixl1.out', 'hall1.left'), wire('mixr1.out', 'hall1.right'),
      wire('hall1.left', 'gl1.in'), wire('hall1.right', 'gr1.in'), wire('gl1.out', 'out1.left'), wire('gr1.out', 'out1.right'),
      // The saw becomes a part (the note comes in, the saw goes out).
      { op: 'makePart', ids: inside, name: 'Saw', id: 'saw', node: 'saw1' },
    ],
    // Its knobs, in semitones: how far apart the seven are, and how far each drifts on its own.
    doc => onlyParams(doc, 'saw', [
      { node: 'spread1', port: 'b', id: 'detune', label: 'Detune', range: { min: 0, max: 1, unit: 'st' } },
      { node: 'drift1', port: 'b', id: 'drift', label: 'Drift', range: { min: 0, max: 0.5, unit: 'st' } },
    ]),
    [
      { op: 'updatePart', part: 'saw', doc: 'One saw of a supersaw: copy k of N plays the note off by its place (from −Detune to +Detune) and a small drift of its own. Use it ×7 into Splay.', labels: { a: 'Note' }, face: SAW_FACE },
      { op: 'setCount', node: 'saw1', count: 7 },
      // ---- the plugin: a neon wall of saws ----
      { op: 'setLook', look: {
        tokens: { bg: '#0b0614', fg: '#f5ecff', accent: '#ff3fd2', track: '#ffffff22', knob: '#1a0f2a', pointer: '#ff8ae6', muted: '#b6a3cc', glow: '#ff3fd2', font: 'lato', labelFont: 'michroma', valueFont: 'lato' },
        background: [
          { kind: 'linear', angle: 180, stops: [{ color: '#170a2a', at: 0 }, { color: '#0b0614', at: 1 }] },
          { kind: 'radial', x: 0.85, y: 0.05, stops: [{ color: '#ff3fd233', at: 0 }, { color: '#ff3fd200', at: 0.65 }] },
        ],
        skins: { knob: { name: 'ring', params: { thickness: 4, ticks: 0, round: true } }, keyboard: { name: 'piano', params: { octaves: 2, start: 48, lit: '#ff3fd2' } } },
      } },
      el({ kind: 'text', name: 'Title', text: 'SUPERSAW', rect: r(36, 20, 460, 56), textStyle: { font: 'michroma', size: 40, color: 'fg', align: 'left', spacing: 0.16, shadows: [{ x: 0, y: 0, blur: 16, color: '#ff3fd2aa' }] } }),
      el({ kind: 'text', name: 'Subtitle', text: 'SEVEN SAWS · DETUNE · WIDTH', rect: r(38, 78, 460, 16), textStyle: { font: 'lato', size: 11, color: 'muted', align: 'left', spacing: 0.28 } }),
      ...control('scope1', 'ui.scope', 'OUT', null, r(520, 24, 204, 70), { style: { style: { stroke: { color: '#ff3fd255', width: 1, style: 'solid' }, radius: 10, opacity: 0.95 } } }),
      wire('gl1.out', 'scope1.in'),
      el({ kind: 'shape', shape: 'rect', name: 'Tone panel', rect: r(290, 112, 434, 152), locked: true, style: panel }),
      ...control('kwidth', 'ui.knob', 'Width', 'splay1.width', r(302, 132, 96, 108), { min: 0, max: 1, value: 0.8, style: knob }),
      ...control('kcut', 'ui.knob', 'Cutoff', 'cut1.hz', r(408, 132, 96, 108), { min: 60, max: 8000, scale: 'log', unit: 'Hz', value: 900, style: knob }),
      ...control('kenv', 'ui.knob', 'Env', 'envamt1.b', r(514, 132, 96, 108), { min: 0, max: 6, unit: 'oct', value: 2.5, style: knob }),
      ...control('kres', 'ui.knob', 'Reso', ['lpl1.resonance', 'lpr1.resonance'], r(620, 132, 96, 108), { min: 0.5, max: 6, value: 0.9, style: knob }),
      el({ kind: 'shape', shape: 'rect', name: 'Amp panel', rect: r(36, 280, 688, 104), locked: true, style: panel }),
      ...control('katt', 'ui.knob', 'Attack', 'aenv1.attack', r(52, 284, 96, 96), { min: 0.001, max: 2, scale: 'log', unit: 's', value: 0.01, style: knob }),
      ...control('krel', 'ui.knob', 'Release', 'aenv1.release', r(156, 284, 96, 96), { min: 0.02, max: 4, scale: 'log', unit: 's', value: 0.5, style: knob }),
      ...control('kdec', 'ui.knob', 'Filter Decay', 'fenv1.decay', r(260, 284, 96, 96), { min: 0.02, max: 3, scale: 'log', unit: 's', value: 0.6, style: knob }),
      ...control('kspace', 'ui.knob', 'Space', 'hall1.mix', r(364, 284, 96, 96), { min: 0, max: 1, value: 0.22, style: knob }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(476, 296, 236, 72)),
    ],
    // The Saw's face on the plugin: Detune and Drift for all seven saws of every voice.
    doc => faceIntents(doc, catalog, 'saw1', { at: { x: 36, y: 112 } }).intents,
  ]);
}

// Starter patches: den's CANDIDATE instrument/delay settings rebuilt from
// modules. They double as the codegen yardstick (equivalence tests against den's
// createInstrument/delayFx). Values come from src/instrument-settings.ts and
// src/delay-settings.ts; the audio is CANDIDATE, never an approved golden.
import type { Catalog } from './catalog.ts';
import { applyIntents, type Intent } from './ops.ts';
import { emptyDocument, type PatchDocument } from './schema.ts';
import { withLayout } from './layout.ts';

const add = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}): Intent => ({ op: 'addNode', node: { id, type, pos: { x, y }, ...extra } });
const wire = (from: string, to: string): Intent => {
  const [fn, fp] = from.split('.'), [tn, tp] = to.split('.');
  return { op: 'connect', from: { node: fn!, port: fp! }, to: { node: tn!, port: tp! } };
};
const env = (a: number, d: number, s: number, r: number) => ({ attack: a, decay: d, sustain: s, release: r });

function build(name: string, catalog: Catalog, intents: Intent[]): PatchDocument {
  const doc = applyIntents(emptyDocument(name, `starter-${name.toLowerCase().replace(/\W+/g, '-')}`), intents, catalog).doc;
  return withLayout({ ...doc, revision: 0 }, catalog);
}

function monoVoice(kind: 'bass' | 'percussion'): Intent[] {
  const bass = kind === 'bass';
  return [
    add('voice1', 'kit.voiceIn', 0, 160, { config: { mode: 'mono', capacity: 1, heldCapacity: 32, legato: bass } }),
    ...(bass ? [] : [
      add('penv1', 'den.envelope', 200, 0, { label: 'Pitch Env', values: env(0, 0.06, 0, 0.04) }),
      add('pdepth1', 'kit.mul', 400, 0, { label: 'Pitch Depth', values: { b: 24 } }),
      add('pmod1', 'kit.pitchMod', 600, 40),
      wire('penv1.level', 'pdepth1.a'), wire('pdepth1.out', 'pmod1.semitones'), wire('voice1.pitch', 'pmod1.hz'),
    ]),
    add('osc1', 'den.oscillator', 800, 120, { config: { waveform: bass ? 'saw' : 'sine' } }),
    bass ? wire('voice1.pitch', 'osc1.frequency') : wire('pmod1.out', 'osc1.frequency'),
    add('fenv1', 'den.envelope', 200, 320, { label: 'Filter Env', values: bass ? env(0.003, 0.18, 0.2, 0.12) : env(0, 0.08, 0, 0.04) }),
    add('fdepth1', 'kit.mul', 400, 320, { label: 'Filter Depth', values: { b: bass ? 3 : 2 } }),
    add('cut1', 'kit.cutoffMod', 600, 320, { values: { hz: bass ? 300 : 800 } }),
    add('filter1', 'den.filter', 1000, 160, { values: { resonance: bass ? 0.707 : 0.5 } }),
    add('aenv1', 'den.envelope', 800, 440, { label: 'Amp Env', values: bass ? env(0.005, 0.12, 0.7, 0.12) : env(0.001, 0.22, 0, 0.04) }),
    add('vca1', 'kit.mul', 1200, 200, { label: 'VCA' }),
    add('vel1', 'kit.mul', 1400, 200, { label: 'Velocity' }),
    add('mix1', 'kit.voiceMix', 1600, 200),
    add('gain1', 'kit.gain', 1800, 200, { values: { gain: bass ? 0.12 : 0.16 } }),
    add('out1', 'kit.out', 2000, 200),
    wire('fenv1.level', 'fdepth1.a'), wire('fdepth1.out', 'cut1.octaves'), wire('cut1.out', 'filter1.cutoff'),
    wire('osc1.out', 'filter1.input'), wire('filter1.out', 'vca1.a'), wire('aenv1.level', 'vca1.b'),
    wire('vca1.out', 'vel1.a'), wire('voice1.velocity', 'vel1.b'),
    wire('vel1.out', 'mix1.in'), wire('aenv1.done', 'mix1.done'), wire('mix1.out', 'gain1.in'), wire('gain1.out', 'out1.left'),
  ];
}

function pad(): Intent[] {
  return [
    add('voice1', 'kit.voiceIn', 0, 200, { config: { mode: 'poly', capacity: 4, heldCapacity: 32 } }),
    add('lfo1', 'den.lfo', 0, 0, { values: { rate: 0.12 } }),
    add('pdepth1', 'kit.mul', 200, 0, { label: 'Vibrato Depth', values: { b: 0.03 } }),
    add('pmod1', 'kit.pitchMod', 400, 120),
    add('osc1', 'den.oscillator', 600, 160, { config: { waveform: 'saw' } }),
    add('fenv1', 'den.envelope', 200, 360, { label: 'Filter Env', values: env(1.4, 1.6, 0.5, 2.4) }),
    add('fdepth1', 'kit.mul', 400, 360, { label: 'Env Depth', values: { b: 0.75 } }),
    add('flfo1', 'kit.mul', 400, 260, { label: 'LFO Depth', values: { b: 0.2 } }),
    add('fsum1', 'kit.add', 600, 300),
    add('cut1', 'kit.cutoffMod', 800, 300, { values: { hz: 1400 } }),
    add('filter1', 'den.filter', 1000, 160, { values: { resonance: 0.5 } }),
    add('aenv1', 'den.envelope', 800, 480, { label: 'Amp Env', values: env(0.8, 1.2, 0.7, 2.4) }),
    add('vca1', 'kit.mul', 1200, 200, { label: 'VCA' }),
    add('vel1', 'kit.mul', 1400, 200, { label: 'Velocity' }),
    add('trem1', 'kit.tremolo', 1600, 200, { values: { depth: 0.08 } }),
    add('mix1', 'kit.voiceMix', 1800, 200),
    add('gain1', 'kit.gain', 2000, 200, { values: { gain: 0.045 } }),
    add('out1', 'kit.out', 2200, 200),
    wire('lfo1.out', 'pdepth1.a'), wire('pdepth1.out', 'pmod1.semitones'), wire('voice1.pitch', 'pmod1.hz'), wire('pmod1.out', 'osc1.frequency'),
    wire('fenv1.level', 'fdepth1.a'), wire('lfo1.out', 'flfo1.a'), wire('fdepth1.out', 'fsum1.a'), wire('flfo1.out', 'fsum1.b'),
    wire('fsum1.out', 'cut1.octaves'), wire('cut1.out', 'filter1.cutoff'), wire('osc1.out', 'filter1.input'),
    wire('filter1.out', 'vca1.a'), wire('aenv1.level', 'vca1.b'), wire('vca1.out', 'vel1.a'), wire('voice1.velocity', 'vel1.b'),
    wire('vel1.out', 'trem1.in'), wire('lfo1.out', 'trem1.lfo'),
    wire('trem1.out', 'mix1.in'), wire('aenv1.done', 'mix1.done'), wire('mix1.out', 'gain1.in'), wire('gain1.out', 'out1.left'),
  ];
}

function delay(kind: 'chorus' | 'rhythmic'): Intent[] {
  const chorus = kind === 'chorus';
  const values = chorus
    ? { timeLeftSeconds: 0.018, timeRightSeconds: 0.018, sync: false, bpm: 120, beatsLeft: 1, beatsRight: 1, feedback: 0, cutoffHz: 3200, mix: 0.45, rateHz: 0.65, depthSeconds: 0.003, bypass: false }
    : { timeLeftSeconds: 0.375, timeRightSeconds: 0.5, sync: true, bpm: 120, beatsLeft: 0.75, beatsRight: 1, feedback: 0.48, cutoffHz: 3200, mix: 0.35, rateHz: 0, depthSeconds: 0, bypass: false };
  return [
    add('in1', 'kit.audioIn', 0, 100),
    add('delay1', 'den.delayFx', 300, 60, { label: chorus ? 'Chorus' : 'Rhythmic Delay', config: { maxDelaySeconds: 2, tone: chorus ? 'flat' : 'lowpass', stereoPhaseCycles: 0.5 }, values }),
    add('out1', 'kit.out', 700, 100),
    wire('in1.left', 'delay1.left'), wire('in1.right', 'delay1.right'), wire('delay1.left', 'out1.left'), wire('delay1.right', 'out1.right'),
  ];
}

export const STARTERS = ['bass', 'percussion', 'pad', 'chorus', 'rhythmic'] as const;
export type StarterId = typeof STARTERS[number];

export function starter(id: StarterId, catalog: Catalog): PatchDocument {
  switch (id) {
    case 'bass': return build('Bass', catalog, monoVoice('bass'));
    case 'percussion': return build('Percussion', catalog, monoVoice('percussion'));
    case 'pad': return build('Pad', catalog, pad());
    case 'chorus': return build('Chorus', catalog, delay('chorus'));
    case 'rhythmic': return build('Rhythmic Delay', catalog, delay('rhythmic'));
  }
}

/**
 * Start from a part: an empty part (its one output inside) wired to Out, to
 * build something small inside it, listen, and use it again. The person opens
 * it from the inside (the use is part1).
 */
export function partStarter(catalog: Catalog, name = 'Part'): PatchDocument {
  const doc = emptyDocument(name);
  doc.parts = { part: { id: 'part', name, inputs: [], outputs: [{ id: 'out', node: 'partOut1' }], params: [] } };
  doc.nodes = {
    part1: { id: 'part1', type: 'kit.part', part: 'part', pos: { x: 120, y: 120 }, config: {}, values: {} },
    out1: { id: 'out1', type: 'kit.out', pos: { x: 480, y: 120 }, config: {}, values: {} },
    partOut1: { id: 'partOut1', type: 'kit.partOut', inside: 'part', pos: { x: 600, y: 120 }, config: { type: 'signal' }, values: {} },
  };
  doc.edges = { e1: { id: 'e1', from: { node: 'part1', port: 'out' }, to: { node: 'out1', port: 'left' } } };
  // The part's ports are worked out like after any edit.
  return { ...applyIntents(doc, [], catalog).doc, revision: 0 };
}

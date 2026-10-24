// Kit-level nodes: math/utility primitives (pure expressions), voice and audio
// IO, History, codebox, comments and UI widgets. Primitives emit unworklet core
// expressions directly; den helpers (modulatePitch/modulateCutoff) are reused so
// starter patches match den's own engines.
import type { NodeDef, PortDef } from '../../work/catalog.ts';
import { MAX_COUNT, type PatchNode } from '../../work/schema.ts';
import { position, random01 } from '../../work/stacks.ts';

const sig = (
  id: string,
  def: number,
  min: number,
  max: number,
  extra: Partial<PortDef> = {},
): PortDef => ({ id, type: 'signal', role: 'control', default: def, min, max, ...extra });
const audio = (id: string, label?: string, extra: Partial<PortDef> = {}): PortDef => ({
  id,
  type: 'signal',
  role: 'audio',
  label,
  ...extra,
});
const out = (id = 'out', label?: string): PortDef => ({ id, type: 'signal', label });
const BIG = 1e6;

const LFO = { module: '@denaudio/den/lfo', names: ['modulatePitch', 'modulateCutoff'] } as const;

export const kitPrimitives: NodeDef[] = [
  {
    type: 'kit.value',
    face: ['value'],
    kind: 'prim',
    title: 'Value',
    category: 'math',
    summary: 'A constant you can turn (an AudioParam).',
    keywords: ['constant', 'number', 'knob', 'offset'],
    config: [],
    inputs: [sig('value', 0, -BIG, BIG, { uiMin: -1, uiMax: 1 })],
    outputs: [out()],
    prim: i => ({ out: i.value! }),
  },
  {
    type: 'kit.add',
    kind: 'prim',
    title: 'Add',
    category: 'math',
    summary: 'a + b.',
    keywords: ['sum', 'plus', 'offset'],
    config: [],
    inputs: [
      sig('a', 0, -BIG, BIG, { uiMin: -1, uiMax: 1 }),
      sig('b', 0, -BIG, BIG, { uiMin: -1, uiMax: 1 }),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.a}.add(${i.b})` }),
  },
  {
    type: 'kit.mul',
    face: ['b'],
    kind: 'prim',
    title: 'Multiply / VCA',
    category: 'math',
    summary: 'a × b. Use as a VCA: audio into a, envelope into b.',
    keywords: ['vca', 'times', 'amp', 'scale', 'ring'],
    config: [],
    inputs: [
      sig('a', 1, -BIG, BIG, { uiMin: -2, uiMax: 2 }),
      sig('b', 1, -BIG, BIG, { uiMin: -2, uiMax: 2, roles: ['depth', 'amount'] }),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.a}.mul(${i.b})` }),
  },
  {
    type: 'kit.gain',
    face: ['gain'],
    kind: 'prim',
    title: 'Gain',
    category: 'math',
    summary: 'Scales audio by a linear gain (0..4).',
    keywords: ['volume', 'level', 'amp', 'loudness'],
    config: [],
    inputs: [
      audio('in'),
      sig('gain', 1, 0, 4, { unit: 'gain', uiMax: 2, roles: ['gain', 'volume'] }),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.in}.mul(${i.gain})` }),
  },
  {
    type: 'kit.mix',
    kind: 'prim',
    title: 'Mixer',
    category: 'math',
    summary: 'Sums up to 8 audio inputs, each with a level.',
    keywords: ['mixer', 'sum', 'combine', 'blend'],
    config: [{ id: 'channels', kind: 'number', default: 4, min: 2, max: 8, integer: true }],
    inputs: (node: PatchNode) => {
      const n = Number(node.config.channels ?? 4),
        ports: PortDef[] = [];
      for (let k = 1; k <= n; k++) ports.push(audio(`in${k}`));
      for (let k = 1; k <= n; k++)
        ports.push(sig(`level${k}`, 1, 0, 4, { unit: 'gain', uiMax: 2, roles: ['gain'] }));
      return ports;
    },
    outputs: [out()],
    prim: (i, node) => {
      const n = Number(node.config.channels ?? 4),
        terms: string[] = [];
      for (let k = 1; k <= n; k++) terms.push(`${i[`in${k}`]}.mul(${i[`level${k}`]})`);
      return { out: terms.reduce((sum, term) => `${sum}.add(${term})`) };
    },
  },
  {
    type: 'kit.scale',
    face: ['scale', 'offset'],
    kind: 'prim',
    title: 'Scale / Offset',
    category: 'math',
    summary: 'in × scale + offset (e.g. map an LFO to a modulation depth).',
    keywords: ['depth', 'amount', 'attenuverter', 'offset', 'bias'],
    config: [],
    inputs: [
      sig('in', 0, -BIG, BIG, { role: 'audio' }),
      sig('scale', 1, -BIG, BIG, { uiMin: -2, uiMax: 2, roles: ['depth', 'amount'] }),
      sig('offset', 0, -BIG, BIG, { uiMin: -1, uiMax: 1 }),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.in}.mul(${i.scale}).add(${i.offset})` }),
  },
  {
    type: 'kit.map',
    kind: 'prim',
    title: 'Map Range',
    category: 'math',
    summary: 'Linearly maps [inMin,inMax] to [outMin,outMax].',
    keywords: ['map', 'range', 'rescale'],
    config: [],
    inputs: [
      sig('in', 0, -BIG, BIG, { role: 'audio' }),
      sig('inMin', -1, -BIG, BIG),
      sig('inMax', 1, -BIG, BIG),
      sig('outMin', 0, -BIG, BIG),
      sig('outMax', 1, -BIG, BIG),
    ],
    outputs: [out()],
    prim: i => ({
      out: `${i.in}.sub(${i.inMin}).div(select(${i.inMax}.sub(${i.inMin}).eq(0), f32(1), ${i.inMax}.sub(${i.inMin}))).mul(${i.outMax}.sub(${i.outMin})).add(${i.outMin})`,
    }),
  },
  {
    type: 'kit.clamp',
    kind: 'prim',
    title: 'Clamp',
    category: 'math',
    summary: 'Limits a signal to [min, max].',
    keywords: ['limit', 'clip', 'bound'],
    config: [],
    inputs: [
      sig('in', 0, -BIG, BIG, { role: 'audio' }),
      sig('min', -1, -BIG, BIG),
      sig('max', 1, -BIG, BIG),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.in}.max(${i.min}).min(${i.max})` }),
  },
  {
    type: 'kit.crossfade',
    face: ['mix'],
    kind: 'prim',
    title: 'Crossfade',
    category: 'math',
    summary: 'Blends a (mix 0) to b (mix 1).',
    keywords: ['blend', 'morph', 'xfade', 'dry wet'],
    config: [],
    inputs: [audio('a'), audio('b'), sig('mix', 0.5, 0, 1, { unit: 'mix', roles: ['mix'] })],
    outputs: [out()],
    prim: i => ({ out: `${i.a}.add(${i.b}.sub(${i.a}).mul(${i.mix}.clamp(0, 1)))` }),
  },
  {
    type: 'kit.pan',
    face: ['pan'],
    kind: 'prim',
    title: 'Pan',
    category: 'math',
    summary: 'Equal-power pan of a mono signal to left/right.',
    keywords: ['pan', 'stereo', 'balance', 'width'],
    config: [],
    inputs: [audio('in'), sig('pan', 0, -1, 1, { roles: ['pan'] })],
    outputs: [out('left', 'L'), out('right', 'R')],
    prim: i => ({
      left: `${i.in}.mul(f32(1).sub(${i.pan}.clamp(-1, 1)).mul(0.5).sqrt())`,
      right: `${i.in}.mul(f32(1).add(${i.pan}.clamp(-1, 1)).mul(0.5).sqrt())`,
    }),
  },
  {
    type: 'kit.tanh',
    face: ['drive'],
    kind: 'prim',
    title: 'Soft Clip',
    category: 'math',
    summary: 'tanh(in × drive): gentle saturation and a safety limiter.',
    keywords: ['saturate', 'tanh', 'clip', 'warm'],
    config: [],
    inputs: [audio('in'), sig('drive', 1, 0, 32, { unit: 'gain', uiMax: 8, roles: ['drive'] })],
    outputs: [out()],
    prim: i => ({ out: `${i.in}.mul(${i.drive}).tanh()` }),
  },
  {
    type: 'kit.compare',
    kind: 'prim',
    title: 'Compare',
    category: 'math',
    summary: 'Gate that is high while a > b.',
    keywords: ['threshold', 'comparator', 'gate'],
    config: [],
    inputs: [
      sig('a', 0, -BIG, BIG, { role: 'audio' }),
      sig('b', 0, -BIG, BIG, { uiMin: -1, uiMax: 1 }),
    ],
    outputs: [{ id: 'out', type: 'gate' }],
    prim: i => ({ out: `${i.a}.gt(${i.b})` }),
  },
  {
    type: 'kit.mtof',
    kind: 'prim',
    title: 'Note → Hz',
    category: 'math',
    summary: 'MIDI note number to frequency (A4 = 69 = 440 Hz).',
    keywords: ['mtof', 'pitch', 'note', 'frequency'],
    config: [],
    inputs: [sig('note', 60, -128, 255, { unit: 'note', uiMin: 0, uiMax: 127 })],
    outputs: [out()],
    prim: i => ({ out: `f32(440).mul(f32(2).pow(${i.note}.sub(69).div(12)))` }),
  },
  {
    type: 'kit.pitchMod',
    face: ['semitones'],
    kind: 'prim',
    title: 'Pitch Mod',
    category: 'modulation',
    summary: 'Shifts a frequency by semitones (vibrato, pitch envelope, detune).',
    doc: 'hz × 2^(semitones/12), semitones clamped to ±24 (den modulatePitch). Feed an LFO or envelope through Scale for depth.',
    keywords: ['vibrato', 'detune', 'pitch envelope', 'transpose'],
    config: [],
    imports: [LFO],
    inputs: [
      sig('hz', 440, 0, 21600, { unit: 'Hz', role: 'audio' }),
      sig('semitones', 0, -24, 24, { unit: 'st', materialize: true, roles: ['pitch', 'depth'] }),
    ],
    outputs: [out()],
    prim: (i, _node, env) => ({
      out: `modulatePitch(${i.hz}, f32(1), ${i.semitones}, 0.45 * ${env.sampleRate})`,
    }),
  },
  {
    type: 'kit.cutoffMod',
    face: ['hz', 'octaves'],
    kind: 'prim',
    title: 'Cutoff Mod',
    category: 'modulation',
    summary: 'Base cutoff in Hz shifted by octaves (filter envelope / LFO sweeps).',
    doc: 'hz × 2^octaves, octaves clamped to ±8, result 20..min(20000, 0.45·sampleRate) (den modulateCutoff).',
    keywords: ['filter envelope', 'sweep', 'wah', 'cutoff'],
    config: [],
    imports: [LFO],
    inputs: [
      sig('hz', 1000, 20, 20000, { unit: 'Hz', scale: 'log', roles: ['cutoff', 'brightness'] }),
      sig('octaves', 0, -8, 8, { unit: 'oct', materialize: true, roles: ['depth'] }),
    ],
    outputs: [out()],
    prim: (i, _node, env) => ({
      out: `modulateCutoff(${i.hz}, f32(1), ${i.octaves}, Math.min(20000, 0.45 * ${env.sampleRate}))`,
    }),
  },
  {
    type: 'kit.tremolo',
    face: ['depth'],
    kind: 'prim',
    title: 'Tremolo',
    category: 'modulation',
    summary: 'Amplitude modulation: in × (1 − depth·(1 − lfo)/2).',
    keywords: ['tremolo', 'am', 'pulse', 'throb'],
    config: [],
    inputs: [
      audio('in'),
      sig('lfo', 1, -1, 1, { role: 'audio', default: 1 }),
      sig('depth', 0, 0, 1, { unit: 'mix', roles: ['depth'] }),
    ],
    outputs: [out()],
    prim: i => ({ out: `${i.in}.mul(f32(1).sub(${i.depth}.mul(f32(1).sub(${i.lfo})).mul(0.5)))` }),
  },
  {
    type: 'kit.history',
    kind: 'history',
    title: 'History (z⁻¹)',
    category: 'math',
    summary: "Outputs last sample's input. The only way to close a feedback loop.",
    keywords: ['delay', 'feedback', 'z-1', 'unit delay'],
    config: [],
    inputs: [audio('in')],
    outputs: [out()],
  },
];

export const kitIO: NodeDef[] = [
  {
    type: 'kit.voiceIn',
    kind: 'voiceIn',
    title: 'Voice In',
    category: 'voice',
    singleton: true,
    summary:
      'MIDI → per-voice pitch/gate/velocity. Everything after it runs once per voice until Voice Mix.',
    doc: 'mono: one voice, last-note priority (legato glides envelopes). poly: up to 16 voices with stealing. pitch is in Hz (equal temperament), note is the MIDI number, velocity 0..1, trigger is a one-sample pulse on each new note.',
    keywords: ['midi', 'keyboard', 'notes', 'poly', 'mono', 'synth'],
    config: [
      { id: 'mode', kind: 'enum', options: ['poly', 'mono'], default: 'poly' },
      {
        id: 'capacity',
        kind: 'number',
        default: 4,
        min: 1,
        max: 16,
        integer: true,
        doc: 'Voices (mono must be 1).',
      },
      {
        id: 'heldCapacity',
        kind: 'number',
        default: 16,
        min: 1,
        max: 128,
        integer: true,
        doc: 'Held notes remembered (larger compiles slower).',
      },
      {
        id: 'legato',
        kind: 'boolean',
        default: false,
        doc: 'Mono only: overlapping notes do not retrigger.',
      },
    ],
    inputs: [],
    outputs: [
      out('pitch', 'Hz'),
      out('note'),
      { id: 'gate', type: 'gate' },
      { id: 'trigger', type: 'gate' },
      out('velocity'),
    ],
  },
  {
    type: 'kit.voiceMix',
    kind: 'voiceMix',
    title: 'Voice Mix',
    category: 'voice',
    summary: 'Sums all voices into one signal. done frees a voice (connect the amp envelope done).',
    keywords: ['sum', 'voices', 'poly'],
    config: [],
    inputs: [
      audio('in'),
      {
        id: 'done',
        type: 'gate',
        binding: 'gate',
        merge: 'all',
        doc: 'Voice finished. Unconnected: the voice frees at note-off. From copies (×N): when all of them are.',
      },
    ],
    outputs: [out()],
  },
  {
    type: 'kit.audioIn',
    kind: 'audioIn',
    title: 'Audio In',
    category: 'io',
    singleton: true,
    scope: 'global',
    summary: 'Stereo audio input (test signal or a source in the host).',
    keywords: ['input', 'effect', 'sidechain'],
    config: [],
    inputs: [],
    outputs: [out('left', 'L'), out('right', 'R')],
  },
  {
    type: 'kit.out',
    kind: 'out',
    title: 'Out',
    category: 'io',
    singleton: true,
    scope: 'global',
    summary: 'Stereo output. Right falls back to left when unconnected.',
    keywords: ['output', 'speaker', 'dac', 'master'],
    config: [],
    inputs: [audio('left', 'L'), audio('right', 'R', { fallback: 'left' })],
    outputs: [],
  },
  {
    type: 'kit.codebox',
    kind: 'codebox',
    title: 'Codebox',
    category: 'code',
    summary: 'Custom DSP written with the unworklet core API (like gen~ codebox).',
    doc: 'Source is a module that default-exports defineSubgraph((config: { sampleRate: number }) => ({ tick(i) { ... return { out } } })). tick receives an object of the declared inputs and returns an object of the declared outputs. Only @unworklet/core may be imported.',
    keywords: ['code', 'custom', 'gen', 'script', 'dsp'],
    config: [],
    inputs: (node: PatchNode) =>
      (node.ports?.inputs ?? []).map((p): PortDef =>
        p.type === 'gate'
          ? { id: p.id, type: 'gate', default: false }
          : {
              id: p.id,
              type: 'signal',
              role: 'control',
              default: 0,
              min: -BIG,
              max: BIG,
              uiMin: -1,
              uiMax: 1,
            },
      ),
    outputs: (node: PatchNode) =>
      (node.ports?.outputs ?? []).map(p => ({ id: p.id, type: p.type })),
  },
  {
    type: 'kit.comment',
    kind: 'comment',
    title: 'Comment',
    category: 'io',
    summary: 'A note on the canvas.',
    config: [],
    inputs: [],
    outputs: [],
  },
];

const portType = (node: PatchNode) =>
  node.config.type === 'gate' ? ('gate' as const) : ('signal' as const);
/** Parts: one definition used in several places. The nodes inside are expanded into ordinary nodes before checking and code generation. */
export const kitParts: NodeDef[] = [
  {
    type: 'kit.part',
    kind: 'part',
    title: 'Part',
    category: 'part',
    palette: 'never',
    summary:
      'A part: a piece of patch defined once and used in several places; each use has its own parameter values.',
    doc: 'Make one from modules with makePart; place another use with addNode {type: "kit.part", part: "<part id>"}. Its inputs (cables) and parameters (knobs) are inputs; editing inside changes every use.',
    keywords: ['part', 'subpatch', 'macro', 'abstraction', 'module'],
    config: [],
    inputs: (node: PatchNode) => node.iface?.inputs ?? [],
    outputs: (node: PatchNode) => node.iface?.outputs ?? [],
  },
  {
    type: 'kit.partIn',
    kind: 'partIn',
    title: 'Part input',
    category: 'part',
    palette: 'inside',
    summary: 'Inside a part: a signal coming in from outside (one input of the part).',
    keywords: ['inlet', 'input', 'in'],
    config: [{ id: 'type', kind: 'enum', options: ['signal', 'gate'], default: 'signal' }],
    inputs: [],
    outputs: (node: PatchNode) => [{ id: 'out', type: portType(node), label: node.label }],
  },
  {
    type: 'kit.partOut',
    kind: 'partOut',
    title: 'Part output',
    category: 'part',
    palette: 'inside',
    summary: 'Inside a part: a signal going out (one output of the part).',
    keywords: ['outlet', 'output', 'out'],
    config: [{ id: 'type', kind: 'enum', options: ['signal', 'gate'], default: 'signal' }],
    inputs: (node: PatchNode) => [
      { id: 'in', type: portType(node), role: 'audio', label: node.label },
    ],
    outputs: [],
  },
];

const lit = (x: number) => `f32(${x})`;
const width = (node: PatchNode) =>
  Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(node.config.n ?? 1)) || 1));
const many = (node: PatchNode, type: 'signal' | 'gate' = 'signal'): PortDef[] =>
  Array.from({ length: width(node) }, (_, k): PortDef =>
    type === 'gate' ? { id: `in${k}`, type: 'gate', default: false } : audio(`in${k}`),
  );
const HALF = Math.SQRT1_2;
/** Equal-power gains of copy k of n across left and right, with width (0: all centred, 1: spread over the whole field) applied later. */
const splayGains = (k: number, n: number) => {
  const angle = ((position(k, n) + 1) * Math.PI) / 4;
  return { l: Math.cos(angle), r: Math.sin(angle) };
};

/**
 * ×N. Splay and Copy number are placed by people; the rest is made when the
 * patch is expanded (a thick cable summed into a thin input, Splay over n
 * copies, the copy number of each copy).
 */
export const kitStacks: NodeDef[] = [
  {
    type: 'kit.splay',
    face: ['width'],
    kind: 'prim',
    title: 'Splay',
    category: 'math',
    stack: false,
    summary:
      'Spreads copies (a thick ×N cable) across left and right, equal-power, scaled by 1/√N. One signal sits in the middle.',
    doc: 'Copy 1 goes furthest left, the last furthest right. width 0 puts every copy in the middle, 1 spreads them over the whole field.',
    keywords: ['splay', 'spread', 'stereo', 'width', 'pan', 'unison', 'copies'],
    config: [],
    inputs: [audio('in'), sig('width', 1, 0, 1, { unit: 'mix', roles: ['width'] })],
    outputs: [out('left', 'L'), out('right', 'R')],
    prim: i => ({ left: `${i.in}.mul(${lit(HALF)})`, right: `${i.in}.mul(${lit(HALF)})` }),
  },
  {
    type: 'kit.copy',
    kind: 'prim',
    title: 'Copy number',
    category: 'math',
    summary:
      'Which copy this is, in a node or part that runs as copies (×N): index 0…N−1, count N, position −1…+1, and a random number fixed per copy.',
    doc: 'Inside a part used ×N (or stacked itself) each copy reads its own numbers: use them to give copies different pitches, pans or timings. Alone (×1) it reads index 0, count 1, position 0. seed picks other random numbers.',
    keywords: ['copy', 'index', 'voice number', 'stack', 'clone', 'instance', 'random'],
    config: [
      {
        id: 'seed',
        kind: 'number',
        default: 1,
        min: 0,
        max: 2147483647,
        integer: true,
        doc: 'Another seed gives other random numbers.',
      },
    ],
    inputs: [],
    outputs: [out('index'), out('count'), out('position'), out('random')],
    prim: (_i, node) => ({
      index: lit(0),
      count: lit(1),
      position: lit(0),
      random: lit(random01(Number(node.config.seed ?? 1), [])),
    }),
  },
  {
    type: 'kit.copyConst',
    kind: 'prim',
    title: 'Copy number (one copy)',
    category: 'math',
    palette: 'never',
    stack: false,
    summary: 'The numbers of one copy (made when copies are expanded).',
    config: ['index', 'count', 'position', 'random'].map(id => ({
      id,
      kind: 'number' as const,
      default: id === 'count' ? 1 : 0,
      min: -1e6,
      max: 1e6,
    })),
    inputs: [],
    outputs: [out('index'), out('count'), out('position'), out('random')],
    prim: (_i, node) => ({
      index: lit(Number(node.config.index ?? 0)),
      count: lit(Number(node.config.count ?? 1)),
      position: lit(Number(node.config.position ?? 0)),
      random: lit(Number(node.config.random ?? 0)),
    }),
  },
  {
    type: 'kit.stackSum',
    kind: 'prim',
    title: 'Sum of copies',
    category: 'math',
    palette: 'never',
    stack: false,
    summary:
      'The copies on a thick cable summed and scaled by 1/√N (made where a thick cable meets a thin input).',
    config: [{ id: 'n', kind: 'number', default: 2, min: 1, max: MAX_COUNT, integer: true }],
    inputs: (node: PatchNode) => many(node),
    outputs: [out()],
    prim: (i, node) => {
      const n = width(node),
        terms = Array.from({ length: n }, (_, k) => i[`in${k}`]!);
      return {
        out: `${terms.reduce((sum, t) => `${sum}.add(${t})`)}.mul(${lit(1 / Math.sqrt(n))})`,
      };
    },
  },
  {
    type: 'kit.stackGate',
    kind: 'prim',
    title: 'Gates of copies',
    category: 'math',
    palette: 'never',
    stack: false,
    summary:
      'The copies of a gate combined: on while any copy is (or, with mode all, while every copy is).',
    config: [
      { id: 'n', kind: 'number', default: 2, min: 1, max: MAX_COUNT, integer: true },
      { id: 'mode', kind: 'enum', options: ['any', 'all'], default: 'any' },
    ],
    inputs: (node: PatchNode) => many(node, 'gate'),
    outputs: [{ id: 'out', type: 'gate' }],
    prim: (i, node) => {
      const n = width(node),
        join = node.config.mode === 'all' ? 'and' : 'or';
      return {
        out: Array.from({ length: n }, (_, k) => i[`in${k}`]!).reduce(
          (all, t) => `${all}.${join}(${t})`,
        ),
      };
    },
  },
  {
    type: 'kit.splayN',
    kind: 'prim',
    title: 'Splay (copies)',
    category: 'math',
    palette: 'never',
    stack: false,
    summary: 'Splay over n copies (made when copies are expanded).',
    config: [{ id: 'n', kind: 'number', default: 2, min: 1, max: MAX_COUNT, integer: true }],
    inputs: (node: PatchNode) => [
      ...many(node),
      sig('width', 1, 0, 1, { unit: 'mix', roles: ['width'] }),
    ],
    outputs: [out('left', 'L'), out('right', 'R')],
    prim: (i, node) => {
      // Each copy's gain moves from the middle (width 0) to its place (width 1); 1/√n keeps the level of n unrelated copies.
      const n = width(node),
        scale = 1 / Math.sqrt(n),
        w = `${i.width}.clamp(0, 1)`;
      const side = (g: (k: number) => number) =>
        Array.from({ length: n }, (_, k) => {
          const d = (g(k) - HALF) * scale;
          return Math.abs(d) < 1e-12
            ? `${i[`in${k}`]}.mul(${lit(HALF * scale)})`
            : `${i[`in${k}`]}.mul(${w}.mul(${lit(d)}).add(${lit(HALF * scale)}))`;
        }).reduce((sum, t) => `${sum}.add(${t})`);
      return { left: side(k => splayGains(k, n).l), right: side(k => splayGains(k, n).r) };
    },
  },
];

const range = (node: PatchNode, key: 'min' | 'max', fallback: number) =>
  typeof node.config[key] === 'number' ? (node.config[key] as number) : fallback;
const valuePort = (node: PatchNode, id = 'value'): PortDef => {
  const min = range(node, 'min', 0),
    max = range(node, 'max', 1);
  return {
    id,
    type: 'signal',
    role: 'control',
    hidden: true,
    default: Math.min(max, Math.max(min, Number(node.config.initial ?? min))),
    min,
    max,
    scale: node.config.scale === 'log' ? 'log' : 'linear',
  };
};
const widgetRange = [
  { id: 'min', kind: 'number', default: 0, min: -BIG, max: BIG },
  { id: 'max', kind: 'number', default: 1, min: -BIG, max: BIG },
  { id: 'scale', kind: 'enum', options: ['linear', 'log'], default: 'linear' },
  {
    id: 'unit',
    kind: 'enum',
    options: ['', 'Hz', 's', 'dB', 'oct', 'st', 'mix', 'gain', 'ratio', 'note'],
    default: '',
  },
] as const;

export const kitWidgets: NodeDef[] = [
  {
    type: 'ui.knob',
    kind: 'widget',
    title: 'Knob',
    category: 'ui',
    summary: 'A knob on the panel; outputs its value.',
    keywords: ['knob', 'dial', 'control', 'macro'],
    config: [...widgetRange],
    inputs: (node: PatchNode) => [valuePort(node)],
    outputs: [out()],
  },
  {
    type: 'ui.slider',
    kind: 'widget',
    title: 'Slider',
    category: 'ui',
    summary: 'A slider on the panel; outputs its value.',
    keywords: ['slider', 'fader'],
    config: [...widgetRange],
    inputs: (node: PatchNode) => [valuePort(node)],
    outputs: [out()],
  },
  {
    type: 'ui.toggle',
    kind: 'widget',
    title: 'Toggle',
    category: 'ui',
    summary: 'An on/off switch; outputs a gate.',
    keywords: ['switch', 'toggle', 'on', 'off', 'bypass'],
    config: [],
    inputs: [{ id: 'value', type: 'gate', default: false, hidden: true }],
    outputs: [{ id: 'out', type: 'gate' }],
  },
  {
    type: 'ui.button',
    kind: 'widget',
    title: 'Button',
    category: 'ui',
    summary: 'Momentary button; gate is high while pressed.',
    keywords: ['button', 'trigger', 'momentary'],
    config: [],
    inputs: [{ id: 'value', type: 'gate', default: false, hidden: true }],
    outputs: [{ id: 'out', type: 'gate' }],
  },
  {
    type: 'ui.xy',
    kind: 'widget',
    title: 'XY Pad',
    category: 'ui',
    summary: 'Two-axis pad; outputs x and y in [0,1].',
    keywords: ['xy', 'pad', 'macro', 'performance'],
    config: [],
    inputs: [
      { id: 'x', type: 'signal', role: 'control', default: 0.5, min: 0, max: 1, hidden: true },
      { id: 'y', type: 'signal', role: 'control', default: 0.5, min: 0, max: 1, hidden: true },
    ],
    outputs: [out('x'), out('y')],
  },
  {
    type: 'ui.keyboard',
    kind: 'widget',
    title: 'Keyboard',
    category: 'ui',
    summary: 'Playable keyboard on the panel (sends MIDI to Voice In).',
    keywords: ['keyboard', 'piano', 'keys'],
    config: [],
    inputs: [],
    outputs: [],
  },
  {
    type: 'ui.scope',
    kind: 'widget',
    title: 'Scope',
    category: 'ui',
    scope: 'global',
    summary: 'Oscilloscope view of a global signal.',
    keywords: ['scope', 'oscilloscope', 'waveform', 'probe'],
    config: [],
    inputs: [{ id: 'in', type: 'signal', role: 'audio' }],
    outputs: [],
  },
  {
    type: 'ui.meter',
    kind: 'widget',
    title: 'Meter',
    category: 'ui',
    scope: 'global',
    summary: 'Level meter of a global signal.',
    keywords: ['meter', 'level', 'vu', 'probe'],
    config: [],
    inputs: [{ id: 'in', type: 'signal', role: 'audio' }],
    outputs: [],
  },
];

export const PROBE_TYPES: ReadonlySet<string> = new Set(['ui.scope', 'ui.meter']);

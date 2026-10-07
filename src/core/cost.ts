// What a patch costs to run, estimated from what it expands into: CPU (a
// fraction of one core) and the size of the generated program. The numbers
// per module were measured once (Node 24, the cloud machine, 2026-10-07):
// render time per sample above an empty patch, and WebAssembly bytes, per
// instance. A browser on a recent Mac is usually faster; these are estimates.
//
// Cost grows faster than the sum once the program gets big (measured: about
// 2× at 400 kB and 4× at 600 kB, the whole program being one function), so
// the size matters as much as the count: ×N is cheap for small parts and
// expensive for big ones.
import type { Catalog } from './catalog.ts';
import type { Analysis } from './scope.ts';
import type { NodeId, PatchDocument, PatchNode } from './schema.ts';

/** µs per sample per instance, kB of code per instance. */
const MEASURED: Record<string, readonly [number, number]> = {
  'den.oscillator': [0.155, 3.72], 'den.virtualAnalogSource': [0.106, 2.79], 'den.seededNoise': [0.0074, 0.11], 'den.frequencyModulation': [0.188, 7.37],
  'den.envelope': [0.236, 3.99], 'den.curvedAdsr': [0.172, 3.66], 'den.lfo': [0.144, 5.28], 'den.musicalLfo': [0.159, 3.09], 'den.sampleAndHold': [0.01, 0.09],
  'den.randomModulator': [0.02, 0.29], 'den.pitchGlide': [0.012, 0.45], 'den.filter': [0.062, 1.85], 'den.stateVariableFilter': [0.062, 1.97],
  'den.characterFilter': [0.124, 2.95], 'den.biquadEq': [0.145, 2.97], 'den.drive': [0.034, 0.61], 'den.dynamics': [0.512, 8.44], 'den.delayFx': [0.593, 19.49],
  'den.pingPongDelay': [0.144, 3.57], 'den.algorithmicReverb': [0.087, 8.03], 'den.phaser': [0.148, 3.66], 'den.flanger': [0.547, 19.09],
  'kit.pitchMod': [0.392, 9.14], 'kit.cutoffMod': [0.308, 8.32], 'kit.mtof': [0.018, 0.05], 'kit.codebox': [0.05, 1.5],
};
const PRIM: readonly [number, number] = [0.002, 0.05];
/** The measurements undercount a real patch (shared reads, the output stage); one factor for that, fitted on the measured stacks. */
const FIT = 1.6;
/** Microseconds per sample at 48 kHz: one core. */
const CORE_US = 1e6 / 48000;
const BASE_KB = 1.5;

export interface Cost {
  /** Estimated share of one core (0.5 = half). */
  cpu: number;
  /** Estimated size of the generated program, in kB. */
  kB: number;
  /** The CPU estimate of what each node of the patch as drawn (main patch ids, and nodes inside parts by their own id) expands into. */
  byNode: Record<NodeId, number>;
}

export const COST_LIMITS = { warnCpu: 0.6, maxKB: 1500 } as const;

/** Nodes that sum copies cost per copy they take (Splay twice: left and right). */
const PER_INPUT: Record<string, number> = { 'kit.stackSum': 1, 'kit.stackGate': 1, 'kit.splayN': 2 };

function unit(node: PatchNode, catalog: Catalog): readonly [number, number] {
  const m = MEASURED[node.type];
  if (m) return m;
  const kind = catalog.find(node.type)?.kind;
  const per = PER_INPUT[node.type];
  if (per) return [PRIM[0] * per * Number(node.config.n ?? 1), PRIM[1] * per * Number(node.config.n ?? 1)];
  return kind === 'block' ? [0.1, 3] : kind === 'prim' || kind === 'history' ? PRIM : [0, 0];
}

/** The slowdown of a big program (one big function): none up to 200 kB, then growing with the size. */
export const sizePenalty = (kB: number) => 1 + Math.max(0, kB - 200) / 200;

/**
 * Estimate the cost of an expanded patch. `origin` maps expanded ids to the
 * original ids (so each original node gets the cost of what it became);
 * nodes that run per voice count once per voice.
 */
export function estimateCost(flat: PatchDocument, catalog: Catalog, analysis: Analysis, origin: Record<NodeId, NodeId[]> = {}): Cost {
  const voiceIn = Object.values(flat.nodes).find(n => n.type === 'kit.voiceIn' && analysis.live.has(n.id));
  const voices = voiceIn ? (voiceIn.config.mode === 'mono' ? 1 : Number(voiceIn.config.capacity ?? 4)) : 1;
  let us = 0, kB = BASE_KB;
  const raw: Record<NodeId, number> = {};
  for (const n of Object.values(flat.nodes)) {
    if (!analysis.live.has(n.id)) continue;
    const [u, k] = unit(n, catalog);
    const times = analysis.scope.get(n.id) === 'voice' ? voices : 1;
    us += u * times; kB += k * times;
    for (const id of new Set(origin[n.id] ?? [n.id])) raw[id] = (raw[id] ?? 0) + u * times;
  }
  const scale = FIT * sizePenalty(kB) / CORE_US;
  return { cpu: us * scale, kB, byNode: Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, v * scale])) };
}

/** "≈ 12% CPU" */
export const formatCpu = (cpu: number) => cpu < 0.01 ? '< 1% CPU' : `≈ ${cpu >= 10 ? Math.round(cpu) * 100 : Math.round(cpu * 100)}% CPU`;

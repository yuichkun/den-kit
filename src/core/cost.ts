// What a patch costs to run, estimated from what it expands into: CPU (a
// fraction of one core) and the size of the generated program. The numbers
// per module were measured once (Node 24, the cloud machine, 2026-10-07):
// render time per sample above an empty patch (compiling excluded, its
// controls moving), and WebAssembly bytes, per instance. Checked against
// whole patches (the showcase, the starters, stacks up to ×48): within about
// ±20%, except code-heavy codeboxes. A browser on a recent Mac is usually
// faster; these are estimates.
//
// A big program runs slower per module than a small one (the whole program is
// one function): a little past 200 kB (×1.3 at 500 kB), steeply past about
// 750 kB (×3.9 at 1000 kB). So the size matters as much as the count: ×N is
// cheap for small parts and expensive for big ones.
import type { Catalog } from './catalog.ts';
import type { Analysis } from './scope.ts';
import type { NodeId, PatchDocument, PatchNode } from './schema.ts';

/** µs per sample per instance, kB of code per instance. */
const MEASURED: Record<string, readonly [number, number]> = {
  'den.oscillator': [0.069, 3.9],
  'den.virtualAnalogSource': [0.106, 2.95],
  'den.seededNoise': [0.003, 0.11],
  'den.frequencyModulation': [0.173, 8.08],
  'den.envelope': [0.126, 4.39],
  'den.curvedAdsr': [0.106, 4.2],
  'den.lfo': [0.132, 5.97],
  'den.musicalLfo': [0.166, 3.79],
  'den.sampleAndHold': [0.005, 0.09],
  'den.randomModulator': [0.013, 0.98],
  'den.pitchGlide': [0.02, 1.11],
  'den.filter': [0.035, 2.3],
  'den.stateVariableFilter': [0.035, 2.42],
  'den.characterFilter': [0.077, 3.11],
  'den.biquadEq': [0.066, 3.4],
  'den.drive': [0.04, 1.24],
  'den.dynamics': [0.424, 8.47],
  'den.delayFx': [0.495, 19.94],
  'den.pingPongDelay': [0.138, 4.21],
  'den.algorithmicReverb': [0.065, 8.73],
  'den.phaser': [0.052, 3.81],
  'den.flanger': [0.469, 19.51],
  'kit.pitchMod': [0.01, 7.86],
  'kit.cutoffMod': [0.009, 7.1],
  'kit.mtof': [0.032, 0.75],
  'kit.map': [0.027, 0.9],
  'kit.mix': [0.017, 0.79],
  'kit.tanh': [0.017, 0.74],
  'kit.codebox': [0.012, 0.71],
  'kit.copy': [0, 0],
  'kit.copyConst': [0, 0],
  'kit.history': [0.002, 0.21],
  // The voice machinery (held notes, voice allocation) is a big piece of program but little work per sample.
  'kit.voiceIn': [0.02, 190],
};
const PRIM: readonly [number, number] = [0.005, 0.03];
/** Whole patches against the sum of their modules (shared reads, the output stage): they matched, so 1. */
const FIT = 1;
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
const PER_INPUT: Record<string, number> = {
  'kit.stackSum': 1,
  'kit.stackGate': 1,
  'kit.splayN': 2,
};

function unit(node: PatchNode, catalog: Catalog): readonly [number, number] {
  const m = MEASURED[node.type];
  if (m) return m;
  const kind = catalog.find(node.type)?.kind;
  const per = PER_INPUT[node.type];
  if (per)
    return [PRIM[0] * per * Number(node.config.n ?? 1), PRIM[1] * per * Number(node.config.n ?? 1)];
  return kind === 'block' ? [0.1, 3] : kind === 'prim' || kind === 'history' ? PRIM : [0, 0];
}

/** The slowdown of a big program (one big function): none up to 200 kB, a little up to about 750 kB, steep past it. */
export const sizePenalty = (kB: number) =>
  1 + Math.max(0, kB - 200) / 1000 + Math.max(0, kB - 750) / 120;

/**
 * Estimate the cost of an expanded patch. `origin` maps expanded ids to the
 * original ids (so each original node gets the cost of what it became);
 * nodes that run per voice count once per voice.
 */
export function estimateCost(
  flat: PatchDocument,
  catalog: Catalog,
  analysis: Analysis,
  origin: Record<NodeId, NodeId[]> = {},
): Cost {
  const voiceIn = Object.values(flat.nodes).find(
    n => n.type === 'kit.voiceIn' && analysis.live.has(n.id),
  );
  const voices = voiceIn
    ? voiceIn.config.mode === 'mono'
      ? 1
      : Number(voiceIn.config.capacity ?? 4)
    : 1;
  let us = 0,
    kB = BASE_KB;
  const raw: Record<NodeId, number> = {};
  for (const n of Object.values(flat.nodes)) {
    if (!analysis.live.has(n.id)) continue;
    const [u, k] = unit(n, catalog);
    // Per-voice modules run (and are written out) once per voice; the voice machinery itself once.
    const times = analysis.scope.get(n.id) === 'voice' && n.type !== 'kit.voiceIn' ? voices : 1;
    us += u * times;
    kB += k * times;
    for (const id of new Set(origin[n.id] ?? [n.id])) raw[id] = (raw[id] ?? 0) + u * times;
  }
  const scale = (FIT * sizePenalty(kB)) / CORE_US;
  return {
    cpu: us * scale,
    kB,
    byNode: Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, v * scale])),
  };
}

/** "≈ 12% CPU" */
export const formatCpu = (cpu: number) =>
  cpu < 0.01 ? '< 1% CPU' : `≈ ${cpu >= 10 ? Math.round(cpu) * 100 : Math.round(cpu * 100)}% CPU`;

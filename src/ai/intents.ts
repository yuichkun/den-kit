// Deterministic musical intents for the fast path: "brighter", "longer release",
// "add reverb". An aspect names *what* to change through port roles declared in
// the block descriptors, so the same intent works on starter patches and on
// hand-built ones. Every plan is a plain list of op intents (one undo step).
import type { Catalog, Category, PortDef } from '../core/catalog.ts';
import type { Intent } from '../core/ops.ts';
import { edgesFrom, edgesInto, nextNodeId, type PatchDocument, type PatchNode, type PortId } from '../core/schema.ts';

export type Direction = 'up' | 'down' | 'set_max' | 'set_min';
export type Amount = 'tiny' | 'small' | 'medium' | 'large' | 'extreme';
export const AMOUNTS: readonly Amount[] = ['tiny', 'small', 'medium', 'large', 'extreme'];
/** Fraction of the knob's (log or linear) range moved per step. */
export const AMOUNT_STEP: Record<Amount, number> = { tiny: 0.025, small: 0.06, medium: 0.12, large: 0.25, extreme: 0.45 };
/** Gains move in decibels (a "louder" step is +3 dB, not +0.24 linear). */
export const AMOUNT_DB: Record<Amount, number> = { tiny: 0.75, small: 1.5, medium: 3, large: 6, extreme: 10 };
/** Modulation depths scale by a factor ("more wobble" = ×1.5), so tiny depths stay musical. */
export const AMOUNT_FACTOR: Record<Amount, number> = { tiny: 1.1, small: 1.25, medium: 1.5, large: 2, extreme: 3 };

export interface Aspect {
  id: string;
  /** English words used in labels and given to Jev. */
  up: string;
  down: string;
  roles: readonly string[];
  /** Short description for Jev's option list. */
  doc: string;
  /** Categories preferred when several blocks match (first is best). */
  prefer?: readonly Category[];
  /** Change every matching knob together (e.g. all LFO depths for "more wobble"). */
  group?: boolean;
  /** Extra filter on candidate nodes. */
  where?: (doc: PatchDocument, node: PatchNode, catalog: Catalog) => boolean;
  /** Prefer the amp envelope among several envelopes. */
  ampEnvelope?: boolean;
  /** Scale the current value by a factor instead of stepping through the range. */
  relative?: boolean;
}

const fedByModulator = (doc: PatchDocument, node: PatchNode, catalog: Catalog) =>
  Object.values(doc.edges).some(e => e.to.node === node.id && catalog.find(doc.nodes[e.from.node]?.type ?? '')?.category === 'modulation' && doc.nodes[e.from.node]!.type !== 'kit.cutoffMod' && doc.nodes[e.from.node]!.type !== 'kit.pitchMod')
  || ['kit.tremolo', 'den.flanger'].includes(node.type);

export const ASPECTS: readonly Aspect[] = [
  { id: 'brightness', up: 'brighter', down: 'darker', roles: ['brightness'], prefer: ['modulation', 'filter', 'fx'], doc: 'tone brightness: filter cutoff (brighter/open vs darker/muffled)' },
  { id: 'resonance', up: 'more resonance', down: 'less resonance', roles: ['resonance'], prefer: ['filter'], doc: 'filter resonance / peak / squelch' },
  { id: 'attack', up: 'slower attack', down: 'faster attack', roles: ['attack'], prefer: ['envelope', 'dynamics'], ampEnvelope: true, doc: 'attack time: how fast the sound starts (slower/softer vs snappier/punchier)' },
  { id: 'decay', up: 'longer decay', down: 'shorter decay', roles: ['decay'], prefer: ['envelope'], ampEnvelope: true, doc: 'decay time after the attack' },
  { id: 'sustain', up: 'more sustain', down: 'less sustain', roles: ['sustain'], prefer: ['envelope'], ampEnvelope: true, doc: 'sustain level while a key is held' },
  { id: 'release', up: 'longer release', down: 'shorter release', roles: ['release'], prefer: ['envelope', 'dynamics'], ampEnvelope: true, doc: 'release time / tail after the key is let go' },
  { id: 'wobble', up: 'more wobble', down: 'less wobble', roles: ['depth'], group: true, relative: true, where: fedByModulator, doc: 'modulation depth: how much the LFO wobbles pitch, filter or volume (vibrato, tremolo)' },
  { id: 'rate', up: 'faster modulation', down: 'slower modulation', roles: ['rate'], prefer: ['modulation', 'fx'], group: true, doc: 'modulation speed: LFO rate' },
  { id: 'mix', up: 'wetter', down: 'drier', roles: ['mix'], prefer: ['fx'], where: (_d, n, c) => c.find(n.type)?.category === 'fx', doc: 'effect amount: wet/dry mix of reverb, delay, chorus' },
  { id: 'feedback', up: 'more repeats', down: 'fewer repeats', roles: ['feedback'], prefer: ['fx'], doc: 'echo repeats / effect feedback' },
  { id: 'time', up: 'longer delay time', down: 'shorter delay time', roles: ['time'], prefer: ['fx'], doc: 'delay time between echoes' },
  { id: 'drive', up: 'more drive', down: 'less drive', roles: ['drive'], prefer: ['fx', 'filter'], doc: 'distortion / saturation / grit' },
  { id: 'volume', up: 'louder', down: 'quieter', roles: ['volume'], doc: 'overall output volume' },
  { id: 'glide', up: 'more glide', down: 'less glide', roles: ['glide'], doc: 'portamento / glide time between notes' },
  { id: 'width', up: 'wider pulse', down: 'narrower pulse', roles: ['width'], doc: 'pulse width of the oscillator' },
];
export const aspectById = (id: string) => ASPECTS.find(a => a.id === id);

export interface Target { node: string; port: PortId }
export interface Candidate extends Target { def: PortDef; title: string; label?: string; category: Category; selected: boolean; score: number; description: string }

/** Unconnected, visible signal inputs whose roles match the aspect, best first. */
export function candidates(doc: PatchDocument, catalog: Catalog, aspect: Aspect, selection: readonly string[] = []): Candidate[] {
  const out: Candidate[] = [];
  for (const node of Object.values(doc.nodes)) {
    const def = catalog.find(node.type);
    if (!def || def.kind === 'widget' || def.kind === 'comment') continue;
    if (aspect.where && !aspect.where(doc, node, catalog)) continue;
    for (const port of catalog.inputs(node)) {
      if (port.type !== 'signal' || port.hidden || port.constant || port.role === 'audio' || port.binding) continue;
      if (!port.roles?.some(r => aspect.roles.includes(r))) continue;
      if (edgesInto(doc, node.id, port.id).length) continue;
      const selected = selection.includes(node.id);
      const preferIndex = aspect.prefer?.indexOf(def.category) ?? -1;
      let score = selected ? 100 : 0;
      score += preferIndex >= 0 ? 10 - preferIndex : 0;
      if (aspect.ampEnvelope && def.category === 'envelope') score += isAmpEnvelope(doc, node) ? 5 : 0;
      if (aspect.id === 'volume') score += feedsOut(doc, node) ? 5 : 0;
      out.push({ node: node.id, port: port.id, def: port, title: def.title, label: node.label, category: def.category, selected, score, description: describeCandidate(doc, catalog, node, port, selected) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.node.localeCompare(b.node) || a.port.localeCompare(b.port));
}

function isAmpEnvelope(doc: PatchDocument, node: PatchNode) {
  if (/amp/i.test(node.label ?? '')) return true;
  return edgesFrom(doc, node.id, 'done').some(e => doc.nodes[e.to.node]?.type === 'kit.voiceMix');
}
function feedsOut(doc: PatchDocument, node: PatchNode) {
  return Object.values(doc.edges).some(e => e.from.node === node.id && doc.nodes[e.to.node]?.type === 'kit.out');
}

/** "Filter 'Tone' (selected) → feeds VCA": what Jev reads when it must pick a target. */
export function describeCandidate(doc: PatchDocument, catalog: Catalog, node: PatchNode, port: PortDef, selected = false): string {
  const def = catalog.find(node.type);
  const feeds = [...new Set(Object.values(doc.edges).filter(e => e.from.node === node.id).map(e => { const n = doc.nodes[e.to.node]; return n ? (n.label ?? catalog.find(n.type)?.title ?? n.type) : ''; }).filter(Boolean))].slice(0, 2);
  const from = [...new Set(Object.values(doc.edges).filter(e => e.to.node === node.id).map(e => { const n = doc.nodes[e.from.node]; return n ? (n.label ?? catalog.find(n.type)?.title ?? n.type) : ''; }).filter(Boolean))].slice(0, 2);
  return `${def?.title ?? node.type}${node.label ? ` '${node.label}'` : ''}${selected ? ' (selected)' : ''}, knob ${port.label ?? port.id}${from.length ? `, driven by ${from.join(' and ')}` : ''}${feeds.length ? `, feeds ${feeds.join(' and ')}` : ''}`;
}

export type TargetChoice = { kind: 'one'; targets: Candidate[] } | { kind: 'ambiguous'; candidates: Candidate[] } | { kind: 'none' };

/** Selection wins, then a unique best score; group aspects take every match. */
export function chooseTargets(aspect: Aspect, list: readonly Candidate[]): TargetChoice {
  if (!list.length) return { kind: 'none' };
  const selected = list.filter(c => c.selected);
  if (selected.length) return aspect.group || selected.length === 1 ? { kind: 'one', targets: selected } : { kind: 'ambiguous', candidates: selected };
  if (aspect.group) return { kind: 'one', targets: list.filter(c => c.score === list[0]!.score) };
  if (list.length === 1 || list[0]!.score > list[1]!.score) return { kind: 'one', targets: [list[0]!] };
  return { kind: 'ambiguous', candidates: list.filter(c => c.score === list[0]!.score) };
}

const isLog = (p: PortDef) => p.scale === 'log' || p.unit === 'Hz' || p.unit === 's';
function bounds(p: PortDef): [number, number] {
  let lo = p.uiMin ?? p.min ?? 0, hi = p.uiMax ?? p.max ?? 1;
  if (isLog(p) && lo <= 0) lo = p.unit === 's' ? 0.001 : p.roles?.includes('rate') ? 0.01 : 20;
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

/** The next knob value, or null when it is already at the end in that direction. */
export function stepValue(port: PortDef, current: number, direction: Direction, amount: Amount = 'medium', options: { relative?: boolean } = {}): number | null {
  const [lo, hi] = bounds(port);
  const absMin = port.min ?? -Infinity, absMax = port.max ?? Infinity;
  let next: number;
  if (direction === 'set_max') next = hi;
  else if (direction === 'set_min') next = Math.max(absMin, port.uiMin ?? port.min ?? lo);
  else if (options.relative || port.unit === 'gain') {
    const sign = direction === 'up' ? 1 : -1;
    const factor = port.unit === 'gain' ? Math.pow(10, AMOUNT_DB[amount] / 20) : AMOUNT_FACTOR[amount];
    // From zero, "more" starts at a small fraction of the knob's range.
    if (Math.abs(current) < 1e-9) next = sign > 0 ? (hi - Math.max(0, lo)) * (port.unit === 'gain' ? 0.05 : 0.05 * factor) : 0;
    else next = sign > 0 ? current * factor : current / factor;
    if (sign > 0 && Math.abs(next) > Math.max(Math.abs(hi), Math.abs(current))) next = Math.sign(next) * Math.max(Math.abs(hi), Math.abs(current));
  } else {
    const sign = direction === 'up' ? 1 : -1;
    const step = AMOUNT_STEP[amount];
    if (isLog(port)) {
      const base = Math.max(current, lo);
      next = base * Math.pow(hi / lo, sign * step);
      if (sign > 0 && current < lo) next = Math.max(next, lo);
    } else next = current + sign * step * (hi - lo);
    // Stay inside the comfortable range unless the knob is already outside it.
    next = sign > 0 ? Math.min(next, Math.max(hi, current)) : Math.max(next, Math.min(lo, current));
  }
  next = Math.min(absMax, Math.max(absMin, next));
  next = roundNice(next);
  return Math.abs(next - current) < 1e-9 * Math.max(1, Math.abs(current)) ? null : next;
}

function roundNice(v: number) {
  if (v === 0 || !Number.isFinite(v)) return v;
  const digits = 4 - Math.ceil(Math.log10(Math.abs(v)));
  const f = Math.pow(10, Math.max(0, Math.min(8, digits)));
  return Math.round(v * f) / f;
}

export function formatValue(port: PortDef, v: number): string {
  if (port.unit === 'Hz') return v >= 1000 ? `${+(v / 1000).toFixed(2)} kHz` : `${+v.toFixed(v < 10 ? 2 : 0)} Hz`;
  if (port.unit === 's') return v < 1 ? `${+(v * 1000).toFixed(v < 0.01 ? 1 : 0)} ms` : `${+v.toFixed(2)} s`;
  if (port.unit === 'dB') return `${+v.toFixed(1)} dB`;
  return `${+v.toFixed(3)}`;
}

// ---- Plans ----------------------------------------------------------------------
export interface Change { node: string; port: PortId; from: number; to: number; text: string }
/** `label` is the full description (badge, history); `short` fits on a chip. */
export type Plan =
  | { kind: 'adjust'; aspect: string; direction: Direction; amount: Amount; intents: Intent[]; changes: Change[]; label: string; short: string }
  | { kind: 'addFx'; fx: FxId; intents: Intent[]; node: string; label: string; short: string }
  | { kind: 'multi'; plans: Plan[]; intents: Intent[]; label: string; short: string }
  | { kind: 'template'; template: string; doc: PatchDocument; label: string; short: string };

export type PlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; reason: 'no-target' | 'at-limit' | 'ambiguous' | 'no-output' | 'unknown'; message: string; candidates?: Candidate[] };

export function planAdjust(doc: PatchDocument, catalog: Catalog, request: { aspect: string; direction: Direction; amount?: Amount; targets?: Target[] }, selection: readonly string[] = []): PlanResult {
  const aspect = aspectById(request.aspect);
  if (!aspect) return { ok: false, reason: 'unknown', message: `Unknown aspect ${request.aspect}.` };
  const amount = request.amount ?? 'medium';
  const list = candidates(doc, catalog, aspect, selection);
  let targets: Candidate[];
  if (request.targets?.length) {
    targets = list.filter(c => request.targets!.some(t => t.node === c.node && (!t.port || t.port === c.port)));
    if (!targets.length) return { ok: false, reason: 'no-target', message: `Nothing in ${request.targets.map(t => t.node).join(', ')} controls ${aspect.up.replace(/^more /, '')}.` };
  } else {
    const choice = chooseTargets(aspect, list);
    if (choice.kind === 'none') return { ok: false, reason: 'no-target', message: `This patch has no free knob for “${request.direction === 'down' || request.direction === 'set_min' ? aspect.down : aspect.up}”${aspect.id === 'wobble' || aspect.id === 'rate' ? ' (no LFO is patched in)' : ''}.` };
    if (choice.kind === 'ambiguous') return { ok: false, reason: 'ambiguous', message: `Which one: ${choice.candidates.map(c => c.label ?? c.node).join(' or ')}?`, candidates: choice.candidates };
    targets = choice.targets;
  }
  const changes: Change[] = [];
  for (const t of targets) {
    const node = doc.nodes[t.node]!;
    const current = Number(node.values[t.port] ?? t.def.default ?? 0);
    const next = stepValue(t.def, current, request.direction, amount, { relative: aspect.relative });
    if (next === null) continue;
    changes.push({ node: t.node, port: t.port, from: current, to: next, text: `${node.label ?? t.node}.${t.port} ${formatValue(t.def, current)} → ${formatValue(t.def, next)}` });
  }
  const word = request.direction === 'down' || request.direction === 'set_min' ? aspect.down : aspect.up;
  if (!changes.length) return { ok: false, reason: 'at-limit', message: `Already at the ${request.direction === 'up' || request.direction === 'set_max' ? 'maximum' : 'minimum'} for “${word}”.`, candidates: targets };
  return {
    ok: true,
    plan: {
      kind: 'adjust', aspect: aspect.id, direction: request.direction, amount, changes,
      intents: changes.map(c => ({ op: 'setValue', node: c.node, port: c.port, value: c.to, clamp: true })),
      label: `${word}${request.direction === 'up' || request.direction === 'down' ? ` ×${amount}` : request.direction === 'set_max' ? ' (max)' : ' (min)'} → ${changes.map(c => c.text).join(', ')}`,
      short: `${word} · ${[...new Set(changes.map(c => doc.nodes[c.node]!.label ?? c.node))].slice(0, 2).join(', ')}${changes.length > 2 ? '…' : ''}`,
    },
  };
}

// ---- Effects ------------------------------------------------------------------------
export type FxId = 'reverb' | 'delay' | 'pingpong' | 'chorus' | 'phaser' | 'flanger' | 'drive' | 'compressor';
export const FX: Record<FxId, { type: string; title: string; doc: string; values?: Record<string, number | boolean>; config?: Record<string, string | number | boolean> }> = {
  reverb: { type: 'den.algorithmicReverb', title: 'Reverb', doc: 'reverb / room / hall / space', values: { mix: 0.25 } },
  delay: { type: 'den.delayFx', title: 'Delay', doc: 'echo delay', values: { mix: 0.3, feedback: 0.4 } },
  pingpong: { type: 'den.pingPongDelay', title: 'Ping-Pong Delay', doc: 'ping-pong stereo echo', values: { mix: 0.3 } },
  chorus: { type: 'den.delayFx', title: 'Chorus', doc: 'chorus / ensemble / thicken', config: { tone: 'flat', stereoPhaseCycles: 0.5 }, values: { timeLeftSeconds: 0.018, timeRightSeconds: 0.018, sync: false, feedback: 0, mix: 0.45, rateHz: 0.65, depthSeconds: 0.003 } },
  phaser: { type: 'den.phaser', title: 'Phaser', doc: 'phaser sweep' },
  flanger: { type: 'den.flanger', title: 'Flanger', doc: 'flanger / jet sweep' },
  drive: { type: 'den.drive', title: 'Drive', doc: 'distortion / saturation / overdrive', values: { gain: 3, mix: 1 } },
  compressor: { type: 'den.dynamics', title: 'Compressor', doc: 'compressor / dynamics / glue' },
};

/** Insert an effect between whatever feeds Out and Out (stereo when the effect is stereo). */
export function planAddFx(doc: PatchDocument, catalog: Catalog, fx: FxId): PlanResult {
  const spec = FX[fx];
  const out = Object.values(doc.nodes).find(n => n.type === 'kit.out');
  if (!out) return { ok: false, reason: 'no-output', message: 'There is no Out module to put the effect before.' };
  const left = edgesInto(doc, out.id, 'left')[0];
  const right = edgesInto(doc, out.id, 'right')[0];
  if (!left && !right) return { ok: false, reason: 'no-output', message: 'Nothing is connected to Out yet.' };
  const def = catalog.get(spec.type);
  const probe = { id: 'probe', type: spec.type, pos: { x: 0, y: 0 }, config: spec.config ?? {}, values: {} } as PatchNode;
  const ins = catalog.inputs(probe).filter(p => p.role === 'audio' && !p.id.startsWith('sidechain')).map(p => p.id);
  const outs = catalog.outputs(probe).filter(p => p.type === 'signal').map(p => p.id);
  const stereo = ins.includes('left') && ins.includes('right') && outs.includes('left') && outs.includes('right');
  const id = nextNodeId(doc, fx === 'compressor' ? 'comp' : fx);
  const intents: Intent[] = [
    { op: 'addNode', node: { id, type: spec.type, label: spec.title === def.title ? undefined : spec.title, pos: { x: out.pos.x, y: out.pos.y }, config: spec.config, values: spec.values } },
    { op: 'move', node: out.id, pos: { x: out.pos.x + 260, y: out.pos.y } },
  ];
  const leftSrc = left?.from ?? right!.from;
  if (stereo) {
    intents.push({ op: 'connect', from: leftSrc, to: { node: id, port: 'left' } });
    if (right) intents.push({ op: 'connect', from: right.from, to: { node: id, port: 'right' } });
    intents.push({ op: 'connect', from: { node: id, port: 'left' }, to: { node: out.id, port: 'left' }, replace: true });
    intents.push({ op: 'connect', from: { node: id, port: 'right' }, to: { node: out.id, port: 'right' }, replace: true });
  } else {
    const inPort = ins[0]!, outPort = outs[0]!;
    intents.push({ op: 'connect', from: leftSrc, to: { node: id, port: inPort } });
    intents.push({ op: 'connect', from: { node: id, port: outPort }, to: { node: out.id, port: 'left' }, replace: true });
    if (right && right.from.node === leftSrc.node && right.from.port === leftSrc.port) intents.push({ op: 'connect', from: { node: id, port: outPort }, to: { node: out.id, port: 'right' }, replace: true });
  }
  return { ok: true, plan: { kind: 'addFx', fx, intents, node: id, label: `add ${spec.title.toLowerCase()} before Out`, short: `+ ${spec.title}` } };
}

/** Several plans as one transaction (all planned against the same document). */
export function combinePlans(plans: Plan[]): Plan {
  if (plans.length === 1) return plans[0]!;
  const intents = plans.flatMap(p => p.kind === 'template' ? [] : p.intents);
  return { kind: 'multi', plans, intents, label: plans.map(p => p.label).join(' + '), short: plans.map(p => p.short).join(' + ') };
}

/** The existing effect node of this kind, if any (so "more reverb" adjusts instead of stacking). */
export function existingFx(doc: PatchDocument, fx: FxId): PatchNode | undefined {
  const spec = FX[fx];
  return Object.values(doc.nodes).find(n => n.type === spec.type && (fx !== 'chorus' && fx !== 'delay' ? true : fx === 'chorus' ? /chorus/i.test(n.label ?? '') : !/chorus/i.test(n.label ?? '')));
}

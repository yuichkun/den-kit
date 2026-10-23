// Graph analysis: per-voice scope inference, feedback rules and evaluation order.
//
// Voices: every node fed (transitively) by Voice In is per-voice and is
// replicated once per voice, until a Voice Mix sums the voices back into one
// global signal. History is the only legal way to close a loop: an edge into a
// History node is a back edge (its output is last sample's input).
import type { Catalog } from './catalog.ts';
import type { Issue } from './issues.ts';
import type { NodeId, PatchDocument, PatchEdge } from './schema.ts';

export type Scope = 'global' | 'voice';

export interface Analysis {
  scope: Map<NodeId, Scope>;
  /** Evaluation order inside one sample. */
  order: { pre: NodeId[]; voice: NodeId[]; post: NodeId[] };
  /** Nodes that contribute to an output (Out or a probe widget). */
  live: Set<NodeId>;
  issues: Issue[];
}

const isBackEdge = (doc: PatchDocument, edge: PatchEdge) =>
  doc.nodes[edge.to.node]?.type === 'kit.history';

/** Would adding from→to close a loop that does not pass through a History node? */
export function createsCycle(doc: PatchDocument, from: NodeId, to: NodeId): boolean {
  if (doc.nodes[to]?.type === 'kit.history') return false;
  if (from === to) return true;
  // Is `from` reachable from `to` over forward (non-History) edges?
  const next = new Map<NodeId, NodeId[]>();
  for (const edge of Object.values(doc.edges)) {
    if (isBackEdge(doc, edge)) continue;
    (next.get(edge.from.node) ?? next.set(edge.from.node, []).get(edge.from.node)!).push(
      edge.to.node,
    );
  }
  const seen = new Set<NodeId>([to]);
  const stack = [to];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === from) return true;
    for (const n of next.get(current) ?? [])
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
  }
  return false;
}

/** Find one forward cycle (ignoring History back edges), as a node path. */
export function findCycle(doc: PatchDocument): NodeId[] | null {
  const next = new Map<NodeId, NodeId[]>();
  for (const edge of Object.values(doc.edges)) {
    if (isBackEdge(doc, edge)) continue;
    (next.get(edge.from.node) ?? next.set(edge.from.node, []).get(edge.from.node)!).push(
      edge.to.node,
    );
  }
  const color = new Map<NodeId, 0 | 1 | 2>();
  const path: NodeId[] = [];
  const visit = (n: NodeId): NodeId[] | null => {
    color.set(n, 1);
    path.push(n);
    for (const m of next.get(n) ?? []) {
      if (color.get(m) === 1) return [...path.slice(path.indexOf(m)), m];
      if (!color.get(m)) {
        const found = visit(m);
        if (found) return found;
      }
    }
    color.set(n, 2);
    path.pop();
    return null;
  };
  for (const n of Object.keys(doc.nodes).sort())
    if (!color.get(n)) {
      const found = visit(n);
      if (found) return found;
    }
  return null;
}

export function analyze(doc: PatchDocument, catalog: Catalog): Analysis {
  const issues: Issue[] = [];
  const ids = Object.keys(doc.nodes).sort();
  const edges = Object.values(doc.edges).sort((a, b) => a.id.localeCompare(b.id));
  const typeOf = (id: NodeId) => doc.nodes[id]?.type;

  // 1. Scope: fixpoint, monotone (global → voice only).
  const scope = new Map<NodeId, Scope>(
    ids.map(id => [id, typeOf(id) === 'kit.voiceIn' ? 'voice' : 'global']),
  );
  // A node whose gate/retrigger follow the note implicitly (an envelope with no
  // gate cable) belongs to the voice it feeds.
  const noteBound = new Set(
    ids
      .filter(id => {
        const node = doc.nodes[id]!;
        return (
          catalog.has(node.type) &&
          catalog
            .inputs(node)
            .some(
              p =>
                (p.binding === 'gate' || p.binding === 'retrigger') &&
                !edges.some(e => e.to.node === id && e.to.port === p.id),
            )
        );
      })
      .filter(id => typeOf(id) !== 'kit.voiceMix'),
  );
  for (let changed = true; changed;) {
    changed = false;
    if (noteBound.size) {
      // Which nodes (transitively) feed the voice side?
      const feeds = new Set<NodeId>();
      const stack: NodeId[] = ids.filter(
        id => scope.get(id) === 'voice' || typeOf(id) === 'kit.voiceMix',
      );
      while (stack.length) {
        const target = stack.pop()!;
        for (const e of edges)
          if (
            e.to.node === target &&
            doc.nodes[e.from.node] &&
            !feeds.has(e.from.node) &&
            typeOf(e.from.node) !== 'kit.voiceMix'
          ) {
            feeds.add(e.from.node);
            stack.push(e.from.node);
          }
      }
      for (const id of noteBound)
        if (scope.get(id) !== 'voice' && feeds.has(id)) {
          scope.set(id, 'voice');
          changed = true;
        }
    }
    for (const edge of edges) {
      const source = typeOf(edge.from.node),
        target = edge.to.node;
      if (!source || !doc.nodes[target]) continue;
      if (source === 'kit.voiceMix') continue; // a mix output is global
      if (typeOf(target) === 'kit.voiceMix') continue; // the mix node itself stays global (its input side runs per voice)
      if (scope.get(edge.from.node) === 'voice' && scope.get(target) !== 'voice') {
        scope.set(target, 'voice');
        changed = true;
      }
    }
  }

  for (const edge of edges) {
    const target = doc.nodes[edge.to.node];
    if (!target || !doc.nodes[edge.from.node]) continue;
    const def = catalog.find(target.type);
    const fromVoice =
      scope.get(edge.from.node) === 'voice' && typeOf(edge.from.node) !== 'kit.voiceMix';
    if (target.type === 'kit.voiceMix') {
      if (!fromVoice)
        issues.push({
          severity: 'error',
          code: 'mix-not-voice',
          node: target.id,
          port: edge.to.port,
          edge: edge.id,
          message:
            'Voice Mix sums per-voice signals; this input is not per-voice (connect it after Voice In).',
        });
    } else if (fromVoice && def?.scope === 'global') {
      issues.push({
        severity: 'error',
        code: 'voice-to-global',
        node: target.id,
        port: edge.to.port,
        edge: edge.id,
        message: `${def.title} is global; per-voice signals must pass through Voice Mix first.`,
      });
    }
  }
  const voiceIns = ids.filter(id => typeOf(id) === 'kit.voiceIn');
  const mixes = ids.filter(id => typeOf(id) === 'kit.voiceMix');
  if (mixes.length && !voiceIns.length)
    for (const m of mixes)
      issues.push({
        severity: 'error',
        code: 'mix-without-voice-in',
        node: m,
        message: 'Voice Mix needs a Voice In in the patch.',
      });

  // 2. Liveness: nodes that reach Out or a probe widget (over any edge, History included).
  const sinks = ids.filter(
    id => typeOf(id) === 'kit.out' || typeOf(id) === 'ui.scope' || typeOf(id) === 'ui.meter',
  );
  const previous = new Map<NodeId, NodeId[]>();
  for (const edge of edges)
    (previous.get(edge.to.node) ?? previous.set(edge.to.node, []).get(edge.to.node)!).push(
      edge.from.node,
    );
  const live = new Set<NodeId>(sinks);
  const stack = [...sinks];
  while (stack.length)
    for (const n of previous.get(stack.pop()!) ?? [])
      if (!live.has(n) && doc.nodes[n]) {
        live.add(n);
        stack.push(n);
      }
  if (mixes.some(m => live.has(m))) for (const v of voiceIns) live.add(v);

  // 3. Order. Condense the voice side into one super node `@voices`; a mix output is a global source after it.
  const VOICES = '@voices';
  const unit = (id: NodeId) => (scope.get(id) === 'voice' ? VOICES : id);
  const order = { pre: [] as NodeId[], voice: [] as NodeId[], post: [] as NodeId[] };
  const forward = edges.filter(
    e => doc.nodes[e.from.node] && doc.nodes[e.to.node] && !isBackEdge(doc, e),
  );
  const units = new Set<string>(ids.map(unit));
  const deps = new Map<string, Set<string>>([...units].map(u => [u, new Set<string>()]));
  for (const edge of forward) {
    const from = unit(edge.from.node);
    // The mix node's input side runs inside the voice loop; its output is available after it.
    const to =
      typeOf(edge.to.node) === 'kit.voiceMix' && units.has(VOICES) ? VOICES : unit(edge.to.node);
    if (from !== to) deps.get(to)!.add(from);
  }
  for (const m of mixes) if (units.has(VOICES)) deps.get(m)!.add(VOICES);
  const sorted: string[] = [];
  const state = new Map<string, 1 | 2>();
  let scopeCycle = false;
  const visit = (u: string) => {
    if (state.get(u) === 2) return;
    if (state.get(u) === 1) {
      scopeCycle = true;
      return;
    }
    state.set(u, 1);
    for (const d of [...deps.get(u)!].sort()) visit(d);
    state.set(u, 2);
    sorted.push(u);
  };
  for (const u of [...units].sort()) visit(u);
  const cycle = findCycle(doc);
  if (cycle)
    issues.push({
      severity: 'error',
      code: 'cycle',
      node: cycle[0],
      message: `Feedback loop without History: ${cycle.join(' → ')}. Insert a History node to delay one sample.`,
    });
  else if (scopeCycle)
    issues.push({
      severity: 'error',
      code: 'mix-feedback',
      message:
        'A signal derived from Voice Mix feeds back into the voices. Insert a History node to delay it one sample.',
    });

  const voiceAt = sorted.indexOf(VOICES);
  for (const [i, u] of sorted.entries()) {
    if (u === VOICES) continue;
    (voiceAt >= 0 && i > voiceAt ? order.post : order.pre).push(u);
  }
  // Voice nodes in topological order (VoiceIn first).
  const voiceNodes = ids.filter(id => scope.get(id) === 'voice');
  const vdeps = new Map<NodeId, NodeId[]>(voiceNodes.map(id => [id, []]));
  for (const edge of forward)
    if (vdeps.has(edge.to.node) && vdeps.has(edge.from.node))
      vdeps.get(edge.to.node)!.push(edge.from.node);
  const vstate = new Map<NodeId, 1 | 2>();
  const vvisit = (id: NodeId) => {
    if (vstate.get(id)) return;
    vstate.set(id, 1);
    for (const d of vdeps.get(id)!.sort()) vvisit(d);
    vstate.set(id, 2);
    order.voice.push(id);
  };
  for (const id of [...voiceIns, ...voiceNodes]) vvisit(id);
  return { scope, order, live, issues };
}

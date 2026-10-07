// Module footprint and a compact Grid-like auto layout: signal flow left to
// right, modules packed side by side so straight chains line up port-to-port.
import type { Catalog, PortDef } from './catalog.ts';
import type { NodeId, PatchDocument, PatchNode, XY } from './schema.ts';

const VIZ = new Set(['den.envelope', 'den.curvedAdsr', 'den.oscillator', 'den.virtualAnalogSource', 'den.frequencyModulation', 'den.seededNoise', 'den.lfo', 'den.musicalLfo', 'den.randomModulator', 'den.sampleAndHold', 'den.filter', 'den.stateVariableFilter', 'den.characterFilter', 'den.biquadEq', 'den.drive', 'den.delayFx', 'den.pingPongDelay', 'den.algorithmicReverb', 'den.flanger', 'den.phaser', 'den.dynamics', 'kit.tremolo', 'kit.tanh', 'kit.voiceMix', 'kit.out', 'kit.audioIn', 'kit.cutoffMod']);
export const hasViz = (type: string) => VIZ.has(type);

/** Inputs drawn on the module edge (audio, gates, face params, connected); the rest live in the inspector. */
export function visibleInputs(catalog: Catalog, node: PatchNode, connected: ReadonlySet<string>, expanded: boolean): { shown: PortDef[]; hidden: number } {
  const def = catalog.find(node.type);
  const all = catalog.inputs(node).filter(p => !p.hidden);
  if (expanded || !def) return { shown: all, hidden: 0 };
  const face = new Set(catalog.face(node));
  const shown = all.filter(p => connected.has(p.id) || p.role === 'audio' || face.has(p.id) || (p.type === 'gate' && !p.binding && !p.constant) || def.kind === 'codebox' || all.length <= 4);
  return { shown, hidden: all.length - shown.length };
}

export interface ModuleBox { width: number; height: number; left: number; right: number; face: number; rows: number }

export function moduleBox(catalog: Catalog, node: PatchNode, connected: ReadonlySet<string> = new Set(), expanded = false): ModuleBox {
  const def = catalog.find(node.type);
  const { shown, hidden } = visibleInputs(catalog, node, connected, expanded);
  const outputs = catalog.outputs(node);
  const face = new Set(catalog.face(node));
  const knobs = catalog.inputs(node).filter(p => face.has(p.id) && !connected.has(p.id) && p.type === 'signal').length;
  const part = node.type === 'kit.part';
  const enumCfg = def?.config.find(c => c.kind === 'enum' && (c.options?.length ?? 0) <= 4 && !['unit', 'scale', 'quality', 'mode'].includes(c.id));
  const widget = def?.kind === 'widget', viz = hasViz(node.type);
  const small = shown.some(p => !connected.has(p.id) && p.role !== 'audio' && p.type === 'signal' && !face.has(p.id) && !p.binding && !p.constant && !p.fallback);
  const left = small ? 70 : shown.length ? 54 : 8;
  const right = outputs.length ? (outputs.some(o => (o.label ?? o.id).length > 4) ? 66 : 44) : 8;
  const faceW = Math.max(knobs * 54, viz ? 84 : 0, enumCfg ? (enumCfg.options?.length ?? 1) * 34 : 0, widget ? 60 : 0, node.type === 'kit.voiceIn' ? 90 : 0, def?.kind === 'codebox' ? 96 : 0, node.type === 'kit.comment' ? 160 : 0, part ? 150 : 0);
  const width = Math.max(def?.kind === 'partIn' || def?.kind === 'partOut' ? 132 : 108, Math.ceil((left + faceW + right + 8) / 12) * 12 - 6);
  const rows = Math.max(shown.length + (hidden ? 1 : 0), outputs.length, 1);
  const faceH = (enumCfg || node.type === 'kit.voiceIn' ? 20 : 0) + (viz ? (node.type === 'den.envelope' || node.type === 'den.curvedAdsr' ? 50 : 40) : 0) + (knobs ? 64 : 0) + (widget ? 40 : 0) + (def?.kind === 'codebox' ? 34 : 0) + (node.type === 'kit.comment' ? 40 : 0) + (part ? 40 : 0);
  const height = 24 + Math.max(rows * 24 + 4, faceH) + 8;
  return { width, height, left, right, face: faceW, rows };
}

/** Left-to-right layout by signal depth; each module tries to sit on its main source's row. */
export function autoLayout(doc: PatchDocument, catalog: Catalog, origin: XY = { x: 0, y: 0 }): Record<NodeId, XY> {
  const ids = Object.keys(doc.nodes).sort();
  const edges = Object.values(doc.edges).filter(e => doc.nodes[e.to.node]?.type !== 'kit.history').sort((a, b) => a.id.localeCompare(b.id));
  const connected = new Map<NodeId, Set<string>>(ids.map(id => [id, new Set(Object.values(doc.edges).filter(e => e.to.node === id).map(e => e.to.port))]));
  const box = new Map(ids.map(id => [id, moduleBox(catalog, doc.nodes[id]!, connected.get(id))]));
  const depth = new Map<NodeId, number>();
  const visit = (id: NodeId, seen: Set<NodeId>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const preds = edges.filter(e => e.to.node === id).map(e => e.from.node);
    const d = preds.length ? Math.max(...preds.map(p => visit(p, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id, new Set());
  // Pure sources (envelopes, LFOs, knobs) sit just before their first consumer, not at the far left.
  for (const id of ids) {
    if (edges.some(e => e.to.node === id)) continue;
    const consumers = edges.filter(e => e.from.node === id).map(e => depth.get(e.to.node) ?? 1);
    if (consumers.length && doc.nodes[id]!.type !== 'kit.voiceIn' && doc.nodes[id]!.type !== 'kit.audioIn') depth.set(id, Math.max(0, Math.min(...consumers) - 1));
  }
  // Sinks (Out) go to the last column.
  const maxDepth = Math.max(0, ...depth.values());
  for (const id of ids) if (doc.nodes[id]!.type === 'kit.out') depth.set(id, maxDepth);
  const columns: NodeId[][] = [];
  for (const id of ids) (columns[depth.get(id)!] ??= []).push(id);
  const pos: Record<NodeId, XY> = {};
  let x = origin.x;
  const GAP = 6;
  for (const column of columns) {
    if (!column) continue;
    // Order by the row of the main source to keep chains straight.
    const mainSource = (id: NodeId) => edges.find(e => e.to.node === id && pos[e.from.node]);
    column.sort((a, b) => (pos[mainSource(a)?.from.node ?? '']?.y ?? Infinity) - (pos[mainSource(b)?.from.node ?? '']?.y ?? Infinity) || a.localeCompare(b));
    let bottom = origin.y;
    for (const id of column) {
      const source = mainSource(id);
      const want = source ? pos[source.from.node]!.y : bottom;
      const y = Math.max(want, bottom);
      pos[id] = { x, y: Math.round(y / 6) * 6 };
      bottom = pos[id]!.y + box.get(id)!.height + GAP;
    }
    x += Math.max(...column.map(id => box.get(id)!.width)) + GAP;
  }
  return pos;
}

export function withLayout(doc: PatchDocument, catalog: Catalog): PatchDocument {
  const pos = autoLayout(doc, catalog);
  return { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => [id, { ...n, pos: pos[id] ?? n.pos }])) };
}

/** The nearest place to `near` (on a 12 px grid, searching outward) where `node` overlaps nothing else in its part of the patch. */
export function freeSpotNear(doc: PatchDocument, catalog: Catalog, node: PatchNode, near: XY): XY {
  const MARGIN = 12;
  const size = moduleBox(catalog, node);
  const others = Object.values(doc.nodes).filter(n => n.id !== node.id && n.inside === node.inside).map(n => { const b = moduleBox(catalog, n, new Set(Object.values(doc.edges).filter(e => e.to.node === n.id).map(e => e.to.port))); return { x: n.pos.x, y: n.pos.y, w: b.width, h: b.height }; });
  const free = (p: XY) => !others.some(q => p.x < q.x + q.w + MARGIN && q.x < p.x + size.width + MARGIN && p.y < q.y + q.h + MARGIN && q.y < p.y + size.height + MARGIN);
  for (let ring = 0; ring <= 30; ring++) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const p = { x: Math.round((near.x + dx * 24) / 12) * 12, y: Math.round((near.y + dy * 24) / 12) * 12 };
      if (free(p)) return p;
    }
  }
  return near;
}

/**
 * Where to put modules that were added without a position (the LLM rarely gives
 * good ones): in the nearest free spot below what they connect to, never on top
 * of another module (sizes from moduleBox). Returns `move` intents.
 */
export function placeNewNodes(doc: PatchDocument, catalog: Catalog, ids: readonly NodeId[]): Array<{ op: 'move'; node: NodeId; pos: XY }> {
  const MARGIN = 24, STEP_X = 60, STEP_Y = 48;
  const inputsOf = (id: NodeId) => new Set(Object.values(doc.edges).filter(e => e.to.node === id).map(e => e.to.port));
  const size = (id: NodeId) => moduleBox(catalog, doc.nodes[id]!, inputsOf(id));
  const pending = new Set(ids.filter(id => doc.nodes[id]));
  const rects = new Map<NodeId, { x: number; y: number; w: number; h: number }>();
  for (const n of Object.values(doc.nodes)) if (!pending.has(n.id)) { const b = size(n.id); rects.set(n.id, { x: n.pos.x, y: n.pos.y, w: b.width, h: b.height }); }
  const overlaps = (r: { x: number; y: number; w: number; h: number }) => [...rects.values()].some(q => r.x < q.x + q.w + MARGIN && q.x < r.x + r.w + MARGIN && r.y < q.y + q.h + MARGIN && q.y < r.y + r.h + MARGIN);
  const edges = Object.values(doc.edges);
  const moves: Array<{ op: 'move'; node: NodeId; pos: XY }> = [];
  for (const id of ids) {
    if (!pending.has(id)) continue;
    const b = size(id);
    // Modulators sit under what they feed (output toward its inputs); followers under what feeds them.
    const target = edges.find(e => e.from.node === id && rects.has(e.to.node));
    const source = edges.find(e => e.to.node === id && rects.has(e.from.node));
    let anchor: XY;
    if (target) { const t = rects.get(target.to.node)!; anchor = { x: t.x - Math.round(b.width / 2), y: t.y + t.h + MARGIN }; }
    else if (source) { const s = rects.get(source.from.node)!; anchor = { x: s.x + Math.round(s.w / 2), y: s.y + s.h + MARGIN }; }
    else {
      const all = [...rects.values()];
      anchor = all.length ? { x: Math.min(...all.map(r => r.x)), y: Math.max(...all.map(r => r.y + r.h)) + MARGIN } : { x: 0, y: 0 };
    }
    let spot: XY | null = null;
    for (let row = 0; row < 40 && !spot; row++) {
      for (const col of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
        const p = { x: Math.round((anchor.x + col * STEP_X) / 6) * 6, y: Math.round((anchor.y + row * STEP_Y) / 6) * 6 };
        if (!overlaps({ x: p.x, y: p.y, w: b.width, h: b.height })) { spot = p; break; }
      }
    }
    spot ??= { x: anchor.x, y: Math.max(...[...rects.values()].map(r => r.y + r.h), 0) + MARGIN };
    rects.set(id, { x: spot.x, y: spot.y, w: b.width, h: b.height });
    pending.delete(id);
    moves.push({ op: 'move', node: id, pos: spot });
  }
  return moves;
}

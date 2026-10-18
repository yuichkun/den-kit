// Edits that make, take apart and reshape parts, and the step that runs after
// every transaction to keep each use of a part in step with its definition
// (its inputs, parameters and outputs), dropping parts nothing uses any more.
// Everything is expressed as resolved ops, so it undoes exactly.
import type { Catalog, PortDef } from './catalog.ts';
import { freeSpotNear } from './layout.ts';
import { fail } from './op-error.ts';
import type { ResolvedOp } from './ops.ts';
import { checkFace } from './face.ts';
import { checkBundle, type PartBundle } from './library.ts';
import {
  RANGE_UNITS,
  hasParts,
  isPartPort,
  membersOf,
  partIdFor,
  partInterface,
  usedParts,
  usesOf,
} from './parts.ts';
import { spreadable } from './stacks.ts';
import {
  NODE_ID_PATTERN,
  PART_ID_PATTERN,
  PORT_ID_PATTERN,
  clone,
  nextEdgeId,
  nextNodeId,
  type NodeId,
  type ParamRange,
  type PartDef,
  type PartParam,
  type PartPort,
  type PatchDocument,
  type PatchEdge,
  type PatchNode,
  type PortId,
  type PortRef,
  type Value,
  type XY,
} from './schema.ts';

export interface PartDraft {
  doc: PatchDocument;
  readonly catalog: Catalog;
  apply(op: ResolvedOp): void;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
const byPlace = (a: PatchNode, b: PatchNode) =>
  a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.id.localeCompare(b.id);
const MAX_PARAMS = 8;

export function requirePart(doc: PatchDocument, id: unknown): PartDef {
  if (typeof id !== 'string' || !doc.parts[id]) {
    const known = Object.values(doc.parts).map(p => `${p.id} (${p.name})`);
    fail(
      'unknown-part',
      `No part "${String(id)}".`,
      known.length
        ? `Parts: ${known.join(', ')}`
        : 'The patch has no parts yet (makePart makes one from modules).',
    );
  }
  return doc.parts[id as string]!;
}

function requireUse(doc: PatchDocument, id: unknown): PatchNode & { part: string } {
  const n = typeof id === 'string' ? doc.nodes[id] : undefined;
  if (!n) fail('unknown-node', `No node "${String(id)}".`);
  if (n!.type !== 'kit.part' || !n!.part) fail('not-part', `${n!.id} is not a part.`);
  requirePart(doc, n!.part);
  return n as PatchNode & { part: string };
}

/** A port id from a wish ("cutoff", a label) that is free in `taken`. */
function freePortId(wish: string, taken: ReadonlySet<string>, fallback: string): PortId {
  const words = wish
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let base = words
    .map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join('')
    .replace(/^[^A-Za-z]+/, '')
    .slice(0, 28);
  if (!PORT_ID_PATTERN.test(base)) base = fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

const isKnob = (port: PortDef | undefined) =>
  !!port && port.role !== 'audio' && !port.binding && !port.constant && !port.hidden;
const portKey = (r: PortRef) => `${r.node}.${r.port}`;

/** The modules a part may hold: not controls (they live on the plugin), Voice In, Out, Audio In, or another part's inputs and outputs. */
function staysOutside(catalog: Catalog, n: PatchNode): boolean {
  const d = catalog.find(n.type);
  return (
    !!d && (d.kind === 'widget' || !!d.singleton || d.kind === 'partIn' || d.kind === 'partOut')
  );
}

/** Modules in signal order (sources first), ties by place: parameters and names then read like the sound flows. */
function flowOrder(doc: PatchDocument, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  const into = new Map<NodeId, number>(ids.map(id => [id, 0]));
  const edges = Object.values(doc.edges).filter(
    e => set.has(e.from.node) && set.has(e.to.node) && doc.nodes[e.to.node]!.type !== 'kit.history',
  );
  for (const e of edges) into.set(e.to.node, into.get(e.to.node)! + 1);
  const out: NodeId[] = [];
  const ready = () =>
    ids
      .filter(id => into.get(id) === 0 && !out.includes(id))
      .sort((a, b) => byPlace(doc.nodes[a]!, doc.nodes[b]!));
  for (let next = ready(); next.length; next = ready()) {
    const id = next[0]!;
    out.push(id);
    for (const e of edges) if (e.from.node === id) into.set(e.to.node, into.get(e.to.node)! - 1);
  }
  return [
    ...out,
    ...ids.filter(id => !out.includes(id)).sort((a, b) => byPlace(doc.nodes[a]!, doc.nodes[b]!)),
  ];
}

function autoName(doc: PatchDocument, catalog: Catalog, ids: readonly NodeId[]): string {
  const titles = [
    ...new Set(
      ids
        .map(id => doc.nodes[id]!)
        .filter(n => catalog.find(n.type)?.kind !== 'comment')
        .map(n => n.label ?? catalog.find(n.type)?.title ?? n.type),
    ),
  ];
  const name =
    titles.length > 3
      ? `${titles.slice(0, 2).join(' + ')} + ${titles.length - 2} more`
      : titles.join(' + ');
  return name.slice(0, 48) || 'Part';
}

/**
 * Make a part from modules (in the main patch or inside a part): they move
 * inside it, cables across the edge become its inputs and outputs, their main
 * knobs its parameters, and one use of it takes their place (sounding the same).
 */
export function makePart(
  draft: PartDraft,
  intent: { ids: NodeId[]; name?: string; id?: string; node?: NodeId },
  created: string[],
) {
  const { catalog } = draft;
  const doc = () => draft.doc;
  const ids = [...new Set(Array.isArray(intent.ids) ? intent.ids : [])];
  if (!ids.length) fail('bad-intent', 'makePart needs the ids of the modules to put in the part.');
  for (const id of ids)
    if (typeof id !== 'string' || !doc().nodes[id])
      fail('unknown-node', `No node "${String(id)}".`);
  const scope = doc().nodes[ids[0]!]!.inside;
  if (ids.some(id => doc().nodes[id]!.inside !== scope))
    fail(
      'mixed-scope',
      'The modules must all be in the same place (the main patch, or the same part).',
    );
  const chosen = ids.filter(id => !staysOutside(catalog, doc().nodes[id]!));
  if (!chosen.length)
    fail(
      'nothing-to-part',
      'Nothing here can go in a part: controls, Voice In, Out and Audio In stay in the main patch.',
      'Select the modules that make the sound.',
    );
  const inside = new Set(chosen);
  const moving = flowOrder(doc(), chosen);
  const name =
    typeof intent.name === 'string' && intent.name.trim()
      ? intent.name.trim().slice(0, 60)
      : autoName(doc(), catalog, moving);
  const partId = intent.id ?? partIdFor(doc(), name);
  if (!PART_ID_PATTERN.test(partId))
    fail(
      'bad-id',
      `Part id "${partId}" must match ${PART_ID_PATTERN} (letters/digits, starting lowercase).`,
    );
  if (doc().parts[partId]) fail('duplicate-id', `A part "${partId}" already exists.`);
  const useId = intent.node ?? nextNodeId(doc(), partId);
  if (!NODE_ID_PATTERN.test(useId))
    fail('bad-id', `Node id "${useId}" must match ${NODE_ID_PATTERN}.`);
  if (doc().nodes[useId] || doc().ui.elements[useId] || doc().ui.groups[useId])
    fail('duplicate-id', `Id "${useId}" is already taken.`);

  const scoped = Object.values(doc().edges)
    .filter(
      e => doc().nodes[e.from.node]?.inside === scope && doc().nodes[e.to.node]?.inside === scope,
    )
    .sort(byId);
  const incoming = scoped.filter(e => !inside.has(e.from.node) && inside.has(e.to.node));
  const outgoing = scoped.filter(e => inside.has(e.from.node) && !inside.has(e.to.node));
  const groups = <K>(edges: PatchEdge[], key: (e: PatchEdge) => K) => {
    const m = new Map<K, PatchEdge[]>();
    for (const e of edges) (m.get(key(e)) ?? m.set(key(e), []).get(key(e))!).push(e);
    return [...m.values()];
  };
  const ins = groups(incoming, e => portKey(e.from)),
    outs = groups(outgoing, e => portKey(e.from));
  const outputType = (r: PortRef) => {
    const n = doc().nodes[r.node]!;
    return catalog.output(n, r.port)?.type ?? 'signal';
  };

  const box = (list: PatchNode[]) => ({
    x0: Math.min(...list.map(n => n.pos.x)),
    y0: Math.min(...list.map(n => n.pos.y)),
    x1: Math.max(...list.map(n => n.pos.x)),
    y1: Math.max(...list.map(n => n.pos.y)),
  });
  const area = box(moving.map(id => doc().nodes[id]!));
  const takenIds = new Set<string>([useId]);
  const freshNode = (stem: string) => {
    const id = nextNodeId(doc(), stem, takenIds);
    takenIds.add(id);
    return id;
  };
  const portIds = new Set<string>();
  const inputs: Array<PartPort & { type: 'signal' | 'gate'; edges: PatchEdge[]; at: XY }> = ins.map(
    list => {
      const targets = [...new Set(list.map(e => e.to.port))];
      const id = freePortId(targets.length === 1 ? targets[0]! : 'in', portIds, 'in');
      portIds.add(id);
      const ys = list.map(e => doc().nodes[e.to.node]!.pos.y);
      return {
        id,
        node: freshNode(`${partId}In`),
        type: outputType(list[0]!.from),
        edges: list,
        at: {
          x: area.x0 - 192,
          y: Math.round(ys.reduce((a, b) => a + b, 0) / ys.length / 12) * 12,
        },
      };
    },
  );
  const outIds = new Set<string>();
  const outputs: Array<PartPort & { type: 'signal' | 'gate'; edges: PatchEdge[]; at: XY }> =
    outs.map(list => {
      const from = list[0]!.from;
      const id = freePortId(from.port, outIds, 'out');
      outIds.add(id);
      return {
        id,
        node: freshNode(`${partId}Out`),
        type: outputType(from),
        edges: list,
        at: { x: area.x1 + 252, y: doc().nodes[from.node]!.pos.y },
      };
    });
  // Main knobs that stay free inside become parameters (each use has its own value).
  const fedInside = new Set([...scoped.filter(e => inside.has(e.to.node)).map(e => portKey(e.to))]);
  const params: PartParam[] = [];
  const values: Record<PortId, Value> = {};
  const candidates: Array<{ node: PatchNode; port: PortDef }> = [];
  for (const id of moving) {
    const n = doc().nodes[id]!;
    if (n.type === 'kit.part') continue;
    for (const portId of catalog.face(n)) {
      const port = catalog.input(n, portId);
      if (isKnob(port) && !fedInside.has(`${id}.${portId}`))
        candidates.push({ node: n, port: port! });
    }
  }
  const repeated = new Set(
    candidates.map(c => c.port.id).filter((p, i, all) => all.indexOf(p) !== i),
  );
  for (const { node, port } of candidates.slice(0, MAX_PARAMS)) {
    const id = freePortId(port.id, new Set([...portIds, ...params.map(p => p.id)]), 'param');
    params.push({
      id,
      node: node.id,
      port: port.id,
      ...(repeated.has(port.id)
        ? { label: `${node.label ?? node.id} ${port.label ?? port.id}` }
        : {}),
    });
    values[id] = node.values[port.id] ?? port.default ?? (port.type === 'gate' ? false : 0);
  }

  const def: PartDef = {
    id: partId,
    name,
    inputs: inputs.map(p => ({ id: p.id, node: p.node })),
    outputs: outputs.map(p => ({ id: p.id, node: p.node })),
    params,
  };
  draft.apply({ op: 'addPart', part: def });
  for (const e of [...incoming, ...outgoing])
    draft.apply({ op: 'removeEdge', edge: doc().edges[e.id]! });
  for (const id of moving)
    draft.apply({
      op: 'setField',
      node: id,
      field: 'inside',
      from: doc().nodes[id]!.inside,
      to: partId,
    });
  const edge = (from: PortRef, to: PortRef) =>
    draft.apply({
      op: 'addEdge',
      edge: { id: nextEdgeId(doc()), from: { ...from }, to: { ...to } },
    });
  for (const p of inputs) {
    draft.apply({
      op: 'addNode',
      node: {
        id: p.node,
        type: 'kit.partIn',
        pos: p.at,
        config: { type: p.type },
        values: {},
        inside: partId,
      },
    });
    for (const e of p.edges) edge({ node: p.node, port: 'out' }, e.to);
  }
  for (const p of outputs) {
    draft.apply({
      op: 'addNode',
      node: {
        id: p.node,
        type: 'kit.partOut',
        pos: p.at,
        config: { type: p.type },
        values: {},
        inside: partId,
      },
    });
    edge(p.edges[0]!.from, { node: p.node, port: 'in' });
  }
  const use: PatchNode = {
    id: useId,
    type: 'kit.part',
    part: partId,
    pos: { x: area.x0, y: area.y0 },
    config: {},
    values,
    ...(scope !== undefined ? { inside: scope } : {}),
  };
  use.iface = partInterface(doc(), catalog, def);
  use.pos = freeSpotNear(doc(), catalog, use, use.pos);
  draft.apply({ op: 'addNode', node: use });
  for (const p of inputs) edge(p.edges[0]!.from, { node: useId, port: p.id });
  for (const p of outputs) for (const e of p.edges) edge({ node: useId, port: p.id }, e.to);
  created.push(useId);
}

/** Put a part's insides back in its place as ordinary modules (moved out when this is its only use, copied otherwise). */
export function unpackPart(draft: PartDraft, intent: { node: NodeId }, created: string[]) {
  const doc = () => draft.doc;
  const use = requireUse(doc(), intent.node);
  if ((use.count ?? 1) > 1)
    fail(
      'stacked',
      `${use.id} runs as ×${use.count} copies; set it to ×1 before unpacking it.`,
      `setCount {node: "${use.id}", count: 1}, then unpackPart.`,
    );
  const def = doc().parts[use.part]!;
  const members = membersOf(doc(), def.id);
  const body = members.filter(n => !isPartPort(n));
  const shared = usesOf(doc(), def.id).length > 1;
  const taken = new Set<string>();
  const rename = new Map<NodeId, NodeId>();
  for (const n of body) {
    const id = shared ? nextNodeId(doc(), n.id.replace(/\d+$/, '') || 'node', taken) : n.id;
    taken.add(id);
    rename.set(n.id, id);
  }
  const x0 = body.length ? Math.min(...body.map(n => n.pos.x)) : use.pos.x,
    y0 = body.length ? Math.min(...body.map(n => n.pos.y)) : use.pos.y;
  const shift = (p: XY) => ({ x: p.x - x0 + use.pos.x, y: p.y - y0 + use.pos.y });
  const valueOf = (n: PatchNode, port: PortId) => {
    const p = def.params.find(q => q.node === n.id && q.port === port);
    return p && Object.hasOwn(use.values, p.id) ? use.values[p.id] : n.values[port];
  };
  const outer = Object.values(doc().edges)
    .filter(e => e.from.node === use.id || e.to.node === use.id)
    .sort(byId);
  const driverOf = (port: PortId) =>
    outer.find(e => e.to.node === use.id && e.to.port === port)?.from;
  const targetsOf = (port: PortId) =>
    outer.filter(e => e.from.node === use.id && e.from.port === port).map(e => e.to);
  const inner = Object.values(doc().edges)
    .filter(e => members.some(n => n.id === e.from.node))
    .sort(byId);
  // The cables the modules will have once outside, worked out before anything changes.
  const wanted: Array<{ from: PortRef; to: PortRef }> = [];
  const map = (r: PortRef) => ({ node: rename.get(r.node)!, port: r.port });
  const portOf = (id: NodeId) =>
    def.inputs.find(p => p.node === id)?.id ?? def.outputs.find(p => p.node === id)?.id;
  for (const e of inner) {
    const from = doc().nodes[e.from.node]!,
      to = doc().nodes[e.to.node]!;
    const sources: PortRef[] =
      from.type === 'kit.partIn'
        ? [driverOf(portOf(from.id) ?? '')].filter((r): r is PortRef => !!r)
        : [map(e.from)];
    const targets: PortRef[] =
      to.type === 'kit.partOut' ? targetsOf(portOf(to.id) ?? '') : [map(e.to)];
    for (const s of sources) for (const t of targets) wanted.push({ from: s, to: t });
  }
  for (const p of def.params) {
    const d = driverOf(p.id);
    if (d && rename.has(p.node))
      wanted.push({ from: d, to: { node: rename.get(p.node)!, port: p.port } });
  }
  for (const e of outer) draft.apply({ op: 'removeEdge', edge: doc().edges[e.id]! });
  if (shared) {
    for (const n of body) {
      const copy: PatchNode = {
        ...clone(n),
        id: rename.get(n.id)!,
        pos: shift(n.pos),
        values: { ...n.values },
      };
      for (const port of Object.keys(copy.values)) copy.values[port] = valueOf(n, port)!;
      if (use.inside !== undefined) copy.inside = use.inside;
      else delete copy.inside;
      draft.apply({ op: 'addNode', node: copy });
    }
  } else {
    for (const e of inner)
      if (doc().edges[e.id]) draft.apply({ op: 'removeEdge', edge: doc().edges[e.id]! });
    for (const n of members.filter(isPartPort))
      draft.apply({ op: 'removeNode', node: doc().nodes[n.id]! });
    for (const n of body) {
      draft.apply({ op: 'setField', node: n.id, field: 'inside', from: n.inside, to: use.inside });
      draft.apply({ op: 'setField', node: n.id, field: 'pos', from: n.pos, to: shift(n.pos) });
      for (const port of Object.keys(n.values)) {
        const v = valueOf(n, port);
        if (v !== n.values[port])
          draft.apply({ op: 'setValue', node: n.id, port, from: n.values[port], to: v });
      }
    }
  }
  draft.apply({ op: 'removeNode', node: doc().nodes[use.id]! });
  const seen = new Set<string>();
  for (const w of wanted) {
    const key = portKey(w.to);
    if (seen.has(key) || !doc().nodes[w.from.node] || !doc().nodes[w.to.node]) continue;
    if (Object.values(doc().edges).some(e => e.to.node === w.to.node && e.to.port === w.to.port))
      continue;
    seen.add(key);
    draft.apply({
      op: 'addEdge',
      edge: { id: nextEdgeId(doc()), from: { ...w.from }, to: { ...w.to } },
    });
  }
  created.push(...body.map(n => rename.get(n.id)!));
}

/** Give this use its own copy of the part, so edits inside change only it. */
export function detachPart(
  draft: PartDraft,
  intent: { node: NodeId; name?: string },
  _created: string[],
) {
  const doc = () => draft.doc;
  const use = requireUse(doc(), intent.node);
  const def = doc().parts[use.part]!;
  if (usesOf(doc(), def.id).length < 2)
    fail('not-shared', `${def.name} is used only here, so it is already its own.`);
  let name =
    typeof intent.name === 'string' && intent.name.trim() ? intent.name.trim().slice(0, 60) : '';
  if (!name) {
    const names = new Set(Object.values(doc().parts).map(p => p.name));
    for (let k = 2; ; k++)
      if (!names.has(`${def.name} ${k}`)) {
        name = `${def.name} ${k}`;
        break;
      }
  }
  const copyId = partIdFor(doc(), name);
  const members = membersOf(doc(), def.id);
  const taken = new Set<string>();
  const rename = new Map<NodeId, NodeId>();
  for (const n of members) {
    const id = nextNodeId(doc(), n.id.replace(/\d+$/, '') || 'node', taken);
    taken.add(id);
    rename.set(n.id, id);
  }
  const next: PartDef = {
    ...clone(def),
    id: copyId,
    name,
    inputs: def.inputs.map(p => ({ id: p.id, node: rename.get(p.node) ?? p.node })),
    outputs: def.outputs.map(p => ({ id: p.id, node: rename.get(p.node) ?? p.node })),
    params: def.params.map(p => ({ ...p, node: rename.get(p.node) ?? p.node })),
  };
  delete next.from;
  draft.apply({ op: 'addPart', part: next });
  for (const n of members)
    draft.apply({ op: 'addNode', node: { ...clone(n), id: rename.get(n.id)!, inside: copyId } });
  for (const e of Object.values(doc().edges)
    .filter(e => rename.has(e.from.node) && rename.has(e.to.node))
    .sort(byId)) {
    draft.apply({
      op: 'addEdge',
      edge: {
        id: nextEdgeId(doc()),
        from: { node: rename.get(e.from.node)!, port: e.from.port },
        to: { node: rename.get(e.to.node)!, port: e.to.port },
      },
    });
  }
  draft.apply({ op: 'setField', node: use.id, field: 'part', from: def.id, to: copyId });
}

/** Rename or describe a part, relabel its inputs, outputs and parameters, or record where it stands with My parts. */
export function updatePart(
  draft: PartDraft,
  intent: {
    part: string;
    name?: string;
    doc?: string | null;
    labels?: Record<string, string | null>;
    ranges?: Record<string, unknown>;
    from?: PartDef['from'] | null;
    face?: unknown;
  },
) {
  const def = requirePart(draft.doc, intent.part);
  const next = clone(def);
  if (intent.name !== undefined) {
    const name = String(intent.name ?? '')
      .trim()
      .slice(0, 60);
    if (!name) fail('bad-value', 'A part needs a name.');
    next.name = name;
  }
  if (intent.doc !== undefined) {
    const text = intent.doc === null ? '' : String(intent.doc).trim().slice(0, 600);
    if (text) next.doc = text;
    else delete next.doc;
  }
  const ranges = intent.ranges ?? {};
  if (!ranges || typeof ranges !== 'object' || Array.isArray(ranges))
    fail('bad-intent', 'ranges is {paramId: {min, max, scale?, unit?} | null}.');
  for (const [id, raw] of Object.entries(ranges)) {
    const param = next.params.find(p => p.id === id);
    if (!param)
      fail(
        'unknown-port',
        `${def.name} has no parameter "${id}".`,
        `Parameters: ${next.params.map(p => p.id).join(', ') || 'none'}.`,
      );
    const n = draft.doc.nodes[param!.node],
      port = n ? draft.catalog.input(n, param!.port) : undefined;
    if (raw === null) delete param!.range;
    else if (port) param!.range = checkParamRange(raw, port, `${param!.node}.${param!.port}`);
  }
  if (intent.face !== undefined) {
    // The face is checked against the part's parameters as they are now (a use shows them all).
    if (intent.face === null) delete next.face;
    else
      next.face = checkFace(
        intent.face,
        next,
        partInterface(draft.doc, draft.catalog, next).inputs,
        { assets: draft.doc.assets },
      );
  }
  if (intent.from !== undefined) {
    const f = intent.from;
    if (f === null) delete next.from;
    else if (
      !f ||
      typeof f.id !== 'string' ||
      !f.id ||
      !Number.isInteger(f.version) ||
      f.version < 1
    )
      fail('bad-value', 'from is {id, version, hash?} of a part in My parts (or null).');
    else
      next.from = {
        id: f.id.slice(0, 80),
        version: f.version,
        ...(typeof f.hash === 'string' ? { hash: f.hash.slice(0, 64) } : {}),
      };
  }
  const labels = intent.labels ?? {};
  if (typeof labels !== 'object') fail('bad-intent', 'labels is {portOrParamId: "Label" | null}.');
  for (const [id, raw] of Object.entries(labels)) {
    const label = typeof raw === 'string' ? raw.trim().slice(0, 40) : '';
    const param = next.params.find(p => p.id === id);
    const port = [...next.inputs, ...next.outputs].find(p => p.id === id);
    if (param) {
      if (label) param.label = label;
      else delete param.label;
    } else if (port) {
      const n = draft.doc.nodes[port.node];
      if (n && n.label !== (label || undefined))
        draft.apply({
          op: 'setField',
          node: n.id,
          field: 'label',
          from: n.label,
          to: label || undefined,
        });
    } else
      fail(
        'unknown-port',
        `${def.name} has no input, output or parameter "${id}".`,
        `It has: ${[...def.inputs, ...def.params, ...def.outputs].map(p => p.id).join(', ') || 'nothing yet'}.`,
      );
  }
  if (JSON.stringify(next) !== JSON.stringify(def))
    draft.apply({ op: 'setPart', id: def.id, from: def, to: next });
}

/** A parameter's own knob range, checked against the knob it turns: inside its limits, max above min, a log range above 0. */
export function checkParamRange(raw: unknown, port: PortDef, what: string): ParamRange {
  if (port.type === 'gate') fail('bad-value', `${what} is on/off: it has no range.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('bad-value', 'range is {min, max, scale?, unit?}.');
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, key: string): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : fail('bad-value', `range ${key} must be a number.`);
  const min = num(r.min, 'min'),
    max = num(r.max, 'max');
  if (!(max > min)) fail('bad-value', 'range max must be above its min.');
  if ((port.min !== undefined && min < port.min) || (port.max !== undefined && max > port.max))
    fail(
      'out-of-range',
      `${what} goes from ${port.min} to ${port.max}: keep the range inside that.`,
    );
  const out: ParamRange = { min, max };
  if (r.scale !== undefined) {
    if (r.scale !== 'linear' && r.scale !== 'log')
      fail('bad-value', 'range scale is "linear" or "log".');
    out.scale = r.scale as 'linear' | 'log';
  }
  if ((out.scale ?? port.scale) === 'log' && min <= 0)
    fail('bad-value', 'A log range must start above 0.');
  if (r.unit !== undefined) {
    if (typeof r.unit !== 'string' || !(RANGE_UNITS as readonly string[]).includes(r.unit))
      fail(
        'bad-value',
        `range unit is one of ${RANGE_UNITS.filter(Boolean).join(', ')} (or "" for none).`,
      );
    out.unit = r.unit as string;
  }
  return out;
}

/** Show a free knob of a module inside a part on the part itself: each use then has its own value for it. */
export function addParam(
  draft: PartDraft,
  intent: {
    part: string;
    node: NodeId;
    port: PortId;
    id?: PortId;
    label?: string;
    range?: unknown;
  },
) {
  const { catalog } = draft;
  const def = requirePart(draft.doc, intent.part);
  const n = draft.doc.nodes[intent.node];
  if (!n || n.inside !== def.id)
    fail(
      'unknown-node',
      `${def.name} has no module "${String(intent.node)}" inside.`,
      `Inside: ${
        membersOf(draft.doc, def.id)
          .filter(m => !isPartPort(m))
          .map(m => m.id)
          .join(', ') || 'nothing yet'
      }.`,
    );
  const port = catalog.input(n!, intent.port);
  if (!port)
    fail(
      'unknown-port',
      `${n!.id} has no input "${intent.port}".`,
      `Inputs: ${catalog
        .inputs(n!)
        .map(p => p.id)
        .join(', ')}`,
    );
  if (!isKnob(port))
    fail('not-knob', `${n!.id}.${port!.id} is not a knob, so it cannot be a parameter.`);
  if (Object.values(draft.doc.edges).some(e => e.to.node === n!.id && e.to.port === port!.id))
    fail('connected', `${n!.id}.${port!.id} has a cable; only a free knob can be a parameter.`);
  const existing = def.params.find(p => p.node === n!.id && p.port === port!.id);
  if (existing) {
    // Already a parameter: a label or a range given now is put on it.
    const next = clone(def),
      param = next.params.find(p => p.id === existing.id)!;
    if (typeof intent.label === 'string' && intent.label.trim())
      param.label = intent.label.trim().slice(0, 40);
    if (intent.range !== undefined && intent.range !== null)
      param.range = checkParamRange(intent.range, port!, `${n!.id}.${port!.id}`);
    if (JSON.stringify(next) !== JSON.stringify(def))
      draft.apply({ op: 'setPart', id: def.id, from: def, to: next });
    return;
  }
  const taken = new Set([...def.inputs, ...def.params].map(p => p.id));
  if (intent.id !== undefined && (!PORT_ID_PATTERN.test(intent.id) || taken.has(intent.id)))
    fail(
      'bad-id',
      `Parameter id "${intent.id}" must match ${PORT_ID_PATTERN} and be free (taken: ${[...taken].join(', ') || 'none'}).`,
    );
  const id = intent.id ?? freePortId(port!.id, taken, 'param');
  const label =
    typeof intent.label === 'string' && intent.label.trim()
      ? intent.label.trim().slice(0, 40)
      : undefined;
  const range =
    intent.range !== undefined && intent.range !== null
      ? checkParamRange(intent.range, port!, `${n!.id}.${port!.id}`)
      : undefined;
  if (def.params.length >= 32) fail('too-large', 'A part has at most 32 parameters.');
  draft.apply({
    op: 'setPart',
    id: def.id,
    from: def,
    to: {
      ...clone(def),
      params: [
        ...def.params,
        {
          id,
          node: n!.id,
          port: port!.id,
          ...(label ? { label } : {}),
          ...(range ? { range } : {}),
        },
      ],
    },
  });
}

export function removeParam(draft: PartDraft, intent: { part: string; id: PortId }) {
  const def = requirePart(draft.doc, intent.part);
  if (!def.params.some(p => p.id === intent.id))
    fail(
      'unknown-port',
      `${def.name} has no parameter "${String(intent.id)}".`,
      `Parameters: ${def.params.map(p => p.id).join(', ') || 'none'}.`,
    );
  draft.apply({
    op: 'setPart',
    id: def.id,
    from: def,
    to: { ...clone(def), params: def.params.filter(p => p.id !== intent.id) },
  });
}

/** Can a node of this type, or a use of `part`, go inside part `inside`? Throws why not. */
export function checkPlacement(
  doc: PatchDocument,
  catalog: Catalog,
  type: string,
  inside: unknown,
  part: unknown,
) {
  const def = catalog.find(type);
  if (inside !== undefined) {
    const host = requirePart(doc, inside);
    if (def?.singleton)
      fail(
        'not-in-part',
        `${def.title} stays in the main patch.`,
        'Inside a part, use a Part input or a Part output (kit.partIn, kit.partOut) instead.',
      );
    if (def?.kind === 'widget')
      fail(
        'not-in-part',
        'Controls live on the plugin: keep them in the main patch and connect them to a parameter or an input of the part.',
      );
    if (
      def?.kind === 'part' &&
      typeof part === 'string' &&
      doc.parts[part] &&
      (part === host.id || partUsesDeep(doc, part, host.id))
    )
      fail('part-recursion', `${doc.parts[part]!.name} cannot be used inside itself.`);
  } else if (def?.kind === 'partIn' || def?.kind === 'partOut')
    fail('not-in-part', `A ${def.title} goes inside a part (give inside: "<part id>").`);
  if (def?.kind === 'part') requirePart(doc, part);
}
function partUsesDeep(doc: PatchDocument, outer: string, inner: string): boolean {
  const seen = new Set<string>(),
    stack = [outer];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === inner) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of membersOf(doc, id)) if (n.type === 'kit.part' && n.part) stack.push(n.part);
  }
  return false;
}

// ---- keeping uses in step ----------------------------------------------------------

/** The nodes of each part and the uses of each part, in one pass. */
function index(doc: PatchDocument) {
  const members = new Map<string, PatchNode[]>(),
    uses = new Map<string, PatchNode[]>();
  for (const n of Object.values(doc.nodes).sort(byId)) {
    if (n.inside !== undefined)
      (members.get(n.inside) ?? members.set(n.inside, []).get(n.inside)!).push(n);
    if (n.type === 'kit.part' && n.part)
      (uses.get(n.part) ?? uses.set(n.part, []).get(n.part)!).push(n);
  }
  return {
    members: (id: string) => members.get(id) ?? [],
    uses: (id: string) => uses.get(id) ?? [],
  };
}

/** Parts used inside other parts come first. */
function nestingOrder(doc: PatchDocument, members = index(doc).members): string[] {
  const order: string[] = [],
    state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    if (state.get(id)) return;
    state.set(id, 1);
    for (const n of members(id))
      if (n.type === 'kit.part' && n.part && doc.parts[n.part] && !state.get(n.part)) visit(n.part);
    state.set(id, 2);
    order.push(id);
  };
  for (const id of Object.keys(doc.parts).sort()) visit(id);
  return order;
}

/** At the end of a transaction: drop parts nothing uses (with what is inside them), then bring the ports up to date. */
export function syncParts(draft: PartDraft) {
  const doc = () => draft.doc;
  if (!hasParts(doc())) return;
  const used = usedParts(doc());
  for (const def of Object.values(doc().parts).sort(byId)) {
    if (used.has(def.id)) continue;
    const members = new Set(membersOf(doc(), def.id).map(n => n.id));
    for (const e of Object.values(doc().edges)
      .filter(e => members.has(e.from.node) || members.has(e.to.node))
      .sort(byId))
      draft.apply({ op: 'removeEdge', edge: e });
    for (const id of [...members].sort()) draft.apply({ op: 'removeNode', node: doc().nodes[id]! });
    draft.apply({ op: 'removePart', part: doc().parts[def.id]! });
  }
  syncPorts(draft);
}

/**
 * After every edit (so the next edit in the same transaction can use them):
 * inputs and outputs follow the Part input/output nodes inside, only free knobs
 * stay parameters, and every use shows its part's current ports.
 */
export function syncPorts(draft: PartDraft) {
  const { catalog } = draft;
  const doc = () => draft.doc;
  if (!Object.keys(doc().parts).length) return;
  // Which part holds which nodes does not change below (only ports, values and cables to vanished ports do).
  const { members: membersIn, uses } = index(doc());
  const fed = new Set(Object.values(doc().edges).map(e => portKey(e.to)));
  for (const partId of nestingOrder(doc(), membersIn)) {
    const def = doc().parts[partId]!;
    const members = membersIn(partId);
    const next = clone(def);
    next.inputs = next.inputs.filter(
      p => doc().nodes[p.node]?.type === 'kit.partIn' && doc().nodes[p.node]!.inside === partId,
    );
    next.outputs = next.outputs.filter(
      p => doc().nodes[p.node]?.type === 'kit.partOut' && doc().nodes[p.node]!.inside === partId,
    );
    next.params = next.params.filter(p => {
      const n = doc().nodes[p.node];
      return (
        !!n &&
        n.inside === partId &&
        isKnob(catalog.input(n, p.port)) &&
        !fed.has(`${p.node}.${p.port}`)
      );
    });
    for (const n of members) {
      const takenIn = new Set([...next.inputs, ...next.params].map(p => p.id));
      if (n.type === 'kit.partIn' && !next.inputs.some(p => p.node === n.id))
        next.inputs.push({ id: freePortId(n.label ?? 'in', takenIn, 'in'), node: n.id });
      if (n.type === 'kit.partOut' && !next.outputs.some(p => p.node === n.id))
        next.outputs.push({
          id: freePortId(n.label ?? 'out', new Set(next.outputs.map(p => p.id)), 'out'),
          node: n.id,
        });
    }
    if (JSON.stringify(next) !== JSON.stringify(def))
      draft.apply({ op: 'setPart', id: partId, from: def, to: next });
    const iface = partInterface(doc(), catalog, doc().parts[partId]!);
    const shape = JSON.stringify(iface);
    for (const { id } of uses(partId)) {
      const use = doc().nodes[id]!;
      if (JSON.stringify(use.iface) === shape) continue;
      draft.apply({ op: 'setField', node: id, field: 'iface', from: use.iface, to: iface });
      followPorts(draft, id);
    }
  }
}

/** A use's ports changed: drop cables to ports that are gone, give new parameters a value, forget values of removed ones. */
function followPorts(draft: PartDraft, id: NodeId) {
  const node = draft.doc.nodes[id]!;
  const inputs = draft.catalog.inputs(node),
    outputs = draft.catalog.outputs(node);
  for (const e of Object.values(draft.doc.edges).sort(byId)) {
    if (
      (e.to.node === id && !inputs.some(p => p.id === e.to.port)) ||
      (e.from.node === id && !outputs.some(p => p.id === e.from.port))
    )
      draft.apply({ op: 'removeEdge', edge: e });
  }
  const params = new Map(inputs.filter(p => p.role === 'control').map(p => [p.id, p]));
  for (const [port, value] of Object.entries(node.values))
    if (!params.has(port))
      draft.apply({ op: 'setValue', node: id, port, from: value, to: undefined });
  for (const [port, def] of params)
    if (!Object.hasOwn(node.values, port))
      draft.apply({
        op: 'setValue',
        node: id,
        port,
        from: undefined,
        to: def.default ?? (def.type === 'gate' ? false : 0),
      });
  // Spreads of parameters that are gone (or no longer knobs) go too.
  const spread = draft.doc.nodes[id]!.spread;
  if (spread) {
    const keep = Object.fromEntries(
      Object.entries(spread).filter(([port]) => spreadable(params.get(port))),
    );
    if (Object.keys(keep).length !== Object.keys(spread).length)
      draft.apply({
        op: 'setField',
        node: id,
        field: 'spread',
        from: spread,
        to: Object.keys(keep).length ? keep : undefined,
      });
  }
}

/** Work out every use's ports from its part (a document read from a file; edits keep them in step by themselves). */
export function refreshInterfaces(doc: PatchDocument, catalog: Catalog) {
  for (const partId of nestingOrder(doc)) {
    const iface = partInterface(doc, catalog, doc.parts[partId]!);
    for (const use of usesOf(doc, partId)) use.iface = clone(iface);
  }
}

// ---- My parts: placing a saved part, and updating one to a newer version -------------------------

/** Ids for a bundle's parts and nodes in `doc`: their own where free, fresh ones otherwise (`given` wins; `root` keeps the root definition's id). */
export function bundleIds(
  doc: PatchDocument,
  bundle: PartBundle,
  given: { parts?: Record<string, string>; nodes?: Record<string, string> } = {},
  root?: string,
  alsoTaken: ReadonlySet<string> = new Set(),
) {
  const parts = new Map<string, string>(),
    nodes = new Map<string, string>();
  const takenParts = new Set<string>(alsoTaken),
    takenNodes = new Set<string>(alsoTaken);
  const defs = [bundle.part, ...Object.values(bundle.parts).sort(byId)];
  for (const def of defs) {
    const wish = def.id === bundle.part.id && root ? root : given.parts?.[def.id];
    const id =
      wish ??
      (!doc.parts[def.id] && !takenParts.has(def.id)
        ? def.id
        : partIdFor(doc, def.name, takenParts));
    takenParts.add(id);
    parts.set(def.id, id);
  }
  for (const n of Object.values(bundle.nodes).sort(byId)) {
    const free = (id: string) =>
      !doc.nodes[id] && !doc.ui.elements[id] && !doc.ui.groups[id] && !takenNodes.has(id);
    const id =
      given.nodes?.[n.id] ??
      (free(n.id) ? n.id : nextNodeId(doc, n.id.replace(/\d+$/, '') || 'node', takenNodes));
    takenNodes.add(id);
    nodes.set(n.id, id);
  }
  return { parts: Object.fromEntries(parts), nodes: Object.fromEntries(nodes) };
}

/** Put a bundle's parts, nodes and cables into the draft under the given ids. The root definition is returned, not added. */
function addBundle(
  draft: PartDraft,
  bundle: PartBundle,
  ids: { parts: Record<string, string>; nodes: Record<string, string> },
): PartDef {
  const doc = () => draft.doc;
  const node = (id: NodeId) => ids.nodes[id]!;
  const def = (d: PartDef, id: string): PartDef => ({
    ...clone(d),
    id,
    inputs: d.inputs.map(p => ({ ...p, node: node(p.node) })),
    outputs: d.outputs.map(p => ({ ...p, node: node(p.node) })),
    params: d.params.map(p => ({ ...p, node: node(p.node) })),
  });
  for (const [old, part] of Object.entries(bundle.parts).sort(([a], [b]) => a.localeCompare(b))) {
    const id = ids.parts[old]!;
    if (doc().parts[id]) fail('duplicate-id', `A part "${id}" already exists.`);
    draft.apply({ op: 'addPart', part: def(part, id) });
  }
  for (const n of Object.values(bundle.nodes).sort(byId)) {
    const id = node(n.id);
    if (doc().nodes[id] || doc().ui.elements[id] || doc().ui.groups[id])
      fail('duplicate-id', `Id "${id}" is already taken.`);
    const copy: PatchNode = { ...clone(n), id, inside: ids.parts[n.inside!]! };
    if (n.part) copy.part = ids.parts[n.part]!;
    delete copy.iface;
    draft.apply({ op: 'addNode', node: copy });
  }
  for (const e of Object.values(bundle.edges).sort(byId))
    draft.apply({
      op: 'addEdge',
      edge: {
        id: nextEdgeId(doc()),
        from: { node: node(e.from.node), port: e.from.port },
        to: { node: node(e.to.node), port: e.to.port },
      },
    });
  return def(bundle.part, ids.parts[bundle.part.id]!);
}

/** The pictures and fonts a bundle's faces use come into the patch (one already here is the same file: asset ids follow the bytes). */
function addAssets(draft: PartDraft, bundle: PartBundle) {
  for (const asset of Object.values(bundle.assets ?? {}).sort(byId))
    if (!draft.doc.assets[asset.id]) draft.apply({ op: 'addAsset', asset: clone(asset) });
}

/** Place a part from My parts: its definition (and the parts inside it) come into the patch, with one use of it. */
export function importPart(
  draft: PartDraft,
  intent: {
    bundle: unknown;
    from?: PartDef['from'];
    node?: NodeId;
    pos?: XY;
    inside?: string;
    ids?: { parts?: Record<string, string>; nodes?: Record<string, string> };
  },
  created: string[],
) {
  const { catalog } = draft;
  const doc = () => draft.doc;
  const bundle = checkBundle(intent.bundle, catalog);
  if (typeof bundle === 'string') fail('bad-bundle', `This part cannot be placed: ${bundle}.`);
  if (intent.inside !== undefined) requirePart(doc(), intent.inside);
  const ids = bundleIds(doc(), bundle as PartBundle, intent.ids);
  addAssets(draft, bundle as PartBundle);
  const root = addBundle(draft, bundle as PartBundle, ids);
  if (intent.from) root.from = { ...intent.from };
  draft.apply({ op: 'addPart', part: root });
  const useId = intent.node ?? nextNodeId(doc(), root.id);
  if (!NODE_ID_PATTERN.test(useId))
    fail('bad-id', `Node id "${useId}" must match ${NODE_ID_PATTERN}.`);
  if (doc().nodes[useId] || doc().ui.elements[useId] || doc().ui.groups[useId])
    fail('duplicate-id', `Id "${useId}" is already taken.`);
  const iface = partInterface(doc(), catalog, root);
  const values = Object.fromEntries(
    iface.inputs
      .filter(p => p.role === 'control')
      .map(p => [p.id, p.default ?? (p.type === 'gate' ? false : 0)]),
  );
  const use: PatchNode = {
    id: useId,
    type: 'kit.part',
    part: root.id,
    pos:
      intent.pos && Number.isFinite(intent.pos.x) && Number.isFinite(intent.pos.y)
        ? { x: intent.pos.x, y: intent.pos.y }
        : { x: 0, y: 0 },
    config: {},
    values,
    iface,
    ...(intent.inside !== undefined ? { inside: intent.inside } : {}),
  };
  draft.apply({ op: 'addNode', node: use });
  created.push(useId);
}

/** Put a newer version of a part in place of what it is now: its uses stay (their values too, where the knob is still there). */
export function replacePart(
  draft: PartDraft,
  intent: { part: string; bundle: unknown; from?: PartDef['from'] },
) {
  const { catalog } = draft;
  const doc = () => draft.doc;
  const def = requirePart(doc(), intent.part);
  const bundle = checkBundle(intent.bundle, catalog);
  if (typeof bundle === 'string') fail('bad-bundle', `This version cannot be used: ${bundle}.`);
  // Out with what is inside now (parts used only in there go when nothing uses them).
  const members = new Set(membersOf(doc(), def.id).map(n => n.id));
  for (const e of Object.values(doc().edges)
    .filter(e => members.has(e.from.node) || members.has(e.to.node))
    .sort(byId))
    draft.apply({ op: 'removeEdge', edge: e });
  for (const id of [...members].sort()) draft.apply({ op: 'removeNode', node: doc().nodes[id]! });
  const ids = bundleIds(doc(), bundle as PartBundle, {}, def.id);
  addAssets(draft, bundle as PartBundle);
  const root = addBundle(draft, bundle as PartBundle, ids);
  root.id = def.id;
  if (intent.from) root.from = { ...intent.from };
  else delete root.from;
  draft.apply({ op: 'setPart', id: def.id, from: def, to: root });
}

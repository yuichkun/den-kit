// Parts: a piece of patch defined once and used in several places (like a
// Figma component or a Houdini digital asset, without Max's split between
// subpatchers and abstraction files). The nodes inside a part live in the
// document's node list with `inside` set to the part's id, so every edit (by
// hand or by the AI) is an ordinary op and undoes like one.
//
// Before checking and code generation the document is flattened: every use of
// a part becomes ordinary nodes (ids `use_node`, nested uses `outer_inner_node`),
// its parameter values land on the knobs they stand for, and cables through
// the part's inputs and outputs are joined up. What the checks and the compiler
// say about the flat patch is mapped back to the patch as it is drawn.
import type { Catalog, PortDef, Unit } from './catalog.ts';
import type { Issue } from './issues.ts';
import { analyze, type Analysis, type Scope } from './scope.ts';
import { clone, type EdgeId, type NodeId, type ParamRange, type PartDef, type PatchDocument, type PatchEdge, type PatchNode, type PortId, type PortRef, type Value } from './schema.ts';
import { copiesOf, hasStacks, position, random01, spreadable, spreadShape, spreadValue } from './stacks.ts';

/** How deep parts may sit inside parts. */
export const PART_DEPTH = 8;
/** Expansion stops here (well past what compiles), so a part used many times inside parts used many times cannot hang the page. */
export const MAX_EXPANDED = 2000;

export const isPartPort = (n: PatchNode | undefined) => n?.type === 'kit.partIn' || n?.type === 'kit.partOut';
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** The nodes inside a part, by id. */
export function membersOf(doc: PatchDocument, part: string): PatchNode[] {
  return Object.values(doc.nodes).filter(n => n.inside === part).sort(byId);
}

/** Every place a part is used (in the main patch or inside other parts). */
export function usesOf(doc: PatchDocument, part: string): PatchNode[] {
  return Object.values(doc.nodes).filter(n => n.type === 'kit.part' && n.part === part).sort(byId);
}

/** Parts the main patch uses, directly or through other parts. */
export function usedParts(doc: PatchDocument): Set<string> {
  const used = new Set<string>();
  const stack = Object.values(doc.nodes).filter(n => n.inside === undefined && n.type === 'kit.part' && n.part).map(n => n.part!);
  while (stack.length) {
    const id = stack.pop()!;
    if (used.has(id) || !doc.parts[id]) continue;
    used.add(id);
    for (const n of membersOf(doc, id)) if (n.type === 'kit.part' && n.part) stack.push(n.part);
  }
  return used;
}

/** Does part `outer` use part `inner` (or is it the same part), at any depth? */
export function partUses(doc: PatchDocument, outer: string, inner: string): boolean {
  const seen = new Set<string>();
  const stack = [outer];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === inner) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of membersOf(doc, id)) if (n.type === 'kit.part' && n.part) stack.push(n.part);
  }
  return false;
}

/** A fresh part id from its name ("Rain drop" → rainDrop; other scripts → part). */
export function partIdFor(doc: Pick<PatchDocument, 'parts'>, name: string, taken: ReadonlySet<string> = new Set()): string {
  // Ids start with a letter: leading numbers go ("808 kick" → kick).
  const words = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && !/^[A-Za-z]/.test(words[0]!)) words.shift();
  const camel = words.map((w, i) => i ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join('');
  const base = camel.replace(/^[^a-z]+/, '').slice(0, 24) || 'part';
  if (!Object.hasOwn(doc.parts, base) && !taken.has(base)) return base;
  for (let n = 2; ; n++) { const id = `${base}${n}`; if (!Object.hasOwn(doc.parts, id) && !taken.has(id)) return id; }
}

export const RANGE_UNITS = ['', 'Hz', 's', 'dB', 'oct', 'st', 'mix', 'gain', 'ratio', 'note', 'level', 'q', 'cycles', 'bpm', 'beats'] as const;
/** A parameter's range as stored (a file, My parts): its shape only (partInterface keeps it inside the knob it turns); undefined when it cannot be read. */
export function readParamRange(raw: unknown): ParamRange | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.min !== 'number' || typeof r.max !== 'number' || !Number.isFinite(r.min) || !Number.isFinite(r.max) || !(r.max > r.min)) return undefined;
  const out: ParamRange = { min: r.min, max: r.max };
  if (r.scale === 'linear' || (r.scale === 'log' && r.min > 0)) out.scale = r.scale;
  if (typeof r.unit === 'string' && (RANGE_UNITS as readonly string[]).includes(r.unit)) out.unit = r.unit;
  return out;
}

/** What a part shows outside: its inputs (cables), then its parameters (knobs that also take cables), and its outputs. */
export function partInterface(doc: PatchDocument, catalog: Catalog, def: PartDef): { inputs: PortDef[]; outputs: PortDef[] } {
  const inputs: PortDef[] = [], outputs: PortDef[] = [];
  const typeOf = (n: PatchNode | undefined) => n?.config.type === 'gate' ? 'gate' as const : 'signal' as const;
  for (const p of def.inputs) {
    const n = doc.nodes[p.node];
    inputs.push({ id: p.id, type: typeOf(n), role: 'audio', ...(n?.label ? { label: n.label } : {}) });
  }
  for (const p of def.params) {
    const n = doc.nodes[p.node];
    const port = n ? catalog.input(n, p.port) : undefined;
    if (!n || !port) continue;
    const value = n.values[p.port];
    const d: PortDef = { id: p.id, type: port.type, role: 'control', default: typeof value === 'number' || typeof value === 'boolean' ? value : port.default ?? (port.type === 'gate' ? false : 0) };
    const label = p.label ?? port.label;
    if (label) d.label = label;
    for (const key of ['min', 'max', 'uiMin', 'uiMax', 'scale', 'unit', 'roles', 'doc'] as const) if (port[key] !== undefined) (d as unknown as Record<string, unknown>)[key] = clone(port[key]);
    if (p.range && port.type !== 'gate') {
      // Its own range, kept inside what the knob inside can take.
      const lo = Math.max(p.range.min, port.min ?? -Infinity), hi = Math.min(p.range.max, port.max ?? Infinity);
      if (hi > lo) {
        d.uiMin = lo; d.uiMax = hi;
        if (p.range.scale && (p.range.scale === 'linear' || lo > 0)) d.scale = p.range.scale;
        if (p.range.unit !== undefined) { if (p.range.unit) d.unit = p.range.unit as Unit; else delete d.unit; }
      }
    }
    inputs.push(d);
  }
  for (const p of def.outputs) {
    const n = doc.nodes[p.node];
    outputs.push({ id: p.id, type: typeOf(n), ...(n?.label ? { label: n.label } : {}) });
  }
  return { inputs, outputs };
}

// ---- flattening ------------------------------------------------------------------------

export interface Flattened {
  /** The main patch with every part and every stack expanded into ordinary nodes (the document itself when there is nothing to expand). */
  doc: PatchDocument;
  /** Expanded node id → original ids from the main patch down (the part's uses, then the node inside). Copies of a node share its path. */
  origin: Record<NodeId, NodeId[]>;
  /** Expanded cable id → the cable it came from. */
  edges: Record<EdgeId, EdgeId>;
  /** Knobs that are the same in every copy stay one AudioParam: expanded node → its input → the AudioParam's name. */
  shared: Record<NodeId, Record<PortId, string>>;
  /** Problems with the parts and stacks themselves (a missing definition, a part inside itself…), on original ids. */
  issues: Issue[];
  /** False when there was nothing to expand. */
  expanded: boolean;
}

export interface FlattenOptions {
  /** Hear only this part: the chain of uses from the main patch down; its first outputs go to Out instead of what normally does. */
  solo?: readonly NodeId[];
}

interface Ctx {
  /** Expanded ids here start with this: '' in the main patch, 'rain1_' inside a use, 'rain1_3_' inside its fourth copy. */
  prefix: string;
  /** The same without copy numbers ('rain1_'): the names of AudioParams every copy shares. */
  plain: string;
  path: NodeId[];
  part: PartDef | null;
  instance: PatchNode | null;
  parent: Ctx | null;
  /** Which copy of its use this is (0 of 1 for a single use). */
  k: number;
  n: number;
  /** Copy numbers from the main patch in, one per stacked use around (seeds and Copy number's random). */
  copies: number[];
  /** The innermost stack around: what Copy number reads. */
  copy: { k: number; n: number };
  /** The use's parameter values as they reach the inside (its own, or what an outer part's parameters set), for this copy. */
  values: Record<PortId, Value>;
  members: PatchNode[];
  edges: PatchEdge[];
  /** `node.port` → the cable into that input, in this scope. */
  into: Map<string, PatchEdge>;
}

/** Copies of uses (each one a scope of its own) stop here, well past what the node cap allows. */
const MAX_CONTEXTS = 2 * MAX_EXPANDED;

export function hasParts(doc: PatchDocument): boolean {
  return Object.keys(doc.parts ?? {}).length > 0 || Object.values(doc.nodes).some(n => n.inside !== undefined || n.type === 'kit.part' || isPartPort(n));
}

export function flatten(doc: PatchDocument, catalog: Catalog, options: FlattenOptions = {}): Flattened {
  if (!hasParts(doc) && !hasStacks(Object.values(doc.nodes), catalog)) return { doc, origin: {}, edges: {}, shared: {}, issues: [], expanded: false };
  const issues: Issue[] = [];
  const scopes = new Map<string, PatchNode[]>();
  for (const n of Object.values(doc.nodes).sort(byId)) {
    const key = n.inside ?? '';
    (scopes.get(key) ?? scopes.set(key, []).get(key)!).push(n);
  }
  for (const [key, members] of scopes) {
    if (key && !doc.parts?.[key]) issues.push({ severity: 'warning', code: 'orphan-nodes', message: `${members.length} node(s) belong to a part "${key}" that does not exist (${members.slice(0, 4).map(n => n.id).join(', ')}); they are ignored.` });
  }
  const scopeEdges = new Map<string, PatchEdge[]>();
  for (const e of Object.values(doc.edges).sort(byId)) {
    const a = doc.nodes[e.from.node], b = doc.nodes[e.to.node];
    if (!a || !b) { issues.push({ severity: 'error', code: 'dangling-edge', edge: e.id, message: `Cable ${e.id} refers to a missing node.` }); continue; }
    if ((a.inside ?? '') !== (b.inside ?? '')) { issues.push({ severity: 'error', code: 'cross-part', edge: e.id, node: a.inside ? b.id : a.id, message: `Cable ${e.id} joins ${a.id} and ${b.id}, which are not in the same part; it is ignored.` }); continue; }
    const key = a.inside ?? '';
    (scopeEdges.get(key) ?? scopeEdges.set(key, []).get(key)!).push(e);
  }

  const out: Record<NodeId, PatchNode> = {};
  const flatEdges: Record<EdgeId, PatchEdge> = {};
  const origin: Record<NodeId, NodeId[]> = {};
  const edgeOrigin: Record<EdgeId, EdgeId> = {};
  const shared: Record<NodeId, Record<PortId, string>> = {};
  const ctxs = new Map<string, Ctx | null>();
  const reported = new Set<string>();
  const report = (issue: Issue) => { const key = `${issue.code}|${issue.path?.join('/') ?? issue.node}|${issue.port ?? ''}`; if (!reported.has(key)) { reported.add(key); issues.push(issue); } };
  const copies = (n: PatchNode | undefined) => copiesOf(catalog, n);
  /** The expanded id of copy k of `n` here. */
  const flatId = (ctx: Ctx, n: PatchNode, k: number) => copies(n) > 1 ? `${ctx.prefix}${n.id}_${k}` : `${ctx.prefix}${n.id}`;
  /** Where a problem is, as drawn: the node in the main patch, and the path inside parts. */
  const where = (ctx: Ctx, node: NodeId) => ctx.path.length ? { node: ctx.path[0], path: [...ctx.path, node] } : { node };

  const intoMap = (edges: PatchEdge[], path: NodeId[]) => {
    const into = new Map<string, PatchEdge>();
    for (const e of edges) {
      const key = `${e.to.node}.${e.to.port}`;
      if (into.has(key)) { if (path.length) report({ severity: 'error', code: 'multiple-drivers', node: path[0], path: [...path, e.to.node], port: e.to.port, edge: e.id, message: `${e.to.node}.${e.to.port} has more than one cable; use a Mix or Add node.` }); continue; }
      into.set(key, e);
    }
    return into;
  };
  /** A node's own knob values here (the use's parameters landed on the knobs they stand for), before any spread. */
  const ownValues = (ctx: Ctx, n: PatchNode): Record<PortId, Value> => {
    const v = { ...n.values };
    if (ctx.part) for (const p of ctx.part.params) if (p.node === n.id && Object.hasOwn(ctx.values, p.id)) v[p.port] = ctx.values[p.id]!;
    return v;
  };
  /** A node's knob values in copy k: the use's parameters land on the knobs they stand for, then the node's own spread. */
  const valuesOf = (ctx: Ctx, n: PatchNode, k: number): Record<PortId, Value> => {
    const v = ownValues(ctx, n);
    const count = copies(n);
    if (count > 1 && n.spread) for (const [port, s] of Object.entries(n.spread)) {
      const def = catalog.input(n, port), base = v[port] ?? def?.default;
      if (def && spreadable(def) && typeof base === 'number') v[port] = spreadValue(base, s, k, count, def);
    }
    return v;
  };
  /** Does a knob differ between copies (its own spread, or a spread parameter of a use around it)? */
  const varies = (ctx: Ctx, n: PatchNode, port: PortId): boolean => {
    if (copies(n) > 1 && n.spread?.[port] && spreadable(catalog.input(n, port))) return true;
    const p = ctx.part?.params.find(q => q.node === n.id && q.port === port);
    return !!(p && ctx.parent && ctx.instance && varies(ctx.parent, ctx.instance, p.id));
  };
  const root: Ctx = { prefix: '', plain: '', path: [], part: null, instance: null, parent: null, k: 0, n: 1, copies: [], copy: { k: 0, n: 1 }, values: {}, members: scopes.get('') ?? [], edges: scopeEdges.get('') ?? [], into: new Map() };
  root.into = intoMap(root.edges, []);
  ctxs.set('', root);
  /** The inside of copy k of a use. */
  const childOf = (ctx: Ctx, instance: PatchNode, k: number): Ctx | null => {
    const n = copies(instance);
    const key = n > 1 ? `${ctx.prefix}${instance.id}_${k}_` : `${ctx.prefix}${instance.id}_`;
    if (ctxs.has(key)) return ctxs.get(key)!;
    const path = [...ctx.path, instance.id];
    const def = instance.part ? doc.parts[instance.part] : undefined;
    let child: Ctx | null = null;
    if (!def) report({ severity: 'error', code: 'unknown-part', node: path[0], path, message: `${instance.id} uses a part "${instance.part ?? '?'}" that does not exist.` });
    else {
      let recursive = false;
      for (let c: Ctx | null = ctx; c; c = c.parent) if (c.part?.id === def.id) recursive = true;
      if (recursive || path.length > PART_DEPTH) report({ severity: 'error', code: 'part-recursion', node: path[0], path, message: recursive ? `Part ${def.name} is used inside itself.` : `Parts sit more than ${PART_DEPTH} deep.` });
      else if (ctxs.size >= MAX_CONTEXTS) { capped = true; report({ severity: 'error', code: 'too-many-nodes', message: `With its parts and copies expanded the patch is far too big (more than ${MAX_CONTEXTS} uses); use fewer copies.` }); }
      else {
        const edges = scopeEdges.get(def.id) ?? [];
        child = { prefix: key, plain: `${ctx.plain}${instance.id}_`, path, part: def, instance, parent: ctx, k, n, copies: n > 1 ? [...ctx.copies, k] : ctx.copies, copy: n > 1 ? { k, n } : ctx.copy, values: valuesOf(ctx, instance, k), members: scopes.get(def.id) ?? [], edges, into: intoMap(edges, path) };
      }
    }
    ctxs.set(key, child);
    return child;
  };
  const addEdge = (id: EdgeId, from: PortRef, to: PortRef, original: EdgeId) => {
    let key = id;
    for (let n = 2; flatEdges[key]; n++) key = `${id}$${n}`;
    flatEdges[key] = { id: key, from: { ...from }, to: { ...to } }; edgeOrigin[key] = original;
  };
  /** A thick cable meeting a thin input: the copies summed (×1/√N), or for gates combined. Made once per source. */
  const mixdown = (ctx: Ctx, ref: PortRef, refs: PortRef[], edge: EdgeId, all = false): PortRef => {
    const gate = catalog.output(doc.nodes[ref.node]!, ref.port)?.type === 'gate';
    const mode = gate ? (all ? 'all' : 'any') : 'sum';
    const id = `${ctx.prefix}${ref.node}_${ref.port}$${mode}`;
    if (!out[id]) {
      out[id] = gate ? { id, type: 'kit.stackGate', pos: { x: 0, y: 0 }, config: { n: refs.length, mode }, values: {} } : { id, type: 'kit.stackSum', pos: { x: 0, y: 0 }, config: { n: refs.length }, values: {} };
      origin[id] = [...ctx.path, ref.node];
      count++;
      refs.forEach((r, k) => addEdge(`${id}$${k}`, r, { node: id, port: `in${k}` }, edge));
    }
    return { node: id, port: 'out' };
  };
  /** What copy k of m reads from a cable carrying `refs` (one per copy of its source). */
  const pick = (refs: PortRef[], k: number, m: number, mix: () => PortRef, at: { ctx: Ctx; node: NodeId; port: PortId; edge: EdgeId }): PortRef => {
    const w = refs.length;
    if (w === 1) return refs[0]!;
    if (m === 1) return mix();
    if (w !== m) report({ severity: 'warning', code: 'stack-mismatch', ...where(at.ctx, at.node), port: at.port, edge: at.edge, message: `A ×${w} cable goes into ×${m} copies (${at.node}.${at.port}): copy k takes copy k mod ${w}. Give both sides the same count, or make one side ×1.` });
    return refs[k % w]!;
  };
  /** The expanded outputs that carry what (ctx, ref) puts out: one per copy of its source (a thick cable has several), none when nothing does. */
  const sourceOf = (ctx: Ctx, ref: PortRef, seen: ReadonlySet<string> = new Set()): PortRef[] => {
    const key = `${ctx.prefix}${ref.node}.${ref.port}`;
    if (seen.has(key)) { report({ severity: 'error', code: 'cycle', node: ctx.path[0] ?? ref.node, path: ctx.path.length ? [...ctx.path, ref.node] : undefined, message: 'A part feeds its own input without a History node in between. Insert a History node to delay one sample.' }); return []; }
    const next = new Set(seen).add(key);
    const n = doc.nodes[ref.node];
    if (!n) return [];
    if (n.type === 'kit.partIn') {
      if (!ctx.part || !ctx.parent || !ctx.instance) return [];
      const p = ctx.part.inputs.find(q => q.node === n.id);
      const e = p && ctx.parent.into.get(`${ctx.instance.id}.${p.id}`);
      if (!e) return [];
      const parent = ctx.parent, refs = sourceOf(parent, e.from, next);
      return refs.length ? [pick(refs, ctx.k, ctx.n, () => mixdown(parent, e.from, refs, e.id), { ctx: parent, node: ctx.instance.id, port: p!.id, edge: e.id })] : [];
    }
    if (n.type === 'kit.part') {
      const refs: PortRef[] = [];
      for (let k = 0; k < copies(n); k++) {
        const child = childOf(ctx, n, k);
        const o = child?.part!.outputs.find(q => q.id === ref.port);
        const e = o && child!.into.get(`${o.node}.in`);
        const inner = e ? sourceOf(child!, e.from, next) : [];
        if (!inner.length) return [];
        // A thick cable into a part's output is summed there: a part's outputs are thin (the use's copies make them thick).
        refs.push(inner.length === 1 ? inner[0]! : mixdown(child!, e!.from, inner, e!.id));
      }
      return refs;
    }
    if (n.type === 'kit.partOut') return [];
    return Array.from({ length: copies(n) }, (_, k) => ({ node: flatId(ctx, n, k), port: ref.port }));
  };
  /** The expanded knobs a parameter of a use stands for (several when what it reaches runs as copies). */
  const paramTargets = (ctx: Ctx, paramId: PortId): PortRef[] => {
    const p = ctx.part?.params.find(q => q.id === paramId);
    const n = p ? doc.nodes[p.node] : undefined;
    if (!p || !n || n.inside !== ctx.part!.id || isPartPort(n)) return [];
    const refs: PortRef[] = [];
    for (let k = 0; k < copies(n); k++) {
      if (n.type === 'kit.part') { const child = childOf(ctx, n, k); if (child) refs.push(...paramTargets(child, p.port)); }
      else refs.push({ node: flatId(ctx, n, k), port: p.port });
    }
    return refs;
  };

  /**
   * A cable into a spread knob of copy k: what comes in, moved the way the
   * spread moves the knob in that copy (a Scale per copy, its amounts
   * AudioParams, so changing the spread plays at once).
   */
  const spreadCable = (ctx: Ctx, target: PatchNode, port: PortId, k: number, m: number, from: PortRef, id: string, edge: EdgeId): PortRef => {
    const s = m > 1 ? target.spread?.[port] : undefined;
    const def = s ? catalog.input(target, port) : undefined;
    if (!s || !def || !spreadable(def)) return from;
    const base = Number(ownValues(ctx, target)[port] ?? def.default ?? 0);
    const { scale, offset } = spreadShape(s, k, m, def, base);
    out[id] = { id, type: 'kit.scale', pos: { x: 0, y: 0 }, config: {}, values: { scale, offset } };
    origin[id] = [...ctx.path, target.id];
    count++;
    addEdge(`${id}$in`, from, { node: id, port: 'in' }, edge);
    return { node: id, port: 'out' };
  };

  let count = 0, capped = false;
  /** Copy k of a node: its values for this copy, its own seed in a stack, and the AudioParams it shares with the other copies. */
  const emit = (ctx: Ctx, n: PatchNode, k: number) => {
    const many = copies(n);
    const id = flatId(ctx, n, k);
    count++;
    // The expanded patch is never edited: only what differs per use and copy is copied.
    const copy: PatchNode = { ...n, id, values: valuesOf(ctx, n, k) };
    delete copy.inside; delete copy.part; delete copy.iface; delete copy.count; delete copy.spread;
    out[id] = copy;
    origin[id] = [...ctx.path, n.id];
    const place = many > 1 ? [...ctx.copies, k] : ctx.copies;
    if (!place.length) return;
    const seedKey = catalog.find(n.type)?.seed;
    if (seedKey) {
      // Copies of something random are different: each gets its own seed (the same every time).
      const seed = Number(catalog.config(n)[seedKey] ?? 1);
      copy.config = { ...copy.config, [seedKey]: 1 + ((seed - 1 + Math.floor(random01(seed, place) * 2147483645)) % 2147483646) };
    }
    if (n.type === 'kit.copy') {
      const c = many > 1 ? { k, n: many } : ctx.copy;
      copy.type = 'kit.copyConst';
      copy.config = { index: c.k, count: c.n, position: position(c.k, c.n), random: random01(Number(n.config.seed ?? 1), place) };
    }
    const shares: Record<PortId, string> = {};
    for (const port of catalog.inputs(n)) if (port.role !== 'audio' && !varies(ctx, n, port.id)) shares[port.id] = `${ctx.plain}${n.id}_${port.id}`;
    if (Object.keys(shares).length) shared[id] = shares;
  };
  const wire = (ctx: Ctx, e: PatchEdge) => {
    const target = doc.nodes[e.to.node]!, source = doc.nodes[e.from.node]!;
    if (source.type === 'kit.part' && source.part && doc.parts[source.part] && !doc.parts[source.part]!.outputs.some(o => o.id === e.from.port)) { report({ severity: 'error', code: 'unknown-port', edge: e.id, ...where(ctx, source.id), port: e.from.port, message: `${source.id} has no output "${e.from.port}".` }); return; }
    if (target.type === 'kit.part' && target.part && doc.parts[target.part] && ![...doc.parts[target.part]!.inputs, ...doc.parts[target.part]!.params].some(p => p.id === e.to.port)) { report({ severity: 'error', code: 'unknown-port', edge: e.id, ...where(ctx, target.id), port: e.to.port, message: `${target.id} has no input "${e.to.port}".` }); return; }
    if (isPartPort(target)) return; // a part's output: joined up from outside
    const m = copies(target), at = { ctx, node: target.id, port: e.to.port, edge: e.id };
    const tag = (k: number) => `${ctx.prefix}${e.id}${m > 1 ? `_${k}` : ''}`;
    if (target.type === 'kit.part') {
      // A cable into a parameter of a part goes to the knob inside it; a cable into an input is joined up from inside.
      if (!childOf(ctx, target, 0)?.part!.params.some(p => p.id === e.to.port)) return;
      const refs = sourceOf(ctx, e.from);
      if (!refs.length) return;
      for (let k = 0; k < m; k++) {
        const child = childOf(ctx, target, k);
        if (!child) continue;
        const from = spreadCable(ctx, target, e.to.port, k, m, pick(refs, k, m, () => mixdown(ctx, e.from, refs, e.id), at), `${tag(k)}$spread`, e.id);
        paramTargets(child, e.to.port).forEach((to, j) => addEdge(`${tag(k)}${j ? `$${j}` : ''}`, from, to, e.id));
      }
      return;
    }
    const refs = sourceOf(ctx, e.from);
    if (!refs.length) return;
    if (target.type === 'kit.splay' && e.to.port === 'in' && refs.length > 1) {
      // Splay takes every copy of a thick cable.
      const id = flatId(ctx, target, 0);
      if (out[id]) out[id] = { ...out[id]!, type: 'kit.splayN', config: { n: refs.length } };
      refs.forEach((from, k) => addEdge(`${ctx.prefix}${e.id}_${k}`, from, { node: id, port: `in${k}` }, e.id));
      return;
    }
    const all = catalog.input(target, e.to.port)?.merge === 'all';
    for (let k = 0; k < m; k++) addEdge(tag(k), spreadCable(ctx, target, e.to.port, k, m, pick(refs, k, m, () => mixdown(ctx, e.from, refs, e.id, all), at), `${tag(k)}$spread`, e.id), { node: flatId(ctx, target, k), port: e.to.port }, e.id);
  };
  const expand = (ctx: Ctx) => {
    for (const n of ctx.members) {
      if (capped) return;
      if (isPartPort(n)) { if (!ctx.part) report({ severity: 'warning', code: 'part-port-outside', node: n.id, message: `${n.id} is an input or output of a part, but it is in the main patch; it does nothing here.` }); continue; }
      if (n.type === 'kit.part') { for (let k = 0; k < copies(n); k++) { const child = childOf(ctx, n, k); if (child) expand(child); } continue; }
      for (let k = 0; k < copies(n); k++) {
        if (count >= MAX_EXPANDED) { capped = true; report({ severity: 'error', code: 'too-many-nodes', message: `With its parts and copies expanded the patch has more than ${MAX_EXPANDED} nodes; use fewer copies or smaller parts.` }); return; }
        emit(ctx, n, k);
      }
    }
    if (!capped) for (const e of ctx.edges) wire(ctx, e);
  };
  expand(root);

  // Past the cap the patch is not played: keep the nodes for the message, drop the cables.
  const flat: PatchDocument = { ...doc, nodes: out, edges: capped ? {} : flatEdges, parts: {} };
  if (options.solo?.length && !capped) solo(flat, catalog, options.solo, { doc, root, childOf, sourceOf, copies, issues });
  return { doc: flat, origin, edges: edgeOrigin, shared, issues, expanded: true };
}

/** Hear one part alone: its first output (and second, as the right channel) go to Out instead of what normally does; copies are summed. */
function solo(flat: PatchDocument, catalog: Catalog, path: readonly NodeId[], env: { doc: PatchDocument; root: Ctx; childOf: (ctx: Ctx, n: PatchNode, k: number) => Ctx | null; sourceOf: (ctx: Ctx, ref: PortRef) => PortRef[]; copies: (n: PatchNode) => number; issues: Issue[] }) {
  // Every copy along the chain: the part may sit in a stacked use, or be one itself.
  let level: Ctx[] = [env.root], parents: Ctx[] = [];
  for (const id of path) {
    const n = env.doc.nodes[id];
    const next: Ctx[] = [];
    for (const ctx of level) {
      if (!n || n.type !== 'kit.part' || (n.inside ?? null) !== (ctx.part?.id ?? null)) break;
      for (let k = 0; k < env.copies(n); k++) { const child = env.childOf(ctx, n, k); if (child) next.push(child); }
    }
    if (!next.length) { env.issues.push({ severity: 'warning', code: 'solo-missing', message: 'The part to hear alone is gone; playing everything.' }); return; }
    parents = level; level = next;
  }
  const part = level[0]!.part!, use = path.at(-1)!;
  const out = Object.values(flat.nodes).find(n => n.type === 'kit.out');
  const sources = part.outputs.slice(0, 2).map(o => parents.flatMap(p => env.sourceOf(p, { node: use, port: o.id })));
  if (!out || !sources[0]?.length) { env.issues.push({ severity: 'warning', code: 'solo-silent', node: path[0], message: out ? `${part.name} has no output connected inside, so there is nothing to hear alone.` : 'Hearing a part alone needs an Out node.' }); return; }
  for (const e of Object.values(flat.edges)) if (e.to.node === out.id) delete flat.edges[e.id];
  const sides = (['left', 'right'] as const).map((port, i) => {
    const refs = sources[i];
    if (!refs?.length) return null;
    if (refs.length === 1) return refs[0]!;
    const sum = `solo${port === 'left' ? 'L' : 'R'}Sum`;
    flat.nodes[sum] = { id: sum, type: 'kit.stackSum', pos: { x: 0, y: 0 }, config: { n: refs.length }, values: {} };
    refs.forEach((r, k) => { flat.edges[`${sum}$${k}`] = { id: `${sum}$${k}`, from: { ...r }, to: { node: sum, port: `in${k}` } }; });
    return { node: sum, port: 'out' };
  });
  const scope = analyze(flat, catalog).scope;
  sides.forEach((from, i) => {
    if (!from) return;
    const port = i ? 'right' : 'left';
    if (scope.get(from.node) === 'voice') {
      // A part that runs per voice is summed first (as Voice Mix would).
      const mix = `solo${i ? 'R' : 'L'}Mix`;
      flat.nodes[mix] = { id: mix, type: 'kit.voiceMix', pos: { x: 0, y: 0 }, config: {}, values: {} };
      flat.edges[`solo-${port}-mix`] = { id: `solo-${port}-mix`, from: { ...from }, to: { node: mix, port: 'in' } };
      from = { node: mix, port: 'out' };
    }
    flat.edges[`solo-${port}`] = { id: `solo-${port}`, from: { ...from }, to: { node: out.id, port } };
  });
}

// ---- mapping back ------------------------------------------------------------------------

/** "use_inner_node" → "node (in use › inner)"; a copy "osc1_3" → "osc1". */
export function readableIds(message: string, flat: Flattened): string {
  if (!flat.expanded) return message;
  const name = (path: NodeId[], port?: string) => `${path.at(-1)}${port ? `.${port}` : ''}${path.length > 1 ? ` (in ${path.slice(0, -1).join(' › ')})` : ''}`;
  return message.replace(/\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b/g, m => {
    const path = flat.origin[m];
    if (path) return name(path);
    const cut = m.lastIndexOf('_');
    const head = flat.origin[m.slice(0, cut)];
    return head ? name(head, m.slice(cut + 1)) : m;
  });
}

/** A problem found on the expanded patch, in terms of the patch as it is drawn (`node` is what the main patch shows; `path` goes inside). */
export function mapIssue(issue: Issue, flat: Flattened): Issue {
  if (!flat.expanded) return issue;
  const mapped: Issue = { ...issue, message: readableIds(issue.message, flat) };
  const path = issue.node ? flat.origin[issue.node] : undefined;
  if (path) { mapped.node = path[0]; if (path.length > 1) mapped.path = path; else delete mapped.path; }
  if (issue.edge) mapped.edge = flat.edges[issue.edge] ?? issue.edge;
  return mapped;
}

/** The analysis of the expanded patch, on the main patch's nodes (a part runs per voice when anything in it does). */
export function mapAnalysis(analysis: Analysis, flat: Flattened): Analysis {
  if (!flat.expanded) return analysis;
  const top = (id: NodeId) => flat.origin[id]?.[0] ?? id;
  const scope = new Map<NodeId, Scope>();
  for (const [id, s] of analysis.scope) { const r = top(id); if (s === 'voice' || !scope.has(r)) scope.set(r, s); }
  const unique = (ids: NodeId[]) => [...new Set(ids.map(top))];
  return { scope, live: new Set([...analysis.live].map(top)), order: { pre: unique(analysis.order.pre), voice: unique(analysis.order.voice), post: unique(analysis.order.post) }, issues: analysis.issues.map(i => mapIssue(i, flat)) };
}

/** The expanded id of `node` inside the part entered through `path` (the chain of uses from the main patch); the first copy where something runs as copies. */
export function expandedId(doc: PatchDocument, path: readonly NodeId[], node: NodeId, catalog?: Catalog): NodeId {
  const seg = (id: NodeId) => (catalog ? copiesOf(catalog, doc.nodes[id]) : doc.nodes[id]?.count ?? 1) > 1 ? `${id}_0` : id;
  return [...path.map(seg), seg(node)].join('_');
}

// ---- what one place in the patch looks like ------------------------------

/**
 * The patch as seen from one place: the main patch (its modules and the
 * parts' uses, not their insides) or the inside of the part entered through
 * `path`, where a knob that is a parameter shows the value of the use it was
 * entered through. Ids are the document's own.
 */
export function partView(doc: PatchDocument, path: readonly NodeId[] = []): PatchDocument {
  const use = path.length ? doc.nodes[path.at(-1)!] : undefined;
  const scope = use?.part;
  if (path.length && (!scope || !doc.parts[scope])) return partView(doc, []);
  const def = scope ? doc.parts[scope] : undefined;
  const nodes: Record<NodeId, PatchNode> = {};
  for (const n of Object.values(doc.nodes)) {
    if (n.inside !== scope) continue;
    const params = def && use ? def.params.filter(p => p.node === n.id && Object.hasOwn(use.values, p.id)) : [];
    nodes[n.id] = params.length ? { ...n, values: { ...n.values, ...Object.fromEntries(params.map(p => [p.port, use!.values[p.id]!])) } } : n;
  }
  const edges = Object.fromEntries(Object.entries(doc.edges).filter(([, e]) => nodes[e.from.node] && nodes[e.to.node]));
  return { ...doc, nodes, edges };
}

/** Edits planned on a part's view, as edits of the patch: a knob that is a parameter sets the value of the use it was entered through. */
export function fromPartView<T extends { op: string }>(doc: PatchDocument, path: readonly NodeId[], intents: readonly T[]): T[] {
  const use = path.length ? doc.nodes[path.at(-1)!] : undefined;
  const def = use?.part ? doc.parts[use.part] : undefined;
  if (!use || !def) return [...intents];
  return intents.map(i => {
    if (i.op !== 'setValue') return i;
    const v = i as unknown as { node: NodeId; port: PortId };
    const p = def.params.find(q => q.node === v.node && q.port === v.port);
    return p ? { ...i, node: use.id, port: p.id } : i;
  });
}

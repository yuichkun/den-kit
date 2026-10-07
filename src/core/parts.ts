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
import type { Catalog, PortDef } from './catalog.ts';
import type { Issue } from './issues.ts';
import { analyze, type Analysis, type Scope } from './scope.ts';
import { clone, type EdgeId, type NodeId, type PartDef, type PatchDocument, type PatchEdge, type PatchNode, type PortId, type PortRef, type Value } from './schema.ts';

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
  /** The main patch with every part expanded into ordinary nodes (the document itself when it has no parts). */
  doc: PatchDocument;
  /** Expanded node id → original ids from the main patch down (the part's uses, then the node inside). */
  origin: Record<NodeId, NodeId[]>;
  /** Expanded cable id → the cable it came from. */
  edges: Record<EdgeId, EdgeId>;
  /** A knob of the document (`node_port`) → the AudioParams it sets after expansion. */
  aliases: Record<string, string[]>;
  /** Problems with the parts themselves (a missing definition, a part inside itself…), on original ids. */
  issues: Issue[];
  /** False when there was nothing to expand. */
  expanded: boolean;
}

export interface FlattenOptions {
  /** Hear only this part: the chain of uses from the main patch down; its first outputs go to Out instead of what normally does. */
  solo?: readonly NodeId[];
}

interface Ctx {
  prefix: string;
  path: NodeId[];
  part: PartDef | null;
  instance: PatchNode | null;
  parent: Ctx | null;
  /** The use's parameter values as they reach the inside (its own, or what an outer part's parameters set). */
  values: Record<PortId, Value>;
  members: PatchNode[];
  edges: PatchEdge[];
  /** `node.port` → the cable into that input, in this scope. */
  into: Map<string, PatchEdge>;
}

export function hasParts(doc: PatchDocument): boolean {
  return Object.keys(doc.parts ?? {}).length > 0 || Object.values(doc.nodes).some(n => n.inside !== undefined || n.type === 'kit.part' || isPartPort(n));
}

export function flatten(doc: PatchDocument, catalog: Catalog, options: FlattenOptions = {}): Flattened {
  if (!hasParts(doc)) return { doc, origin: {}, edges: {}, aliases: {}, issues: [], expanded: false };
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
  const aliases: Record<string, string[]> = {};
  const ctxs = new Map<string, Ctx | null>();
  const reported = new Set<string>();
  const report = (issue: Issue) => { const key = `${issue.code}|${issue.path?.join('/') ?? issue.node}`; if (!reported.has(key)) { reported.add(key); issues.push(issue); } };

  const intoMap = (edges: PatchEdge[], path: NodeId[]) => {
    const into = new Map<string, PatchEdge>();
    for (const e of edges) {
      const key = `${e.to.node}.${e.to.port}`;
      if (into.has(key)) { if (path.length) report({ severity: 'error', code: 'multiple-drivers', node: path[0], path: [...path, e.to.node], port: e.to.port, edge: e.id, message: `${e.to.node}.${e.to.port} has more than one cable; use a Mix or Add node.` }); continue; }
      into.set(key, e);
    }
    return into;
  };
  const valuesOf = (ctx: Ctx, n: PatchNode): Record<PortId, Value> => {
    const v = { ...n.values };
    if (ctx.part) for (const p of ctx.part.params) if (p.node === n.id && Object.hasOwn(ctx.values, p.id)) v[p.port] = ctx.values[p.id]!;
    return v;
  };
  const root: Ctx = { prefix: '', path: [], part: null, instance: null, parent: null, values: {}, members: scopes.get('') ?? [], edges: scopeEdges.get('') ?? [], into: new Map() };
  root.into = intoMap(root.edges, []);
  ctxs.set('', root);
  const childOf = (ctx: Ctx, instance: PatchNode): Ctx | null => {
    const key = `${ctx.prefix}${instance.id}_`;
    if (ctxs.has(key)) return ctxs.get(key)!;
    const path = [...ctx.path, instance.id];
    const def = instance.part ? doc.parts[instance.part] : undefined;
    let child: Ctx | null = null;
    if (!def) report({ severity: 'error', code: 'unknown-part', node: path[0], path, message: `${instance.id} uses a part "${instance.part ?? '?'}" that does not exist.` });
    else {
      let recursive = false;
      for (let c: Ctx | null = ctx; c; c = c.parent) if (c.part?.id === def.id) recursive = true;
      if (recursive || path.length > PART_DEPTH) report({ severity: 'error', code: 'part-recursion', node: path[0], path, message: recursive ? `Part ${def.name} is used inside itself.` : `Parts sit more than ${PART_DEPTH} deep.` });
      else {
        const edges = scopeEdges.get(def.id) ?? [];
        child = { prefix: key, path, part: def, instance, parent: ctx, values: valuesOf(ctx, instance), members: scopes.get(def.id) ?? [], edges, into: intoMap(edges, path) };
      }
    }
    ctxs.set(key, child);
    return child;
  };
  /** Who controls a knob inside a part: a parameter of a use (outermost), or the knob itself (shared by every use). */
  const controller = (ctx: Ctx, node: NodeId, port: PortId): PortRef => {
    const p = ctx.part?.params.find(q => q.node === node && q.port === port);
    return p && ctx.parent && ctx.instance ? controller(ctx.parent, ctx.instance.id, p.id) : { node, port };
  };
  /** The expanded output that carries what (ctx, ref) puts out; null when nothing does (an unconnected input of a part). */
  const sourceOf = (ctx: Ctx, ref: PortRef, seen = new Set<string>()): PortRef | null => {
    const key = `${ctx.prefix}${ref.node}.${ref.port}`;
    if (seen.has(key)) { report({ severity: 'error', code: 'cycle', node: ctx.path[0] ?? ref.node, path: ctx.path.length ? [...ctx.path, ref.node] : undefined, message: 'A part feeds its own input without a History node in between. Insert a History node to delay one sample.' }); return null; }
    seen.add(key);
    const n = doc.nodes[ref.node];
    if (!n) return null;
    if (n.type === 'kit.partIn') {
      if (!ctx.part || !ctx.parent || !ctx.instance) return null;
      const p = ctx.part.inputs.find(q => q.node === n.id);
      const e = p && ctx.parent.into.get(`${ctx.instance.id}.${p.id}`);
      return e ? sourceOf(ctx.parent, e.from, seen) : null;
    }
    if (n.type === 'kit.part') {
      const child = childOf(ctx, n);
      const o = child?.part!.outputs.find(q => q.id === ref.port);
      const e = o && child!.into.get(`${o.node}.in`);
      return e ? sourceOf(child!, e.from, seen) : null;
    }
    if (n.type === 'kit.partOut') return null;
    return { node: `${ctx.prefix}${n.id}`, port: ref.port };
  };
  /** The expanded knob a parameter of a use stands for. */
  const paramTarget = (ctx: Ctx, paramId: PortId): PortRef | null => {
    const p = ctx.part?.params.find(q => q.id === paramId);
    const n = p ? doc.nodes[p.node] : undefined;
    if (!p || !n || n.inside !== ctx.part!.id || isPartPort(n)) return null;
    if (n.type === 'kit.part') { const child = childOf(ctx, n); return child ? paramTarget(child, p.port) : null; }
    return { node: `${ctx.prefix}${n.id}`, port: p.port };
  };
  const addEdge = (id: EdgeId, from: PortRef, to: PortRef, original: EdgeId) => { flatEdges[id] = { id, from: { ...from }, to: { ...to } }; edgeOrigin[id] = original; };

  let count = 0;
  const expand = (ctx: Ctx) => {
    for (const n of ctx.members) {
      if (count >= MAX_EXPANDED) { report({ severity: 'error', code: 'too-many-nodes', message: `With its parts expanded the patch has more than ${MAX_EXPANDED} nodes; use parts fewer times (or make them smaller).` }); return; }
      if (isPartPort(n)) { if (!ctx.part) report({ severity: 'warning', code: 'part-port-outside', node: n.id, message: `${n.id} is an input or output of a part, but it is in the main patch; it does nothing here.` }); continue; }
      if (n.type === 'kit.part') { const child = childOf(ctx, n); if (child) expand(child); continue; }
      const id = `${ctx.prefix}${n.id}`;
      count++;
      // The expanded patch is never edited: only what differs per use is copied.
      const copy: PatchNode = { ...n, id, values: valuesOf(ctx, n) };
      delete copy.inside; delete copy.part; delete copy.iface;
      out[id] = copy;
      origin[id] = [...ctx.path, n.id];
      if (ctx.part) for (const port of Object.keys(copy.values)) {
        const c = controller(ctx, n.id, port);
        (aliases[`${c.node}_${c.port}`] ??= []).push(`${id}_${port}`);
      }
    }
    for (const e of ctx.edges) {
      const target = doc.nodes[e.to.node]!, source = doc.nodes[e.from.node]!;
      const where = (n: PatchNode) => ctx.path.length ? { node: ctx.path[0], path: [...ctx.path, n.id] } : { node: n.id };
      if (source.type === 'kit.part' && source.part && doc.parts[source.part] && !doc.parts[source.part]!.outputs.some(o => o.id === e.from.port)) { report({ severity: 'error', code: 'unknown-port', edge: e.id, ...where(source), port: e.from.port, message: `${source.id} has no output "${e.from.port}".` }); continue; }
      if (target.type === 'kit.part' && target.part && doc.parts[target.part] && ![...doc.parts[target.part]!.inputs, ...doc.parts[target.part]!.params].some(p => p.id === e.to.port)) { report({ severity: 'error', code: 'unknown-port', edge: e.id, ...where(target), port: e.to.port, message: `${target.id} has no input "${e.to.port}".` }); continue; }
      if (target.type === 'kit.part') {
        // A cable into a parameter of a part goes to the knob inside it; a cable into an input is joined up from inside.
        const child = childOf(ctx, target);
        if (!child?.part!.params.some(p => p.id === e.to.port)) continue;
        const to = paramTarget(child, e.to.port), from = sourceOf(ctx, e.from);
        if (to && from) addEdge(`${ctx.prefix}${e.id}`, from, to, e.id);
        continue;
      }
      if (isPartPort(target)) continue; // a part's output: joined up from outside
      const from = sourceOf(ctx, e.from);
      if (from) addEdge(`${ctx.prefix}${e.id}`, from, { node: `${ctx.prefix}${target.id}`, port: e.to.port }, e.id);
    }
  };
  expand(root);

  const flat: PatchDocument = { ...doc, nodes: out, edges: flatEdges, parts: {} };
  if (options.solo?.length) solo(flat, catalog, options.solo, { doc, root, childOf, sourceOf, issues });
  return { doc: flat, origin, edges: edgeOrigin, aliases, issues, expanded: true };
}

/** Hear one part alone: its first output (and second, as the right channel) go to Out instead of what normally does. */
function solo(flat: PatchDocument, catalog: Catalog, path: readonly NodeId[], env: { doc: PatchDocument; root: Ctx; childOf: (ctx: Ctx, n: PatchNode) => Ctx | null; sourceOf: (ctx: Ctx, ref: PortRef) => PortRef | null; issues: Issue[] }) {
  let ctx: Ctx = env.root, parent: Ctx = env.root;
  for (const id of path) {
    const n = env.doc.nodes[id];
    const next = n && n.type === 'kit.part' && (n.inside ?? null) === (ctx.part?.id ?? null) ? env.childOf(ctx, n) : null;
    if (!next) { env.issues.push({ severity: 'warning', code: 'solo-missing', message: 'The part to hear alone is gone; playing everything.' }); return; }
    parent = ctx; ctx = next;
  }
  const out = Object.values(flat.nodes).find(n => n.type === 'kit.out');
  const sources = ctx.part!.outputs.slice(0, 2).map(o => env.sourceOf(parent, { node: ctx.instance!.id, port: o.id }));
  if (!out || !sources[0]) { env.issues.push({ severity: 'warning', code: 'solo-silent', node: path[0], message: out ? `${ctx.part!.name} has no output connected inside, so there is nothing to hear alone.` : 'Hearing a part alone needs an Out node.' }); return; }
  for (const e of Object.values(flat.edges)) if (e.to.node === out.id) delete flat.edges[e.id];
  const scope = analyze(flat, catalog).scope;
  ['left', 'right'].forEach((port, i) => {
    let from = sources[i];
    if (!from) return;
    if (scope.get(from.node) === 'voice') {
      // A part that runs per voice is summed first (as Voice Mix would).
      const mix = `solo${port === 'left' ? 'L' : 'R'}Mix`;
      flat.nodes[mix] = { id: mix, type: 'kit.voiceMix', pos: { x: 0, y: 0 }, config: {}, values: {} };
      flat.edges[`solo-${port}-mix`] = { id: `solo-${port}-mix`, from: { ...from }, to: { node: mix, port: 'in' } };
      from = { node: mix, port: 'out' };
    }
    flat.edges[`solo-${port}`] = { id: `solo-${port}`, from: { ...from }, to: { node: out.id, port } };
  });
}

// ---- mapping back ------------------------------------------------------------------------

/** "use_inner_node" → "node (in use › inner)". */
export function readableIds(message: string, flat: Flattened): string {
  if (!flat.expanded) return message;
  return message.replace(/\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b/g, m => {
    const path = flat.origin[m];
    if (path) return `${path.at(-1)} (in ${path.slice(0, -1).join(' › ')})`;
    const cut = m.lastIndexOf('_');
    const head = flat.origin[m.slice(0, cut)];
    return head ? `${head.at(-1)}.${m.slice(cut + 1)} (in ${head.slice(0, -1).join(' › ')})` : m;
  });
}

/** A problem found on the expanded patch, in terms of the patch as it is drawn (`node` is what the main patch shows; `path` goes inside). */
export function mapIssue(issue: Issue, flat: Flattened): Issue {
  if (!flat.expanded) return issue;
  const mapped: Issue = { ...issue, message: readableIds(issue.message, flat) };
  const path = issue.node ? flat.origin[issue.node] : undefined;
  if (path && path.length > 1) { mapped.node = path[0]; mapped.path = path; }
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

/** The expanded id of `node` inside the part entered through `path` (the chain of uses from the main patch). */
export const expandedId = (path: readonly NodeId[], node: NodeId) => [...path, node].join('_');

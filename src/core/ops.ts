// Typed edits. Callers (UI, fast AI path, LLM tools) send *intents*; applying
// them yields *resolved ops* that carry their before-state, so every transaction
// can be inverted exactly. Application is atomic: on any failure the input
// document is untouched (documents are treated as immutable values).
import { checkConfigValue, checkPortValue, clampPortValue, defaultValue, type Catalog } from './catalog.ts';
import { createsCycle } from './scope.ts';
import {
  NODE_ID_PATTERN, PORT_ID_PATTERN, THEMES, clone, edgesInto, edgesOf, nextEdgeId, nextNodeId,
  type ConfigValue, type EdgeId, type NodeId, type PanelRect, type PatchDocument, type PatchEdge, type PatchNode,
  type PortId, type PortRef, type PortSpec, type ThemeId, type Value, type XY,
} from './schema.ts';

export type NewNode = Partial<Omit<PatchNode, 'type'>> & { type: string };

export type Intent =
  | { op: 'addNode'; node: NewNode }
  | { op: 'removeNode'; id: NodeId }
  | { op: 'connect'; from: PortRef; to: PortRef; id?: EdgeId; /** Replace an existing cable into `to`. */ replace?: boolean }
  | { op: 'disconnect'; id: EdgeId }
  | { op: 'disconnectInput'; to: PortRef }
  | { op: 'setValue'; node: NodeId; port: PortId; value: Value; /** Clamp to the port range instead of rejecting. */ clamp?: boolean }
  | { op: 'setConfig'; node: NodeId; key: string; value: ConfigValue }
  | { op: 'setCode'; node: NodeId; code: string; ports?: { inputs: PortSpec[]; outputs: PortSpec[] } }
  | { op: 'move'; node: NodeId; pos: XY }
  | { op: 'setLabel'; node: NodeId; label: string | null }
  | { op: 'setText'; node: NodeId; text: string }
  | { op: 'setPanel'; node: NodeId; panel: PanelRect | null }
  | { op: 'setName'; name: string }
  | { op: 'setTheme'; theme: ThemeId };

type Field = 'pos' | 'label' | 'panel' | 'text' | 'code' | 'ports';
export type ResolvedOp =
  | { op: 'addNode'; node: PatchNode }
  | { op: 'removeNode'; node: PatchNode }
  | { op: 'addEdge'; edge: PatchEdge }
  | { op: 'removeEdge'; edge: PatchEdge }
  | { op: 'setValue'; node: NodeId; port: PortId; from: Value | undefined; to: Value | undefined }
  | { op: 'setConfig'; node: NodeId; key: string; from: ConfigValue | undefined; to: ConfigValue | undefined }
  | { op: 'setField'; node: NodeId; field: Field; from: unknown; to: unknown }
  | { op: 'setDoc'; field: 'name' | 'theme'; from: string; to: string };

export class OpError extends Error {
  readonly index: number;
  readonly code: string;
  readonly hint?: string;
  constructor(message: string, index: number, code: string, hint?: string) { super(message); this.name = 'OpError'; this.index = index; this.code = code; this.hint = hint; }
}

const STRUCTURAL: ReadonlySet<ResolvedOp['op']> = new Set(['addNode', 'removeNode', 'addEdge', 'removeEdge', 'setConfig']);
/** Does this op change the compiled program? (values, positions, labels, panel do not.) */
export function isStructural(op: ResolvedOp): boolean {
  return STRUCTURAL.has(op.op) || (op.op === 'setField' && (op.field === 'code' || op.field === 'ports'));
}

const MAX_CODE = 64_000;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validXY = (p: unknown): p is XY => !!p && typeof p === 'object' && finite((p as XY).x) && finite((p as XY).y);
const validRect = (r: unknown): r is PanelRect => validXY(r) && finite((r as PanelRect).w) && finite((r as PanelRect).h) && (r as PanelRect).w > 0 && (r as PanelRect).h > 0;

function validPorts(ports: unknown): ports is { inputs: PortSpec[]; outputs: PortSpec[] } {
  if (!ports || typeof ports !== 'object') return false;
  const p = ports as { inputs?: unknown; outputs?: unknown };
  const ok = (list: unknown) => Array.isArray(list) && list.length <= 16 && list.every(s => s && typeof s === 'object' && PORT_ID_PATTERN.test(s.id) && (s.type === 'signal' || s.type === 'gate'))
    && new Set(list.map(s => s.id)).size === list.length;
  return ok(p.inputs) && ok(p.outputs);
}

/** Mutable working copy used while applying one transaction. */
class Draft {
  doc: PatchDocument;
  readonly ops: ResolvedOp[] = [];
  readonly catalog: Catalog;
  constructor(base: PatchDocument, catalog: Catalog) {
    this.catalog = catalog;
    // Shallow copies: nodes/edges records are replaced, node objects are copied on write.
    this.doc = { ...base, nodes: { ...base.nodes }, edges: { ...base.edges }, panel: { ...base.panel } };
  }
  apply(op: ResolvedOp) { applyResolved(this.doc, op); this.ops.push(op); }
}

/** Apply one resolved op in place on a draft document (records already shallow-copied). */
function applyResolved(doc: PatchDocument, op: ResolvedOp) {
  const write = (id: NodeId, mutate: (n: PatchNode) => void) => {
    const node = doc.nodes[id]; if (!node) throw new Error(`missing node ${id}`);
    const copy = { ...node, config: { ...node.config }, values: { ...node.values } };
    mutate(copy); doc.nodes[id] = copy;
  };
  switch (op.op) {
    case 'addNode': doc.nodes[op.node.id] = clone(op.node); break;
    case 'removeNode': delete doc.nodes[op.node.id]; break;
    case 'addEdge': doc.edges[op.edge.id] = clone(op.edge); break;
    case 'removeEdge': delete doc.edges[op.edge.id]; break;
    case 'setValue': write(op.node, n => { if (op.to === undefined) delete n.values[op.port]; else n.values[op.port] = op.to; }); break;
    case 'setConfig': write(op.node, n => { if (op.to === undefined) delete n.config[op.key]; else n.config[op.key] = op.to; }); break;
    case 'setField': write(op.node, n => { if (op.to === undefined || op.to === null) delete (n as unknown as Record<string, unknown>)[op.field]; else (n as unknown as Record<string, unknown>)[op.field] = clone(op.to); }); break;
    case 'setDoc': if (op.field === 'name') doc.name = op.to; else doc.panel.theme = op.to as ThemeId; break;
  }
}

export function invert(op: ResolvedOp): ResolvedOp {
  switch (op.op) {
    case 'addNode': return { op: 'removeNode', node: op.node };
    case 'removeNode': return { op: 'addNode', node: op.node };
    case 'addEdge': return { op: 'removeEdge', edge: op.edge };
    case 'removeEdge': return { op: 'addEdge', edge: op.edge };
    case 'setValue': return { ...op, from: op.to, to: op.from };
    case 'setConfig': return { ...op, from: op.to, to: op.from };
    case 'setField': return { ...op, from: op.to, to: op.from };
    case 'setDoc': return { ...op, from: op.to, to: op.from };
  }
}

export function invertAll(ops: readonly ResolvedOp[]): ResolvedOp[] { return [...ops].reverse().map(invert); }

/** Re-apply already-resolved ops (undo/redo). Bumps the revision. */
export function applyResolvedOps(base: PatchDocument, ops: readonly ResolvedOp[]): PatchDocument {
  const doc = { ...base, nodes: { ...base.nodes }, edges: { ...base.edges }, panel: { ...base.panel } };
  for (const op of ops) applyResolved(doc, op);
  doc.revision = base.revision + 1;
  return doc;
}

export interface ApplyResult { doc: PatchDocument; ops: ResolvedOp[]; /** Ids created by addNode intents, in order. */ created: NodeId[] }

/**
 * Apply intents atomically. Throws OpError (with the failing intent index)
 * and leaves `base` untouched on failure.
 */
export function applyIntents(base: PatchDocument, intents: readonly Intent[], catalog: Catalog): ApplyResult {
  const draft = new Draft(base, catalog);
  const created: NodeId[] = [];
  intents.forEach((intent, index) => {
    try { resolveIntent(draft, intent, created); }
    catch (error) {
      if (error instanceof OpError) throw new OpError(error.message, index, error.code, error.hint);
      throw new OpError(error instanceof Error ? error.message : String(error), index, 'internal');
    }
  });
  draft.doc.revision = base.revision + 1;
  return { doc: draft.doc, ops: draft.ops, created };
}

function fail(code: string, message: string, hint?: string): never { throw new OpError(message, -1, code, hint); }

function requireNode(draft: Draft, id: unknown): PatchNode {
  if (typeof id !== 'string' || !draft.doc.nodes[id]) {
    const known = Object.keys(draft.doc.nodes).sort();
    fail('unknown-node', `No node "${String(id)}".`, known.length ? `Existing nodes: ${known.join(', ')}` : 'The patch is empty.');
  }
  return draft.doc.nodes[id];
}

function resolveIntent(draft: Draft, intent: Intent, created: NodeId[]) {
  const { catalog } = draft;
  if (!intent || typeof intent !== 'object') fail('bad-intent', 'Each op must be an object.');
  switch (intent.op) {
    case 'addNode': {
      const spec = intent.node;
      if (!spec || typeof spec.type !== 'string') fail('bad-intent', 'addNode needs node.type.');
      const def = catalog.find(spec.type);
      if (!def) fail('unknown-type', `Unknown node type "${spec.type}".`, 'Call list_blocks for valid types.');
      if (def.singleton && Object.values(draft.doc.nodes).some(n => n.type === def.type)) fail('singleton', `Only one ${def.title} is allowed per patch.`);
      const id = spec.id ?? nextNodeId(draft.doc, defaultStem(spec.type));
      if (!NODE_ID_PATTERN.test(id)) fail('bad-id', `Node id "${id}" must match ${NODE_ID_PATTERN} (letters/digits, starting lowercase).`);
      if (draft.doc.nodes[id]) fail('duplicate-id', `Node id "${id}" already exists.`);
      const config: Record<string, ConfigValue> = {};
      for (const c of def.config) {
        const value = spec.config && Object.hasOwn(spec.config, c.id) ? spec.config[c.id] : c.default;
        const reason = checkConfigValue(c, value); if (reason) fail('bad-config', reason);
        config[c.id] = value!;
      }
      for (const key of Object.keys(spec.config ?? {})) if (!def.config.some(c => c.id === key)) fail('bad-config', `${def.title} has no config "${key}".`, `Config keys: ${def.config.map(c => c.id).join(', ') || 'none'}`);
      const node: PatchNode = { id, type: spec.type, pos: validXY(spec.pos) ? { ...spec.pos } : { x: 0, y: 0 }, config, values: {} };
      if (spec.label) node.label = String(spec.label).slice(0, 80);
      if (def.kind === 'codebox') {
        node.code = typeof spec.code === 'string' ? spec.code : '';
        node.ports = spec.ports && validPorts(spec.ports) ? clone(spec.ports) : { inputs: [{ id: 'in', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] };
        if (spec.ports && !validPorts(spec.ports)) fail('bad-ports', 'Codebox ports must be up to 16 unique ids per side, each {id, type: "signal"|"gate"}.');
        if (node.code.length > MAX_CODE) fail('too-large', `Codebox source is limited to ${MAX_CODE} characters.`);
      }
      if (def.kind === 'comment') node.text = typeof spec.text === 'string' ? spec.text.slice(0, 2000) : '';
      if (spec.panel !== undefined && spec.panel !== null) { if (!validRect(spec.panel)) fail('bad-panel', 'panel must be {x,y,w,h} with positive size.'); node.panel = { ...spec.panel }; }
      // Values: fill defaults for every param-able input so the knob shows the effective value.
      for (const port of catalog.inputs(node)) {
        const given = spec.values && Object.hasOwn(spec.values, port.id) ? spec.values[port.id] : undefined;
        if (given === undefined) { if (port.role !== 'audio') node.values[port.id] = defaultValue(port); continue; }
        const reason = checkPortValue(port, given); if (reason) fail('bad-value', reason);
        node.values[port.id] = port.type === 'gate' ? Boolean(given) : given;
      }
      for (const key of Object.keys(spec.values ?? {})) if (!catalog.input(node, key)) fail('unknown-port', `${def.title} has no input "${key}".`, `Inputs: ${catalog.inputs(node).map(p => p.id).join(', ')}`);
      draft.apply({ op: 'addNode', node });
      created.push(id);
      return;
    }
    case 'removeNode': {
      const node = requireNode(draft, intent.id);
      for (const edge of edgesOf(draft.doc, node.id).sort((a, b) => a.id.localeCompare(b.id))) draft.apply({ op: 'removeEdge', edge });
      draft.apply({ op: 'removeNode', node: draft.doc.nodes[node.id]! });
      return;
    }
    case 'connect': {
      const { from, to } = intent;
      if (!from || !to) fail('bad-intent', 'connect needs from {node, port} and to {node, port}.');
      const source = requireNode(draft, from.node), target = requireNode(draft, to.node);
      const out = catalog.output(source, from.port);
      if (!out) fail('unknown-port', `${source.id} has no output "${from.port}".`, `Outputs: ${catalog.outputs(source).map(p => p.id).join(', ') || 'none'}`);
      const input = catalog.input(target, to.port);
      if (!input) fail('unknown-port', `${target.id} has no input "${to.port}".`, `Inputs: ${catalog.inputs(target).map(p => p.id).join(', ') || 'none'}`);
      const existing = edgesInto(draft.doc, to.node, to.port);
      if (existing.some(e => e.from.node === from.node && e.from.port === from.port)) return; // already connected: idempotent
      if (existing.length) {
        if (!intent.replace) fail('input-taken', `${to.node}.${to.port} is already connected from ${existing[0]!.from.node}.${existing[0]!.from.port}.`, 'Disconnect it first, or use replace: true.');
        for (const edge of existing) draft.apply({ op: 'removeEdge', edge });
      }
      if (createsCycle(draft.doc, from.node, to.node)) fail('cycle', `Connecting ${from.node} → ${to.node} would create a feedback loop.`, 'Route the feedback through a History node (one-sample delay).');
      const id = intent.id ?? nextEdgeId(draft.doc);
      if (draft.doc.edges[id]) fail('duplicate-id', `Edge id "${id}" already exists.`);
      draft.apply({ op: 'addEdge', edge: { id, from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } } });
      return;
    }
    case 'disconnect': {
      const edge = draft.doc.edges[intent.id];
      if (!edge) fail('unknown-edge', `No edge "${intent.id}".`);
      draft.apply({ op: 'removeEdge', edge });
      return;
    }
    case 'disconnectInput': {
      requireNode(draft, intent.to?.node);
      for (const edge of edgesInto(draft.doc, intent.to.node, intent.to.port)) draft.apply({ op: 'removeEdge', edge });
      return;
    }
    case 'setValue': {
      const node = requireNode(draft, intent.node);
      const port = catalog.input(node, intent.port);
      if (!port) fail('unknown-port', `${node.id} has no input "${intent.port}".`, `Inputs: ${catalog.inputs(node).map(p => p.id).join(', ')}`);
      let value = intent.value;
      if (port.type === 'gate') {
        if (typeof value !== 'boolean' && value !== 0 && value !== 1) fail('bad-value', `${port.id} is a gate: use true or false.`);
        value = Boolean(value);
      } else {
        if (!finite(value)) fail('bad-value', `${port.id} must be a finite number.`);
        if (intent.clamp) value = clampPortValue(port, value);
        const reason = checkPortValue(port, value); if (reason) fail('out-of-range', reason);
      }
      const from = node.values[port.id];
      if (from === value) return;
      draft.apply({ op: 'setValue', node: node.id, port: port.id, from, to: value });
      return;
    }
    case 'setConfig': {
      const node = requireNode(draft, intent.node);
      const def = catalog.get(node.type);
      const c = def.config.find(x => x.id === intent.key);
      if (!c) fail('bad-config', `${def.title} has no config "${intent.key}".`, `Config keys: ${def.config.map(x => x.id).join(', ') || 'none'}`);
      const reason = checkConfigValue(c, intent.value); if (reason) fail('bad-config', reason);
      if (node.config[c.id] === intent.value) return;
      draft.apply({ op: 'setConfig', node: node.id, key: c.id, from: node.config[c.id], to: intent.value });
      pruneAfterPortChange(draft, node.id);
      return;
    }
    case 'setCode': {
      const node = requireNode(draft, intent.node);
      if (catalog.get(node.type).kind !== 'codebox') fail('not-codebox', `${node.id} is not a codebox.`);
      if (typeof intent.code !== 'string') fail('bad-intent', 'code must be a string.');
      if (intent.code.length > MAX_CODE) fail('too-large', `Codebox source is limited to ${MAX_CODE} characters.`);
      if (intent.ports !== undefined && !validPorts(intent.ports)) fail('bad-ports', 'Codebox ports must be up to 16 unique ids per side, each {id, type: "signal"|"gate"}.');
      if (intent.code !== node.code) draft.apply({ op: 'setField', node: node.id, field: 'code', from: node.code, to: intent.code });
      if (intent.ports && JSON.stringify(intent.ports) !== JSON.stringify(node.ports)) {
        draft.apply({ op: 'setField', node: node.id, field: 'ports', from: node.ports, to: intent.ports });
        pruneAfterPortChange(draft, node.id);
      }
      return;
    }
    case 'move': {
      const node = requireNode(draft, intent.node);
      if (!validXY(intent.pos)) fail('bad-value', 'pos must be {x, y} finite numbers.');
      if (node.pos.x === intent.pos.x && node.pos.y === intent.pos.y) return;
      draft.apply({ op: 'setField', node: node.id, field: 'pos', from: node.pos, to: { x: intent.pos.x, y: intent.pos.y } });
      return;
    }
    case 'setLabel': {
      const node = requireNode(draft, intent.node);
      const to = intent.label ? String(intent.label).slice(0, 80) : undefined;
      if (node.label === to) return;
      draft.apply({ op: 'setField', node: node.id, field: 'label', from: node.label, to });
      return;
    }
    case 'setText': {
      const node = requireNode(draft, intent.node);
      if (catalog.get(node.type).kind !== 'comment') fail('not-comment', `${node.id} is not a comment.`);
      draft.apply({ op: 'setField', node: node.id, field: 'text', from: node.text, to: String(intent.text).slice(0, 2000) });
      return;
    }
    case 'setPanel': {
      const node = requireNode(draft, intent.node);
      if (intent.panel !== null && !validRect(intent.panel)) fail('bad-panel', 'panel must be {x,y,w,h} with positive size, or null.');
      if (intent.panel !== null && catalog.get(node.type).kind !== 'widget') fail('not-widget', `${node.id} is not a UI widget; only widgets appear on the panel.`);
      draft.apply({ op: 'setField', node: node.id, field: 'panel', from: node.panel, to: intent.panel ?? undefined });
      return;
    }
    case 'setName': {
      const name = String(intent.name ?? '').trim().slice(0, 80) || 'Untitled';
      if (name !== draft.doc.name) draft.apply({ op: 'setDoc', field: 'name', from: draft.doc.name, to: name });
      return;
    }
    case 'setTheme': {
      if (!THEMES.includes(intent.theme)) fail('bad-value', `theme must be one of ${THEMES.join(', ')}.`);
      if (intent.theme !== draft.doc.panel.theme) draft.apply({ op: 'setDoc', field: 'theme', from: draft.doc.panel.theme, to: intent.theme });
      return;
    }
    default:
      fail('bad-intent', `Unknown op "${(intent as { op?: unknown }).op}".`, 'Valid ops: addNode, removeNode, connect, disconnect, disconnectInput, setValue, setConfig, setCode, move, setLabel, setText, setPanel, setName, setTheme.');
  }
}

/** After ports may have changed (config/codebox), drop cables to vanished ports and fill new value defaults. */
function pruneAfterPortChange(draft: Draft, id: NodeId) {
  const node = draft.doc.nodes[id]!;
  const inputs = draft.catalog.inputs(node), outputs = draft.catalog.outputs(node);
  for (const edge of Object.values(draft.doc.edges).sort((a, b) => a.id.localeCompare(b.id))) {
    if ((edge.to.node === id && !inputs.some(p => p.id === edge.to.port)) || (edge.from.node === id && !outputs.some(p => p.id === edge.from.port))) draft.apply({ op: 'removeEdge', edge });
  }
  for (const port of inputs) if (port.role !== 'audio' && !Object.hasOwn(node.values, port.id)) draft.apply({ op: 'setValue', node: id, port: port.id, from: undefined, to: defaultValue(port) });
}

function defaultStem(type: string): string {
  const name = type.split('.').pop() ?? 'node';
  const short: Record<string, string> = { oscillator: 'osc', envelope: 'env', voiceIn: 'voice', voiceMix: 'mix', stateVariableFilter: 'svf', virtualAnalogSource: 'va', frequencyModulation: 'fm', algorithmicReverb: 'reverb', pingPongDelay: 'pingpong', characterFilter: 'ladder', randomModulator: 'random', sampleAndHold: 'sh', curvedAdsr: 'adsr', musicalLfo: 'mlfo' };
  return short[name] ?? name;
}

/** Diff two documents as resolved ops (used for takes/ghosts). Positions included. */
export function diffDocuments(a: PatchDocument, b: PatchDocument): ResolvedOp[] {
  const ops: ResolvedOp[] = [];
  for (const edge of Object.values(a.edges)) if (!b.edges[edge.id] || JSON.stringify(b.edges[edge.id]) !== JSON.stringify(edge)) ops.push({ op: 'removeEdge', edge });
  for (const node of Object.values(a.nodes)) if (!b.nodes[node.id] || b.nodes[node.id]!.type !== node.type) ops.push({ op: 'removeNode', node });
  for (const node of Object.values(b.nodes)) {
    const old = a.nodes[node.id];
    if (!old || old.type !== node.type) { ops.push({ op: 'addNode', node }); continue; }
    for (const key of new Set([...Object.keys(old.config), ...Object.keys(node.config)])) if (old.config[key] !== node.config[key]) ops.push({ op: 'setConfig', node: node.id, key, from: old.config[key], to: node.config[key] });
    for (const key of new Set([...Object.keys(old.values), ...Object.keys(node.values)])) if (old.values[key] !== node.values[key]) ops.push({ op: 'setValue', node: node.id, port: key, from: old.values[key], to: node.values[key] });
    for (const field of ['pos', 'label', 'panel', 'text', 'code', 'ports'] as const) if (JSON.stringify(old[field]) !== JSON.stringify(node[field])) ops.push({ op: 'setField', node: node.id, field, from: old[field], to: node[field] });
  }
  for (const edge of Object.values(b.edges)) if (!a.edges[edge.id] || JSON.stringify(a.edges[edge.id]) !== JSON.stringify(edge)) ops.push({ op: 'addEdge', edge });
  if (a.name !== b.name) ops.push({ op: 'setDoc', field: 'name', from: a.name, to: b.name });
  if (a.panel.theme !== b.panel.theme) ops.push({ op: 'setDoc', field: 'theme', from: a.panel.theme, to: b.panel.theme });
  return ops;
}

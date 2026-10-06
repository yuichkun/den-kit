// den-kit patch document. The browser owns one of these; every change goes
// through typed, author-attributed ops (ops.ts) so humans, the fast AI path and
// the LLM path all edit the same way. Pure data: no DOM, no Vue, no unworklet.

export const PATCH_SCHEMA = 'den-kit/patch';
export const PATCH_VERSION = 1;

export type NodeId = string;
export type EdgeId = string;
export type PortId = string;
export type Value = number | boolean;
export type ConfigValue = string | number | boolean;

export interface XY { x: number; y: number }
export interface PanelRect { x: number; y: number; w: number; h: number }

/** Signal = one f32 per sample. Gate = one bool per sample. */
export type SignalType = 'signal' | 'gate';

/** Port shape for codebox-declared ports (block ports come from the catalog). */
export interface PortSpec { id: PortId; type: SignalType }

export interface PatchNode {
  id: NodeId;
  /** Catalog type, e.g. `den.filter`, `kit.mul`, `kit.voiceIn`, `ui.knob`. */
  type: string;
  label?: string;
  pos: XY;
  /** Structural construction choices. Changing these recompiles. */
  config: Record<string, ConfigValue>;
  /** Values of unconnected inputs (and widget values). These are AudioParams: no recompile. */
  values: Record<PortId, Value>;
  /** Position in the panel (presentation) view. Only widgets are shown there. */
  panel?: PanelRect;
  /** Codebox source (core API module). */
  code?: string;
  /** Codebox-declared ports. */
  ports?: { inputs: PortSpec[]; outputs: PortSpec[] };
  /** Comment text. */
  text?: string;
}

export interface PortRef { node: NodeId; port: PortId }
export interface PatchEdge { id: EdgeId; from: PortRef; to: PortRef }

export const THEMES = ['graphite', 'paper', 'neon', 'studio'] as const;
export type ThemeId = typeof THEMES[number];

export interface PatchDocument {
  schema: typeof PATCH_SCHEMA;
  version: typeof PATCH_VERSION;
  id: string;
  name: string;
  /** Increments once per committed transaction. */
  revision: number;
  nodes: Record<NodeId, PatchNode>;
  edges: Record<EdgeId, PatchEdge>;
  panel: { width: number; height: number; theme: ThemeId };
}

export const NODE_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;
export const PORT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

export function emptyDocument(name = 'Untitled', id = randomId('patch')): PatchDocument {
  return { schema: PATCH_SCHEMA, version: PATCH_VERSION, id, name, revision: 0, nodes: {}, edges: {}, panel: { width: 640, height: 360, theme: 'graphite' } };
}

let fallbackCounter = 0;
export function randomId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? `${Date.now().toString(36)}${(fallbackCounter++).toString(36)}`;
  return `${prefix}-${random}`;
}

/** Readable node ids (`osc1`, `filter2`) keep generated code and AI context legible. */
export function nextNodeId(doc: Pick<PatchDocument, 'nodes'>, stem: string, taken: ReadonlySet<string> = new Set()): NodeId {
  const base = stem.replace(/[^a-zA-Z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 24) || 'node';
  for (let n = 1; ; n++) {
    const id = `${base}${n}`;
    if (!Object.hasOwn(doc.nodes, id) && !taken.has(id)) return id;
  }
}

export function nextEdgeId(doc: Pick<PatchDocument, 'edges'>, taken: ReadonlySet<string> = new Set()): EdgeId {
  for (let n = Object.keys(doc.edges).length + 1; ; n++) {
    const id = `e${n}`;
    if (!Object.hasOwn(doc.edges, id) && !taken.has(id)) return id;
  }
}

export function edgesInto(doc: PatchDocument, node: NodeId, port?: PortId): PatchEdge[] {
  return Object.values(doc.edges).filter(e => e.to.node === node && (port === undefined || e.to.port === port));
}
export function edgesFrom(doc: PatchDocument, node: NodeId, port?: PortId): PatchEdge[] {
  return Object.values(doc.edges).filter(e => e.from.node === node && (port === undefined || e.from.port === port));
}
export function edgesOf(doc: PatchDocument, node: NodeId): PatchEdge[] {
  return Object.values(doc.edges).filter(e => e.from.node === node || e.to.node === node);
}

/** Deep clone of plain JSON data. JSON (not structuredClone) so UI proxies (Vue reactive objects) clone too. */
export function clone<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }

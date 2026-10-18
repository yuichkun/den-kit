// den-kit patch document. The browser owns one of these; every change goes
// through typed, author-attributed ops (ops.ts) so humans, the fast AI path and
// the LLM path all edit the same way. Pure data: no DOM, no Vue, no unworklet.
import type { ScreenProject } from './project.ts';
import type { PortDef } from './catalog.ts';
import { emptyUi, type AssetMeta, type PluginUi, type UiElement, type WidgetStyle } from './ui.ts';

export const PATCH_SCHEMA = 'den-kit/patch';
/** 3: parts (definitions used in several places). 2: the plugin's own screen (look, decorations, order, groups) and assets. 1 and 2 still load. */
export const PATCH_VERSION = 4;

export type NodeId = string;
export type EdgeId = string;
export type PortId = string;
export type Value = number | boolean;
export type ConfigValue = string | number | boolean;

export interface XY {
  x: number;
  y: number;
}
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Signal = one f32 per sample. Gate = one bool per sample. */
export type SignalType = 'signal' | 'gate';

/** Port shape for codebox-declared ports (block ports come from the catalog). */
export interface PortSpec {
  id: PortId;
  type: SignalType;
}

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
  /** How a widget looks on the plugin (skin, box, colours, text). */
  style?: WidgetStyle;
  /** The part this node lives inside (its definition's id); absent: the main patch. */
  inside?: string;
  /** A part (kit.part): the definition it uses. */
  part?: string;
  /** A part's inputs (its inputs, then its parameters) and outputs, kept in step with its definition by every edit. */
  iface?: { inputs: PortDef[]; outputs: PortDef[] };
  /** ×N: the node (or part) runs as this many copies side by side; its outputs then carry one signal per copy (a thick cable). Absent: once. */
  count?: number;
  /** How the copies differ, knob by knob (knobs without an entry are the same in every copy). */
  spread?: Record<PortId, Spread>;
}

/** The most copies of one node. */
export const MAX_COUNT = 128;
export const SPREAD_KINDS = ['range', 'random', 'harmonic', 'each'] as const;
export type SpreadKind = (typeof SPREAD_KINDS)[number];
/**
 * How the copies of a stacked node differ on one knob. The knob's own value is
 * the centre: `range` places the copies evenly from −amount to +amount around
 * it, `random` anywhere in that span (fixed by `seed`), `harmonic` at 1, 2, 3…
 * times it, `each` gives every copy its own value. On a frequency (log) knob the
 * amount is in octaves; elsewhere in the knob's unit.
 */
export interface Spread {
  kind: SpreadKind;
  amount?: number;
  seed?: number;
  /** each: one value per copy (copies past the end use the knob's value). */
  values?: number[];
}

/** One input or output of a part: the inlet or outlet node inside that carries it. */
export interface PartPort {
  id: PortId;
  node: NodeId;
}
/** A knob inside a part shown on the part itself: each use of the part has its own value. */
export interface PartParam {
  id: PortId;
  node: NodeId;
  port: PortId;
  label?: string;
  /** Its own knob range (inside the inner knob's limits). */ range?: ParamRange;
}
/** Where a part parameter's knob turns, how, and in what unit (e.g. a Multiply's ±1e6 shown as 0–1 st). */
export interface ParamRange {
  min: number;
  max: number;
  scale?: 'linear' | 'log';
  /** A unit (Hz, s, st…), or "" for none. */ unit?: string;
}
/** A control on a part's face: it sets one of the part's parameters, for the use the face is put on the plugin for. */
export interface FaceControl {
  param: PortId;
  type: 'ui.knob' | 'ui.slider' | 'ui.toggle' | 'ui.button';
  rect: PanelRect;
  label?: string;
  style?: WidgetStyle;
}
/**
 * A part's own little screen (like Max's bpatcher, but data): controls for its
 * parameters and decorations, placed in a box of its own (rects are inside the
 * box). Text and lamps bind to a control by its parameter id.
 */
export interface PartFace {
  width: number;
  height: number;
  controls: FaceControl[];
  elements: UiElement[];
}
/**
 * A part: one definition, used in any number of places (kit.part nodes). The
 * nodes inside live in the document's node list with `inside` set to its id,
 * so every edit (by hand or by the AI) is an ordinary op and undoes like one.
 */
export interface PartDef {
  id: string;
  name: string;
  /** What it does (shown on the part and given to the AI). */
  doc?: string;
  inputs: PartPort[];
  outputs: PartPort[];
  params: PartParam[];
  /** Placed from (or saved to) My parts: which one, its version then, and what it was then (to tell whether it was changed here since). */
  from?: { id: string; version: number; hash?: string };
  /** Its own screen (absent: a default one, its name over a knob per parameter). */
  face?: PartFace;
}

export interface PortRef {
  node: NodeId;
  port: PortId;
}
export interface PatchEdge {
  id: EdgeId;
  from: PortRef;
  to: PortRef;
}

export const THEMES = ['graphite', 'paper', 'neon', 'studio'] as const;
export type ThemeId = (typeof THEMES)[number];

export interface PatchDocument {
  schema: typeof PATCH_SCHEMA;
  version: typeof PATCH_VERSION;
  id: string;
  name: string;
  /** Increments once per committed transaction. */
  revision: number;
  nodes: Record<NodeId, PatchNode>;
  edges: Record<EdgeId, PatchEdge>;
  /** The plugin's design size and base theme (the look's tokens override the theme). */
  panel: { width: number; height: number; theme: ThemeId };
  /** The plugin's screen beyond the widget nodes. */
  ui: PluginUi;
  /** Pictures and fonts the plugin uses (bytes live in the browser's asset store or ship with den-kit). */
  assets: Record<string, AssetMeta>;
  /** Part definitions used in this patch, by id. */
  parts: Record<string, PartDef>;
  /** The screen's web project (sources only), when the work has one (format v4). */
  project?: ScreenProject;
}

export const NODE_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;
/** Part definition ids look like node ids (their own namespace). */
export const PART_ID_PATTERN = NODE_ID_PATTERN;
export const PORT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

export function emptyDocument(name = 'Untitled', id = randomId('patch')): PatchDocument {
  return {
    schema: PATCH_SCHEMA,
    version: PATCH_VERSION,
    id,
    name,
    revision: 0,
    nodes: {},
    edges: {},
    panel: { width: 640, height: 360, theme: 'graphite' },
    ui: emptyUi(),
    assets: {},
    parts: {},
  };
}

let fallbackCounter = 0;
export function randomId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    `${Date.now().toString(36)}${(fallbackCounter++).toString(36)}`;
  return `${prefix}-${random}`;
}

/** Readable node ids (`osc1`, `filter2`) keep generated code and AI context legible. Plugin elements share the namespace. */
export function nextNodeId(
  doc: Pick<PatchDocument, 'nodes'> & { ui?: Pick<PluginUi, 'elements' | 'groups'> },
  stem: string,
  taken: ReadonlySet<string> = new Set(),
): NodeId {
  const base =
    stem
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 24) || 'node';
  for (let n = 1; ; n++) {
    const id = `${base}${n}`;
    if (
      !Object.hasOwn(doc.nodes, id) &&
      !(doc.ui && (Object.hasOwn(doc.ui.elements, id) || Object.hasOwn(doc.ui.groups, id))) &&
      !taken.has(id)
    )
      return id;
  }
}

export function nextEdgeId(
  doc: Pick<PatchDocument, 'edges'>,
  taken: ReadonlySet<string> = new Set(),
): EdgeId {
  for (let n = Object.keys(doc.edges).length + 1; ; n++) {
    const id = `e${n}`;
    if (!Object.hasOwn(doc.edges, id) && !taken.has(id)) return id;
  }
}

export function edgesInto(doc: PatchDocument, node: NodeId, port?: PortId): PatchEdge[] {
  return Object.values(doc.edges).filter(
    e => e.to.node === node && (port === undefined || e.to.port === port),
  );
}
export function edgesFrom(doc: PatchDocument, node: NodeId, port?: PortId): PatchEdge[] {
  return Object.values(doc.edges).filter(
    e => e.from.node === node && (port === undefined || e.from.port === port),
  );
}
export function edgesOf(doc: PatchDocument, node: NodeId): PatchEdge[] {
  return Object.values(doc.edges).filter(e => e.from.node === node || e.to.node === node);
}

/** Deep clone of plain JSON data. JSON (not structuredClone) so UI proxies (Vue reactive objects) clone too. */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

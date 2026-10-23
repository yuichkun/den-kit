// Typed edits. Callers (UI, fast AI path, LLM tools) send *intents*; applying
// them yields *resolved ops* that carry their before-state, so every transaction
// can be inverted exactly. Application is atomic: on any failure the input
// document is untouched (documents are treated as immutable values).
import {
  checkConfigValue,
  checkPortValue,
  clampPortValue,
  defaultValue,
  type Catalog,
} from './catalog.ts';
import { createsCycle } from './scope.ts';
import { OpError, fail } from './op-error.ts';
import { CODEBOX_TEMPLATE } from './codebox-template.ts';
import {
  addParam,
  checkPlacement,
  detachPart,
  importPart,
  makePart,
  removeParam,
  replacePart,
  syncParts,
  syncPorts,
  unpackPart,
  updatePart,
} from './part-ops.ts';
import { faceAssetUses } from './face.ts';
import { partInterface } from './parts.ts';
import {
  MAX_COUNT,
  NODE_ID_PATTERN,
  PORT_ID_PATTERN,
  THEMES,
  clone,
  edgesInto,
  edgesOf,
  nextEdgeId,
  nextNodeId,
  type ConfigValue,
  type EdgeId,
  type NodeId,
  type PanelRect,
  type ParamRange,
  type PartDef,
  type PartFace,
  type PatchDocument,
  type PatchEdge,
  type PatchNode,
  type PortId,
  type PortRef,
  type PortSpec,
  type Spread,
  type ThemeId,
  type Value,
  type XY,
} from './schema.ts';
import { checkSpread, spreadable, stackable } from './stacks.ts';
import { WORK_LIMITS, checkPath, isTextPath, totalBytes, type WorkFile } from './files.ts';
import { CONTROL_OF, type ControlKind } from './skins.ts';
import {
  ELEMENT_FIELDS,
  LIMITS,
  UiCheckError,
  assetFile,
  assetUses,
  assetsOf,
  checkAsset,
  checkElement,
  checkLook,
  checkRect,
  checkWidgetStyle,
  stackOrder,
  type AssetMeta,
  type CheckContext,
  type ElementKind,
  type Look,
  type PluginUi,
  type UiElement,
  type Underlay,
  type WidgetStyle,
} from './ui.ts';

/** A node to add. `inside` puts it in a part; a part (kit.part) names its definition in `part`. `iface` is worked out, never given. */
export type NewNode = Partial<Omit<PatchNode, 'type'>> & { type: string };
export type NewElement = Partial<Omit<UiElement, 'kind'>> & { kind: ElementKind } & Record<
    string,
    unknown
  >;
/** setLook: tokens and skins merge key by key (null removes one); background and css replace (null removes). */
export interface LookPatch {
  tokens?: Record<string, string | null>;
  background?: unknown[] | null;
  skins?: Record<string, unknown>;
  css?: string | null;
}
export type Arrange = 'front' | 'back' | 'forward' | 'backward';

export type Intent =
  | { op: 'addNode'; node: NewNode }
  | { op: 'removeNode'; id: NodeId }
  | {
      op: 'connect';
      from: PortRef;
      to: PortRef;
      id?: EdgeId;
      /** Replace an existing cable into `to`. */ replace?: boolean;
    }
  | { op: 'disconnect'; id: EdgeId }
  | { op: 'disconnectInput'; to: PortRef }
  | {
      op: 'setValue';
      node: NodeId;
      port: PortId;
      value: Value;
      /** Clamp to the port range instead of rejecting. */ clamp?: boolean;
    }
  | { op: 'setConfig'; node: NodeId; key: string; value: ConfigValue }
  | {
      op: 'setCode';
      node: NodeId;
      code: string;
      ports?: { inputs: PortSpec[]; outputs: PortSpec[] };
    }
  | { op: 'move'; node: NodeId; pos: XY }
  | { op: 'setLabel'; node: NodeId; label: string | null }
  | { op: 'setText'; node: NodeId; text: string }
  | { op: 'setPanel'; node: NodeId; panel: PanelRect | null }
  | { op: 'setName'; name: string }
  | { op: 'setTheme'; theme: ThemeId }
  // ---- the plugin's screen ----
  | { op: 'addElement'; element: NewElement }
  | { op: 'removeElement'; id: string }
  /** Change fields of a decoration (null removes an optional field). */
  | { op: 'updateElement'; id: string; set: Record<string, unknown> }
  /** Place or resize anything on the plugin: a decoration or a widget node. */
  | { op: 'setRect'; id: string; rect: PanelRect }
  | { op: 'setStyle'; node: NodeId; style: WidgetStyle | null }
  | { op: 'arrange'; ids: string[]; to: Arrange }
  | { op: 'group'; ids: string[]; id?: string }
  | { op: 'ungroup'; id: string }
  | {
      op: 'setLook';
      look: LookPatch | Look;
      /** Replace the whole look instead of merging. */ replace?: boolean;
    }
  | { op: 'setPanelSize'; width: number; height: number }
  | { op: 'addAsset'; asset: AssetMeta }
  | { op: 'updateAsset'; id: string; set: { name?: string; source?: AssetMeta['source'] | null } }
  | { op: 'removeAsset'; id: string }
  | { op: 'setUnderlay'; underlay: Underlay | null }
  /** The design brief (null or empty removes it). */
  | { op: 'setBrief'; brief: string | null }
  /** Write files of the screen's web project (text; null deletes one). Paths are relative to the project. */
  | { op: 'setProjectFiles'; files: Record<string, string | null> }
  // ---- parts ----
  /** Make a part from modules: they move inside it, cables across the edge become its inputs and outputs, their main knobs its parameters; one use of it takes their place. */
  | {
      op: 'makePart';
      ids: NodeId[];
      name?: string;
      /** The part's id (default: from the name). */ id?: string;
      /** The use's node id. */ node?: NodeId;
    }
  /** Put a part's insides back in its place as ordinary modules. */
  | { op: 'unpackPart'; node: NodeId }
  /** Give this use its own copy of the part (edits inside then change only it). */
  | { op: 'detachPart'; node: NodeId; name?: string }
  /** Rename or describe a part; relabel its inputs, outputs and parameters (null clears a label); record where it stands with My parts. */
  | {
      op: 'updatePart';
      part: string;
      name?: string;
      doc?: string | null;
      labels?: Record<string, string | null>;
      /** Parameters' own knob ranges (null: the inner knob's). */ ranges?: Record<
        string,
        ParamRange | null
      >;
      from?: PartDef['from'] | null;
      /** Its own screen (null: back to the default face). */ face?: PartFace | null;
    }
  /** Place a part from My parts: its definition (and the parts inside it) come in with one use. `ids` pins the ids it gets (default: its own where free). */
  | {
      op: 'importPart';
      bundle: unknown;
      from?: PartDef['from'];
      node?: NodeId;
      pos?: XY;
      inside?: string;
      ids?: { parts?: Record<string, string>; nodes?: Record<string, string> };
    }
  /** Put another version of a part in place of what is inside it now (from My parts); its uses keep their values where the knob is still there. */
  | { op: 'replacePart'; part: string; bundle: unknown; from?: PartDef['from'] }
  /** Show a free knob of a module inside a part on the part itself (each use gets its own value). */
  | {
      op: 'addParam';
      part: string;
      node: NodeId;
      port: PortId;
      id?: PortId;
      label?: string;
      range?: ParamRange;
    }
  | { op: 'removeParam'; part: string; id: PortId }
  // ---- copies (×N) ----
  /** Run a node (or a part) as this many copies side by side (1: once). Its outputs then carry one signal per copy (a thick cable). */
  | { op: 'setCount'; node: NodeId; count: number }
  /** How the copies differ on one knob (null: the same in every copy). */
  | { op: 'setSpread'; node: NodeId; port: PortId; spread: Spread | null };

type Field =
  | 'pos'
  | 'label'
  | 'panel'
  | 'text'
  | 'code'
  | 'ports'
  | 'style'
  | 'inside'
  | 'part'
  | 'iface'
  | 'count'
  | 'spread';
type UiField = 'look' | 'order' | 'groups' | 'underlay' | 'brief';
export interface Size {
  width: number;
  height: number;
}
export type ResolvedOp =
  | { op: 'addNode'; node: PatchNode }
  | { op: 'removeNode'; node: PatchNode }
  | { op: 'addEdge'; edge: PatchEdge }
  | { op: 'removeEdge'; edge: PatchEdge }
  | { op: 'setValue'; node: NodeId; port: PortId; from: Value | undefined; to: Value | undefined }
  | {
      op: 'setConfig';
      node: NodeId;
      key: string;
      from: ConfigValue | undefined;
      to: ConfigValue | undefined;
    }
  | { op: 'setField'; node: NodeId; field: Field; from: unknown; to: unknown }
  | { op: 'setDoc'; field: 'name' | 'theme'; from: string; to: string }
  | { op: 'setSize'; from: Size; to: Size }
  | { op: 'addElement'; element: UiElement }
  | { op: 'removeElement'; element: UiElement }
  | { op: 'setElement'; id: string; field: string; from: unknown; to: unknown }
  | { op: 'setUi'; field: UiField; from: unknown; to: unknown }
  | { op: 'addPart'; part: PartDef }
  | { op: 'removePart'; part: PartDef }
  | { op: 'setPart'; id: string; from: PartDef; to: PartDef }
  /** A file of the work added (from undefined), replaced or removed (to undefined). */
  | { op: 'setFile'; path: string; from: WorkFile | undefined; to: WorkFile | undefined };

export { OpError } from './op-error.ts';

const STRUCTURAL: ReadonlySet<ResolvedOp['op']> = new Set([
  'addNode',
  'removeNode',
  'addEdge',
  'removeEdge',
  'setConfig',
  'addPart',
  'removePart',
]);
/** The shape of a part's ports (not their labels or defaults). */
const portShape = (v: unknown) => {
  const f = v as
    | {
        inputs?: Array<{ id: string; type: string; role?: string }>;
        outputs?: Array<{ id: string; type: string }>;
      }
    | undefined;
  return JSON.stringify([
    f?.inputs?.map(p => [p.id, p.type, p.role]),
    f?.outputs?.map(p => [p.id, p.type]),
  ]);
};
const partShape = (p: PartDef) =>
  JSON.stringify([p.inputs, p.outputs, p.params.map(q => [q.id, q.node, q.port])]);
/** Which knobs have a spread (a spread knob is one AudioParam per copy; changing how it spreads only changes values). */
const spreadKeys = (v: unknown) =>
  Object.keys((v ?? {}) as Record<string, unknown>)
    .sort()
    .join(',');
/** Does this op change the compiled program? (values, positions, labels, panel, names, how copies spread do not.) */
export function isStructural(op: ResolvedOp): boolean {
  if (op.op === 'setPart') return partShape(op.from) !== partShape(op.to);
  if (op.op === 'setField' && op.field === 'iface') return portShape(op.from) !== portShape(op.to);
  if (op.op === 'setField' && op.field === 'spread')
    return spreadKeys(op.from) !== spreadKeys(op.to);
  return (
    STRUCTURAL.has(op.op) ||
    (op.op === 'setField' &&
      (op.field === 'code' ||
        op.field === 'ports' ||
        op.field === 'inside' ||
        op.field === 'part' ||
        op.field === 'count'))
  );
}

const MAX_CODE = 64_000;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validXY = (p: unknown): p is XY =>
  !!p && typeof p === 'object' && finite((p as XY).x) && finite((p as XY).y);
const validRect = (r: unknown): r is PanelRect =>
  validXY(r) &&
  finite((r as PanelRect).w) &&
  finite((r as PanelRect).h) &&
  (r as PanelRect).w > 0 &&
  (r as PanelRect).h > 0;

function validPorts(ports: unknown): ports is { inputs: PortSpec[]; outputs: PortSpec[] } {
  if (!ports || typeof ports !== 'object') return false;
  const p = ports as { inputs?: unknown; outputs?: unknown };
  const ok = (list: unknown) =>
    Array.isArray(list) &&
    list.length <= 16 &&
    list.every(
      s =>
        s &&
        typeof s === 'object' &&
        PORT_ID_PATTERN.test(s.id) &&
        (s.type === 'signal' || s.type === 'gate'),
    ) &&
    new Set(list.map(s => s.id)).size === list.length;
  return ok(p.inputs) && ok(p.outputs);
}

/** Mutable working copy used while applying one transaction. */
class Draft {
  doc: PatchDocument;
  readonly ops: ResolvedOp[] = [];
  readonly catalog: Catalog;
  constructor(base: PatchDocument, catalog: Catalog) {
    this.catalog = catalog;
    // Shallow copies: records are replaced, node and element objects are copied on write.
    this.doc = shallowCopy(base);
  }
  apply(op: ResolvedOp) {
    applyResolved(this.doc, op);
    this.ops.push(op);
  }
}

/** A document whose records can be written without touching `base` (look, order, groups and underlay are replaced whole, never mutated). */
function shallowCopy(base: PatchDocument): PatchDocument {
  return {
    ...base,
    nodes: { ...base.nodes },
    edges: { ...base.edges },
    panel: { ...base.panel },
    ui: { ...base.ui, elements: { ...base.ui.elements } },
    parts: { ...base.parts },
    files: { ...base.files },
  };
}

/** Apply one resolved op in place on a draft document (records already shallow-copied). */
function applyResolved(doc: PatchDocument, op: ResolvedOp) {
  const write = (id: NodeId, mutate: (n: PatchNode) => void) => {
    const node = doc.nodes[id];
    if (!node) throw new Error(`missing node ${id}`);
    const copy = { ...node, config: { ...node.config }, values: { ...node.values } };
    mutate(copy);
    doc.nodes[id] = copy;
  };
  switch (op.op) {
    case 'addNode':
      doc.nodes[op.node.id] = clone(op.node);
      break;
    case 'removeNode':
      delete doc.nodes[op.node.id];
      break;
    case 'addEdge':
      doc.edges[op.edge.id] = clone(op.edge);
      break;
    case 'removeEdge':
      delete doc.edges[op.edge.id];
      break;
    case 'setValue':
      write(op.node, n => {
        if (op.to === undefined) delete n.values[op.port];
        else n.values[op.port] = op.to;
      });
      break;
    case 'setConfig':
      write(op.node, n => {
        if (op.to === undefined) delete n.config[op.key];
        else n.config[op.key] = op.to;
      });
      break;
    case 'setField':
      write(op.node, n => {
        if (op.to === undefined || op.to === null)
          delete (n as unknown as Record<string, unknown>)[op.field];
        else (n as unknown as Record<string, unknown>)[op.field] = clone(op.to);
      });
      break;
    case 'setDoc':
      if (op.field === 'name') doc.name = op.to;
      else doc.panel.theme = op.to as ThemeId;
      break;
    case 'setSize':
      doc.panel.width = op.to.width;
      doc.panel.height = op.to.height;
      break;
    case 'addElement':
      doc.ui.elements[op.element.id] = clone(op.element);
      break;
    case 'removeElement':
      delete doc.ui.elements[op.element.id];
      break;
    case 'setElement': {
      const el = doc.ui.elements[op.id];
      if (!el) throw new Error(`missing element ${op.id}`);
      const copy = { ...el } as Record<string, unknown>;
      if (op.to === undefined || op.to === null) delete copy[op.field];
      else copy[op.field] = clone(op.to);
      doc.ui.elements[op.id] = copy as unknown as UiElement;
      break;
    }
    case 'setUi': {
      const ui = doc.ui as unknown as Record<string, unknown>;
      if (op.to === undefined || op.to === null) delete ui[op.field];
      else ui[op.field] = clone(op.to);
      break;
    }
    case 'addPart':
      doc.parts[op.part.id] = clone(op.part);
      break;
    case 'removePart':
      delete doc.parts[op.part.id];
      break;
    case 'setPart':
      doc.parts[op.id] = clone(op.to);
      break;
    case 'setFile': {
      // A new files record every time: views of it (assetsOf) are kept per record.
      const files = { ...doc.files };
      if (op.to === undefined) delete files[op.path];
      else files[op.path] = clone(op.to);
      doc.files = files;
      break;
    }
  }
}

export function invert(op: ResolvedOp): ResolvedOp {
  switch (op.op) {
    case 'addNode':
      return { op: 'removeNode', node: op.node };
    case 'removeNode':
      return { op: 'addNode', node: op.node };
    case 'addEdge':
      return { op: 'removeEdge', edge: op.edge };
    case 'removeEdge':
      return { op: 'addEdge', edge: op.edge };
    case 'setValue':
      return { ...op, from: op.to, to: op.from };
    case 'setConfig':
      return { ...op, from: op.to, to: op.from };
    case 'setField':
      return { ...op, from: op.to, to: op.from };
    case 'setDoc':
      return { ...op, from: op.to, to: op.from };
    case 'setSize':
      return { ...op, from: op.to, to: op.from };
    case 'addElement':
      return { op: 'removeElement', element: op.element };
    case 'removeElement':
      return { op: 'addElement', element: op.element };
    case 'setElement':
      return { ...op, from: op.to, to: op.from };
    case 'setUi':
      return { ...op, from: op.to, to: op.from };
    case 'addPart':
      return { op: 'removePart', part: op.part };
    case 'removePart':
      return { op: 'addPart', part: op.part };
    case 'setPart':
      return { ...op, from: op.to, to: op.from };
    case 'setFile':
      return { ...op, from: op.to, to: op.from };
  }
}

export function invertAll(ops: readonly ResolvedOp[]): ResolvedOp[] {
  return [...ops].reverse().map(invert);
}

/** Re-apply already-resolved ops (undo/redo). Bumps the revision. */
export function applyResolvedOps(base: PatchDocument, ops: readonly ResolvedOp[]): PatchDocument {
  const doc = shallowCopy(base);
  for (const op of ops) applyResolved(doc, op);
  doc.revision = base.revision + 1;
  return doc;
}

export interface ApplyResult {
  doc: PatchDocument;
  ops: ResolvedOp[];
  /** Ids created by addNode, addElement, group and makePart intents (and the modules unpackPart brings out), in order. */
  created: NodeId[];
  /** The index of the intent that made each of `created`. */
  createdBy: number[];
}

/**
 * Apply intents atomically. Throws OpError (with the failing intent index)
 * and leaves `base` untouched on failure.
 */
export function applyIntents(
  base: PatchDocument,
  intents: readonly Intent[],
  catalog: Catalog,
): ApplyResult {
  const draft = new Draft(base, catalog);
  const created: NodeId[] = [],
    createdBy: number[] = [];
  intents.forEach((intent, index) => {
    // Ports of parts follow each edit, so a later edit in the same transaction can use a new input or parameter.
    try {
      resolveIntent(draft, intent, created);
      syncPorts(draft);
    } catch (error) {
      if (error instanceof OpError || error instanceof UiCheckError)
        throw new OpError(error.message, index, error.code, error.hint);
      throw new OpError(error instanceof Error ? error.message : String(error), index, 'internal');
    }
    while (createdBy.length < created.length) createdBy.push(index);
  });
  // Every use of a part follows its definition; parts nothing uses go.
  try {
    syncParts(draft);
  } catch (error) {
    throw new OpError(
      error instanceof Error ? error.message : String(error),
      intents.length - 1,
      error instanceof OpError ? error.code : 'internal',
    );
  }
  draft.doc.revision = base.revision + 1;
  return { doc: draft.doc, ops: draft.ops, created, createdBy };
}

function requireNode(draft: Draft, id: unknown): PatchNode {
  if (typeof id !== 'string' || !draft.doc.nodes[id]) {
    const known = Object.keys(draft.doc.nodes).sort();
    fail(
      'unknown-node',
      `No node "${String(id)}".`,
      known.length ? `Existing nodes: ${known.join(', ')}` : 'The patch is empty.',
    );
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
      if (!def)
        fail(
          'unknown-type',
          `Unknown node type "${spec.type}".`,
          'Call list_blocks for valid types.',
        );
      if (def.singleton && Object.values(draft.doc.nodes).some(n => n.type === def.type))
        fail('singleton', `Only one ${def.title} is allowed per patch.`);
      checkPlacement(draft.doc, catalog, spec.type, spec.inside, spec.part);
      const stem =
        def.kind === 'part'
          ? String(spec.part)
          : def.kind === 'partIn'
            ? `${spec.inside}In`
            : def.kind === 'partOut'
              ? `${spec.inside}Out`
              : defaultStem(spec.type);
      const id = spec.id ?? nextNodeId(draft.doc, stem);
      if (!NODE_ID_PATTERN.test(id))
        fail(
          'bad-id',
          `Node id "${id}" must match ${NODE_ID_PATTERN} (letters/digits, starting lowercase).`,
        );
      if (draft.doc.nodes[id] || draft.doc.ui.elements[id] || draft.doc.ui.groups[id])
        fail('duplicate-id', `Id "${id}" is already taken.`);
      const config: Record<string, ConfigValue> = {};
      for (const c of def.config) {
        const value =
          spec.config && Object.hasOwn(spec.config, c.id) ? spec.config[c.id] : c.default;
        const reason = checkConfigValue(c, value);
        if (reason) fail('bad-config', reason);
        config[c.id] = value!;
      }
      for (const key of Object.keys(spec.config ?? {}))
        if (!def.config.some(c => c.id === key))
          fail(
            'bad-config',
            `${def.title} has no config "${key}".`,
            `Config keys: ${def.config.map(c => c.id).join(', ') || 'none'}`,
          );
      const node: PatchNode = {
        id,
        type: spec.type,
        pos: validXY(spec.pos) ? { ...spec.pos } : { x: 0, y: 0 },
        config,
        values: {},
      };
      if (spec.label) node.label = String(spec.label).slice(0, 80);
      if (spec.inside !== undefined) node.inside = spec.inside;
      if (def.kind === 'part') {
        node.part = spec.part!;
        node.iface = partInterface(draft.doc, catalog, draft.doc.parts[spec.part!]!);
      }
      if (def.kind === 'codebox') {
        node.code = typeof spec.code === 'string' ? spec.code : CODEBOX_TEMPLATE;
        node.ports =
          spec.ports && validPorts(spec.ports)
            ? clone(spec.ports)
            : { inputs: [{ id: 'in', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] };
        if (spec.ports && !validPorts(spec.ports))
          fail(
            'bad-ports',
            'Codebox ports must be up to 16 unique ids per side, each {id, type: "signal"|"gate"}.',
          );
        if (node.code.length > MAX_CODE)
          fail('too-large', `Codebox source is limited to ${MAX_CODE} characters.`);
      }
      if (def.kind === 'comment')
        node.text = typeof spec.text === 'string' ? spec.text.slice(0, 2000) : '';
      if (spec.panel !== undefined && spec.panel !== null) {
        if (!validRect(spec.panel))
          fail('bad-panel', 'panel must be {x,y,w,h} with positive size.');
        node.panel = { ...spec.panel };
      }
      if (spec.style !== undefined && spec.style !== null) {
        const control = CONTROL_OF[spec.type];
        if (!control)
          fail('not-widget', `${def.title} is not a UI widget; only widgets have a plugin style.`);
        node.style = checkWidgetStyle(control!, spec.style, checkContext(draft));
      }
      // Values: fill defaults for every param-able input so the knob shows the effective value.
      for (const port of catalog.inputs(node)) {
        const given =
          spec.values && Object.hasOwn(spec.values, port.id) ? spec.values[port.id] : undefined;
        if (given === undefined) {
          if (port.role !== 'audio') node.values[port.id] = defaultValue(port);
          continue;
        }
        const reason = checkPortValue(port, given);
        if (reason) fail('bad-value', reason);
        node.values[port.id] = port.type === 'gate' ? Boolean(given) : given;
      }
      for (const key of Object.keys(spec.values ?? {}))
        if (!catalog.input(node, key))
          fail(
            'unknown-port',
            `${def.title} has no input "${key}".`,
            `Inputs: ${catalog
              .inputs(node)
              .map(p => p.id)
              .join(', ')}`,
          );
      if (spec.count !== undefined && spec.count !== null && spec.count !== 1)
        node.count = checkCount(catalog, node, spec.count);
      if (spec.spread !== undefined && spec.spread !== null) {
        if (typeof spec.spread !== 'object' || Array.isArray(spec.spread))
          fail('bad-spread', 'spread is {knob: {kind, amount?, seed?, values?}}.');
        const spread: Record<PortId, Spread> = {};
        for (const [port, raw] of Object.entries(spec.spread))
          spread[port] = checkedSpread(catalog, node, port, raw);
        if (Object.keys(spread).length) node.spread = spread;
      }
      draft.apply({ op: 'addNode', node });
      created.push(id);
      return;
    }
    case 'removeNode': {
      const node = requireNode(draft, intent.id);
      for (const edge of edgesOf(draft.doc, node.id).sort((a, b) => a.id.localeCompare(b.id)))
        draft.apply({ op: 'removeEdge', edge });
      leaveStack(draft, [node.id]);
      draft.apply({ op: 'removeNode', node: draft.doc.nodes[node.id]! });
      return;
    }
    case 'connect': {
      const { from, to } = intent;
      if (!from || !to) fail('bad-intent', 'connect needs from {node, port} and to {node, port}.');
      const source = requireNode(draft, from.node),
        target = requireNode(draft, to.node);
      const out = catalog.output(source, from.port);
      if (!out)
        fail(
          'unknown-port',
          `${source.id} has no output "${from.port}".`,
          `Outputs: ${
            catalog
              .outputs(source)
              .map(p => p.id)
              .join(', ') || 'none'
          }`,
        );
      const input = catalog.input(target, to.port);
      if (!input)
        fail(
          'unknown-port',
          `${target.id} has no input "${to.port}".`,
          `Inputs: ${
            catalog
              .inputs(target)
              .map(p => p.id)
              .join(', ') || 'none'
          }`,
        );
      if ((source.inside ?? null) !== (target.inside ?? null))
        fail(
          'cross-part',
          `${source.id} and ${target.id} are not in the same place (${source.inside ? `${source.id} is inside part ${source.inside}` : `${source.id} is in the main patch`}, ${target.inside ? `${target.id} inside part ${target.inside}` : `${target.id} in the main patch`}).`,
          'Cables stay inside one part: connect through an input or output of the part (kit.partIn / kit.partOut inside it).',
        );
      const existing = edgesInto(draft.doc, to.node, to.port);
      if (existing.some(e => e.from.node === from.node && e.from.port === from.port)) return; // already connected: idempotent
      if (existing.length) {
        if (!intent.replace)
          fail(
            'input-taken',
            `${to.node}.${to.port} is already connected from ${existing[0]!.from.node}.${existing[0]!.from.port}.`,
            'Disconnect it first, or use replace: true.',
          );
        for (const edge of existing) draft.apply({ op: 'removeEdge', edge });
      }
      if (createsCycle(draft.doc, from.node, to.node))
        fail(
          'cycle',
          `Connecting ${from.node} → ${to.node} would create a feedback loop.`,
          'Route the feedback through a History node (one-sample delay).',
        );
      const id = intent.id ?? nextEdgeId(draft.doc);
      if (draft.doc.edges[id]) fail('duplicate-id', `Edge id "${id}" already exists.`);
      draft.apply({
        op: 'addEdge',
        edge: {
          id,
          from: { node: from.node, port: from.port },
          to: { node: to.node, port: to.port },
        },
      });
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
      for (const edge of edgesInto(draft.doc, intent.to.node, intent.to.port))
        draft.apply({ op: 'removeEdge', edge });
      return;
    }
    case 'setValue': {
      const node = requireNode(draft, intent.node);
      const port = catalog.input(node, intent.port);
      if (!port)
        fail(
          'unknown-port',
          `${node.id} has no input "${intent.port}".`,
          `Inputs: ${catalog
            .inputs(node)
            .map(p => p.id)
            .join(', ')}`,
        );
      let value = intent.value;
      if (port.type === 'gate') {
        if (typeof value !== 'boolean' && value !== 0 && value !== 1)
          fail('bad-value', `${port.id} is a gate: use true or false.`);
        value = Boolean(value);
      } else {
        if (!finite(value)) fail('bad-value', `${port.id} must be a finite number.`);
        if (intent.clamp) value = clampPortValue(port, value);
        const reason = checkPortValue(port, value);
        if (reason) fail('out-of-range', reason);
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
      if (!c)
        fail(
          'bad-config',
          `${def.title} has no config "${intent.key}".`,
          `Config keys: ${def.config.map(x => x.id).join(', ') || 'none'}`,
        );
      const reason = checkConfigValue(c, intent.value);
      if (reason) fail('bad-config', reason);
      if (node.config[c.id] === intent.value) return;
      draft.apply({
        op: 'setConfig',
        node: node.id,
        key: c.id,
        from: node.config[c.id],
        to: intent.value,
      });
      pruneAfterPortChange(draft, node.id);
      return;
    }
    case 'setCode': {
      const node = requireNode(draft, intent.node);
      if (catalog.get(node.type).kind !== 'codebox')
        fail('not-codebox', `${node.id} is not a codebox.`);
      if (typeof intent.code !== 'string') fail('bad-intent', 'code must be a string.');
      if (intent.code.length > MAX_CODE)
        fail('too-large', `Codebox source is limited to ${MAX_CODE} characters.`);
      if (intent.ports !== undefined && !validPorts(intent.ports))
        fail(
          'bad-ports',
          'Codebox ports must be up to 16 unique ids per side, each {id, type: "signal"|"gate"}.',
        );
      if (intent.code !== node.code)
        draft.apply({
          op: 'setField',
          node: node.id,
          field: 'code',
          from: node.code,
          to: intent.code,
        });
      if (intent.ports && JSON.stringify(intent.ports) !== JSON.stringify(node.ports)) {
        draft.apply({
          op: 'setField',
          node: node.id,
          field: 'ports',
          from: node.ports,
          to: intent.ports,
        });
        pruneAfterPortChange(draft, node.id);
      }
      return;
    }
    case 'move': {
      const node = requireNode(draft, intent.node);
      if (!validXY(intent.pos)) fail('bad-value', 'pos must be {x, y} finite numbers.');
      if (node.pos.x === intent.pos.x && node.pos.y === intent.pos.y) return;
      draft.apply({
        op: 'setField',
        node: node.id,
        field: 'pos',
        from: node.pos,
        to: { x: intent.pos.x, y: intent.pos.y },
      });
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
      if (catalog.get(node.type).kind !== 'comment')
        fail('not-comment', `${node.id} is not a comment.`);
      draft.apply({
        op: 'setField',
        node: node.id,
        field: 'text',
        from: node.text,
        to: String(intent.text).slice(0, 2000),
      });
      return;
    }
    case 'setPanel': {
      const node = requireNode(draft, intent.node);
      if (intent.panel !== null && !validRect(intent.panel))
        fail('bad-panel', 'panel must be {x,y,w,h} with positive size, or null.');
      if (intent.panel !== null && catalog.get(node.type).kind !== 'widget')
        fail('not-widget', `${node.id} is not a UI widget; only widgets appear on the panel.`);
      if (intent.panel === null) leaveStack(draft, [node.id]);
      if (JSON.stringify(node.panel) === JSON.stringify(intent.panel ?? undefined)) return;
      draft.apply({
        op: 'setField',
        node: node.id,
        field: 'panel',
        from: node.panel,
        to: intent.panel ?? undefined,
      });
      return;
    }
    case 'setName': {
      if (typeof intent.name !== 'string') fail('bad-value', 'A name is text.');
      const name = intent.name.trim().slice(0, 80) || 'Untitled';
      if (name !== draft.doc.name)
        draft.apply({ op: 'setDoc', field: 'name', from: draft.doc.name, to: name });
      return;
    }
    case 'setTheme': {
      if (!THEMES.includes(intent.theme))
        fail('bad-value', `theme must be one of ${THEMES.join(', ')}.`);
      if (intent.theme !== draft.doc.panel.theme)
        draft.apply({
          op: 'setDoc',
          field: 'theme',
          from: draft.doc.panel.theme,
          to: intent.theme,
        });
      return;
    }
    case 'addElement':
      return addElement(draft, intent.element, created);
    case 'removeElement': {
      const el = requireElement(draft, intent.id);
      leaveStack(draft, [el.id]);
      draft.apply({ op: 'removeElement', element: draft.doc.ui.elements[el.id]! });
      return;
    }
    case 'updateElement':
      return updateElement(draft, intent.id, intent.set);
    case 'setRect': {
      const rect = checkRect(intent.rect);
      if (draft.doc.ui.elements[intent.id]) return updateElement(draft, intent.id, { rect });
      const node = draft.doc.nodes[intent.id];
      if (!node) fail('unknown-id', `Nothing called "${intent.id}" on the plugin.`);
      if (catalog.get(node!.type).kind !== 'widget')
        fail('not-widget', `${node!.id} is not a UI widget; only widgets appear on the plugin.`);
      if (JSON.stringify(node!.panel) === JSON.stringify(rect)) return;
      draft.apply({ op: 'setField', node: node!.id, field: 'panel', from: node!.panel, to: rect });
      return;
    }
    case 'setStyle': {
      const node = requireNode(draft, intent.node);
      const control = CONTROL_OF[node.type];
      if (!control || catalog.get(node.type).kind !== 'widget')
        fail('not-widget', `${node.id} is not a UI widget; only widgets have a plugin style.`);
      const style =
        intent.style === null
          ? undefined
          : checkWidgetStyle(control as ControlKind, intent.style, checkContext(draft));
      const to = style && Object.keys(style).length ? style : undefined;
      if (JSON.stringify(node.style) === JSON.stringify(to)) return;
      draft.apply({ op: 'setField', node: node.id, field: 'style', from: node.style, to });
      return;
    }
    case 'arrange':
      return arrange(draft, intent.ids, intent.to);
    case 'group': {
      const ids = [...new Set(intent.ids ?? [])];
      const stack = new Set(stackIds(draft));
      for (const id of ids) if (!stack.has(id)) fail('unknown-id', `"${id}" is not on the plugin.`);
      // A part's face (`<use>Face`) is a group even when it is one control.
      if (ids.length < (typeof intent.id === 'string' && intent.id.endsWith('Face') ? 1 : 2))
        fail('bad-intent', 'A group needs two or more things.');
      const id = intent.id ?? nextNodeId(draft.doc, 'group');
      if (!NODE_ID_PATTERN.test(id))
        fail('bad-id', `Group id "${id}" must match ${NODE_ID_PATTERN}.`);
      if (draft.doc.nodes[id] || draft.doc.ui.elements[id] || draft.doc.ui.groups[id])
        fail('duplicate-id', `Id "${id}" is already taken.`);
      const groups = withoutMembers(draft.doc.ui.groups, ids);
      groups[id] = ids;
      draft.apply({ op: 'setUi', field: 'groups', from: draft.doc.ui.groups, to: groups });
      created.push(id);
      return;
    }
    case 'ungroup': {
      if (!draft.doc.ui.groups[intent.id])
        fail(
          'unknown-id',
          `No group "${intent.id}".`,
          Object.keys(draft.doc.ui.groups).length
            ? `Groups: ${Object.keys(draft.doc.ui.groups).join(', ')}`
            : 'There are no groups.',
        );
      const groups = { ...draft.doc.ui.groups };
      delete groups[intent.id];
      draft.apply({ op: 'setUi', field: 'groups', from: draft.doc.ui.groups, to: groups });
      return;
    }
    case 'setLook': {
      const ctx = checkContext(draft);
      const current = draft.doc.ui.look;
      let next: Look;
      if (intent.replace) next = checkLook(intent.look, ctx);
      else {
        const patch = (intent.look ?? {}) as LookPatch;
        if (!patch || typeof patch !== 'object') fail('bad-look', 'look must be an object.');
        for (const key of Object.keys(patch))
          if (!['tokens', 'background', 'skins', 'css'].includes(key))
            fail('bad-look', `Unknown look key "${key}".`, 'Keys: tokens, background, skins, css.');
        const merged: Record<string, unknown> = {
          tokens: { ...current.tokens },
          skins: { ...current.skins },
        };
        if (current.background) merged.background = current.background;
        if (current.css !== undefined) merged.css = current.css;
        for (const [k, v] of Object.entries(patch.tokens ?? {})) {
          if (v === null) delete (merged.tokens as Record<string, unknown>)[k];
          else (merged.tokens as Record<string, unknown>)[k] = v;
        }
        for (const [k, v] of Object.entries(patch.skins ?? {})) {
          if (v === null) delete (merged.skins as Record<string, unknown>)[k];
          else (merged.skins as Record<string, unknown>)[k] = v;
        }
        if (patch.background !== undefined) {
          if (patch.background === null) delete merged.background;
          else merged.background = patch.background;
        }
        if (patch.css !== undefined) {
          if (patch.css === null) delete merged.css;
          else merged.css = patch.css;
        }
        next = checkLook(merged, ctx);
      }
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      draft.apply({ op: 'setUi', field: 'look', from: current, to: next });
      return;
    }
    case 'setPanelSize': {
      if (!finite(intent.width) || !finite(intent.height))
        fail('bad-value', 'width and height must be numbers.');
      const to = {
        width: Math.round(Math.min(4000, Math.max(120, intent.width))),
        height: Math.round(Math.min(4000, Math.max(80, intent.height))),
      };
      const from = { width: draft.doc.panel.width, height: draft.doc.panel.height };
      if (from.width === to.width && from.height === to.height) return;
      draft.apply({ op: 'setSize', from, to });
      return;
    }
    case 'addAsset': {
      const asset = checkAsset(intent.asset);
      const old = draft.doc.files[asset.id];
      const file = assetFile(asset);
      if (old) {
        if (JSON.stringify(old) === JSON.stringify(file)) return;
        fail(
          'duplicate-id',
          `There is already a file at ${asset.id}.`,
          'Give the asset another name, or remove the old one first.',
        );
      }
      checkWorkSize(draft, asset.id, file);
      draft.apply({ op: 'setFile', path: asset.id, from: undefined, to: file });
      return;
    }
    case 'updateAsset': {
      const old = assetsOf(draft.doc.files)[intent.id];
      if (!old) fail('unknown-asset', `No asset "${intent.id}".`);
      const next: Record<string, unknown> = { ...old! };
      if (intent.set?.source !== undefined) {
        if (intent.set.source === null) delete next.source;
        else next.source = intent.set.source;
      }
      if (intent.set?.name !== undefined) {
        const name = String(intent.set.name)
          .trim()
          .replace(/[^A-Za-z0-9_.@+ -]/g, '-');
        next.id = [...intent.id.split('/').slice(0, -1), name].join('/');
      }
      const asset = checkAsset(next);
      const file = assetFile(asset);
      if (asset.id === old!.id && JSON.stringify(file) === JSON.stringify(draft.doc.files[old!.id]))
        return;
      if (asset.id !== old!.id) {
        if (draft.doc.files[asset.id])
          fail('duplicate-id', `There is already a file at ${asset.id}.`, 'Choose another name.');
        draft.apply({
          op: 'setFile',
          path: old!.id,
          from: draft.doc.files[old!.id],
          to: undefined,
        });
        draft.apply({ op: 'setFile', path: asset.id, from: undefined, to: file });
        moveAssetRefs(draft, old!.id, asset.id);
      } else
        draft.apply({ op: 'setFile', path: asset.id, from: draft.doc.files[asset.id], to: file });
      return;
    }
    case 'removeAsset': {
      const old = assetsOf(draft.doc.files)[intent.id];
      if (!old) fail('unknown-asset', `No asset "${intent.id}".`);
      const uses = [
        ...(assetUses(
          draft.doc.ui,
          Object.values(draft.doc.nodes).map(
            n => [n.id, n.style] as [string, WidgetStyle | undefined],
          ),
        ).get(intent.id) ?? []),
      ];
      for (const def of Object.values(draft.doc.parts))
        if (def.face && faceAssetUses(def.face).has(intent.id)) uses.push(`${def.name}'s face`);
      if (uses.length)
        fail(
          'asset-in-use',
          `Asset "${intent.id}" is used by ${[...new Set(uses)].join(', ')}.`,
          'Remove or change those first.',
        );
      draft.apply({
        op: 'setFile',
        path: intent.id,
        from: draft.doc.files[intent.id],
        to: undefined,
      });
      return;
    }
    case 'setUnderlay': {
      let to: Underlay | undefined;
      if (intent.underlay !== null) {
        const u = intent.underlay;
        if (!u || typeof u !== 'object')
          fail('bad-intent', 'underlay is {asset, opacity, visible} or null.');
        const asset = assetsOf(draft.doc.files)[u.asset];
        if (!asset) fail('unknown-asset', `No asset "${u.asset}".`);
        if (!asset!.mime.startsWith('image/'))
          fail('bad-asset', `Asset "${u.asset}" is not a picture.`);
        to = {
          asset: u.asset,
          opacity: finite(u.opacity) ? Math.min(1, Math.max(0.05, u.opacity)) : 0.4,
          visible: u.visible !== false,
        };
      }
      if (JSON.stringify(to) === JSON.stringify(draft.doc.ui.underlay)) return;
      draft.apply({ op: 'setUi', field: 'underlay', from: draft.doc.ui.underlay, to });
      return;
    }
    case 'makePart':
      return makePart(draft, intent, created);
    case 'unpackPart':
      return unpackPart(draft, intent, created);
    case 'detachPart':
      return detachPart(draft, intent, created);
    case 'updatePart':
      return updatePart(draft, intent);
    case 'addParam':
      return addParam(draft, intent);
    case 'removeParam':
      return removeParam(draft, intent);
    case 'importPart':
      return importPart(draft, intent, created);
    case 'replacePart':
      return replacePart(draft, intent);
    case 'setCount': {
      const node = requireNode(draft, intent.node);
      const count = checkCount(catalog, node, intent.count);
      const to = count === 1 ? undefined : count;
      if (node.count === to) return;
      draft.apply({ op: 'setField', node: node.id, field: 'count', from: node.count, to });
      return;
    }
    case 'setSpread': {
      const node = requireNode(draft, intent.node);
      const next = { ...node.spread };
      if (intent.spread === null) {
        if (!catalog.input(node, intent.port))
          fail(
            'unknown-port',
            `${node.id} has no input "${intent.port}".`,
            `Inputs: ${catalog
              .inputs(node)
              .map(p => p.id)
              .join(', ')}`,
          );
        delete next[intent.port];
      } else next[intent.port] = checkedSpread(catalog, node, intent.port, intent.spread);
      const to = Object.keys(next).length ? next : undefined;
      if (JSON.stringify(to) === JSON.stringify(node.spread)) return;
      draft.apply({ op: 'setField', node: node.id, field: 'spread', from: node.spread, to });
      return;
    }
    case 'setProjectFiles': {
      if (!intent.files || typeof intent.files !== 'object' || Array.isArray(intent.files))
        fail('bad-intent', 'files maps paths to text (null deletes a file).');
      const current = draft.doc.files;
      const next: Record<string, WorkFile> = { ...current };
      for (const [path, text] of Object.entries(intent.files)) {
        const bad = checkPath(path);
        if (bad) fail('bad-file', bad);
        if (text !== null && typeof text !== 'string')
          fail('bad-file', `${path}: a file is text (or null to delete it).`);
        if (text === null) delete next[path];
        else {
          if (!isTextPath(path))
            fail('bad-file', `${path} is not a text file; add it as an asset instead.`);
          if (byteLength(text) > WORK_LIMITS.textBytes)
            fail('too-large', `${path} is larger than ${WORK_LIMITS.textBytes / 1024 / 1024} MB.`);
          next[path] = { text };
        }
      }
      if (Object.keys(next).length > WORK_LIMITS.files)
        fail('too-large', `A work holds at most ${WORK_LIMITS.files} files.`);
      if (totalBytes(next) > WORK_LIMITS.workBytes)
        fail('too-large', `A work's files hold at most ${WORK_LIMITS.workBytes / 1024 / 1024} MB.`);
      for (const path of Object.keys(intent.files).sort()) {
        const from = current[path],
          to = next[path];
        if (JSON.stringify(from) !== JSON.stringify(to))
          draft.apply({ op: 'setFile', path, from, to });
      }
      return;
    }
    case 'setBrief': {
      if (intent.brief !== null && typeof intent.brief !== 'string')
        fail('bad-intent', 'brief is text (or null to remove it).');
      const text = typeof intent.brief === 'string' ? intent.brief.trim() : '';
      if (text.length > LIMITS.brief)
        fail('too-large', `The brief is limited to ${LIMITS.brief} characters.`);
      const to = text || undefined;
      if (to === draft.doc.ui.brief) return;
      draft.apply({ op: 'setUi', field: 'brief', from: draft.doc.ui.brief, to });
      return;
    }
    default:
      fail(
        'bad-intent',
        `Unknown op "${(intent as { op?: unknown }).op}".`,
        'Valid ops: addNode, removeNode, connect, disconnect, disconnectInput, setValue, setConfig, setCode, move, setLabel, setText, setPanel, setName, setTheme, addElement, removeElement, updateElement, setRect, setStyle, arrange, group, ungroup, setLook, setPanelSize, addAsset, updateAsset, removeAsset, setUnderlay, setBrief, setProjectFiles, makePart, unpackPart, detachPart, updatePart, addParam, removeParam, importPart, replacePart, setCount, setSpread.',
      );
  }
}

// ---- copies (×N) ------------------------------------------------------------------
function checkCount(catalog: Catalog, node: PatchNode, count: unknown): number {
  const def = catalog.get(node.type);
  if (!stackable(catalog, node.type))
    fail(
      'not-stackable',
      `${def.title} cannot run as copies.`,
      'Copies (×N) work on modules, math, codeboxes, History and parts; Voice In, Voice Mix, Out, Audio In, controls and Splay stay single.',
    );
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT)
    fail('bad-value', `count must be a whole number from 1 to ${MAX_COUNT}.`);
  return count as number;
}
function checkedSpread(catalog: Catalog, node: PatchNode, portId: PortId, raw: unknown): Spread {
  if (!stackable(catalog, node.type))
    fail(
      'not-stackable',
      `${catalog.get(node.type).title} cannot run as copies, so its knobs cannot spread.`,
    );
  const port = catalog.input(node, portId);
  if (!port)
    fail(
      'unknown-port',
      `${node.id} has no input "${portId}".`,
      `Inputs: ${catalog
        .inputs(node)
        .map(p => p.id)
        .join(', ')}`,
    );
  if (!spreadable(port))
    fail(
      'not-spreadable',
      `${node.id}.${portId} cannot differ between copies.`,
      `Spreads work on numeric knobs: ${
        catalog
          .inputs(node)
          .filter(spreadable)
          .map(p => p.id)
          .join(', ') || 'this node has none'
      }.`,
    );
  const checked = checkSpread(raw, port!);
  if (typeof checked === 'string')
    fail(
      'bad-spread',
      `Spread on ${node.id}.${portId}: ${checked}.`,
      'A spread is {kind: "range"|"random"|"harmonic"|"each", amount?, seed?, values?}.',
    );
  return checked as Spread;
}

// ---- the plugin's screen ------------------------------------------------------------------
function checkContext(draft: Draft): CheckContext {
  const widgets: Record<string, true> = {};
  for (const n of Object.values(draft.doc.nodes))
    if (draft.catalog.find(n.type)?.kind === 'widget') widgets[n.id] = true;
  return { assets: assetsOf(draft.doc.files), nodes: widgets };
}
/** Widget nodes on the plugin, in patch order. */
function placedWidgets(draft: Draft): string[] {
  return Object.values(draft.doc.nodes)
    .filter(n => n.panel && draft.catalog.find(n.type)?.kind === 'widget')
    .map(n => n.id);
}
function stackIds(draft: Draft): string[] {
  return stackOrder(draft.doc.ui, placedWidgets(draft));
}
function requireElement(draft: Draft, id: unknown): UiElement {
  if (typeof id !== 'string' || !draft.doc.ui.elements[id]) {
    const known = Object.keys(draft.doc.ui.elements).sort();
    fail(
      'unknown-element',
      `No element "${String(id)}".`,
      known.length ? `Elements: ${known.join(', ')}` : 'The plugin has no decorations yet.',
    );
  }
  return draft.doc.ui.elements[id as string]!;
}
/** Groups without these ids; groups left with fewer than two members dissolve. */
function withoutMembers(groups: PluginUi['groups'], ids: readonly string[]): PluginUi['groups'] {
  const out: PluginUi['groups'] = {};
  for (const [g, members] of Object.entries(groups)) {
    const kept = members.filter(m => !ids.includes(m));
    // A group that lost members dissolves below two; a part's face (`<use>Face`) stays while anything of it is left.
    if (
      kept.length >= 2 ||
      (kept.length > 0 && (kept.length === members.length || g.endsWith('Face')))
    )
      out[g] = kept;
  }
  return out;
}
/** Something leaves the plugin: out of the stacking order and its group. */
function leaveStack(draft: Draft, ids: readonly string[]) {
  const ui = draft.doc.ui;
  if (ui.order.some(id => ids.includes(id)))
    draft.apply({
      op: 'setUi',
      field: 'order',
      from: ui.order,
      to: ui.order.filter(id => !ids.includes(id)),
    });
  if (Object.values(ui.groups).some(m => m.some(id => ids.includes(id))))
    draft.apply({
      op: 'setUi',
      field: 'groups',
      from: ui.groups,
      to: withoutMembers(ui.groups, ids),
    });
}
const ELEMENT_STEM: Record<ElementKind, string> = {
  text: 'text',
  shape: 'shape',
  image: 'image',
  svg: 'svg',
  led: 'led',
  canvas: 'canvas',
  code: 'code',
};
function addElement(draft: Draft, spec: NewElement, created: string[]) {
  if (!spec || typeof spec !== 'object')
    fail('bad-intent', 'addElement needs element {kind, rect, ...}.');
  if (Object.keys(draft.doc.ui.elements).length >= LIMITS.elements)
    fail('too-large', `A plugin holds at most ${LIMITS.elements} elements.`);
  const id =
    typeof spec.id === 'string' && spec.id
      ? spec.id
      : nextNodeId(
          draft.doc,
          ELEMENT_STEM[(spec.kind as string) === 'part' ? 'canvas' : (spec.kind as ElementKind)] ??
            'element',
        );
  if (!NODE_ID_PATTERN.test(id))
    fail(
      'bad-id',
      `Element id "${id}" must match ${NODE_ID_PATTERN} (letters/digits, starting lowercase).`,
    );
  if (draft.doc.nodes[id] || draft.doc.ui.elements[id] || draft.doc.ui.groups[id])
    fail('duplicate-id', `Id "${id}" is already taken.`);
  const element = checkElement({ ...spec, id }, checkContext(draft));
  const order = [...stackIds(draft), id];
  draft.apply({ op: 'addElement', element });
  draft.apply({ op: 'setUi', field: 'order', from: draft.doc.ui.order, to: order });
  created.push(id);
}
function updateElement(draft: Draft, id: string, set: Record<string, unknown>) {
  const old = requireElement(draft, id);
  if (!set || typeof set !== 'object')
    fail('bad-intent', 'updateElement needs set {field: value}.');
  const allowed = ELEMENT_FIELDS(old.kind);
  for (const key of Object.keys(set))
    if (!allowed.includes(key))
      fail(
        'bad-element',
        `A ${old.kind} element has no "${key}" to change.`,
        `Fields: ${allowed.join(', ')}.`,
      );
  const candidate: Record<string, unknown> = { ...old };
  for (const [key, value] of Object.entries(set)) {
    if (value === null) delete candidate[key];
    else candidate[key] = value;
  }
  const next = checkElement(candidate, checkContext(draft)) as unknown as Record<string, unknown>;
  for (const key of Object.keys(set)) {
    const from = (old as unknown as Record<string, unknown>)[key],
      to = next[key];
    if (JSON.stringify(from) !== JSON.stringify(to))
      draft.apply({ op: 'setElement', id, field: key, from, to });
  }
}
function arrange(draft: Draft, ids: readonly string[], to: Arrange) {
  if (!Array.isArray(ids) || !ids.length) fail('bad-intent', 'arrange needs the ids to move.');
  if (!['front', 'back', 'forward', 'backward'].includes(to))
    fail('bad-intent', 'arrange to: front, back, forward or backward.');
  const stack = stackIds(draft);
  for (const id of ids)
    if (!stack.includes(id)) fail('unknown-id', `"${id}" is not on the plugin.`);
  const moving = new Set(ids);
  let order: string[];
  if (to === 'front')
    order = [...stack.filter(id => !moving.has(id)), ...stack.filter(id => moving.has(id))];
  else if (to === 'back')
    order = [...stack.filter(id => moving.has(id)), ...stack.filter(id => !moving.has(id))];
  else {
    order = [...stack];
    // One step past the nearest thing not being moved, keeping the moved ones in their order.
    const up = to === 'forward';
    const indices = order.map((_, i) => i);
    for (const i of up ? indices.reverse() : indices) {
      const j = up ? i + 1 : i - 1;
      if (j < 0 || j >= order.length) continue;
      if (moving.has(order[i]!) && !moving.has(order[j]!))
        [order[i], order[j]] = [order[j]!, order[i]!];
    }
  }
  if (JSON.stringify(order) === JSON.stringify(draft.doc.ui.order)) return;
  draft.apply({ op: 'setUi', field: 'order', from: draft.doc.ui.order, to: order });
}

/** Ops that turn `prev` into `next` wholesale (loading a patch as one undoable step). */
export function replaceOps(prev: PatchDocument, next: PatchDocument): ResolvedOp[] {
  const ops: ResolvedOp[] = [
    ...Object.values(prev.parts).map(part => ({ op: 'removePart' as const, part })),
    ...Object.values(next.parts).map(part => ({ op: 'addPart' as const, part })),
    ...Object.values(prev.edges).map(edge => ({ op: 'removeEdge' as const, edge })),
    ...Object.values(prev.nodes).map(node => ({ op: 'removeNode' as const, node })),
    ...Object.values(prev.ui.elements).map(element => ({ op: 'removeElement' as const, element })),
    ...[...new Set([...Object.keys(prev.files), ...Object.keys(next.files)])]
      .sort()
      .filter(path => JSON.stringify(prev.files[path]) !== JSON.stringify(next.files[path]))
      .map(path => ({
        op: 'setFile' as const,
        path,
        from: prev.files[path],
        to: next.files[path],
      })),
    ...Object.values(next.nodes).map(node => ({ op: 'addNode' as const, node })),
    ...Object.values(next.edges).map(edge => ({ op: 'addEdge' as const, edge })),
    ...Object.values(next.ui.elements).map(element => ({ op: 'addElement' as const, element })),
  ];
  if (prev.name !== next.name)
    ops.push({ op: 'setDoc', field: 'name', from: prev.name, to: next.name });
  if (prev.panel.theme !== next.panel.theme)
    ops.push({ op: 'setDoc', field: 'theme', from: prev.panel.theme, to: next.panel.theme });
  if (prev.panel.width !== next.panel.width || prev.panel.height !== next.panel.height)
    ops.push({
      op: 'setSize',
      from: { width: prev.panel.width, height: prev.panel.height },
      to: { width: next.panel.width, height: next.panel.height },
    });
  for (const field of ['look', 'order', 'groups', 'underlay', 'brief'] as const)
    if (JSON.stringify(prev.ui[field]) !== JSON.stringify(next.ui[field]))
      ops.push({ op: 'setUi', field, from: prev.ui[field], to: next.ui[field] });
  return ops;
}

/** After ports may have changed (config/codebox), drop cables to vanished ports and fill new value defaults. */
function pruneAfterPortChange(draft: Draft, id: NodeId) {
  const node = draft.doc.nodes[id]!;
  const inputs = draft.catalog.inputs(node),
    outputs = draft.catalog.outputs(node);
  for (const edge of Object.values(draft.doc.edges).sort((a, b) => a.id.localeCompare(b.id))) {
    if (
      (edge.to.node === id && !inputs.some(p => p.id === edge.to.port)) ||
      (edge.from.node === id && !outputs.some(p => p.id === edge.from.port))
    )
      draft.apply({ op: 'removeEdge', edge });
  }
  for (const port of inputs)
    if (port.role !== 'audio' && !Object.hasOwn(node.values, port.id))
      draft.apply({
        op: 'setValue',
        node: id,
        port: port.id,
        from: undefined,
        to: defaultValue(port),
      });
  dropStaleSpreads(draft, id);
}

/** Spreads on knobs a node no longer has go. */
export function dropStaleSpreads(
  draft: { doc: PatchDocument; catalog: Catalog; apply(op: ResolvedOp): void },
  id: NodeId,
) {
  const node = draft.doc.nodes[id];
  if (!node?.spread) return;
  const inputs = draft.catalog.inputs(node);
  const keep = Object.fromEntries(
    Object.entries(node.spread).filter(([port]) => spreadable(inputs.find(p => p.id === port))),
  );
  if (Object.keys(keep).length === Object.keys(node.spread).length) return;
  draft.apply({
    op: 'setField',
    node: id,
    field: 'spread',
    from: node.spread,
    to: Object.keys(keep).length ? keep : undefined,
  });
}

function defaultStem(type: string): string {
  const name = type.split('.').pop() ?? 'node';
  const short: Record<string, string> = {
    oscillator: 'osc',
    envelope: 'env',
    voiceIn: 'voice',
    voiceMix: 'mix',
    stateVariableFilter: 'svf',
    virtualAnalogSource: 'va',
    frequencyModulation: 'fm',
    algorithmicReverb: 'reverb',
    pingPongDelay: 'pingpong',
    characterFilter: 'ladder',
    randomModulator: 'random',
    sampleAndHold: 'sh',
    curvedAdsr: 'adsr',
    musicalLfo: 'mlfo',
  };
  return short[name] ?? name;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** A work's files stay within the size limits (see files.ts). */
function checkWorkSize(draft: Draft, path: string, file: WorkFile) {
  const next = { ...draft.doc.files, [path]: file };
  if (Object.keys(next).length > WORK_LIMITS.files)
    fail('too-large', `A work holds at most ${WORK_LIMITS.files} files.`);
  if (totalBytes(next) > WORK_LIMITS.workBytes)
    fail('too-large', `A work's files hold at most ${WORK_LIMITS.workBytes / 1024 / 1024} MB.`);
}

/** Point every reference to an asset at its new path: the look, decorations, widget styles, the underlay and part faces. */
function moveAssetRefs(draft: Draft, from: string, to: string) {
  const move = (value: unknown): unknown => {
    const text = JSON.stringify(value ?? null);
    const next = text
      .split(JSON.stringify(from))
      .join(JSON.stringify(to))
      .split(`asset:${from}`)
      .join(`asset:${to}`);
    return next === text ? value : JSON.parse(next);
  };
  for (const field of ['look', 'underlay'] as const) {
    const before = draft.doc.ui[field];
    const after = move(before);
    if (after !== before) draft.apply({ op: 'setUi', field, from: before, to: after });
  }
  for (const el of Object.values(draft.doc.ui.elements))
    for (const [field, before] of Object.entries(el)) {
      const after = move(before);
      if (after !== before)
        draft.apply({ op: 'setElement', id: el.id, field, from: before, to: after });
    }
  for (const node of Object.values(draft.doc.nodes)) {
    const after = move(node.style);
    if (after !== node.style)
      draft.apply({ op: 'setField', node: node.id, field: 'style', from: node.style, to: after });
  }
  for (const part of Object.values(draft.doc.parts)) {
    const after = move(part) as PartDef;
    if (after !== part) draft.apply({ op: 'setPart', id: part.id, from: part, to: after });
  }
}

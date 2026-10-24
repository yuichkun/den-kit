// My parts: parts kept outside any one patch, so every patch can use them (the
// palette shows them next to den's modules). Saving a part again makes a new
// version; a patch keeps the contents of the version it placed, and is offered
// a newer one with what changed shown first (like a Figma library update).
// Pure data: the browser keeps the library in its storage (session.ts); files
// carry it to other machines.
import {
  NODE_ID_PATTERN,
  PART_ID_PATTERN,
  PORT_ID_PATTERN,
  clone,
  type EdgeId,
  type NodeId,
  type PartDef,
  type PartParam,
  type PartPort,
  type PatchDocument,
  type PatchEdge,
  type PatchNode,
} from './schema.ts';
import { canonicalJson, hashString } from './hash.ts';
import type { Catalog } from './catalog.ts';
import type { Issue } from './issues.ts';
import { checkFace, faceAssetUses } from './face.ts';
import {
  MAX_ASSET_BYTES,
  assetSource,
  assetsOf,
  checkAsset,
  styleAssets,
  type AssetMeta,
} from './ui.ts';
import { assetReads } from './codebox-assets.ts';
import { membersOf, partIdFor, partInterface, readParamRange } from './parts.ts';

export const LIBRARY_SCHEMA = 'den-kit/my-parts';
export const LIBRARY_VERSION = 1;
/** Versions kept per part (the newest ones). */
export const KEEP_VERSIONS = 10;
export const MAX_LIBRARY_PARTS = 200;

/** A part and everything it needs: its definition, the parts used inside it, and their nodes and cables (ids as they were in the patch). */
export interface PartBundle {
  part: PartDef;
  parts: Record<string, PartDef>;
  nodes: Record<NodeId, PatchNode>;
  edges: Record<EdgeId, PatchEdge>;
  /** The pictures and fonts its faces use (what they are; the bytes stay in this browser's store, and go inside exported files). */
  assets?: Record<string, AssetMeta>;
}
export interface MyPartVersion {
  version: number;
  savedAt: number;
  bundle: PartBundle;
}
export interface MyPart {
  id: string;
  name: string;
  doc?: string;
  versions: MyPartVersion[];
}
export interface Library {
  parts: Record<string, MyPart>;
}

export const emptyLibrary = (): Library => ({ parts: {} });
export const latest = (part: MyPart): MyPartVersion => part.versions[part.versions.length - 1]!;
export const versionOf = (part: MyPart, version: number) =>
  part.versions.find(v => v.version === version);

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The part `defId` of `doc` with all it needs (the parts used inside it too). */
export function extractBundle(doc: PatchDocument, defId: string): PartBundle {
  const root = doc.parts[defId];
  if (!root) throw new Error(`No part "${defId}".`);
  const parts: Record<string, PartDef> = {};
  const nodes: Record<NodeId, PatchNode> = {};
  const stack = [defId],
    seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !doc.parts[id]) continue;
    seen.add(id);
    if (id !== defId) {
      const def = clone(doc.parts[id]!);
      delete def.from;
      parts[id] = def;
    }
    for (const n of membersOf(doc, id)) {
      const copy = clone(n);
      delete copy.iface;
      nodes[n.id] = copy;
      if (n.type === 'kit.part' && n.part) stack.push(n.part);
    }
  }
  const edges: Record<EdgeId, PatchEdge> = {};
  for (const e of Object.values(doc.edges).sort(byId))
    if (nodes[e.from.node] && nodes[e.to.node]) edges[e.id] = clone(e);
  const part = clone(root);
  delete part.from;
  // The assets it uses: its faces' pictures and fonts, what its sound reads (a sampler's sound, a
  // codebox's assets) and what its controls' styles show.
  const files = assetsOf(doc.files);
  const used = new Set<string>();
  for (const def of [part, ...Object.values(parts)])
    if (def.face) for (const id of faceAssetUses(def.face).keys()) used.add(id);
  for (const n of Object.values(nodes)) {
    for (const value of Object.values(n.config)) if (typeof value === 'string') used.add(value);
    if (n.code) for (const id of assetReads(n.code)) used.add(id);
    for (const id of styleAssets(n.style)) used.add(id);
  }
  const assets: Record<string, AssetMeta> = {};
  for (const id of [...used].sort()) if (files[id]) assets[id] = clone(files[id]!);
  return { part, parts, nodes, edges, ...(Object.keys(assets).length ? { assets } : {}) };
}

/**
 * What a part is, whatever its ids and wherever its boxes sit: two bundles with
 * the same hash sound and behave the same. Ids are renamed in a fixed order
 * (definitions by name, nodes by place and type) so a part placed in another
 * patch (where its ids may change) still matches the version it came from.
 */
export function bundleHash(bundle: PartBundle): string {
  const defs = [
    bundle.part,
    ...Object.values(bundle.parts).sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
  ];
  const partName = new Map(defs.map((d, i) => [d.id, `p${i}`]));
  const nodeName = new Map<string, string>();
  for (const def of defs) {
    const inside = Object.values(bundle.nodes)
      .filter(n => n.inside === def.id)
      .sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.pos.x - b.pos.x ||
          a.pos.y - b.pos.y ||
          a.id.localeCompare(b.id),
      );
    inside.forEach((n, i) => nodeName.set(n.id, `${partName.get(def.id)}n${i}`));
  }
  const pn = (id: string | undefined) =>
    id === undefined ? undefined : (partName.get(id) ?? `?${id}`);
  const nn = (id: string) => nodeName.get(id) ?? `?${id}`;
  const portRefs = (list: Array<PartPort | PartParam>) =>
    list.map(p => ({ ...p, node: nn(p.node) }));
  const shape = {
    defs: defs.map(d => ({
      id: pn(d.id),
      name: d.name,
      doc: d.doc ?? null,
      inputs: portRefs(d.inputs),
      outputs: portRefs(d.outputs),
      params: portRefs(d.params),
      face: d.face ?? null,
    })),
    nodes: Object.values(bundle.nodes)
      .map(n => {
        const { pos: _p, id, inside, part, ...rest } = n;
        return { ...rest, id: nn(id), inside: pn(inside), part: pn(part) };
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: Object.values(bundle.edges)
      .map(e => `${nn(e.from.node)}.${e.from.port}>${nn(e.to.node)}.${e.to.port}`)
      .sort(),
    // Its assets by path (a placed part keeps them) and what they hold: other contents at a path are another part.
    assets: Object.values(bundle.assets ?? {})
      .map(a => `${a.id}=${assetSource(a)}`)
      .sort(),
  };
  return hashString(canonicalJson(shape));
}

export interface SaveResult {
  library: Library;
  entry: MyPart;
  version: number;
  /** What the patch's definition records: where it came from, and what it was then. */
  from: { id: string; version: number; hash: string };
  /** Nothing changed since the version it came from: no new version was made. */
  unchanged: boolean;
}

/**
 * Save part `defId` of `doc`: a new version of the My part it came from (when
 * it came from one that is still there), or a new My part.
 */
export function saveToLibrary(
  library: Library,
  doc: PatchDocument,
  defId: string,
  now = Date.now(),
): SaveResult {
  const def = doc.parts[defId];
  if (!def) throw new Error(`No part "${defId}".`);
  const bundle = extractBundle(doc, defId);
  const hash = bundleHash(bundle);
  const existing = def.from ? library.parts[def.from.id] : undefined;
  if (existing) {
    const last = latest(existing);
    if (
      last.version === def.from!.version &&
      bundleHash(last.bundle) === hash &&
      existing.name === def.name &&
      (existing.doc ?? '') === (def.doc ?? '')
    ) {
      return {
        library,
        entry: existing,
        version: last.version,
        from: { id: existing.id, version: last.version, hash },
        unchanged: true,
      };
    }
    const version = last.version + 1;
    const entry: MyPart = {
      ...existing,
      name: def.name,
      ...(def.doc ? { doc: def.doc } : {}),
      versions: [...existing.versions, { version, savedAt: now, bundle }].slice(-KEEP_VERSIONS),
    };
    if (!def.doc) delete entry.doc;
    return {
      library: { parts: { ...library.parts, [entry.id]: entry } },
      entry,
      version,
      from: { id: entry.id, version, hash },
      unchanged: false,
    };
  }
  if (Object.keys(library.parts).length >= MAX_LIBRARY_PARTS)
    throw new Error(`My parts holds at most ${MAX_LIBRARY_PARTS} parts; remove some first.`);
  const id = partIdFor({ parts: library.parts as unknown as PatchDocument['parts'] }, def.name);
  const entry: MyPart = {
    id,
    name: def.name,
    ...(def.doc ? { doc: def.doc } : {}),
    versions: [{ version: 1, savedAt: now, bundle }],
  };
  return {
    library: { parts: { ...library.parts, [id]: entry } },
    entry,
    version: 1,
    from: { id, version: 1, hash },
    unchanged: false,
  };
}

export function removeFromLibrary(library: Library, id: string): Library {
  if (!library.parts[id]) return library;
  const parts = { ...library.parts };
  delete parts[id];
  return { parts };
}

/** What a newer version changes on the outside of a part (and whether its inside changed at all). */
export interface BundleDiff {
  params: { added: string[]; removed: string[] };
  inputs: { added: string[]; removed: string[] };
  outputs: { added: string[]; removed: string[] };
  inside: boolean;
}
export function diffBundles(from: PartBundle, to: PartBundle): BundleDiff {
  const ids = (list: Array<{ id: string; label?: string }>) =>
    new Map(list.map(p => [p.id, p.label ?? p.id]));
  const side = (
    a: Array<{ id: string; label?: string }>,
    b: Array<{ id: string; label?: string }>,
  ) => {
    const x = ids(a),
      y = ids(b);
    return {
      added: [...y].filter(([id]) => !x.has(id)).map(([, l]) => l),
      removed: [...x].filter(([id]) => !y.has(id)).map(([, l]) => l),
    };
  };
  return {
    params: side(from.part.params, to.part.params),
    inputs: side(from.part.inputs, to.part.inputs),
    outputs: side(from.part.outputs, to.part.outputs),
    inside: bundleHash(from) !== bundleHash(to),
  };
}
/** "adds Rate; removes Tone" — for people. */
export function describeDiff(diff: BundleDiff): string {
  const bits: string[] = [];
  const list = (names: string[]) => names.map(n => `“${n}”`).join(', ');
  if (diff.params.added.length)
    bits.push(`adds the knob${diff.params.added.length > 1 ? 's' : ''} ${list(diff.params.added)}`);
  if (diff.params.removed.length)
    bits.push(
      `removes the knob${diff.params.removed.length > 1 ? 's' : ''} ${list(diff.params.removed)} (its values go)`,
    );
  if (diff.inputs.added.length)
    bits.push(
      `adds the input${diff.inputs.added.length > 1 ? 's' : ''} ${list(diff.inputs.added)}`,
    );
  if (diff.inputs.removed.length)
    bits.push(
      `removes the input${diff.inputs.removed.length > 1 ? 's' : ''} ${list(diff.inputs.removed)} (their cables go)`,
    );
  if (diff.outputs.added.length)
    bits.push(
      `adds the output${diff.outputs.added.length > 1 ? 's' : ''} ${list(diff.outputs.added)}`,
    );
  if (diff.outputs.removed.length)
    bits.push(
      `removes the output${diff.outputs.removed.length > 1 ? 's' : ''} ${list(diff.outputs.removed)} (their cables go)`,
    );
  if (!bits.length)
    bits.push(
      diff.inside ? 'changes what is inside; the knobs and connections stay' : 'changes nothing',
    );
  return bits.join('; ');
}

// ---- checking a bundle (from storage, a file or the AI) ----------------------------------------

/** Check a bundle: a reason when it cannot be placed, else the bundle as kept. */
export function checkBundle(raw: unknown, catalog: Catalog): PartBundle | string {
  if (!isObject(raw) || !isObject(raw.part))
    return 'a part from My parts is {part, parts, nodes, edges}';
  const readDef = (v: unknown, key?: string): PartDef | string => {
    if (
      !isObject(v) ||
      typeof v.id !== 'string' ||
      !PART_ID_PATTERN.test(v.id) ||
      (key !== undefined && key !== v.id)
    )
      return `a part definition has a bad id (${isObject(v) ? String(v.id) : 'not an object'})`;
    const ports = (list: unknown): PartPort[] | null =>
      Array.isArray(list) &&
      list.every(
        p =>
          isObject(p) &&
          typeof p.id === 'string' &&
          PORT_ID_PATTERN.test(p.id) &&
          typeof p.node === 'string',
      )
        ? list.map(p => ({ id: (p as PartPort).id, node: (p as PartPort).node }))
        : null;
    const params =
      Array.isArray(v.params) &&
      v.params.every(
        p =>
          isObject(p) &&
          typeof p.id === 'string' &&
          PORT_ID_PATTERN.test(p.id) &&
          typeof p.node === 'string' &&
          typeof p.port === 'string',
      )
        ? (v.params as PartParam[]).map(p => {
            const range = readParamRange(p.range);
            return {
              id: p.id,
              node: p.node,
              port: p.port,
              ...(typeof p.label === 'string' && p.label ? { label: p.label.slice(0, 40) } : {}),
              ...(range ? { range } : {}),
            };
          })
        : null;
    const inputs = ports(v.inputs),
      outputs = ports(v.outputs);
    if (!inputs || !outputs || !params)
      return `part ${v.id}: its inputs, outputs or parameters cannot be read`;
    const def: PartDef = {
      id: v.id,
      name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : v.id,
      inputs,
      outputs,
      params,
    };
    if (typeof v.doc === 'string' && v.doc.trim()) def.doc = v.doc.trim().slice(0, 600);
    return def;
  };
  const faces = new Map<string, unknown>();
  const root = readDef(raw.part);
  if (typeof root === 'string') return root;
  if ((raw.part as Record<string, unknown>).face !== undefined)
    faces.set(root.id, (raw.part as Record<string, unknown>).face);
  const parts: Record<string, PartDef> = {};
  if (raw.parts !== undefined && !isObject(raw.parts)) return 'parts must be an object';
  for (const [key, v] of Object.entries(raw.parts ?? {})) {
    const def = readDef(v, key);
    if (typeof def === 'string') return def;
    if (def.id === root.id) return `part ${def.id} is used inside itself`;
    if (isObject(v) && v.face !== undefined) faces.set(key, v.face);
    parts[key] = def;
  }
  const defs = new Map<string, PartDef>([[root.id, root], ...Object.entries(parts)]);
  if (!isObject(raw.nodes)) return 'nodes must be an object';
  const nodes: Record<NodeId, PatchNode> = {};
  for (const [key, v] of Object.entries(raw.nodes)) {
    if (!isObject(v) || typeof v.type !== 'string' || v.id !== key || !NODE_ID_PATTERN.test(key))
      return `node "${key}" cannot be read`;
    const def = catalog.find(v.type);
    if (!def) return `node ${key} is a "${v.type}", which this den-kit does not know`;
    if (def.kind === 'widget' || def.singleton)
      return `node ${key} (${def.title}) cannot be inside a part`;
    if (typeof v.inside !== 'string' || !defs.has(v.inside))
      return `node ${key} is not inside one of the bundle's parts`;
    if (def.kind === 'part' && (typeof v.part !== 'string' || !parts[v.part]))
      return `node ${key} uses a part the bundle does not carry`;
    if (
      !isObject(v.pos) ||
      typeof v.pos.x !== 'number' ||
      typeof v.pos.y !== 'number' ||
      !isObject(v.config) ||
      !isObject(v.values)
    )
      return `node ${key} cannot be read`;
    const node = clone(v) as unknown as PatchNode;
    delete node.iface;
    nodes[key] = node;
  }
  // No part inside itself, at any depth.
  const uses = (id: string) =>
    Object.values(nodes)
      .filter(n => n.inside === id && n.type === 'kit.part')
      .map(n => n.part!);
  for (const id of defs.keys()) {
    const seen = new Set<string>(),
      stack = uses(id);
    while (stack.length) {
      const p = stack.pop()!;
      if (p === id) return `part ${id} is used inside itself`;
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(...uses(p));
    }
  }
  for (const def of defs.values()) {
    for (const p of def.inputs)
      if (nodes[p.node]?.type !== 'kit.partIn' || nodes[p.node]!.inside !== def.id)
        return `part ${def.id}: input ${p.id} is not one of its Part input nodes`;
    for (const p of def.outputs)
      if (nodes[p.node]?.type !== 'kit.partOut' || nodes[p.node]!.inside !== def.id)
        return `part ${def.id}: output ${p.id} is not one of its Part output nodes`;
    for (const p of def.params)
      if (!nodes[p.node] || nodes[p.node]!.inside !== def.id)
        return `part ${def.id}: parameter ${p.id} points at a node that is not inside it`;
  }
  if (raw.edges !== undefined && !isObject(raw.edges)) return 'edges must be an object';
  const edges: Record<EdgeId, PatchEdge> = {};
  for (const [key, v] of Object.entries(raw.edges ?? {})) {
    if (
      !isObject(v) ||
      !isObject(v.from) ||
      !isObject(v.to) ||
      typeof v.from.node !== 'string' ||
      typeof v.to.node !== 'string' ||
      typeof v.from.port !== 'string' ||
      typeof v.to.port !== 'string'
    )
      return `cable ${key} cannot be read`;
    const a = nodes[v.from.node],
      b = nodes[v.to.node];
    if (!a || !b) return `cable ${key} joins a node the bundle does not carry`;
    if (a.inside !== b.inside) return `cable ${key} crosses the edge of a part`;
    edges[key] = {
      id: key,
      from: { node: v.from.node, port: v.from.port },
      to: { node: v.to.node, port: v.to.port },
    };
  }
  // Faces are checked against each part's parameters (pictures they use may be missing here: kept, said when the face is put on the plugin).
  const here = { nodes, edges, parts: { ...parts, [root.id]: root } } as unknown as PatchDocument;
  for (const [id, face] of faces) {
    const def = id === root.id ? root : parts[id]!;
    try {
      def.face = checkFace(face, def, partInterface(here, catalog, def).inputs, {
        assets: {},
        lenient: true,
      });
    } catch (error) {
      return `part ${id}: its face cannot be read (${error instanceof Error ? error.message : String(error)})`;
    }
  }
  // What the faces' pictures and fonts are (one that cannot be read stays behind; putting the face says so).
  const assets: Record<string, AssetMeta> = {};
  if (isObject(raw.assets))
    for (const [key, v] of Object.entries(raw.assets)) {
      try {
        const a = checkAsset(
          isObject(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'data')) : v,
        );
        if (a.id === key) assets[key] = a;
      } catch {
        /* left behind */
      }
    }
  return { part: root, parts, nodes, edges, ...(Object.keys(assets).length ? { assets } : {}) };
}

// ---- files and storage -------------------------------------------------------------------

/** My parts as JSON. With `assetData` (data: URLs by what they hold, assetSource) the parts' assets travel inside (a file for another machine). */
export function serializeLibrary(
  library: Library,
  ids?: readonly string[],
  options: { assetData?: Readonly<Record<string, string>> } = {},
): string {
  let parts = ids
    ? Object.fromEntries(ids.filter(id => library.parts[id]).map(id => [id, library.parts[id]!]))
    : library.parts;
  const data = options.assetData;
  if (data)
    parts = Object.fromEntries(
      Object.entries(parts).map(([id, entry]) => [
        id,
        {
          ...entry,
          versions: entry.versions.map(v =>
            v.bundle.assets
              ? {
                  ...v,
                  bundle: {
                    ...v.bundle,
                    assets: Object.fromEntries(
                      Object.entries(v.bundle.assets).map(([a, meta]) => [
                        a,
                        data[assetSource(meta)] ? { ...meta, data: data[assetSource(meta)] } : meta,
                      ]),
                    ),
                  },
                }
              : v,
          ),
        },
      ]),
    );
  return (
    JSON.stringify({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, parts }, null, 2) + '\n'
  );
}
/**
 * The assets the parts in `library` use, one per contents (to put inside an exported file): parts from
 * different works may hold other contents at the same path.
 */
export function libraryAssets(library: Library, ids?: readonly string[]): AssetMeta[] {
  const out = new Map<string, AssetMeta>();
  for (const entry of Object.values(library.parts))
    if (!ids || ids.includes(entry.id))
      for (const v of entry.versions)
        for (const a of Object.values(v.bundle.assets ?? {})) out.set(assetSource(a), a);
  return [...out.values()];
}
const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

/** Read My parts (from storage or a file): what can be read is kept, the rest reported. */
export function parseLibrary(
  input: string | unknown,
  catalog: Catalog,
):
  | { ok: true; library: Library; report: Issue[]; assetData: Record<string, string> }
  | { ok: false; error: string } {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      return {
        ok: false,
        error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!isObject(data) || data.schema !== LIBRARY_SCHEMA)
    return { ok: false, error: 'Not a den-kit My parts file.' };
  if (
    !Number.isInteger(data.version) ||
    (data.version as number) > LIBRARY_VERSION ||
    (data.version as number) < 1
  )
    return {
      ok: false,
      error: `This My parts file is version ${String(data.version)}; this den-kit reads version ${LIBRARY_VERSION}.`,
    };
  const report: Issue[] = [];
  const library = emptyLibrary();
  const assetData: Record<string, string> = {},
    unreadable = new Set<string>();
  for (const [key, raw] of Object.entries(isObject(data.parts) ? data.parts : {})) {
    if (!isObject(raw) || !PART_ID_PATTERN.test(key) || !Array.isArray(raw.versions)) {
      report.push({
        severity: 'warning',
        code: 'dropped-my-part',
        message: `Dropped My part "${key}": it cannot be read.`,
      });
      continue;
    }
    const versions: MyPartVersion[] = [];
    for (const v of raw.versions) {
      if (
        !isObject(v) ||
        !Number.isInteger(v.version) ||
        (v.version as number) < 1 ||
        versions.some(x => x.version === v.version)
      ) {
        report.push({
          severity: 'warning',
          code: 'dropped-version',
          message: `My part "${key}": dropped a version that cannot be read.`,
        });
        continue;
      }
      const bundle = checkBundle(v.bundle, catalog);
      if (typeof bundle === 'string') {
        report.push({
          severity: 'warning',
          code: 'dropped-version',
          message: `My part "${key}" v${v.version}: ${bundle}.`,
        });
        continue;
      }
      // Bytes a file carried for the faces' pictures (checked like a patch file's).
      for (const asset of Object.values(bundle.assets ?? {})) {
        const carried =
          isObject(v.bundle) && isObject(v.bundle.assets) && isObject(v.bundle.assets[asset.id])
            ? (v.bundle.assets[asset.id] as Record<string, unknown>).data
            : undefined;
        const contents = assetSource(asset);
        if (carried === undefined || assetData[contents] || unreadable.has(contents)) continue;
        const bytes = typeof carried === 'string' ? DATA_URL.exec(carried) : null;
        if (bytes && bytes[1] === asset.mime && bytes[2]!.length * 0.75 <= MAX_ASSET_BYTES * 1.01)
          assetData[contents] = carried as string;
        else {
          unreadable.add(contents);
          report.push({
            severity: 'warning',
            code: 'dropped-asset-data',
            message: `My part "${key}": the picture data of "${asset.name}" was unreadable; it shows as missing until added again.`,
          });
        }
      }
      versions.push({
        version: v.version as number,
        savedAt: typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0,
        bundle,
      });
    }
    if (!versions.length) {
      report.push({
        severity: 'warning',
        code: 'dropped-my-part',
        message: `Dropped My part "${key}": none of its versions can be used.`,
      });
      continue;
    }
    versions.sort((a, b) => a.version - b.version);
    const name =
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : versions.at(-1)!.bundle.part.name;
    library.parts[key] = {
      id: key,
      name,
      ...(typeof raw.doc === 'string' && raw.doc.trim()
        ? { doc: raw.doc.trim().slice(0, 600) }
        : {}),
      versions: versions.slice(-KEEP_VERSIONS),
    };
  }
  return { ok: true, library, report, assetData };
}

/** Add what a file brought: new parts as they are; versions of a part already here after its own (the same content is not added twice). */
export function mergeLibrary(
  library: Library,
  incoming: Library,
): { library: Library; added: string[]; updated: string[] } {
  const parts = { ...library.parts };
  const added: string[] = [],
    updated: string[] = [];
  for (const entry of Object.values(incoming.parts)) {
    const here = parts[entry.id];
    if (!here) {
      if (Object.keys(parts).length >= MAX_LIBRARY_PARTS) break;
      parts[entry.id] = clone(entry);
      added.push(entry.id);
      continue;
    }
    const known = new Set(here.versions.map(v => bundleHash(v.bundle)));
    let next = latest(here).version;
    const fresh = entry.versions
      .filter(v => !known.has(bundleHash(v.bundle)))
      .map(v => ({ ...clone(v), version: ++next }));
    if (!fresh.length) continue;
    parts[entry.id] = {
      ...here,
      name: entry.name,
      ...(entry.doc ? { doc: entry.doc } : {}),
      versions: [...here.versions, ...fresh].slice(-KEEP_VERSIONS),
    };
    updated.push(entry.id);
  }
  return { library: { parts }, added, updated };
}

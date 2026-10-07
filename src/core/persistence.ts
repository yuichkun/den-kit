// `.denkit.json` import/export and autosave records. Loading never trusts the
// file: unknown versions are refused, broken pieces are repaired or dropped and
// every repair is reported, so nothing disappears silently.
import type { Catalog } from './catalog.ts';
import { hashString, canonicalJson } from './hash.ts';
import type { Issue } from './issues.ts';
import { NODE_ID_PATTERN, PART_ID_PATTERN, PATCH_SCHEMA, PATCH_VERSION, PORT_ID_PATTERN, THEMES, nextNodeId, type PartDef, type PartParam, type PartPort, type PatchDocument, type PatchEdge, type PatchNode, type ThemeId } from './schema.ts';
import { applyIntents } from './ops.ts';
import { refreshInterfaces } from './part-ops.ts';
import { CONTROL_OF } from './skins.ts';
import { LIMITS, MAX_ASSET_BYTES, checkAsset, checkElement, checkLook, checkWidgetStyle, emptyUi, type CheckContext } from './ui.ts';

/** Exports carry their pictures and fonts inside, so they can be large. */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** `assetData`: the bytes of assets an exported file carried (data: URLs by asset id), for the browser's asset store. */
export type ParseResult = { ok: true; doc: PatchDocument; report: Issue[]; assetData: Record<string, string> } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The patch as JSON. With `assetData` (data: URLs by asset id) the assets travel inside the file (export). */
export function serializeDocument(doc: PatchDocument, options: { assetData?: Record<string, string> } = {}): string {
  const assets = options.assetData ? Object.fromEntries(Object.entries(doc.assets).map(([id, a]) => [id, options.assetData![id] ? { ...a, data: options.assetData![id] } : a])) : doc.assets;
  // A part's ports are worked out from its definition when the file is read.
  const nodes = Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => { if (!n.iface) return [id, n]; const { iface: _, ...rest } = n; return [id, rest]; }));
  return JSON.stringify({ ...doc, nodes, assets, schema: PATCH_SCHEMA, version: PATCH_VERSION }, null, 2) + '\n';
}

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

export function parseDocument(input: string | unknown, catalog: Catalog): ParseResult {
  let data: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > MAX_FILE_BYTES) return { ok: false, error: `File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
    try { data = JSON.parse(input); } catch (error) { return { ok: false, error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  if (!isObject(data)) return { ok: false, error: 'Not a den-kit patch (expected a JSON object).' };
  if (data.schema !== PATCH_SCHEMA) return { ok: false, error: `Not a den-kit patch (schema is ${JSON.stringify(data.schema ?? null)}).` };
  if (!Number.isInteger(data.version)) return { ok: false, error: 'Patch version is missing.' };
  if ((data.version as number) > PATCH_VERSION) return { ok: false, error: `This patch was made by a newer den-kit (version ${data.version}; this app reads up to ${PATCH_VERSION}).` };
  if ((data.version as number) < 1) return { ok: false, error: `Unknown patch version ${data.version}.` };
  const report: Issue[] = [];
  const doc: PatchDocument = {
    schema: PATCH_SCHEMA, version: PATCH_VERSION,
    id: typeof data.id === 'string' && data.id ? data.id.slice(0, 80) : `patch-${hashString(JSON.stringify(data)).slice(0, 8)}`,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 80) : 'Untitled',
    revision: Number.isInteger(data.revision) && (data.revision as number) >= 0 ? data.revision as number : 0,
    nodes: {}, edges: {},
    panel: { width: 640, height: 360, theme: 'graphite' },
    ui: emptyUi(), assets: {}, parts: {},
  };
  const assetData: Record<string, string> = {};
  // Assets first: node styles and plugin elements refer to them.
  if (isObject(data.assets)) for (const [key, raw] of Object.entries(data.assets)) {
    try {
      const asset = checkAsset(isObject(raw) ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'data')) : raw);
      if (asset.id !== key) throw new Error(`its id is "${asset.id}"`);
      doc.assets[asset.id] = asset;
      const data = isObject(raw) ? raw.data : undefined;
      const bytes = typeof data === 'string' ? DATA_URL.exec(data) : null;
      if (bytes && bytes[1] === asset.mime && bytes[2]!.length * 0.75 <= MAX_ASSET_BYTES * 1.01) assetData[asset.id] = data as string;
      else if (data !== undefined) report.push({ severity: 'warning', code: 'dropped-asset-data', message: `Asset "${key}": the file's picture data was unreadable; it shows as missing until added again.` });
    } catch (error) { report.push({ severity: 'warning', code: 'dropped-asset', message: `Dropped asset "${key}": ${error instanceof Error ? error.message : String(error)}` }); }
  }
  if (isObject(data.panel)) {
    if (finite(data.panel.width) && data.panel.width >= 200) doc.panel.width = Math.min(4000, data.panel.width);
    if (finite(data.panel.height) && data.panel.height >= 120) doc.panel.height = Math.min(4000, data.panel.height);
    if (THEMES.includes(data.panel.theme as ThemeId)) doc.panel.theme = data.panel.theme as ThemeId;
  }
  const rename = new Map<string, string>();
  const rawNodes = isObject(data.nodes) ? Object.entries(data.nodes) : Array.isArray(data.nodes) ? (data.nodes as unknown[]).map((n, i) => [String(i), n] as const) : [];
  if (data.nodes !== undefined && !rawNodes.length && !isObject(data.nodes)) report.push({ severity: 'warning', code: 'bad-nodes', message: 'nodes was not an object; no nodes loaded.' });
  for (const [key, raw] of rawNodes) {
    if (!isObject(raw) || typeof raw.type !== 'string') { report.push({ severity: 'warning', code: 'dropped-node', message: `Dropped node "${key}": missing type.` }); continue; }
    let id = typeof raw.id === 'string' ? raw.id : key;
    if (!NODE_ID_PATTERN.test(id) || doc.nodes[id]) {
      const fresh = nextNodeId(doc, raw.type.split('.').pop() ?? 'node');
      report.push({ severity: 'warning', code: 'renamed-node', node: fresh, message: `Node id "${id}" was invalid or duplicated; renamed to ${fresh}.` });
      id = fresh;
    }
    rename.set(key, id);
    if (typeof raw.id === 'string' && !rename.has(raw.id)) rename.set(raw.id, id);
    const node: PatchNode = { id, type: raw.type, pos: isObject(raw.pos) && finite(raw.pos.x) && finite(raw.pos.y) ? { x: raw.pos.x, y: raw.pos.y } : { x: 0, y: 0 }, config: {}, values: {} };
    const def = catalog.find(raw.type);
    if (!def) report.push({ severity: 'error', code: 'unknown-type', node: id, message: `Unknown block "${raw.type}"; kept as a missing block.` });
    if (typeof raw.label === 'string') node.label = raw.label.slice(0, 80);
    if (isObject(raw.config)) for (const [k, v] of Object.entries(raw.config)) {
      if (typeof v === 'string' || typeof v === 'boolean' || finite(v)) node.config[k] = v;
      else report.push({ severity: 'warning', code: 'dropped-config', node: id, message: `Dropped config ${k}: not a plain value.` });
    }
    if (isObject(raw.values)) for (const [k, v] of Object.entries(raw.values)) {
      if (typeof v === 'boolean' || finite(v)) node.values[k] = v;
      else report.push({ severity: 'warning', code: 'dropped-value', node: id, port: k, message: `Dropped value ${k}: not a finite number.` });
    }
    if (isObject(raw.panel) && finite(raw.panel.x) && finite(raw.panel.y) && finite(raw.panel.w) && finite(raw.panel.h) && raw.panel.w > 0 && raw.panel.h > 0) node.panel = { x: raw.panel.x, y: raw.panel.y, w: raw.panel.w, h: raw.panel.h };
    if (typeof raw.code === 'string') node.code = raw.code.slice(0, 64000);
    if (isObject(raw.ports) && Array.isArray(raw.ports.inputs) && Array.isArray(raw.ports.outputs)) node.ports = { inputs: raw.ports.inputs.filter(isObject).map(p => ({ id: String(p.id), type: p.type === 'gate' ? 'gate' : 'signal' })), outputs: raw.ports.outputs.filter(isObject).map(p => ({ id: String(p.id), type: p.type === 'gate' ? 'gate' : 'signal' })) };
    else if (def?.kind === 'codebox') node.ports = { inputs: [], outputs: [] };
    if (typeof raw.text === 'string') node.text = raw.text.slice(0, 2000);
    if (typeof raw.inside === 'string' && raw.inside) node.inside = raw.inside;
    if (raw.type === 'kit.part' && typeof raw.part === 'string') node.part = raw.part;
    if (raw.style !== undefined) {
      const control = CONTROL_OF[raw.type];
      try {
        if (!control) throw new Error('only widgets have a plugin style');
        node.style = checkWidgetStyle(control, raw.style, lenient(doc, report, id));
      } catch (error) { report.push({ severity: 'warning', code: 'dropped-style', node: id, message: `Dropped the look of ${id}: ${error instanceof Error ? error.message : String(error)}` }); }
    }
    if (def) {
      // Drop config keys and values the block does not know (report them). A part's inputs are known once its definition is read.
      for (const k of Object.keys(node.config)) if (!def.config.some(c => c.id === k)) { delete node.config[k]; report.push({ severity: 'warning', code: 'dropped-config', node: id, message: `Dropped unknown config "${k}".` }); }
      if (def.kind !== 'part') dropUnknownValues(node, catalog, report);
    }
    doc.nodes[id] = node;
  }
  readParts(data.parts, doc, report, rename);
  const orphans = Object.values(doc.nodes).filter(n => n.inside !== undefined && !doc.parts[n.inside]);
  for (const n of orphans) delete doc.nodes[n.id];
  if (orphans.length) report.push({ severity: 'warning', code: 'dropped-node', message: `Dropped ${orphans.length} node(s) inside a part the file does not define (${orphans.slice(0, 4).map(n => n.id).join(', ')}).` });
  refreshInterfaces(doc, catalog);
  for (const n of Object.values(doc.nodes)) if (n.type === 'kit.part') dropUnknownValues(n, catalog, report);
  const rawEdges = isObject(data.edges) ? Object.values(data.edges) : Array.isArray(data.edges) ? data.edges as unknown[] : [];
  const taken = new Set<string>();
  let counter = 0;
  for (const raw of rawEdges) {
    if (!isObject(raw) || !isObject(raw.from) || !isObject(raw.to)) { report.push({ severity: 'warning', code: 'dropped-edge', message: 'Dropped a malformed cable.' }); continue; }
    const from = rename.get(String(raw.from.node)), to = rename.get(String(raw.to.node));
    const fromPort = String(raw.from.port), toPort = String(raw.to.port);
    if (!from || !to) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${String(raw.from.node)}.${fromPort} → ${String(raw.to.node)}.${toPort}: missing node.` }); continue; }
    if (!doc.nodes[from] || !doc.nodes[to]) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${from}.${fromPort} → ${to}.${toPort}: missing node.` }); continue; }
    const source = doc.nodes[from]!, target = doc.nodes[to]!;
    if ((catalog.has(source.type) && !catalog.output(source, fromPort)) || (catalog.has(target.type) && !catalog.input(target, toPort))) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${from}.${fromPort} → ${to}.${toPort}: unknown port.` }); continue; }
    if ((source.inside ?? '') !== (target.inside ?? '')) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${from}.${fromPort} → ${to}.${toPort}: it crosses the edge of a part.` }); continue; }
    const key = `${to}.${toPort}`;
    if (taken.has(key)) { report.push({ severity: 'warning', code: 'dropped-edge', node: to, port: toPort, message: `Dropped a second cable into ${key}.` }); continue; }
    taken.add(key);
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) && !doc.edges[raw.id] ? raw.id : '';
    while (!id || doc.edges[id]) id = `e${++counter}`;
    const edge: PatchEdge = { id, from: { node: from, port: fromPort }, to: { node: to, port: toPort } };
    doc.edges[id] = edge;
  }
  if (isObject(data.panel) && (data.version as number) >= 2) {
    if (finite(data.panel.width) && data.panel.width >= 120) doc.panel.width = Math.min(4000, data.panel.width);
    if (finite(data.panel.height) && data.panel.height >= 80) doc.panel.height = Math.min(4000, data.panel.height);
  }
  if (isObject(data.ui)) readUi(data.ui, doc, report, rename);
  if (!Object.keys(doc.parts).length) return { ok: true, doc, report, assetData };
  // Parts: inputs, outputs and parameters follow what is inside; parts nothing uses are dropped (as after any edit).
  try {
    const before = new Set(Object.keys(doc.parts));
    const synced = applyIntents(doc, [], catalog).doc;
    const gone = [...before].filter(id => !synced.parts[id]);
    if (gone.length) report.push({ severity: 'info', code: 'dropped-part', message: `Dropped part(s) nothing uses: ${gone.join(', ')}.` });
    return { ok: true, doc: { ...synced, revision: doc.revision }, report, assetData };
  } catch (error) {
    return { ok: false, error: `The parts in this file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function dropUnknownValues(node: PatchNode, catalog: Catalog, report: Issue[]) {
  const ports = new Set(catalog.inputs(node).map(p => p.id));
  for (const k of Object.keys(node.values)) if (!ports.has(k)) { delete node.values[k]; report.push({ severity: 'warning', code: 'dropped-value', node: node.id, port: k, message: `Dropped value for unknown input "${k}".` }); }
}

/** Part definitions: what can be read is kept (node references follow renamed nodes), the rest reported. */
function readParts(raw: unknown, doc: PatchDocument, report: Issue[], rename: Map<string, string>) {
  if (raw === undefined) return;
  if (!isObject(raw)) { report.push({ severity: 'warning', code: 'dropped-part', message: 'parts was not an object; no parts loaded.' }); return; }
  const ref = (id: unknown) => typeof id === 'string' ? rename.get(id) ?? id : '';
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value) || !PART_ID_PATTERN.test(key)) { report.push({ severity: 'warning', code: 'dropped-part', message: `Dropped part "${key}": ${isObject(value) ? 'its id is invalid' : 'not an object'}.` }); continue; }
    const taken = new Set<string>();
    const ports = (list: unknown): PartPort[] => {
      const out: PartPort[] = [];
      if (Array.isArray(list)) for (const p of list) if (isObject(p) && typeof p.id === 'string' && PORT_ID_PATTERN.test(p.id) && !taken.has(p.id)) { taken.add(p.id); out.push({ id: p.id, node: ref(p.node) }); }
      return out;
    };
    const inputs = ports(value.inputs);
    const params: PartParam[] = [];
    if (Array.isArray(value.params)) for (const p of value.params) {
      if (!isObject(p) || typeof p.id !== 'string' || !PORT_ID_PATTERN.test(p.id) || taken.has(p.id) || typeof p.port !== 'string') { report.push({ severity: 'warning', code: 'dropped-param', message: `Part "${key}": dropped a parameter that could not be read.` }); continue; }
      taken.add(p.id);
      params.push({ id: p.id, node: ref(p.node), port: p.port, ...(typeof p.label === 'string' && p.label.trim() ? { label: p.label.trim().slice(0, 40) } : {}) });
    }
    taken.clear();
    const def: PartDef = { id: key, name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : key, inputs, outputs: ports(value.outputs), params };
    if (typeof value.doc === 'string' && value.doc.trim()) def.doc = value.doc.trim().slice(0, 600);
    if (isObject(value.from) && typeof value.from.id === 'string' && Number.isInteger(value.from.version)) def.from = { id: value.from.id.slice(0, 80), version: value.from.version as number };
    doc.parts[key] = def;
  }
}

function lenient(doc: PatchDocument, report: Issue[], node?: string): CheckContext {
  const widgets: Record<string, true> = {};
  for (const n of Object.values(doc.nodes)) if (CONTROL_OF[n.type]) widgets[n.id] = true;
  return { assets: doc.assets, nodes: widgets, lenient: true, warn: message => report.push({ severity: 'warning', code: 'missing-reference', node, message }) };
}

/** The plugin's screen: everything that can be read is kept, the rest reported. */
function readUi(raw: Record<string, unknown>, doc: PatchDocument, report: Issue[], rename: Map<string, string>) {
  const ui = doc.ui;
  const ref = (id: unknown) => typeof id === 'string' ? rename.get(id) ?? id : '';
  if (raw.look !== undefined) {
    try { ui.look = checkLook(raw.look, lenient(doc, report)); }
    catch (error) { report.push({ severity: 'warning', code: 'dropped-look', message: `Dropped the plugin's look: ${error instanceof Error ? error.message : String(error)}` }); }
  }
  if (isObject(raw.elements)) for (const [key, value] of Object.entries(raw.elements)) {
    try {
      if (!NODE_ID_PATTERN.test(key) || doc.nodes[key]) throw new Error('its id is invalid or taken by a module');
      const el = checkElement({ ...(isObject(value) ? value : {}), id: key, ...(isObject(value) && typeof value.bind === 'string' && value.bind !== '@level' ? { bind: value.bind.replace(/^[^.]+/, m => ref(m)) } : {}) }, lenient(doc, report, key));
      ui.elements[key] = el;
    } catch (error) { report.push({ severity: 'warning', code: 'dropped-element', message: `Dropped plugin element "${key}": ${error instanceof Error ? error.message : String(error)}` }); }
  }
  const exists = (id: string) => !!ui.elements[id] || !!doc.nodes[id];
  if (Array.isArray(raw.order)) ui.order = [...new Set(raw.order.map(ref).filter(exists))];
  if (isObject(raw.groups)) {
    const taken = new Set<string>();
    for (const [g, members] of Object.entries(raw.groups)) {
      if (!NODE_ID_PATTERN.test(g) || exists(g) || !Array.isArray(members)) { report.push({ severity: 'warning', code: 'dropped-group', message: `Dropped group "${g}".` }); continue; }
      const kept = [...new Set(members.map(ref).filter(id => exists(id) && !taken.has(id)))];
      if (kept.length >= 2) { ui.groups[g] = kept; for (const id of kept) taken.add(id); }
      else report.push({ severity: 'warning', code: 'dropped-group', message: `Dropped group "${g}": fewer than two of its members are on the plugin.` });
    }
  }
  if (isObject(raw.underlay) && typeof raw.underlay.asset === 'string' && doc.assets[raw.underlay.asset]) {
    ui.underlay = { asset: raw.underlay.asset, opacity: finite(raw.underlay.opacity) ? Math.min(1, Math.max(0.05, raw.underlay.opacity)) : 0.4, visible: raw.underlay.visible !== false };
  }
  if (typeof raw.brief === 'string' && raw.brief.trim()) ui.brief = raw.brief.trim().slice(0, LIMITS.brief);
}

/** Autosave record with a checksum, so a torn or corrupted write is detected on load. */
export interface SaveRecord { savedAt: number; checksum: string; text: string }

export function makeSaveRecord(doc: PatchDocument, now = Date.now()): SaveRecord {
  const text = serializeDocument(doc);
  return { savedAt: now, checksum: hashString(text), text };
}

export function readSaveRecord(record: unknown, catalog: Catalog): ParseResult {
  if (!isObject(record) || typeof record.text !== 'string' || typeof record.checksum !== 'string') return { ok: false, error: 'Autosave record is malformed.' };
  if (hashString(record.text) !== record.checksum) return { ok: false, error: 'Autosave checksum mismatch (corrupted write).' };
  return parseDocument(record.text, catalog);
}

/** Structural identity used to check export → import round trips. */
export function documentHash(doc: PatchDocument): string {
  return hashString(canonicalJson({ nodes: doc.nodes, edges: doc.edges, panel: doc.panel, name: doc.name, ui: doc.ui, assets: doc.assets, parts: doc.parts }));
}

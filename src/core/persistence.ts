// `.denkit.json` import/export and autosave records. Loading never trusts the
// file: unknown versions are refused, broken pieces are repaired or dropped and
// every repair is reported, so nothing disappears silently.
import type { Catalog } from './catalog.ts';
import { hashString, canonicalJson } from './hash.ts';
import type { Issue } from './issues.ts';
import { NODE_ID_PATTERN, PATCH_SCHEMA, PATCH_VERSION, THEMES, nextNodeId, type PatchDocument, type PatchEdge, type PatchNode, type ThemeId } from './schema.ts';
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
  return JSON.stringify({ ...doc, assets, schema: PATCH_SCHEMA, version: PATCH_VERSION }, null, 2) + '\n';
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
    ui: emptyUi(), assets: {},
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
    if (raw.style !== undefined) {
      const control = CONTROL_OF[raw.type];
      try {
        if (!control) throw new Error('only widgets have a plugin style');
        node.style = checkWidgetStyle(control, raw.style, lenient(doc, report, id));
      } catch (error) { report.push({ severity: 'warning', code: 'dropped-style', node: id, message: `Dropped the look of ${id}: ${error instanceof Error ? error.message : String(error)}` }); }
    }
    if (def) {
      // Drop config keys and values the block does not know (report them).
      for (const k of Object.keys(node.config)) if (!def.config.some(c => c.id === k)) { delete node.config[k]; report.push({ severity: 'warning', code: 'dropped-config', node: id, message: `Dropped unknown config "${k}".` }); }
      const ports = new Set(catalog.inputs(node).map(p => p.id));
      for (const k of Object.keys(node.values)) if (!ports.has(k)) { delete node.values[k]; report.push({ severity: 'warning', code: 'dropped-value', node: id, port: k, message: `Dropped value for unknown input "${k}".` }); }
    }
    doc.nodes[id] = node;
  }
  const rawEdges = isObject(data.edges) ? Object.values(data.edges) : Array.isArray(data.edges) ? data.edges as unknown[] : [];
  const taken = new Set<string>();
  let counter = 0;
  for (const raw of rawEdges) {
    if (!isObject(raw) || !isObject(raw.from) || !isObject(raw.to)) { report.push({ severity: 'warning', code: 'dropped-edge', message: 'Dropped a malformed cable.' }); continue; }
    const from = rename.get(String(raw.from.node)), to = rename.get(String(raw.to.node));
    const fromPort = String(raw.from.port), toPort = String(raw.to.port);
    if (!from || !to) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${String(raw.from.node)}.${fromPort} → ${String(raw.to.node)}.${toPort}: missing node.` }); continue; }
    const source = doc.nodes[from]!, target = doc.nodes[to]!;
    if ((catalog.has(source.type) && !catalog.output(source, fromPort)) || (catalog.has(target.type) && !catalog.input(target, toPort))) { report.push({ severity: 'warning', code: 'dropped-edge', message: `Dropped cable ${from}.${fromPort} → ${to}.${toPort}: unknown port.` }); continue; }
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
  return { ok: true, doc, report, assetData };
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
  return hashString(canonicalJson({ nodes: doc.nodes, edges: doc.edges, panel: doc.panel, name: doc.name, ui: doc.ui, assets: doc.assets }));
}

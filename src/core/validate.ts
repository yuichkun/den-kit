// Semantic validation of a whole patch. Ops already refuse most bad edits; this
// catches what can only be judged globally (scope, missing output, duplicates
// after import) and produces messages that both people and AI can act on.
import { checkConfigValue, checkPortValue, type Catalog } from './catalog.ts';
import type { Issue } from './issues.ts';
import { flatten, mapAnalysis, mapIssue, type FlattenOptions, type Flattened } from './parts.ts';
import { analyze, type Analysis } from './scope.ts';
import type { PatchDocument } from './schema.ts';

export const LIMITS = { nodes: 400, edges: 1200, voices: 16, heldNotes: 128 } as const;

export interface Validation {
  issues: Issue[];
  /** On the patch as drawn (a part counts as one node). */
  analysis: Analysis;
  /** The patch with its parts expanded, and how its ids map back. */
  flat: Flattened;
  /** The analysis of the expanded patch (what code generation uses). */
  flatAnalysis: Analysis;
}

/** Check a patch. Parts are expanded first; what is found inside them is reported on the part (with the path inside). */
export function validate(doc: PatchDocument, catalog: Catalog, options: FlattenOptions = {}): Validation {
  const flat = flatten(doc, catalog, options);
  const { issues, analysis } = validateGraph(flat.doc, catalog, flat.expanded);
  if (!flat.expanded) return { issues, analysis, flat, flatAnalysis: analysis };
  const seen = new Set<string>();
  const mapped = [...flat.issues, ...issues.map(i => mapIssue(i, flat))].filter(i => {
    const key = `${i.severity}|${i.code}|${i.node ?? ''}|${i.port ?? ''}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { issues: mapped, analysis: mapAnalysis(analysis, flat), flat, flatAnalysis: analysis };
}

function validateGraph(doc: PatchDocument, catalog: Catalog, expanded: boolean): { issues: Issue[]; analysis: Analysis } {
  const issues: Issue[] = [];
  const nodes = Object.values(doc.nodes).sort((a, b) => a.id.localeCompare(b.id));
  if (nodes.length > LIMITS.nodes) issues.push({ severity: 'error', code: 'too-many-nodes', message: expanded ? `With its parts expanded the patch has ${nodes.length} nodes; the limit is ${LIMITS.nodes} in this PoC.` : `Patches are limited to ${LIMITS.nodes} nodes in this PoC.` });
  if (Object.keys(doc.edges).length > LIMITS.edges) issues.push({ severity: 'error', code: 'too-many-edges', message: `Patches are limited to ${LIMITS.edges} cables.` });

  const counts = new Map<string, number>();
  for (const node of nodes) {
    const def = catalog.find(node.type);
    if (!def) { issues.push({ severity: 'error', code: 'unknown-type', node: node.id, message: `Unknown node type "${node.type}" (missing block). It is kept but cannot be compiled.` }); continue; }
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    for (const c of def.config) {
      if (!Object.hasOwn(node.config, c.id)) continue;
      const reason = checkConfigValue(c, node.config[c.id]);
      if (reason) issues.push({ severity: 'error', code: 'bad-config', node: node.id, message: reason });
    }
    for (const port of catalog.inputs(node)) {
      if (!Object.hasOwn(node.values, port.id)) continue;
      const reason = checkPortValue(port, node.values[port.id]);
      if (reason) issues.push({ severity: 'error', code: 'bad-value', node: node.id, port: port.id, message: reason });
    }
    if (def.kind === 'codebox' && !(node.code ?? '').trim()) issues.push({ severity: 'error', code: 'codebox-empty', node: node.id, message: 'Codebox has no code yet.' });
    if (node.type === 'kit.voiceIn') {
      const capacity = Number(node.config.capacity ?? 1), held = Number(node.config.heldCapacity ?? 16);
      if (node.config.mode === 'mono' && capacity !== 1) issues.push({ severity: 'error', code: 'bad-config', node: node.id, message: 'Mono Voice In has exactly one voice (capacity 1).' });
      if (held < capacity) issues.push({ severity: 'error', code: 'bad-config', node: node.id, message: 'heldCapacity must be at least capacity.' });
    }
  }
  for (const def of catalog.list()) if (def.singleton && (counts.get(def.type) ?? 0) > 1) issues.push({ severity: 'error', code: 'duplicate-singleton', message: `Only one ${def.title} is allowed per patch.` });

  const drivers = new Map<string, string>();
  for (const edge of Object.values(doc.edges).sort((a, b) => a.id.localeCompare(b.id))) {
    const from = doc.nodes[edge.from.node], to = doc.nodes[edge.to.node];
    if (!from || !to) { issues.push({ severity: 'error', code: 'dangling-edge', edge: edge.id, message: `Cable ${edge.id} refers to a missing node.` }); continue; }
    if (catalog.has(from.type) && !catalog.output(from, edge.from.port)) issues.push({ severity: 'error', code: 'unknown-port', edge: edge.id, node: from.id, port: edge.from.port, message: `${from.id} has no output "${edge.from.port}".` });
    if (catalog.has(to.type) && !catalog.input(to, edge.to.port)) issues.push({ severity: 'error', code: 'unknown-port', edge: edge.id, node: to.id, port: edge.to.port, message: `${to.id} has no input "${edge.to.port}".` });
    const key = `${edge.to.node}.${edge.to.port}`;
    if (drivers.has(key)) issues.push({ severity: 'error', code: 'multiple-drivers', edge: edge.id, node: to.id, port: edge.to.port, message: `${key} has more than one cable; use a Mix or Add node.` });
    drivers.set(key, edge.id);
  }

  const analysis = analyze(doc, catalog);
  issues.push(...analysis.issues);

  const outs = nodes.filter(n => n.type === 'kit.out');
  if (!outs.length && nodes.some(n => catalog.find(n.type)?.kind !== 'comment')) issues.push({ severity: 'warning', code: 'no-output', message: 'Nothing is connected to an Out node, so the patch is silent.' });
  for (const out of outs) if (!Object.values(doc.edges).some(e => e.to.node === out.id)) issues.push({ severity: 'warning', code: 'out-unconnected', node: out.id, message: 'Out has no input.' });
  for (const mix of nodes.filter(n => n.type === 'kit.voiceMix')) {
    if (!Object.values(doc.edges).some(e => e.to.node === mix.id && e.to.port === 'in')) issues.push({ severity: 'warning', code: 'mix-unconnected', node: mix.id, port: 'in', message: 'Voice Mix has no input.' });
    if (!Object.values(doc.edges).some(e => e.to.node === mix.id && e.to.port === 'done')) issues.push({ severity: 'info', code: 'mix-done-default', node: mix.id, port: 'done', message: 'Voices are freed at note-off because "done" is unconnected; connect the amp envelope\'s done to let releases ring.' });
  }
  for (const node of nodes) {
    const def = catalog.find(node.type);
    if (!def || def.kind === 'comment' || def.kind === 'widget' || analysis.live.has(node.id)) continue;
    issues.push({ severity: 'info', code: 'not-live', node: node.id, message: `${node.id} does not reach an output and is skipped.` });
  }
  return { issues, analysis };
}

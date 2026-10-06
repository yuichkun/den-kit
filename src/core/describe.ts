// Compact English description of a patch for AI context (Jev state and LLM
// tools). Deterministic and size-bounded: Jev prefers short, relevant state.
import type { Catalog } from './catalog.ts';
import { formatIssue, type Issue } from './issues.ts';
import type { Analysis } from './scope.ts';
import { edgesFrom, edgesInto, type PatchDocument } from './schema.ts';
import { validate } from './validate.ts';

const fmt = (v: unknown) => typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);

export interface DescribeOptions { maxChars?: number; selection?: readonly string[]; includeIssues?: boolean }

export function describePatch(doc: PatchDocument, catalog: Catalog, options: DescribeOptions = {}): string {
  const { issues, analysis } = validate(doc, catalog);
  const lines: string[] = [];
  const nodes = Object.values(doc.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const voice = nodes.find(n => n.type === 'kit.voiceIn');
  lines.push(`Patch "${doc.name}": ${nodes.length} nodes, ${Object.keys(doc.edges).length} cables.${voice ? ` Voice In ${voice.id}: ${voice.config.mode}, ${voice.config.mode === 'mono' ? 1 : voice.config.capacity} voice(s)${voice.config.mode === 'mono' ? `, legato ${voice.config.legato}` : ''}.` : ' No Voice In (effect or generator).'}`);
  if (options.selection?.length) lines.push(`Selected: ${options.selection.join(', ')}.`);
  for (const node of order(doc, analysis)) {
    const def = catalog.find(node.type);
    if (!def) { lines.push(`- ${node.id}: MISSING BLOCK ${node.type}`); continue; }
    if (def.kind === 'comment') { lines.push(`- ${node.id}: comment "${(node.text ?? '').slice(0, 80)}"`); continue; }
    const scope = analysis.scope.get(node.id) === 'voice' ? ' (per voice)' : '';
    const config = Object.entries(catalog.config(node)).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
    const ins: string[] = [], knobs: string[] = [];
    for (const port of catalog.inputs(node)) {
      const edge = edgesInto(doc, node.id, port.id)[0];
      if (edge) ins.push(`${port.id}←${edge.from.node}.${edge.from.port}`);
      else if (Object.hasOwn(node.values, port.id) && !port.hidden) knobs.push(`${port.id}=${fmt(node.values[port.id])}${port.unit ? port.unit : ''}`);
      else if (port.hidden && Object.hasOwn(node.values, port.id)) knobs.push(`value=${fmt(node.values[port.id])}`);
    }
    const outs = catalog.outputs(node).flatMap(port => edgesFrom(doc, node.id, port.id).map(e => `${port.id}→${e.to.node}.${e.to.port}`));
    const label = node.label ? ` "${node.label}"` : '';
    const parts = [`- ${node.id}${label}: ${def.title}${scope}`];
    if (config) parts.push(`[${config}]`);
    if (ins.length) parts.push(`in: ${ins.join(', ')}`);
    if (knobs.length) parts.push(`knobs: ${knobs.join(', ')}`);
    if (outs.length) parts.push(`out: ${outs.join(', ')}`);
    if (node.panel) parts.push('(on panel)');
    if (def.kind === 'codebox') parts.push(`code: ${(node.code ?? '').split('\n').length} lines`);
    lines.push(parts.join(' '));
  }
  if (options.includeIssues !== false) {
    const shown = issues.filter((i: Issue) => i.severity !== 'info').slice(0, 12);
    if (shown.length) { lines.push('Issues:'); for (const i of shown) lines.push(`- ${formatIssue(i)}`); }
  }
  let text = lines.join('\n');
  const max = options.maxChars ?? 12000;
  if (text.length > max) text = `${text.slice(0, max - 40)}\n… (truncated, ${nodes.length} nodes)`;
  return text;
}

/** Signal-flow order: pre-voice globals, voice nodes, post globals, then the rest. */
function order(doc: PatchDocument, analysis: Analysis) {
  const seen = new Set<string>();
  const out = [] as PatchDocument['nodes'][string][];
  for (const id of [...analysis.order.pre, ...analysis.order.voice, ...analysis.order.post, ...Object.keys(doc.nodes).sort()]) {
    if (seen.has(id) || !doc.nodes[id]) continue;
    seen.add(id); out.push(doc.nodes[id]!);
  }
  return out;
}

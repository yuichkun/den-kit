// Compact English description of a patch for LLM tools.
// Deterministic and size-bounded, to keep the request context concise.
import type { Catalog } from './catalog.ts';
import { formatCpu } from './cost.ts';
import { formatIssue, type Issue } from './issues.ts';
import { copiesOf, describeSpread } from './stacks.ts';
import { describeFace } from './face.ts';
import type { Analysis } from './scope.ts';
import { edgesFrom, edgesInto, type PartDef, type PatchDocument } from './schema.ts';
import { validate } from './validate.ts';

const fmt = (v: unknown) => typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);

export interface DescribeOptions { maxChars?: number; selection?: readonly string[]; includeIssues?: boolean }

export function describePatch(doc: PatchDocument, catalog: Catalog, options: DescribeOptions = {}): string {
  const { issues, analysis, flat, flatAnalysis, cost } = validate(doc, catalog);
  const lines: string[] = [];
  const all = Object.values(doc.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const nodes = all.filter(n => n.inside === undefined);
  const voice = nodes.find(n => n.type === 'kit.voiceIn');
  const parts = Object.values(doc.parts).sort((a, b) => a.id.localeCompare(b.id));
  lines.push(`Patch "${doc.name}": ${nodes.length} nodes, ${Object.values(doc.edges).filter(e => !doc.nodes[e.from.node]?.inside).length} cables${parts.length ? `, ${parts.length} part${parts.length === 1 ? '' : 's'} (listed after the main patch)` : ''}.${voice ? ` Voice In ${voice.id}: ${voice.config.mode}, ${voice.config.mode === 'mono' ? 1 : voice.config.capacity} voice(s)${voice.config.mode === 'mono' ? `, legato ${voice.config.legato}` : ''}.` : ' No Voice In (effect or generator).'}`);
  const stacked = Object.values(doc.nodes).some(n => copiesOf(catalog, n) > 1);
  lines.push(`Estimated load: ${formatCpu(cost.cpu)} of one core, ${Math.round(cost.kB)} kB of code.${stacked ? ' ×N nodes run as N copies; their outputs carry one signal per copy (a thick cable).' : ''}`);
  if (options.selection?.length) lines.push(`Selected: ${options.selection.join(', ')}.`);
  // Inside parts, a node runs per voice when any use of it does.
  const voiced = new Set<string>();
  for (const [id, path] of Object.entries(flat.origin)) if (flatAnalysis.scope.get(id) === 'voice') voiced.add(path.at(-1)!);
  const line = (node: PatchDocument['nodes'][string], indent = '') => {
    const def = catalog.find(node.type);
    if (!def) return `${indent}- ${node.id}: MISSING BLOCK ${node.type}`;
    if (def.kind === 'comment') return `${indent}- ${node.id}: comment "${(node.text ?? '').slice(0, 80)}"`;
    const part = node.part ? doc.parts[node.part] : undefined;
    const title = def.kind === 'part' ? (part ? `Part "${part.name}" (part ${part.id})` : `MISSING PART ${node.part}`) : def.kind === 'partIn' || def.kind === 'partOut' ? `${def.title} "${portName(doc, node)}"` : def.title;
    const scope = (node.inside === undefined ? analysis.scope.get(node.id) === 'voice' : voiced.has(node.id)) ? ' (per voice)' : '';
    const count = copiesOf(catalog, node);
    const config = Object.entries(catalog.config(node)).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
    const ins: string[] = [], knobs: string[] = [];
    for (const port of catalog.inputs(node)) {
      const edge = edgesInto(doc, node.id, port.id)[0];
      if (edge) ins.push(`${port.id}←${edge.from.node}.${edge.from.port}`);
      else if (Object.hasOwn(node.values, port.id) && !port.hidden) {
        const param = node.inside ? doc.parts[node.inside]?.params.find(p => p.node === node.id && p.port === port.id) : undefined;
        const spread = count > 1 ? node.spread?.[port.id] : undefined;
        knobs.push(`${port.id}=${fmt(node.values[port.id])}${port.unit ? port.unit : ''}${spread ? ` (copies spread: ${describeSpread(spread, port)})` : ''}${param ? ` (the part's parameter ${param.id}: each use sets its own)` : ''}`);
      }
      else if (port.hidden && Object.hasOwn(node.values, port.id)) knobs.push(`value=${fmt(node.values[port.id])}`);
    }
    const outs = catalog.outputs(node).flatMap(port => edgesFrom(doc, node.id, port.id).map(e => `${port.id}→${e.to.node}.${e.to.port}`));
    const label = node.label ? ` "${node.label}"` : '';
    const bits = [`${indent}- ${node.id}${label}: ${title}${count > 1 ? ` ×${count}` : ''}${scope}`];
    if (config) bits.push(`[${config}]`);
    if (ins.length) bits.push(`in: ${ins.join(', ')}`);
    if (knobs.length) bits.push(`knobs: ${knobs.join(', ')}`);
    if (outs.length) bits.push(`out: ${outs.join(', ')}`);
    if (node.panel) bits.push('(on panel)');
    if (def.kind === 'codebox') bits.push(`code: ${(node.code ?? '').split('\n').length} lines`);
    return bits.join(' ');
  };
  for (const node of order(doc, analysis)) if (node.inside === undefined) lines.push(line(node));
  // A part's face is described from its first use's ports (every use shows the same).
  const faceText = (part: PartDef) => { const use = all.find(n => n.type === 'kit.part' && n.part === part.id); return describeFace(part, use ? catalog.inputs(use) : []); };
  for (const part of parts) {
    const uses = all.filter(n => n.type === 'kit.part' && n.part === part.id).map(n => n.inside ? `${n.id} (inside ${n.inside})` : n.id);
    const params = part.params.map(p => `${p.id}=${p.node}.${p.port}${p.label ? ` "${p.label}"` : ''}${p.range ? ` (${p.range.min}–${p.range.max}${p.range.unit ? ` ${p.range.unit}` : ''}${p.range.scale === 'log' ? ', log' : ''})` : ''}`);
    lines.push(`Part ${part.id} "${part.name}"${part.from ? ` (from My parts: ${part.from.id} v${part.from.version})` : ''}${part.doc ? ` — ${part.doc}` : ''}. Used by: ${uses.join(', ') || 'nothing'}. Inputs: ${part.inputs.map(p => `${p.id} (${p.node})`).join(', ') || 'none'}. Parameters: ${params.join(', ') || 'none'}. Outputs: ${part.outputs.map(p => `${p.id} (${p.node})`).join(', ') || 'none'}. Face: ${faceText(part)}. Inside (nodes with inside: "${part.id}"):`);
    for (const node of all.filter(n => n.inside === part.id)) lines.push(line(node, '  '));
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

/** The port a part's input or output node carries. */
function portName(doc: PatchDocument, node: PatchDocument['nodes'][string]): string {
  const part = node.inside ? doc.parts[node.inside] : undefined;
  return [...(part?.inputs ?? []), ...(part?.outputs ?? [])].find(p => p.node === node.id)?.id ?? '?';
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

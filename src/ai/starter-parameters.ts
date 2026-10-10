// Choose knobs for a starter's initial plugin screen. This is used by the
// manual preset menu, without interpreting prompts or changing parameter values.
import type { Catalog, Category } from '../core/catalog.ts';
import { edgesFrom, edgesInto, type PatchDocument, type PatchNode } from '../core/schema.ts';

interface Parameter {
  roles: string[];
  prefer?: Category[];
  ampEnvelope?: boolean;
  where?: (doc: PatchDocument, node: PatchNode, catalog: Catalog) => boolean;
}

const parameters: Record<string, Parameter> = {
  brightness: { roles: ['brightness'], prefer: ['modulation', 'filter', 'fx'] },
  resonance: { roles: ['resonance'], prefer: ['filter'] },
  attack: { roles: ['attack'], prefer: ['envelope', 'dynamics'], ampEnvelope: true },
  release: { roles: ['release'], prefer: ['envelope', 'dynamics'], ampEnvelope: true },
  wobble: {
    roles: ['depth'],
    where: (doc, node, catalog) => Object.values(doc.edges).some(e =>
      e.to.node === node.id && catalog.find(doc.nodes[e.from.node]?.type ?? '')?.category === 'modulation'
      && !['kit.cutoffMod', 'kit.pitchMod'].includes(doc.nodes[e.from.node]!.type))
      || ['kit.tremolo', 'den.flanger'].includes(node.type),
  },
  mix: { roles: ['mix'], prefer: ['fx'], where: (_doc, node, catalog) => catalog.find(node.type)?.category === 'fx' },
  volume: { roles: ['volume'] },
};

export function starterParameter(doc: PatchDocument, catalog: Catalog, id: string): { node: string; port: string } | undefined {
  const parameter = parameters[id];
  if (!parameter) return undefined;
  const options: Array<{ node: string; port: string; score: number }> = [];
  for (const node of Object.values(doc.nodes)) {
    const def = catalog.find(node.type);
    if (!def || def.kind === 'widget' || def.kind === 'comment' || node.type.startsWith('ui.')) continue;
    if (parameter.where && !parameter.where(doc, node, catalog)) continue;
    for (const port of catalog.inputs(node)) {
      if (port.type !== 'signal' || port.hidden || port.constant || port.role === 'audio' || port.binding) continue;
      if (!port.roles?.some(role => parameter.roles.includes(role)) || edgesInto(doc, node.id, port.id).length) continue;
      const preference = parameter.prefer?.indexOf(def.category) ?? -1;
      let score = preference >= 0 ? 10 - preference : 0;
      if (parameter.ampEnvelope && def.category === 'envelope') {
        if (/amp/i.test(node.label ?? '') || edgesFrom(doc, node.id, 'done').some(e => doc.nodes[e.to.node]?.type === 'kit.voiceMix')) score += 5;
      }
      if (id === 'volume' && Object.values(doc.edges).some(e => e.from.node === node.id && doc.nodes[e.to.node]?.type === 'kit.out')) score += 5;
      options.push({ node: node.id, port: port.id, score });
    }
  }
  const best = options.sort((a, b) => b.score - a.score || a.node.localeCompare(b.node) || a.port.localeCompare(b.port))[0];
  return best ? { node: best.node, port: best.port } : undefined;
}

// Where a work uses an asset: its look, the screen's elements and the controls' styles, nodes'
// settings, what codeboxes read, and the faces of the parts in use. What is inside a part nothing
// uses any more (there until its transaction ends) does not count.
import { assetReads } from './codebox-assets.ts';
import { faceAssetUses } from './face.ts';
import { usedParts } from './parts.ts';
import type { PatchDocument } from './schema.ts';
import { assetUses, type WidgetStyle } from './ui.ts';

/** Where `doc` uses the asset at `path`, in words; the face of part `skip` is left out. */
export function usesOfAsset(doc: PatchDocument, path: string, skip?: string): string[] {
  const used = usedParts(doc);
  const nodes = Object.values(doc.nodes).filter(n => n.inside === undefined || used.has(n.inside));
  const uses = [
    ...(assetUses(
      doc.ui,
      nodes.map(n => [n.id, n.style] as [string, WidgetStyle | undefined]),
    ).get(path) ?? []),
  ];
  for (const def of Object.values(doc.parts))
    if (def.id !== skip && used.has(def.id) && def.face && faceAssetUses(def.face).has(path))
      uses.push(`${def.name}'s face`);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.config))
      if (value === path) uses.push(`${node.id}'s ${key}`);
    if (node.code && assetReads(node.code).has(path)) uses.push(`${node.id}'s code`);
  }
  return [...new Set(uses)];
}

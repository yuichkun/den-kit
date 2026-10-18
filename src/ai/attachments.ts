// What the person points at when they ask: the selected modules, controls,
// cables and things on the plugin screen ride along with the request
// ("this one is too bright"). The AI panel shows them above the prompt; the
// LLM gets them by id with a few words each.
import type { Catalog } from '../core/catalog.ts';
import type { PatchDocument } from '../core/schema.ts';

export type AttachmentKind = 'module' | 'control' | 'element' | 'cable';
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  label: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The things with these ids that exist (modules and controls, plugin elements, cables), in the given order. */
export function attachmentsOf(
  doc: PatchDocument,
  catalog: Catalog,
  ids: readonly string[],
  edgeIds: readonly string[] = [],
): Attachment[] {
  const out: Attachment[] = [];
  for (const id of new Set(ids)) {
    const node = doc.nodes[id];
    if (node) {
      const def = catalog.find(node.type);
      const part = node.type === 'kit.part' && node.part ? doc.parts[node.part] : undefined;
      const title = part ? `Part “${clip(part.name, 24)}”` : (def?.title ?? node.type);
      out.push({
        id,
        kind: def?.kind === 'widget' ? 'control' : 'module',
        label: `${title}${node.label ? ` “${clip(node.label, 24)}”` : ''}`,
      });
      continue;
    }
    const el = doc.ui.elements[id] as { kind: string; text?: string; name?: string } | undefined;
    if (el)
      out.push({
        id,
        kind: 'element',
        label: `${el.kind}${typeof el.text === 'string' ? ` “${clip(el.text, 24)}”` : typeof el.name === 'string' ? ` ${clip(el.name, 24)}` : ''}`,
      });
  }
  // A cable that touches an attached module comes along with it (a box selection takes those too); only a cable picked on its own is a thing of its own.
  const modules = new Set(out.map(a => a.id));
  for (const id of new Set(edgeIds)) {
    const e = doc.edges[id];
    if (e && !modules.has(e.from.node) && !modules.has(e.to.node))
      out.push({
        id,
        kind: 'cable',
        label: `${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}`,
      });
  }
  return out;
}

/** The attachments as the LLM reads them (one line each, with what kind of thing it is). */
export function describeAttachments(attached: readonly Attachment[]): string {
  return attached
    .map(
      a =>
        `${a.id} — ${a.kind === 'cable' ? `cable ${a.label}` : a.kind === 'element' ? `${a.label} on the plugin screen` : a.kind === 'control' ? `${a.label} (a control)` : a.label}`,
    )
    .join('; ');
}

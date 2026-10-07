// Copy, paste and duplicate for the selection: the same in the patch and in the
// plugin view (a widget is a module there too; decorations are the plugin's
// own). Cables between copied modules come along, so do groups copied whole and
// lamps or readouts pointing at a copied control; pasted things shift a little
// so they do not hide the originals.
import type { Intent } from '../core/ops.ts';
import { nextNodeId, type PatchDocument, type PatchNode } from '../core/schema.ts';
import type { UiElement } from '../core/ui.ts';
import type { KitSession } from './session.ts';

let clipboard: { nodes: PatchNode[]; edges: PatchDocument['edges'][string][]; elements: UiElement[]; groups: string[][] } | null = null;

export function copySelection(session: KitSession): boolean {
  const doc = session.doc.value, picked = new Set(session.selection.value);
  const ids = new Set([...picked].filter(id => doc.nodes[id]));
  const elements = [...picked].map(id => doc.ui.elements[id]).filter((e): e is UiElement => !!e);
  if (!ids.size && !elements.length) return false;
  clipboard = {
    nodes: [...ids].map(id => doc.nodes[id]!),
    edges: Object.values(doc.edges).filter(e => ids.has(e.from.node) && ids.has(e.to.node)),
    elements,
    groups: Object.values(doc.ui.groups).filter(m => m.every(id => picked.has(id))),
  };
  return true;
}

/** Paste what was copied; the new things become the selection. */
export function paste(session: KitSession): boolean {
  if (!clipboard) return false;
  const doc = session.doc.value;
  const rename = new Map<string, string>();
  const intents: Intent[] = [];
  const taken = new Set([...Object.keys(doc.nodes), ...Object.keys(doc.ui.elements), ...Object.keys(doc.ui.groups)]);
  const fresh = (old: string) => { const id = nextNodeId(doc, old.replace(/\d+$/, '') || 'node', taken); taken.add(id); rename.set(old, id); return id; };
  for (const n of clipboard.nodes) {
    if (session.catalog.find(n.type)?.singleton) continue;
    const id = fresh(n.id);
    intents.push({ op: 'addNode', node: { ...n, id, pos: { x: n.pos.x + 40, y: n.pos.y + 40 }, panel: n.panel ? { ...n.panel, x: n.panel.x + 20, y: n.panel.y + 20 } : undefined } });
  }
  for (const e of clipboard.edges) if (rename.has(e.from.node) && rename.has(e.to.node)) intents.push({ op: 'connect', from: { node: rename.get(e.from.node)!, port: e.from.port }, to: { node: rename.get(e.to.node)!, port: e.to.port } });
  for (const el of clipboard.elements) {
    const id = fresh(el.id);
    const bound = 'bind' in el && el.bind ? { bind: el.bind.replace(/^[^.@]+/, m => rename.get(m) ?? m) } : {};
    intents.push({ op: 'addElement', element: { ...el, ...bound, id, rect: { ...el.rect, x: el.rect.x + 20, y: el.rect.y + 20 } } as never });
  }
  for (const members of clipboard.groups) { const ids = members.map(m => rename.get(m)).filter((m): m is string => !!m); if (ids.length >= 2) intents.push({ op: 'group', ids }); }
  if (!intents.length) return false;
  const r = session.commit(intents, { label: 'Paste' });
  if (!r.ok) { session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`); return false; }
  session.select([...rename.values()]);
  return true;
}

export function duplicate(session: KitSession): boolean { return copySelection(session) && paste(session); }

/** Keys that should not trigger editor shortcuts: typing in a field. */
export const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

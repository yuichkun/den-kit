// Copy, paste and duplicate for the selected modules: the same in the patch and
// in the plugin view (a widget is a module there too). Cables between copied
// modules come along; pasted modules (and their places on the plugin) shift a
// little so they do not hide the originals.
import type { Intent } from '../core/ops.ts';
import type { PatchDocument, PatchNode } from '../core/schema.ts';
import type { KitSession } from './session.ts';

let clipboard: { nodes: PatchNode[]; edges: PatchDocument['edges'][string][] } | null = null;

export function copySelection(session: KitSession): boolean {
  const doc = session.doc.value, ids = new Set(session.selection.value.filter(id => doc.nodes[id]));
  if (!ids.size) return false;
  clipboard = { nodes: [...ids].map(id => doc.nodes[id]!), edges: Object.values(doc.edges).filter(e => ids.has(e.from.node) && ids.has(e.to.node)) };
  return true;
}

/** Paste what was copied; the new modules become the selection. */
export function paste(session: KitSession): boolean {
  if (!clipboard) return false;
  const doc = session.doc.value;
  const rename = new Map<string, string>();
  const intents: Intent[] = [];
  const taken = new Set(Object.keys(doc.nodes));
  for (const n of clipboard.nodes) {
    if (session.catalog.find(n.type)?.singleton) continue;
    const stem = n.id.replace(/\d+$/, '') || 'node';
    let k = 1; while (taken.has(`${stem}${k}`)) k++;
    const id = `${stem}${k}`; taken.add(id); rename.set(n.id, id);
    intents.push({ op: 'addNode', node: { ...n, id, pos: { x: n.pos.x + 40, y: n.pos.y + 40 }, panel: n.panel ? { ...n.panel, x: n.panel.x + 20, y: n.panel.y + 20 } : undefined } });
  }
  for (const e of clipboard.edges) if (rename.has(e.from.node) && rename.has(e.to.node)) intents.push({ op: 'connect', from: { node: rename.get(e.from.node)!, port: e.from.port }, to: { node: rename.get(e.to.node)!, port: e.to.port } });
  if (!intents.length) return false;
  const r = session.commit(intents, { label: 'Paste' });
  if (!r.ok) { session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`); return false; }
  session.select([...rename.values()]);
  return true;
}

export function duplicate(session: KitSession): boolean { return copySelection(session) && paste(session); }

/** Keys that should not trigger editor shortcuts: typing in a field. */
export const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

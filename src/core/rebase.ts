// Carry an LLM draft over to the live patch. The LLM edits a copy taken when
// its turn started (base → draft) while the user keeps playing and editing the
// live patch. Every change is checked three ways, element by element:
//   live still equals base  → apply the LLM's change
//   live already equals it  → nothing to do
//   live changed otherwise  → conflict: the user's version wins, the change is reported
// The result is a list of ordinary intents, committed as one undoable step.
import type { Catalog } from './catalog.ts';
import { applyIntents, diffDocuments, OpError, type Intent, type ResolvedOp } from './ops.ts';
import { nextNodeId, type PatchDocument, type PatchEdge, type PortRef } from './schema.ts';

export interface Conflict { what: string; reason: string }
export interface RebaseResult {
  intents: Intent[];
  conflicts: Conflict[];
  /** Draft node ids that had to be renamed because the user used the same id meanwhile. */
  idMap: Record<string, string>;
  /** How many LLM changes made it (changes already present count as made). */
  applied: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameEnds = (a: Pick<PatchEdge, 'from' | 'to'>, b: Pick<PatchEdge, 'from' | 'to'>) => a.from.node === b.from.node && a.from.port === b.from.port && a.to.node === b.to.node && a.to.port === b.to.port;

export function rebase(base: PatchDocument, draft: PatchDocument, live: PatchDocument, catalog: Catalog): RebaseResult {
  const ops = diffDocuments(base, draft);
  const conflicts: Conflict[] = [];
  const idMap: Record<string, string> = {};
  const taken = new Set<string>();
  const intents: Intent[] = [];
  const describe: string[] = []; // parallel to intents, for conflict messages
  let applied = 0;
  const push = (intent: Intent, what: string) => { intents.push(intent); describe.push(what); };
  const map = (id: string) => idMap[id] ?? id;
  const mapRef = (r: PortRef): PortRef => ({ node: map(r.node), port: r.port });
  const label = (id: string) => draft.nodes[id]?.label ?? live.nodes[id]?.label ?? id;

  // New node ids the user took meanwhile get a fresh id (edges follow).
  for (const op of ops) {
    if (op.op !== 'addNode') continue;
    if (live.nodes[op.node.id] || taken.has(op.node.id)) {
      const fresh = nextNodeId({ nodes: { ...live.nodes, ...draft.nodes } }, op.node.id.replace(/\d+$/, ''), taken);
      idMap[op.node.id] = fresh;
      taken.add(fresh);
    } else taken.add(op.node.id);
  }

  for (const op of ops) {
    switch (op.op) {
      case 'removeEdge': {
        const current = Object.values(live.edges).find(e => sameEnds(e, op.edge));
        if (current) push({ op: 'disconnect', id: current.id }, `remove cable ${op.edge.from.node} → ${op.edge.to.node}`);
        else applied++; // already gone
        break;
      }
      case 'removeNode': {
        const now = live.nodes[op.node.id];
        if (!now) { applied++; break; }
        if (!same({ ...now, pos: null }, { ...op.node, pos: null })) { conflicts.push({ what: `remove ${label(op.node.id)}`, reason: 'you changed that module meanwhile' }); break; }
        push({ op: 'removeNode', id: op.node.id }, `remove ${label(op.node.id)}`);
        break;
      }
      case 'addNode': {
        const node = { ...op.node, id: map(op.node.id) };
        push({ op: 'addNode', node }, `add ${node.label ?? catalog.find(node.type)?.title ?? node.type}`);
        break;
      }
      case 'setValue': case 'setConfig': case 'setField': {
        const now = live.nodes[op.node];
        const what = op.op === 'setValue' ? `${label(op.node)}.${op.port}` : op.op === 'setConfig' ? `${label(op.node)} ${op.key}` : `${label(op.node)} ${op.field}`;
        if (!now) { conflicts.push({ what, reason: 'you removed that module meanwhile' }); break; }
        const current = op.op === 'setValue' ? now.values[op.port] : op.op === 'setConfig' ? now.config[op.key] : (now as unknown as Record<string, unknown>)[op.field];
        if (same(current, op.to)) { applied++; break; }
        if (!same(current, op.from)) {
          // A moved module is not worth reporting; anything else is.
          if (!(op.op === 'setField' && op.field === 'pos')) conflicts.push({ what, reason: 'you changed it too; your version was kept' });
          break;
        }
        if (op.op === 'setField' && op.field === 'ports') {
          // Ports travel with the code; a ports-only change re-sends the live code with the new ports.
          if (!ops.some(o => o.op === 'setField' && o.node === op.node && o.field === 'code')) push({ op: 'setCode', node: op.node, code: now.code ?? '', ports: draft.nodes[op.node]?.ports }, what);
          break;
        }
        if (op.op === 'setField' && op.field === 'code') { push({ op: 'setCode', node: op.node, code: String(op.to ?? ''), ports: draft.nodes[op.node]?.ports }, what); break; }
        const intent = toIntent(op);
        if (intent) push(intent, what);
        break;
      }
      case 'addEdge': {
        const edge = { from: mapRef(op.edge.from), to: mapRef(op.edge.to) };
        if (Object.values(live.edges).some(e => sameEnds(e, edge))) { applied++; break; }
        const occupant = Object.values(live.edges).find(e => e.to.node === edge.to.node && e.to.port === edge.to.port);
        // The LLM may replace a cable that was there when it started (and that it removed);
        // a cable the user plugged in meanwhile wins.
        const replace = !!occupant && !!base.edges[occupant.id] && sameEnds(base.edges[occupant.id]!, occupant) && !Object.values(draft.edges).some(e => sameEnds(e, occupant));
        if (occupant && !replace && !intents.some(i => i.op === 'disconnect' && i.id === occupant.id)) { conflicts.push({ what: `cable ${edge.from.node} → ${edge.to.node}.${edge.to.port}`, reason: 'you connected something else there meanwhile' }); break; }
        push({ op: 'connect', from: edge.from, to: edge.to, replace: replace || undefined }, `cable ${edge.from.node} → ${edge.to.node}.${edge.to.port}`);
        break;
      }
      case 'setDoc': {
        const current = op.field === 'name' ? live.name : live.panel.theme;
        if (current === op.to) { applied++; break; }
        if (current !== op.from) { conflicts.push({ what: `patch ${op.field}`, reason: 'you changed it too; your version was kept' }); break; }
        push(op.field === 'name' ? { op: 'setName', name: op.to } : { op: 'setTheme', theme: op.to as never }, `patch ${op.field}`);
        break;
      }
    }
  }

  // Dry-run on the live patch: anything that still does not fit (a cable to a
  // module the user deleted, a cycle the user's edits would create…) is dropped
  // and reported, the rest goes through.
  for (let guard = 0; guard < intents.length + 1; guard++) {
    try { applyIntents(live, intents, catalog); break; }
    catch (error) {
      if (!(error instanceof OpError) || error.index < 0 || error.index >= intents.length) throw error;
      conflicts.push({ what: describe[error.index]!, reason: error.message });
      intents.splice(error.index, 1);
      describe.splice(error.index, 1);
    }
  }
  return { intents, conflicts, idMap, applied: applied + intents.length };
}

function toIntent(op: ResolvedOp): Intent | null {
  switch (op.op) {
    case 'setValue': return op.to === undefined ? null : { op: 'setValue', node: op.node, port: op.port, value: op.to, clamp: true };
    case 'setConfig': return op.to === undefined ? null : { op: 'setConfig', node: op.node, key: op.key, value: op.to };
    case 'setField':
      switch (op.field) {
        case 'pos': return op.to ? { op: 'move', node: op.node, pos: op.to as never } : null;
        case 'label': return { op: 'setLabel', node: op.node, label: (op.to as string | undefined) ?? null };
        case 'panel': return { op: 'setPanel', node: op.node, panel: (op.to as never) ?? null };
        case 'text': return { op: 'setText', node: op.node, text: String(op.to ?? '') };
        default: return null; // code and ports are handled together above
      }
    default: return null;
  }
}

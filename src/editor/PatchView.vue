<script setup lang="ts">
// Patch canvas (Vue Flow). The document is the source of truth: Vue Flow only
// renders it; every user gesture becomes a session.commit() intent.
import { computed, nextTick, ref, watch } from 'vue';
import { VueFlow, useVueFlow, type Connection, type NodeDragEvent, type NodeChange, type EdgeChange } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { createsCycle } from '../core/scope.ts';
import type { Intent } from '../core/ops.ts';
import type { PatchDocument, PatchNode } from '../core/schema.ts';
import { diffDocuments } from '../core/ops.ts';
import { useSession } from './context.ts';
import KitNode from './KitNode.vue';
import KitEdge from './KitEdge.vue';
import Palette from './Palette.vue';
import GridPalette from './GridPalette.vue';
import { portColor } from './grid-style.ts';

const props = defineProps<{ overlay?: PatchDocument | null }>();
const emit = defineEmits<{ (e: 'edit-code', id: string): void }>();
const session = useSession();
const flow = useVueFlow('den-kit');
const palette = ref<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
const wrapper = ref<HTMLElement | null>(null);
const selectedEdges = ref<string[]>([]);
/** Positions while dragging (committed as one move on drag stop). */
const dragging = ref<Record<string, { x: number; y: number }>>({});
let clipboard: { nodes: PatchNode[]; edges: PatchDocument['edges'][string][] } | null = null;

const ghost = computed(() => {
  const overlay = props.overlay; if (!overlay) return null;
  const ops = diffDocuments(session.doc.value, overlay);
  const added = new Set<string>(), removed = new Set<string>(), changed = new Set<string>(), addedEdges = new Set<string>(), removedEdges = new Set<string>();
  for (const op of ops) {
    if (op.op === 'addNode') added.add(op.node.id); else if (op.op === 'removeNode') removed.add(op.node.id);
    else if (op.op === 'addEdge') addedEdges.add(op.edge.id); else if (op.op === 'removeEdge') removedEdges.add(op.edge.id);
    else if ('node' in op && typeof op.node === 'string' && !(op.op === 'setField' && op.field === 'pos')) changed.add(op.node);
  }
  return { added, removed, changed, addedEdges, removedEdges, doc: overlay };
});

const issuesByNode = computed(() => {
  const map = new Map<string, typeof session.issues.value>();
  for (const issue of session.issues.value) if (issue.node && issue.severity !== 'info') (map.get(issue.node) ?? map.set(issue.node, []).get(issue.node)!).push(issue);
  return map;
});

const nodes = computed(() => {
  const doc = session.doc.value, g = ghost.value;
  const scope = session.validation.value.analysis.scope;
  const connected = new Map<string, string[]>();
  for (const e of Object.values(doc.edges)) (connected.get(e.to.node) ?? connected.set(e.to.node, []).get(e.to.node)!).push(e.to.port);
  const list = Object.values(doc.nodes).map(node => ({
    id: node.id, type: 'kit', position: { ...(dragging.value[node.id] ?? node.pos) }, selected: session.selection.value.includes(node.id),
    data: { node, issues: issuesByNode.value.get(node.id) ?? [], connected: connected.get(node.id) ?? [], scope: scope.get(node.id) ?? 'global', ghost: g ? (g.removed.has(node.id) ? 'removed' : g.changed.has(node.id) ? 'changed' : null) : null },
  }));
  if (g) for (const id of g.added) {
    const node = g.doc.nodes[id]!;
    const c = Object.values(g.doc.edges).filter(e => e.to.node === id).map(e => e.to.port);
    list.push({ id, type: 'kit', position: { ...node.pos }, selected: false, data: { node, issues: [], connected: c, scope: 'global', ghost: 'added' } });
  }
  return list;
});

const edges = computed(() => {
  const doc = session.doc.value, g = ghost.value;
  const colorOf = (node: string, port: string, d = doc) => { const n = d.nodes[node]; const def = n ? session.catalog.find(n.type) : undefined; const p = n ? session.catalog.output(n, port) : undefined; return p ? portColor(def, p, 'out') : '#ff3a5c'; };
  const list = Object.values(doc.edges).map(e => ({
    id: e.id, type: 'kit', source: e.from.node, sourceHandle: e.from.port, target: e.to.node, targetHandle: e.to.port,
    selected: selectedEdges.value.includes(e.id), data: { color: colorOf(e.from.node, e.from.port), ghost: (g?.removedEdges.has(e.id) ? 'removed' : undefined) as 'added' | 'removed' | undefined },
  }));
  if (g) for (const id of g.addedEdges) { const e = g.doc.edges[id]!; list.push({ id: `ghost-${id}`, type: 'kit', source: e.from.node, sourceHandle: e.from.port, target: e.to.node, targetHandle: e.to.port, selected: false, data: { color: colorOf(e.from.node, e.from.port, g.doc), ghost: 'added' } }); }
  return list;
});

function commit(intents: Intent[], label?: string) {
  const r = session.commit(intents, { label });
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r;
}

function onConnect(c: Connection) {
  if (!c.sourceHandle || !c.targetHandle) return;
  commit([{ op: 'connect', from: { node: c.source, port: c.sourceHandle }, to: { node: c.target, port: c.targetHandle }, replace: true }]);
}
function isValidConnection(c: Connection) {
  if (c.source === c.target) return false;
  return !createsCycle(session.doc.value, c.source, c.target);
}
function onDragStop(event: NodeDragEvent) {
  const intents: Intent[] = event.nodes.filter(n => session.doc.value.nodes[n.id]).map(n => ({ op: 'move', node: n.id, pos: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }));
  if (intents.length) commit(intents, 'Move');
  dragging.value = {};
}
function onNodesChange(changes: NodeChange[]) {
  const moves = changes.filter(c => c.type === 'position');
  if (moves.length) {
    const next = { ...dragging.value };
    for (const c of moves) if (c.type === 'position' && c.position) next[c.id] = { x: c.position.x, y: c.position.y };
    dragging.value = next;
  }
  const selects = changes.filter(c => c.type === 'select');
  if (!selects.length) return;
  const set = new Set(session.selection.value);
  for (const c of selects) if (c.type === 'select') { if (c.selected) set.add(c.id); else set.delete(c.id); }
  session.select([...set].filter(id => session.doc.value.nodes[id]));
}
function onEdgesChange(changes: EdgeChange[]) {
  const set = new Set(selectedEdges.value);
  for (const c of changes) if (c.type === 'select') { if (c.selected) set.add(c.id); else set.delete(c.id); }
  selectedEdges.value = [...set].filter(id => session.doc.value.edges[id]);
}
function deleteSelection() {
  const intents: Intent[] = [
    ...selectedEdges.value.filter(id => session.doc.value.edges[id]).map(id => ({ op: 'disconnect' as const, id })),
    ...session.selection.value.filter(id => session.doc.value.nodes[id]).map(id => ({ op: 'removeNode' as const, id })),
  ];
  // Disconnects of edges that removeNode also removes would fail; drop them.
  const removing = new Set(session.selection.value);
  const filtered = intents.filter(i => i.op !== 'disconnect' || (!removing.has(session.doc.value.edges[i.id]!.from.node) && !removing.has(session.doc.value.edges[i.id]!.to.node)));
  if (filtered.length) commit(filtered, 'Delete');
  selectedEdges.value = []; session.select([]);
}
function copy() {
  const doc = session.doc.value, ids = new Set(session.selection.value);
  if (!ids.size) return;
  clipboard = { nodes: [...ids].map(id => doc.nodes[id]!).filter(Boolean), edges: Object.values(doc.edges).filter(e => ids.has(e.from.node) && ids.has(e.to.node)) };
}
function paste() {
  if (!clipboard) return;
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
  const r = commit(intents, 'Paste');
  if (r.ok) session.select([...rename.values()]);
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); }
  else if (mod && e.key === 'c') copy();
  else if (mod && e.key === 'v') paste();
  else if (mod && e.key === 'd') { copy(); paste(); e.preventDefault(); }
  else if (e.key === 'Tab' || (e.key === ' ' && e.shiftKey)) { openPalette(); e.preventDefault(); }
}
function openPalette(event?: MouseEvent) {
  const box = wrapper.value?.getBoundingClientRect();
  const x = event && box ? event.clientX - box.left : (box?.width ?? 600) / 2 - 160, y = event && box ? event.clientY - box.top : 80;
  const p = flow.screenToFlowCoordinate({ x: (box?.left ?? 0) + x, y: (box?.top ?? 0) + y });
  palette.value = { x, y, flowX: Math.round(p.x), flowY: Math.round(p.y) };
}
function addAt(type: string, x: number, y: number) {
  const r = commit([{ op: 'addNode', node: { type, pos: { x: Math.round(x / 12) * 12, y: Math.round(y / 12) * 12 } } }], `Add ${type}`);
  if (r.ok) session.select(r.created);
}
function addAtCenter(type: string) {
  const box = wrapper.value?.getBoundingClientRect();
  const p = flow.screenToFlowCoordinate({ x: (box?.left ?? 0) + (box?.width ?? 800) / 2 - 60, y: (box?.top ?? 0) + (box?.height ?? 600) / 2 });
  // Nudge so repeated clicks do not stack exactly.
  const n = Object.keys(session.doc.value.nodes).length % 6;
  addAt(type, p.x + n * 24, p.y + n * 24);
}
function onDrop(e: DragEvent) {
  const type = e.dataTransfer?.getData('application/x-den-kit'); if (!type) return;
  e.preventDefault();
  const p = flow.screenToFlowCoordinate({ x: e.clientX, y: e.clientY });
  addAt(type, p.x - 40, p.y - 20);
}
function pick(type: string) {
  const at = palette.value;
  palette.value = null;
  const r = commit([{ op: 'addNode', node: { type, pos: { x: at?.flowX ?? 0, y: at?.flowY ?? 0 }, code: type === 'kit.codebox' ? undefined : undefined } }], `Add ${type}`);
  if (r.ok) session.select(r.created);
}
watch(() => session.loadEpoch.value, async () => { await nextTick(); setTimeout(() => flow.fitView({ padding: 0.08, maxZoom: 1 }), 80); }, { immediate: true });
defineExpose({ openPalette, fit: () => flow.fitView({ padding: 0.08, maxZoom: 1 }) });
</script>

<template>
  <div class="patch-shell">
  <GridPalette @add="addAtCenter" />
  <div ref="wrapper" class="patch-view" tabindex="0" data-testid="patch-view" @keydown="onKey" @dragover.prevent @drop="onDrop">
    <VueFlow id="den-kit" :nodes="nodes" :edges="edges" :apply-default="false" :delete-key-code="null" :min-zoom="0.2" :max-zoom="2" :snap-to-grid="true" :snap-grid="[12, 12]"
      :is-valid-connection="isValidConnection" :zoom-on-double-click="false" :connect-on-click="false"
      @connect="onConnect" @node-drag-stop="onDragStop" @nodes-change="onNodesChange" @edges-change="onEdgesChange"
      @pane-click="palette = null" @dblclick="(e: MouseEvent) => (e.target as HTMLElement).closest('.vue-flow__pane') && openPalette(e)">
      <template #node-kit="nodeProps"><KitNode v-bind="nodeProps" @edit-code="id => emit('edit-code', id)" /></template>
      <template #edge-kit="edgeProps"><KitEdge v-bind="edgeProps" /></template>
      <Background variant="lines" :gap="120" :line-width="1" pattern-color="#1c1c1c" />
    </VueFlow>
    <Palette v-if="palette" :style="{ left: `${palette.x}px`, top: `${palette.y}px` }" @pick="pick" @close="palette = null" />
    <div class="hint">Drag a module from the palette, or double-click / Tab to search · drag between ports to patch · Delete removes · ⌘/Ctrl+C/V/D</div>
  </div>
  </div>
</template>

<style>
.patch-shell { position: absolute; inset: 0; display: flex; flex-direction: column; }
.patch-view { position: relative; flex: 1; outline: none; background: #0e0e0e; }
.patch-view .vue-flow__node-kit { padding: 0; border: 0; background: transparent; width: auto; border-radius: 6px; }
.patch-view .vue-flow__node-kit.selected, .patch-view .vue-flow__node-kit:focus { box-shadow: none; outline: none; }
.patch-view .vue-flow__connection-path { stroke: #e0e0e0; stroke-width: 3; }
.patch-view .vue-flow__edge.selected .vue-flow__edge-path { stroke: none; }
.patch-view .hint { position: absolute; left: 12px; bottom: 8px; font-size: 11px; color: #6b6b6b; pointer-events: none; font-family: Lato, system-ui, sans-serif; }
</style>

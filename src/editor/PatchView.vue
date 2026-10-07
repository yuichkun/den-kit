<script setup lang="ts">
// Patch canvas (Vue Flow). The document is the source of truth: Vue Flow only
// renders it; every user gesture becomes a session.commit() intent.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { SelectionMode, VueFlow, useVueFlow, type Connection, type NodeDragEvent, type NodeChange, type EdgeChange } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { createsCycle } from '../core/scope.ts';
import type { Intent } from '../core/ops.ts';
import { useSession } from './context.ts';
import KitNode from './KitNode.vue';
import KitEdge from './KitEdge.vue';
import Palette from './Palette.vue';
import GridPalette from './GridPalette.vue';
import { portColor } from './grid-style.ts';
import { copySelection, duplicate, paste, typing } from './clipboard.ts';

const emit = defineEmits<{ (e: 'edit-code', id: string): void }>();
const session = useSession();
const flow = useVueFlow('den-kit');
const palette = ref<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
const wrapper = ref<HTMLElement | null>(null);
const selectedEdges = computed({ get: () => session.edgeSelection.value, set: ids => session.selectEdges(ids) });
/** Positions while dragging (committed as one move on drag stop). */
const dragging = ref<Record<string, { x: number; y: number }>>({});

const issuesByNode = computed(() => {
  const map = new Map<string, typeof session.issues.value>();
  for (const issue of session.issues.value) if (issue.node && issue.severity !== 'info') (map.get(issue.node) ?? map.set(issue.node, []).get(issue.node)!).push(issue);
  return map;
});

const nodes = computed(() => {
  const doc = session.doc.value;
  const scope = session.validation.value.analysis.scope;
  const connected = new Map<string, string[]>();
  for (const e of Object.values(doc.edges)) (connected.get(e.to.node) ?? connected.set(e.to.node, []).get(e.to.node)!).push(e.to.port);
  return Object.values(doc.nodes).map(node => ({
    id: node.id, type: 'kit', position: { ...(dragging.value[node.id] ?? node.pos) }, selected: session.selection.value.includes(node.id),
    data: { node, issues: issuesByNode.value.get(node.id) ?? [], connected: connected.get(node.id) ?? [], scope: scope.get(node.id) ?? 'global' },
  }));
});

const edges = computed(() => {
  const doc = session.doc.value;
  const colorOf = (node: string, port: string) => { const n = doc.nodes[node]; const def = n ? session.catalog.find(n.type) : undefined; const p = n ? session.catalog.output(n, port) : undefined; return p ? portColor(def, p, 'out') : '#ff3a5c'; };
  return Object.values(doc.edges).map(e => ({
    id: e.id, type: 'kit', source: e.from.node, sourceHandle: e.from.port, target: e.to.node, targetHandle: e.to.port,
    selected: selectedEdges.value.includes(e.id), data: { color: colorOf(e.from.node, e.from.port) },
  }));
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
// Keys work wherever the focus is (except text fields), so going back from the
// prompt (Esc) needs no click. Letters go by physical key (e.code).
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
let nudgeGesture = '';
let nudgeAt = 0;
function nudge(dx: number, dy: number) {
  const doc = session.doc.value;
  const ids = session.selection.value.filter(id => doc.nodes[id]);
  if (!ids.length) return;
  // Repeated arrow presses are one undo step.
  if (performance.now() - nudgeAt > 1500) nudgeGesture = `nudge-${Date.now()}`;
  nudgeAt = performance.now();
  const r = session.commit(ids.map(id => ({ op: 'move' as const, node: id, pos: { x: doc.nodes[id]!.pos.x + dx, y: doc.nodes[id]!.pos.y + dy } })), { label: 'Nudge', gesture: nudgeGesture });
  if (!r.ok) session.toast('warn', r.error.message);
}
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || typing(e) || palette.value) return;
  const mod = e.metaKey || e.ctrlKey;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) { deleteSelection(); e.preventDefault(); }
  else if (mod && !e.shiftKey && e.code === 'KeyA') { e.preventDefault(); session.select(Object.keys(session.doc.value.nodes)); selectedEdges.value = []; }
  else if (mod && e.code === 'KeyC') copySelection(session);
  else if (mod && e.code === 'KeyV') { e.preventDefault(); paste(session); }
  else if (mod && e.code === 'KeyD') { e.preventDefault(); duplicate(session); }
  else if (ARROWS[e.key] && !mod && !e.altKey) { e.preventDefault(); const [x, y] = ARROWS[e.key]!; const step = e.shiftKey ? 48 : 12; nudge(x * step, y * step); }
  else if (e.shiftKey && !mod && e.code === 'Digit1') { e.preventDefault(); fit(); }
  else if (e.shiftKey && !mod && e.code === 'Digit0') { e.preventDefault(); void flow.zoomTo(1, { duration: 150 }); }
  else if (mod && (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); void flow.zoomIn({ duration: 150 }); }
  else if (mod && (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract')) { e.preventDefault(); void flow.zoomOut({ duration: 150 }); }
  else if (e.key === 'Escape') { session.select([]); selectedEdges.value = []; }
  else if (e.key === 'Tab' || (e.key === ' ' && e.shiftKey)) { openPalette(); e.preventDefault(); }
}
function fit() { void flow.fitView({ padding: 0.08, maxZoom: 1, duration: 200 }); }
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
// An LLM request lands step by step: refit at most every 1.5 s.
let lastFit = 0;
const offLlmFit = session.onTransaction(tx => {
  if (tx.author.kind !== 'ai-llm' || !tx.ops.some(op => op.op === 'addNode') || performance.now() - lastFit < 1500) return;
  lastFit = performance.now();
  setTimeout(() => flow.fitView({ padding: 0.08, maxZoom: 1, duration: 250 }), 80);
});
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => { offLlmFit(); window.removeEventListener('keydown', onKey); });
defineExpose({ openPalette, fit });
</script>

<template>
  <div class="patch-shell">
  <GridPalette @add="addAtCenter" />
  <div ref="wrapper" class="patch-view" tabindex="0" data-testid="patch-view" @dragover.prevent @drop="onDrop">
    <!-- Like a drawing app: dragging on empty canvas selects; two fingers (or the wheel) pan, a pinch (or ⌘ + wheel) zooms,
         the middle button drags the view. Space is the voice key, so it never pans. -->
    <VueFlow id="den-kit" :nodes="nodes" :edges="edges" :apply-default="false" :delete-key-code="null" :pan-activation-key-code="null" :min-zoom="0.2" :max-zoom="2" :snap-to-grid="true" :snap-grid="[12, 12]"
      :selection-key-code="true" :pan-on-drag="[1, 2]" :pan-on-scroll="true" :zoom-on-pinch="true" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="['Shift', 'Meta', 'Control']"
      :is-valid-connection="isValidConnection" :zoom-on-double-click="false" :connect-on-click="false" :disable-keyboard-a11y="true"
      @connect="onConnect" @node-drag-stop="onDragStop" @nodes-change="onNodesChange" @edges-change="onEdgesChange"
      @pane-click="palette = null" @pane-context-menu="(e: MouseEvent) => e.preventDefault()" @dblclick="(e: MouseEvent) => (e.target as HTMLElement).closest('.vue-flow__pane') && openPalette(e)">
      <template #node-kit="nodeProps"><KitNode v-bind="nodeProps" @edit-code="id => emit('edit-code', id)" /></template>
      <template #edge-kit="edgeProps"><KitEdge v-bind="edgeProps" /></template>
      <Background variant="lines" :gap="120" :line-width="1" pattern-color="#1c1c1c" />
    </VueFlow>
    <Palette v-if="palette" :style="{ left: `${palette.x}px`, top: `${palette.y}px` }" @pick="pick" @close="palette = null" />
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
.patch-view .vue-flow__selection { border: 1px solid #5ec4ff; background: #5ec4ff1f; }
.patch-view .vue-flow__nodesselection-rect { border: 1px dashed #5ec4ff99; background: transparent; }
</style>

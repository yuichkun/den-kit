<script setup lang="ts">
// The plugin view: the plugin window (Max's presentation mode), drawn by
// PluginWindow. It fills the area it gets (or the whole screen) and the panel
// scales to it, the way a plugin fits any window size. Play operates the widgets;
// Edit (⌘E) moves and resizes them:
// click / Shift-click selects, drag moves, the corner resizes, arrows nudge
// (Shift: more), ⌘A selects all, Delete takes them off the plugin, ⌘C/⌘V/⌘D
// copy. Every change is a commit like in the patch, so ⌘Z undoes it.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { PanelRect, PatchNode } from '../core/schema.ts';
import { THEMES } from '../core/schema.ts';
import { pluginSpec } from '../plugin/build.ts';
import type { PluginSpec } from '../plugin/spec.ts';
import PluginWindow from '../plugin/PluginWindow.vue';
import { useSession } from './context.ts';
import { copySelection, duplicate, paste, typing } from './clipboard.ts';

const props = defineProps<{ edit: boolean; focus?: boolean }>();
const emit = defineEmits<{ (e: 'update:edit', value: boolean): void; (e: 'fullscreen'): void }>();
const session = useSession();
const drag = ref<{ rects: Record<string, PanelRect> } | null>(null);
const widgets = computed(() => Object.values(session.doc.value.nodes).filter(n => n.panel && session.catalog.find(n.type)?.kind === 'widget'));
const hiddenWidgets = computed(() => Object.values(session.doc.value.nodes).filter(n => !n.panel && session.catalog.find(n.type)?.kind === 'widget'));
const W = computed(() => session.doc.value.panel.width);
const H = computed(() => session.doc.value.panel.height);
const selected = computed(() => new Set(session.selection.value.filter(id => widgets.value.some(w => w.id === id))));
const gestures = new Map<string, string>();
// What the plugin window shows, built from the patch (a drag in progress moves it live).
const spec = computed<PluginSpec>(() => {
  const base = pluginSpec(session.doc.value, session.catalog, session.generated.value);
  const rects = drag.value?.rects;
  return rects ? { ...base, widgets: base.widgets.map(w => rects[w.id] ? { ...w, rect: rects[w.id]! } : w) } : base;
});
const analyser = (probe: number) => probe >= 0 ? session.engine.probeAnalysers[probe] ?? null : session.engine.outAnalyser;

// ---- playing ------------------------------------------------------------------------
function onChange(id: string, values: Record<string, number | boolean>, end: boolean) {
  const n = session.doc.value.nodes[id];
  if (!n) return;
  const gesture = gestures.get(id) ?? `panel-${id}-${Date.now()}`;
  gestures.set(id, gesture);
  const r = session.commit(Object.entries(values).map(([port, value]) => ({ op: 'setValue' as const, node: id, port, value, clamp: true })), { gesture, label: `Panel ${n.label ?? n.id}` });
  if (!r.ok) session.toast('warn', r.error.message);
  if (end) gestures.delete(id);
}
function onNote(note: number, on: boolean) { if (on) session.noteOn(note, 100); else session.noteOff(note); }

// ---- editing ------------------------------------------------------------------------
function commitRects(rects: Record<string, PanelRect>, label: string, gesture?: string) {
  const intents = Object.entries(rects).map(([node, panel]) => ({ op: 'setPanel' as const, node, panel }));
  if (!intents.length) return;
  const r = session.commit(intents, { label, gesture });
  if (!r.ok) session.toast('warn', r.error.message);
}
function pick(n: PatchNode, e: PointerEvent) {
  if (e.shiftKey) session.select(selected.value.has(n.id) ? [...selected.value].filter(id => id !== n.id) : [...selected.value, n.id]);
  else if (!selected.value.has(n.id)) session.select([n.id]);
}
function startMove(n: PatchNode, e: PointerEvent, resize: boolean, scale: number) {
  if (!props.edit) return;
  e.preventDefault(); e.stopPropagation();
  if (!resize) pick(n, e);
  const ids = resize ? [n.id] : [...selected.value];
  if (!ids.length) return;
  const start = { x: e.clientX, y: e.clientY };
  const r0 = Object.fromEntries(ids.map(id => [id, { ...session.doc.value.nodes[id]!.panel! }]));
  const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
  const snap = (v: number) => Math.round(v / 4) * 4;
  const move = (m: PointerEvent) => {
    const dx = snap((m.clientX - start.x) / scale), dy = snap((m.clientY - start.y) / scale);
    drag.value = { rects: Object.fromEntries(ids.map(id => {
      const r = r0[id]!;
      return [id, resize ? { ...r, w: Math.max(32, r.w + dx), h: Math.max(24, r.h + dy) } : { ...r, x: Math.min(W.value - 16, Math.max(0, r.x + dx)), y: Math.min(H.value - 16, Math.max(0, r.y + dy)) }];
    })) };
  };
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
    if (drag.value) { const rects = drag.value.rects; drag.value = null; commitRects(rects, resize ? 'Resize widget' : 'Move widget'); }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}
function place(n: PatchNode) {
  const count = widgets.value.length;
  session.commit([{ op: 'setPanel', node: n.id, panel: { x: 16 + (count % 6) * 96, y: 16 + Math.floor(count / 6) * 110, w: n.type === 'ui.keyboard' ? 360 : n.type === 'ui.xy' ? 160 : 84, h: n.type === 'ui.keyboard' ? 90 : n.type === 'ui.xy' ? 160 : 96 } }]);
}
let nudgeGesture = '';
let nudgeAt = 0;
function nudge(dx: number, dy: number) {
  const ids = [...selected.value];
  if (!ids.length) return;
  // Repeated arrow presses are one undo step.
  if (performance.now() - nudgeAt > 1500) nudgeGesture = `nudge-${Date.now()}`;
  nudgeAt = performance.now();
  commitRects(Object.fromEntries(ids.map(id => { const r = session.doc.value.nodes[id]!.panel!; return [id, { ...r, x: Math.min(W.value - 16, Math.max(0, r.x + dx)), y: Math.min(H.value - 16, Math.max(0, r.y + dy)) }]; })), 'Nudge', nudgeGesture);
}
function removeFromPlugin() {
  const ids = [...selected.value];
  if (!ids.length) return;
  const r = session.commit(ids.map(node => ({ op: 'setPanel' as const, node, panel: null })), { label: 'Take off the plugin' });
  if (!r.ok) session.toast('warn', r.error.message);
  session.select([]);
}
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || typing(e)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!props.edit) { if (mod && e.code === 'KeyA') e.preventDefault(); return; } // playing: nothing to select (and no page-wide text selection)
  if (mod && e.code === 'KeyA') { e.preventDefault(); session.select(widgets.value.map(w => w.id)); }
  else if (ARROWS[e.key] && !mod) { e.preventDefault(); const [x, y] = ARROWS[e.key]!; const step = e.shiftKey ? 16 : 4; nudge(x * step, y * step); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) { e.preventDefault(); removeFromPlugin(); }
  else if (e.key === 'Escape') session.select([]);
  else if (mod && e.code === 'KeyC') copySelection(session);
  else if (mod && e.code === 'KeyV') { e.preventDefault(); paste(session); }
  else if (mod && e.code === 'KeyD') { e.preventDefault(); duplicate(session); }
}
/** Edit: a press outside every widget clears the selection. */
function backgroundDown(e: PointerEvent) { if (props.edit && !(e.target as HTMLElement).closest('[data-widget]')) session.select([]); }

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="plugin-view" :class="{ focus }" tabindex="-1" data-testid="plugin-view">
    <div v-if="!focus" class="bar">
      <div class="modes">
        <button :class="{ active: !edit }" data-testid="plugin-play" title="Play (⌘E switches)" @click="emit('update:edit', false)">Play</button>
        <button :class="{ active: edit }" data-testid="plugin-edit" title="Edit the layout (⌘E switches)" @click="emit('update:edit', true)">Edit</button>
      </div>
      <select :value="session.doc.value.panel.theme" data-testid="plugin-theme" title="Theme" @change="session.commit([{ op: 'setTheme', theme: ($event.target as HTMLSelectElement).value as never }])"><option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option></select>
      <span class="muted">{{ edit ? 'Drag to move · corner to resize · arrows nudge · ⌘A all · Delete takes off' : `${W} × ${H} · scales to the window` }}</span>
      <span style="flex:1" />
      <template v-if="edit && hiddenWidgets.length">
        <span class="muted">Not on the plugin:</span>
        <button v-for="n in hiddenWidgets" :key="n.id" class="small" @click="place(n)">+ {{ n.label ?? n.id }}</button>
      </template>
      <button class="small" data-testid="plugin-fullscreen" title="Full screen (⇧⌘F); Esc leaves" @click="emit('fullscreen')">⛶ Full screen <kbd>⇧⌘F</kbd></button>
    </div>
    <div class="stage" :class="{ editing: edit }" @pointerdown="backgroundDown">
      <PluginWindow :spec="spec" :held="session.heldNotes.value" :analyser="analyser" @change="onChange" @note="onNote">
        <template #cell="{ widget, scale }">
          <template v-if="edit">
            <div class="shield" :class="{ selected: selected.has(widget.id) }" @pointerdown="startMove(session.doc.value.nodes[widget.id]!, $event, false, scale)" />
            <div v-if="selected.size === 1 && selected.has(widget.id)" class="grip" @pointerdown="startMove(session.doc.value.nodes[widget.id]!, $event, true, scale)" />
          </template>
        </template>
        <template #empty>
          <div class="empty" data-testid="plugin-empty">Nothing on the plugin yet. In the patch, select a module and press “→ Plugin” next to a knob, or add UI widgets (Knob, Slider, XY, Keyboard, Scope).</div>
        </template>
        <template #overlay>
          <div v-if="edit" class="frame" />
        </template>
      </PluginWindow>
    </div>
  </div>
</template>

<style scoped>
.plugin-view { position: absolute; inset: 0; display: flex; flex-direction: column; outline: none; }
.bar { display: flex; gap: 10px; align-items: center; padding: 6px 12px; border-bottom: 1px solid #000; background: #232323; flex-wrap: wrap; font-size: 13px; }
.modes { display: flex; background: #161616; border-radius: 4px; padding: 2px; }
.modes button { background: transparent; box-shadow: none; color: #9a9a9a; padding: 3px 12px; }
.modes button.active { background: #3a3a3a; color: #fff; }
.small { padding: 2px 8px; font-size: 12px; }
.small kbd { font-size: 10.5px; margin-left: 4px; padding: 0 4px; border: 1px solid #555; border-radius: 3px; }
.stage { position: relative; flex: 1; min-height: 0; }
.frame { position: absolute; inset: 0; outline: 1px dashed #ffffff40; pointer-events: none; }
.shield { position: absolute; inset: 0; outline: 1px dashed #5ec4ff60; cursor: move; }
.shield.selected { outline: 2px solid #5ec4ff; }
.grip { position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: var(--accent); border-radius: 3px; cursor: nwse-resize; z-index: 2; }
.empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 40px; text-align: center; opacity: .75; font-size: 15px; line-height: 1.5; }
</style>

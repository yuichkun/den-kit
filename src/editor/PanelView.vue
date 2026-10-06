<script setup lang="ts">
// Presentation view (Max-style): widget nodes placed freely. Edit mode moves and
// resizes; play mode operates them. Values flow through the same commits as the
// patch view, so panel moves are undoable and AI-visible.
import { computed, onMounted, ref } from 'vue';
import type { PanelRect, PatchNode } from '../core/schema.ts';
import { THEMES } from '../core/schema.ts';
import { PANEL_THEMES } from '../widgets/widgets.ts';
import { useSession } from './context.ts';

const session = useSession();
const editing = ref(false);
const drag = ref<{ id: string; rect: PanelRect } | null>(null);
const widgets = computed(() => Object.values(session.doc.value.nodes).filter(n => n.panel && session.catalog.find(n.type)?.kind === 'widget'));
const hiddenWidgets = computed(() => Object.values(session.doc.value.nodes).filter(n => !n.panel && session.catalog.find(n.type)?.kind === 'widget'));
const theme = computed(() => PANEL_THEMES[session.doc.value.panel.theme] ?? PANEL_THEMES.graphite!);
const rect = (n: PatchNode) => drag.value?.id === n.id ? drag.value.rect : n.panel!;
const probeChannel = (id: string) => session.generated.value.probes.find(p => p.node === id)?.channel ?? -1;
const gestures = new Map<string, string>();

function value(n: PatchNode, key = 'value') { const v = n.values[key]; return v === undefined ? '' : String(v); }
function setValue(n: PatchNode, port: string, v: number | boolean, end: boolean) {
  const gesture = gestures.get(n.id) ?? `panel-${n.id}-${Date.now()}`;
  gestures.set(n.id, gesture);
  const r = session.commit([{ op: 'setValue', node: n.id, port, value: v, clamp: true }], { gesture, label: `Panel ${n.label ?? n.id}` });
  if (!r.ok) session.toast('warn', r.error.message);
  if (end) gestures.delete(n.id);
}
function onWidget(n: PatchNode, e: Event, end: boolean) {
  const detail = (e as CustomEvent).detail;
  if (n.type === 'ui.xy') { setValue(n, 'x', detail.x, false); setValue(n, 'y', detail.y, end); }
  else setValue(n, 'value', detail, end);
}
function onNote(e: Event) { const d = (e as CustomEvent<{ note: number; on: boolean }>).detail; if (d.on) session.noteOn(d.note, 100); else session.noteOff(d.note); }

function startMove(n: PatchNode, e: PointerEvent, resize: boolean) {
  if (!editing.value) return;
  e.preventDefault(); e.stopPropagation();
  const start = { x: e.clientX, y: e.clientY }, r0 = { ...n.panel! };
  const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
  const W = session.doc.value.panel.width, H = session.doc.value.panel.height;
  const move = (m: PointerEvent) => {
    const dx = Math.round((m.clientX - start.x) / 4) * 4, dy = Math.round((m.clientY - start.y) / 4) * 4;
    const rect = resize ? { ...r0, w: Math.max(32, r0.w + dx), h: Math.max(24, r0.h + dy) } : { ...r0, x: Math.min(W - 16, Math.max(0, r0.x + dx)), y: Math.min(H - 16, Math.max(0, r0.y + dy)) };
    drag.value = { id: n.id, rect };
  };
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
    if (drag.value) { const rect = { ...drag.value.rect }; drag.value = null; const r = session.commit([{ op: 'setPanel', node: n.id, panel: rect }], { label: resize ? 'Resize widget' : 'Move widget' }); if (!r.ok) session.toast('warn', r.error.message); }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}
function place(n: PatchNode) {
  const count = widgets.value.length;
  session.commit([{ op: 'setPanel', node: n.id, panel: { x: 16 + (count % 6) * 96, y: 16 + Math.floor(count / 6) * 110, w: n.type === 'ui.keyboard' ? 360 : n.type === 'ui.xy' ? 160 : 84, h: n.type === 'ui.keyboard' ? 90 : n.type === 'ui.xy' ? 160 : 96 } }]);
}
const root = ref<HTMLElement | null>(null);
onMounted(() => {
  // Attach analysers to scope/meter elements (they draw themselves).
  const tick = () => {
    if (!root.value) return;
    for (const el of root.value.querySelectorAll<HTMLElement & { analyser?: AnalyserNode | null }>('dk-scope[data-probe]')) {
      const ch = Number(el.dataset.probe);
      el.analyser = ch >= 0 ? session.engine.probeAnalysers[ch] ?? null : session.engine.outAnalyser;
    }
    requestAnimationFrame(tick);
  };
  tick();
});
</script>

<template>
  <div ref="root" class="panel-view" data-testid="panel-view">
    <div class="bar">
      <label><input v-model="editing" type="checkbox" data-testid="panel-edit" /> Edit layout</label>
      <select :value="session.doc.value.panel.theme" data-testid="panel-theme" @change="session.commit([{ op: 'setTheme', theme: ($event.target as HTMLSelectElement).value as never }])"><option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option></select>
      <span class="muted">{{ editing ? 'Drag to move · corner to resize' : 'Play mode' }}</span>
      <span style="flex:1" />
      <span v-if="hiddenWidgets.length" class="muted">Not on panel:</span>
      <button v-for="n in hiddenWidgets" :key="n.id" class="small" @click="place(n)">+ {{ n.label ?? n.id }}</button>
    </div>
    <div class="stage">
      <div class="panel" :class="{ editing }" :style="{ width: `${session.doc.value.panel.width}px`, height: `${session.doc.value.panel.height}px`, ...theme, background: theme['--dk-bg'] }" data-testid="panel">
        <div v-for="n in widgets" :key="n.id" class="cell" :data-widget="n.id" :style="{ left: `${rect(n).x}px`, top: `${rect(n).y}px`, width: `${rect(n).w}px`, height: `${rect(n).h}px` }" @pointerdown="startMove(n, $event, false)">
          <dk-knob v-if="n.type === 'ui.knob'" :value="value(n)" :min="String(n.config.min)" :max="String(n.config.max)" :scale="String(n.config.scale)" :unit="String(n.config.unit ?? '')" :label="n.label ?? n.id" :default="String(n.config.min)" @input="onWidget(n, $event, false)" @change="onWidget(n, $event, true)" />
          <dk-slider v-else-if="n.type === 'ui.slider'" :value="value(n)" :min="String(n.config.min)" :max="String(n.config.max)" :scale="String(n.config.scale)" :unit="String(n.config.unit ?? '')" :label="n.label ?? n.id" @input="onWidget(n, $event, false)" @change="onWidget(n, $event, true)" />
          <dk-toggle v-else-if="n.type === 'ui.toggle' || n.type === 'ui.button'" :value="value(n)" :label="n.label ?? n.id" :momentary="n.type === 'ui.button' ? '' : undefined" @input="onWidget(n, $event, false)" @change="onWidget(n, $event, true)" />
          <dk-xy v-else-if="n.type === 'ui.xy'" :x="value(n, 'x')" :y="value(n, 'y')" :label="n.label ?? n.id" @input="onWidget(n, $event, false)" @change="onWidget(n, $event, true)" />
          <dk-keyboard v-else-if="n.type === 'ui.keyboard'" octave="3" :held="session.heldNotes.value.join(',')" @note="onNote" />
          <dk-scope v-else-if="n.type === 'ui.scope' || n.type === 'ui.meter'" :data-probe="probeChannel(n.id)" :mode="n.type === 'ui.meter' ? 'meter' : 'scope'" :label="n.label ?? n.id" />
          <div v-if="editing" class="grip" @pointerdown="startMove(n, $event, true)" />
          <div v-if="editing" class="shield" />
        </div>
        <div v-if="!widgets.length" class="empty">The panel is empty. In the patch, select a block and press “→ Panel” next to an input, or add UI widgets (Knob, Slider, XY, Keyboard, Scope).</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-view { position: absolute; inset: 0; display: flex; flex-direction: column; }
.bar { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.small { padding: 0 6px; font-size: 11px; }
.stage { flex: 1; overflow: auto; display: grid; place-items: center; padding: 24px; background: repeating-linear-gradient(45deg, #15171b, #15171b 10px, #17191e 10px, #17191e 20px); }
.panel { position: relative; border-radius: 14px; box-shadow: 0 10px 40px #000a, inset 0 0 0 1px #ffffff14; color: var(--dk-fg); }
.panel.editing { outline: 1px dashed #ffffff40; }
.cell { position: absolute; }
.editing .cell { outline: 1px dashed #5ec4ff80; cursor: move; }
.shield { position: absolute; inset: 0; }
.grip { position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: var(--accent); border-radius: 3px; cursor: nwse-resize; z-index: 2; }
.empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 40px; text-align: center; opacity: .7; }
</style>

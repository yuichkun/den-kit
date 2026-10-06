<script setup lang="ts">
// Compact drag-to-change value for an unconnected input (an AudioParam).
// Horizontal drag changes it (shift = fine), double-click to type.
import { computed, ref } from 'vue';
import type { PortDef } from '../core/catalog.ts';
import { useSession } from './context.ts';

const props = defineProps<{ node: string; port: PortDef; value: number | boolean | undefined }>();
const session = useSession();
const editing = ref(false);
const text = ref('');
const min = computed(() => props.port.uiMin ?? props.port.min ?? 0);
const max = computed(() => props.port.uiMax ?? props.port.max ?? 1);
const log = computed(() => props.port.scale === 'log' && min.value > 0);
const shown = computed(() => {
  if (props.port.type === 'gate') return props.value ? 'on' : 'off';
  const v = Number(props.value ?? props.port.default ?? 0), a = Math.abs(v);
  const t = a >= 1000 ? `${(v / 1000).toFixed(a >= 10000 ? 1 : 2)}k` : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(a >= 1 ? 2 : 3);
  return props.port.unit && props.port.unit !== 'mix' ? `${t}${props.port.unit}` : t;
});
const set = (value: number | boolean, gesture?: string) => {
  const r = session.commit([{ op: 'setValue', node: props.node, port: props.port.id, value, clamp: true }], { gesture, label: `Set ${props.node}.${props.port.id}` });
  if (!r.ok) session.toast('warn', r.error.message);
};
function down(e: PointerEvent) {
  if (props.port.type === 'gate') { set(!props.value); return; }
  if (e.button !== 0) return;
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
  const gesture = `drag-${props.node}-${props.port.id}-${Date.now()}`;
  const startX = e.clientX, v0 = Number(props.value ?? props.port.default ?? 0);
  const u0 = log.value ? Math.log(Math.max(v0, min.value) / min.value) / Math.log(max.value / min.value) : (v0 - min.value) / (max.value - min.value || 1);
  const move = (m: PointerEvent) => {
    const u = Math.min(1, Math.max(0, u0 + (m.clientX - startX) / (m.shiftKey ? 1200 : 240)));
    const v = log.value ? min.value * (max.value / min.value) ** u : min.value + (max.value - min.value) * u;
    set(Number(v.toPrecision(5)), gesture);
  };
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}
function startEdit() { if (props.port.type === 'gate') return; text.value = String(props.value ?? ''); editing.value = true; }
function finish() { editing.value = false; const v = Number(text.value); if (Number.isFinite(v)) set(v); }
</script>

<template>
  <input v-if="editing" v-model="text" class="value-input nodrag" autofocus @keydown.enter="finish" @keydown.escape="editing = false" @blur="finish" />
  <span v-else class="value-field nodrag" :class="{ gate: port.type === 'gate', on: port.type === 'gate' && !!value }" :title="`${port.id}: drag to change, double-click to type`" @pointerdown="down" @dblclick.stop="startEdit">{{ shown }}</span>
</template>

<style scoped>
.value-field { display: inline-block; min-width: 64px; text-align: right; padding: 2px 8px; border-radius: 3px; background: #161616; color: #ff9c1a; cursor: ew-resize; font-variant-numeric: tabular-nums; font-size: 12px; }
.value-field.gate { cursor: pointer; color: var(--muted); } .value-field.gate.on { color: var(--gate); }
.value-input { width: 64px; font-size: 11px; padding: 0 3px; }
</style>

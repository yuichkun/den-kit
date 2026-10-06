<script setup lang="ts">
// Grid-style knob: white disc with black pointer (big) or dark disc (small), a
// dark 270° track and a coloured value arc. Vertical drag (Shift = fine), wheel,
// double-click resets. Emits one gesture id per drag so history merges it.
import { computed, ref } from 'vue';
import { formatValue } from './grid-style.ts';

const props = withDefaults(defineProps<{ value: number; min: number; max: number; default?: number; scale?: 'linear' | 'log'; size?: 'big' | 'small'; color?: string; label?: string; unit?: string; bipolar?: boolean; disabled?: boolean }>(), { size: 'big', color: '#ff3a5c', scale: 'linear' });
const emit = defineEmits<{ (e: 'change', value: number, gesture: string): void }>();
const active = ref(false);
const hover = ref(false);
const log = computed(() => props.scale === 'log' && props.min > 0);
const toU = (v: number) => { const x = Math.min(props.max, Math.max(props.min, v)); return log.value ? Math.log(x / props.min) / Math.log(props.max / props.min) : (x - props.min) / ((props.max - props.min) || 1); };
const fromU = (u: number) => { const t = Math.min(1, Math.max(0, u)); return log.value ? props.min * (props.max / props.min) ** t : props.min + (props.max - props.min) * t; };
const u = computed(() => toU(props.value));
const D = computed(() => props.size === 'big' ? 46 : 26);
const R = computed(() => D.value / 2 - (props.size === 'big' ? 3 : 2.5));
const polar = (deg: number, r: number) => { const a = (deg - 90) * Math.PI / 180; return [D.value / 2 + r * Math.cos(a), D.value / 2 + r * Math.sin(a)]; };
const arc = (a0: number, a1: number, r = R.value) => {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const [x0, y0] = polar(Math.min(a0, a1), r), [x1, y1] = polar(Math.max(a0, a1), r);
  return `M${x0} ${y0} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
const angle = computed(() => -135 + 270 * u.value);
const zeroAngle = computed(() => props.bipolar || (props.min < 0 && props.max > 0) ? -135 + 270 * toU(0) : -135);
const pointer = computed(() => { const inner = props.size === 'big' ? R.value * 0.12 : R.value * 0.2; const [x0, y0] = polar(angle.value, inner); const [x1, y1] = polar(angle.value, R.value * (props.size === 'big' ? 0.62 : 0.62)); return { x0, y0, x1, y1 }; });
const shown = computed(() => formatValue(props.value, props.unit));

function down(e: PointerEvent) {
  if (props.disabled || e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const el = e.currentTarget as Element; el.setPointerCapture(e.pointerId);
  active.value = true;
  const gesture = `knob-${Math.random().toString(36).slice(2)}`;
  const y0 = e.clientY, u0 = u.value;
  const move = (m: PointerEvent) => emit('change', Number(fromU(u0 + (y0 - m.clientY) / (m.shiftKey ? 900 : 180)).toPrecision(6)), gesture);
  const up = () => { active.value = false; el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  el.addEventListener('pointermove', move as EventListener); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function wheel(e: WheelEvent) { if (props.disabled) return; e.preventDefault(); e.stopPropagation(); emit('change', Number(fromU(u.value - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02)).toPrecision(6)), `wheel-${Math.floor(Date.now() / 600)}`); }
function reset() { if (!props.disabled && props.default !== undefined) emit('change', props.default, `reset-${Date.now()}`); }
</script>

<template>
  <div class="grid-knob nodrag nowheel" :class="[size, { active, disabled }]" :title="label ? `${label}: ${shown}` : shown" @pointerenter="hover = true" @pointerleave="hover = false">
    <svg :width="D" :height="D" :viewBox="`0 0 ${D} ${D}`" @pointerdown="down" @wheel="wheel" @dblclick.stop="reset">
      <path :d="arc(-135, 135)" class="track" :stroke-width="size === 'big' ? 4 : 3" />
      <path :d="arc(zeroAngle, angle)" :stroke="color" :stroke-width="size === 'big' ? 4 : 3" fill="none" stroke-linecap="butt" />
      <circle :cx="D / 2" :cy="D / 2" :r="R - (size === 'big' ? 5 : 4)" :class="size === 'big' ? 'disc-big' : 'disc-small'" />
      <line :x1="pointer.x0" :y1="pointer.y0" :x2="pointer.x1" :y2="pointer.y1" :class="size === 'big' ? 'ptr-big' : 'ptr-small'" />
    </svg>
    <div v-if="size === 'big' && label !== undefined" class="label" :style="active || hover ? { color } : undefined">{{ active || hover ? shown : label }}</div>
  </div>
</template>

<style scoped>
.grid-knob { display: flex; flex-direction: column; align-items: center; gap: 1px; user-select: none; }
.grid-knob svg { cursor: ns-resize; display: block; overflow: visible; }
.grid-knob.disabled svg { cursor: default; opacity: .4; }
.track { stroke: #444; fill: none; }
.disc-big { fill: url(#kit-knob-face); fill: #ececec; filter: drop-shadow(0 1px 1px #0009); }
.disc-small { fill: #3d3d3d; stroke: #4a4a4a; stroke-width: 1; }
.ptr-big { stroke: #111; stroke-width: 3; stroke-linecap: round; }
.ptr-small { stroke: #bdbdbd; stroke-width: 2; stroke-linecap: round; }
.label { font-size: 12px; color: #cfcfcf; white-space: nowrap; line-height: 14px; min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
.active .disc-big { fill: #fff; }
</style>

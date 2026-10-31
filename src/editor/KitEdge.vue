<script setup lang="ts">
// A patch cable (docs/design-system.md): in the theme's color for its source's type (the
// cat-*-cable tokens), with the line of what it carries, along the theme's route: curves, or
// lines that turn only at 45° and 90°. Modules placed side by side get a short arrow instead.
import { computed } from 'vue';
import type { SignalKind } from './grid-style.ts';
import { theme } from './theme.ts';

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  selected?: boolean;
  data?: { color?: string; kind?: SignalKind; copies?: number; sums?: boolean };
}>();
const color = computed(() => props.data?.color ?? 'var(--cable)');
const kind = computed(() => props.data?.kind ?? 'audio');
/** From copies (×N): a thick cable, one signal per copy; Σ where it is summed into a single input. */
const thick = computed(() => (props.data?.copies ?? 1) > 1);
const adjacent = computed(() => {
  const dx = props.targetX - props.sourceX;
  return dx > -2 && dx < 40 && Math.abs(props.targetY - props.sourceY) < 6;
});
/** Out of the port, across at 45° where there is room, and into the port. */
function angled(sx: number, sy: number, tx: number, ty: number): string {
  const run = 14,
    d = Math.abs(ty - sy),
    x0 = sx + run,
    x1 = tx - run;
  if (x1 - x0 >= d) {
    const mid = (x0 + x1) / 2;
    return `M${sx} ${sy} H${mid - d / 2} L${mid + d / 2} ${ty} H${tx}`;
  }
  if (tx >= sx) return `M${sx} ${sy} H${x0} V${ty} H${tx}`;
  // Backwards: out, down below both ends, back, and up into the input.
  const below = Math.max(sy, ty) + 40;
  return `M${sx} ${sy} H${x0} V${below} H${x1} V${ty} H${tx}`;
}
function curved(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx,
    dy = ty - sy;
  if (dx >= 0) {
    const c = Math.max(30, Math.min(160, dx * 0.5 + Math.abs(dy) * 0.15));
    return `M${sx} ${sy} C${sx + c} ${sy + Math.abs(dy) * 0.08} ${tx - c} ${ty + Math.abs(dy) * 0.08} ${tx} ${ty}`;
  }
  // Backwards cable: loop out and back (sags below like a real cord).
  const sag = Math.max(60, Math.abs(dy) * 0.3 + 40),
    c = Math.max(60, Math.min(200, -dx * 0.4));
  return `M${sx} ${sy} C${sx + c} ${sy + sag} ${tx - c} ${ty + sag} ${tx} ${ty}`;
}
const path = computed(() => {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  if (adjacent.value) return `M${sx} ${sy} L${tx - 7} ${ty}`;
  return theme.value.route === 'angled' ? angled(sx, sy, tx, ty) : curved(sx, sy, tx, ty);
});
const arrow = computed(() => {
  const { targetX: tx, targetY: ty } = props;
  return `M${tx - 9} ${ty - 4.5} L${tx - 2} ${ty} L${tx - 9} ${ty + 4.5} Z`;
});
</script>

<template>
  <g
    class="kit-edge"
    :class="[kind, { selected, adjacent, thick }]"
    :data-copies="thick ? data?.copies : undefined"
    :data-kind="kind"
  >
    <path :d="path" class="hit" />
    <path v-if="!adjacent" :d="path" class="shade" />
    <path :d="path" class="cable" :style="{ stroke: color, color }" />
    <path v-if="thick" :d="path" class="core" />
    <path v-if="adjacent" :d="arrow" :style="{ fill: color }" />
    <text
      v-if="thick && !adjacent"
      class="copies"
      :x="sourceX + 10"
      :y="sourceY - 7"
      :style="{ fill: color }"
      >×{{ data?.copies }}</text
    >
    <text
      v-if="data?.sums && !adjacent"
      class="sum"
      :x="targetX - 16"
      :y="targetY - 7"
      :style="{ fill: color }"
      ><title>The copies are summed here (×1/√{{ data?.copies }})</title>Σ</text
    >
  </g>
</template>

<style scoped>
.hit {
  stroke: transparent;
  stroke-width: 14;
  fill: none;
  cursor: pointer;
}
/* A casing in the canvas color, so crossing cables stay apart. */
.shade {
  stroke: var(--app-canvas);
  stroke-opacity: 0.85;
  stroke-width: calc(var(--cable-width) + 3px);
  fill: none;
}
.cable {
  stroke-width: var(--cable-width);
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.control .cable {
  stroke-dasharray: 7 4;
  stroke-linecap: butt;
}
.gate .cable {
  stroke-dasharray: 0.1 4;
}
.adjacent .cable {
  stroke-dasharray: none;
}
.selected .cable {
  stroke-width: calc(var(--cable-width) + 1.5px);
  filter: drop-shadow(0 0 3px currentColor);
}
.thick .cable {
  stroke-width: calc(var(--cable-width) * 3);
}
.thick .shade {
  stroke-width: calc(var(--cable-width) * 3 + 3px);
}
.thick .core {
  stroke: var(--app-canvas);
  stroke-opacity: 0.6;
  stroke-width: 1.6;
  fill: none;
  stroke-dasharray: 6 4;
}
.copies,
.sum {
  font: 700 10px var(--font-ui);
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--app-canvas);
  stroke-width: 3px;
}
</style>

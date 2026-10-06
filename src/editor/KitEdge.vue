<script setup lang="ts">
// Grid-style patch cord: thick cable coloured by the source signal, drooping
// bezier; modules placed side by side get the short "●→●" arrow instead.
import { computed } from 'vue';

const props = defineProps<{ id: string; sourceX: number; sourceY: number; targetX: number; targetY: number; selected?: boolean; data?: { color?: string } }>();
const color = computed(() => props.data?.color ?? '#ff3a5c');
const adjacent = computed(() => { const dx = props.targetX - props.sourceX; return dx > -2 && dx < 40 && Math.abs(props.targetY - props.sourceY) < 6; });
const path = computed(() => {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  if (adjacent.value) return `M${sx} ${sy} L${tx - 7} ${ty}`;
  const dx = tx - sx, dy = ty - sy;
  if (dx >= 0) {
    const c = Math.max(30, Math.min(160, dx * 0.5 + Math.abs(dy) * 0.15));
    return `M${sx} ${sy} C${sx + c} ${sy + Math.abs(dy) * 0.08} ${tx - c} ${ty + Math.abs(dy) * 0.08} ${tx} ${ty}`;
  }
  // Backwards cable: loop out and back (sags below like a real cord).
  const sag = Math.max(60, Math.abs(dy) * 0.3 + 40), c = Math.max(60, Math.min(200, -dx * 0.4));
  return `M${sx} ${sy} C${sx + c} ${sy + sag} ${tx - c} ${ty + sag} ${tx} ${ty}`;
});
const arrow = computed(() => { const { targetX: tx, targetY: ty } = props; return `M${tx - 9} ${ty - 4.5} L${tx - 2} ${ty} L${tx - 9} ${ty + 4.5} Z`; });
</script>

<template>
  <g class="kit-edge" :class="{ selected, adjacent }">
    <path :d="path" class="hit" />
    <path v-if="!adjacent" :d="path" class="shade" />
    <path :d="path" class="cable" :stroke="color" />
    <path v-if="adjacent" :d="arrow" :fill="color" />
  </g>
</template>

<style scoped>
.hit { stroke: transparent; stroke-width: 14; fill: none; cursor: pointer; }
.shade { stroke: #000; stroke-opacity: .55; stroke-width: 5.5; fill: none; }
.cable { stroke-width: 3; fill: none; stroke-linecap: round; }
.adjacent .cable { stroke-width: 2.5; }
.selected .cable { stroke-width: 4; filter: drop-shadow(0 0 4px currentColor); }
.selected .shade { stroke: #fff; stroke-opacity: .5; stroke-width: 7; }
</style>

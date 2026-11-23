<script setup lang="ts">
// Small live drawings on the module face: Grid modules show their shape
// (src/work/module-shape.ts), following the current knob values.
import { computed } from 'vue';
import type { PatchNode } from '../work/schema.ts';
import { moduleShape } from '../work/module-shape.ts';

const props = withDefaults(
  defineProps<{ node: PatchNode; color: string; width?: number; height?: number }>(),
  { width: 76, height: 40 },
);
const W = computed(() => props.width),
  H = computed(() => props.height);
const shape = computed(() => moduleShape(props.node, W.value, H.value));
</script>

<template>
  <svg v-if="shape" class="module-viz" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
    <line
      v-for="k in 3"
      :key="k"
      :x1="2"
      :x2="W - 2"
      :y1="(H / 4) * k"
      :y2="(H / 4) * k"
      class="grid"
    />
    <path v-if="shape.fill" :d="shape.fill" :style="{ fill: color }" opacity="0.18" />
    <path
      v-if="shape.dashed"
      :d="shape.dashed"
      :style="{ stroke: color }"
      stroke-width="1.5"
      fill="none"
      stroke-dasharray="4 3"
    />
    <path
      :d="shape.path"
      :style="{ stroke: color }"
      stroke-width="1.8"
      fill="none"
      stroke-linejoin="round"
    />
    <circle
      v-for="(d, k) in shape.dots ?? []"
      :key="k"
      :cx="d[0]"
      :cy="d[1]"
      r="3"
      :class="{ now: k === (shape.dots?.length ?? 0) - 1 }"
      :style="{ fill: color }"
    />
  </svg>
</template>

<style scoped>
.module-viz {
  display: block;
  overflow: visible;
}
.grid {
  stroke: color-mix(in srgb, currentColor 14%, transparent);
  stroke-width: 1;
}
/* The point the sound is at now. */
circle.now {
  fill: var(--mod-fill, var(--app-canvas)) !important;
  stroke: currentColor;
  stroke-width: 1.5;
}
</style>

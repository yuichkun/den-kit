<script setup lang="ts">
// A symbol on the work's art: the shape of a module (src/work/module-shape.ts) as it was when
// the symbol was drawn, as a line in the ink colour on the symbol's box (its fill, corners and
// border). The line keeps its width relative to the symbol, so the icon reads at any size.
import { computed } from 'vue';
import type { SymbolElement } from '../work/art.ts';
import { moduleShape } from '../work/module-shape.ts';
import { cssColor } from '../work/ui.ts';
import { boxCss, fillCss, type AssetUrl } from './css.ts';

const props = defineProps<{ element: SymbolElement; url: AssetUrl }>();
const el = computed(() => props.element);
/** The symbol's own units: 100 across. */
const W = 100;
const H = computed(() => (W * el.value.rect.h) / el.value.rect.w);
const weight = computed(() => el.value.weight ?? 4);
/** The line keeps clear of the box's edge, by a share of its shorter side. */
const inset = computed(() => Math.min(W, H.value) * 0.2);
const shape = computed(() =>
  moduleShape(el.value.module, W - 2 * inset.value, H.value - 2 * inset.value, weight.value / 2),
);
const ink = computed(() => cssColor(el.value.ink ?? 'accent'));
const fills = computed(() =>
  (el.value.style?.fill ?? []).map(f => fillCss(f, props.url)).filter(Boolean),
);
</script>

<template>
  <div class="symbol" :style="boxCss(el.style)" data-kind="symbol">
    <div v-for="(f, i) in fills" :key="i" class="fill" :style="f!" />
    <svg
      v-if="shape"
      class="line"
      :viewBox="`${-inset} ${-inset} ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <path v-if="shape.fill" :d="shape.fill" :style="{ fill: ink }" opacity="0.2" />
      <path
        v-if="shape.dashed"
        :d="shape.dashed"
        :style="{ stroke: ink }"
        :stroke-width="weight * 0.6"
        :stroke-dasharray="`${weight * 1.4} ${weight * 1.2}`"
        fill="none"
        opacity="0.6"
      />
      <path
        :d="shape.path"
        :style="{ stroke: ink }"
        :stroke-width="weight"
        fill="none"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="(d, k) in shape.dots ?? []"
        :key="k"
        :cx="d[0]"
        :cy="d[1]"
        :r="weight * 0.9"
        :style="{ fill: ink }"
      />
    </svg>
  </div>
</template>

<style scoped>
.symbol {
  position: absolute;
  inset: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}
.line {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>

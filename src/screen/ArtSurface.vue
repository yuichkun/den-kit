<script setup lang="ts">
// The work's icon or cover, drawn at `size` pixels across: its background (the look's background
// colour when it has none), then its elements back to front, in the work's look (its tokens over
// its base theme). An icon can be shown in the rounded square most systems put icons in.
import { computed } from 'vue';
import { ART_SIZE, artStack, type ArtSurfaceName } from '../work/art.ts';
import type { PatchDocument } from '../work/schema.ts';
import { lookVars } from './build.ts';
import { fillCss, type AssetUrl } from './css.ts';
import ArtSymbol from './ArtSymbol.vue';
import PluginElement from './PluginElement.vue';

const props = defineProps<{
  doc: Pick<PatchDocument, 'panel' | 'ui' | 'art'>;
  on: ArtSurfaceName;
  /** Pixels across on screen. */
  size: number;
  assetUrls?: Readonly<Record<string, string>>;
  /** Show an icon in a rounded square. */
  mask?: boolean;
}>();
const url: AssetUrl = id => props.assetUrls?.[id] ?? null;
const design = computed(() => ART_SIZE[props.on]);
const scale = computed(() => props.size / design.value.width);
const surface = computed(() => props.doc.art?.[props.on]);
const background = computed(() =>
  (surface.value?.background ?? []).map(f => fillCss(f, url)).filter(Boolean),
);
const items = computed(() => (surface.value ? artStack(surface.value) : []).filter(e => !e.hidden));
const cell = (r: { x: number; y: number; w: number; h: number }) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});
const noControls = {};
</script>

<template>
  <div
    class="art"
    :class="{ mask: mask && on === 'icon' }"
    :style="{
      width: `${size}px`,
      height: `${(size * design.height) / design.width}px`,
      borderRadius: mask && on === 'icon' ? `${size * 0.2237}px` : undefined,
    }"
    :data-art="on"
  >
    <div
      class="surface"
      data-testid="art-surface"
      :style="{
        ...lookVars(doc),
        width: `${design.width}px`,
        height: `${design.height}px`,
        transform: `scale(${scale})`,
      }"
    >
      <div v-for="(f, i) in background" :key="`bg${i}`" class="fill" :style="f!" />
      <div
        v-for="el in items"
        :key="el.id"
        class="cell"
        :data-art-element="el.id"
        :style="cell(el.rect)"
      >
        <ArtSymbol v-if="el.kind === 'symbol'" :element="el" :url="url" />
        <PluginElement v-else :element="el" :url="url" :controls="noControls" preview />
      </div>
    </div>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  overflow: hidden;
  flex: none;
}
.surface {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
  color: var(--dk-fg);
  font-family: var(--dk-font);
  background: var(--dk-bg);
}
.fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.cell {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}
</style>

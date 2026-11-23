<script setup lang="ts">
// One board of a work's art (src/work/art.ts), its icon or its cover, drawn from
// the work as it is now: the ground from the plugin's background (or the
// author's fills), windows onto the plugin screen (PluginWindow, at the window's
// focus and zoom, with the controls where the author left them), letters in the
// work's fonts and colours, and the patch as a pattern. The board is drawn at its
// design size and scaled to `width`. With `finish` the shelf frames it: the same
// corners, light and grain on every work's art, whatever its author made.
import { computed } from 'vue';
import {
  BOARD_SIZE,
  type ArtBoardId,
  type ArtLayer,
  type Sign,
  type WindowLayer,
} from '../work/art.ts';
import { cssColor, type Fill, type Rect } from '../work/ui.ts';
import { boxCss, fillCss, textCss, type AssetUrl } from './css.ts';
import { SIGN_PATHS, patternMarks } from './pattern.ts';
import type { PluginSpec } from './spec.ts';
import PluginWindow from './PluginWindow.vue';

const props = defineProps<{
  /** The work's plugin as drawn (build.ts): its look's colours and fonts, background and screen. */
  spec: PluginSpec;
  board: ArtBoardId;
  /** Bottom to top. */
  layers: readonly ArtLayer[];
  /** The patch as signs (patchSigns), for pattern layers. */
  signs: readonly Sign[];
  /** Asset id → URL. */
  assetUrls?: Readonly<Record<string, string>>;
  /** The shelf's frame. */
  finish?: boolean;
  /** Drawn width in CSS pixels; the height follows the board. */
  width: number;
}>();

const size = computed(() => BOARD_SIZE[props.board]);
const scale = computed(() => props.width / size.value.w);
const url: AssetUrl = id => props.assetUrls?.[id] ?? null;
const visible = computed(() => props.layers.filter(l => !l.hidden));

const place = (r: Rect) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});
const fills = (list: readonly Fill[] | undefined) =>
  (list ?? []).map(f => fillCss(f, url)).filter(Boolean) as Array<Record<string, string>>;

/** The plugin with the window's moment: its controls where the author left them. */
function specFor(layer: WindowLayer): PluginSpec {
  const moment = layer.moment;
  if (!moment) return props.spec;
  const at = (w: PluginSpec['widgets'][number]) =>
    moment[w.id] === undefined ? w : { ...w, values: { ...w.values, value: moment[w.id]! } };
  return {
    ...props.spec,
    items: props.spec.items.map(item =>
      item.kind === 'widget' ? { ...item, widget: at(item.widget) } : item,
    ),
    controls: Object.fromEntries(Object.entries(props.spec.controls).map(([id, w]) => [id, at(w)])),
  };
}
/** Where the plugin sits inside a window: `focus` at the window's centre, `zoom` board pixels per plugin pixel. */
const view = (layer: WindowLayer) => ({
  left: `${layer.rect.w / 2 - layer.focus.x * layer.zoom}px`,
  top: `${layer.rect.h / 2 - layer.focus.y * layer.zoom}px`,
  width: `${props.spec.width * layer.zoom}px`,
  height: `${props.spec.height * layer.zoom}px`,
});
const patterns = computed(
  () =>
    new Map(
      visible.value.flatMap(l =>
        l.kind === 'pattern' ? [[l.id, patternMarks(l, props.signs)]] : [],
      ),
    ),
);
</script>

<template>
  <div
    class="art"
    :class="[board, { finish }]"
    :style="{ ...spec.vars, width: `${width}px`, height: `${size.h * scale}px` }"
    data-testid="art-board"
    :data-board="board"
  >
    <div
      class="board"
      :style="{
        width: `${size.w}px`,
        height: `${size.h}px`,
        transform: `scale(${scale})`,
      }"
    >
      <template v-for="layer in visible" :key="layer.id">
        <div
          v-if="layer.kind === 'ground'"
          class="layer ground"
          :class="{ plain: !layer.fill }"
          :data-layer="layer.id"
        >
          <div
            v-for="(f, i) in fills(layer.fill ?? spec.background)"
            :key="i"
            class="fill"
            :style="f"
          />
        </div>
        <div
          v-else-if="layer.kind === 'window'"
          class="layer window"
          :data-layer="layer.id"
          :style="{ ...place(layer.rect), ...boxCss(layer.style) }"
        >
          <div class="view" :style="view(layer)">
            <PluginWindow :spec="specFor(layer)" :asset-urls="assetUrls" preview />
          </div>
          <div v-for="(f, i) in fills(layer.style?.fill)" :key="i" class="fill" :style="f" />
        </div>
        <div
          v-else-if="layer.kind === 'mark'"
          class="layer mark"
          :data-layer="layer.id"
          :style="{
            ...place(layer.rect),
            ...boxCss(layer.style),
            ...textCss(layer.textStyle, { font: 'font', size: 64, color: 'fg' }),
          }"
        >
          <div v-for="(f, i) in fills(layer.style?.fill)" :key="i" class="fill" :style="f" />
          <span class="text">{{ layer.text }}</span>
        </div>
        <div
          v-else
          class="layer pattern"
          :data-layer="layer.id"
          :style="{ ...place(layer.rect), ...boxCss(layer.style) }"
        >
          <div v-for="(f, i) in fills(layer.style?.fill)" :key="i" class="fill" :style="f" />
          <svg
            :viewBox="`0 0 ${layer.rect.w} ${layer.rect.h}`"
            :width="layer.rect.w"
            :height="layer.rect.h"
          >
            <g
              :transform="
                layer.rotate
                  ? `rotate(${layer.rotate} ${layer.rect.w / 2} ${layer.rect.h / 2})`
                  : undefined
              "
            >
              <path
                v-for="(m, i) in patterns.get(layer.id)"
                :key="i"
                :d="SIGN_PATHS[m.sign]?.d ?? SIGN_PATHS.dot!.d"
                :transform="`translate(${m.x} ${m.y}) scale(${m.size / 64})${m.flip ? ' translate(64 0) scale(-1 1)' : ''}${m.turn ? ` rotate(${m.turn} 32 32)` : ''}`"
                :style="
                  SIGN_PATHS[m.sign]?.fill
                    ? { fill: cssColor(m.color) }
                    : { fill: 'none', stroke: cssColor(m.color) }
                "
              />
            </g>
          </svg>
        </div>
      </template>
      <slot name="overlay" :scale="scale" />
    </div>
    <template v-if="finish">
      <div class="light" />
      <div class="grain" />
    </template>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  overflow: hidden;
  flex: none;
  background: var(--dk-bg);
  color: var(--dk-fg);
  font-family: var(--dk-font);
}
.board {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.layer {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
}
.ground {
  inset: 0;
}
.ground.plain {
  background: var(--dk-bg);
}
.fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
}
.view {
  position: absolute;
}
.mark {
  display: flex;
  white-space: pre-wrap;
}
.mark .text {
  position: relative;
}
.pattern svg {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.pattern path {
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* The shelf's frame: one shape, one light and one grain for every work's art. */
.art.finish.icon {
  border-radius: 22.5%;
}
.art.finish.cover {
  border-radius: 2.5% / 4.4%;
}
.art.finish {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    0 1px 2px rgba(0, 0, 0, 0.35),
    0 6px 18px rgba(0, 0, 0, 0.28);
}
.light,
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
}
.light {
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.22) 0%,
      rgba(255, 255, 255, 0.05) 38%,
      rgba(255, 255, 255, 0) 52%
    ),
    radial-gradient(120% 90% at 50% 120%, rgba(0, 0, 0, 0.28) 0%, rgba(0, 0, 0, 0) 60%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.grain {
  opacity: 0.16;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}
</style>

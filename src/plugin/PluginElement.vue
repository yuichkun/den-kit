<script setup lang="ts">
// One decoration on the plugin: text (or a control's value), a shape, a picture,
// SVG, a lamp, a canvas, or a code part (a part of the work's web project, from
// the pod). Its box (fills, border, shadows) is drawn the same way for every kind.
import { computed, inject, type Ref } from 'vue';
import { cssColor, type UiElement } from '../core/ui.ts';
import { formatValue, toUnit } from './format.ts';
import { boxCss, fillCss, textCss, type AssetUrl } from './css.ts';
import type { WidgetSpec } from './spec.ts';
import PluginCanvas from './PluginCanvas.vue';
import PluginCode from './PluginCode.vue';
import { LEVEL, type Meters } from './meters.ts';

const props = defineProps<{
  element: UiElement;
  url: AssetUrl;
  controls: Record<string, WidgetSpec>;
  editing?: boolean;
  /** The plugin plays: a canvas may take the mouse. */ play?: boolean;
  /** A look at the plugin (start screen, checks): a code part does not start the pod. */ preview?: boolean;
}>();
const emit = defineEmits<{
  (e: 'set', id: string, values: Record<string, number | boolean>, gesture: string): void;
}>();
const meters = inject<Ref<Meters> | null>(LEVEL, null);
const el = computed(() => props.element);
const box = computed(() =>
  boxCss(el.value.style, el.value.kind === 'shape' && el.value.shape === 'ellipse'),
);
const fills = computed(() =>
  (el.value.kind === 'shape' && el.value.shape === 'line' ? [] : (el.value.style?.fill ?? []))
    .map(f => fillCss(f, props.url))
    .filter(Boolean),
);

/** The bound control's reading: its value as text, and whether it counts as on. */
function reading(bind: string | undefined): { text: string; on: boolean; unit: number } {
  if (!bind) return { text: '', on: false, unit: 0 };
  if (bind === '@level') {
    const level = meters?.value.level ?? 0;
    return { text: level.toFixed(2), on: level > 0.02, unit: level };
  }
  const [id, key] = bind.split('.');
  const control = props.controls[id!];
  if (!control) return { text: '—', on: false, unit: 0 };
  const raw = control.values[key ?? (control.type === 'ui.xy' ? 'x' : 'value')];
  if (typeof raw === 'boolean') return { text: raw ? 'ON' : 'OFF', on: raw, unit: raw ? 1 : 0 };
  const n = Number(raw ?? 0);
  const unit =
    control.type === 'ui.xy'
      ? n
      : toUnit(
          n,
          Number(control.config.min ?? 0),
          Number(control.config.max ?? 1),
          control.config.scale === 'log',
        );
  return { text: formatValue(n, String(control.config.unit ?? '')), on: unit >= 0.5, unit };
}
const text = computed(() => {
  if (el.value.kind !== 'text') return '';
  if (!el.value.bind) return el.value.text;
  const value = reading(el.value.bind).text;
  return el.value.text.includes('{value}')
    ? el.value.text.replaceAll('{value}', value)
    : el.value.text
      ? `${el.value.text} ${value}`
      : value;
});
const lit = computed(() =>
  el.value.kind === 'led'
    ? reading(el.value.bind).unit >= el.value.threshold &&
      (el.value.bind !== '@level' || reading('@level').on)
    : false,
);
const ledColor = computed(() => (el.value.kind === 'led' ? cssColor(el.value.color) : ''));
const svgSrc = computed(() =>
  el.value.kind === 'svg'
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(el.value.svg)}`
    : '',
);
const stroke = computed(() =>
  el.value.style?.stroke
    ? { color: cssColor(el.value.style.stroke.color), width: el.value.style.stroke.width }
    : { color: 'var(--dk-fg)', width: 1 },
);
</script>

<template>
  <div
    class="el"
    :class="[`el-${el.kind}`]"
    :style="
      el.kind === 'shape' && el.shape === 'line'
        ? { opacity: box.opacity, transform: box.transform }
        : box
    "
    :data-kind="el.kind"
  >
    <div v-for="(f, i) in fills" :key="i" class="fill" :style="f!" />
    <div v-if="el.kind === 'text'" class="text" :style="textCss(el.textStyle)">{{ text }}</div>
    <svg
      v-else-if="el.kind === 'shape' && el.shape === 'line'"
      class="line"
      preserveAspectRatio="none"
    >
      <line
        v-if="el.rect.w >= el.rect.h"
        x1="0"
        :y1="el.rect.h / 2"
        :x2="el.rect.w"
        :y2="el.rect.h / 2"
        :style="{
          stroke: stroke.color,
          strokeWidth: stroke.width,
          strokeDasharray:
            el.style?.stroke?.style === 'dashed'
              ? '6 4'
              : el.style?.stroke?.style === 'dotted'
                ? '1 3'
                : undefined,
        }"
      />
      <line
        v-else
        :x1="el.rect.w / 2"
        y1="0"
        :x2="el.rect.w / 2"
        :y2="el.rect.h"
        :style="{ stroke: stroke.color, strokeWidth: stroke.width }"
      />
    </svg>
    <img
      v-else-if="el.kind === 'image' && url(el.asset)"
      class="pic"
      :src="url(el.asset)!"
      :style="{ objectFit: el.fit === 'stretch' ? 'fill' : el.fit }"
      alt=""
      draggable="false"
    />
    <div v-else-if="el.kind === 'image'" class="missing">picture missing</div>
    <img v-else-if="el.kind === 'svg'" class="pic" :src="svgSrc" alt="" draggable="false" />
    <div
      v-else-if="el.kind === 'led'"
      class="led"
      :class="{ lit }"
      :style="{ '--led': ledColor }"
    />
    <PluginCanvas
      v-else-if="el.kind === 'canvas'"
      :element="el"
      :controls="controls"
      :play="play"
      @set="(id, values, gesture) => emit('set', id, values, gesture)"
    />
    <PluginCode
      v-else-if="el.kind === 'code'"
      :element="el"
      :controls="controls"
      :url="url"
      :play="play"
      :preview="preview"
      @set="(id, values, gesture) => emit('set', id, values, gesture)"
    />
  </div>
</template>

<style scoped>
.el {
  position: absolute;
  inset: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.el-shape.el-line,
.el-led,
.el-text {
  overflow: visible;
}
.fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}
.text {
  position: absolute;
  inset: 0;
  display: flex;
  white-space: pre-wrap;
  line-height: 1.15;
  overflow: visible;
}
.line {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.pic {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.missing {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 11px system-ui;
  color: #999;
  background: repeating-linear-gradient(45deg, #8882 0 6px, #0000 6px 12px);
}
.led {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 40% 35%,
    color-mix(in srgb, var(--led) 35%, #333),
    color-mix(in srgb, var(--led) 18%, #000) 70%
  );
  box-shadow: inset 0 1px 2px #000a;
}
.led.lit {
  background: radial-gradient(
    circle at 40% 35%,
    color-mix(in srgb, var(--led) 40%, #fff),
    var(--led) 55%,
    color-mix(in srgb, var(--led) 70%, #000)
  );
  box-shadow:
    0 0 calc(var(--led-glow, 8px)) 2px var(--led),
    inset 0 -1px 2px #0005;
}
</style>

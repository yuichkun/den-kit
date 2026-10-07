<script setup lang="ts">
// The plugin window: the panel at its design size, scaled to whatever window it
// gets and centered on the theme's background, the way a plugin fits any window
// size. Playing happens here (widget changes and notes go out as events); editing
// does not: the plugin view lays its edit layer over each widget (`cell` slot)
// and the panel (`overlay`).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PANEL_THEMES } from '../widgets/widgets.ts';
import type { PluginSpec, WidgetSpec } from './spec.ts';

const props = defineProps<{
  spec: PluginSpec;
  /** Notes held (the keyboard widget lights them). */
  held?: readonly number[];
  /** The analyser a scope or meter draws (probe channel, -1: the plugin's output). */
  analyser?: (probe: number) => AnalyserNode | null;
}>();
const emit = defineEmits<{
  /** A control moved; `done` when the gesture ends (release, or a click that sets it at once). */
  (e: 'change', widget: string, values: Record<string, number | boolean>, done: boolean): void;
  (e: 'note', note: number, on: boolean): void;
}>();

const theme = computed(() => PANEL_THEMES[props.spec.theme] ?? PANEL_THEMES.graphite!);
const stage = ref<HTMLElement | null>(null);
const box = ref({ w: 0, h: 0 });
const scale = computed(() => box.value.w && box.value.h ? Math.min(box.value.w / props.spec.width, box.value.h / props.spec.height) : 1);
const placement = computed(() => ({
  left: `${(box.value.w - props.spec.width * scale.value) / 2}px`, top: `${(box.value.h - props.spec.height * scale.value) / 2}px`,
  width: `${props.spec.width}px`, height: `${props.spec.height}px`, transform: `scale(${scale.value})`,
}));
defineExpose({ scale });

const text = (w: WidgetSpec, key: string) => { const v = w.values[key] ?? w.config[key]; return v === undefined ? '' : String(v); };
function onWidget(w: WidgetSpec, e: Event, done: boolean) {
  const detail = (e as CustomEvent).detail;
  emit('change', w.id, w.type === 'ui.xy' ? { x: detail.x, y: detail.y } : { value: detail }, done);
}
function onNote(e: Event) { const d = (e as CustomEvent<{ note: number; on: boolean }>).detail; emit('note', d.note, d.on); }

let observer: ResizeObserver | null = null;
let raf = 0;
onMounted(() => {
  observer = new ResizeObserver(entries => { const r = entries[0]!.contentRect; box.value = { w: r.width, h: r.height }; });
  if (stage.value) observer.observe(stage.value);
  // Scopes and meters draw themselves from the analyser they are given.
  const tick = () => {
    for (const el of stage.value?.querySelectorAll<HTMLElement & { analyser?: AnalyserNode | null }>('dk-scope[data-probe]') ?? []) el.analyser = props.analyser?.(Number(el.dataset.probe)) ?? null;
    raf = requestAnimationFrame(tick);
  };
  tick();
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(raf); });
</script>

<template>
  <div ref="stage" class="plugin-window" :style="{ background: theme['--dk-bg'] }" data-testid="plugin-window">
    <div class="panel" :style="{ ...placement, ...theme, background: theme['--dk-bg'] }" data-testid="panel" :data-scale="scale.toFixed(3)">
      <div v-for="w in spec.widgets" :key="w.id" class="cell" :data-widget="w.id" :style="{ left: `${w.rect.x}px`, top: `${w.rect.y}px`, width: `${w.rect.w}px`, height: `${w.rect.h}px` }">
        <dk-knob v-if="w.type === 'ui.knob'" :value="text(w, 'value')" :min="text(w, 'min')" :max="text(w, 'max')" :scale="text(w, 'scale')" :unit="text(w, 'unit')" :label="w.label" :default="text(w, 'default')" @input="onWidget(w, $event, false)" @change="onWidget(w, $event, true)" />
        <dk-slider v-else-if="w.type === 'ui.slider'" :value="text(w, 'value')" :min="text(w, 'min')" :max="text(w, 'max')" :scale="text(w, 'scale')" :unit="text(w, 'unit')" :label="w.label" @input="onWidget(w, $event, false)" @change="onWidget(w, $event, true)" />
        <dk-toggle v-else-if="w.type === 'ui.toggle' || w.type === 'ui.button'" :value="text(w, 'value')" :label="w.label" :momentary="w.type === 'ui.button' ? '' : undefined" @input="onWidget(w, $event, false)" @change="onWidget(w, $event, true)" />
        <dk-xy v-else-if="w.type === 'ui.xy'" :x="text(w, 'x')" :y="text(w, 'y')" :label="w.label" @input="onWidget(w, $event, false)" @change="onWidget(w, $event, true)" />
        <dk-keyboard v-else-if="w.type === 'ui.keyboard'" octave="3" :held="(held ?? []).join(',')" @note="onNote" />
        <dk-scope v-else-if="w.type === 'ui.scope' || w.type === 'ui.meter'" :data-probe="w.probe" :mode="w.type === 'ui.meter' ? 'meter' : 'scope'" :label="w.label" />
        <slot name="cell" :widget="w" :scale="scale" />
      </div>
      <slot v-if="!spec.widgets.length" name="empty" />
      <slot name="overlay" :scale="scale" />
    </div>
  </div>
</template>

<style scoped>
.plugin-window { position: relative; width: 100%; height: 100%; overflow: hidden; }
.panel { position: absolute; transform-origin: 0 0; color: var(--dk-fg); }
.cell { position: absolute; }
</style>

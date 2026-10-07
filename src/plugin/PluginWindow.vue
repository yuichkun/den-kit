<script setup lang="ts">
// The plugin window: the plugin at its design size, scaled to whatever window it
// gets and centred on its background, the way a plugin fits any window size. It
// draws everything on the plugin back to front: the look's background, the
// widgets in their skins, and the decorations (text, shapes, pictures, SVG,
// lamps, custom parts), then the look's CSS, scoped to this plugin. Playing
// happens here (widget changes and notes go out as events); editing does not: the
// plugin view lays its edit layer over each item (`cell` slot) and the plugin (`overlay`).
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef } from 'vue';
import { skinParams } from '../core/skins.ts';
import { sanitizeCss } from '../core/ui.ts';
import { boxCss, fillCss, widgetVars, type AssetUrl } from './css.ts';
import { LEVEL, TAP, analyserTap, type Meters } from './meters.ts';
import type { PluginSpec, WidgetSpec } from './spec.ts';
import PluginElement from './PluginElement.vue';

const props = defineProps<{
  spec: PluginSpec;
  /** Notes held (the keyboard widget lights them). */
  held?: readonly number[];
  /** The analyser a scope or meter draws (probe channel, -1: the plugin's output). */
  analyser?: (probe: number) => AnalyserNode | null;
  /** Asset id → URL (pictures and fonts not loaded yet are left out). */
  assetUrls?: Readonly<Record<string, string>>;
  /** Editing: the reference picture (underlay) shows under the plugin. */
  editing?: boolean;
  /** A small look at the plugin (start screen): nothing reacts to the mouse. */
  preview?: boolean;
}>();
const emit = defineEmits<{
  /** A control moved; `done` when the gesture ends (release, or a click that sets it at once). A custom part names its gesture (one press can move several controls). */
  (e: 'change', widget: string, values: Record<string, number | boolean>, done: boolean, gesture?: string): void;
  (e: 'note', note: number, on: boolean): void;
}>();

const url: AssetUrl = id => props.assetUrls?.[id] ?? null;
const stage = ref<HTMLElement | null>(null);
const box = ref({ w: 0, h: 0 });
const scale = computed(() => box.value.w && box.value.h ? Math.min(box.value.w / props.spec.width, box.value.h / props.spec.height) : 1);
const placement = computed(() => ({
  left: `${(box.value.w - props.spec.width * scale.value) / 2}px`, top: `${(box.value.h - props.spec.height * scale.value) / 2}px`,
  width: `${props.spec.width}px`, height: `${props.spec.height}px`, transform: `scale(${scale.value})`,
}));
defineExpose({ scale });
const scopeId = `p${Math.random().toString(36).slice(2, 9)}`;
const background = computed(() => props.spec.background.map(f => fillCss(f, url)).filter(Boolean));
const css = computed(() => props.spec.css ? `@scope ([data-plugin-root="${scopeId}"]) {\n${sanitizeCss(props.spec.css, url)}\n}` : '');
const underlay = computed(() => props.editing && props.spec.underlay?.visible ? { src: url(props.spec.underlay.asset), opacity: props.spec.underlay.opacity } : null);

const text = (w: WidgetSpec, key: string) => { const v = w.values[key] ?? w.config[key]; return v === undefined ? '' : String(v); };
/** The skin's parameters with defaults, pictures as URLs. */
function params(w: WidgetSpec): string {
  const { def, params } = skinParams(w.control, w.skin);
  const out: Record<string, unknown> = { ...params };
  for (const p of def.params) if (p.kind === 'asset') out[p.id] = typeof params[p.id] === 'string' && params[p.id] ? url(params[p.id] as string) ?? '' : '';
  return JSON.stringify(out);
}
const cellStyle = (rect: { x: number; y: number; w: number; h: number }) => ({ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
function onWidget(w: WidgetSpec, e: Event, done: boolean) {
  const detail = (e as CustomEvent).detail;
  emit('change', w.id, w.type === 'ui.xy' ? { x: detail.x, y: detail.y } : { value: detail }, done);
}
function onNote(e: Event) { const d = (e as CustomEvent<{ note: number; on: boolean }>).detail; emit('note', d.note, d.on); }

// The sound, for lamps and custom parts.
const meters = shallowRef<Meters>({ level: 0, peak: 0 });
const tap = analyserTap(() => props.analyser?.(-1) ?? null);
provide(LEVEL, meters);
provide(TAP, tap);
const wave = new Float32Array(256), spectrum = new Float32Array(64);

let observer: ResizeObserver | null = null;
let raf = 0;
onMounted(() => {
  observer = new ResizeObserver(entries => { const r = entries[0]!.contentRect; box.value = { w: r.width, h: r.height }; });
  if (stage.value) observer.observe(stage.value);
  // Scopes and meters draw themselves from the analyser they are given; lamps read the level.
  const tick = () => {
    for (const el of stage.value?.querySelectorAll<HTMLElement & { analyser?: AnalyserNode | null }>('dk-scope[data-probe]') ?? []) el.analyser = props.analyser?.(Number(el.dataset.probe)) ?? null;
    const m = tap.read(wave, spectrum);
    if (Math.abs(m.level - meters.value.level) > 0.002 || Math.abs(m.peak - meters.value.peak) > 0.002) meters.value = m;
    raf = requestAnimationFrame(tick);
  };
  tick();
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(raf); });
</script>

<template>
  <div ref="stage" class="plugin-window" :class="{ preview }" :style="{ ...spec.vars, background: 'var(--dk-bg)' }" data-testid="plugin-window">
    <div class="panel" :class="{ clip: !editing }" :style="placement" :data-plugin-root="scopeId" data-testid="panel" :data-scale="scale.toFixed(3)">
      <div v-for="(f, i) in background" :key="`bg${i}`" class="fill" :style="f!" />
      <img v-if="underlay?.src" class="underlay" :src="underlay.src" :style="{ opacity: underlay.opacity }" alt="" draggable="false" data-testid="underlay" />
      <template v-for="item in spec.items" :key="item.id">
        <div v-if="item.kind === 'widget'" class="cell" :data-item="item.id" :data-widget="item.id" :style="{ ...cellStyle(item.widget.rect!), ...boxCss(item.widget.style?.style), ...widgetVars(item.widget.style) }">
          <div v-for="(f, i) in (item.widget.style?.style?.fill ?? []).map(x => fillCss(x, url)).filter(Boolean)" :key="`f${i}`" class="fill" :style="f!" />
          <dk-knob v-if="item.widget.type === 'ui.knob'" :value="text(item.widget, 'value')" :min="text(item.widget, 'min')" :max="text(item.widget, 'max')" :scale="text(item.widget, 'scale')" :unit="text(item.widget, 'unit')" :label="item.widget.label" :default="text(item.widget, 'default')" :skin="item.widget.skin.name" :params="params(item.widget)" @input="onWidget(item.widget, $event, false)" @change="onWidget(item.widget, $event, true)" />
          <dk-slider v-else-if="item.widget.type === 'ui.slider'" :value="text(item.widget, 'value')" :min="text(item.widget, 'min')" :max="text(item.widget, 'max')" :scale="text(item.widget, 'scale')" :unit="text(item.widget, 'unit')" :label="item.widget.label" :skin="item.widget.skin.name" :params="params(item.widget)" @input="onWidget(item.widget, $event, false)" @change="onWidget(item.widget, $event, true)" />
          <dk-toggle v-else-if="item.widget.type === 'ui.toggle' || item.widget.type === 'ui.button'" :value="text(item.widget, 'value')" :label="item.widget.label" :momentary="item.widget.type === 'ui.button' ? '' : undefined" :skin="item.widget.skin.name" :params="params(item.widget)" @input="onWidget(item.widget, $event, false)" @change="onWidget(item.widget, $event, true)" />
          <dk-xy v-else-if="item.widget.type === 'ui.xy'" :x="text(item.widget, 'x')" :y="text(item.widget, 'y')" :label="item.widget.label" :skin="item.widget.skin.name" :params="params(item.widget)" @input="onWidget(item.widget, $event, false)" @change="onWidget(item.widget, $event, true)" />
          <dk-keyboard v-else-if="item.widget.type === 'ui.keyboard'" :held="(held ?? []).join(',')" :skin="item.widget.skin.name" :params="params(item.widget)" @note="onNote" />
          <dk-scope v-else-if="item.widget.type === 'ui.scope' || item.widget.type === 'ui.meter'" :data-probe="item.widget.probe" :mode="item.widget.type === 'ui.meter' ? 'meter' : 'scope'" :label="item.widget.label" :skin="item.widget.skin.name" :params="params(item.widget)" />
          <slot name="cell" :item="item" :scale="scale" />
        </div>
        <div v-else class="cell" :data-item="item.id" :data-element="item.id" :style="cellStyle(item.element.rect)">
          <PluginElement :element="item.element" :url="url" :controls="spec.controls" :editing="editing" :play="!editing && !preview" @set="(id, values, gesture) => emit('change', id, values, false, gesture)" />
          <slot name="cell" :item="item" :scale="scale" />
        </div>
      </template>
      <slot v-if="!spec.items.length" name="empty" />
      <component :is="'style'" v-if="css">{{ css }}</component>
      <slot name="overlay" :scale="scale" />
    </div>
  </div>
</template>

<style scoped>
.plugin-window { position: relative; width: 100%; height: 100%; overflow: hidden; }
.plugin-window.preview { pointer-events: none; }
.panel { position: absolute; transform-origin: 0 0; color: var(--dk-fg); font-family: var(--dk-font); background: var(--dk-bg); }
.fill { position: absolute; inset: 0; pointer-events: none; border-radius: inherit; }
.underlay { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.cell { position: absolute; box-sizing: border-box; }
/* Decorations never catch the mouse: the controls under them still play (a custom part that handles the mouse takes it while playing). */
.cell[data-element] { pointer-events: none; }
.panel.clip { overflow: hidden; }
</style>

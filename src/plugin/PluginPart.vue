<script setup lang="ts">
// A custom part: its code draws on a canvas every frame, in a worker
// (part.worker.ts), fed with the time, the plugin's sound, the controls' values
// and the look's colours. A broken or slow part shows its error in its box and
// never stops the rest of the plugin.
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { COLOR_TOKENS, tokenVar, type PartElement } from '../core/ui.ts';
import { toUnit } from './format.ts';
import { TAP } from './meters.ts';
import { PartRunner, type PartFrame } from './part-runtime.ts';
import type { WidgetSpec } from './spec.ts';

const props = defineProps<{ element: PartElement; controls: Record<string, WidgetSpec> }>();
const emit = defineEmits<{ (e: 'status', error: string | null, line?: number): void }>();
const tap = inject(TAP, null);
const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref<string | null>(null);
let runner: PartRunner | null = null;
let raf = 0, last = 0, colorsAt = 0, observer: ResizeObserver | null = null;
let colors: Record<string, string> = {};

function size() {
  const el = canvas.value!;
  const box = el.getBoundingClientRect();
  const w = props.element.rect.w, h = props.element.rect.h;
  return { w, h, ratio: Math.min(4, Math.max(0.25, (box.width / Math.max(1, w)) * devicePixelRatio)) };
}
function readColors() {
  const style = getComputedStyle(canvas.value!);
  colors = Object.fromEntries(COLOR_TOKENS.map(t => [t, style.getPropertyValue(tokenVar(t)).trim() || '#888']));
}
function frame(t: number): PartFrame {
  const wave = new Float32Array(256), spectrum = new Float32Array(64);
  const m = tap?.read(wave, spectrum) ?? { level: 0, peak: 0 };
  const values: PartFrame['values'] = {}, norms: Record<string, number> = {};
  for (const c of Object.values(props.controls)) {
    if (c.type === 'ui.xy') { values[c.id] = { x: Number(c.values.x ?? 0.5), y: Number(c.values.y ?? 0.5) }; norms[c.id] = Number(c.values.x ?? 0.5); continue; }
    const v = c.values.value; if (v === undefined) continue;
    values[c.id] = v;
    norms[c.id] = typeof v === 'boolean' ? (v ? 1 : 0) : toUnit(v, Number(c.config.min ?? 0), Number(c.config.max ?? 1), c.config.scale === 'log');
  }
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
  last = t;
  return { t: t / 1000, dt, level: m.level, peak: m.peak, wave, spectrum, values, norms, colors };
}
function tick(t: number) {
  raf = requestAnimationFrame(tick);
  if (!runner || runner.stopped || !canvas.value) return;
  if (t - colorsAt > 500) { readColors(); colorsAt = t; }
  runner.frame(() => frame(t));
}
// A canvas can be handed to a worker only once: every (re)start renders a fresh one.
const generation = ref(0);
async function start() {
  runner?.stop(); runner = null;
  error.value = null;
  generation.value++;
  await nextTick();
  const el = canvas.value; if (!el) return;
  observer?.disconnect();
  observer = new ResizeObserver(() => runner?.resize(size()));
  observer.observe(el);
  readColors();
  runner = new PartRunner(el, props.element.code, props.element.props, size(), s => { error.value = s.error ? `${s.error}${s.line ? ` (line ${s.line})` : ''}` : null; emit('status', s.error, s.line); });
}
onMounted(() => { void start(); raf = requestAnimationFrame(tick); });
onBeforeUnmount(() => { cancelAnimationFrame(raf); observer?.disconnect(); runner?.stop(); });
watch(() => props.element.code, () => { void start(); });
watch(() => JSON.stringify(props.element.props), () => runner?.setProps(props.element.props));
watch(() => [props.element.rect.w, props.element.rect.h], () => runner?.resize(size()));
</script>

<template>
  <div class="part-box" :data-part-error="error ?? undefined">
    <canvas :key="generation" ref="canvas" class="part" />
    <div v-if="error" class="error" data-testid="part-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.part-box { position: absolute; inset: 0; }
.part-box :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.error { position: absolute; left: 4px; right: 4px; bottom: 4px; padding: 3px 6px; border-radius: 4px; background: #300c; color: #ffb3b3; font: 11px/1.3 ui-monospace, Menlo, monospace; white-space: pre-wrap; max-height: 60%; overflow: hidden; }
</style>

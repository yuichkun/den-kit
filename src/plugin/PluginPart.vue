<script setup lang="ts">
// A custom part: its code draws on a canvas every frame, in a worker
// (part.worker.ts), fed with the time, the plugin's sound, the controls' values
// and ranges, the look's colours and the mouse. A part that exports pointer()
// takes the mouse while the plugin plays and can move controls (f.set): what it
// writes during one press, or one burst of wheel turns, is one gesture, so one
// ⌘Z takes it back, as with a knob. A broken or slow part shows its error in its
// box and never stops the rest of the plugin.
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { COLOR_TOKENS, tokenVar, type PartElement } from '../core/ui.ts';
import { toUnit } from './format.ts';
import { TAP } from './meters.ts';
import { NO_POINTER, PART_CURSORS, type PartPointer, type PartPointerEvent, type PartPointerType } from './part-api.ts';
import { PART_CANVASES, PartRunner, type PartFrame } from './part-runtime.ts';
import type { WidgetSpec } from './spec.ts';

const props = defineProps<{ element: PartElement; controls: Record<string, WidgetSpec>; /** The plugin plays (not editing, not a preview): the part may take the mouse and move controls. */ play?: boolean }>();
const emit = defineEmits<{
  (e: 'status', error: string | null, line?: number): void;
  /** The part moved a control, as part of `gesture` (one press, or one burst of wheel turns). */
  (e: 'set', id: string, values: Record<string, number | boolean>, gesture: string): void;
}>();
const tap = inject(TAP, null);
const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref<string | null>(null);
const interactive = ref(false);
const cursor = ref('default');
let runner: PartRunner | null = null;
let raf = 0, last = 0, colorsAt = 0, observer: ResizeObserver | null = null;
let colors: Record<string, string> = {};

function size() {
  const el = canvas.value!;
  const rect = el.getBoundingClientRect();
  const w = props.element.rect.w, h = props.element.rect.h;
  return { w, h, ratio: Math.min(4, Math.max(0.25, (rect.width / Math.max(1, w)) * devicePixelRatio)) };
}
function readColors() {
  const style = getComputedStyle(canvas.value!);
  colors = Object.fromEntries(COLOR_TOKENS.map(t => [t, style.getPropertyValue(tokenVar(t)).trim() || '#888']));
}
function frame(t: number): PartFrame {
  const wave = new Float32Array(256), spectrum = new Float32Array(64);
  const m = tap?.read(wave, spectrum) ?? { level: 0, peak: 0 };
  const values: PartFrame['values'] = {}, norms: Record<string, number> = {}, ranges: PartFrame['ranges'] = {};
  for (const c of Object.values(props.controls)) {
    if (c.type === 'ui.xy') { values[c.id] = { x: Number(c.values.x ?? 0.5), y: Number(c.values.y ?? 0.5) }; norms[c.id] = Number(c.values.x ?? 0.5); ranges[c.id] = { min: 0, max: 1, log: false, unit: '' }; continue; }
    const v = c.values.value; if (v === undefined) continue;
    values[c.id] = v;
    const min = Number(c.config.min ?? 0), max = Number(c.config.max ?? 1), log = c.config.scale === 'log';
    ranges[c.id] = { min, max, log, unit: String(c.config.unit ?? '') };
    norms[c.id] = typeof v === 'boolean' ? (v ? 1 : 0) : toUnit(v, min, max, log);
  }
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
  last = t;
  return { t: t / 1000, dt, level: m.level, peak: m.peak, wave, spectrum, values, norms, ranges, colors, pointer: { ...pointer } };
}
function tick(t: number) {
  raf = requestAnimationFrame(tick);
  if (!runner || runner.stopped || !canvas.value) return;
  if (t - colorsAt > 500) { readColors(); colorsAt = t; }
  runner.frame(() => frame(t));
}

// ---- the mouse ---------------------------------------------------------------------------
let pointer: PartPointer = { ...NO_POINTER };
/**
 * The gesture the part's writes belong to: a press (it ends once the worker has
 * handled the release), or loose writes (wheel turns, drawing) that end after a
 * pause. Writes that share a gesture merge into one undo step; ending one sends
 * nothing (sending the last values again could land after a ⌘Z and redo it).
 */
let gesture: { key: string; press: boolean; releaseSeq: number | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
let gestures = 0;
const QUIET_MS = 400;
function startGesture(press: boolean) {
  endGesture();
  gesture = { key: `part-${props.element.id}-${++gestures}-${Date.now()}`, press, releaseSeq: null, timer: null };
  return gesture;
}
function endGesture() {
  if (gesture?.timer) clearTimeout(gesture.timer);
  gesture = null;
}
function onSet(id: string, values: Record<string, number | boolean>) {
  if (!props.play) return;
  const g = gesture ?? startGesture(false);
  emit('set', id, values, g.key);
  if (!g.press) { if (g.timer) clearTimeout(g.timer); g.timer = setTimeout(() => { if (gesture === g) endGesture(); }, QUIET_MS); }
}
function onHandled(seq: number) { if (gesture?.press && gesture.releaseSeq === seq) endGesture(); }

/** The event's point in the part's own pixels (the part may be scaled with the plugin, and turned). */
function local(e: MouseEvent): { x: number; y: number } {
  const r = box.value!.getBoundingClientRect();
  const w = props.element.rect.w, h = props.element.rect.h;
  const deg = props.element.style?.rotate ?? 0;
  if (!deg) return { x: (e.clientX - r.left) / Math.max(1e-6, r.width) * w, y: (e.clientY - r.top) / Math.max(1e-6, r.height) * h };
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const k = r.width / Math.max(1e-6, w * Math.abs(c) + h * Math.abs(s));
  const dx = (e.clientX - (r.left + r.width / 2)) / k, dy = (e.clientY - (r.top + r.height / 2)) / k;
  return { x: w / 2 + dx * c + dy * s, y: h / 2 - dx * s + dy * c };
}
function send(type: PartPointerType, e: MouseEvent, extra: { dx?: number; dy?: number; over?: boolean; down?: boolean } = {}): number {
  const p = local(e);
  const dx = extra.dx ?? p.x - pointer.x, dy = extra.dy ?? p.y - pointer.y;
  pointer = { x: p.x, y: p.y, over: extra.over ?? pointer.over, down: extra.down ?? pointer.down, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey };
  const event: PartPointerEvent = { type, x: p.x, y: p.y, dx, dy, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey };
  return runner?.pointer(event, { ...pointer }) ?? -1;
}
const live = () => props.play && interactive.value && runner && !runner.stopped;
function down(e: PointerEvent) {
  if (!live() || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  box.value!.setPointerCapture(e.pointerId);
  startGesture(true);
  send('down', e, { down: true, over: true, dx: 0, dy: 0 });
}
function move(e: PointerEvent) { if (live()) send('move', e, { over: true }); }
function up(e: PointerEvent) {
  if (!live() || !pointer.down) return;
  const seq = send('up', e, { down: false });
  if (gesture?.press) { if (seq < 0) endGesture(); else gesture.releaseSeq = seq; }
}
function leave(e: PointerEvent) { if (live() && !pointer.down) send('leave', e, { over: false }); }
function wheel(e: WheelEvent) {
  if (!live()) return;
  e.preventDefault();
  const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
  send('wheel', e, { dx: e.deltaX * scale, dy: e.deltaY * scale, over: true });
}
function dbl(e: MouseEvent) { if (live()) { e.preventDefault(); send('double', e, { over: true }); } }

// A canvas can be handed to a worker only once: every (re)start renders a fresh one.
const generation = ref(0);
async function start() {
  endGesture();
  runner?.stop(); runner = null;
  error.value = null; interactive.value = false; cursor.value = 'default';
  generation.value++;
  await nextTick();
  const el = canvas.value; if (!el) return;
  observer?.disconnect();
  observer = new ResizeObserver(() => runner?.resize(size()));
  observer.observe(el);
  readColors();
  runner = new PartRunner(el, props.element.code, props.element.props, size(), {
    status: s => { error.value = s.error ? `${s.error}${s.line ? ` (line ${s.line})` : ''}` : null; emit('status', s.error, s.line); if (s.error) endGesture(); },
    loaded: on => { interactive.value = on; },
    set: onSet,
    cursor: c => { if ((PART_CURSORS as readonly string[]).includes(c)) cursor.value = c; },
    handled: onHandled,
  });
  PART_CANVASES.set(el, runner);
}
onMounted(() => { void start(); raf = requestAnimationFrame(tick); box.value?.addEventListener('wheel', wheel, { passive: false }); });
onBeforeUnmount(() => { endGesture(); cancelAnimationFrame(raf); observer?.disconnect(); runner?.stop(); box.value?.removeEventListener('wheel', wheel); });
watch(() => props.element.code, () => { void start(); });
watch(() => JSON.stringify(props.element.props), () => runner?.setProps(props.element.props));
watch(() => [props.element.rect.w, props.element.rect.h], () => runner?.resize(size()));
watch(() => props.play, play => { if (!play) { endGesture(); pointer = { ...NO_POINTER }; } });
</script>

<template>
  <div ref="box" class="part-box" :class="{ live: play && interactive }" :style="play && interactive ? { cursor } : undefined" :data-part-error="error ?? undefined" :data-interactive="interactive ? '' : undefined" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="leave" @dblclick="dbl">
    <canvas :key="generation" ref="canvas" class="part" />
    <div v-if="error" class="error" data-testid="part-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.part-box { position: absolute; inset: 0; }
/* Only a part that handles the mouse catches it, and only while the plugin plays; otherwise the controls under it play. */
.part-box.live { pointer-events: auto; touch-action: none; }
.part-box :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.error { position: absolute; left: 4px; right: 4px; bottom: 4px; padding: 3px 6px; border-radius: 4px; background: #300c; color: #ffb3b3; font: 11px/1.3 ui-monospace, Menlo, monospace; white-space: pre-wrap; max-height: 60%; overflow: hidden; }
</style>

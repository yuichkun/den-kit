<script setup lang="ts">
// The person's rough sketch over a view (U8c): pen and marker strokes, boxes,
// arrows, sticky notes and texts, kept in the view's own coordinates (the
// plugin's design pixels, the patch's positions) so they stay put when the
// view zooms, scrolls or scales. Marks are for the AI: not part of the work,
// not in the undo history. A stylus draws on touch; otherwise pick a tool
// (the ✎ in the AI panel, or P). Sent marks stay, dimmed, while the AI works.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSession } from './context.ts';
import type { Mark, Point, SketchView } from '../ai/sketch.ts';

const props = defineProps<{ view: SketchView; /** The plugin: its design size. */ width?: number; height?: number; /** The patch: the viewport transform. */ viewport?: { x: number; y: number; zoom: number } }>();
const session = useSession();
const svg = ref<SVGSVGElement | null>(null);
const layer = ref<SVGGElement | null>(null);
const marks = computed(() => session.marksHere(props.view));
const sent = computed(() => session.sentMarks.value);
const here = computed(() => session.seeing.value.view === props.view);
const tool = computed(() => here.value ? session.inking.value : null);
const zoom = computed(() => props.viewport?.zoom ?? 1);
type Draft = Mark & { start?: Point };
const draft = ref<Draft | null>(null);
const editing = ref<string | null>(null);
const typed = ref('');

/** A pointer's place in the view's coordinates. */
function toView(e: { clientX: number; clientY: number }): Point {
  const m = layer.value?.getScreenCTM();
  if (!m) return [0, 0];
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
}
const strokeWidth = (kind: Mark['kind']) => (kind === 'marker' ? 14 : 3) / zoom.value;

function start(e: PointerEvent, kind: NonNullable<typeof session.inking.value>) {
  if (editing.value) { finishText(); return; }
  if (kind === 'eraser') {
    const id = (e.target as Element | null)?.closest?.('[data-mark]')?.getAttribute('data-mark');
    if (id && !sent.value[id]) session.removeMark(props.view, id);
    return;
  }
  const p = toView(e);
  const color = session.inkColor.value;
  if (kind === 'note' || kind === 'text') {
    const w = (kind === 'note' ? 180 : 220) / zoom.value, h = (kind === 'note' ? 96 : 40) / zoom.value;
    const added = session.addMark(props.view, { kind, color, rect: { x: p[0], y: p[1], w, h }, text: '' });
    editing.value = added.id; typed.value = '';
    void nextTick(() => svg.value?.querySelector<HTMLTextAreaElement>(`[data-mark="${added.id}"] textarea`)?.focus());
    return;
  }
  draft.value = kind === 'pen' || kind === 'marker' ? { id: 'draft', n: 0, kind, color, points: [p], width: strokeWidth(kind) }
    : kind === 'rect' ? { id: 'draft', n: 0, kind, color, rect: { x: p[0], y: p[1], w: 0, h: 0 }, start: p }
    : { id: 'draft', n: 0, kind: 'arrow', color, from: p, to: p };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
function down(e: PointerEvent) {
  const kind = tool.value;
  if (!kind || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault(); e.stopPropagation();
  start(e, kind);
}
/** Where a stylus touches nothing (the plugin's background, the patch's empty canvas): there it draws. */
const NOTHING_THERE = props.view === 'plugin' ? '[data-testid=panel]' : '.vue-flow__pane';
const SOMETHING = '[data-item], .vue-flow__node, .vue-flow__edge, .vue-flow__handle, button, input, textarea, select, [contenteditable], [data-testid=ink-bar]';
/** A stylus draws a pen stroke where it touches nothing, without picking the pen first (on a knob or a module it works as usual). */
function stylus(e: PointerEvent) {
  if (e.pointerType !== 'pen' || tool.value || !session.stylusDraws.value || !here.value || draft.value) return;
  const target = e.target as Element | null;
  const container = svg.value?.closest('[data-testid=plugin-view], [data-testid=patch-view]');
  if (!target || !container?.contains(target) || !target.closest(NOTHING_THERE) || target.closest(SOMETHING)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  session.stylusNoticed();
  start(e, 'pen');
}
function move(e: PointerEvent) {
  const d = draft.value;
  if (!d) return;
  const p = toView(e);
  if (d.points) { const last = d.points.at(-1)!; if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5 / zoom.value) draft.value = { ...d, points: [...d.points, p] }; }
  else if (d.rect && d.start) draft.value = { ...d, rect: { x: Math.min(d.start[0], p[0]), y: Math.min(d.start[1], p[1]), w: Math.abs(p[0] - d.start[0]), h: Math.abs(p[1] - d.start[1]) } };
  else if (d.from) draft.value = { ...d, to: p };
}
function end() {
  window.removeEventListener('pointermove', move);
  window.removeEventListener('pointerup', end);
  window.removeEventListener('pointercancel', end);
  const d = draft.value;
  draft.value = null;
  if (!d) return;
  const min = 6 / zoom.value;
  const { id: _id, n: _n, start: _start, ...mark } = d;
  if (d.points && d.points.length >= 2) session.addMark(props.view, mark);
  else if (d.rect && d.rect.w >= min && d.rect.h >= min) session.addMark(props.view, mark);
  else if (d.from && d.to && Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) >= 10 / zoom.value) session.addMark(props.view, mark);
}
/** While drawing, the wheel and pinch still pan and zoom what is under the layer (the patch). */
function wheel(e: WheelEvent) {
  const el = svg.value;
  if (!tool.value || !el || !props.viewport) return;
  el.style.pointerEvents = 'none';
  const below = document.elementFromPoint(e.clientX, e.clientY);
  el.style.pointerEvents = '';
  if (!below || el.contains(below)) return;
  e.preventDefault();
  below.dispatchEvent(new WheelEvent('wheel', e));
}
function finishText() {
  const id = editing.value;
  editing.value = null;
  if (!id) return;
  const text = typed.value.trim().slice(0, 300);
  if (text) session.updateMark(props.view, id, { text });
  else session.removeMark(props.view, id);
}
function textKey(e: KeyboardEvent) {
  if (e.isComposing) return;
  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishText(); }
}
onMounted(() => window.addEventListener('pointerdown', stylus, true));
onBeforeUnmount(() => { window.removeEventListener('pointerdown', stylus, true); end(); });

const pts = (p?: Point[]) => (p ?? []).map(([x, y]) => `${x},${y}`).join(' ');
/** An arrow's head: a small triangle at its end. */
function head(m: Mark): string {
  const [x0, y0] = m.from!, [x1, y1] = m.to!;
  const a = Math.atan2(y1 - y0, x1 - x0), s = 14 / zoom.value;
  const p = (da: number) => `${x1 - s * Math.cos(a + da)},${y1 - s * Math.sin(a + da)}`;
  return `${x1},${y1} ${p(0.45)} ${p(-0.45)}`;
}
/** Where a mark's number sits. */
function badge(m: Mark): Point {
  if (m.rect) return [m.rect.x, m.rect.y];
  if (m.from) return m.from;
  return m.points?.[0] ?? [0, 0];
}
defineExpose({ finishText });
</script>

<template>
  <svg ref="svg" class="ink" :class="{ active: !!tool, eraser: tool === 'eraser' }" :data-ink="view" :viewBox="width && height ? `0 0 ${width} ${height}` : undefined" :width="width" :height="height" @pointerdown="down" @wheel="wheel">
    <g ref="layer" :transform="viewport ? `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})` : undefined">
      <g v-for="m in [...marks, ...(draft ? [draft] : [])]" :key="m.id" :data-mark="m.id === 'draft' ? undefined : m.id" :data-kind="m.kind" class="mark" :class="{ sent: !!sent[m.id], draft: m.id === 'draft' }" :style="{ color: m.color, '--ink': m.color }">
        <polyline v-if="m.points" :points="pts(m.points)" fill="none" stroke="currentColor" :stroke-width="m.width" :stroke-opacity="m.kind === 'marker' ? 0.45 : 1" stroke-linecap="round" stroke-linejoin="round" />
        <rect v-else-if="m.kind === 'rect' && m.rect" :x="m.rect.x" :y="m.rect.y" :width="m.rect.w" :height="m.rect.h" rx="4" fill="none" stroke="currentColor" :stroke-width="3 / zoom" />
        <g v-else-if="m.kind === 'arrow' && m.from && m.to">
          <line :x1="m.from[0]" :y1="m.from[1]" :x2="m.to[0]" :y2="m.to[1]" stroke="currentColor" :stroke-width="3 / zoom" stroke-linecap="round" />
          <polygon :points="head(m)" fill="currentColor" />
        </g>
        <foreignObject v-else-if="m.rect" :x="m.rect.x" :y="m.rect.y" :width="m.rect.w" :height="m.rect.h">
          <div xmlns="http://www.w3.org/1999/xhtml" class="note" :class="m.kind" :style="{ fontSize: `${15 / zoom}px` }">
            <textarea v-if="editing === m.id" v-model="typed" spellcheck="false" placeholder="type…" data-testid="ink-note-input" @keydown="textKey" @blur="finishText" @pointerdown.stop />
            <span v-else>{{ m.text }}</span>
          </div>
        </foreignObject>
        <g v-if="m.id !== 'draft'" class="badge" :transform="`translate(${badge(m)[0]} ${badge(m)[1]}) scale(${1 / zoom})`">
          <circle r="10" fill="currentColor" stroke="#000" stroke-width="1" />
          <text text-anchor="middle" dy="4.5" font-size="13" font-weight="700" fill="#000">{{ m.n }}</text>
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.ink { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 30; }
.ink.active { pointer-events: all; cursor: crosshair; }
.ink.eraser { cursor: cell; }
.ink.eraser .mark { pointer-events: visiblePainted; }
.ink .mark { pointer-events: none; }
.ink.active .mark .note { pointer-events: auto; }
.mark.sent { opacity: 0.45; }
.note { box-sizing: border-box; width: 100%; height: 100%; padding: 6px 8px; font-family: Kalam, 'Comic Sans MS', system-ui, sans-serif; line-height: 1.25; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
.note.note { background: color-mix(in srgb, var(--ink) 28%, #fff8d6); color: #1b1b1b; border: 2px solid var(--ink); border-radius: 4px; box-shadow: 0 3px 8px #0006; }
.note.text { color: currentColor; text-shadow: 0 1px 3px #000c; font-weight: 700; }
.note textarea { width: 100%; height: 100%; border: 0; outline: none; resize: none; background: transparent; color: inherit; font: inherit; padding: 0; }
.badge text { font-family: Lato, system-ui, sans-serif; }
</style>

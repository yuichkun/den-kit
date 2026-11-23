<script setup lang="ts">
// Tab B, the map: the places the author named (the surfaces), and the recipient moves
// between them. Every control follows the weighted mix of the places, so it never
// leaves the range the author named; the bars show where each control is inside it.
// A gait moves the controls the way the author said, for listening and walking.
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { DELIVERY } from './context.ts';
import { applyCondition, nearest, pointRange, settingAt, toUnit } from './spec.ts';
import type { Control } from './sound.ts';

const ctx = inject(DELIVERY)!;
const build = ctx.active;
const points = ctx.spec.points;
const options = ctx.spec.condition.options;
const pos = ref({ x: 0.5, y: 0.5 });
const gait = ref(0);
const started = ref(ctx.live.running);
const walking = ref(false);
let turn = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const controls = computed(() => build.value?.controls ?? []);
const base = computed(() => settingAt(points, controls.value, pos.value.x, pos.value.y));
const setting = computed(() =>
  applyCondition(controls.value, base.value, options[gait.value] ?? options[0]!),
);
const range = computed(() => pointRange(points, controls.value));
const near = computed(() => nearest(points, pos.value.x, pos.value.y));
const keptHere = computed(() => ctx.state.kept.filter(k => k.from === 'map' && k.pos));

watch(setting, s => build.value && ctx.live.set(build.value, s), { immediate: true });

const map = ref<SVGSVGElement | null>(null);
let dragging = false;
function moveTo(e: PointerEvent) {
  const box = map.value!.getBoundingClientRect();
  pos.value = {
    x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
    y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
  };
}
function grab(e: PointerEvent) {
  dragging = true;
  map.value!.setPointerCapture(e.pointerId);
  moveTo(e);
}
function drag(e: PointerEvent) {
  if (dragging) moveTo(e);
}
function drop() {
  dragging = false;
}
function nudge(dx: number, dy: number) {
  pos.value = {
    x: Math.min(1, Math.max(0, pos.value.x + dx)),
    y: Math.min(1, Math.max(0, pos.value.y + dy)),
  };
}

async function ensure() {
  if (!build.value) return false;
  if (!started.value) started.value = await ctx.live.start(build.value, setting.value);
  return started.value;
}
async function step() {
  if (!(await ensure())) return;
  const note = ctx.spec.notes[turn++ % ctx.spec.notes.length]!;
  const velocity = options[gait.value]?.velocity ?? 96;
  ctx.live.note(note, true, velocity);
  setTimeout(() => ctx.live.note(note, false), 180);
}
async function walk() {
  if (walking.value) return stopWalking();
  if (!(await ensure())) return;
  walking.value = true;
  void step();
  timer = setInterval(() => void step(), (options[gait.value]?.every ?? 0.5) * 1000);
}
function stopWalking() {
  walking.value = false;
  if (timer) clearInterval(timer);
  timer = null;
}
watch(gait, () => {
  if (walking.value) {
    stopWalking();
    void walk();
  }
});

function keep() {
  const n = near.value;
  const name = n.distance < 0.04 ? n.point.name : `Near ${n.point.name}`;
  ctx.keep({ name, setting: { ...base.value }, from: 'map', pos: { ...pos.value } });
}

const show = (c: Control, v: number) =>
  `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)}${c.unit ? ` ${c.unit}` : ''}`;

onBeforeUnmount(() => {
  stopWalking();
  ctx.live.stop();
});
</script>

<template>
  <div class="map-tab" data-testid="map-tab">
    <div class="area">
      <span class="axis top">{{ ctx.spec.axes?.y[0] }}</span>
      <div class="row">
        <span class="axis left">{{ ctx.spec.axes?.x[0] }}</span>
        <svg
          ref="map"
          class="map"
          viewBox="0 0 100 100"
          tabindex="0"
          role="slider"
          aria-label="Place on the author's map"
          :aria-valuetext="`near ${near.point.name}`"
          data-testid="map"
          @pointerdown="grab"
          @pointermove="drag"
          @pointerup="drop"
          @pointercancel="drop"
          @keydown.left.prevent="nudge(-0.02, 0)"
          @keydown.right.prevent="nudge(0.02, 0)"
          @keydown.up.prevent="nudge(0, -0.02)"
          @keydown.down.prevent="nudge(0, 0.02)"
          @keydown.space.prevent="step"
        >
          <rect class="field" x="0" y="0" width="100" height="100" />
          <line
            v-for="i in 3"
            :key="`v${i}`"
            class="grid"
            :x1="i * 25"
            y1="0"
            :x2="i * 25"
            y2="100"
          />
          <line
            v-for="i in 3"
            :key="`h${i}`"
            class="grid"
            x1="0"
            :y1="i * 25"
            x2="100"
            :y2="i * 25"
          />
          <circle
            v-for="k in keptHere"
            :key="k.id"
            class="kept-mark"
            :cx="k.pos!.x * 100"
            :cy="k.pos!.y * 100"
            r="1.8"
          >
            <title>{{ k.name }}</title>
          </circle>
          <g
            v-for="p in points"
            :key="p.name"
            class="point"
            @pointerdown.stop="pos = { x: p.x, y: p.y }"
          >
            <circle :cx="p.x * 100" :cy="p.y * 100" r="2.2" />
            <text :x="p.x * 100" :y="p.y * 100 - 4" text-anchor="middle">{{ p.name }}</text>
          </g>
          <circle class="halo" :cx="pos.x * 100" :cy="pos.y * 100" r="5" />
          <circle class="puck" :cx="pos.x * 100" :cy="pos.y * 100" r="2.6" />
        </svg>
        <span class="axis right">{{ ctx.spec.axes?.x[1] }}</span>
      </div>
      <span class="axis bottom">{{ ctx.spec.axes?.y[1] }}</span>
    </div>
    <div class="side">
      <p class="hint">
        Drag the dot between the places the author named. Every control stays inside the range those
        places give it.
      </p>
      <div class="gaits" role="radiogroup" :aria-label="ctx.spec.condition.name">
        <button
          v-for="(o, i) in options"
          :key="o.name"
          type="button"
          role="radio"
          :aria-checked="gait === i"
          :class="{ on: gait === i }"
          @click="gait = i"
        >
          {{ o.name }}
        </button>
      </div>
      <div class="play">
        <button type="button" data-testid="map-step" @click="step">Step</button>
        <button type="button" :class="{ on: walking }" data-testid="map-walk" @click="walk">
          {{ walking ? 'Stop' : 'Walk' }}
        </button>
      </div>
      <ul class="bars">
        <li v-for="c in controls" :key="c.id">
          <span class="label">{{ c.label }}</span>
          <span class="track">
            <span
              class="band"
              :style="{
                left: `${range[c.id]!.low * 100}%`,
                width: `${Math.max(1, (range[c.id]!.high - range[c.id]!.low) * 100)}%`,
              }"
            />
            <span class="mark" :style="{ left: `${toUnit(c, setting[c.id]!) * 100}%` }" />
          </span>
          <span class="value">{{ show(c, setting[c.id]!) }}</span>
        </li>
      </ul>
      <p class="legend"><span class="swatch" /> the range the author's places give</p>
      <button
        v-if="!ctx.readonly"
        type="button"
        class="primary keep"
        data-testid="map-keep"
        @click="keep"
      >
        Keep this place
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-tab {
  display: flex;
  gap: 28px;
  padding: 24px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.axis {
  color: var(--text-muted);
  font-size: 12px;
}
.axis.left,
.axis.right {
  writing-mode: vertical-rl;
}
.axis.left {
  transform: rotate(180deg);
}
.map {
  width: min(60vh, 460px);
  height: min(60vh, 460px);
  touch-action: none;
  cursor: crosshair;
  border-radius: var(--radius-panel);
  overflow: hidden;
}
.field {
  fill: var(--app-field);
}
.grid {
  stroke: var(--line-subtle);
  stroke-width: 0.3;
}
.point circle {
  fill: var(--text-primary);
}
.point text {
  font-size: 3.4px;
  fill: var(--text-primary);
  font-family: var(--font-ui);
  cursor: pointer;
}
.point {
  cursor: pointer;
}
.kept-mark {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 0.6;
}
.halo {
  fill: var(--accent);
  opacity: 0.18;
}
.puck {
  fill: var(--accent);
  stroke: var(--app-canvas);
  stroke-width: 0.8;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
}
.hint,
.legend {
  margin: 0;
  color: var(--text-muted);
}
.gaits,
.play {
  display: flex;
  gap: 6px;
}
.gaits button.on,
.play button.on {
  background: var(--ink);
  color: var(--text-on-ink);
  border-color: var(--ink);
}
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bars li {
  display: grid;
  grid-template-columns: 56px 1fr 70px;
  align-items: center;
  gap: 8px;
}
.track {
  position: relative;
  height: 8px;
  border-radius: var(--radius-control);
  background: var(--line-subtle);
}
.band,
.swatch {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}
.band {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-control);
}
.mark {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 14px;
  margin-left: -1.5px;
  background: var(--text-primary);
  border-radius: var(--radius-control);
}
.value {
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: right;
}
.swatch {
  display: inline-block;
  width: 18px;
  height: 8px;
  border-radius: var(--radius-control);
  vertical-align: middle;
}
.keep {
  align-self: flex-start;
}
</style>

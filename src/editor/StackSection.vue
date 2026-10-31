<script setup lang="ts">
// The copies (×N) of the selected node or part: how many, what that costs, and
// how each knob differs between them, drawn as one bar per copy. Changing the
// count recompiles; how a knob spreads (amount, kind, a copy's own value) is
// played live, like turning a knob.
import { computed } from 'vue';
import type { PortDef } from '../work/catalog.ts';
import { formatCpu } from '../work/cost.ts';
import {
  MAX_COUNT,
  SPREAD_KINDS,
  type PatchNode,
  type Spread,
  type SpreadKind,
} from '../work/schema.ts';
import { copiesOf, spreadable, spreadReach, spreadUnit, spreadValue } from '../work/stacks.ts';
import { useSession } from './context.ts';

const props = defineProps<{ node: PatchNode }>();
const session = useSession();
const count = computed(() => copiesOf(session.catalog, props.node));
const cost = computed(() => session.validation.value.cost);
const mine = computed(() => cost.value.byNode[props.node.id] ?? 0);
const connected = computed(
  () =>
    new Set(
      Object.values(session.doc.value.edges)
        .filter(e => e.to.node === props.node.id)
        .map(e => e.to.port),
    ),
);
/** Knobs that can differ between copies (with a cable in, the spread moves what the cable brings). */
const knobs = computed(() => session.catalog.inputs(props.node).filter(p => spreadable(p)));
const QUICK = [1, 2, 4, 8, 16, 32];
const KIND_LABEL: Record<SpreadKind | 'same', string> = {
  same: 'same',
  range: 'range',
  random: 'random',
  harmonic: 'harmonic',
  each: 'each own',
};

function commit(
  intents: Parameters<typeof session.commit>[0],
  options: Parameters<typeof session.commit>[1] = {},
) {
  const r = session.commit(intents, options);
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r;
}
function setCount(raw: number) {
  if (!Number.isFinite(raw)) return;
  const n = Math.max(1, Math.min(MAX_COUNT, Math.round(raw)));
  commit([{ op: 'setCount', node: props.node.id, count: n }], { label: `×${n} ${props.node.id}` });
}
const spreadOf = (p: PortDef) => props.node.spread?.[p.id];
const base = (p: PortDef) => Number(props.node.values[p.id] ?? p.default ?? 0);
function setSpread(p: PortDef, spread: Spread | null, gesture?: string) {
  commit([{ op: 'setSpread', node: props.node.id, port: p.id, spread }], {
    gesture,
    label: `Spread ${props.node.id}.${p.id}`,
  });
}
function setKind(p: PortDef, kind: SpreadKind | 'same') {
  if (kind === 'same') {
    setSpread(p, null);
    return;
  }
  const old = spreadOf(p);
  const next: Spread = { ...old, kind };
  if ((kind === 'range' || kind === 'random') && !next.amount)
    next.amount = p.scale === 'log' ? 0.5 : spreadReach(p) / 8;
  if (kind === 'each' && !next.values?.length)
    next.values = values(p, old ?? { kind: 'range', amount: 0 });
  setSpread(p, next);
}
/** Slider span for the amount: up to 4 octaves on a frequency knob, half the knob's range elsewhere. */
const amountMax = (p: PortDef) => (p.scale === 'log' ? 4 : spreadReach(p) / 2);
const amountStep = (p: PortDef) => amountMax(p) / 200;
function setAmount(p: PortDef, value: number, gesture?: string) {
  const old = spreadOf(p);
  if (!old || !Number.isFinite(value)) return;
  setSpread(p, { ...old, amount: Number(value.toPrecision(4)) }, gesture);
}
function reroll(p: PortDef) {
  const old = spreadOf(p);
  if (old) setSpread(p, { ...old, seed: ((old.seed ?? 1) * 7919 + 13) % 2147483647 });
}
/** The value each copy takes. */
function values(p: PortDef, spread: Spread | undefined = spreadOf(p)): number[] {
  return Array.from({ length: count.value }, (_, k) =>
    spread ? spreadValue(base(p), spread, k, count.value, p) : base(p),
  );
}
const lo = (p: PortDef) => p.uiMin ?? p.min ?? 0,
  hi = (p: PortDef) => p.uiMax ?? p.max ?? 1;
const logScale = (p: PortDef) => p.scale === 'log' && lo(p) > 0;
/** A value as a bar height in 0..1 of the knob's range (log on a frequency knob). */
function height(p: PortDef, v: number) {
  const a = lo(p),
    b = hi(p);
  const u = logScale(p) ? Math.log(Math.max(v, a) / a) / Math.log(b / a) : (v - a) / (b - a || 1);
  return Math.min(1, Math.max(0.02, u));
}
function fromHeight(p: PortDef, u: number) {
  const a = lo(p),
    b = hi(p),
    t = Math.min(1, Math.max(0, u));
  return Number((logScale(p) ? a * (b / a) ** t : a + (b - a) * t).toPrecision(4));
}
/** Drag across the bars to give each copy its own value (turns the spread into "each own"). */
function drawBars(p: PortDef, e: PointerEvent) {
  if (e.button !== 0) return;
  const el = e.currentTarget as SVGSVGElement;
  el.setPointerCapture(e.pointerId);
  const gesture = `bars-${props.node.id}-${p.id}-${Date.now()}`;
  const current = values(p);
  // Where the bars were when the drawing began (the panel may reflow under the pointer as the spread changes kind).
  const r = el.getBoundingClientRect();
  const paint = (m: PointerEvent) => {
    const k = Math.min(
      count.value - 1,
      Math.max(0, Math.floor(((m.clientX - r.left) / r.width) * count.value)),
    );
    current[k] = fromHeight(p, 1 - (m.clientY - r.top) / r.height);
    setSpread(p, { ...spreadOf(p), kind: 'each', values: [...current] }, gesture);
  };
  paint(e);
  const up = () => {
    el.removeEventListener('pointermove', paint);
    el.removeEventListener('pointerup', up);
  };
  el.addEventListener('pointermove', paint);
  el.addEventListener('pointerup', up);
}
const fmt = (v: number) => {
  const a = Math.abs(v);
  return a >= 1000
    ? `${(v / 1000).toFixed(2)}k`
    : a >= 100
      ? v.toFixed(0)
      : a >= 10
        ? v.toFixed(1)
        : v.toFixed(a >= 1 ? 2 : 3);
};
</script>

<template>
  <div class="section" data-testid="stack-section">
    <h3>Copies <span class="muted">(×N)</span></h3>
    <div class="row">
      <label>Count</label>
      <input
        type="number"
        min="1"
        :max="MAX_COUNT"
        step="1"
        :value="count"
        data-testid="stack-count"
        @change="setCount(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="quick"
        ><button
          v-for="n in QUICK"
          :key="n"
          class="small"
          :class="{ on: count === n }"
          :data-count="n"
          @click="setCount(n)"
        >
          ×{{ n }}
        </button></span
      >
    </div>
    <div class="muted small-text" data-testid="stack-cost">
      <template v-if="count > 1"
        >{{ count }} copies side by side; their outputs carry {{ count }} signals (a thick cable).
        Into a single input they are summed ×1/√{{ count }}; Splay spreads them across left and
        right.</template
      >
      <template v-else
        >Runs once. More copies make a thick cable (one signal per copy), like Max's mc.</template
      >
      <br />Load: {{ formatCpu(mine) }} here · {{ formatCpu(cost.cpu) }} for the whole patch.
    </div>
    <template v-if="count > 1">
      <div v-if="!knobs.length" class="muted small-text">
        No knobs here can differ between copies.
      </div>
      <div v-for="p in knobs" :key="p.id" class="spread" :data-spread="p.id">
        <div class="row">
          <label
            :title="
              connected.has(p.id)
                ? 'A cable comes in: each copy gets what it brings, moved by the spread'
                : p.doc
            "
            >{{ p.label ?? p.id
            }}<span v-if="connected.has(p.id)" class="muted" data-spread-cable>
              · cable</span
            ></label
          >
          <select
            :value="spreadOf(p)?.kind ?? 'same'"
            :data-spread-kind="p.id"
            @change="setKind(p, ($event.target as HTMLSelectElement).value as SpreadKind | 'same')"
          >
            <option value="same">{{ KIND_LABEL.same }}</option>
            <option v-for="k in SPREAD_KINDS" :key="k" :value="k">{{ KIND_LABEL[k] }}</option>
          </select>
          <button
            v-if="spreadOf(p)?.kind === 'random'"
            class="small"
            title="Other random values"
            :data-reroll="p.id"
            @click="reroll(p)"
          >
            ⟳
          </button>
        </div>
        <svg
          class="bars nodrag"
          :class="{ each: spreadOf(p)?.kind === 'each' }"
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          :data-bars="p.id"
          @pointerdown="drawBars(p, $event)"
        >
          <title
            v-text="
              `${values(p)
                .map((v, k) => `${k + 1}: ${fmt(v)}${p.unit ? ` ${p.unit}` : ''}`)
                .join('\n')} (drag to give each copy its own value)`
            "
          />
          <rect
            v-for="(v, k) in values(p)"
            :key="k"
            :x="(k * 100) / count + 0.4"
            :width="Math.max(0.6, 100 / count - 0.8)"
            :y="24 * (1 - height(p, v))"
            :height="24 * height(p, v)"
          />
        </svg>
        <div class="ends muted">
          <span>{{ fmt(values(p)[0]!) }}</span
          ><span>{{ fmt(values(p).at(-1)!) }} {{ p.unit }}</span>
        </div>
        <div
          v-if="spreadOf(p)?.kind === 'range' || spreadOf(p)?.kind === 'random'"
          class="row amount"
        >
          <label>± {{ spreadUnit(p) }}</label>
          <input
            type="range"
            min="0"
            :max="amountMax(p)"
            :step="amountStep(p)"
            :value="Math.abs(spreadOf(p)?.amount ?? 0)"
            :data-spread-amount="p.id"
            @input="
              setAmount(
                p,
                Number(($event.target as HTMLInputElement).value),
                `amount-${node.id}-${p.id}`,
              )
            "
          />
          <input
            type="number"
            class="num"
            step="any"
            :value="spreadOf(p)?.amount ?? 0"
            @change="setAmount(p, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.small {
  padding: 0 6px;
  font-size: 11px;
}
.small.on {
  background: color-mix(in srgb, var(--accent-text) 16%, transparent);
  color: var(--accent-text);
}
.quick {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}
.row input[type='number'] {
  width: 52px;
  flex: none;
}
.row select {
  flex: 1;
  min-width: 0;
}
.small-text {
  font-size: 11.5px;
  margin: 2px 0 6px;
}
.spread {
  margin: 6px 0 8px;
}
.amount input[type='range'] {
  flex: 1;
  min-width: 0;
}
.amount .num {
  width: 56px;
}
.bars {
  width: 100%;
  height: 34px;
  display: block;
  background: var(--app-chrome);
  border-radius: var(--radius-control);
  cursor: crosshair;
  touch-action: none;
}
.bars rect {
  fill: color-mix(in srgb, var(--selection) 60%, transparent);
}
.bars.each rect {
  fill: color-mix(in srgb, var(--state-warn) 80%, transparent);
}
.ends {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
}
</style>

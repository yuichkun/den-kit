<script setup lang="ts">
// Pick a module of the patch and see its shape as a symbol, in the work's colours, with or
// without a frame; placing it adds a symbol to the icon or cover (one operation, like any other).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSession } from '../context.ts';
import {
  ART_SIZE,
  drawable,
  symbolModule,
  type ArtSurfaceName,
  type SymbolElement,
} from '../../work/art.ts';
import { tellingModule } from '../../work/art-starts.ts';
import { COLOR_TOKENS } from '../../work/ui.ts';
import { lookVars } from '../../screen/build.ts';
import ArtSymbol from '../../screen/ArtSymbol.vue';

const props = defineProps<{ on: ArtSurfaceName }>();
const emit = defineEmits<{
  (e: 'place', element: Record<string, unknown>): void;
  (e: 'close'): void;
}>();
const session = useSession();
// Esc closes it, before the view under it sees the key.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
const doc = computed(() => session.doc.value);
const modules = computed(() =>
  Object.values(doc.value.nodes)
    .filter(n => drawable(n))
    .map(n => ({ node: n, title: n.label ?? session.catalog.find(n.type)?.title ?? n.type })),
);
const chosen = ref(tellingModule(doc.value)?.id ?? '');
const frame = ref<'none' | 'circle' | 'rounded'>(props.on === 'icon' ? 'circle' : 'none');
const ink = ref<string>('accent');
const ground = ref<string>('knob');
const weight = ref(props.on === 'icon' ? 6 : 3);
const vars = computed(() => lookVars(doc.value));
const url = (id: string) => session.assetUrls.value[id] ?? null;

function element(node: string, side: number): SymbolElement {
  const n = doc.value.nodes[node]!;
  const rect = { x: 0, y: 0, w: side, h: side };
  return {
    kind: 'symbol',
    id: 'preview',
    rect,
    node,
    module: symbolModule(n),
    ink: ink.value,
    weight: weight.value,
    ...(frame.value === 'none'
      ? {}
      : {
          style: {
            fill: [{ kind: 'color' as const, color: ground.value }],
            radius: frame.value === 'circle' ? side / 2 : side * 0.22,
          },
        }),
  };
}
function place() {
  if (!chosen.value) return;
  const { width, height } = ART_SIZE[props.on];
  const side = Math.round(Math.min(width, height) * (props.on === 'icon' ? 0.75 : 0.55));
  const { id: _id, module: _module, rect: _rect, ...rest } = element(chosen.value, side);
  emit('place', {
    ...rest,
    rect: {
      x: Math.round((width - side) / 2),
      y: Math.round((height - side) / 2),
      w: side,
      h: side,
    },
  });
}
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('close')">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="A symbol from the patch"
      data-testid="symbol-maker"
    >
      <h3>A symbol from the patch</h3>
      <p class="hint">
        The shape of a module as it is now. It keeps this shape when knobs move later; Redraw
        updates it.
      </p>
      <div class="grid" :style="vars">
        <button
          v-for="m in modules"
          :key="m.node.id"
          class="pick"
          :class="{ on: chosen === m.node.id }"
          :data-module="m.node.id"
          @click="chosen = m.node.id"
        >
          <span class="swatch">
            <ArtSymbol :element="element(m.node.id, 96)" :url="url" />
          </span>
          <span class="name as-written">{{ m.node.id }}</span>
          <span class="type">{{ m.title }}</span>
        </button>
      </div>
      <div class="row">
        <span class="label">Frame</span>
        <button
          v-for="f in ['none', 'circle', 'rounded'] as const"
          :key="f"
          class="small"
          :class="{ on: frame === f }"
          @click="frame = f"
        >
          {{ f === 'none' ? 'None' : f === 'circle' ? 'Circle' : 'Rounded' }}
        </button>
      </div>
      <div class="row">
        <span class="label">Ink</span>
        <select v-model="ink">
          <option v-for="t in COLOR_TOKENS" :key="t" :value="t">{{ t }}</option>
        </select>
        <template v-if="frame !== 'none'">
          <span class="label">Ground</span>
          <select v-model="ground">
            <option v-for="t in COLOR_TOKENS" :key="t" :value="t">{{ t }}</option>
          </select>
        </template>
        <span class="label">Line</span>
        <input v-model.number="weight" type="range" min="1" max="14" step="0.5" />
      </div>
      <div class="actions">
        <button @click="emit('close')">Cancel</button>
        <button class="primary" data-testid="symbol-place" :disabled="!chosen" @click="place">
          Place on the {{ on }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-canvas) 60%, transparent);
}
.dialog {
  width: min(640px, 92vw);
  max-height: 86vh;
  overflow: auto;
  padding: 16px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-menu);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 15px;
}
.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}
.pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
}
.pick.on {
  outline: 2px solid var(--accent);
}
.swatch {
  position: relative;
  width: 96px;
  height: 96px;
  background: var(--dk-bg);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.name {
  font-size: 12px;
}
.type {
  font-size: 11px;
  color: var(--text-muted);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.label {
  color: var(--text-muted);
  font-size: 12px;
}
.small {
  padding: 2px 8px;
  font-size: 12px;
}
.small.on {
  outline: 1px solid var(--accent);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

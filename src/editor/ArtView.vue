<script setup lang="ts">
// The Art view: the work's icon and cover (src/work/art.ts). An author starts a
// board from the work itself (a window onto the plugin, its telling piece as a
// specimen, its patch as a pattern), then changes it by hand: drag a window's view
// or a layer's place, the corner handle to size it, the wheel to look closer, and
// the fields beside it. Every change is an op of the work, so it undoes with ⌘Z and
// the AI, asked meanwhile, edits the same layers with the same ops. The shelf below
// (ArtShelf) lines the work up with the showcase works, small, the way it will be seen.
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import {
  ART_LIMITS,
  BOARD_SIZE,
  RECIPES,
  RECIPE_DOC,
  RECIPE_TITLE,
  REPEATS,
  groundOf,
  initialOf,
  nextLayerId,
  patchSigns,
  startArt,
  telling,
  type ArtBoardId,
  type ArtLayer,
  type ArtLayerKind,
  type Recipe,
  type Repeat,
  type WindowLayer,
} from '../work/art.ts';
import type { Intent } from '../work/ops.ts';
import {
  COLOR_TOKENS,
  assetsOf,
  type ElementStyle,
  type Fill,
  type TextStyle,
} from '../work/ui.ts';
import { pluginSpec } from '../screen/build.ts';
import { WORKS } from '../screen/showcase/index.ts';
import ArtBoard from '../screen/ArtBoard.vue';
import ArtShelf from './ArtShelf.vue';
import FillList from './plugin/FillList.vue';
import StyleEditor from './plugin/StyleEditor.vue';
import TextStyleEditor from './plugin/TextStyleEditor.vue';
import { useSession } from './context.ts';

const session = useSession();
const doc = computed(() => session.doc.value);
const board = ref<ArtBoardId>('icon');
const selected = ref<string | null>(null);
const spec = computed(() => pluginSpec(doc.value, session.catalog, session.generated.value));
const signs = computed(() => patchSigns(doc.value, session.catalog));
const assets = computed(() => assetsOf(doc.value.files));
const layers = computed<readonly ArtLayer[]>(() => doc.value.art?.[board.value]?.layers ?? []);
const size = computed(() => BOARD_SIZE[board.value]);

/** A drag in progress: the layer as it is while the pointer moves (one op when it ends). */
const drag = ref<{ id: string; layer: ArtLayer } | null>(null);
const shown = computed(() =>
  layers.value.map(l => (drag.value?.id === l.id ? drag.value.layer : l)),
);
const layer = computed(() => shown.value.find(l => l.id === selected.value) ?? null);
watch([board, () => layers.value.map(l => l.id).join()], () => {
  if (!layers.value.some(l => l.id === selected.value))
    selected.value = layers.value.at(-1)?.id ?? null;
});
// What the person works on goes with every AI request ("this", "here").
watchEffect(() => {
  session.seeing.value = {
    ...session.seeing.value,
    art: { board: board.value, ...(selected.value ? { layer: selected.value } : {}) },
  };
});

// ---- the board, as large as the view allows ------------------------------------------------
const stage = ref<HTMLElement | null>(null);
const room = ref({ w: 640, h: 420 });
const width = computed(() =>
  Math.max(
    120,
    Math.min(room.value.w - 48, ((room.value.h - 84) * size.value.w) / size.value.h, size.value.w),
  ),
);
const scale = computed(() => width.value / size.value.w);
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    room.value = { w: entry!.contentRect.width, h: entry!.contentRect.height };
  });
  if (stage.value) observer.observe(stage.value);
});
onBeforeUnmount(() => observer?.disconnect());

// ---- edits ----------------------------------------------------------------------------------
// One gesture per field while it is dragged or typed in, so a slider drag is one undo step.
let gesture = { key: '', id: '', at: 0 };
function commit(intents: Intent[], label: string, key?: string) {
  let g: string | undefined;
  if (key) {
    const now = performance.now();
    if (gesture.key !== key || now - gesture.at > 1500)
      gesture = { key, id: `art-${key}-${Date.now()}`, at: now };
    gesture.at = now;
    g = gesture.id;
  }
  const r = session.commit(intents, { label, gesture: g });
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r;
}
const BOARD_TITLE: Record<ArtBoardId, string> = { icon: 'icon', cover: 'cover' };
function set(fields: Record<string, unknown>, label = 'Change', key?: string) {
  if (!layer.value) return;
  commit(
    [{ op: 'updateArtLayer', board: board.value, id: layer.value.id, set: fields }],
    `${label} the ${BOARD_TITLE[board.value]}'s ${layer.value.name ?? layer.value.id}`,
    key ? `${board.value}-${layer.value.id}-${key}` : undefined,
  );
}
function start(recipe: Recipe) {
  commit(
    [
      {
        op: 'setArt',
        board: board.value,
        layers: startArt(doc.value, session.catalog, recipe, board.value),
      },
    ],
    `Start the ${BOARD_TITLE[board.value]} from ${RECIPE_TITLE[recipe]}`,
  );
  selected.value = null;
}
const starts = computed(() =>
  RECIPES.map(recipe => ({
    recipe,
    layers: startArt(doc.value, session.catalog, recipe, board.value),
  })),
);

const KIND_TITLE: Record<ArtLayerKind, string> = {
  ground: 'Ground',
  window: 'Window',
  mark: 'Letters',
  pattern: 'Pattern',
};
function newLayer(kind: ArtLayerKind): Record<string, unknown> {
  const { w: BW, h: BH } = size.value;
  const icon = board.value === 'icon';
  switch (kind) {
    case 'ground':
      return { kind };
    case 'window': {
      const piece = telling(doc.value, session.catalog);
      const rect = { x: BW * 0.2, y: BH * 0.2, w: BW * 0.6, h: BH * 0.6 };
      return {
        kind,
        rect,
        focus: { x: piece.x + piece.w / 2, y: piece.y + piece.h / 2 },
        zoom:
          Math.round(
            Math.min(
              8,
              Math.max(0.2, (0.8 * Math.min(rect.w, rect.h)) / Math.max(piece.w, piece.h)),
            ) * 100,
          ) / 100,
      };
    }
    case 'mark':
      return {
        kind,
        rect: icon
          ? { x: BW * 0.15, y: BH * 0.15, w: BW * 0.7, h: BH * 0.7 }
          : { x: BW * 0.08, y: BH * 0.3, w: BW * 0.6, h: BH * 0.4 },
        text: icon ? initialOf(doc.value.name) : doc.value.name,
        textStyle: { font: 'font', size: icon ? 260 : 120, weight: 700, color: 'fg' },
      };
    case 'pattern':
      return { kind, rect: { x: 0, y: 0, w: BW, h: BH }, repeat: 'grid', scale: icon ? 1 : 1.4 };
  }
}
function add(kind: ArtLayerKind) {
  const id = nextLayerId(doc.value.art?.[board.value], kind);
  const r = commit(
    [{ op: 'addArtLayer', board: board.value, layer: { ...newLayer(kind), id } }],
    `Add ${KIND_TITLE[kind].toLowerCase()} to the ${BOARD_TITLE[board.value]}`,
  );
  if (r.ok) selected.value = id;
}
function remove(id: string) {
  commit(
    [{ op: 'removeArtLayer', board: board.value, id }],
    `Remove the ${BOARD_TITLE[board.value]}'s ${id}`,
  );
}
function arrange(id: string, to: 'forward' | 'backward') {
  commit(
    [{ op: 'arrangeArtLayer', board: board.value, id, to }],
    `Arrange the ${BOARD_TITLE[board.value]}'s layers`,
  );
}
function toggle(l: ArtLayer) {
  selected.value = l.id;
  set({ hidden: l.hidden ? null : true }, l.hidden ? 'Show' : 'Hide');
}
/** Layers top first, as a layer list reads. */
const listed = computed(() => [...shown.value].reverse());

// ---- dragging on the board ------------------------------------------------------------------
const overlay = ref<HTMLElement | null>(null);
function point(e: PointerEvent | WheelEvent) {
  const r = overlay.value!.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * size.value.w) / r.width,
    y: ((e.clientY - r.top) * size.value.h) / r.height,
  };
}
const inside = (l: ArtLayer, p: { x: number; y: number }) =>
  l.kind === 'ground' ||
  (p.x >= l.rect.x && p.y >= l.rect.y && p.x <= l.rect.x + l.rect.w && p.y <= l.rect.y + l.rect.h);
const hit = (p: { x: number; y: number }) =>
  [...shown.value].reverse().find(l => !l.hidden && inside(l, p)) ?? null;
let moving: {
  mode: 'pan' | 'move' | 'size';
  from: { x: number; y: number };
  start: ArtLayer;
} | null = null;
function down(e: PointerEvent, handle = false) {
  if (e.button !== 0) return;
  const p = point(e);
  const target = handle ? layer.value : hit(p);
  if (!target) return;
  selected.value = target.id;
  (e.currentTarget as HTMLElement).closest<HTMLElement>('.stage')?.focus();
  if (target.kind === 'ground') return;
  e.preventDefault();
  e.stopPropagation();
  moving = {
    mode: handle ? 'size' : target.kind === 'window' && !e.altKey ? 'pan' : 'move',
    from: p,
    start: target,
  };
  overlay.value!.setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (!moving) return;
  const p = point(e);
  const dx = p.x - moving.from.x,
    dy = p.y - moving.from.y;
  const s = moving.start;
  if (s.kind === 'ground') return;
  const round = (v: number) => Math.round(v);
  let next: ArtLayer;
  if (moving.mode === 'pan' && s.kind === 'window')
    next = {
      ...s,
      focus: {
        x: Math.round((s.focus.x - dx / s.zoom) * 10) / 10,
        y: Math.round((s.focus.y - dy / s.zoom) * 10) / 10,
      },
    };
  else if (moving.mode === 'size')
    next = {
      ...s,
      rect: {
        ...s.rect,
        w: Math.max(16, round(s.rect.w + dx)),
        h: Math.max(16, round(s.rect.h + dy)),
      },
    };
  else next = { ...s, rect: { ...s.rect, x: round(s.rect.x + dx), y: round(s.rect.y + dy) } };
  drag.value = { id: s.id, layer: next };
}
function up() {
  const d = drag.value;
  const m = moving;
  moving = null;
  drag.value = null;
  if (!d || !m || d.layer.kind === 'ground') return;
  const fields =
    m.mode === 'pan' && d.layer.kind === 'window'
      ? { focus: d.layer.focus }
      : { rect: d.layer.rect };
  commit(
    [{ op: 'updateArtLayer', board: board.value, id: d.id, set: fields }],
    m.mode === 'pan'
      ? `Move the view in the ${BOARD_TITLE[board.value]}'s ${d.id}`
      : `Place the ${BOARD_TITLE[board.value]}'s ${d.id}`,
  );
}
function wheel(e: WheelEvent) {
  const target = hit(point(e));
  if (!target || target.kind !== 'window') return;
  e.preventDefault();
  selected.value = target.id;
  const zoom = Math.min(20, Math.max(0.05, target.zoom * Math.exp(-e.deltaY * 0.0015)));
  commit(
    [
      {
        op: 'updateArtLayer',
        board: board.value,
        id: target.id,
        set: { zoom: Math.round(zoom * 1000) / 1000 },
      },
    ],
    `Look closer in the ${BOARD_TITLE[board.value]}'s ${target.id}`,
    `${board.value}-${target.id}-zoom`,
  );
}
function key(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && layer.value) {
    e.preventDefault();
    remove(layer.value.id);
  }
}
const place = (l: ArtLayer) =>
  l.kind === 'ground'
    ? { left: '0', top: '0', width: `${size.value.w}px`, height: `${size.value.h}px` }
    : {
        left: `${l.rect.x}px`,
        top: `${l.rect.y}px`,
        width: `${l.rect.w}px`,
        height: `${l.rect.h}px`,
      };

// ---- fields of the selected layer ---------------------------------------------------------------
const windowLayer = computed(() =>
  layer.value?.kind === 'window' ? (layer.value as WindowLayer) : null,
);
/** Zoom on a slider that feels even: its logarithm. */
const zoomSlider = computed(() => (windowLayer.value ? Math.log2(windowLayer.value.zoom) : 0));
function setZoom(v: number) {
  set({ zoom: Math.round(2 ** v * 1000) / 1000 }, 'Look closer in', 'zoom');
}
/** The controls as they are now, held in the window (the moment the author liked). */
function hold() {
  const moment: Record<string, number | boolean> = {};
  for (const w of spec.value.widgets)
    if (w.values.value !== undefined && Object.keys(moment).length < ART_LIMITS.moment)
      moment[w.id] = w.values.value;
  set({ moment }, 'Hold the controls in');
}
function centre() {
  const piece = telling(doc.value, session.catalog);
  set({ focus: { x: piece.x + piece.w / 2, y: piece.y + piece.h / 2 } }, 'Centre');
}
const held = computed(() => Object.keys(windowLayer.value?.moment ?? {}).length);

// The ground: the plugin's own background, a colour, or another work's ground (with its pictures).
const groundKind = computed(() =>
  layer.value?.kind !== 'ground' ? null : layer.value.fill ? 'own' : 'plugin',
);
function groundFrom(id: string) {
  const work = WORKS.find(w => w.id === id);
  if (!work || !layer.value) return;
  const source = work.build(session.catalog);
  const fill = groundOf(source);
  const have = assetsOf(doc.value.files);
  const pictures = fill.flatMap(f =>
    f.kind === 'image' && !have[f.asset] && assetsOf(source.files)[f.asset]
      ? [assetsOf(source.files)[f.asset]!]
      : [],
  );
  commit(
    [
      ...pictures.map(asset => ({ op: 'addAsset' as const, asset })),
      { op: 'updateArtLayer', board: board.value, id: layer.value.id, set: { fill } },
    ],
    `Put ${work.title}'s ground on the ${BOARD_TITLE[board.value]}`,
  );
}
const TOKENS = COLOR_TOKENS;
const REPEAT_TITLE: Record<Repeat, string> = {
  grid: 'Grid',
  brick: 'Brick',
  mirror: 'Mirror (back and forth)',
  radial: 'Radial',
};
function toggleColor(token: string) {
  if (layer.value?.kind !== 'pattern') return;
  const now = layer.value.colors ?? ['accent', 'fg', 'muted', 'knob'];
  const next = now.includes(token)
    ? now.filter(c => c !== token)
    : [...now, token].slice(0, ART_LIMITS.colors);
  set({ colors: next.length ? next : null }, 'Recolour');
}
</script>

<template>
  <div class="art-view" data-testid="art-view">
    <div class="top">
      <div class="boards" role="tablist">
        <button
          v-for="b in ['icon', 'cover'] as const"
          :key="b"
          :class="{ active: board === b }"
          :data-testid="`art-board-${b}`"
          @click="board = b"
        >
          {{ b === 'icon' ? 'Icon' : 'Cover' }}
        </button>
      </div>
      <span class="muted small">Start from the work:</span>
      <button
        v-for="s in starts"
        :key="s.recipe"
        class="start"
        :title="RECIPE_DOC[s.recipe]"
        :data-testid="`art-start-${s.recipe}`"
        @click="start(s.recipe)"
      >
        <ArtBoard
          :spec="spec"
          :board="board"
          :layers="s.layers"
          :signs="signs"
          :asset-urls="session.assetUrls.value"
          :width="board === 'icon' ? 40 : 72"
        />
        <span>{{ RECIPE_TITLE[s.recipe] }}</span>
      </button>
    </div>
    <div class="middle">
      <div ref="stage" class="stage" tabindex="0" data-testid="art-stage" @keydown="key">
        <div v-if="!layers.length" class="empty muted" data-testid="art-empty">
          The {{ board }} is not made yet: the shelf shows the whole plugin, fitted. Start it from
          the work above, or add a layer.
        </div>
        <ArtBoard
          v-else
          :spec="spec"
          :board="board"
          :layers="shown"
          :signs="signs"
          :asset-urls="session.assetUrls.value"
          :width="width"
          data-testid="art-canvas"
        >
          <template #overlay>
            <div
              ref="overlay"
              class="hits"
              :style="{ '--px': `${1 / scale}px` }"
              data-testid="art-overlay"
              @pointerdown="down"
              @pointermove="move"
              @pointerup="up"
              @pointercancel="up"
              @wheel="wheel"
            >
              <div class="frame-guide" :class="board" />
              <div
                v-if="layer && !layer.hidden"
                class="selection"
                :style="place(layer)"
                data-testid="art-selection"
              >
                <div
                  v-if="layer.kind !== 'ground'"
                  class="handle"
                  data-testid="art-handle"
                  @pointerdown="down($event, true)"
                />
              </div>
            </div>
          </template>
        </ArtBoard>
        <div v-if="layers.length" class="hint muted small">
          Drag a window to move its view (⌥ drag moves the window), the wheel looks closer; drag
          letters and patterns to place them, the corner to size them.
        </div>
      </div>
      <div class="panel" data-testid="art-panel">
        <div class="section">
          <h3>Layers</h3>
          <div
            v-for="l in listed"
            :key="l.id"
            class="layer-row"
            :class="{ on: l.id === selected, hidden: l.hidden }"
            :data-testid="`art-layer-${l.id}`"
          >
            <button class="name as-written" @click="selected = l.id">
              {{ l.name ?? l.id }} <span class="muted small">{{ KIND_TITLE[l.kind] }}</span>
            </button>
            <button class="icon" :title="l.hidden ? 'Show' : 'Hide'" @click="toggle(l)">
              {{ l.hidden ? '○' : '◉' }}
            </button>
            <button class="icon" title="Up" @click="arrange(l.id, 'forward')">▲</button>
            <button class="icon" title="Down" @click="arrange(l.id, 'backward')">▼</button>
            <button
              class="icon"
              title="Remove"
              :data-testid="`art-remove-${l.id}`"
              @click="remove(l.id)"
            >
              ✕
            </button>
          </div>
          <div class="adds">
            <button
              v-for="k in ['ground', 'window', 'mark', 'pattern'] as const"
              :key="k"
              :data-testid="`art-add-${k}`"
              :disabled="layers.length >= ART_LIMITS.layers"
              @click="add(k)"
            >
              + {{ KIND_TITLE[k] }}
            </button>
          </div>
        </div>
        <div v-if="layer" class="section" data-testid="art-fields">
          <h3>{{ KIND_TITLE[layer.kind] }}</h3>
          <template v-if="layer.kind === 'ground'">
            <div class="row">
              <label>Ground</label>
              <select
                :value="groundKind"
                data-testid="art-ground-kind"
                @change="
                  set(
                    ($event.target as HTMLSelectElement).value === 'plugin'
                      ? { fill: null }
                      : { fill: [{ kind: 'color', color: 'bg' }] },
                    'Change',
                  )
                "
              >
                <option value="plugin">The plugin's background</option>
                <option value="own">Its own fills</option>
              </select>
            </div>
            <div class="row">
              <label>From a work</label>
              <select
                data-testid="art-ground-from"
                @change="
                  groundFrom(($event.target as HTMLSelectElement).value);
                  ($event.target as HTMLSelectElement).value = '';
                "
              >
                <option value="">Another work's ground…</option>
                <option v-for="w in WORKS" :key="w.id" :value="w.id">{{ w.title }}</option>
              </select>
            </div>
            <FillList
              v-if="layer.fill"
              :fills="layer.fill"
              :assets="assets"
              @update="
                (fills: Fill[], done: boolean) =>
                  set({ fill: fills }, 'Change', done ? undefined : 'fill')
              "
            />
          </template>
          <template v-else-if="layer.kind === 'window'">
            <div class="row">
              <label>Closer</label>
              <input
                type="range"
                min="-2.3"
                max="3"
                step="0.01"
                :value="zoomSlider"
                data-testid="art-zoom"
                @input="setZoom(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <div class="row">
              <button data-testid="art-centre" @click="centre">Centre on its telling piece</button>
            </div>
            <div class="row">
              <button data-testid="art-hold" @click="hold">
                Hold the controls as they are now
              </button>
            </div>
            <div v-if="held" class="row muted small">
              {{ held }} controls held where you left them.
              <button
                data-testid="art-follow"
                @click="set({ moment: null }, 'Let go of the controls in')"
              >
                Let them follow
              </button>
            </div>
            <StyleEditor
              :value="layer.style"
              :assets="assets"
              @update="
                (s: ElementStyle | null, done: boolean) =>
                  set({ style: s }, 'Style', done ? undefined : 'style')
              "
            />
          </template>
          <template v-else-if="layer.kind === 'mark'">
            <div class="row">
              <label>Text</label>
              <input
                type="text"
                class="as-written"
                :value="layer.text"
                :maxlength="ART_LIMITS.text"
                data-testid="art-text"
                @change="set({ text: ($event.target as HTMLInputElement).value }, 'Write')"
              />
            </div>
            <TextStyleEditor
              :value="layer.textStyle"
              :assets="assets"
              @update="
                (t: TextStyle | null, done: boolean) =>
                  set({ textStyle: t }, 'Letter', done ? undefined : 'text')
              "
            />
            <StyleEditor
              :value="layer.style"
              :assets="assets"
              @update="
                (s: ElementStyle | null, done: boolean) =>
                  set({ style: s }, 'Style', done ? undefined : 'style')
              "
            />
          </template>
          <template v-else>
            <div class="row">
              <label>Repeat</label>
              <select
                :value="layer.repeat"
                data-testid="art-repeat"
                @change="
                  set({ repeat: ($event.target as HTMLSelectElement).value as Repeat }, 'Repeat')
                "
              >
                <option v-for="r in REPEATS" :key="r" :value="r">{{ REPEAT_TITLE[r] }}</option>
              </select>
            </div>
            <div class="row">
              <label>Size</label>
              <input
                type="range"
                min="0.2"
                max="6"
                step="0.05"
                :value="layer.scale"
                data-testid="art-scale"
                @input="
                  set({ scale: Number(($event.target as HTMLInputElement).value) }, 'Size', 'scale')
                "
              />
            </div>
            <div class="row">
              <label>Turn</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                :value="layer.rotate ?? 0"
                @input="
                  set(
                    { rotate: Number(($event.target as HTMLInputElement).value) || null },
                    'Turn',
                    'rotate',
                  )
                "
              />
            </div>
            <div class="row colors">
              <label>Colours</label>
              <button
                v-for="t in TOKENS"
                :key="t"
                class="chip"
                :class="{ on: (layer.colors ?? ['accent', 'fg', 'muted', 'knob']).includes(t) }"
                :data-testid="`art-color-${t}`"
                @click="toggleColor(t)"
              >
                {{ t }}
              </button>
            </div>
          </template>
          <div class="row">
            <label>Name</label>
            <input
              type="text"
              class="as-written"
              :value="layer.name ?? ''"
              :placeholder="layer.id"
              @change="set({ name: ($event.target as HTMLInputElement).value || null }, 'Name')"
            />
          </div>
        </div>
      </div>
    </div>
    <ArtShelf />
  </div>
</template>

<style scoped>
.art-view {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--app-canvas);
  color: var(--text-primary);
  overflow: hidden;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  flex-wrap: wrap;
}
.boards {
  display: flex;
  gap: 2px;
  margin-right: 12px;
}
.boards button.active {
  background: var(--ink);
  color: var(--text-on-ink);
}
.start {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 3px;
}
.middle {
  display: grid;
  grid-template-columns: 1fr 300px;
  min-height: 0;
}
.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
  outline: none;
}
.empty {
  max-width: 340px;
  text-align: center;
}
.hint {
  max-width: 560px;
  text-align: center;
}
.hits {
  position: absolute;
  inset: 0;
  cursor: grab;
}
.frame-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: calc(var(--px) * 1.5) dashed var(--line-strong);
  opacity: 0.35;
}
.frame-guide.icon {
  border-radius: 22.5%;
}
.frame-guide.cover {
  border-radius: 2.5% / 4.4%;
}
.selection {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
  outline: calc(var(--px) * 2) solid var(--selection);
}
.handle {
  position: absolute;
  right: calc(var(--px) * -7);
  bottom: calc(var(--px) * -7);
  width: calc(var(--px) * 14);
  height: calc(var(--px) * 14);
  background: var(--selection-handle);
  border-radius: var(--radius-control);
  pointer-events: auto;
  cursor: nwse-resize;
}
.panel {
  border-left: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  overflow-y: auto;
  font-size: 13.5px;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-control);
}
.layer-row.on {
  background: var(--app-field);
}
.layer-row.hidden .name {
  color: var(--text-muted);
}
.layer-row .name {
  flex: 1;
  min-width: 0;
  text-align: left;
  border-color: transparent;
  background: transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layer-row .icon {
  padding: 2px 5px;
  border-color: transparent;
  background: transparent;
  font-size: 11px;
}
.adds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.row label {
  width: 84px;
}
.row input[type='text'],
.row select,
.row input[type='range'] {
  flex: 1;
  min-width: 0;
}
.colors {
  flex-wrap: wrap;
}
.chip {
  padding: 1px 6px;
  font-size: 11.5px;
}
.chip.on {
  background: var(--ink);
  color: var(--text-on-ink);
}
.small {
  font-size: 12px;
}
.muted {
  color: var(--text-muted);
}
</style>

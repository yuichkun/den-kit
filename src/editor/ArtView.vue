<script setup lang="ts">
// The work's art: its icon and its cover, made by hand. The person starts from the work's own
// look, from a shot of the plugin as they posed it, or from a symbol of one of its modules, then
// moves, sizes and restyles every piece; or asks the AI, which changes the same pieces with the
// same operations. The shelf shows the art where it will be seen: small, and beside other works.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSession } from './context.ts';
import { ART_SIZE, artStack, type ArtElement, type ArtSurfaceName } from '../work/art.ts';
import { startFromLook, tellingModule } from '../work/art-starts.ts';
import type { Intent } from '../work/ops.ts';
import { assetsOf, isImageAsset, type Rect } from '../work/ui.ts';
import ArtSurface from '../screen/ArtSurface.vue';
import ArtInspector from './art/ArtInspector.vue';
import ArtShelf from './art/ArtShelf.vue';
import ShotFinder from './art/ShotFinder.vue';
import SymbolMaker from './art/SymbolMaker.vue';
import { artCommitter } from './art/commit.ts';

const props = defineProps<{ on: ArtSurfaceName; selected: string | null }>();
const emit = defineEmits<{
  (e: 'update:on', on: ArtSurfaceName): void;
  (e: 'update:selected', id: string | null): void;
}>();
const session = useSession();
const doc = computed(() => session.doc.value);
const commit = artCommitter(session);
const design = computed(() => ART_SIZE[props.on]);
const surface = computed(() => doc.value.art?.[props.on]);
const items = computed(() => (surface.value ? artStack(surface.value) : []));
const element = computed<ArtElement | undefined>(() =>
  props.selected ? surface.value?.elements[props.selected] : undefined,
);
const where = computed(() => `on the ${props.on}`);
const select = (id: string | null) => emit('update:selected', id);
// A selection that is gone (undone, removed by the AI) clears.
watch([surface, () => props.selected], () => {
  if (props.selected && !surface.value?.elements[props.selected]) select(null);
});
watch(
  () => props.on,
  () => select(null),
);

// ---- the canvas: the surface fitted to the space, with the selection over it ----------
const stage = ref<HTMLElement | null>(null);
const box = ref({ w: 0, h: 0 });
const scale = computed(() =>
  box.value.w && box.value.h
    ? Math.min((box.value.w - 64) / design.value.width, (box.value.h - 64) / design.value.height)
    : 0.5,
);
const shown = computed(() => ({
  w: design.value.width * scale.value,
  h: design.value.height * scale.value,
}));
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(entries => {
    const r = entries[0]!.contentRect;
    box.value = { w: r.width, h: r.height };
  });
  if (stage.value) observer.observe(stage.value);
});
onBeforeUnmount(() => observer?.disconnect());
const onScreen = (r: Rect) => ({
  left: `${r.x * scale.value}px`,
  top: `${r.y * scale.value}px`,
  width: `${r.w * scale.value}px`,
  height: `${r.h * scale.value}px`,
});

const sheet = ref<HTMLElement | null>(null);
function designPoint(e: PointerEvent) {
  const r = sheet.value!.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale.value, y: (e.clientY - r.top) / scale.value };
}
function hit(p: { x: number; y: number }): ArtElement | undefined {
  return [...items.value]
    .reverse()
    .find(
      e =>
        !e.hidden &&
        !e.locked &&
        p.x >= e.rect.x &&
        p.x <= e.rect.x + e.rect.w &&
        p.y >= e.rect.y &&
        p.y <= e.rect.y + e.rect.h,
    );
}
/** Where the moved box's centre lines up with the surface's, it snaps (and a guide shows). */
const guides = ref<{ x: boolean; y: boolean }>({ x: false, y: false });
type Drag = {
  id: string;
  from: { x: number; y: number };
  rect: Rect;
  key: string;
  corner?: 'nw' | 'ne' | 'sw' | 'se';
};
let drag: Drag | null = null;
function down(e: PointerEvent) {
  stage.value?.focus();
  const p = designPoint(e);
  const target = hit(p);
  select(target?.id ?? null);
  if (!target) return;
  drag = { id: target.id, from: p, rect: { ...target.rect }, key: `move-${Date.now()}` };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function grab(e: PointerEvent, corner: Drag['corner']) {
  if (!element.value) return;
  e.stopPropagation();
  drag = {
    id: element.value.id,
    from: designPoint(e),
    rect: { ...element.value.rect },
    key: `size-${Date.now()}`,
    corner,
  };
  sheet.value?.setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (!drag) return;
  const p = designPoint(e);
  const dx = p.x - drag.from.x,
    dy = p.y - drag.from.y;
  const r = drag.rect;
  let next: Rect;
  if (!drag.corner) {
    next = { ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) };
    const cx = next.x + next.w / 2,
      cy = next.y + next.h / 2;
    const snap = 8 / Math.max(scale.value, 0.1);
    guides.value = {
      x: Math.abs(cx - design.value.width / 2) < snap,
      y: Math.abs(cy - design.value.height / 2) < snap,
    };
    if (guides.value.x) next.x = Math.round(design.value.width / 2 - next.w / 2);
    if (guides.value.y) next.y = Math.round(design.value.height / 2 - next.h / 2);
  } else {
    const left = drag.corner.endsWith('w'),
      top = drag.corner.startsWith('n');
    let w = Math.max(4, r.w + (left ? -dx : dx)),
      h = Math.max(4, r.h + (top ? -dy : dy));
    // Pictures and symbols keep their proportions unless Shift is held; other things the other way round.
    const el = surface.value?.elements[drag.id];
    const keep = (el?.kind === 'image' || el?.kind === 'symbol') !== e.shiftKey;
    if (keep) {
      const k = Math.max(w / r.w, h / r.h);
      w = r.w * k;
      h = r.h * k;
    }
    next = {
      x: Math.round(left ? r.x + r.w - w : r.x),
      y: Math.round(top ? r.y + r.h - h : r.y),
      w: Math.round(w),
      h: Math.round(h),
    };
  }
  commit(
    [{ op: 'setRect', on: props.on, id: drag.id, rect: next }],
    `${drag.corner ? 'Size' : 'Move'} ${drag.id} ${where.value}`,
    drag.key,
  );
}
function up() {
  drag = null;
  guides.value = { x: false, y: false };
}
function keys(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return;
  const el = element.value;
  if (e.key === 'Escape') {
    select(null);
    return;
  }
  if (!el) return;
  const step = e.shiftKey ? 10 : 1;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  if (arrows[e.key]) {
    e.preventDefault();
    const [dx, dy] = arrows[e.key]!;
    commit(
      [
        {
          op: 'setRect',
          on: props.on,
          id: el.id,
          rect: { ...el.rect, x: el.rect.x + dx, y: el.rect.y + dy },
        },
      ],
      `Nudge ${el.id} ${where.value}`,
      `nudge-${el.id}`,
    );
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (
      commit([{ op: 'removeElement', on: props.on, id: el.id }], `Delete ${el.id} ${where.value}`)
    )
      select(null);
  }
}

// ---- adding and starting ------------------------------------------------------------------
/** Add one thing in the middle of the surface, and select it. */
function add(element: Record<string, unknown>, what: string) {
  const r = session.commit([{ op: 'addElement', on: props.on, element: element as never }], {
    label: `Add ${what} ${where.value}`,
  });
  if (!r.ok) {
    session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
    return;
  }
  select(r.created[0] ?? null);
  void nextTick(() => stage.value?.focus());
}
const centred = (w: number, h: number) => ({
  x: Math.round((design.value.width - w) / 2),
  y: Math.round((design.value.height - h) / 2),
  w,
  h,
});
function addText() {
  const w = Math.round(design.value.width * 0.7);
  add(
    {
      kind: 'text',
      text: doc.value.name,
      textStyle: {
        font: 'font',
        size: Math.round(design.value.height / 7),
        weight: 700,
        color: 'fg',
        align: 'center',
        valign: 'middle',
      },
      rect: centred(w, Math.round(design.value.height / 5)),
    },
    'text',
  );
}
function addShape(shape: 'rect' | 'ellipse') {
  const side = Math.round(Math.min(design.value.width, design.value.height) * 0.4);
  add(
    {
      kind: 'shape',
      shape,
      style: { fill: [{ kind: 'color', color: 'accent' }] },
      rect: centred(side, side),
    },
    shape === 'rect' ? 'a rectangle' : 'an ellipse',
  );
}
const pictures = computed(() => Object.values(assetsOf(doc.value.files)).filter(isImageAsset));
function addPicture(id: string) {
  const a = assetsOf(doc.value.files)[id];
  if (!a) return;
  const k = Math.min(
    1,
    (design.value.width * 0.8) / (a.width ?? 400),
    (design.value.height * 0.8) / (a.height ?? 400),
  );
  add(
    {
      kind: 'image',
      asset: id,
      fit: 'contain',
      rect: centred(Math.round((a.width ?? 400) * k), Math.round((a.height ?? 400) * k)),
    },
    'a picture',
  );
}
const fileInput = ref<HTMLInputElement | null>(null);
async function pictureFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  const asset = await session.addAssetFile(file);
  if (asset) addPicture(asset.id);
}
const pictureMenu = ref(false);
const symbolOpen = ref(false);
const shotOpen = ref(false);
const shelfOpen = ref(true);
const empty = computed(() => !items.value.length && !surface.value?.background?.length);
function fromLook() {
  commit(startFromLook(doc.value, props.on), `Start the ${props.on} from the look`);
  select(null);
}
function placeSymbol(spec: Record<string, unknown>) {
  symbolOpen.value = false;
  add(spec, 'a symbol');
}
function placeShot(intents: Intent[], label: string) {
  shotOpen.value = false;
  commit(intents, label);
}
defineExpose({ fromLook });
</script>

<template>
  <div class="art-view" data-testid="art-view">
    <div class="bar">
      <div class="modes">
        <button
          v-for="s in ['icon', 'cover'] as const"
          :key="s"
          :class="{ active: on === s }"
          :data-testid="`art-${s}`"
          @click="emit('update:on', s)"
        >
          {{ s === 'icon' ? 'Icon' : 'Cover' }}
        </button>
      </div>
      <span class="label">{{ empty ? 'Start' : 'Start over' }}</span>
      <button
        class="small"
        data-testid="art-from-look"
        title="The work's background, colours and name, and a symbol of its most telling module"
        @click="fromLook"
      >
        From the look
      </button>
      <button
        class="small"
        data-testid="art-shot"
        title="Pose the plugin and take a picture of it"
        @click="shotOpen = true"
      >
        Shot of the plugin
      </button>
      <span class="sep" />
      <span class="label">Add</span>
      <button class="small" data-testid="art-add-text" @click="addText">Text</button>
      <button class="small" data-testid="art-add-rect" @click="addShape('rect')">Rectangle</button>
      <button class="small" data-testid="art-add-ellipse" @click="addShape('ellipse')">
        Ellipse
      </button>
      <span class="menu-anchor">
        <button class="small" data-testid="art-add-picture" @click="pictureMenu = !pictureMenu">
          Picture ▾
        </button>
        <div v-if="pictureMenu" class="menu" @click="pictureMenu = false">
          <button v-for="p in pictures" :key="p.id" class="as-written" @click="addPicture(p.id)">
            {{ p.name }}
          </button>
          <button @click="fileInput?.click()">From a file…</button>
        </div>
      </span>
      <button
        class="small"
        data-testid="art-add-symbol"
        :disabled="!tellingModule(doc)"
        :title="
          tellingModule(doc)
            ? 'The shape of one of the patch’s modules'
            : 'The patch has no module with a shape to draw'
        "
        @click="symbolOpen = true"
      >
        Symbol
      </button>
      <span class="spacer" />
      <label class="toggle"
        ><input v-model="shelfOpen" type="checkbox" data-testid="art-shelf-toggle" /> Shelf</label
      >
      <input ref="fileInput" type="file" accept="image/*" hidden @change="pictureFile" />
    </div>
    <div class="body">
      <div ref="stage" class="stage" tabindex="0" data-testid="art-stage" @keydown="keys">
        <div class="frame" :style="{ width: `${shown.w}px`, height: `${shown.h}px` }">
          <ArtSurface :doc="doc" :on="on" :size="shown.w" :asset-urls="session.assetUrls.value" />
          <div
            ref="sheet"
            class="sheet"
            data-testid="art-sheet"
            @pointerdown="down"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
          >
            <div v-if="guides.x" class="guide v" />
            <div v-if="guides.y" class="guide h" />
            <div
              v-if="element"
              class="selection"
              :style="onScreen(element.rect)"
              data-testid="art-selection"
            >
              <i
                v-for="c in ['nw', 'ne', 'sw', 'se'] as const"
                :key="c"
                class="handle"
                :class="c"
                :data-handle="c"
                @pointerdown="grab($event, c)"
              />
            </div>
          </div>
          <div v-if="empty" class="empty">
            <p>The {{ on }} is empty.</p>
            <p>
              Start from the look, take a shot of the plugin, add a symbol of a module, or ask the
              AI.
            </p>
          </div>
        </div>
      </div>
      <ArtInspector class="side" :on="on" :selected="selected" :commit="commit" @select="select" />
    </div>
    <ArtShelf v-if="shelfOpen" :on="on" />
    <SymbolMaker v-if="symbolOpen" :on="on" @place="placeSymbol" @close="symbolOpen = false" />
    <ShotFinder v-if="shotOpen" :on="on" @place="placeShot" @close="shotOpen = false" />
  </div>
</template>

<style scoped>
.art-view {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  flex-wrap: wrap;
  font-size: 13px;
}
.modes {
  display: flex;
  background: var(--app-field);
  border-radius: var(--radius-control);
  clip-path: var(--clip-control);
  padding: 2px;
}
.modes button {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--text-muted);
  padding: 3px 12px;
}
.modes button.active {
  background: var(--ink);
  color: var(--text-on-ink);
}
.label {
  color: var(--text-muted);
  font-size: 12px;
}
.sep {
  width: 1px;
  align-self: stretch;
  background: var(--line-subtle);
}
.small {
  padding: 2px 8px;
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--text-muted);
  font-size: 12px;
}
.menu-anchor {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-menu);
}
.menu button {
  text-align: left;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.stage {
  flex: 1;
  position: relative;
  display: grid;
  place-items: center;
  background: var(--app-canvas);
  outline: none;
  min-width: 0;
}
.frame {
  position: relative;
  box-shadow: var(--shadow-menu);
}
.sheet {
  position: absolute;
  inset: 0;
  cursor: default;
}
.selection {
  position: absolute;
  outline: 1.5px solid var(--selection);
  pointer-events: none;
}
.handle {
  position: absolute;
  width: 9px;
  height: 9px;
  background: var(--selection-handle);
  border: 1.5px solid var(--selection);
  border-radius: var(--radius-control);
  pointer-events: auto;
  box-sizing: border-box;
}
.handle.nw {
  left: -5px;
  top: -5px;
  cursor: nwse-resize;
}
.handle.ne {
  right: -5px;
  top: -5px;
  cursor: nesw-resize;
}
.handle.sw {
  left: -5px;
  bottom: -5px;
  cursor: nesw-resize;
}
.handle.se {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}
.guide {
  position: absolute;
  background: var(--accent);
  pointer-events: none;
}
.guide.v {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
}
.guide.h {
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  pointer-events: none;
  padding: 24px;
}
.empty p {
  margin: 4px 0;
}
.side {
  width: 280px;
  flex: none;
  border-left: 1px solid var(--line-subtle);
  background: var(--app-chrome);
}
</style>

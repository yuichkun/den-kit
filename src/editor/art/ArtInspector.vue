<script setup lang="ts">
// What the selected element of the icon or cover is, and every way to change it by hand: its
// place and size, its words and type, its picture, the module a symbol draws and its ink, line
// and frame, and its box. With nothing selected: the surface's background and its layers.
import { computed } from 'vue';
import { useSession } from '../context.ts';
import {
  artStack,
  drawable,
  type ArtElement,
  type ArtSurfaceName,
  type SymbolElement,
} from '../../work/art.ts';
import { assetsOf, isImageAsset, type Fill, type Rect } from '../../work/ui.ts';
import type { ArtCommit } from './commit.ts';
import StyleEditor from '../plugin/StyleEditor.vue';
import TextStyleEditor from '../plugin/TextStyleEditor.vue';
import FillList from '../plugin/FillList.vue';
import ColorField from '../plugin/ColorField.vue';
import NumberField from '../plugin/NumberField.vue';

const props = defineProps<{ on: ArtSurfaceName; selected: string | null; commit: ArtCommit }>();
const emit = defineEmits<{ (e: 'select', id: string | null): void }>();
const session = useSession();
const doc = computed(() => session.doc.value);
const surface = computed(() => doc.value.art?.[props.on]);
const el = computed<ArtElement | undefined>(() =>
  props.selected ? surface.value?.elements[props.selected] : undefined,
);
const assets = computed(() => assetsOf(doc.value.files));
const pictures = computed(() => Object.values(assets.value).filter(isImageAsset));
const modules = computed(() =>
  Object.values(doc.value.nodes)
    .filter(n => drawable(n))
    .map(n => ({ id: n.id, title: n.label ?? session.catalog.find(n.type)?.title ?? n.type })),
);
const layers = computed(() => (surface.value ? artStack(surface.value) : []).slice().reverse());
const where = computed(() => `on the ${props.on}`);
const label = (e: ArtElement) =>
  e.name ??
  (e.kind === 'text'
    ? `“${e.text.slice(0, 18)}”`
    : e.kind === 'symbol'
      ? `symbol of ${e.node}`
      : e.kind === 'image'
        ? e.asset.split('/').at(-1)!
        : e.id);

const set = (patch: Record<string, unknown>, what: string, key?: string) => {
  if (el.value)
    props.commit(
      [{ op: 'updateElement', on: props.on, id: el.value.id, set: patch }],
      `${what} ${el.value.id} ${where.value}`,
      key,
    );
};
const setRect = (patch: Partial<Rect>) => {
  if (el.value)
    props.commit(
      [{ op: 'setRect', on: props.on, id: el.value.id, rect: { ...el.value.rect, ...patch } }],
      `Place ${el.value.id} ${where.value}`,
    );
};
const arrange = (to: 'front' | 'back') => {
  if (el.value)
    props.commit(
      [{ op: 'arrange', on: props.on, ids: [el.value.id], to }],
      `${to === 'front' ? 'Bring' : 'Send'} ${el.value.id} to the ${to} ${where.value}`,
    );
};
const remove = () => {
  if (!el.value) return;
  const id = el.value.id;
  if (props.commit([{ op: 'removeElement', on: props.on, id }], `Delete ${id} ${where.value}`))
    emit('select', null);
};
const setBackground = (fills: Fill[], done: boolean) =>
  props.commit(
    [{ op: 'setArt', on: props.on, set: { background: fills.length ? fills : null } }],
    `Background of the ${props.on}`,
    done ? undefined : `bg-${props.on}`,
  );

// A symbol's frame: its box filled and rounded (a circle, a rounded square, a square) or none.
const FRAMES = [
  { id: 'none', title: 'None' },
  { id: 'circle', title: 'Circle' },
  { id: 'rounded', title: 'Rounded' },
  { id: 'square', title: 'Square' },
] as const;
function frameOf(s: SymbolElement): string {
  if (!s.style?.fill?.length) return 'none';
  const side = Math.min(s.rect.w, s.rect.h);
  const r = s.style.radius ?? 0;
  return r >= side / 2 - 1 ? 'circle' : r > 0 ? 'rounded' : 'square';
}
function setFrame(s: SymbolElement, frame: string) {
  const side = Math.min(s.rect.w, s.rect.h);
  const fill = s.style?.fill?.length ? s.style.fill : [{ kind: 'color', color: 'knob' }];
  const style =
    frame === 'none'
      ? null
      : {
          ...s.style,
          fill,
          radius: frame === 'circle' ? side / 2 : frame === 'rounded' ? side * 0.22 : 0,
        };
  set({ style }, 'Frame');
}
const ground = (s: SymbolElement) => {
  const f = s.style?.fill?.[0];
  return f?.kind === 'color' ? f.color : undefined;
};
</script>

<template>
  <div class="art-inspector" data-testid="art-inspector">
    <template v-if="el">
      <div class="head">
        <b>{{ el.kind === 'image' ? 'picture' : el.kind }}</b>
        <span class="id">{{ el.id }}</span>
        <span class="spacer" />
        <button title="Bring to the front" @click="arrange('front')">Front</button>
        <button title="Send to the back" @click="arrange('back')">Back</button>
        <button title="Delete (⌫)" data-testid="art-delete" @click="remove">Delete</button>
      </div>
      <div class="grid4">
        <label
          >X <NumberField :value="el.rect.x" @update="v => v !== null && setRect({ x: v })"
        /></label>
        <label
          >Y <NumberField :value="el.rect.y" @update="v => v !== null && setRect({ y: v })"
        /></label>
        <label
          >W
          <NumberField :value="el.rect.w" :min="1" @update="v => v !== null && setRect({ w: v })"
        /></label>
        <label
          >H
          <NumberField :value="el.rect.h" :min="1" @update="v => v !== null && setRect({ h: v })"
        /></label>
      </div>

      <template v-if="el.kind === 'text'">
        <h4>Words</h4>
        <textarea
          class="words"
          rows="2"
          :value="el.text"
          data-testid="art-text"
          @input="
            set({ text: ($event.target as HTMLTextAreaElement).value }, 'Words of', `text-${el.id}`)
          "
        />
        <h4>Type</h4>
        <TextStyleEditor
          :value="el.textStyle"
          :assets="assets"
          @update="
            (t, done) => set({ textStyle: t }, 'Type of', done ? undefined : `type-${el!.id}`)
          "
        />
      </template>

      <template v-else-if="el.kind === 'symbol'">
        <h4>Symbol</h4>
        <label class="row"
          >Draws
          <select
            :value="el.node"
            data-testid="art-symbol-module"
            @change="set({ node: ($event.target as HTMLSelectElement).value }, 'Draw a module in')"
          >
            <option v-if="!modules.some(m => m.id === (el as SymbolElement).node)" :value="el.node">
              {{ el.node }} (gone from the patch)
            </option>
            <option v-for="m in modules" :key="m.id" :value="m.id">
              {{ m.id }} · {{ m.title }}
            </option>
          </select>
          <button
            v-if="modules.some(m => m.id === (el as SymbolElement).node)"
            title="Draw the module as it is now (the symbol keeps the shape it had when drawn)"
            @click="set({ node: (el as SymbolElement).node }, 'Redraw')"
          >
            Redraw
          </button>
        </label>
        <label class="row"
          >Ink
          <ColorField
            :value="el.ink"
            placeholder="accent"
            clearable
            @update="(c, done) => set({ ink: c }, 'Ink of', done ? undefined : `ink-${el!.id}`)"
        /></label>
        <label class="row"
          >Line
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            :value="el.weight ?? 4"
            data-testid="art-symbol-weight"
            @input="
              set(
                { weight: Number(($event.target as HTMLInputElement).value) },
                'Line of',
                `w-${el!.id}`,
              )
            "
          />
          <span class="num">{{ el.weight ?? 4 }}</span>
        </label>
        <div class="row frames">
          Frame
          <button
            v-for="f in FRAMES"
            :key="f.id"
            :class="{ on: frameOf(el as SymbolElement) === f.id }"
            :data-frame="f.id"
            @click="setFrame(el as SymbolElement, f.id)"
          >
            {{ f.title }}
          </button>
        </div>
        <label v-if="frameOf(el) !== 'none'" class="row"
          >Ground
          <ColorField
            :value="ground(el)"
            @update="
              (c, done) =>
                c &&
                set(
                  {
                    style: { ...(el as SymbolElement).style, fill: [{ kind: 'color', color: c }] },
                  },
                  'Ground of',
                  done ? undefined : `ground-${el!.id}`,
                )
            "
        /></label>
      </template>

      <template v-else-if="el.kind === 'image'">
        <h4>Picture</h4>
        <label class="row"
          >File
          <select
            :value="el.asset"
            @change="set({ asset: ($event.target as HTMLSelectElement).value }, 'Picture of')"
          >
            <option v-for="p in pictures" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label class="row"
          >Fit
          <select
            :value="el.fit"
            @change="set({ fit: ($event.target as HTMLSelectElement).value }, 'Fit of')"
          >
            <option value="cover">Fill (crop)</option>
            <option value="contain">Fit inside</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>
      </template>

      <template v-else-if="el.kind === 'shape'">
        <label class="row"
          >Shape
          <select
            :value="el.shape"
            @change="set({ shape: ($event.target as HTMLSelectElement).value }, 'Shape of')"
          >
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
          </select>
        </label>
      </template>

      <h4>Box</h4>
      <StyleEditor
        :value="el.style"
        :assets="assets"
        :shape="el.kind === 'shape' ? el.shape : undefined"
        @update="(s, done) => set({ style: s }, 'Box of', done ? undefined : `box-${el!.id}`)"
      />
    </template>

    <template v-else>
      <div class="head">
        <b>The {{ on }}</b>
      </div>
      <h4>Background</h4>
      <p v-if="!surface?.background?.length" class="hint">
        The look's background colour (bg). Add layers to change it.
      </p>
      <FillList :fills="surface?.background ?? []" :assets="assets" @update="setBackground" />
      <h4>Layers</h4>
      <p v-if="!layers.length" class="hint">Nothing on the {{ on }} yet.</p>
      <button
        v-for="l in layers"
        :key="l.id"
        class="layer"
        :data-layer="l.id"
        @click="emit('select', l.id)"
      >
        <span class="kind">{{ l.kind === 'image' ? 'picture' : l.kind }}</span> {{ label(l) }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.art-inspector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  font-size: 12px;
  overflow: auto;
  min-height: 0;
}
/* The panel scrolls; its fields keep their height (a textarea would shrink to nothing). */
.art-inspector > * {
  flex-shrink: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.head .id {
  color: var(--text-muted);
}
.spacer {
  flex: 1;
}
h4 {
  margin: 8px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.grid4 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
}
.grid4 label,
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.row > select,
.row > input[type='range'] {
  flex: 1;
  min-width: 0;
}
.words {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
}
.frames button.on {
  outline: 1px solid var(--accent);
}
.num {
  width: 2.5em;
  text-align: right;
  color: var(--text-muted);
}
.hint {
  margin: 0;
  color: var(--text-muted);
}
.layer {
  text-align: left;
}
.layer .kind {
  color: var(--text-muted);
}
</style>

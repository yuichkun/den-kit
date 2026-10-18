<script setup lang="ts">
// Fill layers, bottom first: colours, linear and radial gradients, pictures
// (cover, contain, stretch or tiled), each with its own opacity and blend.
import { computed } from 'vue';
import { BLEND_MODES, isImageAsset, type AssetMeta, type Fill, type Stop } from '../../core/ui.ts';
import ColorField from './ColorField.vue';
import NumberField from './NumberField.vue';

const props = defineProps<{ fills: Fill[]; assets: Record<string, AssetMeta> }>();
const emit = defineEmits<{ (e: 'update', fills: Fill[], done: boolean): void }>();
const pictures = computed(() => Object.values(props.assets).filter(isImageAsset));
const set = (i: number, fill: Fill, done = true) =>
  emit(
    'update',
    props.fills.map((f, k) => (k === i ? fill : f)),
    done,
  );
const stops2 = (): Stop[] => [
  { color: '#ffffff', at: 0 },
  { color: '#000000', at: 1 },
];
function kind(i: number, kind: Fill['kind']) {
  const old = props.fills[i]!;
  const keep = {
    ...(old.opacity !== undefined ? { opacity: old.opacity } : {}),
    ...(old.blend ? { blend: old.blend } : {}),
  };
  const stops = 'stops' in old ? old.stops : stops2();
  const next: Fill =
    kind === 'color'
      ? { kind, color: 'color' in old ? old.color : stops[0]!.color, ...keep }
      : kind === 'linear'
        ? { kind, angle: 180, stops, ...keep }
        : kind === 'radial'
          ? { kind, x: 0.5, y: 0.5, stops, ...keep }
          : { kind, asset: pictures.value[0]?.id ?? '', fit: 'cover', ...keep };
  if (next.kind === 'image' && !next.asset) return;
  set(i, next);
}
function add(kind: Fill['kind']) {
  const fill: Fill | null =
    kind === 'color'
      ? { kind, color: 'accent' }
      : kind === 'linear'
        ? {
            kind,
            angle: 180,
            stops: [
              { color: '#ffffff33', at: 0 },
              { color: '#00000066', at: 1 },
            ],
          }
        : kind === 'radial'
          ? {
              kind,
              x: 0.5,
              y: 0.35,
              stops: [
                { color: '#ffffff40', at: 0 },
                { color: '#00000000', at: 1 },
              ],
            }
          : pictures.value[0]
            ? { kind, asset: pictures.value[0].id, fit: 'cover' }
            : null;
  if (fill) emit('update', [...props.fills, fill], true);
}
const move = (i: number, d: number) => {
  const list = [...props.fills];
  const [f] = list.splice(i, 1);
  list.splice(Math.max(0, Math.min(list.length, i + d)), 0, f!);
  emit('update', list, true);
};
const remove = (i: number) =>
  emit(
    'update',
    props.fills.filter((_, k) => k !== i),
    true,
  );
function stop(i: number, s: number, patch: Partial<Stop> | null, done = true) {
  const f = props.fills[i]!;
  if (!('stops' in f)) return;
  const stops =
    patch === null
      ? f.stops.filter((_, k) => k !== s)
      : f.stops.map((x, k) => (k === s ? { ...x, ...patch } : x));
  if (stops.length >= 2) set(i, { ...f, stops }, done);
}
function addStop(i: number) {
  const f = props.fills[i]!;
  if ('stops' in f && f.stops.length < 16)
    set(i, { ...f, stops: [...f.stops, { color: f.stops.at(-1)!.color, at: 1 }] });
}
</script>

<template>
  <div class="fills">
    <div v-for="(f, i) in fills" :key="i" class="layer" :data-fill="i">
      <div class="row head">
        <select
          :value="f.kind"
          @change="kind(i, ($event.target as HTMLSelectElement).value as Fill['kind'])"
        >
          <option value="color">Colour</option>
          <option value="linear">Linear gradient</option>
          <option value="radial">Radial gradient</option>
          <option value="image" :disabled="!pictures.length">Picture</option>
        </select>
        <button
          type="button"
          class="tiny"
          title="Down (drawn earlier)"
          :disabled="i === 0"
          @click="move(i, -1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="tiny"
          title="Up (drawn later)"
          :disabled="i === fills.length - 1"
          @click="move(i, 1)"
        >
          ↓
        </button>
        <button type="button" class="tiny" title="Remove this layer" @click="remove(i)">×</button>
      </div>
      <div v-if="f.kind === 'color'" class="row">
        <label>Colour</label
        ><ColorField
          :value="f.color"
          :clearable="false"
          @update="(c, done) => c && set(i, { ...f, color: c }, done)"
        />
      </div>
      <template v-else-if="f.kind === 'linear' || f.kind === 'radial'">
        <div v-if="f.kind === 'linear'" class="row">
          <label>Angle</label
          ><NumberField
            :value="f.angle"
            :min="-360"
            :max="360"
            :step="5"
            unit="°"
            @update="v => v !== null && set(i, { ...f, angle: v })"
          />
        </div>
        <div v-else class="row">
          <label>Centre</label
          ><NumberField
            :value="Math.round(f.x * 100)"
            :min="0"
            :max="100"
            unit="%"
            @update="v => v !== null && set(i, { ...f, x: v / 100 })"
          /><NumberField
            :value="Math.round(f.y * 100)"
            :min="0"
            :max="100"
            unit="%"
            @update="v => v !== null && set(i, { ...f, y: v / 100 })"
          />
        </div>
        <div v-for="(s, k) in f.stops" :key="k" class="row stop">
          <ColorField
            :value="s.color"
            :clearable="false"
            @update="(c, done) => c && stop(i, k, { color: c }, done)"
          /><NumberField
            class="at"
            :value="Math.round(s.at * 100)"
            :min="0"
            :max="100"
            unit="%"
            @update="v => v !== null && stop(i, k, { at: v / 100 })"
          /><button v-if="f.stops.length > 2" type="button" class="tiny" @click="stop(i, k, null)">
            ×
          </button>
        </div>
        <div class="row">
          <button type="button" class="tiny" @click="addStop(i)">+ stop</button>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <label>Picture</label
          ><select
            :value="f.asset"
            @change="set(i, { ...f, asset: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="a in pictures" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div class="row">
          <label>Fit</label
          ><select
            :value="f.fit"
            @change="set(i, { ...f, fit: ($event.target as HTMLSelectElement).value as never })"
          >
            <option value="cover">cover</option>
            <option value="contain">contain</option>
            <option value="stretch">stretch</option>
            <option value="tile">tile</option></select
          ><NumberField
            v-if="f.fit === 'tile'"
            :value="f.size ?? 256"
            :min="4"
            :max="4000"
            unit="px"
            @update="v => v !== null && set(i, { ...f, size: v })"
          />
        </div>
      </template>
      <div class="row">
        <label>Opacity</label
        ><input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="f.opacity ?? 1"
          @input="
            set(i, { ...f, opacity: Number(($event.target as HTMLInputElement).value) }, false)
          "
          @change="set(i, { ...f, opacity: Number(($event.target as HTMLInputElement).value) })"
        /><select
          class="blend"
          :value="f.blend ?? 'normal'"
          title="Blend"
          @change="set(i, { ...f, blend: ($event.target as HTMLSelectElement).value as never })"
        >
          <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
    </div>
    <div class="row add">
      <button type="button" class="tiny" @click="add('color')">+ Colour</button
      ><button type="button" class="tiny" @click="add('linear')">+ Gradient</button
      ><button
        type="button"
        class="tiny"
        :disabled="!pictures.length"
        :title="pictures.length ? '' : 'Add a picture to the assets first'"
        @click="add('image')"
      >
        + Picture
      </button>
    </div>
  </div>
</template>

<style scoped>
.layer {
  border: 1px solid #333;
  border-radius: 6px;
  padding: 4px 6px;
  margin: 4px 0;
  background: #1d1d1d;
}
.head select {
  flex: 1;
}
.row label {
  width: 64px;
}
.tiny {
  padding: 1px 7px;
  font-size: 12px;
}
.stop .at {
  max-width: 74px;
}
.blend {
  max-width: 92px;
  font-size: 12px;
}
input[type='range'] {
  flex: 1;
  min-width: 0;
}
.add {
  flex-wrap: wrap;
}
</style>

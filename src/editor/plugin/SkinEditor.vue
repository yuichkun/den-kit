<script setup lang="ts">
// How a kind of control looks: pick a skin, then tune its parameters (colours,
// sizes, choices, pictures).
import { computed } from 'vue';
import {
  skinDef,
  skinsFor,
  type ControlKind,
  type Skin,
  type SkinParamValue,
} from '../../core/skins.ts';
import { isImageAsset, type AssetMeta } from '../../core/ui.ts';
import ColorField from './ColorField.vue';
import NumberField from './NumberField.vue';

const props = defineProps<{
  control: ControlKind;
  value: Skin | undefined;
  assets: Record<string, AssetMeta>;
  inherited?: string;
}>();
const emit = defineEmits<{ (e: 'update', skin: Skin | null, done: boolean): void }>();
const def = computed(() => (props.value ? skinDef(props.control, props.value.name) : undefined));
const pictures = computed(() => Object.values(props.assets).filter(isImageAsset));
function param(id: string, v: SkinParamValue | null, done = true) {
  if (!props.value) return;
  const params = { ...(props.value.params ?? {}) };
  if (v === null) delete params[id];
  else params[id] = v;
  emit(
    'update',
    Object.keys(params).length ? { name: props.value.name, params } : { name: props.value.name },
    done,
  );
}
</script>

<template>
  <div class="skin-editor">
    <div class="row">
      <label>Skin</label
      ><select
        :value="value?.name ?? ''"
        data-field="skin"
        @change="
          emit(
            'update',
            ($event.target as HTMLSelectElement).value
              ? { name: ($event.target as HTMLSelectElement).value }
              : null,
            true,
          )
        "
      >
        <option value="">{{ inherited ? `(${inherited})` : '(default)' }}</option>
        <option v-for="s in skinsFor(control)" :key="s.name" :value="s.name" :title="s.doc">
          {{ s.title }}
        </option>
      </select>
    </div>
    <div v-if="def" class="doc">{{ def.doc }}</div>
    <template v-if="def">
      <div v-for="p in def.params" :key="p.id" class="row" :title="p.doc">
        <label>{{ p.id }}</label>
        <ColorField
          v-if="p.kind === 'color'"
          :value="value?.params?.[p.id] as string | undefined"
          :placeholder="String(p.default)"
          @update="(c, done) => param(p.id, c, done)"
        />
        <NumberField
          v-else-if="p.kind === 'number'"
          :value="value?.params?.[p.id] as number | undefined"
          :placeholder="String(p.default)"
          :min="p.min"
          :max="p.max"
          :step="(p.max ?? 1) - (p.min ?? 0) <= 2 ? 0.05 : 1"
          @update="v => param(p.id, v)"
        />
        <select
          v-else-if="p.kind === 'enum'"
          :value="String(value?.params?.[p.id] ?? p.default)"
          @change="param(p.id, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="o in p.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <input
          v-else-if="p.kind === 'boolean'"
          type="checkbox"
          :checked="Boolean(value?.params?.[p.id] ?? p.default)"
          @change="param(p.id, ($event.target as HTMLInputElement).checked)"
        />
        <select
          v-else-if="p.kind === 'asset'"
          :value="String(value?.params?.[p.id] ?? '')"
          @change="param(p.id, ($event.target as HTMLSelectElement).value || null)"
        >
          <option value="">(none)</option>
          <option v-for="a in pictures" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <input
          v-else
          type="text"
          :value="String(value?.params?.[p.id] ?? p.default)"
          @change="param(p.id, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.row label {
  width: 74px;
  font-size: 13px;
}
.doc {
  color: var(--muted);
  font-size: 12.5px;
  margin: 0 0 4px;
}
select,
input[type='text'] {
  flex: 1;
  min-width: 0;
}
</style>

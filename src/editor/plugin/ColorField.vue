<script setup lang="ts">
// A colour: a look token (accent, fg…), #hex, rgb()/hsl() or a CSS name. The
// swatch opens the system picker; the text takes anything valid; × goes back to
// the default. Changes go out as you pick (`live`) and when done.
import { computed, ref, watch } from 'vue';
import { COLOR_TOKENS, isColor } from '../../work/ui.ts';

const props = defineProps<{ value?: string; placeholder?: string; clearable?: boolean }>();
const emit = defineEmits<{ (e: 'update', value: string | null, done: boolean): void }>();
const text = ref(props.value ?? '');
watch(
  () => props.value,
  v => {
    text.value = v ?? '';
  },
);
const valid = computed(() => !text.value || isColor(text.value));
/** The system picker needs #rrggbb: tokens and other forms show their resolved colour where possible. */
const hex = computed(() => {
  const v = props.value ?? '';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${Array.from(v.slice(1), c => c + c).join('')}`;
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7);
  return '#888888';
});
function commitText() {
  if (!text.value) emit('update', null, true);
  else if (isColor(text.value)) emit('update', text.value, true);
}
</script>

<template>
  <span class="color-field">
    <input
      class="swatch"
      type="color"
      :value="hex"
      :title="value ?? placeholder ?? ''"
      @input="emit('update', ($event.target as HTMLInputElement).value, false)"
      @change="emit('update', ($event.target as HTMLInputElement).value, true)"
    />
    <input
      v-model="text"
      class="text"
      :class="{ bad: !valid }"
      type="text"
      :placeholder="placeholder"
      :list="'dk-color-tokens'"
      spellcheck="false"
      :data-committed="value ?? ''"
      @change="commitText"
      @keydown.enter="commitText"
    />
    <button
      v-if="clearable !== false && value"
      type="button"
      class="clear"
      title="Back to the default"
      @click="emit('update', null, true)"
    >
      ×
    </button>
    <datalist id="dk-color-tokens">
      <option v-for="t in COLOR_TOKENS" :key="t" :value="t" />
    </datalist>
  </span>
</template>

<style scoped>
.color-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.swatch {
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: none;
  flex: none;
  cursor: pointer;
}
.text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
.text.bad {
  border-color: var(--error);
}
.clear {
  padding: 0 6px;
  font-size: 13px;
}
</style>

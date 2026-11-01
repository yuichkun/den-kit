<script setup lang="ts">
// A number that commits on Enter or when leaving the field; ↑/↓ step (Shift ×10) and commit at once.
import { ref, watch } from 'vue';

const props = defineProps<{
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  unit?: string;
}>();
const emit = defineEmits<{ (e: 'update', value: number | null): void }>();
const shown = (v: number | undefined) =>
  v === undefined ? '' : String(Math.round(v * 1000) / 1000);
const text = ref(shown(props.value));
watch(
  () => props.value,
  v => {
    text.value = shown(v);
  },
);
const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
function commit() {
  if (text.value.trim() === '') {
    emit('update', null);
    return;
  }
  const v = Number(text.value);
  if (Number.isFinite(v)) emit('update', clamp(v));
}
function key(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
  const v = clamp(Math.round(((Number(text.value) || 0) + step) * 1000) / 1000);
  text.value = String(v);
  emit('update', v);
}
</script>

<template>
  <span class="number-field"
    ><input
      v-model="text"
      type="text"
      inputmode="decimal"
      :placeholder="placeholder"
      spellcheck="false"
      :data-committed="shown(value)"
      @change="commit"
      @keydown.enter="commit"
      @keydown="key"
    /><span v-if="unit" class="unit">{{ unit }}</span></span
  >
</template>

<style scoped>
.number-field {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
input {
  width: 100%;
  min-width: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.unit {
  color: var(--text-muted);
  font-size: 12px;
}
</style>

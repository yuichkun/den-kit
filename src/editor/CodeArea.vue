<script setup lang="ts">
// A text area for code, in colour: the coloured text is drawn underneath and the
// textarea on top (its own text transparent) keeps the caret, the selection, the
// keys and every edit as before. Colours only: no language server.
import { computed, ref } from 'vue';
import { highlight, type CodeLanguage } from './highlight.ts';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; language: CodeLanguage; readonly?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
const area = ref<HTMLTextAreaElement | null>(null);
const paint = ref<HTMLElement | null>(null);
// (A last line break needs something after it to take its height.)
const html = computed(() => `${highlight(props.modelValue, props.language)}\n`);
function follow() {
  if (!paint.value || !area.value) return;
  paint.value.scrollTop = area.value.scrollTop;
  paint.value.scrollLeft = area.value.scrollLeft;
}
defineExpose({ focus: () => area.value?.focus(), textarea: area });
</script>

<template>
  <div
    class="code-area"
    :class="$attrs.class as string | undefined"
    :style="$attrs.style as string | undefined"
  >
    <pre ref="paint" class="paint" aria-hidden="true"><code v-html="html" /></pre>
    <textarea
      ref="area"
      v-bind="{ ...$attrs, class: undefined, style: undefined }"
      :value="modelValue"
      :readonly="readonly"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @scroll="follow"
    />
  </div>
</template>

<style scoped>
/* The look is set with variables: --code-font, --code-bg, --code-fg, --code-pad, --code-caret, --code-resize. */
.code-area {
  position: relative;
  min-height: 0;
  min-width: 0;
  font: var(--code-font, 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace);
  tab-size: 2;
  background: var(--code-bg, var(--slate-0));
  color: var(--code-fg, var(--gray-16));
}
.paint,
textarea {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  padding: var(--code-pad, 10px);
  font: inherit;
  letter-spacing: normal;
  tab-size: inherit;
  white-space: pre;
  overflow-wrap: normal;
  text-align: left;
}
.paint {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: inherit;
  background: transparent;
}
/* Room past the end, so the colours can scroll as far as the text above them. */
.paint code {
  display: block;
  width: max-content;
  min-width: 100%;
  padding: 0 48px 48px 0;
  font: inherit;
}
textarea {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  resize: var(--code-resize, none);
  outline: none;
  border-radius: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--code-caret, var(--gray-18));
  overflow: auto;
}
textarea::selection {
  background: color-mix(in srgb, var(--blue-deep) 35%, transparent);
  color: transparent;
}
textarea::placeholder {
  color: var(--gray-10);
}
</style>

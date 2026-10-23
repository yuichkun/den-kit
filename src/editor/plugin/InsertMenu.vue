<script setup lang="ts">
// "Add to the plugin": type to filter, arrows and Enter to pick, Esc to close.
// Pictures list the patch's assets.
import { computed, nextTick, onMounted, ref } from 'vue';
import { INSERTABLES } from '../../screen/inserts.ts';
import { isImageAsset, assetsOf } from '../../work/ui.ts';
import { useSession } from '../context.ts';

const emit = defineEmits<{ (e: 'pick', key: string, asset?: string): void; (e: 'close'): void }>();
const session = useSession();
const query = ref('');
const current = ref(0);
const input = ref<HTMLInputElement | null>(null);
const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  const pictures = Object.values(assetsOf(session.doc.value.files))
    .filter(isImageAsset)
    .map(a => ({ key: 'picture', asset: a.id, title: a.name, doc: 'Picture', group: 'Picture' }));
  const all = [
    ...INSERTABLES.filter(i => i.key !== 'picture').map(i => ({
      ...i,
      asset: undefined as string | undefined,
    })),
    ...pictures,
  ];
  return q
    ? all.filter(r =>
        `${r.title} ${r.doc} ${r.key} ${'also' in r ? (r.also ?? '') : ''}`
          .toLowerCase()
          .includes(q),
      )
    : all;
});
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    current.value = Math.min(rows.value.length - 1, current.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    current.value = Math.max(0, current.value - 1);
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const r = rows.value[current.value];
    if (r) emit('pick', r.key, r.asset);
  }
}
onMounted(() => {
  void nextTick(() => input.value?.focus());
});
</script>

<template>
  <div class="insert-menu" data-testid="insert-menu" @keydown="key" @pointerdown.stop>
    <input
      ref="input"
      v-model="query"
      type="text"
      placeholder="Add to the plugin…"
      spellcheck="false"
      data-testid="insert-search"
      @input="current = 0"
    />
    <div class="list">
      <button
        v-for="(r, i) in rows"
        :key="`${r.key}-${r.asset ?? ''}`"
        type="button"
        class="item"
        :class="{ current: i === current }"
        :data-insert="r.key"
        @mouseenter="current = i"
        @click="emit('pick', r.key, r.asset)"
      >
        <span class="title">{{ r.title }}</span
        ><span class="doc">{{ r.doc }}</span
        ><span class="group">{{ r.group }}</span>
      </button>
      <div v-if="!rows.length" class="muted empty">Nothing matches.</div>
    </div>
  </div>
</template>

<style scoped>
.insert-menu {
  position: absolute;
  z-index: 30;
  width: 360px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: #232323;
  border: 1px solid var(--accent);
  border-radius: 8px;
  box-shadow: 0 16px 40px #000c;
  overflow: hidden;
}
input {
  margin: 8px;
  font-size: 15px;
  padding: 6px 8px;
}
.list {
  overflow: auto;
  padding: 0 6px 6px;
}
.item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  text-align: left;
  background: transparent;
  box-shadow: none;
  padding: 6px 8px;
  border-radius: 5px;
}
.item.current {
  background: #3a2a14;
}
.title {
  color: #f0f0f0;
  font-size: 14px;
}
.doc {
  color: var(--muted);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group {
  color: #777;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.empty {
  padding: 8px;
}
</style>

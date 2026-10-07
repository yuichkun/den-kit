<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { NodeDef } from '../core/catalog.ts';
import { partUses } from '../core/parts.ts';
import { useSession } from './context.ts';

const emit = defineEmits<{ (e: 'pick', type: string): void; (e: 'close'): void }>();
const session = useSession();
const query = ref('');
const input = ref<HTMLInputElement | null>(null);
const active = ref(0);
const order = ['part', 'voice', 'source', 'filter', 'envelope', 'modulation', 'fx', 'dynamics', 'math', 'ui', 'code', 'io'];
type Entry = Pick<NodeDef, 'type' | 'title' | 'summary' | 'category' | 'keywords'>;
/** The parts of this patch can be used again anywhere they fit (never inside themselves). */
const parts = computed<Entry[]>(() => {
  const doc = session.doc.value, scope = session.scope.value;
  return Object.values(doc.parts).filter(p => !scope || !partUses(doc, p.id, scope)).map(p => ({ type: `part:${p.id}`, title: p.name, category: 'part', summary: p.doc ?? 'A part of this patch (use it again).', keywords: ['part', p.id] }));
});
const matches = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  const inside = !!session.scope.value;
  // Inside a part: no controls or singletons (they stay in the main patch), and its inputs and outputs can be added.
  const blocks = session.catalog.list().filter(d => d.palette !== 'never' && (d.palette !== 'inside' || inside) && !(inside && (d.kind === 'widget' || d.singleton)) && !(d.singleton && Object.values(session.doc.value.nodes).some(n => n.type === d.type)));
  const all: Entry[] = [...parts.value, ...blocks];
  const scored = all.map(d => {
    const hay = [d.title, d.type, d.summary, ...(d.keywords ?? [])].join(' ').toLowerCase();
    const score = !q ? 1 : d.title.toLowerCase().startsWith(q) ? 3 : (d.keywords ?? []).some(k => k.startsWith(q)) ? 2 : hay.includes(q) ? 1 : 0;
    return { d, score };
  }).filter(x => x.score > 0);
  return scored.sort((a, b) => b.score - a.score || order.indexOf(a.d.category) - order.indexOf(b.d.category) || a.d.title.localeCompare(b.d.title)).map(x => x.d);
});
onMounted(() => nextTick(() => input.value?.focus()));
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { active.value = Math.min(matches.value.length - 1, active.value + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active.value = Math.max(0, active.value - 1); e.preventDefault(); }
  else if (e.key === 'Enter' && matches.value[active.value]) emit('pick', matches.value[active.value]!.type);
  else if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div class="palette" @pointerdown.stop>
    <input ref="input" v-model="query" type="text" placeholder="Add a block… (osc, filter, delay, knob)" data-testid="palette-search" @input="active = 0" @keydown="key" />
    <ul>
      <li v-for="(d, i) in matches" :key="d.type" :class="{ active: i === active }" :data-type="d.type" @mouseenter="active = i" @click="emit('pick', d.type)">
        <b>{{ d.title }}</b> <span class="cat">{{ d.category }}</span>
        <div class="muted">{{ d.summary }}</div>
      </li>
      <li v-if="!matches.length" class="muted">No block matches “{{ query }}”.</li>
    </ul>
  </div>
</template>

<style scoped>
.palette { position: absolute; z-index: 20; width: 320px; max-height: 420px; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--accent); border-radius: 8px; box-shadow: 0 8px 30px #000a; }
input { margin: 8px; }
ul { list-style: none; margin: 0; padding: 0 0 6px; overflow: auto; }
li { padding: 5px 10px; cursor: pointer; font-size: 12px; }
li.active { background: #5ec4ff22; }
.cat { font-size: 10px; color: var(--muted); text-transform: uppercase; margin-left: 4px; }
</style>

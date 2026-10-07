<script setup lang="ts">
// Docked module palette (Grid style): category columns on the left, module
// tiles on the right. Click a tile to add it at the view centre or drag it onto
// the canvas; the search field filters across all categories.
import { computed, ref } from 'vue';
import type { NodeDef } from '../core/catalog.ts';
import { useSession } from './context.ts';
import { titleColor, portColor } from './grid-style.ts';

const emit = defineEmits<{ (e: 'add', type: string): void }>();
const session = useSession();
const CATEGORIES = [['voice', 'Voice'], ['source', 'Oscillator'], ['filter', 'Filter'], ['envelope', 'Envelope'], ['modulation', 'LFO / Mod'], ['fx', 'FX'], ['dynamics', 'Dynamics'], ['math', 'Math'], ['io', 'I/O'], ['ui', 'Plugin UI'], ['code', 'Code']] as const;
const category = ref<string>('source');
const query = ref('');
const taken = computed(() => new Set(Object.values(session.doc.value.nodes).map(n => n.type)));
const list = computed<NodeDef[]>(() => {
  const q = query.value.trim().toLowerCase();
  const all = session.catalog.list();
  if (!q) return all.filter(d => d.category === category.value);
  return all.filter(d => [d.title, d.type, d.summary, ...(d.keywords ?? [])].join(' ').toLowerCase().includes(q));
});
function drag(e: DragEvent, type: string) { e.dataTransfer?.setData('application/x-den-kit', type); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }
const ins = (d: NodeDef) => (typeof d.inputs === 'function' ? [] : d.inputs).filter(p => p.role === 'audio' || p.type === 'gate').slice(0, 2);
const outs = (d: NodeDef) => (typeof d.outputs === 'function' ? [] : d.outputs).slice(0, 2);
</script>

<template>
  <div class="grid-palette" data-testid="grid-palette">
    <div class="cats">
      <input v-model="query" type="text" placeholder="Search modules" class="search" data-testid="palette-filter" />
      <div class="catgrid">
        <button v-for="[id, name] in CATEGORIES" :key="id" :class="{ on: !query && category === id }" @click="category = id; query = ''">{{ name }}</button>
      </div>
    </div>
    <div class="tiles">
      <div v-for="d in list" :key="d.type" class="tile" :class="{ disabled: d.singleton && taken.has(d.type) }" draggable="true" :data-type="d.type" :title="d.summary" @dragstart="drag($event, d.type)" @click="!(d.singleton && taken.has(d.type)) && emit('add', d.type)">
        <div class="mini">
          <span class="pins l"><i v-for="p in ins(d)" :key="p.id" class="ring" :style="{ borderColor: portColor(d, p, 'in') }" /></span>
          <span class="name" :style="{ color: titleColor(d) }">{{ d.title }}</span>
          <span class="pins r"><i v-for="p in outs(d)" :key="p.id" class="dot" :style="{ background: portColor(d, p, 'out') }" /></span>
        </div>
        <div class="cap">{{ d.title }}</div>
      </div>
      <div v-if="!list.length" class="empty">No module matches “{{ query }}”.</div>
    </div>
  </div>
</template>

<style scoped>
.grid-palette { display: flex; height: 112px; border-bottom: 1px solid #000; background: #1d1d1d; font-family: Lato, system-ui, sans-serif; }
.cats { width: 330px; flex: none; padding: 6px 8px; border-right: 1px solid #111; display: flex; flex-direction: column; gap: 4px; }
.search { background: #121212; border: 1px solid #333; border-radius: 4px; color: #ddd; padding: 2px 8px; font-size: 12px; }
.catgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 4px; }
.catgrid button { background: transparent; border: 0; border-bottom: 2px solid transparent; color: #b8b8b8; font-size: 12px; padding: 3px 2px; border-radius: 0; cursor: pointer; }
.catgrid button.on { color: #fff; border-bottom-color: #3cc6ff; }
.tiles { flex: 1; display: flex; gap: 10px; padding: 10px 12px; overflow-x: auto; align-items: flex-start; }
.tile { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: grab; }
.tile.disabled { opacity: .35; cursor: not-allowed; }
.mini { width: 92px; height: 54px; background: #2c2c2c; border-radius: 5px; display: flex; align-items: center; justify-content: space-between; padding: 0 5px; box-shadow: 0 1px 4px #0008; }
.tile:hover .mini { box-shadow: 0 0 0 1px #888; }
.name { font-size: 10px; text-align: center; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pins { display: flex; flex-direction: column; gap: 4px; width: 8px; }
.ring { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid; box-sizing: border-box; display: block; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: block; }
.cap { font-size: 12px; color: #cfcfcf; white-space: nowrap; }
.empty { color: #888; padding: 20px; }
</style>

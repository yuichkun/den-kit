<script setup lang="ts">
// Docked module palette (Grid style): category columns on the left, module
// tiles on the right. Click a tile to add it at the view centre or drag it onto
// the canvas; the search field filters across all categories.
import { computed, ref } from 'vue';
import type { NodeDef } from '../core/catalog.ts';
import { partUses } from '../core/parts.ts';
import { latest } from '../core/library.ts';
import { useSession } from './context.ts';
import { titleColor, portColor } from './grid-style.ts';

const emit = defineEmits<{ (e: 'add', type: string): void }>();
const session = useSession();
const CATEGORIES = [
  ['voice', 'Voice'],
  ['source', 'Oscillator'],
  ['filter', 'Filter'],
  ['envelope', 'Envelope'],
  ['modulation', 'LFO / Mod'],
  ['fx', 'FX'],
  ['dynamics', 'Dynamics'],
  ['math', 'Math'],
  ['io', 'I/O'],
  ['ui', 'Plugin UI'],
  ['code', 'Code'],
  ['part', 'Parts'],
  ['mine', 'My parts'],
] as const;
const category = ref<string>('source');
const query = ref('');
const taken = computed(() => new Set(Object.values(session.doc.value.nodes).map(n => n.type)));
type Tile = Pick<
  NodeDef,
  'type' | 'title' | 'summary' | 'category' | 'keywords' | 'inputs' | 'outputs' | 'singleton'
>;
/** This patch's parts (never offered inside themselves), then, inside a part, its inputs and outputs. */
const parts = computed<Tile[]>(() => {
  const doc = session.doc.value,
    scope = session.scope.value;
  return Object.values(doc.parts)
    .filter(p => !scope || !partUses(doc, p.id, scope))
    .map(p => ({
      type: `part:${p.id}`,
      title: p.name,
      summary: p.doc ?? 'A part of this patch: click or drag to use it again.',
      category: 'part',
      keywords: ['part'],
      inputs: [],
      outputs: [],
    }));
});
/** My parts: saved parts every patch can place. */
const mine = computed<Tile[]>(() =>
  Object.values(session.myParts.value.parts)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({
      type: `mine:${p.id}`,
      title: p.name,
      summary: `${p.doc ? `${p.doc} — ` : ''}My parts, v${latest(p).version}: click or drag to place it.`,
      category: 'mine',
      keywords: ['my part', 'mine', 'saved', p.id],
      inputs: [],
      outputs: [],
    })),
);
const list = computed<Tile[]>(() => {
  const q = query.value.trim().toLowerCase();
  const inside = !!session.scope.value;
  const all: Tile[] = [
    ...parts.value,
    ...mine.value,
    ...session.catalog
      .list()
      .filter(
        d =>
          d.palette !== 'never' &&
          (d.palette !== 'inside' || inside) &&
          !(inside && (d.kind === 'widget' || d.singleton)),
      ),
  ];
  if (!q) return all.filter(d => d.category === category.value);
  return all.filter(d =>
    [d.title, d.type, d.summary, ...(d.keywords ?? [])].join(' ').toLowerCase().includes(q),
  );
});
function drag(e: DragEvent, type: string) {
  e.dataTransfer?.setData('application/x-den-kit', type);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
}
const ins = (d: Tile) =>
  (typeof d.inputs === 'function' ? [] : d.inputs)
    .filter(p => p.role === 'audio' || p.type === 'gate')
    .slice(0, 2);
const outs = (d: Tile) => (typeof d.outputs === 'function' ? [] : d.outputs).slice(0, 2);
const tileColor = (d: Tile) =>
  d.type.startsWith('mine:')
    ? '#ffd27a'
    : d.type.startsWith('part:')
      ? '#9ad7ff'
      : titleColor(d as NodeDef);
const tileName = (d: Tile) =>
  d.type.startsWith('mine:')
    ? `★ ${d.title}`
    : d.type.startsWith('part:')
      ? `◇ ${d.title}`
      : d.title;
// ---- My parts: files and removing ----
const file = ref<HTMLInputElement | null>(null);
async function exportMine() {
  const blob = new Blob([await session.exportMyParts()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-parts.denkit-parts.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importMine(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const r = session.importMyParts(await f.text());
  session.toast(r.ok ? 'info' : 'warn', r.message);
  for (const i of r.report.slice(0, 3)) session.toast('warn', i.message);
}
function removeMine(id: string) {
  const entry = session.myParts.value.parts[id];
  if (
    entry &&
    confirm(`Remove “${entry.name}” from My parts? Patches that use it keep their copy.`)
  )
    session.removeFromMyParts(id);
}
</script>

<template>
  <div class="grid-palette" data-testid="grid-palette">
    <div class="cats">
      <input
        v-model="query"
        type="text"
        placeholder="Search modules"
        class="search"
        data-testid="palette-filter"
      />
      <div class="catgrid">
        <button
          v-for="[id, name] in CATEGORIES"
          :key="id"
          :class="{ on: !query && category === id }"
          @click="
            category = id;
            query = '';
          "
        >
          {{ name }}
        </button>
      </div>
    </div>
    <div class="tiles">
      <div v-if="!query && category === 'mine'" class="minebar">
        <button
          class="small"
          data-testid="my-parts-import"
          title="Add My parts from a file"
          @click="file?.click()"
        >
          Import…
        </button>
        <button
          class="small"
          data-testid="my-parts-export"
          :disabled="!mine.length"
          title="Save all My parts to a file"
          @click="exportMine"
        >
          Export…
        </button>
        <input
          ref="file"
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="my-parts-file"
          @change="importMine"
        />
      </div>
      <div
        v-for="d in list"
        :key="d.type"
        class="tile"
        :class="{ disabled: d.singleton && taken.has(d.type) }"
        draggable="true"
        :data-type="d.type"
        :title="d.summary"
        @dragstart="drag($event, d.type)"
        @click="!(d.singleton && taken.has(d.type)) && emit('add', d.type)"
      >
        <div class="mini">
          <span class="pins l"
            ><i
              v-for="p in ins(d)"
              :key="p.id"
              class="ring"
              :style="{ borderColor: portColor(d as NodeDef, p, 'in') }"
          /></span>
          <span class="name" :style="{ color: tileColor(d) }">{{ tileName(d) }}</span>
          <span class="pins r"
            ><i
              v-for="p in outs(d)"
              :key="p.id"
              class="dot"
              :style="{ background: portColor(d as NodeDef, p, 'out') }"
          /></span>
          <button
            v-if="d.type.startsWith('mine:')"
            class="drop"
            title="Remove from My parts"
            :data-remove="d.type.slice(5)"
            @click.stop="removeMine(d.type.slice(5))"
          >
            ×
          </button>
        </div>
        <div class="cap">{{ d.title }}</div>
      </div>
      <div v-if="!list.length" class="empty">
        {{
          !query && category === 'part'
            ? 'No parts yet: select modules and press ⌘G.'
            : !query && category === 'mine'
              ? 'No My parts yet: select a part and press “Save to My parts” in the inspector.'
              : `No module matches “${query}”.`
        }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-palette {
  display: flex;
  height: 112px;
  border-bottom: 1px solid #000;
  background: #1d1d1d;
  font-family: Lato, system-ui, sans-serif;
}
.cats {
  width: 330px;
  flex: none;
  padding: 6px 8px;
  border-right: 1px solid #111;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search {
  background: #121212;
  border: 1px solid #333;
  border-radius: 4px;
  color: #ddd;
  padding: 2px 8px;
  font-size: 12px;
}
.catgrid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0 3px;
}
.catgrid button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #b8b8b8;
  font-size: 11.5px;
  padding: 3px 1px;
  border-radius: 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.catgrid button.on {
  color: #fff;
  border-bottom-color: #3cc6ff;
}
.tiles {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  overflow-x: auto;
  align-items: flex-start;
}
.tile {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: grab;
}
.tile.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.mini {
  width: 92px;
  height: 54px;
  background: #2c2c2c;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5px;
  box-shadow: 0 1px 4px #0008;
}
.tile:hover .mini {
  box-shadow: 0 0 0 1px #888;
}
.name {
  font-size: 10px;
  text-align: center;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pins {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 8px;
}
.ring {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid;
  box-sizing: border-box;
  display: block;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: block;
}
.cap {
  font-size: 12px;
  color: #cfcfcf;
  white-space: nowrap;
}
.empty {
  color: #888;
  padding: 20px;
}
.mini {
  position: relative;
}
.drop {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  border: 0;
  background: #444;
  color: #ddd;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  display: none;
}
.tile:hover .drop {
  display: block;
}
.minebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
}
.small {
  padding: 2px 8px;
  font-size: 11px;
}
</style>

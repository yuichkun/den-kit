<script setup lang="ts">
// Docked module palette (Grid style): category columns on the left, module
// tiles on the right. Click a tile to add it at the view centre or drag it onto
// the canvas; the search field filters across all categories.
import { computed, ref } from 'vue';
import type { NodeDef } from '../work/catalog.ts';
import { partUses } from '../work/parts.ts';
import { latest } from '../work/library.ts';
import { useSession } from './context.ts';
import { typeGroup } from './grid-style.ts';

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
/** A tile looks like a small module of its type; parts and My parts carry no type color. */
const tileGroup = (d: Tile) =>
  d.type.startsWith('mine:') || d.type.startsWith('part:') ? 'neutral' : typeGroup(d as NodeDef);
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
          class="as-written"
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
        <div class="mini" :class="`cat-${tileGroup(d)}`">
          <span class="pins l"><i v-for="p in ins(d)" :key="p.id" class="ring" /></span>
          <span class="name">{{ tileName(d) }}</span>
          <span class="pins r"><i v-for="p in outs(d)" :key="p.id" class="dot" /></span>
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
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  font-family: var(--font-ui);
}
.cats {
  width: 330px;
  flex: none;
  padding: 6px 8px;
  border-right: 1px solid var(--line-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search {
  background: var(--field-fill);
  border: var(--field-line);
  border-radius: var(--radius-control);
  clip-path: var(--clip-control);
  color: var(--text-primary);
  padding: 2px 8px;
  font-size: 12px;
}
.catgrid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0 3px;
}
/* Type names in the sans, so they fit their cells in every theme. */
.catgrid button {
  font-family: var(--font-ui);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  clip-path: none;
  color: var(--text-muted);
  font-size: 11.5px;
  padding: 3px 1px;
  border-radius: 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.catgrid button:hover:not(:disabled) {
  background: transparent;
  color: var(--text-primary);
}
.catgrid button.on {
  color: var(--text-primary);
  border-bottom-color: var(--ink);
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
  --mod-fill: color-mix(in srgb, var(--c) var(--module-fill-type), var(--module-body));
  --mod-ink: color-mix(in srgb, var(--ink-c) var(--module-fill-type), var(--module-value));
  width: 92px;
  height: 54px;
  background: var(--mod-fill);
  border-radius: var(--radius-module);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5px;
  box-shadow:
    var(--module-ring),
    inset 0 0 0 1px var(--module-edge);
}
.tile:hover .mini {
  box-shadow:
    var(--module-selected),
    inset 0 0 0 1px var(--module-edge);
}
.name {
  color: color-mix(in srgb, var(--c) var(--title-type), var(--mod-ink));
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
  border-radius: var(--port-radius);
  border: 1.5px solid var(--port-in-ring);
  background: var(--port-in-fill);
  box-sizing: border-box;
  display: block;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: var(--port-radius);
  border: 1.5px solid var(--port-out-ring);
  background: var(--port-out-fill);
  box-sizing: border-box;
  display: block;
}
.cap {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
}
.empty {
  color: var(--text-muted);
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
  background: var(--app-field);
  color: var(--text-primary);
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

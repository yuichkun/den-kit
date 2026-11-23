<script setup lang="ts">
// Tab C, the order sheet: the recipient's own list of files. Rows are the places the
// author named (and kept settings the recipient adds), columns the conditions (gaits);
// each cell asks for a number of files, and the tool fills them with variations, each
// from a seed, inside the author's spread. A file can be made again (another seed) or
// locked; a cell can be walked, its files in turn at the gait's pace; the list leaves
// as WAV files named by the recipient's pattern, with a list of what made each file.
import { computed, inject, ref } from 'vue';
import { writeZip, type ZipEntry } from '../../src/work/zip.ts';
import { play, render, stopPlaying } from './audio.ts';
import { DELIVERY, fileJob, playsNotes } from './context.ts';
import { MAX_COUNT, type Cell, type Row } from './record.ts';
import { fileName, seedOf, slug, type Condition } from './spec.ts';
import { download, samplesOf, wav } from './wav.ts';
import Wave from './Wave.vue';

const ctx = inject(DELIVERY)!;
const build = ctx.active;
const spec = ctx.spec;
const sheet = ctx.state.sheet;
const options = spec.condition.options;
const progress = ref('');
const picked = ref('');

interface SheetRow extends Row {
  custom: boolean;
}
const rows = computed<SheetRow[]>(() => [
  ...spec.points.map(p => ({
    id: `point:${p.name}`,
    name: p.name,
    setting: p.values,
    custom: false,
  })),
  ...sheet.rows.map(r => ({ ...r, custom: true })),
]);

const key = (row: Row, o: Condition) => `${row.id}|${o.name}`;
const EMPTY: Cell = { count: 0, seeds: [], locked: [] };
const cell = (row: Row, o: Condition) => sheet.cells[key(row, o)] ?? EMPTY;

function setCount(row: Row, o: Condition, count: number) {
  if (ctx.readonly) return;
  const c = { ...cell(row, o) };
  c.count = Math.min(MAX_COUNT, Math.max(0, count));
  c.seeds = [...c.seeds];
  c.locked = [...c.locked];
  for (let i = c.seeds.length; i < c.count; i++) {
    c.seeds.push(seedOf(`${key(row, o)}|${i}`));
    c.locked.push(false);
  }
  sheet.cells[key(row, o)] = c;
}

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
function reroll(row: Row, o: Condition, i: number) {
  const c = cell(row, o);
  if (ctx.readonly || c.locked[i]) return;
  const seeds = [...c.seeds];
  seeds[i] = newSeed();
  sheet.cells[key(row, o)] = { ...c, seeds };
}
function rerollCell(row: Row, o: Condition) {
  const c = cell(row, o);
  if (ctx.readonly) return;
  sheet.cells[key(row, o)] = {
    ...c,
    seeds: c.seeds.map((s, i) => (i < c.count && !c.locked[i] ? newSeed() : s)),
  };
}
function lock(row: Row, o: Condition, i: number) {
  const c = cell(row, o);
  if (ctx.readonly) return;
  const locked = [...c.locked];
  locked[i] = !locked[i];
  sheet.cells[key(row, o)] = { ...c, locked };
}

const job = (row: Row, o: Condition, i: number) =>
  fileJob(spec, build.value!, row.setting, o, i, cell(row, o).seeds[i]!);
const name = (row: Row, o: Condition, i: number) =>
  fileName(sheet.naming, {
    point: row.name,
    condition: o.name,
    nn: i + 1,
    version: ctx.state.version,
  });

/** Every file the sheet asks for, in order. */
const files = computed(() =>
  rows.value.flatMap(row =>
    options.flatMap(o =>
      Array.from({ length: cell(row, o).count }, (_, i) => ({ row, o, i, name: name(row, o, i) })),
    ),
  ),
);
const repeated = computed(() => {
  const seen = new Set<string>();
  return files.value.filter(f => (seen.has(f.name) ? true : (seen.add(f.name), false))).length;
});

const notes = playsNotes(spec);
/**
 * The cell's files in turn: steps walk eight times at the gait's pace, never the same
 * file twice in a row; a sound without notes plays each file once, end to end.
 */
async function walk(row: Row, o: Condition) {
  const c = cell(row, o);
  if (!c.count) return;
  const buffers = await Promise.all(
    Array.from({ length: c.count }, (_, i) => render(job(row, o, i))),
  );
  if (!notes) return play(buffers, spec.length);
  void play(
    Array.from({ length: 8 }, (_, step) => buffers[step % buffers.length]!),
    o.every,
  );
}

async function exportFiles() {
  const b = build.value;
  if (!b || !files.value.length || repeated.value) return;
  const entries: ZipEntry[] = [];
  const lines = [`file,row,${slug(spec.condition.name)},variation,seed,version,fingerprint`];
  for (const [n, f] of files.value.entries()) {
    progress.value = `Making ${n + 1} of ${files.value.length}…`;
    const buffer = await render(job(f.row, f.o, f.i));
    entries.push({ path: f.name, data: wav(samplesOf(buffer), sheet.channels) });
    const quoted = `"${f.row.name.replaceAll('"', '""')}"`;
    lines.push(
      [
        f.name,
        quoted,
        f.o.name,
        f.i + 1,
        cell(f.row, f.o).seeds[f.i],
        ctx.state.version,
        b.fingerprint,
      ].join(','),
    );
  }
  const encoder = new TextEncoder();
  entries.push({ path: 'files.csv', data: encoder.encode(`${lines.join('\n')}\n`) });
  entries.push({
    path: 'order-sheet.json',
    data: encoder.encode(
      JSON.stringify(
        {
          work: ctx.work,
          version: ctx.state.version,
          fingerprint: b.fingerprint,
          sheet,
        },
        null,
        2,
      ),
    ),
  });
  download(
    writeZip(entries),
    `${slug(spec.title)}_${slug(ctx.state.version)}.zip`,
    'application/zip',
  );
  progress.value = `${files.value.length} files exported.`;
}

function addRow() {
  const k = ctx.state.kept.find(x => x.id === picked.value);
  if (!k || ctx.readonly) return;
  const id = `kept:${k.id}`;
  if (!sheet.rows.some(r => r.id === id))
    sheet.rows.push({ id, name: k.name, setting: { ...k.setting } });
  picked.value = '';
}
function removeRow(row: Row) {
  if (ctx.readonly) return;
  sheet.rows.splice(
    sheet.rows.findIndex(r => r.id === row.id),
    1,
  );
  for (const o of options) delete sheet.cells[key(row, o)];
}
</script>

<template>
  <div class="sheet-tab" data-testid="sheet-tab">
    <div class="head">
      <label class="naming">
        <span>File names</span>
        <input
          v-model="sheet.naming"
          type="text"
          class="as-written"
          spellcheck="false"
          :disabled="ctx.readonly"
          data-testid="sheet-naming"
        />
      </label>
      <span v-if="files.length" class="format as-written" data-testid="sheet-first-name">
        {{ files[0]!.name }}
      </span>
      <label>
        <span>Channels</span>
        <select v-model.number="sheet.channels" :disabled="ctx.readonly">
          <option :value="1">Mono</option>
          <option :value="2">Stereo</option>
        </select>
      </label>
      <span class="format">WAV, 48 kHz, 16-bit, {{ spec.length }} s each</span>
      <button
        type="button"
        class="primary"
        :disabled="!files.length || !!repeated"
        data-testid="sheet-export"
        @click="exportFiles"
      >
        Export {{ files.length }} files
      </button>
    </div>
    <p class="note">
      <template v-if="repeated">
        {{ repeated }} file names repeat: put {point}, {condition} and {nn} in the pattern.
      </template>
      <template v-else-if="progress">{{ progress }}</template>
      <template v-else>
        Ask for files in each cell. Each file is a variation inside the author's spread; click it to
        listen, ↻ for another, the lock to keep it. {point}, {condition}, {nn} and {version} fill
        the names.
      </template>
    </p>
    <table class="grid">
      <thead>
        <tr>
          <th />
          <th v-for="o in options" :key="o.name" class="as-written">{{ o.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <th class="row-name">
            <span class="as-written">{{ row.name }}</span>
            <span v-if="row.custom" class="tag">added</span>
            <button
              v-if="row.custom && !ctx.readonly"
              type="button"
              class="small"
              :aria-label="`Remove ${row.name}`"
              @click="removeRow(row)"
            >
              ×
            </button>
          </th>
          <td v-for="o in options" :key="o.name" :data-testid="`cell-${row.id}|${o.name}`">
            <div class="count">
              <button
                type="button"
                class="small"
                :disabled="ctx.readonly || !cell(row, o).count"
                :aria-label="`Fewer ${row.name} ${o.name}`"
                @click="setCount(row, o, cell(row, o).count - 1)"
              >
                −
              </button>
              <span class="n">{{ cell(row, o).count }}</span>
              <button
                type="button"
                class="small"
                :disabled="ctx.readonly || cell(row, o).count >= MAX_COUNT"
                :aria-label="`More ${row.name} ${o.name}`"
                data-testid="cell-more"
                @click="setCount(row, o, cell(row, o).count + 1)"
              >
                +
              </button>
              <template v-if="cell(row, o).count">
                <button type="button" class="small" data-testid="cell-walk" @click="walk(row, o)">
                  {{ notes ? 'Walk' : 'In turn' }}
                </button>
                <button
                  v-if="!ctx.readonly"
                  type="button"
                  class="small"
                  title="Another variation for every file that is not locked"
                  @click="rerollCell(row, o)"
                >
                  ↻ all
                </button>
              </template>
            </div>
            <div class="files">
              <div v-for="i in cell(row, o).count" :key="i" class="file">
                <Wave :job="job(row, o, i - 1)" :label="name(row, o, i - 1)" />
                <div v-if="!ctx.readonly" class="tools">
                  <button
                    type="button"
                    class="small"
                    :disabled="cell(row, o).locked[i - 1]"
                    :aria-label="`Another variation for ${name(row, o, i - 1)}`"
                    @click="reroll(row, o, i - 1)"
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    class="small lock"
                    :aria-pressed="!!cell(row, o).locked[i - 1]"
                    :aria-label="`Lock ${name(row, o, i - 1)}`"
                    @click="lock(row, o, i - 1)"
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
                      <path
                        :d="
                          cell(row, o).locked[i - 1]
                            ? 'M4 5.5V4a2 2 0 0 1 4 0v1.5'
                            : 'M4 5.5V4a2 2 0 0 1 4 0'
                        "
                      />
                    </svg>
                  </button>
                </div>
                <span v-else-if="cell(row, o).locked[i - 1]" class="locked">locked</span>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!ctx.readonly" class="add">
      <select v-model="picked" :disabled="!ctx.state.kept.length" data-testid="sheet-add-pick">
        <option value="">
          {{
            ctx.state.kept.length
              ? 'Add a kept setting as a row…'
              : 'Keep a setting to add it as a row'
          }}
        </option>
        <option v-for="k in ctx.state.kept" :key="k.id" :value="k.id">{{ k.name }}</option>
      </select>
      <button type="button" :disabled="!picked" data-testid="sheet-add" @click="addRow">
        Add row
      </button>
      <button type="button" @click="stopPlaying">Stop</button>
    </div>
  </div>
</template>

<style scoped>
.sheet-tab {
  padding: 16px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.head label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}
.naming input {
  width: 300px;
  font-family: var(--font-mono);
  color: var(--text-primary);
}
.format {
  color: var(--text-muted);
  font-size: 12px;
  padding-bottom: 6px;
}
.head .primary {
  margin-left: auto;
}
.note {
  margin: 0;
  color: var(--text-muted);
}
.grid {
  border-collapse: collapse;
  width: 100%;
}
.grid th,
.grid td {
  border: 1px solid var(--line-subtle);
  padding: 8px;
  vertical-align: top;
  text-align: left;
}
.grid thead th {
  font-weight: 600;
}
.row-name {
  width: 140px;
  font-weight: 600;
}
.tag {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--accent-text);
}
.count {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.n {
  min-width: 18px;
  text-align: center;
  font-family: var(--font-mono);
}
.small {
  padding: 1px 7px;
  font-size: 12px;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.file {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tools {
  display: flex;
  gap: 2px;
}
.tools .small {
  padding: 0 5px;
  line-height: 16px;
}
.lock svg {
  width: 10px;
  height: 10px;
  display: block;
}
.lock rect,
.lock path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
}
.lock[aria-pressed='true'] {
  background: var(--ink);
  color: var(--text-on-ink);
  border-color: var(--ink);
}
.lock[aria-pressed='true'] rect {
  fill: currentColor;
}
.locked {
  font-size: 11px;
  color: var(--text-muted);
}
.add {
  display: flex;
  gap: 8px;
}
</style>

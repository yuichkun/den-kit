<script setup lang="ts">
// The versions the author sent: which one is in use (its id and the build's
// fingerprint), what changed in each, a switch to another, and a comparison of the
// same setting on each version, so moving to a new version is the recipient's choice.
import { computed, inject, ref } from 'vue';
import { play, render } from './audio.ts';
import { DELIVERY, stepJob } from './context.ts';
import type { Setting } from './sound.ts';

const ctx = inject(DELIVERY)!;
const open = ref(false);
const versions = ctx.spec.versions;
const index = computed(() => versions.findIndex(v => v.id === ctx.state.version));
const newest = computed(() => (index.value < versions.length - 1 ? versions.at(-1)! : null));
const fingerprint = computed(() => ctx.active.value?.fingerprint ?? '…');
const samples = computed<Array<{ name: string; setting: Setting }>>(() => [
  ...ctx.state.kept.map(k => ({ name: k.name, setting: k.setting })),
  ...ctx.spec.points.map(p => ({ name: p.name, setting: p.values })),
]);

async function use(id: string) {
  if (ctx.readonly) return;
  await ctx.build(id);
  ctx.state.version = id;
}
async function listen(setting: Setting, version: string) {
  const b = await ctx.build(version);
  void play([await render(stepJob(ctx.spec, b, setting))]);
}
</script>

<template>
  <div class="version">
    <button
      type="button"
      class="chip"
      :aria-expanded="open"
      data-testid="version-chip"
      @click="open = !open"
    >
      <span class="id">{{ ctx.state.version }}</span>
      <span class="fp">{{ fingerprint }}</span>
      <span v-if="newest && !ctx.readonly" class="new">{{ newest.id }} from the author</span>
    </button>
    <div v-if="open" class="panel" role="dialog" aria-label="Versions" data-testid="versions">
      <p class="lead">
        Kept settings and the order sheet name the version they were made with, and play with it. A
        new version changes nothing until you choose it.
      </p>
      <ul>
        <li v-for="v in versions" :key="v.id">
          <strong>{{ v.id }}</strong>
          <span class="as-written notes">{{ v.notes }}</span>
          <span v-if="v.id === ctx.state.version" class="in-use">in use</span>
          <button
            v-else-if="!ctx.readonly"
            type="button"
            :data-testid="`version-use-${v.id}`"
            @click="use(v.id)"
          >
            Use {{ v.id }}
          </button>
        </li>
      </ul>
      <h3>The same setting on each version</h3>
      <table>
        <tr v-for="s in samples" :key="s.name">
          <th class="as-written">{{ s.name }}</th>
          <td v-for="v in versions" :key="v.id">
            <button type="button" class="small" @click="listen(s.setting, v.id)">
              {{ v.id }}
            </button>
          </td>
        </tr>
      </table>
    </div>
  </div>
</template>

<style scoped>
.version {
  position: relative;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line-subtle);
}
.id {
  font-weight: 600;
}
.fp {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
}
.new {
  font-size: 12px;
  padding: 0 6px;
  border-radius: var(--radius-control);
  background: var(--accent);
  color: var(--text-on-accent);
}
.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 380px;
  max-height: 70vh;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: var(--radius-panel);
  background: var(--app-card);
  box-shadow: var(--shadow-menu);
  border: 1px solid var(--line-subtle);
  z-index: 5;
}
.lead {
  margin: 0;
  color: var(--text-muted);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
li {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 8px;
  align-items: baseline;
}
.notes {
  color: var(--text-muted);
}
.in-use {
  font-size: 12px;
  color: var(--state-ok);
}
h3 {
  margin: 4px 0 0;
  font-size: 13px;
}
table {
  border-collapse: collapse;
}
th {
  text-align: left;
  font-weight: 400;
  padding: 2px 8px 2px 0;
}
td {
  padding: 2px;
}
.small {
  padding: 1px 8px;
  font-size: 12px;
}
</style>

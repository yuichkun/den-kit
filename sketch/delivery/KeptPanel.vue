<script setup lang="ts">
// The kept settings, from every tab: each names the version it was made with and is
// played with that version's build, so it sounds the same on any later day. A kept
// setting can be listened to, saved as one WAV file, or added to the order sheet.
import { computed, inject } from 'vue';
import { play, render } from './audio.ts';
import { DELIVERY, stepJob } from './context.ts';
import type { Kept } from './record.ts';
import { fileName } from './spec.ts';
import { download, samplesOf, wav } from './wav.ts';

const ctx = inject(DELIVERY)!;
const kept = computed(() => ctx.state.kept);
const FROM = { screen: "author's screen", map: 'map', sheet: 'order sheet' } as const;

/** Is the kept setting's version still the build it was kept with? */
function changed(k: Kept) {
  const b = ctx.builds[k.version];
  return !!b && !!k.fingerprint && b.fingerprint !== k.fingerprint;
}

async function buffer(k: Kept) {
  const b = await ctx.build(k.version);
  return render(stepJob(ctx.spec, b, k.setting));
}
async function listen(k: Kept) {
  void play([await buffer(k)]);
}
async function save(k: Kept) {
  const name = fileName(`${ctx.spec.title}_{point}_{version}`, {
    point: k.name,
    condition: '',
    nn: 1,
    version: k.version,
  });
  download(wav(samplesOf(await buffer(k)), ctx.state.sheet.channels), name, 'audio/wav');
}
function toSheet(k: Kept) {
  const id = `kept:${k.id}`;
  if (!ctx.state.sheet.rows.some(r => r.id === id))
    ctx.state.sheet.rows.push({ id, name: k.name, setting: { ...k.setting } });
}
function remove(k: Kept) {
  ctx.state.kept.splice(ctx.state.kept.indexOf(k), 1);
}
</script>

<template>
  <aside class="kept-panel" data-testid="kept">
    <h2>{{ ctx.readonly ? 'What they kept' : 'Kept' }}</h2>
    <p v-if="!kept.length" class="empty">
      {{
        ctx.readonly
          ? 'Nothing was kept.'
          : 'Settings you keep from any tab come here, with the version they were made with.'
      }}
    </p>
    <ul>
      <li v-for="k in kept" :key="k.id" data-testid="kept-item">
        <input
          v-if="!ctx.readonly"
          v-model="k.name"
          type="text"
          class="as-written name"
          :aria-label="`Name of ${k.name}`"
        />
        <strong v-else class="as-written name">{{ k.name }}</strong>
        <span class="meta">
          {{ FROM[k.from] }} · {{ k.version }}
          <span v-if="k.version !== ctx.state.version" class="other">(not the version in use)</span>
        </span>
        <span v-if="changed(k)" class="warn">
          {{ k.version }} changed since this was kept: it may sound different.
        </span>
        <span class="tools">
          <button type="button" data-testid="kept-play" @click="listen(k)">Play</button>
          <button type="button" @click="save(k)">WAV</button>
          <button v-if="!ctx.readonly" type="button" @click="toSheet(k)">To the sheet</button>
          <button
            v-if="!ctx.readonly"
            type="button"
            class="remove"
            :aria-label="`Remove ${k.name}`"
            @click="remove(k)"
          >
            ×
          </button>
        </span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.kept-panel {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h2 {
  margin: 0;
  font-size: 15px;
  font-weight: var(--weight-title);
}
.empty {
  margin: 0;
  color: var(--text-muted);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: var(--radius-panel);
  background: var(--app-field);
}
.name {
  width: 100%;
  font-weight: 600;
}
input.name {
  background: transparent;
  padding: 2px 4px;
  margin-left: -4px;
}
.meta {
  font-size: 12px;
  color: var(--text-muted);
}
.warn {
  font-size: 12px;
  color: var(--state-warn);
}
.tools {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tools button {
  padding: 1px 8px;
  font-size: 12px;
}
.remove {
  margin-left: auto;
}
</style>

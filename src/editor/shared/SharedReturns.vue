<script setup lang="ts">
// The Shared prototype's "Sent back": the settings, notes and remixes people chose to send from
// the page, newest first. A setting can be heard in the author's own work: its values go in as
// one edit, which ⌘Z takes back.
import { computed } from 'vue';
import {
  YOU,
  valueText,
  type Level,
  type Returned,
  type Story,
  type StoryControl,
} from './after-sharing.ts';
import { useListen } from './listen.ts';

const props = defineProps<{
  story: Story;
  level: Level;
  controls: readonly StoryControl[];
  focus: readonly string[];
}>();
const { heard, listen } = useListen();
const KIND: Record<Returned['kind'], string> = { setting: 'Setting', note: 'Note', remix: 'Remix' };
const items = computed(() => [...props.story.returns].sort((a, b) => b.day - a.day));
const linkName = (id: string) => props.story.links.find(l => l.id === id)?.name ?? id;
const control = (id: string) => props.controls.find(c => c.id === id);
</script>

<template>
  <section class="returns" data-testid="shared-returns">
    <p v-if="level === 'returns'" class="intro">
      This is all den-kit knows at this level: what people chose to send back from the page.
    </p>
    <p v-if="!items.length" class="intro">Nothing was sent back.</p>
    <article
      v-for="r in items"
      :key="r.id"
      class="item"
      :class="{ focused: focus.includes(r.kind) }"
      :data-returned="r.id"
      :data-kind="r.kind"
    >
      <header>
        <span class="kind">{{ KIND[r.kind] }}</span>
        <b class="as-written">{{ r.title }}</b>
        <span class="meta">
          {{ r.person === YOU ? 'You, ' : '' }}through
          <span class="as-written">{{ linkName(r.link) }}</span
          >, day {{ r.day + 1 }}
        </span>
      </header>
      <p v-if="r.text" class="text as-written">{{ r.text }}</p>
      <template v-if="r.values">
        <ul class="values">
          <li v-for="(values, id) in r.values" :key="id">
            <template v-if="control(id)">
              <span class="as-written">{{ control(id)!.label }}</span>
              <span class="value">{{ valueText(control(id)!, values) }}</span>
            </template>
          </li>
        </ul>
        <button
          class="listen"
          :data-listen="r.id"
          title="Set your work’s controls to this setting (⌘Z takes it back)"
          @click="listen(r)"
        >
          {{ heard === r.id ? 'Listening in your work' : 'Listen in your work' }}
        </button>
      </template>
    </article>
  </section>
</template>

<style scoped>
.returns {
  padding: 14px 18px 24px;
  max-width: 720px;
  display: grid;
  gap: 10px;
  align-content: start;
}
.intro {
  margin: 0;
  color: var(--text-muted);
  font-size: 12.5px;
}
.item {
  padding: 10px 12px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
}
.item.focused {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.kind {
  font-family: var(--font-control);
  font-size: 11px;
  font-weight: 600;
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
  color: var(--accent-text);
}
.meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}
.text {
  margin: 6px 0 0;
  line-height: 1.45;
}
.values {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12.5px;
}
.value {
  margin-left: 6px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}
</style>

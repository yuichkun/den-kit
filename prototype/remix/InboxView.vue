<script setup lang="ts">
// The authors' inbox: for each work shared in this browser, what came back to its
// author (who, their words, what they changed, a link to hear it), and the author's
// two choices: whether people may change the inside, and which versions stay on
// the work's list that receivers see.
import { computed } from 'vue';
import { findWork } from '../../src/screen/showcase/index.ts';
import { when } from './kit.ts';
import { setAllowInside, setHidden, store } from './mock-store.ts';

const works = computed(() =>
  Object.values(store.value.works)
    .sort((a, b) => b.at - a.at)
    .map(w => ({
      ...w,
      title: findWork(w.work)?.title ?? w.work,
      returned: store.value.returned.filter(r => r.passage === w.id).sort((a, b) => b.at - a.at),
    })),
);
</script>

<template>
  <main class="inbox" data-testid="inbox">
    <h1>Authors' inbox</h1>
    <p class="lead">
      What came back to the works shared in this browser (in a real service, each author would see
      only their own). The people who get a work see the versions on its list.
    </p>
    <p v-if="!works.length" class="empty">
      Nothing shared yet. <a href="#">Share an instrument</a> or open the example first.
    </p>
    <section v-for="w in works" :key="w.id" class="card" :data-testid="`work-${w.id}`">
      <header>
        <h2>
          <span class="as-written">{{ w.title }}</span>
          <span class="muted">
            by <span class="as-written">{{ w.author }}</span> · shared {{ when(w.at) }}</span
          >
        </h2>
        <label class="check">
          <input
            type="checkbox"
            :checked="w.allowInside"
            data-testid="allow-inside"
            @change="setAllowInside(w.id, ($event.target as HTMLInputElement).checked)"
          />
          <span>Let people change the inside</span>
        </label>
      </header>
      <p v-if="!w.returned.length" class="empty">Nothing has come back yet.</p>
      <ul v-else class="returned">
        <li
          v-for="r in w.returned"
          :key="r.id"
          :class="{ hidden: r.hidden }"
          :data-testid="`returned-${r.id}`"
        >
          <div class="who">
            <strong class="as-written">{{ r.by }}</strong>
            <span class="muted"
              >{{ r.via?.length ? `via ${r.via.join(' → ')} · ` : '' }}{{ when(r.at) }} ·
              {{ r.carries.join(', ') || 'words only' }}</span
            >
          </div>
          <p v-if="r.words" class="words as-written">“{{ r.words }}”</p>
          <div class="row">
            <a :href="`#p=${r.link}`" data-testid="returned-listen">Listen</a>
            <button type="button" data-testid="returned-hide" @click="setHidden(r.id, !r.hidden)">
              {{ r.hidden ? 'Put it back on the list' : 'Take it off the list' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.inbox {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 40px;
  width: 100%;
}
h1 {
  font-size: 24px;
  margin: 8px 0;
}
.lead {
  color: var(--text-muted);
  margin: 0 0 20px;
}
.card {
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  background: var(--app-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  font-size: 15px;
  margin: 0;
}
.muted {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 12px;
}
label.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.returned {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.returned li {
  padding: 10px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-control);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.returned li.hidden {
  opacity: 0.5;
}
.who {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.words {
  margin: 0;
}
.row {
  display: flex;
  gap: 10px;
  align-items: center;
}
a {
  color: var(--accent-text);
}
.empty {
  color: var(--text-muted);
  margin: 0;
}
</style>

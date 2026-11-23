<script setup lang="ts">
// The panel den-kit's editor shows while a passed-on work is open (editor-hook.ts):
// where the work came from, what the person changed since they got it (from the
// editor's history, after the step that opened it), and the way back to the
// passage page with those changes. A floating button hides and shows it.
import { computed, ref } from 'vue';
import type { KitSession } from '../../src/editor/session.ts';
import type { ResolvedOp } from '../../src/work/ops.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { describeChanges, encodePassage, type Passage } from './passage.ts';

const props = defineProps<{
  session: KitSession;
  passage: Passage | null;
  received: PatchDocument | null;
  receipt: string;
  problem: string;
  title: string;
}>();
const open = ref(true);

/** The operations after the step that opened the work; null when that step is no longer in the history. */
const since = computed<ResolvedOp[] | null>(() => {
  void props.session.historyVersion.value;
  const entries = props.session.history.entries();
  const at = entries.findIndex(t => t.id === props.receipt);
  if (at < 0) return null;
  const later = entries.slice(at + 1);
  // Another work was opened over it.
  if (later.some(t => t.replaced)) return null;
  return later.flatMap(t => t.ops);
});
const changes = computed(() =>
  since.value ? [...(props.passage?.draft ?? []), ...since.value] : [],
);
const lines = computed(() =>
  props.received ? describeChanges(props.received, changes.value, props.session.catalog) : [],
);
const from = computed(() => {
  const p = props.passage;
  if (!p) return '';
  return p.hops.at(-1)?.by || p.author.name;
});

async function back() {
  if (!props.passage || !since.value) return;
  const text = await encodePassage({ ...props.passage, draft: changes.value });
  location.href = `${location.origin}/prototype/remix/#p=${text}`;
}
</script>

<template>
  <div class="remix" data-testid="remix-panel">
    <button type="button" class="toggle" data-testid="remix-toggle" @click="open = !open">
      {{ open ? 'Hide' : 'Passed-on work' }}
    </button>
    <section v-if="open" class="card">
      <template v-if="problem">
        <h2>Passed-on work</h2>
        <p class="problem" data-testid="remix-problem">{{ problem }}</p>
      </template>
      <template v-else-if="passage">
        <h2>
          <span class="as-written">{{ title }}</span>
          <span class="muted">
            from <span class="as-written">{{ from }}</span></span
          >
        </h2>
        <p class="muted">
          Change anything: the patch, the screen, the look. Your changes, from what you got:
        </p>
        <ul v-if="since" class="lines" data-testid="remix-lines">
          <li v-for="l in lines" :key="l.text" :class="l.kind">{{ l.text }}</li>
          <li v-if="!lines.length" class="none">Nothing yet</li>
        </ul>
        <p v-else class="problem" data-testid="remix-lost">
          The step that opened this work was undone or replaced: open the link again.
        </p>
        <button
          type="button"
          class="primary"
          data-testid="remix-back"
          :disabled="!since"
          @click="back"
        >
          Back to passing it on
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.remix {
  position: fixed;
  left: 16px;
  bottom: 84px;
  /* Under the editor's start overlay, which asks for the first click. */
  z-index: 900;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: 340px;
}
.toggle {
  font-size: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-panel);
  background: var(--app-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-card);
}
h2 {
  font-size: 14px;
  margin: 0;
}
.muted {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}
.problem {
  margin: 0;
  color: var(--state-warn);
  font-size: 13px;
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.lines li {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius-control);
  background: var(--app-field);
}
.lines li.inside,
.lines li.screen {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.lines li.none {
  color: var(--text-muted);
  font-family: var(--font-ui);
}
.card button {
  align-self: flex-start;
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useSession } from './context.ts';
const session = useSession();
const pre = ref<HTMLElement | null>(null);
const lines = computed(() => session.generated.value.source ? session.generated.value.source.split('\n') : []);
const highlighted = computed(() => new Set(session.selection.value.flatMap(id => session.generated.value.nodeLines[id] ?? [])));
watch(highlighted, async set => {
  await nextTick();
  const first = Math.min(...set);
  if (Number.isFinite(first)) pre.value?.querySelector(`[data-line="${first}"]`)?.scrollIntoView({ block: 'center' });
});
async function copy() { await navigator.clipboard?.writeText(session.generated.value.source).catch(() => {}); session.toast('info', 'Copied the generated processor.'); }
</script>

<template>
  <div class="code-view" data-testid="code-view">
    <div class="bar"><span class="muted">Generated unworklet processor (read-only) · {{ lines.length }} lines · hash {{ session.generated.value.hash || '—' }}</span><button @click="copy">Copy</button></div>
    <pre ref="pre"><code><span v-for="(line, i) in lines" :key="i" class="line" :class="{ hl: highlighted.has(i + 1) }" :data-line="i + 1"><span class="n">{{ i + 1 }}</span>{{ line }}
</span></code></pre>
    <div v-if="!lines.length" class="empty muted">{{ session.generated.value.issues.map(i => i.message).join(' ') || 'Nothing to compile.' }}</div>
  </div>
</template>

<style scoped>
.code-view { position: absolute; inset: 0; display: flex; flex-direction: column; }
.bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--line); }
pre { margin: 0; overflow: auto; flex: 1; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.line { display: block; white-space: pre; padding-right: 16px; }
.line.hl { background: #5ec4ff22; }
.n { display: inline-block; width: 44px; padding-right: 10px; text-align: right; color: #555d6b; user-select: none; }
.empty { padding: 16px; }
</style>

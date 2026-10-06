<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { FastPath } from '../ai/fast-path.ts';

const props = defineProps<{ fast: FastPath }>();
const fast = props.fast;
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const drawer = ref(false);
const outcome = computed(() => fast.outcome.value);
const routeText = computed(() => {
  const o = outcome.value; if (!o || o.status === 'working') return '';
  const via = o.route === 'lexicon' ? 'lexicon' : o.route === 'jev' || o.route === 'jev-target' ? `Jev ${o.jevMs ?? '?'} ms` : '—';
  return `fast · ${via} · ${o.ms} ms${o.confidence !== undefined && o.route !== 'lexicon' ? ` · ${Math.round(o.confidence * 100)}%` : ''}`;
});
const canAB = computed(() => (fast.session.historyVersion.value, outcome.value?.ab, fast.canAB));

async function submit() {
  const value = text.value.trim();
  if (!value || fast.busy.value) return;
  const o = await fast.run(value);
  if (o.status === 'applied') text.value = '';
}
function key(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.value?.focus(); input.value?.select(); }
}
function inputKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { if (fast.busy.value) fast.cancel(); else input.value?.blur(); }
  // Keep editor shortcuts (⌘Z, Delete…) from acting on the patch while typing.
  e.stopPropagation();
}
onMounted(() => window.addEventListener('keydown', key));
onBeforeUnmount(() => window.removeEventListener('keydown', key));
defineExpose({ focus: () => nextTick(() => input.value?.focus()) });
const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<template>
  <div class="ai-bar" data-testid="ai-bar">
    <div v-if="drawer" class="drawer" data-testid="ai-drawer">
      <div class="row">
        <label><span>τ (apply at ≥)</span><input v-model.number="fast.settings.tau" type="range" min="0.3" max="0.95" step="0.01" data-testid="ai-tau" /> <b>{{ pct(fast.settings.tau) }}</b></label>
        <label><span>τ Japanese via Jev</span><input v-model.number="fast.settings.tauJa" type="range" min="0.3" max="0.99" step="0.01" /> <b>{{ pct(fast.settings.tauJa) }}</b></label>
        <label><span>Jev time budget</span><input :value="fast.budgetMs" type="range" min="300" max="8000" step="100" data-testid="ai-budget" @input="fast.settings.budgetMs = Number(($event.target as HTMLInputElement).value)" /> <b>{{ fast.budgetMs }} ms</b></label>
        <label class="check"><input v-model="fast.settings.useJev" type="checkbox" data-testid="ai-use-jev" /> use Jev (off: lexicon only)</label>
      </div>
      <table class="traces">
        <tr><th>request</th><th>route</th><th>result</th><th>conf.</th><th>ms</th></tr>
        <tr v-for="t in fast.traces.value.slice(0, 10)" :key="t.id" :title="JSON.stringify(t.jev?.answers ?? {}, null, 1)">
          <td class="req">{{ t.text }}</td>
          <td>{{ t.route }}{{ t.jev ? ` ${t.jev.ms}ms${t.jev.ok ? '' : ' ✕'}` : '' }}</td>
          <td>{{ t.decision }}{{ t.stale ? ' (stale)' : '' }}{{ t.plan ? `: ${t.plan}` : '' }}</td>
          <td>{{ t.confidence !== undefined ? pct(t.confidence) : '' }}</td>
          <td>{{ t.totalMs }}</td>
        </tr>
      </table>
    </div>
    <div v-if="outcome" class="result" :class="outcome.status" data-testid="ai-result" :data-status="outcome.status">
      <template v-if="outcome.status === 'working'"><span class="spin" /> thinking…</template>
      <template v-else>
        <span class="badge" data-testid="ai-badge">{{ routeText }}</span>
        <span v-if="outcome.status === 'applied'" class="label" data-testid="ai-label">{{ outcome.label }}</span>
        <span v-if="outcome.message" class="message" data-testid="ai-message">{{ outcome.message }}</span>
        <span v-if="outcome.note" class="note">{{ outcome.note }}</span>
        <template v-if="outcome.txId">
          <button :disabled="!canAB" :class="{ active: outcome.ab === 'before' }" title="Compare with the state before this edit" data-testid="ai-ab" @click="fast.toggleAB()">{{ outcome.ab === 'before' ? 'A · before' : 'B · after' }}</button>
          <button title="Undo this AI edit" data-testid="ai-undo" @click="fast.undo()">Undo</button>
        </template>
        <span v-if="outcome.chips.length" class="chips">
          <button v-for="(c, i) in outcome.chips" :key="i" class="chip" data-testid="ai-chip" @click="fast.applyChip(c)">{{ c.label }}</button>
        </span>
      </template>
    </div>
    <form class="bar" @submit.prevent="submit">
      <span class="spark">✦</span>
      <input ref="input" v-model="text" type="text" data-testid="ai-input" placeholder="Ask… (⌘K)  e.g. 明るく · リリース長く · add reverb · ベース作って" :disabled="fast.session.readOnly.value" maxlength="600" @keydown="inputKey" />
      <span v-if="fast.busy.value" class="spin" />
      <button type="button" class="gear" title="Fast-path settings and recent requests" data-testid="ai-drawer-toggle" :class="{ active: drawer }" @click="drawer = !drawer">⚙</button>
    </form>
  </div>
</template>

<style scoped>
.ai-bar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(760px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 6px; z-index: 20; pointer-events: none; }
.ai-bar > * { pointer-events: auto; }
.bar { display: flex; align-items: center; gap: 8px; background: #1b1b1b; border: 1px solid #3a3a3a; border-radius: 8px; padding: 6px 8px 6px 12px; box-shadow: 0 8px 28px #000a; }
.bar:focus-within { border-color: var(--accent); }
.bar input { flex: 1; background: transparent; border: 0; outline: none; color: var(--fg); font: inherit; font-size: 14px; padding: 4px 0; }
.spark { color: var(--accent); font-size: 14px; }
.gear { background: transparent; border: 0; color: var(--muted); font-size: 14px; padding: 2px 6px; }
.gear.active, .gear:hover { color: var(--accent); }
.result { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: #232323ee; border: 1px solid #333; border-left: 3px solid var(--accent-2); border-radius: 6px; padding: 6px 10px; font-size: 12px; box-shadow: 0 6px 20px #0008; }
.result.applied { border-left-color: var(--ok); } .result.chips { border-left-color: var(--warn); } .result.escalate { border-left-color: var(--ghost); } .result.nothing { border-left-color: var(--muted); }
.badge { font-variant-numeric: tabular-nums; color: var(--muted); background: #161616; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.label { color: var(--fg); }
.message { color: var(--warn); } .result.nothing .message { color: var(--muted); }
.note { color: var(--muted); font-style: italic; }
.result button { font-size: 11px; padding: 2px 8px; }
.result button.active { background: var(--accent); color: #1a1a1a; }
.chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.chip { border-radius: 12px; border: 1px solid var(--warn) !important; background: transparent; color: var(--warn); }
.chip:hover { background: var(--warn); color: #1a1a1a; }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin .7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.drawer { background: #1b1b1bf4; border: 1px solid #3a3a3a; border-radius: 8px; padding: 10px 12px; font-size: 11px; max-height: 300px; overflow: auto; }
.drawer .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin-bottom: 8px; }
.drawer label { display: flex; width: 100%; align-items: center; gap: 8px; color: var(--muted); }
.drawer label > span { flex: 0 0 120px; }
.drawer input[type=range] { flex: 1 1 auto; width: auto; min-width: 60px; }
.drawer b { flex: 0 0 56px; color: var(--fg); font-weight: 400; font-variant-numeric: tabular-nums; text-align: right; }
.traces { width: 100%; border-collapse: collapse; }
.traces th { text-align: left; color: var(--muted); font-weight: 400; border-bottom: 1px solid #333; padding: 2px 6px; }
.traces td { padding: 2px 6px; border-bottom: 1px solid #262626; vertical-align: top; font-variant-numeric: tabular-nums; }
.traces .req { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

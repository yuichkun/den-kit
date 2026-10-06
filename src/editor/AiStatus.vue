<script setup lang="ts">
import { computed } from 'vue';
import type { BridgeClient } from '../ai/bridge-client.ts';

const props = defineProps<{ bridge: BridgeClient }>();
const b = props.bridge;
const bridgeTitle = computed(() => b.state.value === 'online' ? 'AI bridge connected' : b.detail.value || 'AI offline');
const jev = computed(() => {
  const s = b.status.value?.jev;
  if (b.state.value !== 'online' || !s) return null;
  if (s.state === 'off') return { cls: 'off', text: 'Jev off', title: s.detail ?? 'Set TYPESAFE_API_KEY in kit/.env and restart kit:dev.' };
  if (s.state === 'error') return { cls: 'error', text: s.detail === 'auth' ? 'Jev key ✕' : 'Jev ✕', title: s.detail === 'auth' ? 'Jev rejected the API key (401). Fix TYPESAFE_API_KEY in kit/.env and restart kit:dev.' : `Jev unreachable (${s.detail ?? 'error'}). Fast path uses the lexicon only.` };
  if (s.state === 'unknown') return { cls: 'wait', text: 'Jev …', title: `Warming up ${s.model ?? ''}` };
  return { cls: 'ok', text: s.lastMs ? `Jev ${s.lastMs} ms` : 'Jev', title: `${s.model ?? 'Jev'} ready` };
});
</script>

<template>
  <span class="ai-status" data-testid="ai-status" :data-state="b.state.value">
    <span v-if="b.state.value !== 'online'" class="chip off" :title="bridgeTitle" @click="b.retryNow()">● AI offline</span>
    <span v-else-if="jev" class="chip" :class="jev.cls" :title="jev.title" data-testid="ai-status-jev">● {{ jev.text }}</span>
  </span>
</template>

<style scoped>
.ai-status { display: inline-flex; gap: 4px; }
.chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #161616; white-space: nowrap; cursor: default; font-variant-numeric: tabular-nums; }
.chip.ok { color: var(--ok); } .chip.error { color: var(--error); } .chip.wait { color: var(--warn); } .chip.off { color: var(--muted); }
</style>

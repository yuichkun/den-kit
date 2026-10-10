<script setup lang="ts">
import { computed } from 'vue';
import type { BridgeClient } from '../ai/bridge-client.ts';
import { desktop } from '../desktop/api.ts';

const props = defineProps<{ bridge: BridgeClient }>();
const b = props.bridge;
const bridgeTitle = computed(() => b.state.value === 'online' ? 'AI bridge connected' : b.detail.value || 'AI offline');
// The LLM (Codex): signed in, starting, needs sign-in, or broken; usage when it gets high.
const codex = computed(() => {
  const c = b.status.value?.codex;
  if (b.state.value !== 'online' || !c) return null;
  const why = [c.detail, c.fix].filter(Boolean).join('\n');
  if (c.state === 'off') return { cls: 'off', text: 'LLM off', title: why || 'The LLM path is off.' };
  if (c.state === 'starting') return { cls: 'wait', text: 'LLM …', title: c.detail ?? 'Starting Codex…' };
  if (c.state === 'login') return { cls: 'wait', text: 'LLM: sign in', title: why, retry: true };
  if (c.state === 'error') return { cls: 'error', text: 'LLM ✕', title: `${why}\n(click to retry)`, retry: true };
  const usage = c.rateLimit?.usedPercent ?? 0;
  const resets = c.rateLimit?.resetsAt ? ` · resets ${new Date(c.rateLimit.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return { cls: usage >= 90 ? 'error' : usage >= 70 ? 'wait' : 'ok', text: usage >= 50 ? `LLM ${usage}%` : 'LLM', title: `${c.model ?? 'Codex'}${c.plan ? ` · ChatGPT ${c.plan}` : ''}${c.rateLimit ? ` · ${usage}% of the usage window used${resets}` : ''}` };
});
function retryCodex() {
  if (desktop() && b.status.value?.codex.state === 'login') { window.dispatchEvent(new Event('den-kit:open-settings')); return; }
  if (codex.value && 'retry' in codex.value) b.codexRetry();
}
</script>

<template>
  <span class="ai-status" data-testid="ai-status" :data-state="b.state.value">
    <span v-if="b.state.value !== 'online'" class="chip off" :title="bridgeTitle" @click="b.retryNow()">● AI offline</span>
    <template v-else>
      <span v-if="codex" class="chip" :class="[codex.cls, { clickable: 'retry' in codex }]" :title="codex.title" data-testid="ai-status-codex" :data-state="b.status.value?.codex.state" @click="retryCodex">● {{ codex.text }}</span>
    </template>
  </span>
</template>

<style scoped>
.ai-status { display: inline-flex; gap: 4px; }
.chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #161616; white-space: nowrap; cursor: default; font-variant-numeric: tabular-nums; }
.chip.clickable { cursor: pointer; }
.chip.ok { color: var(--ok); } .chip.error { color: var(--error); } .chip.wait { color: var(--warn); } .chip.off { color: var(--muted); }
</style>

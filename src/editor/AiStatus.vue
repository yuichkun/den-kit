<script setup lang="ts">
import { computed } from 'vue';
import type { AI } from '../host/ai.ts';

const props = defineProps<{ bridge: AI }>();
const b = props.bridge;
// The host words the status for the people who use it (src/host/ai.ts).
const technical = b.wording.technical;
const bridgeTitle = computed(() =>
  !technical
    ? 'The AI connection was lost. Click to reconnect.'
    : b.state.value === 'online'
      ? 'AI bridge connected'
      : b.detail.value || 'AI offline',
);
// The LLM (Codex): signed in, starting, needs sign-in, or broken; usage when it gets high.
const codex = computed(() => {
  const c = b.status.value?.codex;
  if (b.state.value !== 'online' || !c) return null;
  const why = technical ? [c.detail, c.fix].filter(Boolean).join('\n') : '';
  if (c.state === 'off')
    return {
      cls: 'off',
      text: 'AI unavailable',
      title: why || 'AI is unavailable. Click to reconnect.',
      retry: true,
    };
  if (c.state === 'starting')
    return {
      cls: 'wait',
      text: 'AI starting…',
      title: technical ? (c.detail ?? 'Starting AI…') : 'AI is starting. Try again in a moment.',
    };
  if (c.state === 'login')
    return {
      cls: 'wait',
      text: 'ChatGPT: sign in',
      title: why || 'Open Settings to sign in with ChatGPT.',
      retry: true,
    };
  if (c.state === 'error')
    return {
      cls: 'error',
      text: 'AI disconnected',
      title: technical ? `${why}\n(click to retry)` : 'AI could not connect. Click to reconnect.',
      retry: true,
    };
  const usage = c.rateLimit?.usedPercent ?? 0;
  const resets = c.rateLimit?.resetsAt
    ? ` · resets ${new Date(c.rateLimit.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
  return {
    cls: usage >= 90 ? 'error' : usage >= 70 ? 'wait' : 'ok',
    text: usage >= 50 ? `AI ${usage}%` : 'AI',
    title: `${c.model ?? 'ChatGPT'}${c.plan ? ` · ChatGPT ${c.plan}` : ''}${c.rateLimit ? ` · ${usage}% of the usage window used${resets}` : ''}`,
  };
});
function retryCodex() {
  if (b.account && b.status.value?.codex.state === 'login') {
    window.dispatchEvent(new Event('den-kit:open-settings'));
    return;
  }
  if (codex.value && 'retry' in codex.value) b.codexRetry();
}
</script>

<template>
  <span class="ai-status" data-testid="ai-status" :data-state="b.state.value">
    <span
      v-if="b.state.value !== 'online'"
      class="chip off"
      :title="bridgeTitle"
      @click="b.retryNow()"
      >● AI offline</span
    >
    <template v-else>
      <span
        v-if="codex"
        class="chip"
        :class="[codex.cls, { clickable: 'retry' in codex }]"
        :title="codex.title"
        data-testid="ai-status-codex"
        :data-state="b.status.value?.codex.state"
        @click="retryCodex"
        >● {{ codex.text }}</span
      >
    </template>
  </span>
</template>

<style scoped>
.ai-status {
  display: inline-flex;
  gap: 4px;
}
.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: var(--radius-control);
  background: var(--app-field);
  white-space: nowrap;
  cursor: default;
  font-variant-numeric: tabular-nums;
}
.chip.clickable {
  cursor: pointer;
}
.chip.ok {
  color: var(--state-ok);
}
.chip.error {
  color: var(--state-danger);
}
.chip.wait {
  color: var(--state-warn);
}
.chip.off {
  color: var(--text-muted);
}
</style>

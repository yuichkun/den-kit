<script setup lang="ts">
// A rendered step as a small waveform: rendered when shown (renders are kept, so the
// same job draws at once the next time), played on a click.
import { computed, ref, watch } from 'vue';
import { play, render, type RenderJob } from './audio.ts';
import { peaks, samplesOf } from './wav.ts';

const props = defineProps<{ job: RenderJob; label: string }>();
const columns = 40;
const shape = ref<number[] | null>(null);
const failed = ref(false);
let buffer: AudioBuffer | null = null;

const key = computed(() =>
  JSON.stringify([
    props.job.build.fingerprint,
    props.job.setting,
    props.job.steps,
    props.job.preroll,
  ]),
);
watch(
  key,
  async (now, _, cleanup) => {
    let stale = false;
    cleanup(() => (stale = true));
    shape.value = null;
    failed.value = false;
    try {
      const made = await render(props.job);
      if (stale) return;
      buffer = made;
      const p = peaks(samplesOf(made), columns);
      const top = Math.max(...p, 1e-6);
      shape.value = p.map(v => v / Math.max(top, 0.25));
    } catch {
      if (!stale) failed.value = true;
    }
  },
  { immediate: true },
);

const path = computed(() => {
  const s = shape.value;
  if (!s) return '';
  const w = 100 / s.length;
  const upper = s.map((v, i) => `${(i * w).toFixed(2)},${(16 - v * 15).toFixed(2)}`);
  const lower = s.map((v, i) => `${(i * w).toFixed(2)},${(16 + v * 15).toFixed(2)}`).reverse();
  return `M${upper.join('L')}L${lower.join('L')}Z`;
});

function listen() {
  if (buffer) void play([buffer]);
}
</script>

<template>
  <button
    type="button"
    class="wave"
    :class="{ ready: !!shape, failed }"
    :title="label"
    :aria-label="`Play ${label}`"
    :disabled="!shape"
    data-testid="wave"
    @click="listen"
  >
    <svg viewBox="0 0 100 32" preserveAspectRatio="none">
      <line x1="0" y1="16" x2="100" y2="16" class="axis" />
      <path v-if="shape" :d="path" />
    </svg>
  </button>
</template>

<style scoped>
.wave {
  display: block;
  width: 64px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line-subtle);
  background: var(--app-card);
}
.wave:disabled {
  opacity: 1;
  cursor: progress;
}
.wave.failed {
  border-color: var(--state-danger);
}
svg {
  display: block;
  width: 100%;
  height: 100%;
}
.axis {
  stroke: var(--line-subtle);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
path {
  fill: var(--text-primary);
}
</style>

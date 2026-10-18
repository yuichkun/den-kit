<script setup lang="ts">
// Browsers only allow sound after a click or key press, so den-kit opens behind
// a full-screen overlay: the first click or key starts audio (and MIDI) and the
// overlay goes away. It comes back only when sound cannot run.
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useSession } from './context.ts';

const session = useSession();
const state = computed(() => session.engineState.value);
const visible = computed(() => state.value !== 'running');
async function start() {
  if (state.value === 'starting') return;
  if (await session.ensureAudio()) void session.connectMidi();
}
// A key press also starts (and still does its job: a note key plays once audio is up).
function key(e: KeyboardEvent) {
  if (
    visible.value &&
    (state.value === 'off' || state.value === 'suspended') &&
    !e.metaKey &&
    !e.ctrlKey
  )
    void start();
}
onMounted(() => window.addEventListener('keydown', key, true));
onBeforeUnmount(() => window.removeEventListener('keydown', key, true));
</script>

<template>
  <div
    v-if="visible"
    class="start-overlay"
    data-testid="start-overlay"
    :data-state="state"
    @pointerdown.prevent="start"
  >
    <div class="card">
      <div class="brand">
        <span class="logo"><i v-for="k in 8" :key="k" /></span>den-kit
      </div>
      <template v-if="state === 'off' || state === 'starting'">
        <h1>{{ state === 'starting' ? 'Starting…' : 'Click anywhere to start' }}</h1>
        <ul class="hints">
          <li><kbd>Enter</kbd> type a request</li>
          <li><kbd>A</kbd>–<kbd>K</kbd> play</li>
          <li><kbd>⌘Z</kbd> undo</li>
          <li><kbd>⌥⌘E</kbd> patch ⇄ plugin</li>
          <li><kbd>⌥⌘N</kbd> new</li>
        </ul>
      </template>
      <template v-else-if="state === 'suspended'">
        <h1>Sound paused</h1>
        <p>Sound was paused. Click anywhere to resume.</p>
      </template>
      <template v-else>
        <h1>No sound</h1>
        <p class="error" data-testid="start-error">{{ session.engineMessage.value }}</p>
        <p>Click anywhere to try again.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.start-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: #0b0b0bd9;
  backdrop-filter: blur(3px);
  cursor: pointer;
}
.card {
  text-align: center;
  max-width: 560px;
  padding: 24px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #ddd;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 18px;
}
h1 {
  margin: 0 0 18px;
  font-size: 30px;
  font-weight: 400;
  color: #f4f4f4;
}
p {
  color: #bdbdbd;
  font-size: 15px;
  line-height: 1.5;
  margin: 6px 0;
}
.error {
  color: var(--warn);
}
.hints {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 22px;
  color: #a8a8a8;
  font-size: 14px;
}
kbd {
  display: inline-block;
  min-width: 18px;
  padding: 1px 6px;
  margin-right: 4px;
  border: 1px solid #555;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #222;
  color: #eee;
  font:
    12px/1.5 Lato,
    system-ui,
    sans-serif;
}
</style>

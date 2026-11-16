<script setup lang="ts">
// The question about the data den-kit may send (src/host/analytics.ts), before
// anything else on the first launch: each kind the host can send and the person
// has not answered about, unchecked, and Continue. A kind left unchecked is not
// sent. Settings changes the answers later.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Analytics, DataChoice, DataKind } from '../host/analytics.ts';
import { DATA_KIND_TEXT } from './data-consent.ts';

const props = defineProps<{ analytics: Analytics; kinds: readonly DataKind[] }>();
/** The answers once the host keeps them; null when it could not (nothing more is sent, and the question comes again). */
const emit = defineEmits<{ done: [answer: DataChoice | null] }>();
const checked = ref<DataChoice>({});
const busy = ref(false);
const dialog = ref<HTMLElement | null>(null);

async function done() {
  if (busy.value) return;
  busy.value = true;
  const answer: DataChoice = Object.fromEntries(
    props.kinds.map(kind => [kind, checked.value[kind] === true]),
  );
  try {
    await props.analytics.choose(answer);
  } catch {
    emit('done', null);
    return;
  } finally {
    busy.value = false;
  }
  emit('done', answer);
}
function keys(e: KeyboardEvent) {
  e.stopImmediatePropagation(); // The editor and the start overlay wait until the person answers.
  if (e.key !== 'Tab') return;
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [],
  );
  const first = controls[0],
    last = controls.at(-1);
  if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    e.preventDefault();
    last?.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first?.focus();
  }
}
onMounted(() => {
  window.addEventListener('keydown', keys, true);
  void nextTick().then(() => dialog.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener('keydown', keys, true));
</script>

<template>
  <div class="consent-shade">
    <section
      ref="dialog"
      tabindex="-1"
      class="data-consent"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-consent-title"
      data-testid="data-consent"
    >
      <h2 id="data-consent-title">Help improve den-kit</h2>
      <p>Choose what den-kit may send to Escentier.</p>
      <label v-for="kind in kinds" :key="kind" class="kind">
        <input v-model="checked[kind]" type="checkbox" :data-testid="`data-consent-${kind}`" />
        <span
          ><b>{{ DATA_KIND_TEXT[kind].title }}</b> — {{ DATA_KIND_TEXT[kind].detail }}</span
        >
      </label>
      <p class="help">
        {{
          analytics.kinds.includes('usage')
            ? 'You can change this, see your ID, and ask us to delete your data anytime in Settings.'
            : 'You can change this anytime in Settings.'
        }}
      </p>
      <div class="actions">
        <button class="primary" :disabled="busy" data-testid="data-consent-continue" @click="done">
          Continue
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.consent-shade {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-canvas) 85%, transparent);
  backdrop-filter: blur(3px);
  padding: 24px;
}
.data-consent {
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 24px;
  background: var(--app-chrome);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-dialog);
}
.data-consent:focus {
  outline: none;
}
h2 {
  margin: 0 0 8px;
  font-size: 20px;
}
p {
  margin: 8px 0;
  font-size: 14px;
  line-height: 1.6;
}
.kind {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 14px 0;
  font-size: 14px;
  line-height: 1.5;
  cursor: pointer;
}
.kind input {
  margin-top: 4px;
  flex: none;
}
.help {
  color: var(--text-muted);
  font-size: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}
.actions button {
  padding: 8px 18px;
}
</style>

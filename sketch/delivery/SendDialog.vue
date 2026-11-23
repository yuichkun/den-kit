<script setup lang="ts">
// Sending back to the author: the kept settings and the order sheet, with the version
// they were made with, as a link. The link carries settings and seeds, not sound, so
// it is small, and the author hears exactly the same steps from the same build.
import { computed, inject, ref, watch } from 'vue';
import { DELIVERY } from './context.ts';
import { encodeReply, type Reply } from './record.ts';

const emit = defineEmits<{ close: [] }>();
const ctx = inject(DELIVERY)!;
const name = ref(ctx.state.name);
const message = ref('');
const withKept = ref(ctx.state.kept.length > 0);
const withSheet = ref(true);
const copied = ref(false);
watch(name, n => (ctx.state.name = n));

const files = computed(() =>
  Object.values(ctx.state.sheet.cells).reduce((sum, c) => sum + c.count, 0),
);
const link = computed(() => {
  const reply: Reply = {
    work: ctx.work,
    version: ctx.state.version,
    fingerprint: ctx.active.value?.fingerprint ?? '',
    name: name.value.trim(),
    message: message.value.trim(),
    kept: withKept.value ? ctx.state.kept : [],
    sheet: withSheet.value ? ctx.state.sheet : null,
  };
  return `${location.origin}${location.pathname}?work=${encodeURIComponent(ctx.work)}&reply=${encodeReply(reply)}`;
});

async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="send-title">
      <h2 id="send-title">Send to the author</h2>
      <p class="lead">
        The link carries your settings and seeds, not sound: the author hears the same steps, made
        with the same version ({{ ctx.state.version }} · {{ ctx.active.value?.fingerprint }}).
      </p>
      <label class="field">
        <span>Your name</span>
        <input v-model="name" type="text" class="as-written" maxlength="60" />
      </label>
      <label class="field">
        <span>Message</span>
        <textarea
          v-model="message"
          rows="3"
          maxlength="1000"
          class="as-written"
          placeholder="What you need, what should change…"
          data-testid="send-message"
        />
      </label>
      <label class="check">
        <input v-model="withKept" type="checkbox" :disabled="!ctx.state.kept.length" />
        Kept settings ({{ ctx.state.kept.length }})
      </label>
      <label class="check">
        <input v-model="withSheet" type="checkbox" />
        The order sheet ({{ files }} files)
      </label>
      <input
        :value="link"
        type="text"
        readonly
        class="link"
        aria-label="Link to send"
        data-testid="send-link"
        @focus="($event.target as HTMLInputElement).select()"
      />
      <div class="buttons">
        <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy link' }}</button>
        <a :href="link" target="_blank" rel="noopener" data-testid="send-open-author">
          Open it as the author
        </a>
        <button type="button" class="primary" @click="emit('close')">Done</button>
      </div>
      <p class="note">
        This sketch has no server: the link travels the way you send it, by mail or chat.
      </p>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--ink) 30%, transparent);
  z-index: 10;
}
.dialog {
  width: min(520px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-radius: var(--radius-panel);
  background: var(--app-card);
  box-shadow: var(--shadow-dialog);
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: var(--weight-title);
}
.lead,
.note {
  margin: 0;
  color: var(--text-muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}
.field input,
.field textarea {
  color: var(--text-primary);
  font-size: 14px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.link {
  font-family: var(--font-mono);
  font-size: 12px;
}
.buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}
.buttons a {
  color: var(--accent-text);
}
.buttons .primary {
  margin-left: auto;
}
</style>

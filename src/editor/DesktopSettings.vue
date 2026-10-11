<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { desktop, type DesktopInfo, type DesktopSettings } from '../desktop/api.ts';
import { accountStatus, effortLabel, settingsError, type SettingsAction } from '../desktop/presentation.ts';

const emit = defineEmits<{ close: [] }>();
const api = desktop()!;
const dialog = ref<HTMLElement | null>(null);
const previousFocus = document.activeElement as HTMLElement | null;
const info = ref<DesktopInfo | null>(null);
const model = ref('');
const effort = ref('');
const busy = ref(false);
const error = ref('');
const saved = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const efforts = computed(() => info.value?.models.find(m => model.value ? m.id === model.value : m.isDefault)?.efforts ?? []);
const locked = computed(() => busy.value || !!info.value?.aiBusy || info.value?.login === 'waiting');

async function refresh(first = false) {
  try {
    info.value = await api.info();
    if (first) { model.value = info.value.settings.model; effort.value = info.value.settings.effort; }
  } catch (e) { error.value = settingsError(e, 'load'); }
}
async function action(fn: () => Promise<unknown>, kind: SettingsAction) {
  busy.value = true; error.value = ''; saved.value = false;
  try { await fn(); await refresh(); } catch (e) { error.value = settingsError(e, kind); }
  finally { busy.value = false; }
}
async function save() {
  if (!info.value || locked.value) return;
  const settings: DesktopSettings = { model: model.value, effort: effort.value, fork: info.value.settings.fork };
  await action(async () => { info.value = await api.saveSettings(settings); saved.value = true; }, 'settings');
}
async function reconnect() {
  await action(async () => { info.value = await api.reconnectAI(); }, 'reconnect');
}
function changeModel() { if (!efforts.value.includes(effort.value)) effort.value = ''; saved.value = false; }
function keys(e: KeyboardEvent) {
  e.stopImmediatePropagation(); // Keep the editor and first-launch gallery from handling dialog keys.
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); }
  if (e.key === 'Tab') {
    const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? []);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
}
onMounted(() => { void refresh(true).then(() => nextTick()).then(() => dialog.value?.focus()); timer = setInterval(() => { void refresh(); }, 1500); window.addEventListener('keydown', keys, true); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); window.removeEventListener('keydown', keys, true); previousFocus?.focus(); });
</script>

<template>
  <div class="settings-shade" @click.self="emit('close')">
    <section ref="dialog" tabindex="-1" class="desktop-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="desktop-settings">
      <header><h2 id="settings-title">Settings</h2><button aria-label="Close settings" @click="emit('close')">×</button></header>
      <div v-if="info" class="settings-body">
        <h3>ChatGPT</h3>
        <p data-testid="desktop-account">{{ accountStatus(info.codex.state, info.login === 'waiting', info.chatGPTSignedIn) }}<span v-if="info.chatGPTSignedIn && info.codex.state === 'ok' && info.codex.plan"> · {{ info.codex.plan }}</span></p>
        <p class="help">When you use ChatGPT, your requests and relevant work content are sent to OpenAI and use your account's allowance.</p>
        <div class="actions">
          <button v-if="!info.chatGPTSignedIn && (info.codex.state === 'login' || info.codex.state === 'ok') && info.login !== 'waiting'" :disabled="busy || info.aiBusy" data-testid="desktop-sign-in" @click="action(() => api.signIn(), 'sign-in')">Sign in with ChatGPT</button>
          <button v-if="(info.codex.state === 'error' || info.codex.state === 'off') && info.login !== 'waiting'" :disabled="busy || info.aiBusy" data-testid="desktop-reconnect" @click="reconnect">Reconnect AI</button>
          <template v-if="info.login === 'waiting'"><span>Complete sign-in in your browser.</span><button :disabled="busy" @click="action(() => api.cancelSignIn(), 'sign-in')">Cancel sign-in</button></template>
          <template v-if="info.chatGPTSignedIn && info.codex.state === 'ok'"><button :disabled="busy" @click="action(() => api.openUsage(), 'usage')">Manage usage</button><button :disabled="busy || info.aiBusy" data-testid="desktop-sign-out" @click="action(() => api.signOut(), 'sign-out')">Sign out</button></template>
        </div>
        <p v-if="info.loginError" class="settings-error">{{ settingsError(info.loginError, 'sign-in') }}</p>
        <h3>AI settings</h3>
        <label>Model<select v-model="model" data-testid="desktop-model" :disabled="locked" @change="changeModel"><option value="">Default</option><option v-for="m in info.models" :key="m.id" :value="m.id">{{ m.name }}</option></select></label>
        <label>Reasoning effort<select v-model="effort" data-testid="desktop-effort" :disabled="locked" @change="saved = false"><option value="">Default</option><option v-for="e in efforts" :key="e" :value="e">{{ effortLabel(e) }}</option></select></label>
        <div class="actions"><button :disabled="locked" data-testid="desktop-settings-save" @click="save">{{ busy ? 'Saving…' : 'Save settings' }}</button><span v-if="saved" role="status">Saved. Your next AI request will use these settings.</span></div>
        <p v-if="info.aiBusy" class="help">You can change AI settings when the current request finishes.</p>
        <p v-else-if="info.login === 'waiting'" class="help">Complete or cancel sign-in before changing AI settings.</p>
        <footer>den-kit {{ info.version }}</footer>
      </div>
      <p v-else class="settings-body">Loading settings…</p>
      <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.settings-shade { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: #0009; padding: 24px; }
.desktop-settings { width: min(580px, 100%); max-height: 90vh; overflow: auto; background: #1a2028; border: 1px solid #394451; border-radius: 12px; color: #e6edf5; box-shadow: 0 16px 80px #0008; }
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid #394451; }
h2 { margin: 0; font-size: 20px; } h3 { margin: 22px 0 10px; font-size: 15px; } h3:first-child { margin-top: 0; }
.settings-body { padding: 20px 24px; } p { line-height: 1.6; font-size: 14px; margin: 8px 0; }
.help, footer { color: #9babbc; font-size: 12px; } footer { margin-top: 24px; }
label { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 12px 0; font-size: 14px; }
select { min-width: 180px; max-width: 300px; }
button, select { border: 1px solid #4b596b; background: #28313d; color: inherit; border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; }
button:disabled, select:disabled { opacity: .5; cursor: default; } .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.settings-error { color: #ffafa5; padding: 0 24px 16px; } .settings-body .settings-error { padding: 0; }
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FastPath } from '../ai/fast-path.ts';
import { VoiceInput, VOICE_LANGS, browserRecognition, saveVoiceLang, type RecognitionLike } from '../ai/voice.ts';

const props = defineProps<{ fast: FastPath; createRecognition?: (() => RecognitionLike) | null }>();
const fast = props.fast;
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const drawer = ref(false);
const outcome = computed(() => fast.outcome.value);
const voice = new VoiceInput({ create: props.createRecognition === undefined ? browserRecognition() : props.createRecognition, onText: heard => { text.value = heard; void submit(); } });
const voiceLang = ref(voice.lang);
watch(voiceLang, lang => { voice.lang = lang; saveVoiceLang(lang); });
const listening = computed(() => voice.state.value !== 'idle');
// While talking, the input shows what has been heard so far.
watch(voice.heard, heard => { if (listening.value) text.value = heard; });

const time = computed(() => { const ms = outcome.value?.ms ?? 0; return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`; });
const routeTitle = computed(() => {
  const o = outcome.value; if (!o) return '';
  const via = o.route === 'lexicon' ? 'lexicon (no Jev)' : o.route === 'jev' || o.route === 'jev-target' ? `Jev ${o.jevMs ?? '?'} ms` : '—';
  return `${via}${o.confidence !== undefined && o.route !== 'lexicon' ? ` · ${Math.round(o.confidence * 100)}%` : ''}`;
});

async function submit() {
  const value = text.value.trim();
  if (!value || fast.busy.value) return;
  voice.error.value = '';
  const o = await fast.run(value);
  if (o.status === 'applied') text.value = '';
}

const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ';
/**
 * Hold Space to talk: anywhere except while typing, plus in the empty AI input
 * (so ⌘K then Space works). Not with modifiers: Shift+Space opens the module search.
 */
function talkKey(e: KeyboardEvent): boolean {
  if (!isSpace(e) || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || fast.session.readOnly.value) return false;
  if (typing(e) && !(e.target === input.value && !text.value.trim())) return false;
  e.preventDefault();
  if (!e.repeat && !listening.value) { text.value = ''; voice.start(); }
  return true;
}
function keydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.value?.focus(); input.value?.select(); return; }
  if (e.key === 'Escape' && listening.value) { voice.cancel(); return; }
  talkKey(e);
}
function keyup(e: KeyboardEvent) {
  if (!isSpace(e) || voice.state.value !== 'listening') return;
  e.preventDefault(); // a focused button would otherwise be clicked
  voice.stop();
}
function toggleMic() { if (voice.state.value === 'listening') voice.stop(); else if (!listening.value) { text.value = ''; voice.start(); } }
function inputKey(e: KeyboardEvent) {
  if (talkKey(e)) { e.stopPropagation(); return; }
  if (e.key === 'Escape') { if (listening.value) voice.cancel(); else if (fast.busy.value) fast.cancel(); else input.value?.blur(); }
  if (voice.error.value) voice.error.value = '';
  // Keep editor shortcuts (⌘Z, Delete…) from acting on the patch while typing.
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) e.stopPropagation();
}
const blur = () => voice.cancel();
onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); voice.cancel(); });
const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<template>
  <div class="ai-bar" data-testid="ai-bar">
    <div v-if="drawer" class="drawer" data-testid="ai-drawer">
      <div class="row">
        <label><span>τ (apply at ≥)</span><input v-model.number="fast.settings.tau" type="range" min="0.3" max="0.95" step="0.01" data-testid="ai-tau" /> <b>{{ pct(fast.settings.tau) }}</b></label>
        <label><span>τ Japanese via Jev</span><input v-model.number="fast.settings.tauJa" type="range" min="0.3" max="0.99" step="0.01" /> <b>{{ pct(fast.settings.tauJa) }}</b></label>
        <label><span>Jev time budget</span><input :value="fast.budgetMs" type="range" min="300" max="8000" step="100" data-testid="ai-budget" @input="fast.settings.budgetMs = Number(($event.target as HTMLInputElement).value)" /> <b>{{ fast.budgetMs }} ms</b></label>
        <label><span>Voice language</span><select v-model="voiceLang" data-testid="ai-voice-lang"><option v-for="(name, code) in VOICE_LANGS" :key="code" :value="code">{{ name }}</option></select></label>
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
    <div v-if="voice.error.value && !listening" class="result nothing" data-testid="ai-voice-message">{{ voice.error.value }}</div>
    <div v-else-if="outcome && !listening" class="result" :class="outcome.status" data-testid="ai-result" :data-status="outcome.status">
      <template v-if="outcome.status === 'working'"><span class="spin" /> thinking…</template>
      <template v-else>
        <span v-if="outcome.status === 'applied'" class="label" data-testid="ai-label">{{ outcome.label }}</span>
        <span v-if="outcome.message" class="message" data-testid="ai-message">{{ outcome.message }}</span>
        <span v-if="outcome.note" class="note">{{ outcome.note }}</span>
        <span v-if="outcome.chips.length" class="chips">
          <button v-for="(c, i) in outcome.chips" :key="i" class="chip" data-testid="ai-chip" @click="fast.applyChip(c)">{{ c.label }}</button>
        </span>
        <span class="time" data-testid="ai-time" :title="routeTitle">{{ time }}</span>
      </template>
    </div>
    <form class="bar" :class="{ listening }" @submit.prevent="submit">
      <span class="spark">✦</span>
      <input ref="input" v-model="text" type="text" data-testid="ai-input" :placeholder="listening ? 'Listening… release Space to send' : 'Ask… (⌘K)  ·  hold Space to talk  ·  e.g. 明るく / リリース長く / add reverb'" :readonly="listening" :disabled="fast.session.readOnly.value" maxlength="600" @keydown="inputKey" />
      <span v-if="fast.busy.value" class="spin" />
      <button type="button" class="mic" :class="{ on: listening }" data-testid="ai-mic" :disabled="fast.session.readOnly.value" :title="voice.supported ? 'Hold Space to talk (or click to start / stop)' : 'Voice input needs Chrome'" @click="toggleMic">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
      </button>
      <button type="button" class="gear" title="Fast-path settings and recent requests" data-testid="ai-drawer-toggle" :class="{ active: drawer }" @click="drawer = !drawer">⚙</button>
    </form>
  </div>
</template>

<style scoped>
.ai-bar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(760px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 6px; z-index: 20; pointer-events: none; }
.ai-bar > * { pointer-events: auto; }
.bar { display: flex; align-items: center; gap: 8px; background: #1b1b1b; border: 1px solid #3a3a3a; border-radius: 8px; padding: 6px 8px 6px 12px; box-shadow: 0 8px 28px #000a; }
.bar:focus-within { border-color: var(--accent); }
.bar.listening { border-color: var(--error); }
.bar input { flex: 1; background: transparent; border: 0; outline: none; color: var(--fg); font: inherit; font-size: 14px; padding: 4px 0; }
.spark { color: var(--accent); font-size: 14px; }
.gear, .mic { background: transparent; border: 0; color: var(--muted); font-size: 14px; padding: 2px 6px; display: inline-flex; align-items: center; }
.gear.active, .gear:hover, .mic:hover { color: var(--accent); }
.mic.on { color: var(--error); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; } }
.result { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: #232323ee; border: 1px solid #333; border-left: 3px solid var(--accent-2); border-radius: 6px; padding: 6px 10px; font-size: 12px; box-shadow: 0 6px 20px #0008; }
.result.applied { border-left-color: var(--ok); } .result.chips { border-left-color: var(--warn); } .result.escalate, .result.nothing { border-left-color: var(--muted); }
.label { color: var(--fg); }
.message { color: var(--warn); } .result.nothing .message, .result.escalate .message, .result.nothing { color: var(--muted); }
.note { color: var(--muted); font-style: italic; }
.time { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--warn) !important; background: transparent; color: var(--warn); }
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

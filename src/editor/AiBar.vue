<script setup lang="ts">
// The prompt: the main way to work with den-kit. Type (or hold Space and talk),
// press Enter, and the change is applied at once; ⌘Z takes it back. The last
// few requests stay visible above the input so the next one can build on them.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FastPath, Outcome, PromptAction } from '../ai/fast-path.ts';
import type { LlmController } from '../ai/llm.ts';
import { VoiceInput, VOICE_LANGS, browserRecognition, saveVoiceLang, type RecognitionLike } from '../ai/voice.ts';

const props = defineProps<{ fast: FastPath; llm?: LlmController | null; createRecognition?: (() => RecognitionLike) | null }>();
const fast = props.fast;
const llm = props.llm ?? null;
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const drawer = ref(false);
const voice = new VoiceInput({ create: props.createRecognition === undefined ? browserRecognition() : props.createRecognition, minHoldMs: 150, onText: heard => { void send(heard, 'voice'); } });
const voiceLang = ref(voice.lang);
watch(voiceLang, lang => { voice.lang = lang; saveVoiceLang(lang); });
const listening = computed(() => voice.state.value !== 'idle');
// The last few requests, plus any LLM request still working further up.
const turns = computed(() => {
  const all = fast.history.value;
  const recent = all.slice(-4);
  const older = all.slice(0, -4).filter(o => o.live);
  return [...older, ...recent];
});
const placeholder = computed(() => listening.value ? 'Listening… release Space to send' : 'Ask anything — or hold Space and talk');
const llmReady = computed(() => !!llm && !!fast.session.bridge?.status.value && fast.session.bridge.codexReady);

async function send(value: string, via: 'typed' | 'voice', toLlm = false) {
  const request = value.trim();
  text.value = ''; // the request moves to the history; the prompt is ready for the next one
  voice.error.value = '';
  if (!request) return;
  if (toLlm && llm) llm.run(request, { via });
  else await fast.run(request, { via });
}

// A live clock for requests the LLM is still working on.
const now = ref(performance.now());
let clock: ReturnType<typeof setInterval> | null = null;
watch(() => turns.value.some(o => o.live), live => {
  if (live && !clock) clock = setInterval(() => { now.value = performance.now(); }, 250);
  if (!live && clock) { clearInterval(clock); clock = null; }
}, { immediate: true });
const started = new Map<string, number>();
const elapsed = (o: Outcome) => {
  if (!o.live) { started.delete(o.id); return o.ms; }
  if (!started.has(o.id)) started.set(o.id, now.value - o.ms);
  return Math.max(o.ms, Math.round(now.value - started.get(o.id)!));
};
const time = (o: Outcome) => o.status === 'working' ? '' : fmt(elapsed(o));
const fmt = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
const routeTitle = (o: Outcome) => {
  if (o.route === 'llm') return `LLM (Codex)${o.steps?.length ? `\n${o.steps.join('\n')}` : ''}`;
  const via = o.route === 'lexicon' ? 'lexicon (no Jev)' : o.route === 'jev' || o.route === 'jev-target' ? `Jev ${o.jevMs ?? '?'} ms` : '—';
  return `${via}${o.confidence !== undefined && o.route !== 'lexicon' ? ` · ${Math.round(o.confidence * 100)}%` : ''}`;
};
function act(action: PromptAction, o: Outcome) { if (llm) llm.act(action, o); }

// ---- keys --------------------------------------------------------------------
// Hold Space to talk, anywhere but other text fields. In the prompt a short tap
// still types a space, so talking works the same for every request.
const HOLD_MS = 200;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let spaceHeld = false;
const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ';
const inPrompt = (e: Event) => e.target === input.value;
const inOtherField = (e: Event) => !inPrompt(e) && !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

function keydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); focusPrompt(); return; }
  if (isSpace(e) && !mod && !e.altKey && !e.shiftKey && !inOtherField(e)) {
    e.preventDefault(); // no stray spaces, no scrolling, no clicking a focused button
    if (e.repeat || spaceHeld || listening.value) return;
    spaceHeld = true;
    holdTimer = setTimeout(() => { holdTimer = null; voice.start(); }, HOLD_MS);
    return;
  }
  if (e.key === 'Escape' && listening.value) { voice.cancel(); return; }
  // Esc stops a running LLM request (outside other text fields).
  if (e.key === 'Escape' && !inOtherField(e) && llm?.busy.value) { e.preventDefault(); llm.stop(); return; }
  // Enter anywhere outside a text field jumps to the prompt.
  if (e.key === 'Enter' && !mod && !inPrompt(e) && !inOtherField(e) && !(e.target as HTMLElement | null)?.closest?.('button')) { e.preventDefault(); focusPrompt(); }
}
function keyup(e: KeyboardEvent) {
  if (!isSpace(e) || !spaceHeld) return;
  spaceHeld = false;
  e.preventDefault();
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; if (document.activeElement === input.value) insertSpace(); return; }
  if (voice.state.value === 'listening') voice.stop();
}
function insertSpace() {
  const el = input.value; if (!el) return;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
  el.setRangeText(' ', start, end, 'end');
  text.value = el.value;
}
function promptKey(e: KeyboardEvent) {
  // Enter: the fast path first (it hands over to the LLM when needed); Shift+Enter: straight to the LLM.
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void send(text.value, 'typed', e.shiftKey); }
  else if (e.key === 'Escape') { if (fast.busy.value) fast.cancel(); else if (!llm?.busy.value) input.value?.blur(); }
}
function focusPrompt() { void nextTick(() => { input.value?.focus(); input.value?.select(); }); }
function toggleMic() { if (voice.state.value === 'listening') voice.stop(); else if (!listening.value) voice.start(); }
function lostFocus() { spaceHeld = false; if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } voice.cancel(); }
onMounted(() => { window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', lostFocus); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', lostFocus); lostFocus(); if (clock) clearInterval(clock); });
const pct = (v: number) => `${Math.round(v * 100)}%`;
defineExpose({ focus: focusPrompt });
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
    <ol v-if="turns.length" class="history" data-testid="ai-history">
      <li v-for="(o, i) in turns" :key="o.id" class="turn" :class="[`s-${o.status}`, { latest: i === turns.length - 1, undone: o.undone, llm: o.route === 'llm', live: o.live }]" :data-status="o.status" :data-route="o.route" :data-testid="i === turns.length - 1 ? 'ai-result' : o.route === 'llm' ? 'ai-llm-line' : undefined">
        <span class="ask"><span v-if="o.route === 'llm'" class="via llm-mark" title="answered by the LLM (Codex)">✦</span><span v-if="o.via === 'voice'" class="via" title="spoken">🎙</span>{{ o.text }}</span>
        <span class="answer">
          <template v-if="o.status === 'working'"><span class="spin" /> thinking…</template>
          <template v-else>
            <span v-if="o.live" class="activity" data-testid="ai-activity"><span class="spin" /> {{ o.activity ?? 'thinking…' }}</span>
            <span v-if="o.label && (o.status === 'applied' || o.route === 'llm')" class="label" :data-testid="i === turns.length - 1 ? 'ai-label' : undefined">{{ o.label }}</span>
            <span v-if="o.undone" class="muted"> · undone</span>
            <span v-if="o.message" class="message" :data-testid="i === turns.length - 1 ? 'ai-message' : undefined">{{ o.message }}</span>
            <span v-if="o.fix" class="fix" data-testid="ai-fix">{{ o.fix }}</span>
            <span v-if="o.note" class="note">{{ o.note }}</span>
            <span v-if="o.conflicts?.length" class="conflicts" data-testid="ai-conflicts" :title="o.conflicts.join('\n')">kept your edits: {{ o.conflicts.length === 1 ? o.conflicts[0] : `${o.conflicts.length} changes (hover)` }}</span>
            <span v-if="o.steps?.length && (o.live || i === turns.length - 1)" class="steps" data-testid="ai-steps">{{ (o.live ? o.steps.slice(-3) : o.steps.slice(-4)).join('  ·  ') }}</span>
            <span v-if="o.reply" class="reply" data-testid="ai-reply">{{ o.reply }}</span>
            <span v-if="o.chips.length || o.actions?.length" class="chips">
              <button v-for="(c, k) in o.chips" :key="k" class="chip" data-testid="ai-chip" @click="fast.applyChip(c, o)">{{ c.label }}</button>
              <button v-for="(a, k) in o.actions ?? []" :key="`a${k}`" class="chip" :class="`act-${a.kind}`" data-testid="ai-action" :data-kind="a.kind" @click="act(a, o)">{{ a.label }}</button>
            </span>
          </template>
        </span>
        <span class="time" :data-testid="i === turns.length - 1 ? 'ai-time' : undefined" :title="routeTitle(o)">{{ time(o) }}</span>
      </li>
    </ol>
    <div v-if="voice.error.value && !listening" class="voice-error" data-testid="ai-voice-message">{{ voice.error.value }}</div>
    <form class="prompt" :class="{ listening }" @submit.prevent>
      <span class="spark">✦</span>
      <input ref="input" :value="listening ? voice.heard.value : text" type="text" data-testid="ai-input" :placeholder="placeholder" :readonly="listening" maxlength="600" autocomplete="off" spellcheck="false" @input="text = ($event.target as HTMLInputElement).value" @keydown="promptKey" />
      <span v-if="fast.busy.value" class="spin" />
      <span v-if="llmReady && !listening" class="hint" title="Shift+Enter sends straight to the LLM; Esc stops it">⇧↵ LLM</span>
      <button type="button" class="mic" :class="{ on: listening }" data-testid="ai-mic" :title="voice.supported ? 'Hold Space to talk (or click to start / stop)' : 'Voice input needs Chrome'" @click="toggleMic">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
      </button>
      <button type="button" class="gear" title="Fast-path settings and recent requests" data-testid="ai-drawer-toggle" :class="{ active: drawer }" @click="drawer = !drawer">⚙</button>
    </form>
  </div>
</template>

<style scoped>
.ai-bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(920px, calc(100% - 48px)); display: flex; flex-direction: column; gap: 8px; z-index: 20; pointer-events: none; }
.ai-bar > * { pointer-events: auto; }
.prompt { display: flex; align-items: center; gap: 10px; background: #1d1d1d; border: 1px solid #444; border-radius: 12px; padding: 8px 10px 8px 16px; box-shadow: 0 12px 40px #000c; }
.prompt:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px #ff9c1a26, 0 12px 40px #000c; }
.prompt.listening { border-color: var(--error); box-shadow: 0 0 0 3px #ff3a5c33, 0 12px 40px #000c; }
.prompt input { flex: 1; background: transparent; border: 0; outline: none; color: #f2f2f2; font: inherit; font-size: 18px; line-height: 1.4; padding: 6px 0; min-width: 0; }
.prompt input::placeholder { color: #777; }
.spark { color: var(--accent); font-size: 18px; }
.gear, .mic { background: transparent; border: 0; color: #8a8a8a; padding: 4px 6px; display: inline-flex; align-items: center; box-shadow: none; }
.gear { font-size: 14px; }
.gear.active, .gear:hover, .mic:hover { color: var(--accent); }
.mic.on { color: var(--error); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; } }
.history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.turn { display: grid; grid-template-columns: minmax(80px, 30%) 1fr auto; gap: 12px; align-items: baseline; background: #222222e6; border: 1px solid #333; border-left: 3px solid #555; border-radius: 6px; padding: 6px 10px; font-size: 12.5px; opacity: .55; }
.turn.latest { opacity: 1; font-size: 13.5px; padding: 8px 12px; }
.turn.s-applied { border-left-color: var(--ok); } .turn.s-chips { border-left-color: var(--warn); } .turn.s-working, .turn.s-thinking { border-left-color: var(--accent); }
.turn.s-failed { border-left-color: var(--error); } .turn.s-stopped, .turn.s-merged, .turn.s-reply { border-left-color: #6a6a6a; }
.turn.live { opacity: 1; }
.llm-mark { color: var(--accent); }
.activity { color: var(--accent); display: inline-flex; gap: 6px; align-items: center; }
.steps { flex-basis: 100%; color: var(--muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply { flex-basis: 100%; color: #d8d8d8; white-space: pre-wrap; overflow-wrap: anywhere; }
.turn:not(.latest) .reply { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.turn.latest .reply { max-height: 7.5em; overflow: auto; }
.fix { color: #cfcfcf; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.conflicts { color: var(--warn); font-size: 12px; }
.turn.s-failed .message { color: var(--error); }
.chip.act-stop { border-color: #666 !important; color: #aaa; } .chip.act-stop:hover { background: #666; color: #fff; }
.hint { color: #6f6f6f; font-size: 11px; white-space: nowrap; }
.turn.undone .label { text-decoration: line-through; color: var(--muted); }
.ask { color: #9a9a9a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.via { margin-right: 4px; font-size: 11px; }
.answer { color: var(--fg); min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.message { color: var(--warn); } .turn.s-nothing .message, .turn.s-escalate .message { color: var(--muted); }
.note { color: var(--muted); font-style: italic; }
.time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 11.5px; }
.chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 2px 10px; border-radius: 12px; border: 1px solid var(--warn) !important; background: transparent; color: var(--warn); }
.chip:hover { background: var(--warn); color: #1a1a1a; }
.voice-error { background: #222222e6; border: 1px solid #333; border-left: 3px solid var(--warn); border-radius: 6px; padding: 7px 12px; font-size: 13px; color: #cfcfcf; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin .7s linear infinite; display: inline-block; }
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

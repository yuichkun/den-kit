<script setup lang="ts">
// The AI panel: a full-height column on the right, next to (never over) the
// patch or the plugin. Type (or hold Space and talk), press Enter: the fast path
// applies at once, anything it is not sure about goes to the LLM, which edits
// the patch step by step while the line below shows what it does. Nothing here
// asks you to choose; ⌘Z takes a request back, Esc stops the LLM. What is
// selected rides along with the request (the chips above the prompt; × or
// Backspace in an empty prompt leaves one out). The lines are the conversation
// about this patch; a patch opened before keeps its own, folded.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FastPath, Outcome } from '../ai/fast-path.ts';
import { attachmentsOf, type Attachment } from '../ai/attachments.ts';
import type { LlmController } from '../ai/llm.ts';
import { VoiceInput, VOICE_LANGS, browserRecognition, saveVoiceLang, type RecognitionLike } from '../ai/voice.ts';
import AiStatus from './AiStatus.vue';
import { offerEnter } from './keys.ts';

const props = defineProps<{ fast: FastPath; llm?: LlmController | null; createRecognition?: (() => RecognitionLike) | null; /** The view next to the panel (a request that changed the screen offers to show the plugin). */ view?: string }>();
const emit = defineEmits<{ (e: 'request'): void; (e: 'leave'): void; (e: 'close'): void; (e: 'show-plugin'): void }>();
const fast = props.fast;
const llm = props.llm ?? null;
const text = ref('');
const input = ref<HTMLTextAreaElement | null>(null);
const list = ref<HTMLElement | null>(null);
const drawer = ref(false);
const voice = new VoiceInput({ create: props.createRecognition === undefined ? browserRecognition() : props.createRecognition, minHoldMs: 150, onText: heard => { void send(heard, 'voice'); } });
const voiceLang = ref(voice.lang);
watch(voiceLang, lang => { voice.lang = lang; saveVoiceLang(lang); });
const listening = computed(() => voice.state.value !== 'idle');
const turns = computed(() => fast.history.value);
const latestId = computed(() => turns.value.at(-1)?.id);
const showEarlier = ref(false);
// ---- attachments: the selection, minus what was left out for this request ----
const session = fast.session;
const leftOut = ref<string[]>([]);
watch(() => [session.selection.value, session.edgeSelection.value], () => { leftOut.value = []; });
const attachments = computed<Attachment[]>(() => attachmentsOf(session.doc.value, session.catalog, session.selection.value, session.edgeSelection.value).filter(a => !leftOut.value.includes(a.id)));
function leaveOut(id: string) { leftOut.value = [...leftOut.value, id]; }
const CHIPS = 6;
const allChips = ref(false);
watch(() => attachments.value.length <= CHIPS, few => { if (few) allChips.value = false; });
const shownChips = computed(() => allChips.value ? attachments.value : attachments.value.slice(0, CHIPS));
const KIND_ICON: Record<Attachment['kind'], string> = { module: '▣', control: '◉', element: '◇', cable: '⌇' };
const placeholder = computed(() => listening.value ? 'Listening… release Space to send' : 'Ask anything — or hold Space and talk');
const llmReady = computed(() => !!llm && !!fast.session.bridge?.status.value && fast.session.bridge.codexReady);

async function send(value: string, via: 'typed' | 'voice', toLlm = false) {
  const request = value.trim();
  text.value = ''; // the request moves to the history; the prompt is ready for the next one
  voice.error.value = '';
  resize();
  if (!request) return;
  emit('request');
  const attached = attachments.value.length ? attachments.value.map(a => ({ ...a })) : undefined;
  leftOut.value = []; // left out of that request only
  if (toLlm && llm) llm.run(request, { via, attached });
  else await fast.run(request, { via, attached: attached ?? [] });
}

// Keep the newest line in view while it changes (unless the user scrolled up to read).
let pinned = true;
function onScroll() { const el = list.value; if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }
watch(turns, async () => { if (!pinned) return; await nextTick(); const el = list.value; if (el) el.scrollTop = el.scrollHeight; }, { deep: false });

// A live clock for requests that are still running.
const now = ref(performance.now());
let clock: ReturnType<typeof setInterval> | null = null;
watch(() => turns.value.some(o => o.live || o.status === 'working'), live => {
  if (live && !clock) clock = setInterval(() => { now.value = performance.now(); }, 250);
  if (!live && clock) { clearInterval(clock); clock = null; }
}, { immediate: true });
const started = new Map<string, number>();
const elapsed = (o: Outcome) => {
  if (!o.live) { started.delete(o.id); return o.ms; }
  if (!started.has(o.id)) started.set(o.id, now.value - o.ms);
  return Math.max(o.ms, Math.round(now.value - started.get(o.id)!));
};
const fmt = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
const via = (o: Outcome) => o.route === 'llm' ? 'LLM' : o.route === 'lexicon' ? 'instant' : o.route === 'jev' || o.route === 'jev-target' ? 'Jev' : '';
const meta = (o: Outcome) => o.status === 'working' ? '' : [via(o), fmt(elapsed(o))].filter(Boolean).join(' · ');
const routeTitle = (o: Outcome) => {
  if (o.route === 'llm') return 'Answered by the LLM (Codex)';
  const how = o.route === 'lexicon' ? 'built-in phrases (no Jev)' : o.route === 'jev' || o.route === 'jev-target' ? `Jev ${o.jevMs ?? '?'} ms` : '';
  return `${how}${o.confidence !== undefined && o.route !== 'lexicon' ? ` · ${Math.round(o.confidence * 100)}%` : ''}`;
};

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
  if (document.querySelector('[data-testid=start-screen]')) return; // the start screen has the keys
  if (e.isComposing || e.keyCode === 229) return; // Japanese input: Space converts, Enter confirms
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.code === 'KeyK') { e.preventDefault(); focus(); return; }
  if (isSpace(e) && !mod && !e.altKey && !e.shiftKey && !inOtherField(e)) {
    e.preventDefault(); // no stray spaces, no scrolling, no clicking a focused button
    if (e.repeat || spaceHeld || listening.value) return;
    spaceHeld = true;
    holdTimer = setTimeout(() => { holdTimer = null; emit('request'); voice.start(); }, HOLD_MS);
    return;
  }
  if (e.key === 'Escape' && listening.value) { e.preventDefault(); voice.cancel(); return; }
  // Esc stops a running LLM request (outside other text fields).
  if (e.key === 'Escape' && !inOtherField(e) && llm?.busy.value) { e.preventDefault(); llm.stop(); return; }
  // Enter anywhere outside a text field jumps to the prompt, unless a view claims it (Enter on a selected text or canvas opens it).
  if (e.key === 'Enter' && !mod && !e.defaultPrevented && !inPrompt(e) && !inOtherField(e) && !(e.target as HTMLElement | null)?.closest?.('button')) { if (offerEnter(e)) return; e.preventDefault(); focus(); }
}
function keyup(e: KeyboardEvent) {
  if (!isSpace(e) || !spaceHeld || e.isComposing) return;
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
  else if (e.key === 'Backspace' && !e.isComposing && !text.value && attachments.value.length) { e.preventDefault(); leaveOut(attachments.value.at(-1)!.id); }
  else if (e.key === 'Escape' && !e.isComposing) {
    if (fast.busy.value) { fast.cancel(); return; }
    if (llm?.busy.value) return; // the window handler stops it
    e.preventDefault();
    input.value?.blur();
    emit('leave'); // back to the patch or the plugin, keys work there again
  }
}
/** The prompt grows with what is typed (up to six lines). */
function resize() { void nextTick(() => { const el = input.value; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 6 * 26 + 16)}px`; }); }
function focus() { emit('request'); void nextTick(() => { input.value?.focus(); input.value?.select(); }); }
function toggleMic() { if (voice.state.value === 'listening') voice.stop(); else if (!listening.value) { emit('request'); voice.start(); } }
function lostFocus() { spaceHeld = false; if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } voice.cancel(); }
onMounted(() => { window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', lostFocus); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', lostFocus); lostFocus(); if (clock) clearInterval(clock); });
const pct = (v: number) => `${Math.round(v * 100)}%`;
defineExpose({ focus });
</script>

<template>
  <aside class="ai-panel" data-testid="ai-panel">
    <header>
      <span class="title"><span class="spark">✦</span> AI</span>
      <AiStatus v-if="fast.session.bridge" :bridge="fast.session.bridge" />
      <span class="grow" />
      <button type="button" class="icon" title="Fast-path settings and recent requests" data-testid="ai-drawer-toggle" :class="{ active: drawer }" @click="drawer = !drawer">⚙</button>
      <button type="button" class="icon" title="Hide the AI panel (⌘J)" data-testid="ai-close" @click="emit('close')">⟩</button>
    </header>
    <div v-if="drawer" class="drawer" data-testid="ai-drawer">
      <div class="row">
        <label><span>τ (apply at ≥)</span><input v-model.number="fast.settings.tau" type="range" min="0.3" max="0.95" step="0.01" data-testid="ai-tau" /> <b>{{ pct(fast.settings.tau) }}</b></label>
        <label><span>τ Japanese via Jev</span><input v-model.number="fast.settings.tauJa" type="range" min="0.3" max="0.99" step="0.01" /> <b>{{ pct(fast.settings.tauJa) }}</b></label>
        <label><span>Jev time budget</span><input :value="fast.budgetMs" type="range" min="300" max="8000" step="100" data-testid="ai-budget" @input="fast.settings.budgetMs = Number(($event.target as HTMLInputElement).value)" /> <b>{{ fast.budgetMs }} ms</b></label>
        <label><span>Voice language</span><select v-model="voiceLang" data-testid="ai-voice-lang"><option v-for="(name, code) in VOICE_LANGS" :key="code" :value="code">{{ name }}</option></select></label>
        <label class="check"><input v-model="fast.settings.useJev" type="checkbox" data-testid="ai-use-jev" /> use Jev (off: built-in phrases only)</label>
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
    <ol ref="list" class="history" data-testid="ai-history" @scroll="onScroll">
      <li v-if="!turns.length" class="empty" data-testid="ai-empty">
        <p>Say what you want, in your words.</p>
        <p class="examples">“brighter” · “リリース長く” · “add reverb” · “ベース作って” · “wobble the cutoff” · “write a bitcrusher”</p>
        <dl class="keys">
          <dt><kbd>Enter</kbd></dt><dd>type a request</dd>
          <dt><kbd>Space</kbd></dt><dd>hold and talk</dd>
          <dt><kbd>Esc</kbd></dt><dd>stop the LLM · back to the canvas</dd>
          <dt><kbd>⌘Z</kbd></dt><dd>take a request back</dd>
          <dt><kbd>⌘J</kbd></dt><dd>hide or show this panel</dd>
          <dt><kbd>⌥⌘E</kbd></dt><dd>patch ⇄ plugin</dd>
        </dl>
      </li>
      <li v-if="fast.earlier.value.length" class="earlier" data-testid="ai-earlier">
        <button type="button" class="link" @click="showEarlier = !showEarlier">{{ showEarlier ? '▾' : '▸' }} Earlier, about another patch: {{ fast.earlier.value.length }} request{{ fast.earlier.value.length === 1 ? '' : 's' }} (the AI does not see these)</button>
        <ol v-if="showEarlier" class="earlier-lines"><li v-for="o in fast.earlier.value" :key="o.id"><span class="ask-old">{{ o.text }}</span> → {{ o.label ?? o.message ?? o.status }}</li></ol>
      </li>
      <li v-for="o in turns" :key="o.id" class="turn" :class="[`s-${o.status}`, { latest: o.id === latestId, undone: o.undone, llm: o.route === 'llm', live: o.live }]" :data-status="o.status" :data-route="o.route" :data-testid="o.id === latestId ? 'ai-result' : o.route === 'llm' ? 'ai-llm-line' : undefined">
        <div class="ask"><span v-if="o.via === 'voice'" class="via" title="spoken">🎙</span>{{ o.text }}<span v-if="o.repeats" class="again" title="Did the last change again"> · again: “{{ o.repeats }}”</span></div>
        <div v-if="o.attached?.length" class="attached" data-testid="ai-attached"><span v-for="a in o.attached" :key="a.id" class="chip small" :title="a.id">{{ KIND_ICON[a.kind] ?? '▣' }} {{ a.label }}</span></div>
        <div class="answer">
          <div v-if="o.status === 'working'" class="activity"><span class="spin" /> thinking…</div>
          <template v-else>
            <div v-if="o.live" class="activity" data-testid="ai-activity"><span class="spin" /> {{ o.activity ?? 'thinking…' }}</div>
            <div v-if="o.label && (o.status === 'applied' || o.route === 'llm')" class="label" :data-testid="o.id === latestId ? 'ai-label' : undefined">{{ o.label }}<span v-if="o.undone" class="undone-mark"> · undone</span></div>
            <div v-if="o.message" class="message" :data-testid="o.id === latestId ? 'ai-message' : undefined">{{ o.message }}</div>
            <div v-if="o.fix" class="fix" data-testid="ai-fix">{{ o.fix }}</div>
            <div v-if="o.note" class="note">{{ o.note }}</div>
            <button v-if="o.screen && !o.undone && view !== 'plugin' && o.id === latestId" type="button" class="show" data-testid="ai-show-plugin" title="The request changed the plugin screen (⌥⌘E switches)" @click="emit('show-plugin')">Show the plugin <kbd>⌥⌘E</kbd></button>
            <ul v-if="o.steps?.length && (o.live || o.id === latestId)" class="steps" data-testid="ai-steps"><li v-for="(s, k) in o.steps" :key="k">{{ s }}</li></ul>
            <div v-if="o.reply && o.reply.trim() !== (o.message ?? '').trim()" class="reply" data-testid="ai-reply">{{ o.reply }}</div>
          </template>
        </div>
        <div class="meta">
          <span class="time" :data-testid="o.id === latestId ? 'ai-time' : undefined" :title="routeTitle(o)">{{ meta(o) }}</span>
          <button v-if="o.live && llm?.busy.value" type="button" class="stop" data-testid="ai-stop" title="Stop (Esc)" @click="llm.stop()">Stop <kbd>Esc</kbd></button>
        </div>
      </li>
    </ol>
    <div v-if="voice.error.value && !listening" class="voice-error" data-testid="ai-voice-message">{{ voice.error.value }}</div>
    <form class="prompt" :class="{ listening }" @submit.prevent>
      <div v-if="attachments.length" class="chips" data-testid="ai-attachments" title="What you selected comes with the request">
        <span v-for="a in shownChips" :key="a.id" class="chip" :data-attachment="a.id">{{ KIND_ICON[a.kind] }} {{ a.label }}<button type="button" class="x" :title="`Leave ${a.id} out of this request`" @click="leaveOut(a.id)">×</button></span>
        <button v-if="attachments.length > CHIPS && !allChips" type="button" class="chip more" data-testid="ai-attachments-more" @click="allChips = true">+{{ attachments.length - CHIPS }} more</button>
      </div>
      <textarea ref="input" :value="listening ? voice.heard.value : text" rows="1" data-testid="ai-input" :placeholder="placeholder" :readonly="listening" maxlength="600" autocomplete="off" spellcheck="false" @input="text = ($event.target as HTMLTextAreaElement).value; resize()" @keydown="promptKey" />
      <div class="prompt-foot">
        <span v-if="fast.busy.value" class="spin" />
        <span class="hint">{{ listening ? 'release Space to send' : `Enter send${llmReady ? ' · ⇧Enter LLM' : ''}` }}</span>
        <span class="grow" />
        <button type="button" class="icon mic" :class="{ on: listening }" data-testid="ai-mic" :title="voice.supported ? 'Hold Space to talk (or click to start / stop)' : 'Voice input needs Chrome'" @click="toggleMic">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
        </button>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.ai-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: #1b1b1b; border-left: 1px solid #000; font-size: 15px; line-height: 1.45; color: #e2e2e2; }
header { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; border-bottom: 1px solid #000; background: #232323; }
.title { font-weight: 700; letter-spacing: .06em; color: #f0f0f0; font-size: 14px; }
.spark { color: var(--accent); }
.grow { flex: 1; }
.icon { background: transparent; border: 0; color: #8a8a8a; padding: 4px 6px; display: inline-flex; align-items: center; box-shadow: none; font-size: 15px; }
.icon.active, .icon:hover { color: var(--accent); background: transparent !important; }
.history { list-style: none; margin: 0; padding: 12px 14px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.empty { color: #b8b8b8; font-size: 15px; }
.empty p { margin: 0 0 8px; }
.empty .examples { color: #8e8e8e; font-size: 14px; }
.keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 18px 0 0; font-size: 14px; color: #a0a0a0; }
.keys dt { text-align: right; } .keys dd { margin: 0; }
kbd { display: inline-block; min-width: 18px; padding: 0 6px; border: 1px solid #555; border-bottom-width: 2px; border-radius: 4px; background: #262626; color: #eee; font: 12px/1.6 Lato, system-ui, sans-serif; }
.turn { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; background: #222; border-left: 3px solid #4a4a4a; opacity: .8; }
.turn.latest, .turn.live { opacity: 1; background: #262626; }
.turn.s-applied { border-left-color: var(--ok); } .turn.s-working, .turn.s-thinking { border-left-color: var(--accent); }
.turn.s-failed { border-left-color: var(--error); } .turn.s-stopped, .turn.s-merged, .turn.s-reply, .turn.s-nothing { border-left-color: #6a6a6a; }
.ask { color: #f4f4f4; font-size: 16px; overflow-wrap: anywhere; }
.via { margin-right: 6px; font-size: 13px; }
.answer { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.activity { color: var(--accent); display: inline-flex; gap: 8px; align-items: center; }
.label { color: #9ee6cf; overflow-wrap: anywhere; }
.turn.undone .label { color: var(--muted); }
.undone-mark { color: var(--muted); }
.message { color: #ffd98a; overflow-wrap: anywhere; }
.turn.s-failed .message { color: #ff8da0; }
.turn.s-merged .message, .turn.s-reply .message { color: #b8b8b8; }
.fix { color: #e0e0e0; font-family: ui-monospace, Menlo, monospace; font-size: 13.5px; overflow-wrap: anywhere; }
.note { color: #a8a8a8; font-size: 14px; }
.show { margin-top: 4px; padding: 2px 8px; font-size: 12px; }
.steps { list-style: none; margin: 2px 0 0; padding: 0 0 0 10px; border-left: 1px solid #3a3a3a; color: #a5a5a5; font-size: 13.5px; display: flex; flex-direction: column; gap: 2px; }
.steps li { overflow-wrap: anywhere; }
.reply { color: #dcdcdc; white-space: pre-wrap; overflow-wrap: anywhere; }
.turn:not(.latest):not(.live) .reply { max-height: 4.4em; overflow: hidden; }
.meta { display: flex; align-items: center; gap: 10px; }
.time { color: #8c8c8c; font-variant-numeric: tabular-nums; font-size: 13px; }
.stop { margin-left: auto; font-size: 13px; padding: 2px 8px; background: #333; }
.stop kbd { font-size: 11px; margin-left: 4px; }
.voice-error { margin: 0 14px 8px; border-left: 3px solid var(--warn); border-radius: 6px; padding: 8px 12px; font-size: 14px; color: #d6d6d6; background: #262626; }
.prompt { margin: 0 12px 12px; display: flex; flex-direction: column; gap: 4px; background: #121212; border: 1px solid #444; border-radius: 10px; padding: 10px 12px 6px; }
.prompt:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px #ff9c1a26; }
.prompt.listening { border-color: var(--error); box-shadow: 0 0 0 3px #ff3a5c33; }
.prompt textarea { resize: none; background: transparent; border: 0; outline: none; color: #f4f4f4; font: inherit; font-size: 17px; line-height: 26px; padding: 0; min-height: 26px; overflow-y: auto; }
.prompt textarea::placeholder { color: #7a7a7a; }
.prompt-foot { display: flex; align-items: center; gap: 8px; }
.hint { color: #7c7c7c; font-size: 12.5px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
.chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 4px 1px 8px; border-radius: 10px; background: #2b3b45; color: #cde8f6; font-size: 12.5px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip.small { padding: 0 8px; background: #263038; color: #a9c6d6; font-size: 12px; }
.chip.more { border: 0; padding: 1px 8px; box-shadow: none; cursor: pointer; }
.chip .x { border: 0; background: transparent; color: #9db7c4; padding: 0 4px; font-size: 14px; line-height: 1; box-shadow: none; }
.chip .x:hover { color: #fff; background: transparent !important; }
.attached { display: flex; flex-wrap: wrap; gap: 4px; }
.again { color: #9a9a9a; font-size: 13px; }
.earlier { color: #8a8a8a; font-size: 13px; }
.earlier .link { border: 0; background: transparent; color: #8a8a8a; padding: 0; box-shadow: none; text-align: left; font-size: 13px; }
.earlier .link:hover { color: #cfcfcf; background: transparent !important; }
.earlier-lines { list-style: none; margin: 6px 0 0; padding: 0 0 0 12px; border-left: 1px solid #333; display: flex; flex-direction: column; gap: 3px; }
.ask-old { color: #b0b0b0; }
.mic.on { color: var(--error); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; } }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin .7s linear infinite; display: inline-block; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.drawer { border-bottom: 1px solid #000; background: #202020; padding: 10px 14px; font-size: 12px; max-height: 40%; overflow: auto; }
.drawer .row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.drawer label { display: flex; width: 100%; align-items: center; gap: 8px; color: var(--muted); }
.drawer label > span { flex: 0 0 120px; }
.drawer input[type=range] { flex: 1 1 auto; width: auto; min-width: 60px; }
.drawer b { flex: 0 0 56px; color: var(--fg); font-weight: 400; font-variant-numeric: tabular-nums; text-align: right; }
.traces { width: 100%; border-collapse: collapse; }
.traces th { text-align: left; color: var(--muted); font-weight: 400; border-bottom: 1px solid #333; padding: 2px 6px; }
.traces td { padding: 2px 6px; border-bottom: 1px solid #262626; vertical-align: top; font-variant-numeric: tabular-nums; }
.traces .req { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

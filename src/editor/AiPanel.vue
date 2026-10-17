<script setup lang="ts">
// The AI panel: a full-height column on the right, next to (never over) the
// patch or the plugin. Press Enter to send a request to the LLM, which edits
// the patch step by step while the line below shows what it does. Nothing here
// asks you to choose; ⌘Z takes a request back, Esc stops the LLM. What is
// selected rides along with the request (the chips above the prompt; × or
// Backspace in an empty prompt leaves one out). ✎ (or P) picks up the pen to
// sketch over the patch or the plugin; the marks go with the next request, in
// words and as a picture (the chip above the prompt; × rubs them out). The lines
// are the conversation about this patch; a patch opened before keeps its own, folded.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AgentLane, AiRequests, Outcome } from '../ai/requests.ts';
import { attachmentsOf, type Attachment } from '../ai/attachments.ts';
import type { LlmController } from '../ai/llm.ts';
import { desktop } from '../desktop/api.ts';
import AiStatus from './AiStatus.vue';
import { offerEnter } from './keys.ts';
import { sketchSummary, type SketchView } from '../ai/sketch.ts';
import { takeSketch } from './sketch-send.ts';

const props = defineProps<{ requests: AiRequests; llm?: LlmController | null; /** The view next to the panel (a request that changed the screen offers to show the plugin). */ view?: string }>();
const emit = defineEmits<{ (e: 'request'): void; (e: 'leave'): void; (e: 'close'): void; (e: 'show-plugin'): void }>();
const requests = props.requests;
const llm = props.llm ?? null;
const isDesktop = !!desktop();
const text = ref('');
const input = ref<HTMLTextAreaElement | null>(null);
const list = ref<HTMLElement | null>(null);
const drawer = ref(false);
const turns = computed(() => requests.history.value);
const latestId = computed(() => turns.value.at(-1)?.id);
const showEarlier = ref(false);
// ---- attachments: the selection, minus what was left out for this request ----
const session = requests.session;
const leftOut = ref<string[]>([]);
watch(() => [session.selection.value, session.edgeSelection.value], () => { leftOut.value = []; });
const attachments = computed<Attachment[]>(() => attachmentsOf(session.doc.value, session.catalog, session.selection.value, session.edgeSelection.value).filter(a => !leftOut.value.includes(a.id)));
function leaveOut(id: string) { leftOut.value = [...leftOut.value, id]; }
const CHIPS = 6;
const allChips = ref(false);
watch(() => attachments.value.length <= CHIPS, few => { if (few) allChips.value = false; });
const shownChips = computed(() => allChips.value ? attachments.value : attachments.value.slice(0, CHIPS));
const KIND_ICON: Record<Attachment['kind'], string> = { module: '▣', control: '◉', element: '◇', cable: '⌇' };
// ---- letting the AI see the screen (U8b) ----
const screen = session.screen;
const screenOn = computed(() => screen.state.value === 'on');
const screenTitle = computed(() => screen.state.value === 'unsupported' ? screen.message.value : isDesktop ? screenOn.value ? 'AI can see the den-kit window. Click to stop sharing.' : 'Let AI see the den-kit window.' : screenOn.value ? 'The AI can see this tab as you see it when it looks (click to stop sharing)' : 'Let the AI see the screen as you see it (the browser asks to share this tab)');
async function toggleScreen() { if (screenOn.value) screen.stop(); else await screen.start(); }
// ---- the sketch (U8c) ----
/** The view the pen draws on: the one the person looks at, when it is the patch or the plugin. */
const inkView = computed<SketchView | null>(() => session.seeing.value.view === 'plugin' || session.seeing.value.view === 'patch' ? session.seeing.value.view : null);
const inking = computed(() => !!session.inking.value);
function togglePen() { session.inking.value = session.inking.value || !inkView.value ? null : 'pen'; }
/** New marks (not sent yet), per view: they go with the next request. */
const sketchParts = computed(() => (['plugin', 'patch'] as const).map(view => ({ view, marks: session.unsentMarks(view).length })).filter(p => p.marks > 0));
function dropSketch() { for (const view of ['plugin', 'patch'] as const) session.clearSketch(view, true); }
/** Said for the person when they send only a sketch. */
const SKETCH_REQUEST = 'Do what my sketch shows.';
const preparing = ref(false);

async function send(value: string) {
  const request = value.trim();
  text.value = ''; // the request moves to the history; the prompt is ready for the next one
  resize();
  const sketched = sketchParts.value.length > 0;
  if (!request && !sketched) return;
  emit('request');
  let attached = attachments.value.length ? attachments.value.map(a => ({ ...a })) : undefined;
  leftOut.value = []; // left out of that request only
  const taken = sketched ? await sketchNow() : null;
  if (!taken) {
    if (!request) return;
    requests.run(request, { via: 'typed', attached });
    return;
  }
  const words = request || SKETCH_REQUEST;
  // Things the marks are about ride along like a selection.
  const along = (ids: readonly string[]) => {
    const more = attachmentsOf(session.doc.value, session.catalog, ids).filter(a => !attached?.some(b => b.id === a.id));
    attached = [...(attached ?? []), ...more];
    return attached;
  };
  requests.run(words, { via: 'typed', attached: along(taken.pointing ?? taken.about), sketch: taken.sketch });
}
/** The marks, read and drawn for the AI; the pen goes down (they went with the request). */
async function sketchNow() {
  session.inking.value = null;
  preparing.value = true;
  try { return await takeSketch(session, { pictures: !!session.bridge?.status.value?.codex.images }); }
  finally { preparing.value = false; }
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
const tokensShort = (n: number) => n >= 10_000 ? `${Math.round(n / 1000)}k tokens` : n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
// A member's lane keeps its own clock while it works.
const laneStarted = new Map<string, number>();
const laneElapsed = (o: Outcome, a: AgentLane) => {
  const key = `${o.id}:${a.id}`;
  if (a.status !== 'working' || !o.live) { laneStarted.delete(key); return a.ms; }
  if (!laneStarted.has(key)) laneStarted.set(key, now.value - a.ms);
  return Math.max(a.ms, Math.round(now.value - laneStarted.get(key)!));
};
const LANE_STATUS: Record<AgentLane['status'], string> = { working: 'working', done: 'done', failed: 'failed', stopped: 'stopped' };
const via = (o: Outcome) => o.route === 'llm' ? 'LLM' : '';
const meta = (o: Outcome) => o.status === 'working' ? '' : [isDesktop ? '' : via(o), fmt(elapsed(o)), o.agents?.length ? `${o.agents.length} ${isDesktop ? 'task' : 'member'}${o.agents.length === 1 ? '' : 's'}` : '', !isDesktop && o.tokens ? tokensShort(o.tokens) : ''].filter(Boolean).join(' · ');
const routeTitle = (o: Outcome) => isDesktop ? 'Request duration' : o.route === 'llm' ? 'Answered by the LLM (Codex)' : 'Saved request from an earlier version';

// ---- keys --------------------------------------------------------------------
const inPrompt = (e: Event) => e.target === input.value;
const inOtherField = (e: Event) => !inPrompt(e) && !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

function keydown(e: KeyboardEvent) {
  if (document.querySelector('[data-testid=start-screen]')) return; // the start screen has the keys
  if (e.isComposing || e.keyCode === 229) return; // Japanese input: Space converts, Enter confirms
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.code === 'KeyK') { e.preventDefault(); focus(); return; }
  // Drawing: Esc puts the pen down (before anything else it would do); ⌘Z takes back the last mark, not an edit.
  if (session.inking.value && !inOtherField(e)) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); session.inking.value = null; return; }
    if (mod && !e.altKey && e.code === 'KeyZ' && !inPrompt(e) && inkView.value) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.shiftKey) session.undoMark(inkView.value); return; }
  }
  // P picks up the pen over the patch or the plugin (or puts it down).
  if (e.code === 'KeyP' && !mod && !e.altKey && !e.shiftKey && !e.repeat && !inPrompt(e) && !inOtherField(e) && (inking.value || inkView.value)) { e.preventDefault(); togglePen(); return; }
  // Esc stops a running LLM request (outside other text fields).
  if (e.key === 'Escape' && !inOtherField(e) && llm?.busy.value) { e.preventDefault(); llm.stop(); return; }
  // Enter anywhere outside a text field jumps to the prompt, unless a view claims it (Enter on a selected text or canvas opens it).
  if (e.key === 'Enter' && !mod && !e.defaultPrevented && !inPrompt(e) && !inOtherField(e) && !(e.target as HTMLElement | null)?.closest?.('button')) { if (offerEnter(e)) return; e.preventDefault(); focus(); }
}
function promptKey(e: KeyboardEvent) {
  // Every request, including short parameter changes, goes to the same LLM.
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void send(text.value); }
  else if (e.key === 'Backspace' && !e.isComposing && !text.value && attachments.value.length) { e.preventDefault(); leaveOut(attachments.value.at(-1)!.id); }
  else if (e.key === 'Escape' && !e.isComposing) {
    if (llm?.busy.value) return; // the window handler stops it
    e.preventDefault();
    input.value?.blur();
    emit('leave'); // back to the patch or the plugin, keys work there again
  }
}
/** The prompt grows with what is typed (up to six lines). */
function resize() { void nextTick(() => { const el = input.value; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 6 * 26 + 16)}px`; }); }
function focus() { emit('request'); void nextTick(() => { input.value?.focus(); input.value?.select(); }); }
onMounted(() => { window.addEventListener('keydown', keydown, true); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown, true); if (clock) clearInterval(clock); });
defineExpose({ focus });
</script>

<template>
  <aside class="ai-panel" data-testid="ai-panel" aria-label="AI">
    <header>
      <AiStatus v-if="requests.session.bridge" :bridge="requests.session.bridge" />
      <span class="grow" />
      <button type="button" class="icon pen" data-testid="ai-pen" :class="{ active: inking }" :disabled="!inking && !inkView" :aria-pressed="inking" :title="inking ? 'Put the pen down (Esc); the marks stay for your next request' : inkView ? 'Sketch over the view for the AI (P): circle things, draw boxes and arrows, leave notes' : 'Sketch on the patch or the plugin'" @click="togglePen">✎</button>
      <button v-if="llm" type="button" class="icon eye" data-testid="ai-screen" :class="{ active: screenOn, off: screen.state.value === 'unsupported' }" :disabled="screen.state.value === 'unsupported' || screen.state.value === 'asking'" :title="screenTitle" :aria-pressed="screenOn" @click="toggleScreen">
        <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden="true"><path d="M1 7c2.2-3.6 5.3-5.5 9-5.5s6.8 1.9 9 5.5c-2.2 3.6-5.3 5.5-9 5.5S3.2 10.6 1 7z" fill="none" stroke="currentColor" stroke-width="1.5" /><circle cx="10" cy="7" r="2.6" fill="currentColor" /></svg>
        <span v-if="screenOn" class="shared-dot" />
      </button>
      <button type="button" class="icon" title="AI settings" data-testid="ai-drawer-toggle" :class="{ active: drawer }" @click="drawer = !drawer">⚙</button>
      <button type="button" class="icon" title="Hide the AI panel (⌘J)" data-testid="ai-close" @click="emit('close')">⟩</button>
    </header>
    <div v-if="screen.message.value && screen.state.value !== 'unsupported' && screen.state.value !== 'on'" class="screen-note" data-testid="ai-screen-note">{{ screen.message.value }}</div>
    <div v-if="drawer" class="drawer" data-testid="ai-drawer">
      <div class="row">
        <template v-if="llm">
          <label title="Allow AI to work on independent parts of your request at the same time."><span>Parallel tasks</span><select v-model="llm.settings.members" data-testid="ai-members"><option value="auto">Let AI decide</option><option value="off">One task at a time</option></select></label>
          <label v-if="!isDesktop" title="Choose how much context each delegated task receives."><span>Task context</span><select v-model="llm.settings.memberContext" data-testid="ai-member-context"><option value="lead">what the lead chooses</option><option value="brief">brief, the person's words, the state</option><option value="full">all that and the whole conversation</option><option value="bare">only the lead's brief</option></select></label>
        </template>
      </div>

    </div>
    <ol ref="list" class="history" data-testid="ai-history" @scroll="onScroll">
      <li v-if="!turns.length" class="empty" data-testid="ai-empty">
        <p>Say what you want, in your words.</p>
        <p class="examples">“brighter” · “longer release” · “add reverb” · “make a bass” · “wobble the cutoff” · “write a bitcrusher”</p>
        <dl class="keys">
          <dt><kbd>Enter</kbd></dt><dd>type a request</dd>
          <dt><kbd>Esc</kbd></dt><dd>stop AI · back to the canvas</dd>
          <dt><kbd>⌘Z</kbd></dt><dd>take a request back</dd>
          <dt><kbd>⌘J</kbd></dt><dd>hide or show this panel</dd>
          <dt><kbd>⌥⌘E</kbd></dt><dd>patch ⇄ plugin</dd>
          <dt><kbd>P</kbd></dt><dd>sketch over the view for the AI</dd>
        </dl>
      </li>
      <li v-if="requests.earlier.value.length" class="earlier" data-testid="ai-earlier">
        <button type="button" class="link" @click="showEarlier = !showEarlier">{{ showEarlier ? '▾' : '▸' }} Earlier, about another patch: {{ requests.earlier.value.length }} request{{ requests.earlier.value.length === 1 ? '' : 's' }} (the AI does not see these)</button>
        <ol v-if="showEarlier" class="earlier-lines"><li v-for="o in requests.earlier.value" :key="o.id"><span class="ask-old">{{ o.text }}</span> → {{ o.label ?? o.message ?? o.status }}</li></ol>
      </li>
      <li v-for="o in turns" :key="o.id" class="turn" :class="[`s-${o.status}`, { latest: o.id === latestId, undone: o.undone, llm: o.route === 'llm', live: o.live }]" :data-status="o.status" :data-route="o.route" :data-testid="o.id === latestId ? 'ai-result' : o.route === 'llm' ? 'ai-llm-line' : undefined">
        <div class="ask">{{ o.text }}<span v-if="o.repeats" class="again" title="Did the last change again"> · again: “{{ o.repeats }}”</span></div>
        <div v-if="o.attached?.length || o.sketch?.parts.length" class="attached" data-testid="ai-attached"><span v-if="o.sketch?.parts.length" class="chip small sketch" data-testid="ai-line-sketch">✎ {{ sketchSummary(o.sketch.parts) }}</span><span v-for="a in o.attached ?? []" :key="a.id" class="chip small" :title="a.id">{{ KIND_ICON[a.kind] ?? '▣' }} {{ a.label }}</span></div>
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
            <ul v-if="o.agents?.length" class="lanes" data-testid="ai-lanes">
              <li v-for="a in o.agents" :key="a.id" class="lane" :class="`l-${a.status}`" :data-member="a.id" :data-status="a.status" :style="{ '--lane': a.color }">
                <div class="lane-head">
                  <span class="dot" :class="{ pulse: a.status === 'working' && o.live }" />
                  <span class="lane-name">{{ a.name }}</span>
                  <span class="lane-scope" title="What this member may change">{{ a.scope }}</span>
                  <span class="grow" />
                  <span class="lane-meta">{{ fmt(laneElapsed(o, a)) }}{{ !isDesktop && a.tokens ? ` · ${tokensShort(a.tokens)}` : '' }}</span>
                  <button v-if="a.status === 'working' && o.live" type="button" class="lane-stop" data-testid="ai-lane-stop" :title="`Stop ${a.name} (the others go on)`" @click="llm?.stopMember(a.id)">×</button>
                </div>
                <div class="lane-what" data-testid="ai-lane-what">{{ a.status === 'working' && o.live ? (a.activity ?? 'thinking…') : a.message ?? LANE_STATUS[a.status] }}</div>
                <div v-if="a.step && a.status === 'working' && o.live" class="lane-step">{{ a.step }}</div>
              </li>
            </ul>
            <div v-if="o.reply && o.reply.trim() !== (o.message ?? '').trim()" class="reply" data-testid="ai-reply">{{ o.reply }}</div>
          </template>
        </div>
        <div class="meta">
          <span class="time" :data-testid="o.id === latestId ? 'ai-time' : undefined" :title="routeTitle(o)">{{ meta(o) }}</span>
          <button v-if="o.live && llm?.busy.value" type="button" class="stop" data-testid="ai-stop" title="Stop (Esc)" @click="llm.stop()">Stop <kbd>Esc</kbd></button>
        </div>
      </li>
    </ol>
    <form class="prompt" @submit.prevent>
      <div v-if="sketchParts.length" class="chips" data-testid="ai-sketch" title="Your sketch goes with the next request: the marks in words and as a picture">
        <span class="chip sketch" data-testid="ai-sketch-chip">✎ {{ sketchSummary(sketchParts) }}<button type="button" class="x" title="Rub out the new marks" data-testid="ai-sketch-drop" @click="dropSketch">×</button></span>
      </div>
      <div v-if="attachments.length" class="chips" data-testid="ai-attachments" title="What you selected comes with the request">
        <span v-for="a in shownChips" :key="a.id" class="chip" :data-attachment="a.id">{{ KIND_ICON[a.kind] }} {{ a.label }}<button type="button" class="x" :title="`Leave ${a.id} out of this request`" @click="leaveOut(a.id)">×</button></span>
        <button v-if="attachments.length > CHIPS && !allChips" type="button" class="chip more" data-testid="ai-attachments-more" @click="allChips = true">+{{ attachments.length - CHIPS }} more</button>
      </div>
      <textarea ref="input" :value="text" rows="1" data-testid="ai-input" placeholder="Ask anything" maxlength="600" autocomplete="off" spellcheck="false" @input="text = ($event.target as HTMLTextAreaElement).value; resize()" @keydown="promptKey" />
      <div class="prompt-foot">
        <span v-if="preparing" class="spin" />
        <span class="hint">Enter send</span>
        <span class="grow" />
      </div>
    </form>
  </aside>
</template>

<style scoped>
.ai-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: #1b1b1b; border-left: 1px solid #000; font-size: 15px; line-height: 1.45; color: #e2e2e2; }
header { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; border-bottom: 1px solid #000; background: #232323; }
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
.prompt { margin: 0 12px 12px; display: flex; flex-direction: column; gap: 4px; background: #121212; border: 1px solid #444; border-radius: 10px; padding: 10px 12px 6px; }
.prompt:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px #ff9c1a26; }
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
.lanes { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.lane { border-left: 3px solid var(--lane); background: #1f1f1f; border-radius: 0 6px 6px 0; padding: 4px 8px; font-size: 13.5px; }
.lane-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.lane .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lane); flex: none; }
.lane .dot.pulse { animation: pulse 1s ease-in-out infinite; }
.lane-name { color: #f0f0f0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lane-scope { color: #8fa3ad; font-size: 12px; white-space: nowrap; }
.lane-meta { color: #8c8c8c; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lane-stop { border: 0; background: transparent; color: #9a9a9a; padding: 0 4px; font-size: 15px; line-height: 1; box-shadow: none; }
.lane-stop:hover { color: #fff; background: transparent !important; }
.lane-what { color: #c9c9c9; overflow-wrap: anywhere; }
.lane.l-failed .lane-what { color: #ff8da0; }
.lane.l-stopped .lane-what, .lane.l-done .lane-what { color: #a8a8a8; }
.lane-step { color: #8f8f8f; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer select { flex: 1 1 auto; min-width: 0; }
.eye { position: relative; }
.eye.off { opacity: .35; }
.eye .shared-dot { position: absolute; top: 2px; right: 1px; width: 6px; height: 6px; border-radius: 50%; background: var(--error); }
.pen { font-size: 17px; }
.pen:disabled { opacity: .35; }
.chip.sketch { background: #45352b; color: #f6dccd; }
.chip.small.sketch { background: #382d26; color: #d6bfb0; }
.screen-note { padding: 6px 14px; font-size: 13px; color: #d6d6d6; background: #262626; border-bottom: 1px solid #000; }
</style>

<script setup lang="ts">
// The Shared prototype's receiver's side: what a person who gets the link sees, step by step. A
// chat app draws a preview of the link (an app, not a person); the page plays nothing until the
// person presses play; then they play the work, its controls moving only their own copy of it
// (the sound follows, and goes back to the author's values when this closes), and they can send
// a setting and a note back or pass the work on. Beside it, what would reach the author at the
// level chosen. Their visit joins the made-up story; nothing leaves the page.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useSession } from '../context.ts';
import PluginWindow from '../../screen/PluginWindow.vue';
import { pluginSpec } from '../../screen/build.ts';
import type { PluginSpec } from '../../screen/spec.ts';
import { currentValues } from '../../sound/codegen.ts';
import { applyIntents, type Intent } from '../../work/ops.ts';
import {
  LEVELS,
  YOU,
  receiverLink,
  type Level,
  type Scene,
  type Story,
  type StoryControl,
  type Visit,
  type You,
} from './after-sharing.ts';

const props = defineProps<{
  story: Story;
  scene: Scene;
  level: Level;
  spec: PluginSpec;
  controls: readonly StoryControl[];
  you: You;
}>();
const emit = defineEmits<{
  (e: 'update:level', level: Level): void;
  (e: 'update:you', you: You): void;
  (e: 'close'): void;
}>();
const session = useSession();
const link = receiverLink(props.scene);
const linkName = computed(() => props.story.links.find(l => l.id === link)?.name ?? '');
const workName = computed(() => session.doc.value.name);
const address = `https://den-kit.example/w/${session.doc.value.id.replace(/[^\w-]/g, '').slice(-8)}`;
const step = ref<'chat' | 'page' | 'playing'>('chat');
const mine = ref<You>({ ...props.you });
function save(patch: Partial<You>) {
  mine.value = { ...mine.value, ...patch };
  emit('update:you', mine.value);
}
/** This opening of the link: its visit (from the same browser as any earlier one) and what was sent since. */
const opening = ref(-1);
const visit = computed<Visit | null>(() => mine.value.visits[opening.value] ?? null);
function saveVisit(next: Visit) {
  const visits = [...mine.value.visits];
  visits[opening.value] = next;
  save({ visits });
}
const sentBefore = props.you.returns.length;
const browserId = `b-${Math.random().toString(16).slice(2, 8)}`;

// ---- the person's own copy of the work -------------------------------------------------------
const local = shallowRef(session.doc.value);
const playSpec = computed(() => pluginSpec(local.value, session.catalog, session.generated.value));
/** What this side has sent to the sound, and what it changed there (put back on close). */
const sound: Record<string, number> = { ...session.generated.value.values };
const changed = new Set<string>();
const analyser = (probe: number) =>
  probe >= 0 ? (session.engine.probeAnalysers[probe] ?? null) : session.engine.outAnalyser;
function change(widget: string, values: Record<string, number | boolean>) {
  const v = visit.value;
  if (step.value !== 'playing' || !v) return;
  const intents: Intent[] = Object.entries(values).map(([port, value]) => ({
    op: 'setValue',
    node: widget,
    port,
    value,
    clamp: true,
  }));
  try {
    local.value = applyIntents(local.value, intents, session.catalog).doc;
  } catch {
    return;
  }
  const solo = session.solo.value ? { solo: session.solo.value } : {};
  for (const [name, value] of Object.entries(
    currentValues(local.value, session.catalog, session.generated.value, solo),
  ))
    if (sound[name] !== value) {
      session.engine.setParam(name, value);
      sound[name] = value;
      changed.add(name);
    }
  const now = local.value.nodes[widget]?.values ?? {};
  const kept = Object.fromEntries(
    Object.keys(values).map(port => [port, now[port] ?? values[port]!]),
  );
  saveVisit({ ...v, left: { ...v.left, [widget]: { ...v.left[widget], ...kept } } });
}
function note(n: number, on: boolean, velocity: number) {
  if (on) session.noteOn(n, velocity);
  else session.noteOff(n);
}

// ---- the steps ---------------------------------------------------------------------------------
let timer = 0;
function open() {
  step.value = 'page';
  opening.value = mine.value.visits.length;
  saveVisit({
    link,
    person: YOU,
    browser: YOU,
    day: props.story.days - 1,
    played: false,
    seconds: 0,
    left: {},
    version: props.story.update?.version ?? 1,
  });
}
function play() {
  step.value = 'playing';
  saveVisit({ ...visit.value!, played: true });
  timer = window.setInterval(() => {
    if (visit.value) saveVisit({ ...visit.value, seconds: visit.value.seconds + 1 });
  }, 1000);
}
const settingName = ref('');
const noteText = ref('');
const movedIds = computed(() => Object.keys(visit.value?.left ?? {}));
const canSend = computed(() => movedIds.value.length > 0 || noteText.value.trim() !== '');
function send() {
  const v = visit.value;
  if (!v || !canSend.value) return;
  const values = movedIds.value.length ? { ...v.left } : undefined;
  save({
    returns: [
      ...mine.value.returns,
      {
        id: `you${mine.value.returns.length + 1}`,
        kind: values ? 'setting' : 'note',
        link,
        person: YOU,
        day: v.day,
        title: settingName.value.trim() || (values ? 'My setting' : 'A note'),
        text: noteText.value.trim(),
        values,
      },
    ],
  });
  settingName.value = '';
  noteText.value = '';
}
function passOn() {
  if (mine.value.passed) return;
  save({
    passed: {
      id: 'passed-you',
      name: 'A listener’s link (yours)',
      from: link,
      by: { person: YOU, browser: YOU },
      previews: 0,
    },
  });
}
const clock = computed(() => {
  const s = visit.value?.seconds ?? 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

// ---- what reaches the author --------------------------------------------------------------------
const label = (id: string) => props.controls.find(c => c.id === id)?.label ?? id;
type Line = { text: string; state: 'done' | 'waiting' | 'never' };
const lines = computed<Line[]>(() => {
  const v = visit.value;
  const was = (done: boolean): Line['state'] => (done ? 'done' : 'waiting');
  const sent = mine.value.returns.length > sentBefore;
  if (props.level === 'returns')
    return [
      { text: 'What you send: a setting, its name, your note.', state: was(sent) },
      {
        text: 'Nothing else: not that you opened the page, pressed play or moved a control.',
        state: 'never',
      },
    ];
  const moved = movedIds.value.map(label);
  const out: Line[] = [
    {
      text: `One more preview of “${linkName.value}”, drawn by the chat app, not you.`,
      state: was(mine.value.previews > 0),
    },
    { text: 'One more open.', state: was(!!v) },
    { text: 'One more press of play.', state: was(!!v?.played) },
    { text: 'One more play of 30 s or more.', state: was((v?.seconds ?? 0) >= 30) },
    {
      text: moved.length
        ? `The controls you moved: ${moved.join(', ')}.`
        : 'The controls you move.',
      state: was(moved.length > 0),
    },
  ];
  if (props.scene === 'public')
    out.push({ text: 'One more link made to pass it on.', state: was(!!mine.value.passed) });
  out.push({ text: 'What you send back.', state: was(sent) });
  if (props.level === 'browsers')
    out.push({
      text: `A random ID kept in this browser (${browserId}): a visit on another day counts as the same browser.`,
      state: was(!!v),
    });
  out.push({
    text:
      props.level === 'browsers'
        ? 'Not who you are. On another device you are another browser.'
        : 'Not who you are, and not whether you came before.',
    state: 'never',
  });
  return out;
});
const MARK: Record<Line['state'], string> = { done: '✓', waiting: '○', never: '–' };

function close() {
  emit('close');
}
function keydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}
const dialog = ref<HTMLElement | null>(null);
onMounted(() => {
  // The chat app fetches the page to draw its card as soon as the link is posted.
  save({ previews: mine.value.previews + 1 });
  window.addEventListener('keydown', keydown, true);
  dialog.value?.querySelector<HTMLElement>('[data-testid=receiver-open-link]')?.focus();
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  window.removeEventListener('keydown', keydown, true);
  // The sound goes back to the author's work.
  const values = session.generated.value.values;
  for (const name of changed)
    if (values[name] !== undefined) session.engine.setParam(name, values[name]!);
});
</script>

<template>
  <div class="veil" data-testid="shared-receiver" @pointerdown.self="close">
    <div ref="dialog" class="dialog" role="dialog" aria-label="The receiver’s side">
      <header>
        <b>The receiver’s side</b>
        <span class="muted">
          You open the link as
          {{ scene === 'public' ? 'someone who saw the post' : 'the person you gave it to' }}:
          <span class="as-written">“{{ linkName }}”</span>.
        </span>
        <span class="spacer" />
        <button data-testid="receiver-close" @click="close">
          Close <span class="kbd-hint">Esc</span>
        </button>
      </header>
      <div class="body">
        <section class="steps">
          <template v-if="step === 'chat'">
            <h3>The link arrives in a chat</h3>
            <div class="chat">
              <p class="bubble">
                {{
                  scene === 'public'
                    ? 'Made this, you can play it in your browser:'
                    : 'Here it is for the session:'
                }}
                <span class="url">{{ address }}</span>
              </p>
              <div class="card" data-testid="receiver-card">
                <div class="thumb"><PluginWindow :spec="spec" preview /></div>
                <div class="card-text">
                  <b class="as-written">{{ workName }}</b>
                  <span class="muted">A work made with den-kit. Play it in your browser.</span>
                </div>
              </div>
            </div>
            <p class="explain">
              The chat app fetched the page to draw this card. That was the app, not a person: it
              counts as a preview, never as a play.
            </p>
            <button class="primary" data-testid="receiver-open-link" @click="open">
              Open the link
            </button>
          </template>
          <template v-else>
            <h3>{{ step === 'page' ? 'The page' : `Playing, ${clock}` }}</h3>
            <div class="browser">
              <div class="address">{{ address }}</div>
              <div class="page">
                <b class="as-written title">{{ workName }}</b>
                <div class="plugin" :class="{ waiting: step === 'page' }">
                  <PluginWindow
                    :spec="playSpec"
                    :held="session.heldNotes.value"
                    :analyser="analyser"
                    :asset-urls="session.assetUrls.value"
                    :preview="step === 'page'"
                    @change="change"
                    @note="note"
                  />
                  <button
                    v-if="step === 'page'"
                    class="primary play"
                    data-testid="receiver-play"
                    @click="play"
                  >
                    Click to play
                  </button>
                </div>
              </div>
            </div>
            <p v-if="step === 'page'" class="explain">
              The page has played nothing yet. Link checkers and mail systems open pages too; a
              press of play is a person.
            </p>
            <template v-else>
              <p class="explain">
                Your moves change only your copy of the work, never the author’s. Send a setting
                back when you like where you left it.
              </p>
              <div class="send">
                <input
                  v-model="settingName"
                  type="text"
                  class="as-written"
                  placeholder="Name your setting"
                  data-testid="receiver-setting-name"
                />
                <input
                  v-model="noteText"
                  type="text"
                  class="as-written note"
                  placeholder="A note for the author (optional)"
                  data-testid="receiver-note"
                />
                <button
                  class="primary"
                  :disabled="!canSend"
                  data-testid="receiver-send"
                  :title="canSend ? '' : 'Move a control or write a note first'"
                  @click="send"
                >
                  Send to the author
                </button>
                <button
                  v-if="scene === 'public'"
                  :disabled="!!mine.passed"
                  data-testid="receiver-pass"
                  @click="passOn"
                >
                  {{ mine.passed ? 'Passed on' : 'Pass it on' }}
                </button>
              </div>
              <p
                v-if="mine.returns.length > sentBefore"
                class="explain"
                data-testid="receiver-sent"
              >
                Sent {{ mine.returns.length - sentBefore }}. The author finds it under Sent back.
              </p>
            </template>
          </template>
        </section>
        <aside class="learns">
          <h3>What reaches the author</h3>
          <div class="levels" role="radiogroup" aria-label="What den-kit learns">
            <button
              v-for="l in LEVELS"
              :key="l.id"
              role="radio"
              :aria-checked="level === l.id"
              :class="{ active: level === l.id }"
              :data-level="l.id"
              @click="emit('update:level', l.id)"
            >
              {{ l.name }}
            </button>
          </div>
          <ul class="lines" data-testid="receiver-lines">
            <li v-for="(line, i) in lines" :key="i" :class="line.state" :data-state="line.state">
              <span class="mark">{{ MARK[line.state] }}</span>
              <span>{{ line.text }}</span>
            </li>
          </ul>
          <p class="explain">
            In this prototype nothing leaves the page: your visit joins the made-up story, so the
            Shared view changes with it.
          </p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.veil {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-canvas) 72%, transparent);
}
.dialog {
  width: min(1100px, 96%);
  height: min(720px, 94%);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-dialog);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--app-chrome);
  border-bottom: 1px solid var(--line-subtle);
  font-size: 13px;
}
header b {
  font-family: var(--font-control);
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
}
header button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.spacer {
  flex: 1;
}
.body {
  display: grid;
  grid-template-columns: 1fr 320px;
  min-height: 0;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px 16px;
  overflow: auto;
}
h3 {
  margin: 0;
  font-family: var(--font-control);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
  color: var(--text-muted);
}
h3::before {
  content: var(--heading-prefix);
}
.chat {
  max-width: 460px;
  padding: 12px;
  background: var(--app-field);
  border-radius: var(--radius-panel);
}
.bubble {
  margin: 0 0 8px;
  line-height: 1.45;
}
.url {
  display: block;
  color: var(--accent-text);
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
}
.card {
  border: 1px solid var(--line-subtle);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--app-card);
  overflow: hidden;
}
.thumb {
  position: relative;
  height: 160px;
}
.card-text {
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  font-size: 12.5px;
}
.explain {
  margin: 0;
  max-width: 620px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-muted);
}
.steps > button {
  align-self: flex-start;
}
.browser {
  flex: 1;
  min-height: 260px;
  display: grid;
  grid-template-rows: auto 1fr;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-panel);
  overflow: hidden;
}
.address {
  padding: 5px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  background: var(--app-chrome);
  border-bottom: 1px solid var(--line-subtle);
}
.page {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 6px;
  padding: 8px;
  min-height: 0;
  background: var(--app-canvas);
}
.title {
  font-size: 13px;
}
.plugin {
  position: relative;
  min-height: 0;
}
.plugin.waiting > :first-child {
  opacity: 0.45;
}
.play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 8px 18px;
}
.send {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.send input {
  width: 180px;
}
.send input.note {
  width: 280px;
}
.learns {
  padding: 14px 16px;
  overflow: auto;
  border-left: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.levels {
  display: grid;
  gap: 4px;
}
.levels button {
  text-align: left;
  background: transparent;
}
.levels button.active {
  background: var(--ink);
  color: var(--text-on-ink);
  border-color: var(--ink);
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.4;
}
.lines li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 6px;
}
.lines .mark {
  font-weight: 700;
  text-align: center;
}
.lines .done .mark {
  color: var(--state-ok);
}
.lines .waiting {
  color: var(--text-muted);
}
.lines .never {
  color: var(--text-muted);
  font-style: italic;
}
</style>

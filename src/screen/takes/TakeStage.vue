<script setup lang="ts">
// A work's screen with the takes that came with it (src/work/takes.ts), as the person
// it was handed to sees it. They pick a take, then:
// - Play: the take plays the screen, the controls moving by themselves and the keys
//   lighting up. Grabbing a control, or playing the keys, makes that part theirs while
//   the take plays the rest; the chips under the screen say who plays what and give a
//   part back to the take, which then has it where the take is.
// - Steps: the take as steps to do at their own pace. Going to a step puts the controls
//   where it starts. Watch plays it; Your turn draws where the take went (and lights
//   the keys to play), keeps the step's notes playing, and ticks the step off when the
//   person lets go of their control where the take's went, or has played its notes.
// Whoever shows it applies what it sends, the take's moves and notes and the person's
// alike, and starts the sound when asked (`start`). Notes the person plays elsewhere
// (the computer keys, MIDI) reach it through `heard`. Nothing here changes a work.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import PluginWindow from '../PluginWindow.vue';
import { formatValue } from '../format.ts';
import type { PluginSpec, Rect, WidgetSpec } from '../spec.ts';
import { takeSteps, type Take, type TakeValues } from '../../work/takes.ts';
import { TakePlayback } from './take-play.ts';
import { describeStep, reached, stepNotes, stepTargets } from './take-steps.ts';

const props = defineProps<{
  spec: PluginSpec;
  takes: ReadonlyArray<{ path: string; take: Take }>;
  held?: readonly number[];
  analyser?: (probe: number) => AnalyserNode | null;
  assetUrls?: Readonly<Record<string, string>>;
  /** The sound runs, so the take can be heard. */
  sounding: boolean;
  /** Takes that could not be read. */
  problems?: readonly string[];
}>();
const emit = defineEmits<{
  (
    e: 'change',
    widget: string,
    values: Record<string, number | boolean>,
    done: boolean,
    gesture?: string,
    by?: string,
  ): void;
  (e: 'note', note: number, on: boolean, velocity: number): void;
  /** Start the sound: the person asked to hear the take. */
  (e: 'start'): void;
}>();
defineExpose({ heard });

const KEYS = 'keys';
const chosen = ref(0);
const mode = ref<'play' | 'steps'>('play');
const take = computed(() => props.takes[Math.min(chosen.value, props.takes.length - 1)]?.take);
const playback = shallowRef<TakePlayback | null>(null);
/** The take's position, for what is drawn (updated while it plays). */
const at = ref(0);
const playing = ref(false);
/** The parts the person plays (control ids, and `keys`). */
const hand = ref<string[]>([]);
/** Steps: the one shown, whether it is being watched or done by the person, the ones done. */
const step = ref(0);
const turn = ref<'watch' | 'yours' | null>(null);
const done = ref<number[]>([]);
/** What the person moved and played in their turn, and whether they got there. */
const touched = ref<string[]>([]);
const played = ref<number[]>([]);
const finished = ref(false);

const out = {
  move: (control: string, values: TakeValues) => {
    if (props.spec.controls[control]) emit('change', control, values, false);
  },
  note: (note: number, on: boolean, velocity: number) => emit('note', note, on, velocity),
};
watch(
  take,
  t => {
    playback.value?.pause();
    playback.value = t ? new TakePlayback(t, out) : null;
    if (playback.value) playback.value.onEnd = ended;
    hand.value = [];
    at.value = 0;
    playing.value = false;
    step.value = 0;
    turn.value = null;
    done.value = [];
  },
  { immediate: true },
);

// ---- the clock: what is due goes out often; what is drawn follows a little less often ----
let timer = 0;
let frames = 0;
function run() {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    const p = playback.value;
    if (!p) return;
    p.tick();
    if (++frames % 4 === 0 || !p.playing) at.value = p.position;
    playing.value = p.playing;
    if (!p.playing) window.clearInterval(timer);
  }, 8);
}
onBeforeUnmount(() => {
  window.clearInterval(timer);
  playback.value?.pause();
});

/** What to do once the sound runs, when the person asked before it did. */
let pending: (() => void) | null = null;
function withSound(action: () => void) {
  if (props.sounding) action();
  else {
    pending = action;
    emit('start');
  }
}
watch(
  () => props.sounding,
  on => {
    if (on && pending) {
      const action = pending;
      pending = null;
      action();
    }
  },
);

// ---- Play ----------------------------------------------------------------------------
const moving = computed(() => (take.value ? (playback.value?.moving ?? []) : []));
const parts = computed(() => [
  ...moving.value
    .filter(id => props.spec.controls[id]?.rect)
    .map(id => ({ id, label: props.spec.controls[id]!.label || id })),
  ...(take.value?.notes.length ? [{ id: KEYS, label: 'Keys' }] : []),
]);
function togglePlay() {
  const p = playback.value;
  if (!p) return;
  if (p.playing) {
    p.pause();
    playing.value = false;
    at.value = p.position;
    return;
  }
  withSound(() => {
    p.play();
    playing.value = true;
    run();
  });
}
function restart() {
  const p = playback.value;
  if (!p) return;
  withSound(() => {
    p.play(0);
    playing.value = true;
    run();
  });
}
function scrub(e: Event) {
  const p = playback.value;
  if (!p) return;
  p.seek(Number((e.target as HTMLInputElement).value));
  at.value = p.position;
  if (p.playing) run();
}
function setHand(id: string, mine: boolean) {
  const p = playback.value;
  if (!p) return;
  if (id === KEYS) p.setKeysInHand(mine);
  else if (mine) p.grab(id);
  else p.giveBack(id);
  hand.value = mine ? [...new Set([...hand.value, id])] : hand.value.filter(x => x !== id);
}
function ended() {
  playing.value = false;
  at.value = playback.value?.position ?? 0;
  if (mode.value === 'steps' && turn.value === 'yours' && !finished.value) {
    // Your turn goes on: the step plays again until the controls get there.
    const s = steps.value[step.value];
    if (s) {
      playback.value?.playRange(s.from, s.to + 400);
      playing.value = true;
      run();
    }
    return;
  }
  if (turn.value === 'watch') turn.value = null;
}

// ---- the person's own moves and notes --------------------------------------------------
function personChange(
  widget: string,
  values: Record<string, number | boolean>,
  done: boolean,
  gesture?: string,
  by?: string,
) {
  const p = playback.value;
  if (p && !by) {
    if (
      mode.value === 'play' &&
      p.playing &&
      moving.value.includes(widget) &&
      !hand.value.includes(widget)
    )
      setHand(widget, true);
    if (mode.value === 'steps' && turn.value === 'yours') {
      touched.value = [...new Set([...touched.value, widget])];
      if (done) checkTurn({ id: widget, values });
    }
  }
  emit('change', widget, values, done, gesture, by);
}
/** A note the person played (whoever shows the screen plays it). */
function heard(note: number, on: boolean) {
  const p = playback.value;
  if (!p || !on) return;
  if (mode.value === 'play' && p.playing && take.value?.notes.length && !hand.value.includes(KEYS))
    setHand(KEYS, true);
  if (mode.value === 'steps' && turn.value === 'yours') {
    played.value = [...new Set([...played.value, note])];
    checkTurn();
  }
}
function personNote(note: number, on: boolean, velocity: number) {
  heard(note, on);
  emit('note', note, on, velocity);
}

// ---- Steps -----------------------------------------------------------------------------
const steps = computed(() => (take.value ? takeSteps(take.value) : []));
const current = computed(() => steps.value[step.value]);
const words = computed(() => steps.value.map(s => describeStep(s, props.spec.controls)));
const targets = computed(() => (current.value ? stepTargets(current.value) : new Map()));
const notesToPlay = computed(() => (current.value ? stepNotes(current.value) : []));
/** Your turn is done when the person has played the step's notes, or let go of its controls where the take's went. */
function checkTurn(latest?: { id: string; values: TakeValues }) {
  if (mode.value !== 'steps' || turn.value !== 'yours' || finished.value || !current.value) return;
  const list = [...targets.value].filter(([id]) => props.spec.controls[id]);
  const ok = notesToPlay.value.length
    ? notesToPlay.value.every(n => played.value.includes(n))
    : list.length > 0 &&
      list.every(([id, target]) => {
        const w = props.spec.controls[id]!;
        const now =
          latest && latest.id === id ? { ...w, values: { ...w.values, ...latest.values } } : w;
        return touched.value.includes(id) && reached(now, target);
      });
  if (!ok) return;
  finished.value = true;
  if (!done.value.includes(step.value)) done.value = [...done.value, step.value];
  playback.value?.pause();
  playing.value = false;
}
/** The keys lit: the ones sounding, and in your turn the notes still to play. */
const lit = computed(() =>
  mode.value === 'steps' && turn.value === 'yours' && !finished.value && notesToPlay.value.length
    ? [
        ...new Set([
          ...(props.held ?? []),
          ...notesToPlay.value.filter(n => !played.value.includes(n)),
        ]),
      ]
    : props.held,
);
function setMode(m: 'play' | 'steps') {
  if (mode.value === m) return;
  const p = playback.value;
  p?.pause();
  p?.clearRange();
  for (const id of hand.value) if (id !== KEYS) p?.giveBack(id);
  p?.setKeysInHand(false);
  hand.value = [];
  playing.value = false;
  turn.value = null;
  mode.value = m;
  if (m === 'steps') goTo(step.value);
}
function goTo(i: number) {
  if (i < 0 || i >= steps.value.length) return;
  const p = playback.value;
  p?.pause();
  playing.value = false;
  p?.hand.clear();
  p?.setKeysInHand(false);
  step.value = i;
  turn.value = null;
  touched.value = [];
  played.value = [];
  finished.value = false;
  // The controls where the step starts.
  p?.seek(steps.value[i]!.from);
  at.value = p?.position ?? 0;
}
function watchStep() {
  const p = playback.value,
    s = current.value;
  if (!p || !s) return;
  withSound(() => {
    p.hand.clear();
    p.setKeysInHand(false);
    turn.value = 'watch';
    p.playRange(s.from, s.to + 400);
    playing.value = true;
    run();
  });
}
function yourTurn() {
  const p = playback.value,
    s = current.value;
  if (!p || !s) return;
  withSound(() => {
    p.pause();
    p.hand.clear();
    p.setKeysInHand(false);
    // Everything where the step starts, then the step's controls (or the keys) in the person's hands.
    p.seek(s.from);
    for (const id of targets.value.keys()) p.grab(id);
    p.setKeysInHand(notesToPlay.value.length > 0);
    touched.value = [];
    played.value = [];
    finished.value = false;
    turn.value = 'yours';
    if (s.gestures.length && s.notes.length) {
      p.playRange(s.from, s.to + 400);
      playing.value = true;
      run();
    }
  });
}

// ---- what is drawn over the screen -------------------------------------------------------
const rectOf = (id: string): Rect | undefined => props.spec.controls[id]?.rect;
const ms = (t: number) => {
  const s = Math.max(0, Math.round(t / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function readout(w: WidgetSpec, v: TakeValues | undefined) {
  if (!v) return '';
  if (w.type === 'ui.xy') return '';
  if (w.type === 'ui.toggle' || w.type === 'ui.button') return v.value ? 'on' : 'off';
  return formatValue(Number(v.value), String(w.config.unit ?? ''));
}
function xyPoint(r: Rect, v: TakeValues | undefined) {
  if (!v) return null;
  return { x: r.x + Number(v.x ?? 0.5) * r.w, y: r.y + (1 - Number(v.y ?? 0.5)) * r.h };
}
const polyline = (r: Rect, list: ReadonlyArray<{ values: TakeValues }>) =>
  list
    .map(m => xyPoint(r, m.values))
    .filter(Boolean)
    .map(p => `${p!.x.toFixed(1)},${p!.y.toFixed(1)}`)
    .join(' ');

interface PlayMark {
  id: string;
  r: Rect;
  kind: 'take' | 'you' | 'trail';
  trail: string;
  ghost: { x: number; y: number } | null;
  tag: string;
}
/** Play: a ring on each control the take is moving, and on each the person has, with where the take has it. */
const playMarks = computed((): PlayMark[] => {
  const p = playback.value;
  if (!p || mode.value !== 'play') return [];
  void at.value;
  return moving.value.flatMap((id): PlayMark[] => {
    const w = props.spec.controls[id],
      r = rectOf(id);
    if (!w || !r) return [];
    const mine = hand.value.includes(id);
    const active = !mine && p.isMoving(id);
    if (!mine && !active) {
      if (w.type === 'ui.xy' && playing.value) {
        const trail = polyline(r, p.movesOf(id, at.value - 1200, at.value));
        return trail ? [{ id, r, kind: 'trail', trail, ghost: null, tag: '' }] : [];
      }
      return [];
    }
    const v = p.valuesAt(id, at.value);
    return [
      {
        id,
        r,
        kind: mine ? 'you' : 'take',
        trail:
          w.type === 'ui.xy' && !mine ? polyline(r, p.movesOf(id, at.value - 1200, at.value)) : '',
        ghost: mine && w.type === 'ui.xy' ? xyPoint(r, v) : null,
        tag: mine
          ? `you${readout(w, v) ? ` · take at ${readout(w, v)}` : ''}`
          : `take${readout(w, v) ? ` · ${readout(w, v)}` : ''}`,
      },
    ];
  });
});
/** Steps: where the step's controls go, drawn on each. */
const stepMarks = computed(() => {
  const s = current.value;
  if (!s || mode.value !== 'steps') return [];
  return [...targets.value].flatMap(([id, target]) => {
    const w = props.spec.controls[id],
      r = rectOf(id);
    if (!w || !r) return [];
    const gestures = s.gestures.filter(g => g.control === id);
    const first = gestures[0]!;
    const ok = turn.value === 'yours' && touched.value.includes(id) && reached(w, target);
    const from = first.before ?? first.moves[0]!.values;
    return [
      {
        id,
        r,
        ok,
        path:
          w.type === 'ui.xy'
            ? polyline(r, [{ values: from }, ...gestures.flatMap(g => g.moves)])
            : '',
        start: w.type === 'ui.xy' ? xyPoint(r, from) : null,
        end: w.type === 'ui.xy' ? xyPoint(r, target) : null,
        tag:
          w.type === 'ui.xy'
            ? ok
              ? 'there ✓'
              : 'follow the line'
            : `${readout(w, from)} → ${readout(w, target)}${ok ? ' ✓' : ''}`,
      },
    ];
  });
});
const keyboardRect = computed(() => props.spec.widgets.find(w => w.type === 'ui.keyboard')?.rect);
</script>

<template>
  <div class="take-stage" :class="mode" data-testid="take-stage">
    <div class="screen">
      <PluginWindow
        :spec="spec"
        :held="lit"
        :analyser="analyser"
        :asset-urls="assetUrls"
        @change="personChange"
        @note="personNote"
      >
        <template #overlay>
          <div class="marks" data-testid="take-marks">
            <svg
              :width="spec.width"
              :height="spec.height"
              :viewBox="`0 0 ${spec.width} ${spec.height}`"
            >
              <template v-for="m in playMarks" :key="`p-${m.id}`">
                <polyline v-if="m.trail" class="trail" :points="m.trail" />
                <rect
                  v-if="m.kind !== 'trail'"
                  :class="['ring', m.kind]"
                  :x="m.r.x - 4"
                  :y="m.r.y - 4"
                  :width="m.r.w + 8"
                  :height="m.r.h + 8"
                  rx="8"
                />
                <circle
                  v-if="m.kind === 'you' && m.ghost"
                  class="ghost"
                  :cx="m.ghost.x"
                  :cy="m.ghost.y"
                  r="11"
                />
              </template>
              <template v-for="m in stepMarks" :key="`s-${m.id}`">
                <polyline v-if="m.path" class="path" :points="m.path" />
                <circle v-if="m.start" class="path-start" :cx="m.start.x" :cy="m.start.y" r="6" />
                <circle
                  v-if="m.end"
                  class="path-end"
                  :class="{ ok: m.ok }"
                  :cx="m.end.x"
                  :cy="m.end.y"
                  r="14"
                />
                <rect
                  :class="['ring', 'step', { ok: m.ok }]"
                  :x="m.r.x - 4"
                  :y="m.r.y - 4"
                  :width="m.r.w + 8"
                  :height="m.r.h + 8"
                  rx="8"
                />
              </template>
              <rect
                v-if="mode === 'steps' && notesToPlay.length && keyboardRect"
                class="ring step"
                :class="{ ok: finished }"
                :x="keyboardRect.x - 4"
                :y="keyboardRect.y - 4"
                :width="keyboardRect.w + 8"
                :height="keyboardRect.h + 8"
                rx="8"
              />
            </svg>
            <template v-for="m in playMarks" :key="`pt-${m.id}`">
              <span
                v-if="m.kind !== 'trail'"
                :class="['tag', m.kind]"
                :data-take-mark="`${m.kind}:${m.id}`"
                :style="{ left: `${m.r.x - 4}px`, top: `${m.r.y - 24}px` }"
                >{{ m.tag }}</span
              >
            </template>
            <span
              v-for="m in stepMarks"
              :key="`st-${m.id}`"
              :class="['tag', 'step', { ok: m.ok }]"
              :data-take-mark="`step:${m.id}`"
              :style="{ left: `${m.r.x - 4}px`, top: `${m.r.y - 24}px` }"
              >{{ m.tag }}</span
            >
          </div>
        </template>
      </PluginWindow>
    </div>

    <aside v-if="mode === 'steps' && take" class="deck" data-testid="take-steps">
      <p v-if="take.about" class="about">“{{ take.about }}”</p>
      <template v-if="current">
        <header>
          <b>Step {{ step + 1 }} of {{ steps.length }}</b>
          <span v-if="done.includes(step)" class="done-mark">✓ done</span>
        </header>
        <h3 data-testid="take-step-title">{{ words[step]?.title }}</h3>
        <ul v-if="words[step]?.lines.length">
          <li v-for="(l, i) in words[step]!.lines" :key="i">{{ l }}</li>
        </ul>
        <div class="actions">
          <button
            type="button"
            data-testid="take-watch"
            :class="{ on: turn === 'watch' }"
            @click="watchStep"
          >
            ▶ Watch
          </button>
          <button
            type="button"
            data-testid="take-your-turn"
            :class="{ on: turn === 'yours' }"
            @click="yourTurn"
          >
            ✋ Your turn
          </button>
        </div>
        <p class="state" data-testid="take-step-state">
          {{
            turn === 'watch'
              ? 'The take plays this step.'
              : turn === 'yours'
                ? finished
                  ? 'That’s it. On to the next one when you like.'
                  : notesToPlay.length
                    ? 'Play these notes on the keys, at your own pace.'
                    : 'Your turn: the ring shows what to move, the line where the take went. The take keeps the rest going.'
                : done.includes(step)
                  ? 'Done. Watch or try it again, or go on.'
                  : 'Watch it first, or go straight to your turn.'
          }}
        </p>
        <footer>
          <button type="button" :disabled="step === 0" @click="goTo(step - 1)">‹ Back</button>
          <button
            type="button"
            data-testid="take-next"
            :class="{ on: finished }"
            :disabled="step >= steps.length - 1"
            @click="goTo(step + 1)"
          >
            Next ›
          </button>
        </footer>
      </template>
      <p v-else class="state">This take has no steps.</p>
      <ol class="all">
        <li v-for="(w, i) in words" :key="i" :class="{ here: i === step, done: done.includes(i) }">
          <button type="button" @click="goTo(i)">{{ w.title }}</button>
        </li>
      </ol>
    </aside>

    <footer v-if="take" class="bar" data-testid="take-bar">
      <label class="pick">
        <span class="muted">Take</span>
        <select
          v-if="takes.length > 1"
          :value="chosen"
          data-testid="take-pick"
          @change="chosen = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="(t, i) in takes" :key="t.path" :value="i">{{ t.take.name }}</option>
        </select>
        <b v-else data-testid="take-name">{{ take.name }}</b>
      </label>
      <span
        v-if="take.demo"
        class="badge"
        title="Written by hand to show the idea, not recorded from someone playing"
        >demo</span
      >
      <div class="modes">
        <button
          type="button"
          :class="{ active: mode === 'play' }"
          data-testid="take-mode-play"
          @click="setMode('play')"
        >
          Play
        </button>
        <button
          type="button"
          :class="{ active: mode === 'steps' }"
          data-testid="take-mode-steps"
          @click="setMode('steps')"
        >
          Steps
        </button>
      </div>
      <template v-if="mode === 'play'">
        <button type="button" class="go" data-testid="take-play" @click="togglePlay">
          {{ playing ? '❚❚ Pause' : '▶ Play' }}
        </button>
        <button type="button" title="From the start" @click="restart">⟲</button>
        <input
          class="time"
          type="range"
          min="0"
          :max="take.length"
          step="10"
          :value="at"
          aria-label="Where the take is"
          @input="scrub"
        />
        <span class="muted clock" data-testid="take-clock"
          >{{ ms(at) }} / {{ ms(take.length) }}</span
        >
        <span class="who">
          <span class="muted">Who plays:</span>
          <button
            v-for="part in parts"
            :key="part.id"
            type="button"
            :class="['part', hand.includes(part.id) ? 'you' : 'take']"
            :data-testid="`take-part-${part.id}`"
            :title="hand.includes(part.id) ? 'Give it back to the take' : 'Play it yourself'"
            @click="setHand(part.id, !hand.includes(part.id))"
          >
            {{ part.label }} · {{ hand.includes(part.id) ? 'you' : 'take' }}
          </button>
        </span>
      </template>
      <span v-else class="muted">Do it step by step, at your own pace.</span>
      <span v-if="problems?.length" class="muted problems" :title="problems.join('\n')">
        {{ problems.length }} take{{ problems.length > 1 ? 's' : '' }} could not be read
      </span>
    </footer>
  </div>
</template>

<style scoped>
.take-stage {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template:
    'screen' 1fr
    'bar' auto / 1fr;
  color: #f2f2f2;
  font:
    13px system-ui,
    sans-serif;
  background: #000;
}
.take-stage.steps {
  grid-template:
    'screen deck' 1fr
    'bar bar' auto / 1fr minmax(260px, 320px);
}
.screen {
  grid-area: screen;
  position: relative;
  min-height: 0;
}
.screen > :deep(.plugin-window) {
  position: absolute;
  inset: 0;
}
.marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.marks svg {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.ring {
  fill: none;
  stroke-width: 2.5;
}
.ring.take {
  stroke: #ffd166;
  filter: drop-shadow(0 0 6px #ffd16699);
}
.ring.you {
  stroke: #7cf0ff;
  stroke-dasharray: 7 5;
}
.ring.step {
  stroke: #ffd166;
  stroke-dasharray: 3 5;
}
.ring.step.ok,
.path-end.ok {
  stroke: #8af59a;
  stroke-dasharray: none;
}
.trail {
  fill: none;
  stroke: #ffd166;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.7;
}
.ghost {
  fill: none;
  stroke: #ffd166;
  stroke-width: 2.5;
  stroke-dasharray: 4 3;
}
.path {
  fill: none;
  stroke: #ffd166;
  stroke-width: 2.5;
  stroke-dasharray: 2 6;
  stroke-linecap: round;
  opacity: 0.9;
}
.path-start {
  fill: #ffd166;
}
.path-end {
  fill: none;
  stroke: #ffd166;
  stroke-width: 2.5;
}
.tag {
  position: absolute;
  padding: 1px 7px;
  border-radius: 6px;
  font:
    600 12px/18px system-ui,
    sans-serif;
  white-space: nowrap;
  background: #ffd166;
  color: #1a1400;
}
.tag.you {
  background: #7cf0ff;
  color: #001a1d;
}
.tag.ok {
  background: #8af59a;
  color: #002a07;
}
.deck {
  grid-area: deck;
  overflow: auto;
  padding: 14px 16px;
  background: #121212;
  border-left: 1px solid #2c2c2c;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.deck header {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.deck h3 {
  margin: 0;
  font-size: 17px;
  line-height: 1.35;
}
.deck ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.5;
}
.about {
  margin: 0;
  color: #cfcfcf;
  font-style: italic;
}
.done-mark {
  color: #8af59a;
  font-weight: 600;
}
.actions,
.deck footer {
  display: flex;
  gap: 8px;
}
.state {
  margin: 0;
  color: #bdbdbd;
  line-height: 1.45;
}
.all {
  margin: 6px 0 0;
  padding-left: 22px;
  color: #8f8f8f;
  line-height: 1.4;
}
.take-stage .all button {
  all: unset;
  display: block;
  cursor: pointer;
}
.take-stage .all button:hover {
  text-decoration: underline;
}
.all li.here {
  color: #fff;
}
.all li.done::marker {
  color: #8af59a;
}
.bar {
  grid-area: bar;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  background: #121212;
  border-top: 1px solid #2c2c2c;
}
/* Its own controls, the same wherever it is shown (whatever buttons look like around it). */
.take-stage button,
.take-stage select {
  font: inherit;
  color: #f2f2f2;
  background: #222;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  clip-path: none;
  padding: 4px 10px;
  cursor: pointer;
}
.take-stage button:hover:not(:disabled) {
  background: #2e2e2e;
}
.take-stage button:disabled {
  opacity: 0.4;
  cursor: default;
}
.take-stage button.on,
.take-stage button.go,
.take-stage button.on:hover:not(:disabled),
.take-stage button.go:hover:not(:disabled) {
  background: #ffd166;
  border-color: #ffd166;
  color: #1a1400;
}
.modes {
  display: flex;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  overflow: hidden;
}
.take-stage .modes button {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #bdbdbd;
}
.take-stage .modes button.active,
.take-stage .modes button.active:hover:not(:disabled) {
  background: #f2f2f2;
  color: #111;
}
.pick {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.badge {
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid #6b6b6b;
  color: #cfcfcf;
  font-size: 11.5px;
}
.muted {
  color: #9a9a9a;
}
.time {
  width: 160px;
  accent-color: #ffd166;
}
.clock {
  font-variant-numeric: tabular-nums;
}
.who {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.take-stage .part.take {
  border-color: #ffd16688;
}
.take-stage .part.you {
  border-color: #7cf0ff;
  color: #7cf0ff;
}
.problems {
  margin-left: auto;
}
</style>

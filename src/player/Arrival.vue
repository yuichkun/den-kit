<script lang="ts">
/** A shared link's inside: what the share server gives only to the page (inside.json). */
export interface Inside {
  outside: 'plain' | 'poster' | 'outer' | 'inner' | 'sound';
  reach: 'public' | 'link' | 'person';
  title: string;
  line: string;
  from: string;
  kind: 'Instrument' | 'Effect';
  to: string;
  note: string;
  clip: string | null;
}
</script>

<script setup lang="ts">
// What the person who opens a shared link sees first (Host.publish): the link's inside,
// which only that page asks for, in the work's own look over its plugin screen. A wrapped
// link opens on its wrapping and shows the rest when it is opened; a link for one person
// says who it is for; the note follows; a link with a clip can be heard before the sound
// starts. Playing starts the work's sound and leaves its screen to play.
import { computed, ref } from 'vue';

const props = defineProps<{ inside: Inside; vars: Record<string, string>; starting: boolean }>();
const emit = defineEmits<{ play: [] }>();
const wrapped = ref(props.inside.outside === 'outer' || props.inside.outside === 'inner');
const opened = ref(false);
const listening = ref(false);
const audio = ref<HTMLVideoElement | null>(null);

const kind = computed(() => (props.inside.kind === 'Effect' ? 'An effect' : 'An instrument'));
function open() {
  wrapped.value = false;
  opened.value = true;
  document.title = `${props.inside.title} · den-kit`;
}
function listen() {
  const el = audio.value;
  if (!el) return;
  if (listening.value) {
    el.pause();
    return;
  }
  el.currentTime = 0;
  void el.play();
}
function play() {
  audio.value?.pause();
  emit('play');
}
</script>

<template>
  <div class="arrival" :class="{ wrapped, opened }" :style="vars" data-testid="arrival">
    <div v-if="wrapped" class="wrapping" data-testid="arrival-wrapping">
      <i class="band" /><i class="knot" />
      <div class="label" :class="{ small: inside.outside === 'inner' }">
        <template v-if="inside.outside === 'outer'">
          <span class="small-caps">{{ kind }}, wrapped</span>
          <b class="as-written">{{ inside.title }}</b>
        </template>
        <span class="as-written">{{ inside.from ? `from ${inside.from}` : 'for you' }}</span>
      </div>
      <p v-if="inside.to" class="to as-written" data-testid="arrival-to">For {{ inside.to }}</p>
      <button type="button" class="primary" data-testid="arrival-open" @click="open">Open</button>
    </div>
    <div v-else class="card">
      <p v-if="inside.to" class="to as-written" data-testid="arrival-to">For {{ inside.to }}</p>
      <h1 class="as-written" data-testid="arrival-title">{{ inside.title }}</h1>
      <p class="meta">
        {{ kind
        }}<template v-if="inside.from">
          by <span class="as-written">{{ inside.from }}</span></template
        >
      </p>
      <p v-if="inside.line" class="line as-written">{{ inside.line }}</p>
      <blockquote v-if="inside.note" class="note as-written" data-testid="arrival-note">
        {{ inside.note }}
      </blockquote>
      <div class="actions">
        <button v-if="inside.clip" type="button" data-testid="arrival-listen" @click="listen">
          {{ listening ? 'Pause' : 'Listen first' }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="starting"
          data-testid="arrival-play"
          @click="play"
        >
          {{ starting ? 'Starting…' : 'Play it' }}
        </button>
      </div>
      <video
        v-if="inside.clip"
        ref="audio"
        class="clip"
        :class="{ on: listening }"
        :src="inside.clip"
        preload="auto"
        playsinline
        @play="listening = true"
        @pause="listening = false"
        @ended="listening = false"
      />
      <p class="hint">
        {{
          inside.kind === 'Effect'
            ? 'It plays a test sound through the effect; turn its controls.'
            : 'Play it with your computer keys or a MIDI keyboard.'
        }}
      </p>
      <p v-if="inside.reach === 'person'" class="hint">
        {{ inside.from || 'The person who shared it' }} sees whether this link was opened and
        played, as counts.
      </p>
    </div>
  </div>
</template>

<style scoped>
.arrival {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--dk-bg) 82%, transparent);
  backdrop-filter: blur(6px);
  color: var(--dk-fg);
  font-family: var(--dk-font);
  overflow: auto;
}
.arrival.wrapped {
  background: var(--dk-accent);
  backdrop-filter: none;
}
.arrival.opened .card {
  animation: unwrap 0.5s ease-out;
}
@keyframes unwrap {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
.wrapping {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 20px;
  background-image: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--dk-bg) 14%, transparent) 0 2px,
    transparent 2px 22px
  );
}
.band {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(50% - 26px);
  height: 52px;
  background: var(--dk-bg);
}
.knot {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(78% - 26px);
  width: 52px;
  background: var(--dk-bg);
}
.label {
  position: relative;
  display: grid;
  gap: 10px;
  justify-items: center;
  min-width: min(420px, 80vw);
  padding: 36px 40px;
  background: var(--dk-fg);
  color: var(--dk-bg);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
  text-align: center;
}
.label.small {
  min-width: 0;
  padding: 18px 28px;
}
.label b {
  font-size: clamp(28px, 6vw, 48px);
  line-height: 1.1;
}
.label span {
  font-size: 18px;
}
.small-caps {
  font-family: var(--dk-label-font);
  font-size: 14px !important;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.wrapping .to {
  position: relative;
  margin: 0;
  padding: 4px 12px;
  background: var(--dk-bg);
  color: var(--dk-fg);
  font-size: 16px;
}
.card {
  width: min(560px, 100%);
  display: grid;
  gap: 10px;
  text-align: left;
}
.to {
  margin: 0;
  color: var(--dk-accent);
  font-size: 16px;
  font-weight: 600;
}
h1 {
  margin: 0;
  font-size: clamp(32px, 7vw, 56px);
  line-height: 1.05;
}
.meta {
  margin: 0;
  color: var(--dk-muted);
  font-size: 16px;
}
.line {
  margin: 0;
  font-size: 17px;
  line-height: 1.5;
}
.note {
  margin: 6px 0 0;
  padding: 12px 16px;
  border-left: 3px solid var(--dk-accent);
  background: color-mix(in srgb, var(--dk-fg) 7%, transparent);
  font-size: 16px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}
button {
  padding: 11px 20px;
  font: 600 16px var(--dk-font);
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--dk-fg) 30%, transparent);
  background: transparent;
  color: var(--dk-fg);
  cursor: pointer;
}
button.primary {
  background: var(--dk-accent);
  border-color: var(--dk-accent);
  color: var(--dk-bg);
}
.wrapping button.primary {
  position: relative;
  background: var(--dk-bg);
  border-color: var(--dk-bg);
  color: var(--dk-fg);
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.clip {
  display: none;
  width: 100%;
  border-radius: 8px;
}
.clip.on {
  display: block;
}
.hint {
  margin: 0;
  color: var(--dk-muted);
  font-size: 13px;
}
</style>

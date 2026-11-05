<script setup lang="ts">
// The session clock is separate from the work: tempo is shared deliberately,
// while Start/Stop Sync stays optional for independent sound design and playback.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { Link, LinkCommand, LinkSnapshot } from '../host/link.ts';
import { useSession } from './context.ts';
import { LinkSession, linkPosition } from './link-session.ts';

const props = defineProps<{ link: Link }>();
const emit = defineEmits<{ (event: 'show-patch'): void }>();
const session = useSession();
const state = shallowRef<LinkSnapshot | null>(null);
const error = ref('');
const busy = ref(false);
const tempo = ref('120');
const editingTempo = ref(false);
const click = ref(false);
const help = ref(false);
const now = ref(performance.now());
let timer: ReturnType<typeof setInterval> | null = null;
const clock = new LinkSession(props.link, session.engine, (value, message) => {
  state.value = value;
  error.value = message;
  if (value && !editingTempo.value) tempo.value = String(Math.round(value.tempo * 100) / 100);
  if (!value?.enabled) {
    click.value = false;
    session.engine.setTransportClick(false);
  }
});
const fresh = computed(() => state.value && now.value - state.value.performanceTime < 1000);
const position = computed(() => state.value && linkPosition(state.value, now.value));
const status = computed(() => {
  if (error.value) return error.value;
  if (!state.value) return 'Connecting to clock…';
  if (!fresh.value) return 'Clock interrupted';
  if (!state.value.enabled) return 'Off';
  if (!state.value.peers) return 'Waiting for peers';
  return `${state.value.peers} ${state.value.peers === 1 ? 'peer' : 'peers'}`;
});
const hasTransport = computed(() =>
  Object.values(session.doc.value.nodes).some(node => node.type === 'kit.transport'),
);

async function command(command: LinkCommand) {
  busy.value = true;
  try {
    await clock.request(command);
  } finally {
    busy.value = false;
  }
}
function setTempo() {
  editingTempo.value = false;
  const value = Number(tempo.value);
  if (!Number.isFinite(value) || value < 20 || value > 999) {
    error.value = 'Choose a tempo from 20 to 999 BPM.';
    tempo.value = String(Math.round((state.value?.tempo ?? 120) * 100) / 100);
    return;
  }
  void command({ type: 'tempo', value });
}
async function play() {
  if (!state.value) return;
  if (!state.value.playing && !(await session.ensureAudio())) return;
  await command({ type: 'play', value: !state.value.playing });
}
async function setClick(event: Event) {
  const value = (event.target as HTMLInputElement).checked;
  click.value = value && (await session.ensureAudio());
  session.engine.setTransportClick(click.value);
}
function addTransport() {
  const result = session.commit([{ op: 'addNode', node: { type: 'kit.transport' } }], {
    label: 'Add Transport',
  });
  if (!result.ok) session.toast('warn', result.error.message);
  else {
    session.partPath.value = [];
    session.selection.value = result.created;
    emit('show-patch');
    session.toast('info', 'Connect Transport tempo to BPM, or pulse to a rhythmic gate.');
  }
}
onMounted(() => {
  clock.start();
  timer = setInterval(() => (now.value = performance.now()), 50);
});
onBeforeUnmount(() => {
  clock.dispose();
  session.engine.setTransportClick(false);
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="link-bar" aria-label="Ableton Link" data-testid="link-bar">
    <div class="link-controls">
      <button
        :class="{ active: state?.enabled }"
        :aria-pressed="!!state?.enabled"
        :disabled="busy"
        title="Join or leave the Link session"
        data-testid="link-enable"
        @click="command({ type: 'enable', value: !state?.enabled })"
      >
        Link
      </button>
      <span class="link-status" role="status" data-testid="link-status">{{ status }}</span>
      <label class="tempo">
        <input
          v-model="tempo"
          type="number"
          min="20"
          max="999"
          step="0.01"
          aria-label="Shared tempo in BPM"
          :disabled="!state?.enabled || busy || !fresh"
          data-testid="link-tempo"
          @focus="editingTempo = true"
          @blur="editingTempo = false"
          @change="setTempo"
        />
        BPM
      </label>
      <div class="beats" aria-label="Four-beat cycle" title="Link phase · 4 beats">
        <span
          v-for="beat in 4"
          :key="beat"
          :class="{ current: state?.enabled && fresh && position?.beat === beat - 1 }"
          >{{ beat }}</span
        >
      </div>
      <button
        :disabled="!state?.enabled || busy || !fresh"
        :aria-pressed="!!state?.playing"
        :title="state?.playing ? 'Stop this transport' : 'Start on the next four-beat boundary'"
        data-testid="link-play"
        @click="play"
      >
        {{ state?.playing ? (position?.pending ? 'Cancel start' : 'Stop') : 'Play' }}
      </button>
      <span v-if="position?.pending" class="pending">Next bar…</span>
      <label title="Share future play and stop actions with peers that also enable Start/Stop Sync">
        <input
          type="checkbox"
          :checked="!!state?.startStopSync"
          :disabled="!state?.enabled || busy || !fresh"
          data-testid="link-sync"
          @change="command({ type: 'sync', value: ($event.target as HTMLInputElement).checked })"
        />
        Start/Stop Sync
      </label>
      <label title="Listen to the synchronized beat without changing your patch">
        <input
          type="checkbox"
          :checked="click"
          :disabled="!state?.enabled || !fresh"
          data-testid="link-click"
          @change="setClick"
        />
        Click
      </label>
      <button v-if="!hasTransport" data-testid="link-add-transport" @click="addTransport">
        Add Transport
      </button>
      <button :aria-expanded="help" @click="help = !help">{{ help ? 'Hide help' : 'Help' }}</button>
    </div>
    <div v-if="help" class="link-help">
      <p>
        Enable Link in Live or Cubase on the same computer or local network. Tempo and the four-beat
        cycle are shared; Play starts on the next cycle. Start/Stop Sync shares playback actions
        only when enabled at both ends.
      </p>
      <p>
        Use Click to check the beat. Add Transport to connect tempo to a delay’s BPM, beat or bar
        phase to modulation, and pulse to a rhythmic gate. Other instruments keep playing
        independently. This prototype does not route audio or follow DAW song position.
      </p>
      <p v-if="!state?.peers">
        Waiting for peers? Allow Local Network access for this app in macOS System Settings, check
        the firewall, and enable Link in the other app.
      </p>
    </div>
  </section>
</template>

<style scoped>
.link-bar {
  flex: 0 0 auto;
  color: var(--text-primary);
  background: var(--app-chrome);
  border-bottom: 1px solid var(--line-subtle);
  font: 12px var(--font-ui);
}
.link-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 12px;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.link-status {
  min-width: 7em;
  color: var(--text-muted);
}
.tempo input {
  width: 76px;
  font-family: var(--font-mono);
}
.beats {
  display: flex;
  gap: 3px;
  font-family: var(--font-mono);
}
.beats span {
  width: 18px;
  padding: 2px 0;
  text-align: center;
  color: var(--text-muted);
  background: var(--app-field);
  border-radius: var(--radius-control);
}
.beats .current {
  color: var(--text-on-accent);
  background: var(--accent);
}
.pending {
  color: var(--state-warn);
}
.link-help {
  max-width: 900px;
  padding: 0 12px 8px;
  color: var(--text-muted);
  line-height: 1.5;
}
.link-help p {
  margin: 4px 0;
}
</style>

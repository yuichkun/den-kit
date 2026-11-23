<script setup lang="ts">
// The work with its takes as the person it is handed to sees it in the player
// (screen/takes/TakeStage.vue), opened from the plugin view to try the takes before
// handing the work over. Nothing played here changes the work: the controls move on a
// copy and the sound follows them (LocalPlay), and closing puts the sound back to the
// work. Esc closes.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import TakeStage from '../screen/takes/TakeStage.vue';
import { pluginSpec } from '../screen/build.ts';
import { takesOf } from '../work/takes.ts';
import { useSession } from './context.ts';
import { LocalPlay } from './takes.ts';

const props = defineProps<{ first?: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const session = useSession();
const local = new LocalPlay(session);
const spec = computed(() => pluginSpec(local.doc.value, session.catalog, session.generated.value));
const read = computed(() => takesOf(session.doc.value.files));
// The take asked for first, then the rest in their order.
const takes = computed(() => {
  const list = read.value.flatMap(t => ('take' in t ? [t] : []));
  const i = list.findIndex(t => t.path === props.first);
  return i > 0 ? [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)] : list;
});
const problems = computed(() => read.value.flatMap(t => ('error' in t ? [t.error] : [])));
const stage = ref<InstanceType<typeof TakeStage> | null>(null);
const sounding = computed(() => session.engineState.value === 'running');
const analyser = (probe: number) =>
  probe >= 0 ? (session.engine.probeAnalysers[probe] ?? null) : session.engine.outAnalyser;

// The notes the stage sends are played here; any other note the person plays (the keyboard bar,
// the computer keys, MIDI) the session plays, and the stage hears of it.
let own = false;
function note(n: number, on: boolean, velocity: number) {
  own = true;
  try {
    if (on) session.noteOn(n, velocity);
    else session.noteOff(n);
  } finally {
    own = false;
  }
}
const stopHearing = session.onNote((n, on) => {
  if (!own) stage.value?.heard(n, on);
});
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true);
  stopHearing();
  local.end();
});
</script>

<template>
  <div class="take-room" data-testid="take-room" @pointerdown.stop>
    <header>
      <b>As the person you hand it to</b>
      <span class="muted"
        >This is how the work opens for them, with its takes. Nothing you play here changes the
        work.</span
      >
      <span style="flex: 1" />
      <button
        class="small"
        data-testid="take-room-close"
        title="Back to the plugin (Esc)"
        @click="emit('close')"
      >
        Close <kbd>Esc</kbd>
      </button>
    </header>
    <div class="stage">
      <TakeStage
        v-if="takes.length"
        ref="stage"
        :spec="spec"
        :takes="takes"
        :problems="problems"
        :held="session.heldNotes.value"
        :analyser="analyser"
        :asset-urls="session.assetUrls.value"
        :sounding="sounding"
        @change="(id, values) => local.change(id, values)"
        @note="note"
        @start="session.ensureAudio()"
      />
      <p v-else class="muted none">
        This work has no take yet. Press ● Rec on the plugin and play.
      </p>
    </div>
  </div>
</template>

<style scoped>
.take-room {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background: var(--app-canvas);
}
header {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  font-size: 13px;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.none {
  padding: 40px;
  text-align: center;
}
.small {
  padding: 2px 8px;
  font-size: 12px;
}
kbd {
  font-size: 10.5px;
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-control);
}
</style>

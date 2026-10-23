<script setup lang="ts">
// The bottom of the screen is just the keyboard: click it, use the computer
// keys printed on it (A W S E D F T G Y H U J K, Z/X shift the octave), or play a
// MIDI keyboard (connected automatically). ⌘. stops everything.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { computerKeys, type ComputerKeys } from '../screen/computer-keys.ts';
import { useSession } from './context.ts';

const session = useSession();
/** The note the A key plays. */
const pc = ref(48);
let keys: ComputerKeys | null = null;
function panic(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === '.') {
    e.preventDefault();
    session.panic();
  }
}
onMounted(() => {
  window.addEventListener('keydown', panic);
  keys = computerKeys({
    octaveStart: pc.value,
    onNote: (note, velocity) => (velocity ? session.noteOn(note, velocity) : session.noteOff(note)),
    onOctave: start => (pc.value = start),
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', panic);
  keys?.stop();
});
function onNote(e: Event) {
  const d = (e as CustomEvent<{ note: number; on: boolean; velocity?: number }>).detail;
  if (d.on) session.noteOn(d.note, d.velocity ?? 100);
  else session.noteOff(d.note);
}
</script>

<template>
  <div
    class="keyboard-bar"
    data-testid="keyboard"
    title="Play with the keys shown (A–K); Z / X change the octave; ⌘. stops all sound"
  >
    <dk-keyboard
      :start="String(pc - 12)"
      octaves="4"
      :pc="String(pc)"
      :held="session.heldNotes.value.join(',')"
      class="keys"
      @note="onNote"
    />
  </div>
</template>

<style scoped>
.keyboard-bar {
  padding: 6px 12px 8px;
}
.keys {
  display: block;
  height: 64px;
}
</style>

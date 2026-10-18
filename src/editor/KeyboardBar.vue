<script setup lang="ts">
// The bottom of the screen is just the keyboard: click it, use the computer
// keys printed on it (A W S E D F T G Y H U J K, Z/X shift the octave), or play a
// MIDI keyboard (connected automatically). ⌘. stops everything.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useSession } from './context.ts';

const session = useSession();
const octave = ref(3);
const KEYS = 'awsedftgyhujk';
const down = new Map<string, number>();
function typing(e: KeyboardEvent) {
  return (
    (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]') ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  );
}
function keydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === '.') {
    e.preventDefault();
    session.panic();
    down.clear();
    return;
  }
  if (typing(e) || e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'z') {
    octave.value = Math.max(1, octave.value - 1);
    return;
  }
  if (k === 'x') {
    octave.value = Math.min(7, octave.value + 1);
    return;
  }
  const i = KEYS.indexOf(k);
  if (i < 0) return;
  const note = 12 * (octave.value + 1) + i;
  down.set(k, note);
  session.noteOn(note);
}
function keyup(e: KeyboardEvent) {
  const note = down.get(e.key.toLowerCase());
  if (note !== undefined) {
    down.delete(e.key.toLowerCase());
    session.noteOff(note);
  }
}
function blur() {
  for (const note of down.values()) session.noteOff(note);
  down.clear();
}
onMounted(() => {
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('keyup', keyup);
  window.removeEventListener('blur', blur);
  blur();
});
function onNote(e: Event) {
  const d = (e as CustomEvent<{ note: number; on: boolean }>).detail;
  if (d.on) session.noteOn(d.note);
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
      :start="String(12 * octave)"
      octaves="4"
      :pc="String(12 * (octave + 1))"
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

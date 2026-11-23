<script setup lang="ts">
// Big keys for fingers, under an instrument's screen on a touch screen: a work's own
// keyboard is drawn at its design size and shrinks with the screen, so on a phone
// its keys are too small to hit. The keys play a major pentatonic scale from the C
// the work's own keyboard starts at, so any order of taps sounds in tune; a finger
// that slides across them plays each key it reaches, and each finger plays its own note.
import { computed } from 'vue';

const props = defineProps<{
  held: readonly number[];
  /** The C the keys start from. */
  from: number;
}>();
const emit = defineEmits<{ (e: 'note', note: number, on: boolean, velocity: number): void }>();

const STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
const NAMES = ['C', 'D', 'E', 'G', 'A', 'C', 'D', 'E'];
const NOTES = computed(() => STEPS.map(s => props.from + s));
const fingers = new Map<number, number>();

function noteAt(x: number, y: number): number | null {
  const key = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-note]');
  return key ? Number(key.dataset.note) : null;
}
function press(pointer: number, note: number | null) {
  const was = fingers.get(pointer);
  if (was === note) return;
  if (was !== undefined) {
    fingers.delete(pointer);
    if (![...fingers.values()].includes(was)) emit('note', was, false, 0);
  }
  if (note === null) return;
  fingers.set(pointer, note);
  emit('note', note, true, 100);
}
function down(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  press(e.pointerId, noteAt(e.clientX, e.clientY));
}
function move(e: PointerEvent) {
  if (fingers.has(e.pointerId)) press(e.pointerId, noteAt(e.clientX, e.clientY));
}
function up(e: PointerEvent) {
  press(e.pointerId, null);
}
</script>

<template>
  <div
    class="touch-keys"
    data-testid="touch-keys"
    @pointerdown.prevent="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @contextmenu.prevent
  >
    <div
      v-for="(n, i) in NOTES"
      :key="n"
      class="key"
      :class="{ lit: props.held.includes(n) }"
      :data-note="n"
    >
      <span>{{ NAMES[i] }}</span>
    </div>
  </div>
</template>

<style scoped>
.touch-keys {
  display: flex;
  gap: 6px;
  padding: 8px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.key {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 10px;
  border-radius: 10px;
  background: #f4f1ea;
  color: #6b665c;
  font:
    600 13px system-ui,
    sans-serif;
  box-shadow: inset 0 -4px 0 rgb(0 0 0 / 0.18);
  transition: background 60ms;
}
.key.lit {
  background: #ffd36e;
  box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.18);
}
</style>

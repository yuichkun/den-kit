<script setup lang="ts">
// Play the patch: on-screen keys, computer keyboard (A W S E D F T G Y H U J K, Z/X octave),
// Web MIDI input and the built-in audition phrases.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PHRASES, type PhraseId } from '../core/phrases.ts';
import { useSession } from './context.ts';

const session = useSession();
const octave = ref(3);
const held = ref<number[]>([]);
const midi = ref<'off' | 'on' | 'denied' | 'unsupported'>('off');
const phrase = ref<PhraseId | null>(null);
const KEYS = 'awsedftgyhujk';
const down = new Map<string, number>();
const refresh = () => { held.value = session.engine.heldNotes; };
// The sound controls live here, next to the keys, not in the toolbar.
const audio = computed(() => session.engineState.value);
const audioIn = computed(() => session.generated.value.audioIn);
const on = (note: number, velocity = 100) => { session.engine.noteOn(note, velocity); refresh(); };
const off = (note: number) => { session.engine.noteOff(note); refresh(); };
function typing(e: KeyboardEvent) { return (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey; }
function keydown(e: KeyboardEvent) {
  if (typing(e) || e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { octave.value = Math.max(0, octave.value - 1); return; }
  if (k === 'x') { octave.value = Math.min(8, octave.value + 1); return; }
  const i = KEYS.indexOf(k); if (i < 0) return;
  const note = 12 * (octave.value + 1) + i; down.set(k, note); on(note);
}
function keyup(e: KeyboardEvent) { const note = down.get(e.key.toLowerCase()); if (note !== undefined) { down.delete(e.key.toLowerCase()); off(note); } }
function blur() { for (const note of down.values()) off(note); down.clear(); }
onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); blur(); });
async function connectMidi() {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) { midi.value = 'unsupported'; session.toast('warn', 'Web MIDI is not available in this browser.'); return; }
  try {
    const access = await nav.requestMIDIAccess();
    const bind = () => { for (const input of access.inputs.values()) input.onmidimessage = m => { const [s = 0, a = 0, b = 0] = m.data ?? []; const type = s & 0xf0; if (type === 0x90 && b > 0) on(a, b); else if (type === 0x80 || (type === 0x90 && b === 0)) off(a); }; };
    bind(); access.onstatechange = bind;
    midi.value = 'on';
    session.toast('info', `MIDI connected (${access.inputs.size} input${access.inputs.size === 1 ? '' : 's'}).`);
  } catch (error) { midi.value = 'denied'; session.toast('warn', `MIDI access was refused: ${(error as Error).message}`); }
}
async function play(id: PhraseId) {
  if (phrase.value === id) { session.engine.stopPhrase(); phrase.value = null; refresh(); return; }
  if (!await session.ensureAudio()) return;
  const p = PHRASES[id]; phrase.value = id;
  session.engine.playPhrase(p.events, p.quanta, true);
}
function panic() { session.engine.panic(); phrase.value = null; refresh(); }
function onNote(e: Event) { const d = (e as CustomEvent<{ note: number; on: boolean }>).detail; if (d.on) on(d.note); else off(d.note); }
</script>

<template>
  <div class="keyboard-bar">
    <div class="controls">
      <span class="audio" data-testid="audio-controls">
        <!-- One fixed-width slot: switching from the button to the volume never moves what is under the pointer. -->
        <span class="slot">
          <button v-if="audio !== 'running'" class="primary" data-audio-start data-testid="enable-audio" :title="audio === 'off' ? 'Audio also starts on your first click or key press' : session.engineMessage.value" @click="session.ensureAudio()">{{ audio === 'starting' ? 'Starting audio…' : audio === 'off' ? 'Start audio' : 'Retry audio' }}</button>
          <template v-else><span class="muted">Vol</span><input type="range" min="0" max="1" step="0.01" :value="session.engine.volume" data-testid="volume" @input="session.engine.setVolume(Number(($event.target as HTMLInputElement).value))" /></template>
        </span>
        <button v-if="session.healthMuted.value" class="primary" @click="session.engine.panic(); session.healthMuted.value = false">Reset audio</button>
        <select v-if="audioIn" :value="session.engine.testSignalKind" title="Test input for effect patches" @change="session.engine.setTestSignal(($event.target as HTMLSelectElement).value as never)"><option value="chords">Input: chords</option><option value="drums">Input: drums</option><option value="noise">Input: noise</option><option value="off">Input: off</option></select>
      </span>
      <button v-for="(p, id) in PHRASES" :key="id" :class="{ active: phrase === id }" :data-phrase="id" @click="play(id as PhraseId)">{{ phrase === id ? '■' : '▶' }} {{ p.title }}</button>
      <button :disabled="midi === 'on'" @click="connectMidi">{{ midi === 'on' ? 'MIDI on' : 'Connect MIDI' }}</button>
      <button @click="panic" title="Release all notes and reset DSP state">Panic</button>
      <span class="muted">Keys: <span class="kbd">A</span>–<span class="kbd">K</span>, octave <span class="kbd">Z</span>/<span class="kbd">X</span> ({{ octave }})</span>
    </div>
    <dk-keyboard :octave="String(octave)" :held="held.join(',')" class="keys" @note="onNote" />
  </div>
</template>

<style scoped>
.keyboard-bar { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; padding: 6px 12px; }
.controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: 640px; }
.audio { display: inline-flex; gap: 6px; align-items: center; margin-right: 6px; }
.slot { display: inline-flex; align-items: center; gap: 6px; width: 132px; }
.slot button { width: 100%; }
.slot input[type=range] { flex: 1; min-width: 0; }
.keys { height: 56px; }
button.active { border-color: var(--accent); color: var(--accent); }
</style>

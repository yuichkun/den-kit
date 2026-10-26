<script setup lang="ts">
// What an effect patch hears while you try it: test material, or the computer's
// audio input (a guitar through an interface, a microphone).
import type { TestSignal } from '../sound/audio-engine.ts';
import { useSession } from './context.ts';

const session = useSession();
const INPUTS: Array<[TestSignal, string]> = [
  ['guitar', 'Guitar riff'],
  ['chords', 'Chords'],
  ['drums', 'Drums'],
  ['noise', 'Noise'],
  ['input', 'Audio input (mic / line)'],
  ['off', 'Silence'],
];
</script>

<template>
  <select
    :value="session.input.value"
    data-testid="test-signal"
    title="What this effect hears while you try it"
    @change="session.setInput(($event.target as HTMLSelectElement).value as TestSignal)"
  >
    <option v-for="[id, title] in INPUTS" :key="id" :value="id">{{ title }}</option>
  </select>
</template>

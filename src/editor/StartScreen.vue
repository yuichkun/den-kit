<script setup lang="ts">
// "New": where a patch starts. It appears only when asked for (⌥⌘N, Patch ▸
// New…) and on the very first launch, and goes away as soon as something is
// picked (or with Esc); it never stays on screen. Everything works from the
// keyboard: type what you want and press Enter, or move with the arrows and
// press Enter to start from one of the cards. Picking also starts the audio.
import { computed, nextTick, onMounted, ref } from 'vue';
import { STARTERS, type StarterId } from '../core/starters.ts';
import { emptyDocument } from '../core/schema.ts';
import { useSession } from './context.ts';

const emit = defineEmits<{ (e: 'close', asked: boolean): void }>();
const session = useSession();
interface Card { id: StarterId | 'empty'; title: string; kind: 'Instrument' | 'Effect' | ''; text: string }
const INFO: Record<StarterId, Omit<Card, 'id'>> = {
  bass: { title: 'Bass', kind: 'Instrument', text: 'Mono saw bass with a filter envelope and legato.' },
  percussion: { title: 'Percussion', kind: 'Instrument', text: 'Pitched hits: a pitch drop and a snappy filter.' },
  pad: { title: 'Pad', kind: 'Instrument', text: 'Four-voice saw pad with slow envelopes, vibrato and tremolo.' },
  chorus: { title: 'Chorus', kind: 'Effect', text: 'Stereo chorus for whatever comes in.' },
  rhythmic: { title: 'Rhythmic delay', kind: 'Effect', text: 'Tempo-synced stereo delay with feedback.' },
};
const cards = computed<Card[]>(() => [...STARTERS.map(id => ({ id, ...INFO[id] })), { id: 'empty', title: 'Empty', kind: '', text: 'Start from nothing.' }]);
const COLUMNS = 3;
const current = ref(0);
const text = ref('');
const input = ref<HTMLInputElement | null>(null);

async function choose(card: Card | null) {
  const request = text.value.trim();
  void session.ensureAudio().then(ok => { if (ok) void session.connectMidi(); }); // picking is the click that may start sound
  if (card && card.id !== 'empty') session.loadStarter(card.id);
  else session.replace(emptyDocument(request ? request.slice(0, 40) : 'Untitled'), 'New patch');
  const asked = !card && !!request;
  emit('close', asked);
  if (asked) await session.fast?.run(request, { via: 'typed' });
}
function key(e: KeyboardEvent) {
  const empty = !text.value;
  const move = (d: number) => { e.preventDefault(); current.value = (current.value + d + cards.value.length) % cards.value.length; };
  if (e.key === 'Escape') { e.preventDefault(); emit('close', false); }
  else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void choose(text.value.trim() ? null : cards.value[current.value]!); }
  else if (e.key === 'ArrowDown') move(COLUMNS);
  else if (e.key === 'ArrowUp') move(-COLUMNS);
  else if (e.key === 'ArrowRight' && empty) move(1);
  else if (e.key === 'ArrowLeft' && empty) move(-1);
}
onMounted(() => { void nextTick(() => input.value?.focus()); });
</script>

<template>
  <div class="start-screen" data-testid="start-screen" @keydown="key">
    <div class="sheet">
      <div class="brand"><span class="logo"><i v-for="k in 8" :key="k" /></span>den-kit</div>
      <h1>What do you want to make?</h1>
      <input ref="input" v-model="text" class="describe" type="text" data-testid="start-describe" placeholder="Describe it — e.g. “a warm acid bass”, “ベース作って” — and press Enter" autocomplete="off" spellcheck="false" />
      <div class="or">or start from</div>
      <div class="cards" role="listbox">
        <button v-for="(c, i) in cards" :key="c.id" type="button" class="card" :class="{ current: i === current && !text }" role="option" :aria-selected="i === current" :data-card="c.id" @mouseenter="current = i" @click="text = ''; choose(c)">
          <span class="kind">{{ c.kind }}</span>
          <span class="title">{{ c.title }}</span>
          <span class="text">{{ c.text }}</span>
        </button>
      </div>
      <div class="keys"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> start · <kbd>Esc</kbd> keep the current patch</div>
    </div>
  </div>
</template>

<style scoped>
.start-screen { position: fixed; inset: 0; z-index: 1100; display: grid; place-items: center; background: #0b0b0bf0; backdrop-filter: blur(4px); overflow: auto; }
.sheet { width: min(860px, 92vw); padding: 32px 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; color: #ddd; font-weight: 700; letter-spacing: .08em; margin-bottom: 14px; }
h1 { margin: 0 0 18px; font-size: 32px; font-weight: 400; color: #f4f4f4; }
.describe { width: 100%; font-size: 19px; padding: 14px 16px; border-radius: 10px; border: 1px solid #4a4a4a; background: #141414; color: #f4f4f4; outline: none; }
.describe:focus { border-color: var(--accent); box-shadow: 0 0 0 3px #ff9c1a26; }
.or { margin: 22px 0 10px; color: #8c8c8c; font-size: 14px; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; padding: 16px 18px; min-height: 120px; border-radius: 10px; background: #1d1d1d; border: 1px solid #333; box-shadow: none; }
.card:hover, .card.current { border-color: var(--accent); background: #232323; }
.kind { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8e8e8e; min-height: 14px; }
.title { font-size: 20px; color: #f2f2f2; }
.text { font-size: 14.5px; color: #b5b5b5; line-height: 1.4; }
.keys { margin-top: 18px; color: #8c8c8c; font-size: 13.5px; }
kbd { display: inline-block; min-width: 18px; padding: 0 6px; margin: 0 2px; border: 1px solid #555; border-bottom-width: 2px; border-radius: 4px; background: #222; color: #eee; font: 12px/1.6 Lato, system-ui, sans-serif; text-align: center; }
</style>

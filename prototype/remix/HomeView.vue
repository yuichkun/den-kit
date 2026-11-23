<script setup lang="ts">
// The start: share one of den-kit's example instruments as its author (a name,
// a few words, and whether people may change the inside), or open an example
// passage that three people have already passed on.
import { ref } from 'vue';
import { catalog } from '../../src/sound/blocks/index.ts';
import { randomId } from '../../src/work/schema.ts';
import { WORKS } from '../../src/screen/showcase/index.ts';
import { examplePassage } from './example.ts';
import { encodePassage, MAX_NAME, MAX_WORDS, PASSAGE_VERSION, type Passage } from './passage.ts';
import { shareWork } from './mock-store.ts';

const INSTRUMENTS = WORKS.filter(w => w.kind === 'Instrument');
const work = ref('acid');
const author = ref('Owl');
const words = ref('A squelchy line for late nights. Make it yours.');
const allowInside = ref(true);
const made = ref('');

async function share() {
  const passage: Passage = {
    v: PASSAGE_VERSION,
    id: randomId('passage'),
    work: work.value,
    author: {
      name: author.value.trim() || 'Someone',
      words: words.value.trim(),
      at: Date.now(),
      allowInside: allowInside.value,
    },
    hops: [],
  };
  shareWork({
    id: passage.id,
    work: passage.work,
    author: passage.author.name,
    allowInside: passage.author.allowInside,
    at: passage.author.at,
  });
  made.value = `#p=${await encodePassage(passage)}`;
}

async function openExample() {
  const passage = examplePassage(catalog);
  shareWork({
    id: passage.id,
    work: passage.work,
    author: passage.author.name,
    allowInside: passage.author.allowInside,
    at: passage.author.at,
  });
  location.hash = `p=${await encodePassage(passage)}`;
}
</script>

<template>
  <main class="home">
    <h1>Pass a work on</h1>
    <p class="lead">
      Someone shares an instrument they made. You hear it, change it a little or a lot, say who it
      came from, and pass it on. The author hears what came back.
    </p>
    <section class="card">
      <h2>Share an instrument as its author</h2>
      <label>
        Work
        <select v-model="work" data-testid="home-work">
          <option v-for="w in INSTRUMENTS" :key="w.id" :value="w.id">{{ w.title }}</option>
        </select>
      </label>
      <label>
        Your name
        <input v-model="author" type="text" :maxlength="MAX_NAME" data-testid="home-author" />
      </label>
      <label>
        A few words for whoever gets it
        <textarea v-model="words" rows="2" :maxlength="MAX_WORDS" />
      </label>
      <label class="check">
        <input v-model="allowInside" type="checkbox" data-testid="home-allow" />
        <span>Let people change the inside (the patch and the screen), not only the settings</span>
      </label>
      <button class="primary" type="button" data-testid="home-share" @click="share">
        Make the link
      </button>
      <p v-if="made" class="made">
        The link is ready.
        <a :href="made" data-testid="home-open">Open it as the first person to get it</a>
      </p>
    </section>
    <section class="card">
      <h2>Or look at a passage first</h2>
      <p>
        Acid Line, shared by Owl and passed on by Mika (settings), Juniper (a phrase) and Pico (a
        change inside).
      </p>
      <button type="button" data-testid="home-example" @click="openExample">
        Open the example
      </button>
    </section>
  </main>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}
h1 {
  font-size: 24px;
  margin: 8px 0;
}
.lead {
  color: var(--text-muted);
  margin: 0 0 20px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  background: var(--app-card);
}
h2 {
  font-size: 15px;
  margin: 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
  font-size: 13px;
}
label.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}
.card button {
  align-self: flex-start;
}
.made {
  margin: 0;
}
.made a {
  color: var(--accent-text);
}
p {
  margin: 0;
}
</style>

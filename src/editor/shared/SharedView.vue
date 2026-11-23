<script setup lang="ts">
// The Shared view, a prototype: what the author could learn after sharing this work, made up
// from the work's own controls (after-sharing.ts) and never collected, kept or sent. The same
// made-up story shows as numbers, as what people sent back, or as marks on the plugin; for a link
// anyone can open or links given to specific people; at three amounts den-kit could learn. The
// author's next decisions on the left say which of these answer them. The receiver's side shows
// what a person who gets the link sees, and adds their visit to the story.
import { computed, ref } from 'vue';
import { useSession } from '../context.ts';
import { pluginSpec } from '../../screen/build.ts';
import {
  DECISIONS,
  LENSES,
  LEVELS,
  SCENES,
  answer,
  makeStory,
  nobody,
  receiverLink,
  storyControls,
  withYou,
  type AnswerState,
  type Lens,
  type Level,
  type Scene,
  type You,
} from './after-sharing.ts';
import SharedNumbers from './SharedNumbers.vue';
import SharedReturns from './SharedReturns.vue';
import SharedOnPlugin from './SharedOnPlugin.vue';
import SharedReceiver from './SharedReceiver.vue';

const session = useSession();
const scene = ref<Scene>('public');
const level = ref<Level>('links');
const lens = ref<Lens>('numbers');
const picked = ref<string | null>(null);
const receiving = ref(false);
const spec = computed(() =>
  pluginSpec(session.doc.value, session.catalog, session.generated.value),
);
const controls = computed(() => storyControls(spec.value.widgets));
// The story follows the work and its controls, never their values: applying a setting keeps it.
const base = computed(() => makeStory(scene.value, session.doc.value.id, controls.value));
const yours = ref<Record<Scene, You>>({ public: nobody(), people: nobody() });
const story = computed(() =>
  withYou(base.value, yours.value[scene.value], receiverLink(scene.value)),
);
const decisions = computed(() =>
  DECISIONS.filter(d => d.scene === scene.value).map(d => ({
    d,
    a: answer(d, lens.value, level.value),
  })),
);
const focus = computed(() => DECISIONS.find(d => d.id === picked.value)?.focus ?? []);
const STATE: Record<AnswerState, string> = {
  here: 'Answered here',
  elsewhere: 'Answered in another view',
  partly: 'Partly',
  no: 'Not at this level',
};
const keeps = computed(() => LEVELS.find(l => l.id === level.value)!.keeps);
function pick(id: string) {
  picked.value = picked.value === id ? null : id;
  // Picking a decision shows the view that answers it; its state says whether this level is enough.
  const d = DECISIONS.find(x => x.id === id);
  if (d && picked.value) lens.value = d.lens;
}
function setScene(s: Scene) {
  scene.value = s;
  picked.value = null;
}
</script>

<template>
  <div class="shared" data-testid="shared-view">
    <header class="bar">
      <p class="proto" data-testid="shared-prototype">
        <b>Prototype</b> Every number and message here is made up from this work’s controls. Nothing
        is collected or sent.
      </p>
      <div class="choices">
        <div class="modes" role="group" aria-label="How you shared it">
          <button
            v-for="s in SCENES"
            :key="s.id"
            :class="{ active: scene === s.id }"
            :data-scene="s.id"
            @click="setScene(s.id)"
          >
            {{ s.name }}
          </button>
        </div>
        <div class="modes" role="group" aria-label="What den-kit learns">
          <button
            v-for="l in LEVELS"
            :key="l.id"
            :class="{ active: level === l.id }"
            :data-level="l.id"
            @click="level = l.id"
          >
            {{ l.name }}
          </button>
        </div>
        <div class="modes" role="group" aria-label="Show it as">
          <button
            v-for="l in LENSES"
            :key="l.id"
            :class="{ active: lens === l.id }"
            :data-lens="l.id"
            @click="lens = l.id"
          >
            {{ l.name }}
          </button>
        </div>
        <span class="spacer" />
        <button class="primary" data-testid="shared-receiver-open" @click="receiving = true">
          Open as a receiver
        </button>
      </div>
    </header>
    <div class="columns">
      <aside class="side" data-testid="shared-decisions">
        <h3>Your next decisions</h3>
        <button
          v-for="{ d, a } in decisions"
          :key="d.id"
          class="decision"
          :class="[a.state, { picked: picked === d.id }]"
          :data-decision="d.id"
          :data-answer="a.state"
          :aria-pressed="picked === d.id"
          @click="pick(d.id)"
        >
          <span class="question">{{ d.question }}</span>
          <span class="then">Then: {{ d.next }}</span>
          <span class="state">{{ STATE[a.state] }}</span>
          <span class="why">{{ a.text }}</span>
        </button>
        <h3>What den-kit keeps</h3>
        <p class="keeps" data-testid="shared-keeps">{{ keeps }}</p>
      </aside>
      <main class="lens">
        <SharedNumbers v-if="lens === 'numbers'" :story="story" :level="level" :focus="focus" />
        <SharedReturns
          v-else-if="lens === 'returns'"
          :story="story"
          :level="level"
          :controls="controls"
          :focus="focus"
        />
        <SharedOnPlugin
          v-else
          :story="story"
          :level="level"
          :controls="controls"
          :spec="spec"
          :focus="focus"
        />
      </main>
    </div>
    <SharedReceiver
      v-if="receiving"
      v-model:level="level"
      :story="story"
      :scene="scene"
      :spec="spec"
      :controls="controls"
      :you="yours[scene]"
      @update:you="you => (yours[scene] = you)"
      @close="receiving = false"
    />
  </div>
</template>

<style scoped>
.shared {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--app-canvas);
}
.bar {
  padding: 8px 14px 10px;
  background: var(--app-chrome);
  border-bottom: 1px solid var(--line-subtle);
}
.proto {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.proto b {
  color: var(--text-on-accent);
  background: var(--accent);
  border-radius: var(--radius-control);
  padding: 1px 6px;
  margin-right: 6px;
  font-family: var(--font-control);
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.spacer {
  flex: 1;
}
.modes {
  display: flex;
  background: var(--app-field);
  border-radius: var(--radius-control);
  clip-path: var(--clip-control);
  padding: 2px;
}
.modes button {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--text-muted);
  padding: 3px 10px;
}
.modes button.active {
  background: var(--ink);
  color: var(--text-on-ink);
}
.columns {
  display: grid;
  grid-template-columns: 300px 1fr;
  min-height: 0;
}
.side {
  overflow: auto;
  padding: 12px 14px;
  border-right: 1px solid var(--line-subtle);
  background: var(--app-chrome);
}
h3 {
  margin: 4px 0 8px;
  font-family: var(--font-control);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
  color: var(--text-muted);
}
h3::before {
  content: var(--heading-prefix);
}
.decision {
  display: grid;
  gap: 3px;
  width: 100%;
  margin: 0 0 8px;
  padding: 8px 10px;
  text-align: left;
  font-family: var(--font-ui);
  text-transform: none;
  letter-spacing: normal;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  clip-path: none;
}
.decision.picked {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.question {
  font-weight: 600;
  line-height: 1.3;
}
.then,
.why {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.35;
}
.state {
  font-size: 11.5px;
  font-weight: 600;
  font-family: var(--font-control);
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
}
.here .state {
  color: var(--state-ok);
}
.elsewhere .state {
  color: var(--accent-text);
}
.partly .state {
  color: var(--state-warn);
}
.no .state {
  color: var(--text-muted);
}
.keeps {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
}
.lens {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
</style>

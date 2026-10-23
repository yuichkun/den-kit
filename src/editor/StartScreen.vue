<script setup lang="ts">
// "New": where a patch starts. It appears only when asked for (⌥⌘N, Patch ▸
// New…) and on the very first launch, and goes away as soon as something is
// picked (or with Esc); it never stays on screen. Everything works from the
// keyboard: type what you want and press Enter, or pick a work from the
// showcase (arrows) and, the Subway way, the look it should wear (Tab to the
// looks, arrows, Enter). Sounds without a screen are at the bottom.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { STARTERS, partStarter, type StarterId } from '../work/starters.ts';
import { emptyDocument, type PatchDocument } from '../work/schema.ts';
import { generate } from '../sound/codegen.ts';
import { pluginSpec } from '../screen/build.ts';
import PluginWindow from '../screen/PluginWindow.vue';
import { WORKS, type Work } from '../screen/showcase/index.ts';
import { useSession } from './context.ts';

const emit = defineEmits<{ (e: 'close', asked: boolean): void; (e: 'settings'): void }>();
const session = useSession();
// Settings open from here when the host lets the person manage the AI account in den-kit.
const hasSettings = !!session.host?.ai?.account;
const SOUNDS: Record<StarterId, string> = {
  bass: 'Bass',
  percussion: 'Percussion',
  pad: 'Pad',
  chorus: 'Chorus',
  rhythmic: 'Rhythmic delay',
};
type Section = 'describe' | 'works' | 'looks' | 'sounds';
const section = ref<Section>('describe');
const work = ref(0);
const look = ref(-1); // -1: the work's own look
const sound = ref(0);
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const COLUMNS = 5;
/** Each work built once, with what a small preview of its plugin needs. */
const built = computed(() =>
  WORKS.map(w => {
    const doc: PatchDocument = w.build(session.catalog);
    const urls = Object.fromEntries(
      Object.values(doc.assets)
        .filter(a => a.url)
        .map(a => [a.id, a.url!.startsWith('/') ? a.url! : `/${a.url}`]),
    );
    return {
      work: w,
      spec: pluginSpec(doc, session.catalog, generate(doc, session.catalog)),
      urls,
      accent: doc.ui.look.tokens.accent ?? '#ff9c1a',
      bg: doc.ui.look.tokens.bg ?? '#222',
    };
  }),
);
const sounds = computed(() => [
  { id: 'part' as const, title: 'A part (start small)' },
  ...STARTERS.map(id => ({ id, title: SOUNDS[id] })),
  { id: 'empty' as const, title: 'Empty' },
]);
const chosenLook = computed(() => (look.value >= 0 ? WORKS[look.value] : undefined));

async function start(
  kind: 'describe' | 'work' | 'sound',
  options: { work?: Work; look?: Work; sound?: StarterId | 'empty' | 'part' } = {},
) {
  const request = text.value.trim();
  void session.ensureAudio().then(ok => {
    if (ok) void session.connectMidi();
  }); // picking is the click that may start sound
  // A part: open from the inside; what was typed is asked there (build it small, then use it again).
  const part = kind === 'sound' && options.sound === 'part';
  if (kind === 'work' && options.work) session.loadWork(options.work, options.look);
  else if (part) {
    session.replace(
      partStarter(session.catalog, request ? request.slice(0, 40) : 'Part'),
      'Start from a part',
    );
    session.enterPart('part1');
  } else if (
    kind === 'sound' &&
    options.sound &&
    options.sound !== 'empty' &&
    options.sound !== 'part'
  )
    session.loadStarter(options.sound);
  else session.replace(emptyDocument(request ? request.slice(0, 40) : 'Untitled'), 'New patch');
  const asked = (kind === 'describe' || part) && !!request;
  emit('close', asked);
  if (asked) await session.requests?.run(request, { via: 'typed' });
}
function enter() {
  if (section.value === 'describe' && text.value.trim()) return start('describe');
  if (section.value === 'sounds') return start('sound', { sound: sounds.value[sound.value]!.id });
  return start('work', { work: WORKS[work.value], look: chosenLook.value });
}
const ORDER: Section[] = ['describe', 'works', 'looks', 'sounds'];
// Keys are heard on the window, so moving off the text field (it loses focus) keeps them working.
function focusSection(next: Section) {
  section.value = next;
  if (next === 'describe') void nextTick(() => input.value?.focus());
  else input.value?.blur();
}
function key(e: KeyboardEvent) {
  if (e.isComposing) return;
  const typingText = section.value === 'describe' && !!text.value;
  const move = (list: 'works' | 'looks' | 'sounds', d: number) => {
    e.preventDefault();
    if (list === 'works') work.value = (work.value + d + WORKS.length) % WORKS.length;
    else if (list === 'looks')
      look.value = ((look.value + 1 + d + WORKS.length + 1) % (WORKS.length + 1)) - 1;
    else sound.value = (sound.value + d + sounds.value.length) % sounds.value.length;
  };
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close', false);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.target === input.value && text.value.trim()) void start('describe');
    else void enter();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const i = ORDER.indexOf(section.value);
    focusSection(ORDER[(i + (e.shiftKey ? -1 : 1) + ORDER.length) % ORDER.length]!);
  } else if (typingText) return;
  else if (e.key === 'ArrowDown') {
    if (section.value === 'describe') {
      e.preventDefault();
      focusSection('works');
    } else if (section.value === 'works') {
      if (work.value + COLUMNS < WORKS.length) move('works', COLUMNS);
      else {
        e.preventDefault();
        focusSection('looks');
      }
    } else if (section.value === 'looks') {
      e.preventDefault();
      focusSection('sounds');
    }
  } else if (e.key === 'ArrowUp') {
    if (section.value === 'works') {
      if (work.value - COLUMNS >= 0) move('works', -COLUMNS);
      else {
        e.preventDefault();
        focusSection('describe');
      }
    } else if (section.value === 'looks') {
      e.preventDefault();
      focusSection('works');
    } else if (section.value === 'sounds') {
      e.preventDefault();
      focusSection('looks');
    }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const d = e.key === 'ArrowRight' ? 1 : -1;
    if (section.value === 'describe') {
      e.preventDefault();
      focusSection('works');
    } else move(section.value, d);
  }
}
onMounted(() => {
  window.addEventListener('keydown', key);
  void nextTick(() => input.value?.focus());
});
// On a small window the sheet scrolls: keep what the keys are on in view.
const sheet = ref<HTMLElement | null>(null);
watch(
  [work, look, sound, section],
  () =>
    void nextTick(() =>
      sheet.value
        ?.querySelector<HTMLElement>('.row.current, .work.current')
        ?.scrollIntoView({ block: 'nearest' }),
    ),
);
onBeforeUnmount(() => window.removeEventListener('keydown', key));
</script>

<template>
  <div class="start-screen" data-testid="start-screen">
    <div ref="sheet" class="sheet">
      <div class="brand">
        <span class="logo"><i v-for="k in 8" :key="k" /></span>den-kit
      </div>
      <button
        v-if="hasSettings"
        class="start-settings"
        data-testid="start-settings"
        @click="emit('settings')"
      >
        Settings
      </button>
      <h1>What do you want to make?</h1>
      <input
        ref="input"
        v-model="text"
        class="describe"
        :class="{ current: section === 'describe' }"
        type="text"
        data-testid="start-describe"
        placeholder="Describe it — e.g. “a warm acid bass”, “make a bass” — and press Enter"
        autocomplete="off"
        spellcheck="false"
        @focus="section = 'describe'"
        @input="section = 'describe'"
      />
      <div class="or">
        or start from a work <span class="hint">← → ↑ ↓ choose · Tab: the look · Enter: start</span>
      </div>
      <div class="works" role="listbox">
        <button
          v-for="(b, i) in built"
          :key="b.work.id"
          type="button"
          class="work"
          :class="{
            current: i === work && section !== 'describe' && section !== 'sounds',
            picked: i === work,
          }"
          role="option"
          :aria-selected="i === work"
          :data-work="b.work.id"
          @mouseenter="
            work = i;
            section = section === 'describe' && !text ? 'works' : section;
          "
          @click="
            work = i;
            start('work', { work: b.work, look: chosenLook });
          "
        >
          <div class="preview">
            <PluginWindow
              :spec="
                look >= 0
                  ? {
                      ...b.spec,
                      vars: built[look]!.spec.vars,
                      background: built[look]!.spec.background,
                      css: built[look]!.spec.css,
                    }
                  : b.spec
              "
              :asset-urls="look >= 0 ? { ...b.urls, ...built[look]!.urls } : b.urls"
              preview
            />
          </div>
          <span class="meta"
            ><span class="kind">{{ b.work.kind }}</span
            ><span class="title">{{ b.work.title }}</span></span
          >
          <span class="prompt" :title="b.work.prompt">{{ b.work.prompt }}</span>
        </button>
      </div>
      <div class="row looks" :class="{ current: section === 'looks' }" data-testid="start-looks">
        <span class="label">Look</span>
        <button
          type="button"
          class="chip"
          :class="{ on: look === -1 }"
          data-look="own"
          @click="
            look = -1;
            section = 'looks';
          "
        >
          Its own
        </button>
        <button
          v-for="(b, i) in built"
          :key="b.work.id"
          type="button"
          class="chip"
          :class="{ on: look === i }"
          :data-look="b.work.id"
          :style="{ '--a': b.accent, '--b': b.bg }"
          @click="
            look = i;
            section = 'looks';
          "
        >
          <i />{{ b.work.title }}
        </button>
      </div>
      <div class="row sounds" :class="{ current: section === 'sounds' }">
        <span class="label">Sound only</span>
        <button
          v-for="(s, i) in sounds"
          :key="s.id"
          type="button"
          class="chip"
          :class="{ on: section === 'sounds' && i === sound }"
          :data-card="s.id"
          @mouseenter="sound = i"
          @click="
            sound = i;
            start('sound', { sound: s.id });
          "
        >
          {{ s.title }}
        </button>
      </div>
      <div class="keys">
        <kbd>Tab</kbd> next row · <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> choose ·
        <kbd>Enter</kbd> start · <kbd>Esc</kbd> keep the current patch
      </div>
    </div>
  </div>
</template>

<style scoped>
.start-screen {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: start center;
  background: #0b0b0bf2;
  backdrop-filter: blur(4px);
  overflow: auto;
}
.sheet {
  width: min(1180px, 94vw);
  padding: 24px 0 32px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #ddd;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}
.start-settings {
  float: right;
  color: #bbb;
  border: 1px solid #444;
  background: #222;
  padding: 7px 12px;
  border-radius: 6px;
}
h1 {
  margin: 0 0 16px;
  font-size: 30px;
  font-weight: 400;
  color: #f4f4f4;
}
.describe {
  width: 100%;
  font-size: 18px;
  padding: 13px 16px;
  border-radius: 10px;
  border: 1px solid #4a4a4a;
  background: #141414;
  color: #f4f4f4;
  outline: none;
}
.describe:focus,
.describe.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px #ff9c1a26;
}
.or {
  margin: 20px 0 10px;
  color: #a0a0a0;
  font-size: 14.5px;
  display: flex;
  gap: 14px;
  align-items: baseline;
}
.hint {
  color: #6f6f6f;
  font-size: 13px;
}
.works {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.work {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  padding: 7px 7px 10px;
  border-radius: 12px;
  background: #1b1b1b;
  border: 1px solid #333;
  box-shadow: none;
}
.work.picked {
  border-color: #5a5a5a;
}
.work:hover,
.work.current {
  border-color: var(--accent);
  background: #222;
}
.preview {
  position: relative;
  height: 128px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 8px;
  align-items: baseline;
  padding: 0 3px;
}
.kind {
  font-size: 11.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8e8e8e;
}
.title {
  font-size: 16.5px;
  color: #f2f2f2;
}
.prompt {
  font-size: 13px;
  color: #b5b5b5;
  line-height: 1.45;
  padding: 0 3px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.row.current {
  border-color: #ff9c1a66;
  background: #ff9c1a0d;
}
.label {
  width: 92px;
  color: #a0a0a0;
  font-size: 14px;
}
.chip {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  border-radius: 16px;
  background: #1d1d1d;
  border: 1px solid #3a3a3a;
  box-shadow: none;
  font-size: 14px;
}
.chip i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--b);
  box-shadow: inset 0 0 0 3px var(--a);
}
.chip.on {
  border-color: var(--accent);
  background: #2a2216;
  color: #fff;
}
.keys {
  margin-top: 16px;
  color: #8c8c8c;
  font-size: 13.5px;
}
kbd {
  display: inline-block;
  min-width: 18px;
  padding: 0 6px;
  margin: 0 2px;
  border: 1px solid #555;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #222;
  color: #eee;
  font:
    12px/1.6 Lato,
    system-ui,
    sans-serif;
  text-align: center;
}
</style>

<script setup lang="ts">
// A passage received through a link. The work plays with den-kit's own sound and
// screen; every version before it can be heard again; and the person makes it
// theirs at the depth they like (moving the settings, shaking them, playing a
// phrase, or changing the inside in den-kit's editor) before passing it on with
// their own words, or sending it back to the author. What they changed travels
// as den-kit's operations on the version they received.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import PluginWindow from '../../src/screen/PluginWindow.vue';
import { pluginSpec } from '../../src/screen/build.ts';
import { computerKeys } from '../../src/screen/computer-keys.ts';
import { findWork } from '../../src/screen/showcase/index.ts';
import { controlWriter } from '../../src/editor/play.ts';
import { applyIntents, type Intent, type ResolvedOp } from '../../src/work/ops.ts';
import { randomId, type PatchDocument } from '../../src/work/schema.ts';
import { editorLink, kit, when } from './kit.ts';
import {
  applyChanges,
  buildVersions,
  creditLine,
  decodePassage,
  describeChanges,
  encodePassage,
  MAX_LINK_CHARS,
  MAX_NAME,
  MAX_WORDS,
  phraseText,
  valueOps,
  type ChangeLine,
  type Hop,
  type Passage,
  type Phrase,
  type Version,
} from './passage.ts';
import { PhrasePlayer } from './phrase.ts';
import { shake } from './shake.ts';
import { allowsInside, returnedTo, sendBack } from './mock-store.ts';

const props = defineProps<{ text: string }>();
const catalog = kit.catalog;

const error = ref('');
const passage = shallowRef<Passage | null>(null);
const versions = shallowRef<Version[]>([]);
/** The version the person received: the last one in the link. */
const received = computed(() => versions.value.at(-1) ?? null);
/** Changes made in den-kit's editor, on their way into this person's hop. */
const draft = shallowRef<ResolvedOp[]>([]);
/** What the page's own changes land on: the version received with the editor's changes. */
const start = shallowRef<PatchDocument | null>(null);
/** This person's version as it is now. */
const yours = shallowRef<PatchDocument | null>(null);
const hearing = ref<number | 'yours'>('yours');
const title = computed(() => findWork(passage.value?.work ?? '')?.title ?? '');

const idOf = (which: number | 'yours') =>
  `remix-${passage.value?.id ?? 'none'}-${which === 'yours' ? 'yours' : `v${which}`}`;

onMounted(async () => {
  const read = await decodePassage(props.text);
  if (!read.ok) {
    error.value = read.error;
    return;
  }
  const built = buildVersions(read.value, catalog);
  if (!built.ok) {
    error.value = built.error;
    return;
  }
  passage.value = read.value;
  versions.value = built.value;
  const last = built.value.at(-1)!.doc;
  try {
    start.value = applyChanges(last, read.value.draft ?? [], catalog);
    draft.value = read.value.draft ?? [];
  } catch (e) {
    error.value = `The changes from den-kit's editor cannot be applied: ${e instanceof Error ? e.message : String(e)}`;
    start.value = last;
  }
  yours.value = start.value;
  hear('yours');
});

// The person's own version follows what they move while they hear it.
watch(
  () => kit.doc.value,
  doc => {
    if (hearing.value === 'yours' && doc.id === idOf('yours')) yours.value = doc;
  },
);

/** Hear a version (or the person's own): the session plays it, compiling only when its inside differs. */
function hear(which: number | 'yours') {
  const doc = which === 'yours' ? yours.value : versions.value[which]?.doc;
  if (!doc) return;
  hearing.value = which;
  kit.replace({ ...doc, id: idOf(which) }, which === 'yours' ? 'Yours' : 'Listen', false);
}

// ---- the plugin ---------------------------------------------------------------------------
const spec = computed(() => pluginSpec(kit.doc.value, catalog, kit.generated.value));
const analyser = (probe: number) =>
  probe >= 0 ? (kit.engine.probeAnalysers[probe] ?? null) : kit.engine.outAnalyser;
const onChange = controlWriter(kit);
const audio = ref<'off' | 'starting' | 'on'>(kit.engine.running ? 'on' : 'off');
async function startAudio() {
  audio.value = 'starting';
  audio.value = (await kit.ensureAudio()) ? 'on' : 'off';
}
const status = computed(() => {
  if (kit.compileStatus.value === 'compiling' || kit.compileStatus.value === 'waiting')
    return 'Building the sound…';
  if (kit.compileStatus.value === 'error')
    return `The sound cannot be built: ${kit.compileMessage.value}`;
  if (kit.engineState.value === 'error' || kit.engineState.value === 'suspended')
    return kit.engineMessage.value;
  return '';
});

// ---- notes and phrases ------------------------------------------------------------------
const phrase = new PhrasePlayer((note, velocity) =>
  velocity > 0 ? kit.noteOn(note, velocity) : kit.noteOff(note),
);
const loop = ref(false);
function onNote(note: number, on: boolean, velocity = 100) {
  if (on) kit.noteOn(note, velocity);
  else kit.noteOff(note);
  phrase.note(note, on ? velocity : 0);
}
const keys = computerKeys({ octaveStart: 48, onNote: (n, v) => onNote(n, v > 0, v) });
function playPhrase(p: Phrase) {
  if (phrase.playing.value === p) phrase.stop();
  else phrase.start(p, loop.value);
}
onBeforeUnmount(() => {
  keys.stop();
  phrase.stop();
  kit.panic();
});

// ---- what this person changed -------------------------------------------------------------
const hopOps = computed<ResolvedOp[]>(() =>
  start.value && yours.value ? [...draft.value, ...valueOps(start.value, yours.value)] : [],
);
const yourLines = computed(() =>
  received.value ? describeChanges(received.value.doc, hopOps.value, catalog) : [],
);
const linesOf = (v: Version): ChangeLine[] =>
  v.hop && v.index > 0 ? describeChanges(versions.value[v.index - 1]!.doc, v.hop.ops, catalog) : [];

// ---- shaking --------------------------------------------------------------------------------
const shakeFrom = shallowRef<PatchDocument | null>(null);
const candidates = shallowRef<Intent[][]>([]);
const picked = ref(-1);
function shakeIt() {
  if (!yours.value) return;
  shakeFrom.value = yours.value;
  candidates.value = Array.from({ length: 4 }, () => shake(yours.value!, catalog));
  picked.value = -1;
  if (hearing.value !== 'yours') hear('yours');
}
/** Try a candidate (-1: the settings before shaking); it stays as the person's version. */
function pick(i: number) {
  const from = shakeFrom.value;
  if (!from) return;
  const doc = i < 0 ? from : applyIntents(from, candidates.value[i]!, catalog).doc;
  picked.value = i;
  hearing.value = 'yours';
  kit.replace({ ...doc, id: idOf('yours') }, 'Shake', false);
}
function doneShaking() {
  candidates.value = [];
  shakeFrom.value = null;
}

// ---- passing it on ------------------------------------------------------------------------
const me = ref('');
const words = ref('');
const alsoBack = ref(true);
const made = ref<{ link: string; sent: boolean; only: boolean } | null>(null);
const linkError = ref('');
const copied = ref(false);
const canInside = computed(() => !!passage.value && allowsInside(passage.value));
const people = computed(() =>
  passage.value
    ? [
        ...new Set(
          [passage.value.author.name, ...passage.value.hops.map(h => h.by)].filter(Boolean),
        ),
      ]
    : [],
);
/** What this page sent back (it is this person's, not another version). */
const sent = ref<string[]>([]);
/** Versions that came back to the author and are not in this passage already, nor sent from here. */
const others = computed(() => {
  const p = passage.value;
  if (!p) return [];
  return returnedTo(p.id).filter(
    r => !sent.value.includes(r.id) && !p.hops.some(h => h.at === r.at && h.by === r.by),
  );
});
const credit = computed(() =>
  passage.value
    ? creditLine(
        {
          ...passage.value,
          hops: [
            ...passage.value.hops,
            { by: me.value.trim() || 'you', words: '', at: 0, ops: [] },
          ],
        },
        title.value,
      )
    : '',
);

function thank(name: string) {
  const sep = words.value && !/\s$/.test(words.value) ? ' ' : '';
  words.value = `${words.value}${sep}Thanks, ${name}! `.slice(0, MAX_WORDS);
}

function hop(): Hop {
  const h: Hop = {
    by: me.value.trim() || 'Someone',
    words: words.value.trim(),
    at: Date.now(),
    ops: hopOps.value,
  };
  if (phrase.recorded.value.length) h.phrase = phrase.recorded.value;
  return h;
}

function carries(h: Hop): string[] {
  const lines = received.value ? describeChanges(received.value.doc, h.ops, catalog) : [];
  const out: string[] = [];
  if (lines.some(l => l.kind === 'setting')) out.push('settings');
  if (h.phrase) out.push('a phrase');
  if (lines.some(l => l.kind !== 'setting')) out.push('a change inside');
  return out;
}

async function pass(only: boolean) {
  const p = passage.value;
  if (!p) return;
  linkError.value = '';
  copied.value = false;
  const h = hop();
  // Changes on their way are in this hop now; the link passed on carries only hops.
  const { draft: _, ...rest } = p;
  const next: Passage = { ...rest, hops: [...p.hops, h] };
  const text = await encodePassage(next);
  if (text.length > MAX_LINK_CHARS) {
    linkError.value = `This link would be ${text.length.toLocaleString()} characters long, more than a link can carry here. Files such as pictures cannot travel in a link in this prototype.`;
    return;
  }
  const back = only || alsoBack.value;
  if (back) {
    const id = randomId('back');
    sent.value = [...sent.value, id];
    sendBack({
      id,
      passage: next.id,
      by: h.by,
      via: p.hops.map(x => x.by || 'Someone'),
      words: h.words,
      link: text,
      carries: carries(h),
      at: h.at,
    });
  }
  made.value = { link: `${location.origin}/prototype/remix/#p=${text}`, sent: back, only };
}

async function copy() {
  if (!made.value) return;
  try {
    await navigator.clipboard.writeText(made.value.link);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function openEditor() {
  if (!passage.value) return;
  location.href = await editorLink({ ...passage.value, draft: hopOps.value });
}

// Tests drive the page through the same session and functions.
(window as unknown as { __remix: unknown }).__remix = {
  kit,
  hear,
  shakeIt,
  pick,
  phrase,
  hopOps: () => hopOps.value,
  hearing: () => hearing.value,
};
</script>

<template>
  <main class="receive" data-testid="receive">
    <p v-if="error" class="error" data-testid="receive-error">{{ error }}</p>
    <template v-if="passage && received">
      <section class="stage">
        <div class="hearing">
          <span>
            Hearing
            <strong class="as-written" data-testid="hearing">{{
              hearing === 'yours' ? 'your version' : `${versions[hearing]!.by}'s version`
            }}</strong>
            <span v-if="hearing !== 'yours'" class="muted"> · what you move here is not kept</span>
          </span>
          <span class="ab">
            <button
              type="button"
              :class="{ on: hearing === received.index }"
              data-testid="hear-received"
              @click="hear(received.index)"
            >
              What you got
            </button>
            <button
              type="button"
              :class="{ on: hearing === 'yours' }"
              data-testid="hear-yours"
              @click="hear('yours')"
            >
              Yours
            </button>
          </span>
        </div>
        <div class="window">
          <PluginWindow
            :spec="spec"
            :held="kit.heldNotes.value"
            :analyser="analyser"
            :asset-urls="kit.assetUrls.value"
            @change="onChange"
            @note="onNote"
          />
          <button
            v-if="audio !== 'on'"
            type="button"
            class="primary start"
            data-testid="start-audio"
            :disabled="audio === 'starting'"
            @click="startAudio"
          >
            {{ audio === 'starting' ? 'Starting…' : 'Click to play' }}
          </button>
        </div>
        <p class="status" data-testid="status">
          {{ status || 'Play with the keys A to K on your keyboard, or the keys on the screen.' }}
        </p>
      </section>

      <aside class="side">
        <section>
          <h2>Where it came from</h2>
          <ol class="journey" data-testid="journey">
            <li
              v-for="v in versions"
              :key="v.index"
              :class="{ on: hearing === v.index }"
              :data-testid="`version-${v.index}`"
            >
              <div class="who">
                <strong class="as-written">{{ v.by || 'Someone' }}</strong>
                <span class="muted">{{
                  v.index === 0 ? `made ${title} · ${when(v.at)}` : `passed it on · ${when(v.at)}`
                }}</span>
              </div>
              <p v-if="v.words" class="words as-written">“{{ v.words }}”</p>
              <ul v-if="linesOf(v).length" class="lines">
                <li v-for="l in linesOf(v)" :key="l.text" :class="l.kind">{{ l.text }}</li>
              </ul>
              <div class="row">
                <button type="button" :data-testid="`listen-${v.index}`" @click="hear(v.index)">
                  {{ hearing === v.index ? 'Hearing' : 'Listen' }}
                </button>
                <button
                  v-if="v.hop?.phrase"
                  type="button"
                  :data-testid="`phrase-${v.index}`"
                  @click="playPhrase(v.hop.phrase)"
                >
                  {{
                    phrase.playing.value === v.hop.phrase
                      ? 'Stop'
                      : `Play ${v.by}'s phrase (${phraseText(v.hop.phrase)})`
                  }}
                </button>
              </div>
            </li>
          </ol>
          <div v-if="others.length" class="others" data-testid="others">
            <h3>Other versions that came back to {{ passage.author.name }}</h3>
            <a v-for="r in others" :key="r.id" :href="`#p=${r.link}`" class="as-written">
              {{ r.by }}<span class="muted"> · {{ r.carries.join(', ') || 'words' }}</span>
            </a>
          </div>
        </section>

        <section>
          <h2>Make it yours</h2>
          <p class="hint">Move the controls on the screen. Your changes, from what you got:</p>
          <ul class="lines" data-testid="your-lines">
            <li v-for="l in yourLines" :key="l.text" :class="l.kind">{{ l.text }}</li>
            <li v-if="!yourLines.length" class="none">Nothing yet</li>
          </ul>
          <div class="row">
            <button type="button" data-testid="shake" @click="shakeIt">Shake the settings</button>
            <template v-if="candidates.length">
              <button
                v-for="(_, i) in candidates"
                :key="i"
                type="button"
                :class="{ on: picked === i }"
                :data-testid="`candidate-${i}`"
                @click="pick(i)"
              >
                {{ i + 1 }}
              </button>
              <button type="button" :class="{ on: picked === -1 }" @click="pick(-1)">Before</button>
              <button type="button" data-testid="shake-done" @click="doneShaking">Keep</button>
            </template>
          </div>
          <div class="row">
            <button
              v-if="!phrase.recording.value"
              type="button"
              data-testid="record"
              @click="phrase.record()"
            >
              Record a phrase
            </button>
            <button
              v-else
              type="button"
              class="primary"
              data-testid="record-stop"
              @click="phrase.finish()"
            >
              Stop recording
            </button>
            <template v-if="phrase.recorded.value.length && !phrase.recording.value">
              <button
                type="button"
                data-testid="play-yours"
                @click="playPhrase(phrase.recorded.value)"
              >
                {{
                  phrase.playing.value === phrase.recorded.value
                    ? 'Stop'
                    : `Play yours (${phraseText(phrase.recorded.value)})`
                }}
              </button>
              <button type="button" @click="phrase.clear()">Clear</button>
            </template>
            <label class="check"><input v-model="loop" type="checkbox" /><span>Loop</span></label>
          </div>
          <p v-if="phrase.recording.value" class="hint">
            Recording starts at your first note and stops by itself after 12 seconds.
          </p>
          <div v-if="canInside" class="inside">
            <button type="button" data-testid="open-editor" @click="openEditor">
              Change the inside in den-kit
            </button>
            <p class="hint">
              Opens den-kit's editor in place of the work open there (Undo brings it back). Your
              changes come back here as changes to what you got.
            </p>
          </div>
          <p v-else class="hint" data-testid="inside-kept">
            <span class="as-written">{{ passage.author.name }}</span> keeps the inside of this work
            as it is. Settings and phrases can still be passed on.
          </p>
          <p v-if="draft.length" class="hint">
            Your changes from den-kit's editor are in the list above.
          </p>
        </section>

        <section>
          <h2>Pass it on</h2>
          <label>
            Your name
            <input v-model="me" type="text" :maxlength="MAX_NAME" data-testid="me" />
          </label>
          <p class="credit">
            The link will say: <span class="as-written" data-testid="credit">{{ credit }}</span>
          </p>
          <label>
            Your words, for {{ people.join(', ') }} and whoever gets it next
            <textarea v-model="words" rows="3" :maxlength="MAX_WORDS" data-testid="words" />
          </label>
          <div class="row">
            <button v-for="p in people" :key="p" type="button" class="as-written" @click="thank(p)">
              Thank {{ p }}
            </button>
          </div>
          <label class="check">
            <input v-model="alsoBack" type="checkbox" data-testid="also-back" />
            <span
              >Send it to <span class="as-written">{{ passage.author.name }}</span> too</span
            >
          </label>
          <div class="row">
            <button type="button" class="primary" data-testid="pass" @click="pass(false)">
              Make a link to pass on
            </button>
            <button type="button" data-testid="send-only" @click="pass(true)">
              Only send it to <span class="as-written">{{ passage.author.name }}</span>
            </button>
          </div>
          <p v-if="linkError" class="error">{{ linkError }}</p>
          <div v-if="made" class="made" data-testid="made">
            <template v-if="!made.only">
              <input :value="made.link" type="text" readonly data-testid="made-link" />
              <div class="row">
                <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
                <a :href="made.link" target="_blank" rel="noopener" data-testid="open-next"
                  >Open it as the next person</a
                >
              </div>
            </template>
            <p v-if="made.sent" class="hint" data-testid="sent">
              Sent to <span class="as-written">{{ passage.author.name }}</span
              >'s inbox (in this browser).
            </p>
          </div>
        </section>
      </aside>
    </template>
  </main>
</template>

<style scoped>
.receive {
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  grid-template-rows: minmax(0, 1fr);
  height: max(560px, calc(100vh - 92px));
}
.error {
  grid-column: 1 / -1;
  margin: 16px 20px;
  color: var(--state-danger);
}
.stage {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.hearing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line-subtle);
}
.ab {
  display: flex;
  gap: 4px;
}
button.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--text-on-ink);
}
.window {
  position: relative;
  flex: 1;
  min-height: 0;
}
.window > :deep(*:first-child) {
  position: absolute;
  inset: 0;
}
.start {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  padding: 10px 18px;
}
.status {
  margin: 0;
  padding: 8px 16px;
  color: var(--text-muted);
  font-size: 12px;
  border-top: 1px solid var(--line-subtle);
}
.side {
  min-height: 0;
  border-left: 1px solid var(--line-subtle);
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--app-chrome);
}
.side section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h2 {
  font-size: 15px;
  margin: 0;
}
h3 {
  font-size: 13px;
  margin: 8px 0 4px;
}
.journey {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.journey > li {
  padding: 10px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  background: var(--app-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.journey > li.on {
  border-color: var(--line-strong);
}
.who {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.muted {
  color: var(--text-muted);
  font-size: 12px;
}
.words {
  margin: 0;
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.lines li {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius-control);
  background: var(--app-field);
}
.lines li.inside,
.lines li.screen {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.lines li.none {
  color: var(--text-muted);
  font-family: var(--font-ui);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.row a,
.others a {
  color: var(--accent-text);
}
.others {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.inside {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
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
  gap: 6px;
  color: var(--text-primary);
}
.credit {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.credit span {
  color: var(--text-primary);
}
.made {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.made input {
  font-family: var(--font-mono);
  font-size: 11px;
}
@media (max-width: 900px) {
  .receive {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    height: auto;
  }
  .stage {
    height: 60vh;
  }
  .side {
    border-left: 0;
    border-top: 1px solid var(--line-subtle);
  }
}
</style>

<script setup lang="ts">
// Sharing the open work as a link (Host.publish). The person chooses who the link is for
// and what it shows before it is opened (its outside: what everyone sees where it is
// pasted, which stays there), sees the link as an app would preview it, and writes what
// only the person who opens it sees (its inside: who it is for and a note, which stopping
// the link takes away). The links made for this work are listed with their counts and can
// be stopped one at a time.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type {
  LinkFace,
  LinkPreview,
  Outside,
  Publish,
  PublishedLink,
  Reach,
} from '../../host/index.ts';
import type { KitSession } from '../session.ts';
import { buildPlayable } from '../playable.ts';
import { posterPicture, workLook, wrappingPicture, type OutsideWords } from './outside.ts';
import { recordClip, type Clip } from './clip.ts';

const props = defineProps<{ session: KitSession; publish: Publish }>();
const emit = defineEmits<{ close: [] }>();
const session = props.session;
const publish = props.publish;

const REACHES: Array<{ id: Reach; label: string; help: string }> = [
  {
    id: 'public',
    label: 'Anyone',
    help: 'Listed: search engines and other people can find it.',
  },
  {
    id: 'link',
    label: 'People with the link',
    help: 'Not listed. Anyone who gets the link can open it.',
  },
  {
    id: 'person',
    label: 'One person',
    help: 'A link just for them, which you can stop on its own.',
  },
];
const OUTSIDES: Array<{ id: Outside; label: string; help: string }> = [
  { id: 'plain', label: 'Page title only', help: 'What a playable build shows today.' },
  { id: 'poster', label: 'Poster', help: 'The plugin screen, its name and yours.' },
  { id: 'outer', label: 'Wrapped, named', help: 'Its name and yours on the wrapping.' },
  { id: 'inner', label: 'Wrapped', help: 'Only who it is from; the rest is inside.' },
  { id: 'sound', label: 'Poster with sound', help: 'Plays in place where apps play video.' },
];
/** What each way of giving shows unless the person picks another outside. */
const SUGGESTED: Record<Reach, Outside> = { public: 'poster', link: 'poster', person: 'inner' };

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const reach = ref<Reach>('link');
const outside = ref<Outside>(SUGGESTED.link);
const picked = ref(false);
const title = ref(session.doc.value.name);
const line = ref('');
const from = ref(read('den-kit:share-from'));
const to = ref('');
const note = ref('');
const kind = computed<'Instrument' | 'Effect'>(() =>
  session.generated.value.audioIn ? 'Effect' : 'Instrument',
);
const look = computed(() => workLook(session.doc.value));

const screen = shallowRef<Uint8Array | null>(null);
const image = shallowRef<Uint8Array | null>(null);
const clip = shallowRef<Clip | null>(null);
const clipUrl = ref('');
const preview = ref<LinkPreview | null>(null);
const links = ref<PublishedLink[]>([]);
const made = ref<PublishedLink | null>(null);
const busy = ref<'' | 'clip' | 'create'>('');
const drawing = ref(false);
const error = ref('');
const copied = ref('');

watch(reach, r => {
  if (!picked.value) outside.value = SUGGESTED[r];
});
function pick(id: Outside) {
  outside.value = id;
  picked.value = true;
}

const work = () => ({ id: session.doc.value.id, name: session.doc.value.name });
const words = (): OutsideWords => ({
  title: title.value.trim() || session.doc.value.name || 'Untitled',
  from: from.value.trim(),
  kind: kind.value,
  line: line.value.trim(),
});
const face = (): LinkFace => ({
  outside: outside.value,
  reach: reach.value,
  ...words(),
  color: look.value.accent,
  image: image.value,
  clip: outside.value === 'sound' ? clip.value : null,
  to: reach.value === 'person' ? to.value.trim() : '',
  note: note.value.trim(),
});

let drawn = 0;
/** The outside's picture for the current words, and the link as an app would preview it. */
async function draw() {
  const serial = ++drawn;
  drawing.value = true;
  error.value = '';
  try {
    const o = outside.value;
    const picture =
      o === 'plain'
        ? null
        : o === 'poster' || o === 'sound'
          ? await posterPicture(screen.value, words(), look.value)
          : await wrappingPicture(words(), look.value, o === 'outer');
    if (serial !== drawn) return;
    image.value = picture;
    const seen = await publish.preview(face());
    if (serial === drawn) preview.value = seen;
  } catch (e) {
    if (serial === drawn) error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (serial === drawn) drawing.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
// The work's colors and fonts as text: the document changes for many reasons, its look seldom.
const lookKey = computed(() => JSON.stringify(look.value));
watch([outside, title, line, from, kind, lookKey, reach, clip], () => {
  clearTimeout(timer);
  timer = setTimeout(() => void draw(), 250);
});
// The link shown below was made with the words before the person changed them.
watch([reach, outside, title, line, from, to, note, clip], () => {
  made.value = null;
});

async function refresh() {
  links.value = await publish.links(work()).catch(() => links.value);
}

onMounted(async () => {
  try {
    screen.value = (await session.look({ picture: true })).png;
  } catch {
    screen.value = null;
  }
  await Promise.all([draw(), refresh()]);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  if (clipUrl.value) URL.revokeObjectURL(clipUrl.value);
});

async function record() {
  busy.value = 'clip';
  error.value = '';
  try {
    const poster = await posterPicture(screen.value, words(), look.value);
    const made = await recordClip(session, poster, look.value.accent);
    if (clipUrl.value) URL.revokeObjectURL(clipUrl.value);
    clipUrl.value = URL.createObjectURL(new Blob([made.bytes as BlobPart], { type: made.type }));
    clip.value = made;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = '';
  }
}

const ready = computed(
  () =>
    !busy.value &&
    !drawing.value &&
    (outside.value === 'plain' || !!image.value) &&
    (outside.value !== 'sound' || !!clip.value) &&
    (reach.value !== 'person' || !!to.value.trim()),
);

async function create() {
  busy.value = 'create';
  error.value = '';
  try {
    const { build, notes } = await buildPlayable(session, session.doc.value);
    for (const n of notes) session.toast('warn', n);
    made.value = await publish.create(work(), build, face());
    try {
      localStorage.setItem('den-kit:share-from', from.value.trim());
    } catch {
      /* private mode */
    }
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = '';
  }
}

async function stop(link: PublishedLink) {
  try {
    await publish.stop(link.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
  await refresh();
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copied.value = url;
  } catch {
    copied.value = '';
  }
}

const reachLabel = (id: Reach) => REACHES.find(r => r.id === id)?.label ?? id;
const outsideLabel = (id: Outside) => OUTSIDES.find(o => o.id === id)?.label ?? id;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const when = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
</script>

<template>
  <div class="share-shade" @click.self="emit('close')">
    <section
      class="share"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      data-testid="share-dialog"
    >
      <header>
        <h2 id="share-title">Share as a link</h2>
        <button aria-label="Close" @click="emit('close')">×</button>
      </header>
      <div class="body">
        <div class="form">
          <h3>Who it's for</h3>
          <div class="choices" role="radiogroup" aria-label="Who it's for">
            <label v-for="r in REACHES" :key="r.id" class="choice" :class="{ on: reach === r.id }">
              <input
                v-model="reach"
                type="radio"
                name="reach"
                :value="r.id"
                :data-testid="`share-reach-${r.id}`"
              />
              <b>{{ r.label }}</b>
              <span>{{ r.help }}</span>
            </label>
          </div>
          <label v-if="reach === 'person'" class="field"
            >Their name<input
              v-model="to"
              class="as-written"
              type="text"
              maxlength="60"
              placeholder="Shown to them when they open it"
              data-testid="share-to"
          /></label>

          <h3>What everyone sees where it's pasted</h3>
          <div class="outsides" role="radiogroup" aria-label="What everyone sees">
            <button
              v-for="o in OUTSIDES"
              :key="o.id"
              type="button"
              role="radio"
              :aria-checked="outside === o.id"
              class="outside"
              :class="{ on: outside === o.id }"
              :data-testid="`share-outside-${o.id}`"
              @click="pick(o.id)"
            >
              <b>{{ o.label }}</b>
              <span>{{ o.help }}</span>
            </button>
          </div>
          <div v-if="outside !== 'plain'" class="fields">
            <label class="field"
              >Name<input
                v-model="title"
                class="as-written"
                type="text"
                maxlength="80"
                data-testid="share-title"
            /></label>
            <label class="field"
              >From<input
                v-model="from"
                class="as-written"
                type="text"
                maxlength="60"
                placeholder="Your name"
                data-testid="share-from"
            /></label>
            <label v-if="outside === 'poster' || outside === 'sound'" class="field"
              >One line<input
                v-model="line"
                class="as-written"
                type="text"
                maxlength="160"
                placeholder="What it is, in a few words"
                data-testid="share-line"
            /></label>
          </div>
          <div v-if="outside === 'sound'" class="clip">
            <button type="button" :disabled="!!busy" data-testid="share-record" @click="record">
              {{
                busy === 'clip' ? 'Recording 8 s…' : clip ? 'Record again' : 'Record an 8 s clip'
              }}
            </button>
            <span class="help">It plays the work as it records, so you hear what they will.</span>
            <video
              v-if="clipUrl"
              :src="clipUrl"
              controls
              preload="metadata"
              data-testid="share-clip"
            />
          </div>
          <p v-if="outside === 'inner'" class="help">
            Its name shows only when the link is opened.
          </p>
          <p class="help">
            Once the link is pasted somewhere, this stays there, even after you stop the link.
          </p>

          <h3>What only the person who opens it sees</h3>
          <label class="field note"
            >Note<textarea
              v-model="note"
              class="as-written"
              rows="2"
              maxlength="600"
              placeholder="A few words for them"
              data-testid="share-note"
            />
          </label>
          <p class="help">
            {{
              reach === 'person' && to.trim()
                ? `“For ${to.trim()}” and your note show when the link is opened. Stopping the link takes them away.`
                : 'Your note shows when the link is opened. Stopping the link takes it away.'
            }}
          </p>
        </div>

        <div class="seen">
          <h3>As a link preview</h3>
          <figure
            v-if="preview"
            class="card"
            :class="{ busy: drawing }"
            data-testid="share-preview"
          >
            <i class="edge" :style="{ background: preview.color ?? undefined }" />
            <div class="words">
              <span class="site">{{ preview.site }}</span>
              <b class="title as-written">{{ preview.title }}</b>
              <span v-if="preview.description" class="description as-written">{{
                preview.description
              }}</span>
            </div>
            <img v-if="preview.image" :src="preview.image" alt="" />
            <span v-if="preview.video" class="help"
              >Apps that play a link's video play the clip here.</span
            >
            <span v-if="preview.robots" class="help">Search engines are asked not to list it.</span>
          </figure>
          <p v-else class="help">{{ drawing ? 'Drawing…' : '' }}</p>
          <a v-if="publish.lab" class="lab" :href="publish.lab" target="_blank" rel="noopener"
            >See links in chat apps' previews</a
          >
        </div>
      </div>

      <footer>
        <button
          type="button"
          class="primary"
          :disabled="!ready"
          data-testid="share-create"
          @click="create"
        >
          {{ busy === 'create' ? 'Making the link…' : 'Make link' }}
        </button>
        <template v-if="made">
          <input
            class="url"
            :value="made.url"
            readonly
            data-testid="share-url"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button type="button" @click="copy(made.url)">
            {{ copied === made.url ? 'Copied' : 'Copy' }}
          </button>
          <a :href="made.url" target="_blank" rel="noopener">Open</a>
        </template>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </footer>

      <div v-if="links.length" class="links" data-testid="share-links">
        <h3>Links to this work</h3>
        <ul>
          <li
            v-for="l in links"
            :key="l.id"
            :class="{ stopped: l.stopped }"
            :data-testid="`share-link-${l.id}`"
          >
            <span class="what"
              >{{ outsideLabel(l.face.outside) }} · {{ reachLabel(l.face.reach)
              }}<template v-if="l.face.to"
                >: <span class="as-written">{{ l.face.to }}</span></template
              ></span
            >
            <span class="help">{{ when(l.created) }}</span>
            <span class="counts"
              >{{ plural(l.counts.previews, 'preview') }} · {{ plural(l.counts.opens, 'open') }} ·
              {{ plural(l.counts.plays, 'play') }}</span
            >
            <span v-if="l.stopped" class="help">Stopped</span>
            <template v-else>
              <button type="button" @click="copy(l.url)">
                {{ copied === l.url ? 'Copied' : 'Copy' }}
              </button>
              <button type="button" :data-testid="`share-stop-${l.id}`" @click="stop(l)">
                Stop
              </button>
            </template>
          </li>
        </ul>
        <p class="help">Counts only: nothing about who opened a link is kept.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.share-shade {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-canvas) 60%, transparent);
  padding: 24px;
}
.share {
  width: min(980px, 100%);
  max-height: 92vh;
  overflow: auto;
  background: var(--app-chrome);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-dialog);
  font-size: 14px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--line-subtle);
}
h2 {
  margin: 0;
  font-size: 20px;
}
h3 {
  margin: 20px 0 8px;
  font-size: 14px;
}
h3:first-child {
  margin-top: 0;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 400px);
  gap: 28px;
  padding: 20px 24px;
}
.choices,
.outsides {
  display: grid;
  gap: 6px;
}
.outsides {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.choice,
.outside {
  display: grid;
  gap: 2px;
  text-align: left;
  border: 1px solid var(--line-subtle);
  background: var(--app-field);
  color: inherit;
  border-radius: var(--radius-control);
  padding: 8px 10px;
  font: inherit;
  cursor: pointer;
}
.choice {
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  align-items: baseline;
}
.choice span {
  grid-column: 2;
}
.choice span,
.outside span,
.help {
  color: var(--text-muted);
  font-size: 12px;
}
.choice.on,
.outside.on {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.fields {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.field {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.field.note {
  align-items: start;
}
input[type='text'],
textarea,
.url {
  border: 1px solid var(--line-subtle);
  background: var(--app-field);
  color: inherit;
  border-radius: var(--radius-control);
  padding: 7px 10px;
  font: inherit;
  min-width: 0;
}
textarea {
  resize: vertical;
}
.clip {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  justify-items: start;
}
.clip video {
  width: min(100%, 360px);
  border-radius: var(--radius-control);
}
button,
footer a,
.lab {
  border: 1px solid var(--line-subtle);
  background: var(--app-field);
  color: inherit;
  border-radius: var(--radius-control);
  padding: 7px 12px;
  font: inherit;
  cursor: pointer;
  text-decoration: none;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.card {
  margin: 0;
  display: grid;
  grid-template-columns: 4px 1fr;
  gap: 8px 12px;
  padding: 12px 12px 12px 0;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  background: var(--app-field);
  transition: opacity 0.2s;
}
.card.busy {
  opacity: 0.6;
}
.card .edge {
  grid-row: 1 / span 4;
  border-radius: var(--radius-control);
  background: var(--line-subtle);
}
.card .words {
  display: grid;
  gap: 2px;
}
.card .site {
  font-size: 12px;
  color: var(--text-muted);
}
.card .title {
  font-size: 15px;
}
.card .description {
  font-size: 13px;
}
.card img {
  grid-column: 2;
  width: 100%;
  border-radius: var(--radius-control);
}
.card .help {
  grid-column: 2;
}
.lab {
  display: inline-block;
  margin-top: 10px;
  font-size: 13px;
}
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--line-subtle);
}
.url {
  flex: 1;
  min-width: 240px;
}
.error {
  flex-basis: 100%;
  margin: 0;
  color: var(--state-danger);
}
.links {
  padding: 4px 24px 20px;
}
.links ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.links li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 8px 10px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-control);
}
.links li.stopped {
  opacity: 0.6;
}
.links .what {
  font-weight: 600;
}
.links .counts {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
}
@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>

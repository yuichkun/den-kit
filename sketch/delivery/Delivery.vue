<script setup lang="ts">
// The delivery sketch: what a person who was handed a sound tool (a playable build and
// the author's side, delivery.json) can do with it. Three tabs hand over three things
// to compare: the author's screen with every control, a map of the range the author
// named, and the recipient's own order sheet. Every tab can keep a setting; kept
// settings and the sheet name their version, and go back to the author as a link.
// With ?reply= the author reads such a link: the same steps, from the same version.
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowReactive,
  shallowRef,
  watch,
} from 'vue';
import { POD, type CodePartSource } from '../../src/screen/code-frames.ts';
import { LiveSound } from './audio.ts';
import { DELIVERY, type DeliveryContext } from './context.ts';
import {
  decodeReply,
  loadState,
  readState,
  saveState,
  type Kept,
  type RecipientState,
  type Reply,
  type Sheet,
} from './record.ts';
import { readSpec, seedOf, type DeliverySpec } from './spec.ts';
import { loadBuild, type Build } from './sound.ts';
import ScreenTab from './ScreenTab.vue';
import MapTab from './MapTab.vue';
import SheetTab from './SheetTab.vue';
import KeptPanel from './KeptPanel.vue';
import SendDialog from './SendDialog.vue';
import VersionPanel from './VersionPanel.vue';

type Tab = 'screen' | 'map' | 'sheet';
const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'screen', label: "The author's screen", hint: 'Every control, over its whole range' },
  { id: 'map', label: 'Map', hint: 'Between the places the author named' },
  { id: 'sheet', label: 'Order sheet', hint: 'Your list of files, filled with variations' },
];

const query = new URLSearchParams(location.search);
const work = /^[\w-]{1,40}$/.test(query.get('work') ?? '') ? query.get('work')! : 'footsteps';
const folder = new URL(`delivery/${work}/`, location.href).href;

const failure = ref('');
const spec = shallowRef<DeliverySpec | null>(null);
// Builds are never reactive: their processor's description goes to the audio worklet as it is.
const builds = shallowReactive<Record<string, Build>>({});
const loading = new Map<string, Promise<Build>>();
const reply = shallowRef<Reply | null>(null);
const state = reactive<RecipientState>({
  version: '',
  kept: [],
  sheet: { rows: [], cells: {}, naming: '', channels: 1 },
  name: '',
});
const hashTab = location.hash.slice(1);
const tab = ref<Tab>(TABS.some(t => t.id === hashTab) ? (hashTab as Tab) : 'screen');
const sending = ref(false);
const live = new LiveSound();

// The code parts' pages (none in the delivered works): the screen asks for them.
const parts: CodePartSource = {
  available: false,
  portal: ref(null),
  state: ref('ready'),
  message: ref('This delivery has no code parts.'),
  reloads: ref(0),
  ensure: async () => undefined,
  report: () => undefined,
};
provide(POD, parts);

function build(version: string): Promise<Build> {
  const info = spec.value?.versions.find(v => v.id === version);
  if (!info) return Promise.reject(new Error(`This delivery has no version ${version}.`));
  let made = loading.get(version);
  if (!made) {
    made = loadBuild(new URL(`${info.folder}/`, folder).href).then(
      b => (builds[version] = markRaw(b)),
    );
    loading.set(version, made);
  }
  return made;
}

const active = computed(() => builds[state.version] ?? null);

/** The sheet a fresh recipient starts with: a few surfaces, walking and running, four files each. */
function freshSheet(s: DeliverySpec): Sheet {
  const cells: Sheet['cells'] = {};
  for (const point of s.points.slice(0, 3))
    for (const option of s.condition.options.slice(0, 2)) {
      const row = `point:${point.name}`;
      cells[`${row}|${option.name}`] = {
        count: 4,
        seeds: [0, 1, 2, 3].map(i => seedOf(`${row}|${option.name}|${i}`)),
        locked: [false, false, false, false],
      };
    }
  return { rows: [], cells, naming: s.naming, channels: 1 };
}

const readonly = computed(() => !!reply.value);

function keep(item: Pick<Kept, 'name' | 'setting' | 'from' | 'pos'>) {
  const b = active.value;
  if (!b || readonly.value) return;
  state.kept.unshift({
    ...item,
    id: `k${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    version: state.version,
    fingerprint: b.fingerprint,
  });
}

onMounted(async () => {
  try {
    const response = await fetch(new URL('delivery.json', folder));
    if (!response.ok) throw new Error(`There is no delivery named ${work}.`);
    const read = readSpec(await response.json());
    if ('error' in read) throw new Error(read.error);
    spec.value = read;
    const controls = new Set(
      read.points.flatMap(p => Object.keys(p.values)).concat(Object.keys(read.spread)),
    );
    const fresh: RecipientState = {
      version: read.delivered,
      kept: [],
      sheet: freshSheet(read),
      name: '',
    };
    const replyText = query.get('reply');
    if (replyText) {
      const decoded = decodeReply(replyText, controls, { ...fresh.sheet, cells: {} });
      if ('error' in decoded) throw new Error(decoded.error);
      if (decoded.work !== work) throw new Error('This reply is for another delivery.');
      reply.value = decoded;
      Object.assign(state, {
        version: read.versions.some(v => v.id === decoded.version)
          ? decoded.version
          : read.delivered,
        kept: decoded.kept,
        sheet: decoded.sheet ?? { ...fresh.sheet, cells: {} },
        name: decoded.name,
      });
    } else {
      Object.assign(state, readState(loadState(work), controls, fresh));
      if (!read.versions.some(v => v.id === state.version)) state.version = read.delivered;
      watch(state, () => saveState(work, state), { deep: true });
    }
    await build(state.version);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
});

watch(tab, t => history.replaceState(null, '', `${location.pathname}${location.search}#${t}`));

/** Does the reply's version match the build this page has under that name? */
const replyCheck = computed(() => {
  const r = reply.value,
    b = active.value;
  if (!r || !b) return null;
  if (r.version !== state.version)
    return { ok: false, text: `Made with ${r.version}, which this page does not have.` };
  if (r.fingerprint && r.fingerprint !== b.fingerprint)
    return {
      ok: false,
      text: `Made with ${r.version} (${r.fingerprint}), but ${r.version} here is ${b.fingerprint}: the sound may differ.`,
    };
  return { ok: true, text: `Made with ${r.version} (${b.fingerprint}), the same build you have.` };
});

const ownPage = `${location.pathname}?work=${encodeURIComponent(work)}`;

const context = computed<DeliveryContext | null>(() =>
  spec.value
    ? {
        work,
        spec: spec.value,
        build,
        builds,
        active,
        state,
        readonly: readonly.value,
        live,
        keep,
      }
    : null,
);
const provided = {} as DeliveryContext;
watch(context, c => c && Object.assign(provided, c), { immediate: true });
provide(DELIVERY, provided);

(window as unknown as { __delivery: unknown }).__delivery = { state, builds, live, spec };
onBeforeUnmount(() => live.dispose());
</script>

<template>
  <div class="delivery" data-testid="delivery">
    <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
    <template v-else-if="spec">
      <header class="top">
        <div class="name">
          <h1 class="as-written">{{ spec.title }}</h1>
          <span class="from">from the author</span>
        </div>
        <nav class="tabs" role="tablist">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            :aria-selected="tab === t.id"
            :class="{ on: tab === t.id }"
            :data-testid="`tab-${t.id}`"
            @click="tab = t.id"
          >
            <span class="label">{{ t.label }}</span>
            <span class="hint">{{ t.hint }}</span>
          </button>
        </nav>
        <div class="actions">
          <VersionPanel v-if="context" />
          <button
            v-if="!readonly"
            type="button"
            class="primary"
            data-testid="send-open"
            @click="sending = true"
          >
            Send to the author
          </button>
        </div>
      </header>
      <section v-if="reply" class="reply" data-testid="reply-banner">
        <div>
          <strong>Sent back to you by {{ reply.name || 'the recipient' }}</strong>
          <p v-if="reply.message" class="as-written message">“{{ reply.message }}”</p>
          <p v-if="replyCheck" :class="['check', replyCheck.ok ? 'ok' : 'warn']">
            {{ replyCheck.text }}
          </p>
        </div>
        <a :href="ownPage" class="leave">Leave the reply</a>
      </section>
      <p v-else-if="spec.message" class="message as-written">{{ spec.message }}</p>
      <main v-if="context && active" class="body">
        <section class="tab-body">
          <ScreenTab v-if="tab === 'screen'" />
          <MapTab v-else-if="tab === 'map'" />
          <SheetTab v-else />
        </section>
        <KeptPanel class="kept" />
      </main>
      <p v-else class="loading">Loading the sound…</p>
      <SendDialog v-if="sending" @close="sending = false" />
    </template>
    <p v-else class="loading">Loading the delivery…</p>
  </div>
</template>

<style scoped>
.delivery {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.top {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
}
.name {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: var(--weight-title);
}
.from {
  color: var(--text-muted);
}
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}
.tabs button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: 1px solid transparent;
  padding: 6px 12px;
}
.tabs button.on {
  border: var(--button-line);
  background: var(--app-field);
}
.tabs .label {
  font-weight: 600;
}
.tabs .hint {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: none;
  letter-spacing: normal;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.message {
  margin: 0;
  padding: 8px 20px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--line-subtle);
}
.reply {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 10px 20px;
  background: var(--app-field);
  border-bottom: 1px solid var(--line-subtle);
}
.reply p {
  margin: 4px 0 0;
}
.reply .message {
  padding: 0;
  border: 0;
  color: var(--text-primary);
}
.check.ok {
  color: var(--state-ok);
}
.check.warn {
  color: var(--state-warn);
}
.leave {
  color: var(--accent-text);
  white-space: nowrap;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  min-height: 0;
}
.tab-body {
  min-width: 0;
  overflow: auto;
}
.kept {
  border-left: 1px solid var(--line-subtle);
  overflow: auto;
}
.loading,
.failure {
  padding: 24px;
  color: var(--text-muted);
}
.failure {
  color: var(--state-danger);
}
</style>

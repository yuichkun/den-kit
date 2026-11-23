<script setup lang="ts">
// Plays a playable build (src/work/playable.ts) from the files next to its page:
// the work's screen, drawn by `screen`, and its compiled sound, loaded by `sound`.
// Nothing compiles here and nothing is saved: a value moved on the screen is the
// player's own state (the sound follows it), never the work's record. The code
// parts come from their own origin, named by ?parts=: never from the player's
// origin, where they could reach the player.
//
// The page is where a person who does not know den-kit arrives from a link, so it
// says what the work is (its name, and whether it is an instrument or an effect)
// and makes the first sound close: the sound starts with a click or a tap, or with
// the first note played (the computer keys, MIDI, the screen's keyboard, or the big
// keys an instrument gets on a touch screen), and that note sounds. An effect hears
// a built-in input or, when the person asks, their own voice (the microphone). On
// iOS the page asks to play as media, so the silent switch does not mute it. A build
// can carry a moment (moment.ts): the work starts where it ends. ?embed shows the
// work's picture (card.png) and one button for a page that embeds the player; the
// button starts the sound and plays the moment. ?touch shows the page as a touch
// screen gets it, to look at it on a computer. ?plain shows the page without any of
// this, to compare the two.
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef } from 'vue';
import { catalog } from '../sound/blocks/index.ts';
import { AudioEngine } from '../sound/audio-engine.ts';
import { currentAssets, currentValues, generate, type Generated } from '../sound/codegen.ts';
import type { Artifact } from '../sound/compile/protocol.ts';
import type { AssetLoad } from '../sound/assets.ts';
import PluginWindow from '../screen/PluginWindow.vue';
import { pluginSpec } from '../screen/build.ts';
import { POD, type CodePartSource } from '../screen/code-frames.ts';
import { computerKeys } from '../screen/computer-keys.ts';
import { applyIntents, type Intent } from '../work/ops.ts';
import { parseDocument } from '../work/persistence.ts';
import type { PatchDocument } from '../work/schema.ts';
import { assetFontFamily, assetsOf, isFontAsset } from '../work/ui.ts';
import {
  PARTS_FOLDER,
  PLAYABLE_MANIFEST,
  PROCESSOR_MODULE,
  PROCESSOR_WASM,
  readPlayableManifest,
} from '../work/playable.ts';
import TouchKeys from './TouchKeys.vue';
import {
  MOMENT_FILE,
  endValues,
  movingAt,
  readMoment,
  valuesAt,
  type Moment,
  type MomentMove,
  type MomentSource,
} from './moment.ts';

const query = new URLSearchParams(location.search);
const plain = query.has('plain');
const embedded = !plain && query.has('embed');
const touch =
  query.has('touch') ||
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
const POSTER = 'card.png';
const DEN_KIT = 'https://github.com/yuichkun/den-kit';

const state = ref<'loading' | 'ready' | 'starting' | 'playing' | 'failed'>('loading');
const message = ref('');
const doc = shallowRef<PatchDocument | null>(null);
const generated = shallowRef<Generated | null>(null);
const held = ref<number[]>([]);
let artifact: Artifact | null = null;
type Source = MomentSource | 'input';
const SOURCES: { id: Source; label: string }[] = [
  { id: 'input', label: 'Your voice' },
  { id: 'guitar', label: 'Guitar' },
  { id: 'drums', label: 'Drums' },
  { id: 'chords', label: 'Chords' },
];
/** What an effect hears, and what it hears when the microphone cannot be opened. */
const source = ref<Source>('chords');
const fallback = ref<MomentSource>('chords');
const moment = shallowRef<Moment | null>(null);
const pressed = ref(false);
const poster = ref<string | null>(null);
/** The control the moment is turning, under a finger mark. */
const marked = ref<{ left: string; top: string } | null>(null);
const stage = ref<HTMLElement | null>(null);
const engine = new AudioEngine({
  state: (s, text) => {
    message.value = s === 'error' || s === 'suspended' ? text : '';
  },
  error: text => {
    if (source.value !== 'input' || !text.startsWith('The audio input could not be opened')) return;
    const instead = SOURCES.find(s => s.id === fallback.value)!.label.toLowerCase();
    hear(fallback.value);
    message.value = `The microphone could not be opened, so the effect plays ${instead}.`;
  },
});
const partsAt = ref<string | null>(null);
const partsMessage = ref('');
// The code parts' pages, from their own origin; this player never edits them.
const parts: CodePartSource = {
  available: true,
  portal: partsAt,
  state: ref('ready'),
  message: partsMessage,
  reloads: ref(0),
  ensure: async () => undefined,
  report: () => undefined,
};
provide(POD, parts);

const spec = computed(() =>
  doc.value && generated.value ? pluginSpec(doc.value, catalog, generated.value) : null,
);
const kind = computed(() =>
  !generated.value
    ? null
    : generated.value.voices
      ? 'instrument'
      : generated.value.audioIn
        ? 'effect'
        : 'sound',
);
const press = touch ? 'Tap' : 'Click';
const bigKeys = computed(() => !plain && touch && kind.value === 'instrument');
/** The C at or below where the work's own keyboard starts (middle C when it has none). */
const keysFrom = computed(() => {
  for (const node of Object.values(doc.value?.nodes ?? {})) {
    const start = node.type === 'ui.keyboard' ? Number(node.style?.skin?.params?.start) : NaN;
    if (Number.isInteger(start) && start >= 0 && start <= 108) return start - (start % 12);
  }
  return 60;
});
// Paths on this page's origin, which the controls take (wherever the build is served from).
const assetUrls = computed(() =>
  Object.fromEntries(
    Object.keys(assetsOf(doc.value?.files ?? {})).map(path => [
      path,
      new URL(path, location.href).pathname,
    ]),
  ),
);
const analyser = (probe: number) =>
  probe >= 0 ? (engine.probeAnalysers[probe] ?? null) : engine.outAnalyser;

onMounted(async () => {
  try {
    const manifest = readPlayableManifest(await (await fetch(PLAYABLE_MANIFEST)).json());
    if ('error' in manifest) throw new Error(manifest.error);
    const read = parseDocument(manifest.document, catalog);
    if (!read.ok) throw new Error(read.error);
    const [moduleSource, wasm, carried] = await Promise.all([
      fetch(PROCESSOR_MODULE).then(r => r.text()),
      fetch(PROCESSOR_WASM).then(r => r.arrayBuffer()),
      plain ? null : momentOfBuild(),
    ]);
    artifact = {
      hash: manifest.processor.hash,
      meta: manifest.processor.meta as Artifact['meta'],
      moduleSource,
      wasm,
      processorName: manifest.processor.processorName,
      sampleRate: manifest.processor.sampleRate,
      compileMs: 0,
    };
    await registerFonts(read.doc);
    let work = read.doc;
    if (carried) {
      moment.value = carried;
      fallback.value = source.value = carried.source ?? 'chords';
      const intents: Intent[] = endValues(carried).map(({ widget, port, value }) => ({
        op: 'setValue',
        node: widget,
        port,
        value,
      }));
      try {
        work = applyIntents(work, intents, catalog).doc;
      } catch {
        // A moment that names a control the work does not have leaves the controls as they are.
      }
    }
    doc.value = work;
    generated.value = generate(work, catalog);
    if (!plain) document.title = `${work.name} · den-kit`;
    if (embedded) poster.value = await posterOfBuild();
    partsAt.value = partsAddress(new URLSearchParams(location.search).get('parts'));
    if (!partsAt.value)
      partsMessage.value = manifest.parts
        ? `serve the build's ${PARTS_FOLDER} folder from another origin and open this page with ?parts= and its address.`
        : 'this build has no code parts.';
    state.value = 'ready';
  } catch (error) {
    state.value = 'failed';
    message.value = `This build cannot be played: ${error instanceof Error ? error.message : String(error)}`;
  }
});

/** The build's moment, when it carries one that can be read. */
async function momentOfBuild(): Promise<Moment | null> {
  try {
    const r = await fetch(MOMENT_FILE);
    if (!r.ok) return null;
    const read = readMoment(await r.json());
    return 'error' in read ? null : read;
  } catch {
    return null;
  }
}

/** The build's picture, when it has one. */
function posterOfBuild(): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(POSTER);
    img.onerror = () => resolve(null);
    img.src = POSTER;
  });
}

/** The work's own fonts, from the build's files, under the families its screen names them by. */
async function registerFonts(work: PatchDocument) {
  if (typeof FontFace === 'undefined') return;
  await Promise.all(
    Object.values(assetsOf(work.files))
      .filter(isFontAsset)
      .map(async asset => {
        try {
          const face = new FontFace(assetFontFamily(asset.id), `url("${asset.id}")`);
          document.fonts.add(await face.load());
        } catch {
          // A font that cannot be read shows as the fallback font, as in the editor.
        }
      }),
  );
}

/** The code parts' address from ?parts=, when it is another origin (http or https). */
function partsAddress(named: string | null): string | null {
  if (!named) return null;
  try {
    const url = new URL(named, location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== location.origin ? url.href : null;
  } catch {
    return null;
  }
}

/** The audio assets the sound reads, from the build's files. */
function loads(): AssetLoad[] {
  return currentAssets(doc.value!, catalog, generated.value!).map(({ slot, path }) => ({
    event: slot.event,
    kind: slot.kind,
    key: path,
    read: () =>
      path
        ? fetch(path).then(async r => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
        : Promise.resolve(null),
  }));
}

/** iOS (17 and later) plays the page as media, which the silent switch does not mute. */
function playAsMedia(recording: boolean) {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && !plain) session.type = recording ? 'play-and-record' : 'playback';
}

/** Notes played before the sound was ready, played as soon as it is (a short one, briefly). */
const early = new Map<number, { velocity: number; released: boolean }>();
function startOnRelease() {
  if (early.size && state.value === 'ready') void start();
}
if (!plain && touch) {
  addEventListener('pointerup', startOnRelease, true);
  addEventListener('touchend', startOnRelease, true);
}

/** Starts the sound; must be called from the person's click, tap or key. */
async function start(heard?: Source) {
  if (!artifact || !generated.value) return;
  if (state.value === 'starting' || state.value === 'playing') {
    if (heard) hear(heard);
    return;
  }
  state.value = 'starting';
  if (heard) source.value = heard;
  playAsMedia(source.value === 'input');
  listenToMidi();
  if (!(await engine.start())) {
    state.value = 'ready';
    return;
  }
  if (!plain) engine.setTestSignal(source.value);
  const g = generated.value;
  try {
    await engine.load(artifact, {
      values: { ...g.values },
      voices: !!g.voices,
      audioIn: g.audioIn,
      probes: g.probes.length,
      assets: loads(),
    });
    state.value = 'playing';
    for (const [n, { velocity, released }] of early) {
      engine.noteOn(n, velocity);
      if (released) setTimeout(() => note(n, false), 250);
    }
    early.clear();
    held.value = engine.heldNotes;
  } catch (error) {
    state.value = 'failed';
    message.value = error instanceof Error ? error.message : String(error);
  }
}

/** What the effect hears: a built-in input, or the microphone. */
function hear(s: Source) {
  source.value = s;
  if (s === 'input') playAsMedia(true);
  message.value = '';
  engine.setTestSignal(s);
}

/** A control moved: the player's own state changes, and the sound follows. */
function change(widget: string, values: Record<string, number | boolean>) {
  if (!doc.value || !generated.value) return;
  const intents: Intent[] = Object.entries(values).map(([port, value]) => ({
    op: 'setValue',
    node: widget,
    port,
    value: Number(value),
  }));
  doc.value = applyIntents(doc.value, intents, catalog).doc;
  const g = generated.value;
  const next = currentValues(doc.value, catalog, g);
  for (const [name, value] of Object.entries(next))
    if (g.values[name] !== value) engine.setParam(name, value);
  generated.value = { ...g, values: next };
}

function note(n: number, on: boolean, velocity = 100) {
  if (!plain && (state.value === 'ready' || state.value === 'starting')) {
    if (on) {
      early.set(n, { velocity, released: false });
      // A touch lets a page start sound only when the finger lifts (startOnRelease).
      if (!touch) void start();
    } else if (early.has(n)) early.get(n)!.released = true;
    return;
  }
  if (on) engine.noteOn(n, velocity);
  else engine.noteOff(n);
  held.value = engine.heldNotes;
}

let demo: (() => void) | null = null;
/** Plays a moment on the work: its notes, its moves and its input; the person's first touch or key takes over. */
function perform(m: Moment): Promise<void> {
  demo?.();
  if (kind.value === 'effect' && m.source && source.value !== 'input') hear(m.source);
  const began = performance.now();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const sounding = new Set<number>();
  let frame = 0;
  for (const n of m.notes) {
    timers.push(
      setTimeout(() => {
        sounding.add(n.note);
        engine.noteOn(n.note, n.velocity);
        held.value = engine.heldNotes;
      }, n.at * 1000),
      setTimeout(
        () => {
          sounding.delete(n.note);
          engine.noteOff(n.note);
          held.value = engine.heldNotes;
        },
        (n.at + n.hold) * 1000,
      ),
    );
  }
  const set = new Map<string, number>();
  return new Promise(resolve => {
    const stop = () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      for (const n of sounding) engine.noteOff(n);
      held.value = engine.heldNotes;
      marked.value = null;
      removeEventListener('pointerdown', takeOver, true);
      removeEventListener('keydown', takeOver, true);
      demo = null;
      resolve();
    };
    const takeOver = (e: Event) => {
      if (e.isTrusted) stop();
    };
    const tick = () => {
      const t = (performance.now() - began) / 1000;
      for (const v of valuesAt(m, t).values()) {
        const k = `${v.widget}/${v.port}`;
        if (set.get(k) !== v.value) {
          set.set(k, v.value);
          try {
            change(v.widget, { [v.port]: v.value });
          } catch {
            // A move of a control the work does not have does nothing.
          }
        }
      }
      mark(movingAt(m, t));
      if (t < m.seconds) frame = requestAnimationFrame(tick);
      else stop();
    };
    demo = stop;
    addEventListener('pointerdown', takeOver, true);
    addEventListener('keydown', takeOver, true);
    tick();
  });
}

/**
 * Puts the finger mark where a finger would be to make the move (none: takes it away):
 * on an XY pad's point, on a slider's cap, or on a knob, higher as it turns up.
 */
function mark(move: MomentMove | null) {
  const node = move ? doc.value?.nodes[move.widget] : undefined;
  const cell = move ? stage.value?.querySelector(`[data-widget="${move.widget}"]`) : null;
  const box = stage.value?.getBoundingClientRect();
  if (!move || !node || !cell || !box) {
    marked.value = null;
    return;
  }
  // The part a finger holds: a slider's cap, a knob's dial (the control draws them in its shadow root).
  const held = cell.querySelector('dk-slider, dk-knob')?.shadowRoot?.querySelector('.thumb, .dial');
  const r = (held ?? cell).getBoundingClientRect();
  const { min = 0, max = 1, scale } = node.config as { min?: number; max?: number; scale?: string };
  const along = (v: number) =>
    scale === 'log' && min > 0 && max > min
      ? Math.log(v / min) / Math.log(max / min)
      : (v - min) / (max - min || 1);
  const value = (port: string) => Number(node.values[port] ?? 0);
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  if (node.type === 'ui.xy') {
    x = r.left + value('x') * r.width;
    y = r.top + (1 - value('y')) * r.height;
  } else if (node.type === 'ui.knob')
    y -= (along(value(move.port)) - along(move.from)) * Math.min(60, r.height);
  marked.value = { left: `${x - box.left}px`, top: `${y - box.top}px` };
}

/** The embedding page's button: the sound starts and the work plays its moment. */
async function play() {
  pressed.value = true;
  await start();
  if (state.value === 'playing' && moment.value) void perform(moment.value);
}

const keys = computerKeys({
  octaveStart: 60,
  onNote: (n, velocity) => note(n, velocity > 0, velocity),
});
let midi: MIDIAccess | null = null;
/** MIDI controllers play notes too; asked for when the person starts the sound, like den-kit's start overlay. */
function listenToMidi() {
  if (midi) return;
  void navigator.requestMIDIAccess?.().then(
    access => {
      midi = access;
      const listen = (input: MIDIInput) => {
        input.onmidimessage = e => {
          const [status = 0, n = 0, velocity = 0] = e.data ?? [];
          if ((status & 0xf0) === 0x90 && velocity > 0) note(n, true, velocity);
          else if ((status & 0xf0) === 0x80 || (status & 0xf0) === 0x90) note(n, false);
        };
      };
      access.inputs.forEach(listen);
      access.onstatechange = () => access.inputs.forEach(listen);
    },
    () => undefined,
  );
}
// Tests read the sound and the player's own values (as they read den-kit's session);
// a recording sets the controls where the moment starts (rewind), then plays it.
(window as unknown as { __player: unknown }).__player = {
  engine,
  values: () => generated.value?.values ?? {},
  start,
  perform: () => (moment.value ? perform(moment.value) : Promise.resolve()),
  rewind: () => {
    for (const v of moment.value ? valuesAt(moment.value, 0).values() : [])
      change(v.widget, { [v.port]: v.value });
  },
};
onBeforeUnmount(() => {
  removeEventListener('pointerup', startOnRelease, true);
  removeEventListener('touchend', startOnRelease, true);
  demo?.();
  keys.stop();
  midi?.inputs.forEach(input => (input.onmidimessage = null));
  void engine.dispose();
});
</script>

<template>
  <div v-if="plain" class="player plain" data-testid="player" :data-state="state">
    <PluginWindow
      v-if="spec"
      class="window"
      :spec="spec"
      :held="held"
      :analyser="analyser"
      :asset-urls="assetUrls"
      @change="change"
      @note="note"
    />
    <button
      v-if="state === 'ready' || state === 'starting'"
      type="button"
      class="start"
      data-testid="player-start"
      :disabled="state === 'starting'"
      @click="start()"
    >
      {{ state === 'starting' ? 'Starting…' : 'Click to play' }}
    </button>
    <p v-if="message" class="message" data-testid="player-message">{{ message }}</p>
  </div>
  <div
    v-else
    class="player"
    :class="{ touch, embedded }"
    data-testid="player"
    :data-state="state"
    :data-kind="kind"
  >
    <header v-if="doc" class="about" data-testid="player-about">
      <strong class="name">{{ doc.name }}</strong>
      <span v-if="kind" class="kind">{{ kind }}</span>
      <a class="made" :href="DEN_KIT" target="_blank" rel="noopener">made with den-kit</a>
    </header>
    <div ref="stage" class="stage">
      <PluginWindow
        v-if="spec"
        class="window"
        :spec="spec"
        :held="held"
        :analyser="analyser"
        :asset-urls="assetUrls"
        @change="change"
        @note="note"
      />
      <div v-if="marked" class="finger" :style="marked" data-testid="player-finger" />
    </div>
    <p v-if="bigKeys && state !== 'playing'" class="hint keys-hint">Tap a key to play</p>
    <TouchKeys v-if="bigKeys" class="keys" :held="held" :from="keysFrom" @note="note" />
    <div v-if="kind && !(embedded && !pressed)" class="dock">
      <div
        v-if="kind === 'effect' && state === 'playing'"
        class="sources"
        role="group"
        aria-label="What the effect hears"
      >
        <button
          v-for="s in SOURCES"
          :key="s.id"
          type="button"
          :aria-pressed="source === s.id"
          :data-testid="`player-source-${s.id}`"
          @click="hear(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
      <p v-if="kind === 'effect' && state === 'playing' && source === 'input'" class="hint">
        Use headphones, or the sound may feed back.
      </p>
      <template v-if="(state === 'ready' || state === 'starting') && !bigKeys">
        <div class="starts">
          <button
            type="button"
            class="start"
            data-testid="player-start"
            :disabled="state === 'starting'"
            @click="start()"
          >
            {{ state === 'starting' ? 'Starting…' : `${press} to play` }}
          </button>
          <button
            v-if="kind === 'effect'"
            type="button"
            class="start voice"
            data-testid="player-voice"
            :disabled="state === 'starting'"
            @click="start('input')"
          >
            Try it on your voice
          </button>
        </div>
      </template>
      <p v-if="kind === 'instrument' && !touch" class="hint">
        Play with the keys A to K, a MIDI keyboard, or the keyboard on the screen.
      </p>
      <p v-if="message" class="message" data-testid="player-message">{{ message }}</p>
    </div>
    <div v-if="embedded && !pressed" class="poster" data-testid="player-poster">
      <img v-if="poster" :src="poster" alt="" />
      <button
        type="button"
        class="play"
        data-testid="player-start"
        :disabled="state !== 'ready'"
        @click="play"
      >
        <span class="triangle" aria-hidden="true" />
        <span>{{ state === 'failed' ? message : doc ? `Play ${doc.name}` : 'Loading…' }}</span>
      </button>
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
  background: #000;
}
</style>
<style scoped>
.player {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #fff;
  font:
    14px system-ui,
    sans-serif;
}
.player.plain {
  display: block;
}
.window {
  position: absolute;
  inset: 0;
}
.plain .start {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
}
.plain .message {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 72px;
}
.about {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 14px;
}
.name {
  font-size: 15px;
}
.kind {
  opacity: 0.6;
}
.made {
  margin-left: auto;
  color: inherit;
  opacity: 0.6;
  font-size: 12px;
  text-decoration: none;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.finger {
  position: absolute;
  width: 40px;
  height: 40px;
  margin: -20px 0 0 -20px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.3);
  border: 3px solid #fff;
  box-shadow:
    0 0 0 2px rgb(0 0 0 / 0.45),
    0 3px 12px rgb(0 0 0 / 0.35);
  pointer-events: none;
}
.keys {
  flex: none;
  height: clamp(120px, 30vh, 260px);
}
.keys-hint {
  flex: none;
  margin: 8px 0 0;
  text-align: center;
}
.dock {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
}
.dock:empty {
  display: none;
}
.starts,
.sources {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.start {
  padding: 10px 18px;
  font:
    600 15px system-ui,
    sans-serif;
  border-radius: 8px;
  border: 0;
  cursor: pointer;
}
.start.voice {
  background: transparent;
  color: #fff;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.6);
}
.sources button {
  padding: 7px 12px;
  border-radius: 999px;
  border: 0;
  background: rgb(255 255 255 / 0.12);
  color: #fff;
  font:
    13px system-ui,
    sans-serif;
  cursor: pointer;
}
.sources button[aria-pressed='true'] {
  background: #fff;
  color: #000;
}
.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 13px;
  text-align: center;
}
.message {
  margin: 0;
  color: #fff;
  font:
    14px system-ui,
    sans-serif;
  text-align: center;
}
.poster {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #000;
}
.poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.play {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 12px 16px;
  border: 0;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font:
    600 16px system-ui,
    sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 18px rgb(0 0 0 / 0.4);
}
.triangle {
  width: 0;
  height: 0;
  border-left: 14px solid #fff;
  border-top: 9px solid transparent;
  border-bottom: 9px solid transparent;
}
</style>

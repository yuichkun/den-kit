<script setup lang="ts">
// Plays a playable build (src/work/playable.ts) from the files next to its page:
// the work's screen, drawn by `screen`, and its compiled sound, loaded by `sound`.
// Nothing compiles here and nothing is saved: a value moved on the screen is the
// player's own state (the sound follows it), never the work's record. The sound
// starts when the person clicks; the computer keys and MIDI play notes. The code
// parts come from their own origin, named by ?parts=: never from the player's
// origin, where they could reach the player.
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

const state = ref<'loading' | 'ready' | 'starting' | 'playing' | 'failed'>('loading');
const message = ref('');
const doc = shallowRef<PatchDocument | null>(null);
const generated = shallowRef<Generated | null>(null);
const held = ref<number[]>([]);
let artifact: Artifact | null = null;
const engine = new AudioEngine({
  state: (s, text) => {
    message.value = s === 'error' || s === 'suspended' ? text : '';
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
const assetUrls = computed(() =>
  Object.fromEntries(Object.keys(assetsOf(doc.value?.files ?? {})).map(path => [path, path])),
);
const analyser = (probe: number) =>
  probe >= 0 ? (engine.probeAnalysers[probe] ?? null) : engine.outAnalyser;

onMounted(async () => {
  try {
    const manifest = readPlayableManifest(await (await fetch(PLAYABLE_MANIFEST)).json());
    if ('error' in manifest) throw new Error(manifest.error);
    const read = parseDocument(manifest.document, catalog);
    if (!read.ok) throw new Error(read.error);
    const [moduleSource, wasm] = await Promise.all([
      fetch(PROCESSOR_MODULE).then(r => r.text()),
      fetch(PROCESSOR_WASM).then(r => r.arrayBuffer()),
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
    doc.value = read.doc;
    generated.value = generate(read.doc, catalog);
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

async function start() {
  if (!artifact || !generated.value) return;
  state.value = 'starting';
  listenToMidi();
  if (!(await engine.start())) {
    state.value = 'ready';
    return;
  }
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
  } catch (error) {
    state.value = 'failed';
    message.value = error instanceof Error ? error.message : String(error);
  }
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
  if (on) engine.noteOn(n, velocity);
  else engine.noteOff(n);
  held.value = engine.heldNotes;
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
// Tests read the sound and the player's own values (as they read den-kit's session).
(window as unknown as { __player: unknown }).__player = {
  engine,
  values: () => generated.value?.values ?? {},
};
onBeforeUnmount(() => {
  keys.stop();
  midi?.inputs.forEach(input => (input.onmidimessage = null));
  void engine.dispose();
});
</script>

<template>
  <div class="player" data-testid="player" :data-state="state">
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
      @click="start"
    >
      {{ state === 'starting' ? 'Starting…' : 'Click to play' }}
    </button>
    <p v-if="message" class="message" data-testid="player-message">{{ message }}</p>
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
}
.window {
  position: absolute;
  inset: 0;
}
.start {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  padding: 10px 18px;
  font:
    600 15px system-ui,
    sans-serif;
  border-radius: 8px;
  border: 0;
  cursor: pointer;
}
.message {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 72px;
  margin: 0;
  color: #fff;
  font:
    14px system-ui,
    sans-serif;
  text-align: center;
}
</style>

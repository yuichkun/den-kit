<script setup lang="ts">
// Tab A, the author's screen: the work's plugin screen with every control over its
// whole range, as the player shows it. The recipient's moves stay on this page; a
// setting worth keeping goes to the kept list.
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import PluginWindow from '../../src/screen/PluginWindow.vue';
import { pluginSpec } from '../../src/screen/build.ts';
import { computerKeys } from '../../src/screen/computer-keys.ts';
import { catalog } from '../../src/sound/blocks/index.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { DELIVERY } from './context.ts';
import { authorSetting, withSetting, type Setting } from './sound.ts';

const ctx = inject(DELIVERY)!;
const build = ctx.active;
const setting = ref<Setting>({});
const doc = shallowRef<PatchDocument | null>(null);
const held = ref<number[]>([]);
const started = ref(ctx.live.running);
const starting = ref(false);
let made = 0;

watch(
  build,
  b => {
    if (!b) return;
    setting.value = authorSetting(b);
    doc.value = withSetting(b, setting.value);
    ctx.live.set(b, setting.value);
  },
  { immediate: true },
);

const spec = computed(() =>
  doc.value && build.value ? pluginSpec(doc.value, catalog, build.value.generated) : null,
);
const size = computed(() => doc.value?.panel ?? { width: 640, height: 360 });
const analyser = (probe: number) =>
  probe >= 0 ? (ctx.live.engine.probeAnalysers[probe] ?? null) : ctx.live.engine.outAnalyser;

async function start() {
  if (!build.value) return;
  starting.value = true;
  started.value = await ctx.live.start(build.value, setting.value);
  starting.value = false;
}

function change(widget: string, values: Record<string, number | boolean>) {
  const b = build.value;
  if (!b || values.value === undefined || !b.controls.some(c => c.id === widget)) return;
  setting.value = { ...setting.value, [widget]: Number(values.value) };
  doc.value = withSetting(b, setting.value);
  ctx.live.set(b, setting.value);
}

function note(n: number, on: boolean, velocity = 100) {
  ctx.live.note(n, on, velocity);
  held.value = ctx.live.engine.heldNotes;
}

function reset() {
  const b = build.value;
  if (!b) return;
  setting.value = authorSetting(b);
  doc.value = withSetting(b, setting.value);
  ctx.live.set(b, setting.value);
}

function keep() {
  ctx.keep({ name: `Screen ${++made}`, setting: { ...setting.value }, from: 'screen' });
}

const keys = computerKeys({
  octaveStart: 60,
  onNote: (n, velocity) => note(n, velocity > 0, velocity),
});
onBeforeUnmount(() => {
  keys.stop();
  ctx.live.stop();
});
</script>

<template>
  <div class="screen-tab" data-testid="screen-tab">
    <div class="frame" :style="{ aspectRatio: `${size.width} / ${size.height}` }">
      <PluginWindow
        v-if="spec"
        class="window"
        :spec="spec"
        :held="held"
        :analyser="analyser"
        @change="change"
        @note="note"
      />
      <button
        v-if="!started"
        type="button"
        class="start primary"
        data-testid="screen-start"
        :disabled="starting"
        @click="start"
      >
        {{ starting ? 'Starting…' : 'Click to play' }}
      </button>
    </div>
    <div class="bar">
      <p>
        The work as the author made it: every control, over its whole range. Play the pads, or the
        keys A to K.
      </p>
      <button v-if="!ctx.readonly" type="button" @click="reset">
        Back to the author's setting
      </button>
      <button
        v-if="!ctx.readonly"
        type="button"
        class="primary"
        data-testid="screen-keep"
        @click="keep"
      >
        Keep this setting
      </button>
    </div>
  </div>
</template>

<style scoped>
.screen-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
}
.frame {
  position: relative;
  width: min(100%, 760px);
  border-radius: var(--radius-panel);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.window {
  position: absolute;
  inset: 0;
}
.start {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 760px);
}
.bar p {
  flex: 1;
  margin: 0;
  color: var(--text-muted);
}
</style>

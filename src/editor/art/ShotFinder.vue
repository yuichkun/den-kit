<script setup lang="ts">
// A viewfinder on the plugin: the person plays and poses it (knobs where they want them), then
// takes a picture of it as it is drawn now. The picture becomes one of the work's assets and a
// picture at the back of the icon, the cover or both, filling each; each is framed on its own
// afterwards by moving and sizing it. Adding the asset and the pictures is one step to undo.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSession } from '../context.ts';
import { ART_SIZE, ART_SURFACES, nextArtId, type ArtSurfaceName } from '../../work/art.ts';
import type { Intent } from '../../work/ops.ts';
import { assetFontFamily, assetsOf, isFontAsset } from '../../work/ui.ts';
import { pluginSpec } from '../../screen/build.ts';
import { capture, pngBytes } from '../../screen/capture.ts';
import PluginWindow from '../../screen/PluginWindow.vue';
import { controlWriter } from '../play.ts';

defineProps<{ on: ArtSurfaceName }>();
const emit = defineEmits<{
  (e: 'place', intents: Intent[], label: string): void;
  (e: 'close'): void;
}>();
const session = useSession();
// Esc closes it, before the view under it sees the key.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
const doc = computed(() => session.doc.value);
const spec = computed(() => pluginSpec(doc.value, session.catalog, session.generated.value));
const analyser = (probe: number) =>
  probe >= 0 ? (session.engine.probeAnalysers[probe] ?? null) : session.engine.outAnalyser;
const onChange = controlWriter(session);
function onNote(note: number, on: boolean, velocity: number) {
  if (on) session.noteOn(note, velocity);
  else session.noteOff(note);
}
const holder = ref<HTMLElement | null>(null);
const busy = ref(false);
const aspect = computed(() => doc.value.panel.width / doc.value.panel.height);

/** A rect that fills the surface with a picture of this aspect (centred, cropped by the surface). */
function filling(on: ArtSurfaceName) {
  const { width, height } = ART_SIZE[on];
  const a = aspect.value;
  const w = a > width / height ? height * a : width;
  const h = w / a;
  return {
    x: Math.round((width - w) / 2),
    y: Math.round((height - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}
async function take(targets: readonly ArtSurfaceName[]) {
  const panel = holder.value?.querySelector<HTMLElement>('[data-testid=panel]');
  if (!panel || busy.value) return;
  busy.value = true;
  try {
    const W = doc.value.panel.width,
      H = doc.value.panel.height;
    const fontUrls = Object.fromEntries(
      Object.values(assetsOf(doc.value.files))
        .filter(isFontAsset)
        .flatMap(a =>
          session.assetUrls.value[a.id]
            ? [[assetFontFamily(a.id), session.assetUrls.value[a.id]!]]
            : [],
        ),
    );
    const scale = Math.min(2, 1600 / Math.max(W, H));
    const shot = await capture(panel, {
      width: W,
      height: H,
      scale,
      fontUrls,
      rootStyle: { transform: 'none' },
    });
    const bytes = await pngBytes(shot.canvas);
    const file = new File([bytes as BlobPart], 'plugin-shot.png', { type: 'image/png' });
    const asset = await session.assets.add(file, path => !!doc.value.files[path]);
    const intents: Intent[] = [{ op: 'addAsset', asset }];
    for (const on of targets) {
      const id = nextArtId(doc.value.art?.[on], 'shot');
      intents.push(
        {
          op: 'addElement',
          on,
          element: { id, kind: 'image', asset: asset.id, fit: 'stretch', rect: filling(on) },
        },
        { op: 'arrange', on, ids: [id], to: 'back' },
      );
    }
    emit(
      'place',
      intents,
      `Shot of the plugin on the ${targets.length > 1 ? 'icon and the cover' : targets[0]}`,
    );
    void session.syncAssets();
  } catch (error) {
    session.toast(
      'warn',
      `Could not take the shot: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('close')">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Shot of the plugin"
      data-testid="shot-finder"
    >
      <h3>Shot of the plugin</h3>
      <p class="hint">
        Play it and set the knobs the way the picture should show them, then take the shot.
      </p>
      <div
        ref="holder"
        class="finder"
        :style="{ aspectRatio: `${doc.panel.width} / ${doc.panel.height}` }"
      >
        <PluginWindow
          :spec="spec"
          :held="session.heldNotes.value"
          :analyser="analyser"
          :asset-urls="session.assetUrls.value"
          @change="onChange"
          @note="onNote"
        />
      </div>
      <div class="actions">
        <button @click="emit('close')">Cancel</button>
        <span class="spacer" />
        <button
          v-for="s in ART_SURFACES"
          :key="s"
          :class="{ primary: s === on }"
          :disabled="busy"
          :data-testid="`shot-${s}`"
          @click="take([s])"
        >
          Use on the {{ s }}
        </button>
        <button :disabled="busy" data-testid="shot-both" @click="take(ART_SURFACES)">
          Use on both
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--app-canvas) 60%, transparent);
}
.dialog {
  width: min(860px, 94vw);
  padding: 16px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-menu);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 15px;
}
.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.finder {
  position: relative;
  width: 100%;
  max-height: 60vh;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.spacer {
  flex: 1;
}
</style>

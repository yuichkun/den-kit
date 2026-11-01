<script setup lang="ts">
// The patch's assets: pictures, fonts and sounds. Drop files here (or on the
// plugin), or add pictures and fonts with the button; each keeps where it came
// from and its licence. A picture can go on the plugin, become the background or
// the reference picture under it.
import { computed, ref } from 'vue';
import {
  assetFontFamily,
  assetUses,
  isFontAsset,
  isImageAsset,
  type AssetMeta,
  type WidgetStyle,
  assetsOf,
} from '../../work/ui.ts';
import { placePicture } from '../../screen/edit.ts';
import { useSession } from '../context.ts';

const session = useSession();
const doc = computed(() => session.doc.value);
const assets = computed(() => Object.values(assetsOf(doc.value.files)));
const current = ref<string | null>(null);
const asset = computed(() =>
  current.value ? assetsOf(doc.value.files)[current.value] : undefined,
);
const uses = computed(() =>
  assetUses(
    doc.value.ui,
    Object.values(doc.value.nodes).map(n => [n.id, n.style] as [string, WidgetStyle | undefined]),
  ),
);
const input = ref<HTMLInputElement | null>(null);
const over = ref(false);

function commit(...args: Parameters<typeof session.commit>) {
  const r = session.commit(...args);
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r;
}
async function addFiles(files: FileList | File[] | null) {
  for (const file of Array.from(files ?? [])) {
    const meta = await session.addAssetFile(file);
    if (meta) current.value = meta.id;
  }
}
function drop(e: DragEvent) {
  over.value = false;
  e.preventDefault();
  void addFiles(e.dataTransfer?.files ?? null);
}
const size = (a: AssetMeta) =>
  `${a.bytes >= 1048576 ? `${(a.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.bytes / 1024))} KB`}${a.width ? ` · ${a.width}×${a.height}` : ''}`;
function insert(a: AssetMeta) {
  const frame = { x: 0, y: 0, w: doc.value.panel.width, h: doc.value.panel.height };
  const r = commit(
    [
      {
        op: 'addElement',
        element: {
          kind: 'image',
          asset: a.id,
          fit: 'contain',
          name: a.name.replace(/\.[^.]+$/, ''),
          rect: placePicture(a, { x: frame.w / 2, y: frame.h / 2 }, frame),
        },
      },
    ],
    { label: `Put ${a.name} on the plugin` },
  );
  if (r.ok) session.select(r.created);
}
const background = (a: AssetMeta) =>
  commit(
    [{ op: 'setLook', look: { background: [{ kind: 'image', asset: a.id, fit: 'cover' }] } }],
    { label: `Background: ${a.name}` },
  );
const underlay = (a: AssetMeta) =>
  commit([{ op: 'setUnderlay', underlay: { asset: a.id, opacity: 0.4, visible: true } }], {
    label: `Reference picture: ${a.name}`,
  });
function source(key: 'title' | 'author' | 'url' | 'license', value: string) {
  if (!asset.value) return;
  const next = { ...asset.value.source, [key]: value || undefined };
  for (const k of Object.keys(next) as Array<keyof typeof next>) if (!next[k]) delete next[k];
  commit(
    [
      {
        op: 'updateAsset',
        id: asset.value.id,
        set: { source: Object.keys(next).length ? next : null },
      },
    ],
    { label: 'Asset source' },
  );
}
function remove(a: AssetMeta) {
  const r = commit([{ op: 'removeAsset', id: a.id }], { label: `Remove ${a.name}` });
  if (r.ok) current.value = null;
}
</script>

<template>
  <div
    class="assets"
    :class="{ over }"
    data-testid="asset-panel"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop="drop"
  >
    <div class="grid">
      <button
        v-for="a in assets"
        :key="a.id"
        type="button"
        class="thumb"
        :class="{ current: a.id === current, unused: !uses.get(a.id) }"
        :title="`${a.name} (${size(a)})${uses.get(a.id) ? ` — used by ${uses.get(a.id)!.join(', ')}` : ' — not used'}`"
        :data-asset="a.id"
        @click="current = a.id === current ? null : a.id"
      >
        <img
          v-if="isImageAsset(a) && session.assetUrls.value[a.id]"
          :src="session.assetUrls.value[a.id]"
          alt=""
          draggable="false"
        />
        <span
          v-else-if="isFontAsset(a)"
          class="font"
          :style="{ fontFamily: `'${assetFontFamily(a.id)}'` }"
          >Aa</span
        >
        <span v-else class="missing">?</span>
      </button>
      <button
        type="button"
        class="thumb add"
        title="Add pictures or fonts (or drop files here)"
        data-testid="asset-add"
        @click="input?.click()"
      >
        +
      </button>
    </div>
    <input
      ref="input"
      type="file"
      multiple
      hidden
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.woff2,.woff,.ttf,.otf"
      data-testid="asset-input"
      @change="
        addFiles(($event.target as HTMLInputElement).files);
        ($event.target as HTMLInputElement).value = '';
      "
    />
    <div v-if="!assets.length" class="hint">
      Drop pictures (PNG, JPEG, WebP, SVG) or fonts here or on the plugin.
    </div>
    <div v-if="asset" class="detail" data-testid="asset-detail">
      <div class="row">
        <label>Name</label
        ><input
          type="text"
          :value="asset.name"
          @change="
            commit(
              [
                {
                  op: 'updateAsset',
                  id: asset.id,
                  set: { name: ($event.target as HTMLInputElement).value },
                },
              ],
              { label: 'Rename asset' },
            )
          "
        />
      </div>
      <div class="muted small">
        {{ asset.mime }} · {{ size(asset) }}{{ asset.url ? ' · ships with den-kit' : '' }}
      </div>
      <div class="row">
        <label>Source</label
        ><input
          type="text"
          placeholder="title"
          :value="asset.source?.title ?? ''"
          @change="source('title', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row">
        <label>Author</label
        ><input
          type="text"
          :value="asset.source?.author ?? ''"
          @change="source('author', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row">
        <label>Link</label
        ><input
          type="text"
          placeholder="https://"
          :value="asset.source?.url ?? ''"
          @change="source('url', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row">
        <label>Licence</label
        ><input
          type="text"
          placeholder="e.g. CC0, own work"
          :value="asset.source?.license ?? ''"
          data-field="license"
          @change="source('license', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div v-if="isImageAsset(asset)" class="row actions">
        <button type="button" class="tiny" @click="insert(asset)">On the plugin</button
        ><button type="button" class="tiny" @click="background(asset)">Background</button
        ><button
          type="button"
          class="tiny"
          title="A reference picture under the plugin while editing"
          @click="underlay(asset)"
        >
          Reference
        </button>
      </div>
      <div class="row actions">
        <button
          type="button"
          class="tiny"
          :disabled="!!uses.get(asset.id)"
          :title="uses.get(asset.id) ? `Used by ${uses.get(asset.id)!.join(', ')}` : ''"
          @click="remove(asset)"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.assets {
  border-radius: var(--radius-control);
  outline: 1px dashed transparent;
}
.assets.over {
  outline-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.thumb {
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--app-field);
  border: 1px solid var(--line-subtle);
  box-shadow: none;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb.current {
  border-color: var(--accent);
}
.thumb.unused {
  opacity: 0.75;
}
.thumb.add {
  font-size: 22px;
  color: var(--text-muted);
}
.font {
  font-size: 22px;
}
.hint {
  color: var(--text-muted);
  font-size: 13px;
  margin-top: 6px;
}
.detail {
  margin-top: 8px;
}
.row label {
  width: 56px;
}
.row input {
  flex: 1;
  min-width: 0;
}
.small {
  font-size: 12px;
  margin: 2px 0 4px;
}
.actions {
  flex-wrap: wrap;
}
.tiny {
  padding: 2px 8px;
  font-size: 12px;
}
</style>

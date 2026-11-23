<script setup lang="ts">
// The shelf: the work's icon and cover among the showcase works', small, the way
// works are seen where they are lined up. It is for comparing what keeps a work
// recognisable at that size: the showcase works (which have no art of their own)
// wear one of the starting points, or the whole plugin fitted, as works are shown
// today; and the shelf can frame every work the same way (corners, light, grain).
import { computed, ref } from 'vue';
import {
  RECIPES,
  RECIPE_TITLE,
  fallbackArt,
  patchSigns,
  startArt,
  type ArtBoardId,
  type ArtLayer,
  type Recipe,
} from '../work/art.ts';
import { shippedPath } from '../work/files.ts';
import type { PatchDocument } from '../work/schema.ts';
import { assetsOf } from '../work/ui.ts';
import { generate } from '../sound/codegen.ts';
import { pluginSpec } from '../screen/build.ts';
import { WORKS } from '../screen/showcase/index.ts';
import ArtBoard from '../screen/ArtBoard.vue';
import { useSession } from './context.ts';

const session = useSession();
const SIZES = [32, 48, 64, 96, 128] as const;
const iconSize = ref<number>(48);
const finish = ref(true);
const others = ref<Recipe | 'plugin'>('specimen');
const covers = ref(true);

/** Each showcase work built once, with what its art is drawn from. */
const showcase = computed(() =>
  WORKS.map(w => {
    const doc = w.build(session.catalog);
    const urls = Object.fromEntries(
      Object.values(assetsOf(doc.files)).flatMap(a => {
        const at = a.url ? shippedPath(a.url) : null;
        return at ? [[a.id, at]] : [];
      }),
    );
    return {
      id: w.id,
      title: w.title,
      doc,
      spec: pluginSpec(doc, session.catalog, generate(doc, session.catalog)),
      signs: patchSigns(doc, session.catalog),
      urls,
    };
  }),
);
const wear = (doc: PatchDocument, board: ArtBoardId): ArtLayer[] =>
  others.value === 'plugin'
    ? fallbackArt(doc, board)
    : startArt(doc, session.catalog, others.value, board);
/** The work's own board, or what stands for it until it is made. */
const ownBoard = (doc: PatchDocument, board: ArtBoardId) =>
  doc.art?.[board]?.layers.length ? doc.art[board]!.layers : fallbackArt(doc, board);

const rows = computed(() => {
  const doc = session.doc.value;
  return [
    {
      id: 'own',
      title: doc.name,
      spec: pluginSpec(doc, session.catalog, session.generated.value),
      signs: patchSigns(doc, session.catalog),
      urls: session.assetUrls.value,
      icon: ownBoard(doc, 'icon'),
      cover: ownBoard(doc, 'cover'),
    },
    ...showcase.value.map(w => ({
      ...w,
      icon: wear(w.doc, 'icon'),
      cover: wear(w.doc, 'cover'),
    })),
  ];
});
</script>

<template>
  <div class="shelf" data-testid="art-shelf">
    <div class="controls">
      <h3>Shelf</h3>
      <div class="sizes">
        <button
          v-for="s in SIZES"
          :key="s"
          :class="{ on: iconSize === s }"
          :data-testid="`shelf-size-${s}`"
          @click="iconSize = s"
        >
          {{ s }}
        </button>
      </div>
      <label class="check">
        <input v-model="finish" type="checkbox" data-testid="shelf-finish" /> The shelf's frame
      </label>
      <label class="check">
        Other works as
        <select v-model="others" data-testid="shelf-others">
          <option v-for="r in RECIPES" :key="r" :value="r">{{ RECIPE_TITLE[r] }}</option>
          <option value="plugin">The whole plugin, fitted</option>
        </select>
      </label>
      <label class="check">
        <input v-model="covers" type="checkbox" data-testid="shelf-covers" /> Covers
      </label>
    </div>
    <div class="row icons" :style="{ '--tile': `${Math.max(iconSize, 64)}px` }">
      <figure
        v-for="w in rows"
        :key="w.id"
        :class="{ own: w.id === 'own' }"
        :data-work="w.id"
        data-testid="shelf-icon"
      >
        <ArtBoard
          :spec="w.spec"
          board="icon"
          :layers="w.icon"
          :signs="w.signs"
          :asset-urls="w.urls"
          :finish="finish"
          :width="iconSize"
        />
        <figcaption class="as-written">{{ w.title }}</figcaption>
      </figure>
    </div>
    <div v-if="covers" class="row covers">
      <figure
        v-for="w in rows"
        :key="w.id"
        :class="{ own: w.id === 'own' }"
        :data-work="w.id"
        data-testid="shelf-cover"
      >
        <ArtBoard
          :spec="w.spec"
          board="cover"
          :layers="w.cover"
          :signs="w.signs"
          :asset-urls="w.urls"
          :finish="finish"
          :width="192"
        />
        <figcaption class="as-written">{{ w.title }}</figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.shelf {
  border-top: 1px solid var(--line-subtle);
  background: var(--app-field);
  padding: 6px 14px 8px;
  min-width: 0;
}
.controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.controls h3 {
  margin: 0;
  font-family: var(--font-control);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
  color: var(--text-muted);
}
.sizes {
  display: flex;
  gap: 2px;
}
.sizes button {
  padding: 1px 7px;
  font-size: 12px;
}
.sizes button.on {
  background: var(--ink);
  color: var(--text-on-ink);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.row {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding: 10px 2px 4px;
  align-items: flex-end;
}
figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: none;
}
.icons figure {
  width: var(--tile);
}
figcaption {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
figure.own figcaption {
  color: var(--text-primary);
  font-weight: 600;
}
figure.own {
  outline: 2px solid var(--selection);
  outline-offset: 4px;
  border-radius: var(--radius-control);
}
</style>

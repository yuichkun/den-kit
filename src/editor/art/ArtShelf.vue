<script setup lang="ts">
// The art where it will be seen: this work's icon at the sizes a list or a dock shows it, and
// its cover as a card, beside other works. The other works have no art of their own here: they
// show what "From the look" makes of their looks, so this work can be compared with works made
// the same way.
import { computed } from 'vue';
import { useSession } from '../context.ts';
import { startFromLook } from '../../work/art-starts.ts';
import { shippedPath } from '../../work/files.ts';
import { applyIntents } from '../../work/ops.ts';
import { assetsOf } from '../../work/ui.ts';
import type { ArtSurfaceName } from '../../work/art.ts';
import { WORKS } from '../../screen/showcase/index.ts';
import ArtSurface from '../../screen/ArtSurface.vue';

defineProps<{ on: ArtSurfaceName }>();
const session = useSession();
const doc = computed(() => session.doc.value);
// Built once per name (not on every edit of this work).
const name = computed(() => session.doc.value.name);
const others = computed(() =>
  WORKS.filter(w => w.title !== name.value)
    .slice(0, 5)
    .map(w => {
      let built = w.build(session.catalog);
      try {
        built = applyIntents(
          built,
          [...startFromLook(built, 'icon'), ...startFromLook(built, 'cover')],
          session.catalog,
        ).doc;
      } catch {
        /* shown without art */
      }
      const urls = Object.fromEntries(
        Object.values(assetsOf(built.files)).flatMap(a => {
          const at = a.url ? shippedPath(a.url) : null;
          return at ? [[a.id, at]] : [];
        }),
      );
      return { id: w.id, title: w.title, doc: built, urls };
    }),
);
</script>

<template>
  <div class="shelf" data-testid="art-shelf">
    <div class="mine">
      <div class="icons">
        <ArtSurface
          v-for="size in [128, 64, 32]"
          :key="size"
          :doc="doc"
          on="icon"
          :size="size"
          :asset-urls="session.assetUrls.value"
          mask
        />
      </div>
      <div class="card" :class="{ current: on === 'cover' }">
        <ArtSurface :doc="doc" on="cover" :size="224" :asset-urls="session.assetUrls.value" />
        <span class="as-written">{{ doc.name }}</span>
      </div>
    </div>
    <div class="others">
      <div v-for="o in others" :key="o.id" class="card other">
        <div class="pair">
          <ArtSurface :doc="o.doc" on="icon" :size="40" :asset-urls="o.urls" mask />
          <ArtSurface :doc="o.doc" on="cover" :size="160" :asset-urls="o.urls" />
        </div>
        <span class="as-written">{{ o.title }}</span>
      </div>
    </div>
    <p class="note">Other works: what "From the look" makes of their looks.</p>
  </div>
</template>

<style scoped>
.shelf {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
  padding: 10px 14px;
  border-top: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  font-size: 12px;
  overflow-x: auto;
}
.mine {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  padding-right: 16px;
  border-right: 1px solid var(--line-subtle);
}
.icons {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.others {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pair {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}
.other {
  opacity: 0.85;
}
.note {
  margin: 0;
  width: 100%;
  color: var(--text-muted);
  font-size: 11px;
}
</style>

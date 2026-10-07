<script setup lang="ts">
// Text: font (look tokens, built-in fonts, your font files), size, weight,
// colour, alignment, spacing, case, glow/engraving shadows and outline.
import { computed } from 'vue';
import { FONTS, FONT_TOKENS, isFontAsset, type AssetMeta, type TextShadow, type TextStyle } from '../../core/ui.ts';
import ColorField from './ColorField.vue';
import NumberField from './NumberField.vue';

const props = defineProps<{ value: TextStyle | undefined; assets: Record<string, AssetMeta>; short?: boolean }>();
const emit = defineEmits<{ (e: 'update', style: TextStyle | null, done: boolean): void }>();
const fonts = computed(() => Object.values(props.assets).filter(isFontAsset));
const t = () => props.value ?? {};
function patch(p: Partial<Record<keyof TextStyle, unknown>>, done = true) {
  const next = { ...t() } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; }
  emit('update', Object.keys(next).length ? next as TextStyle : null, done);
}
const shadow = (i: number, p: Partial<TextShadow> | null, done = true) => patch({ shadows: p === null ? t().shadows!.filter((_, k) => k !== i) : t().shadows!.map((x, k) => k === i ? { ...x, ...p } : x) }, done);
const TOKEN_TITLE: Record<string, string> = { font: 'Look: text font', labelFont: 'Look: label font', valueFont: 'Look: value font' };
</script>

<template>
  <div class="text-style">
    <div class="row"><label>Font</label><select :value="value?.font ?? ''" data-field="font" @change="patch({ font: ($event.target as HTMLSelectElement).value })"><option value="">(default)</option><optgroup label="From the look"><option v-for="f in FONT_TOKENS" :key="f" :value="f">{{ TOKEN_TITLE[f] }}</option></optgroup><optgroup label="Fonts"><option v-for="(f, id) in FONTS" :key="id" :value="id" :title="f.doc">{{ f.title }} — {{ f.doc }}</option></optgroup><optgroup v-if="fonts.length" label="Your fonts"><option v-for="a in fonts" :key="a.id" :value="a.id">{{ a.name }}</option></optgroup></select></div>
    <div class="row"><label>Size</label><NumberField :value="value?.size" :min="4" :max="600" unit="px" placeholder="auto" @update="v => patch({ size: v })" /><select :value="value?.weight ?? ''" title="Weight" @change="patch({ weight: Number(($event.target as HTMLSelectElement).value) || null })"><option value="">weight</option><option v-for="w in [300, 400, 500, 600, 700, 800, 900]" :key="w" :value="w">{{ w }}</option></select></div>
    <div class="row"><label>Colour</label><ColorField :value="value?.color" placeholder="fg" @update="(c, done) => patch({ color: c }, done)" /></div>
    <template v-if="!short">
      <div class="row"><label>Align</label><select :value="value?.align ?? 'center'" @change="patch({ align: ($event.target as HTMLSelectElement).value })"><option>left</option><option>center</option><option>right</option></select><select :value="value?.valign ?? 'middle'" @change="patch({ valign: ($event.target as HTMLSelectElement).value })"><option>top</option><option>middle</option><option>bottom</option></select></div>
      <div class="row"><label>Line</label><NumberField :value="value?.lineHeight" :min="0.5" :max="4" :step="0.05" placeholder="1.15" @update="v => patch({ lineHeight: v })" /></div>
    </template>
    <div class="row"><label>Spacing</label><NumberField :value="value?.spacing" :min="-0.5" :max="3" :step="0.01" unit="em" placeholder="0" @update="v => patch({ spacing: v })" /><select :value="value?.case ?? 'none'" title="Case" @change="patch({ case: ($event.target as HTMLSelectElement).value === 'none' ? null : ($event.target as HTMLSelectElement).value })"><option value="none">Aa</option><option value="upper">AA</option><option value="lower">aa</option></select><label class="it"><input type="checkbox" :checked="!!value?.italic" @change="patch({ italic: ($event.target as HTMLInputElement).checked || null })" /> <i>I</i></label></div>
    <div v-for="(sh, i) in value?.shadows ?? []" :key="i" class="row nums"><ColorField :value="sh.color" :clearable="false" @update="(c, done) => c && shadow(i, { color: c }, done)" /><NumberField :value="sh.blur" :min="0" :max="200" unit="blur" @update="v => shadow(i, { blur: v ?? 0 })" /><NumberField :value="sh.y" :min="-200" :max="200" unit="y" @update="v => shadow(i, { y: v ?? 0 })" /><button type="button" class="tiny" @click="shadow(i, null)">×</button></div>
    <div class="row"><button type="button" class="tiny" @click="patch({ shadows: [...(value?.shadows ?? []), { x: 0, y: 0, blur: 10, color: 'glow' }] })">+ Glow</button><button type="button" class="tiny" @click="patch({ shadows: [...(value?.shadows ?? []), { x: 0, y: 1, blur: 0, color: '#ffffff55' }] })">+ Engrave</button><button type="button" class="tiny" @click="patch({ stroke: value?.stroke ? null : { color: 'accent', width: 1 } })">{{ value?.stroke ? '− Outline' : '+ Outline' }}</button></div>
    <div v-if="value?.stroke" class="row"><label>Outline</label><ColorField :value="value.stroke.color" :clearable="false" @update="(c, done) => c && patch({ stroke: { ...value!.stroke!, color: c } }, done)" /><NumberField :value="value.stroke.width" :min="0" :max="20" :step="0.5" unit="px" @update="v => patch({ stroke: { ...value!.stroke!, width: v ?? 1 } })" /></div>
  </div>
</template>

<style scoped>
.row label { width: 64px; }
.row label.it { width: auto; display: inline-flex; gap: 2px; align-items: center; }
select { flex: 1; min-width: 0; }
.tiny { padding: 1px 7px; font-size: 12px; }
.nums { gap: 4px; }
</style>

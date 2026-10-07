<script setup lang="ts">
// The box of an element or a widget: fill layers, border, corners, opacity,
// shadows and glows, rotation, blend and blur.
import { BLEND_MODES, type AssetMeta, type ElementStyle, type Fill, type Shadow } from '../../core/ui.ts';
import ColorField from './ColorField.vue';
import FillList from './FillList.vue';
import NumberField from './NumberField.vue';

const props = defineProps<{ value: ElementStyle | undefined; assets: Record<string, AssetMeta>; shape?: string }>();
const emit = defineEmits<{ (e: 'update', style: ElementStyle | null, done: boolean): void }>();
const s = () => props.value ?? {};
function patch(p: Partial<Record<keyof ElementStyle, unknown>>, done = true) {
  const next = { ...s() } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; }
  emit('update', Object.keys(next).length ? next as ElementStyle : null, done);
}
const shadow = (i: number, p: Partial<Shadow> | null, done = true) => patch({ shadows: p === null ? s().shadows!.filter((_, k) => k !== i) : s().shadows!.map((x, k) => k === i ? { ...x, ...p } : x) }, done);
const addShadow = (glow: boolean) => patch({ shadows: [...(s().shadows ?? []), glow ? { x: 0, y: 0, blur: 16, spread: 2, color: 'glow', inset: false } : { x: 0, y: 4, blur: 10, spread: 0, color: '#00000088', inset: false }] });
</script>

<template>
  <div class="style-editor">
    <div class="sub">Fill</div>
    <FillList :fills="value?.fill ?? []" :assets="assets" @update="(fills: Fill[], done: boolean) => patch({ fill: fills }, done)" />
    <div class="row"><label>{{ shape === 'line' ? 'Line' : 'Border' }}</label><ColorField :value="value?.stroke?.color" placeholder="none" @update="(c, done) => patch({ stroke: c ? { color: c, width: value?.stroke?.width ?? 1, style: value?.stroke?.style ?? 'solid' } : null }, done)" /></div>
    <div v-if="value?.stroke" class="row"><label>Width</label><NumberField :value="value.stroke.width" :min="0" :max="100" unit="px" @update="v => patch({ stroke: { ...value!.stroke!, width: v ?? 1 } })" /><select :value="value.stroke.style" @change="patch({ stroke: { ...value!.stroke!, style: ($event.target as HTMLSelectElement).value } })"><option>solid</option><option>dashed</option><option>dotted</option></select></div>
    <div v-if="shape !== 'ellipse' && shape !== 'line'" class="row"><label>Corners</label><NumberField :value="value?.radius" :min="0" :max="4000" unit="px" placeholder="0" @update="v => patch({ radius: v || null })" /></div>
    <div class="row"><label>Opacity</label><input type="range" min="0" max="1" step="0.01" :value="value?.opacity ?? 1" @input="patch({ opacity: Number(($event.target as HTMLInputElement).value) }, false)" @change="patch({ opacity: Number(($event.target as HTMLInputElement).value) === 1 ? null : Number(($event.target as HTMLInputElement).value) })" /></div>
    <div class="sub">Shadows &amp; glow</div>
    <div v-for="(sh, i) in value?.shadows ?? []" :key="i" class="shadow">
      <div class="row"><ColorField :value="sh.color" :clearable="false" @update="(c, done) => c && shadow(i, { color: c }, done)" /><label class="inset"><input type="checkbox" :checked="sh.inset" @change="shadow(i, { inset: ($event.target as HTMLInputElement).checked })" /> inside</label><button type="button" class="tiny" @click="shadow(i, null)">×</button></div>
      <div class="row nums"><NumberField :value="sh.x" :min="-500" :max="500" unit="x" @update="v => shadow(i, { x: v ?? 0 })" /><NumberField :value="sh.y" :min="-500" :max="500" unit="y" @update="v => shadow(i, { y: v ?? 0 })" /><NumberField :value="sh.blur" :min="0" :max="500" unit="blur" @update="v => shadow(i, { blur: v ?? 0 })" /><NumberField :value="sh.spread" :min="-200" :max="200" unit="spr" @update="v => shadow(i, { spread: v ?? 0 })" /></div>
    </div>
    <div class="row"><button type="button" class="tiny" @click="addShadow(false)">+ Shadow</button><button type="button" class="tiny" @click="addShadow(true)">+ Glow</button></div>
    <div class="row"><label>Rotate</label><NumberField :value="value?.rotate" :min="-360" :max="360" unit="°" placeholder="0" @update="v => patch({ rotate: v || null })" /></div>
    <div class="row"><label>Blend</label><select :value="value?.blend ?? 'normal'" @change="patch({ blend: ($event.target as HTMLSelectElement).value === 'normal' ? null : ($event.target as HTMLSelectElement).value })"><option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option></select></div>
    <div class="row"><label>Blur</label><NumberField :value="value?.blur" :min="0" :max="200" unit="px" placeholder="0" @update="v => patch({ blur: v || null })" /></div>
  </div>
</template>

<style scoped>
.sub { margin: 8px 0 2px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.row label { width: 64px; }
.row label.inset { width: auto; display: inline-flex; gap: 4px; align-items: center; }
.nums { gap: 4px; }
.shadow { border-left: 2px solid #333; padding-left: 6px; margin: 4px 0; }
.tiny { padding: 1px 7px; font-size: 12px; }
input[type=range] { flex: 1; min-width: 0; }
select { flex: 1; min-width: 0; }
</style>

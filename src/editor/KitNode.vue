<script setup lang="ts">
// A patch module drawn in Bitwig Grid style: charcoal slab, signal-coloured
// title, ring in-ports (with a small knob when unconnected) on the left, dot
// out-ports on the right, big white knobs and a live drawing on the face.
// Unconnected note-bound inputs show a pre-cord icon (implicit connection).
import { computed, ref } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { PortDef } from '../core/catalog.ts';
import type { PatchNode } from '../core/schema.ts';
import { membersOf, usesOf } from '../core/parts.ts';
import type { Issue } from '../core/issues.ts';
import { useSession } from './context.ts';
import { formatValue, portColor, shortLabel, titleColor, visibleInputs, SIGNAL } from './grid-style.ts';
import { hasViz as vizFor, moduleBox } from '../core/layout.ts';
import GridKnob from './GridKnob.vue';
import ModuleViz from './ModuleViz.vue';

const props = defineProps<{ id: string; selected?: boolean; data: { node: PatchNode; issues: Issue[]; connected: string[]; scope: 'global' | 'voice' } }>();
const emit = defineEmits<{ (e: 'edit-code', id: string): void }>();
const session = useSession();
const expanded = ref(false);
const node = computed(() => props.data.node);
const def = computed(() => session.catalog.find(node.value.type));
const color = computed(() => titleColor(def.value));
const connected = computed(() => new Set(props.data.connected));
const inputs = computed(() => visibleInputs(session.catalog, node.value, connected.value, expanded.value));
const outputs = computed(() => session.catalog.outputs(node.value));
const faceSet = computed(() => new Set(session.catalog.face(node.value)));
// ---- parts ----
const part = computed(() => node.value.part ? session.doc.value.parts[node.value.part] : undefined);
const isPart = computed(() => node.value.type === 'kit.part');
/** What is inside a part, in a few words (its modules' names, in the order the sound flows). */
const contents = computed(() => {
  if (!part.value) return '';
  const inner = membersOf(session.doc.value, part.value.id).filter(n => !['kit.partIn', 'kit.partOut', 'kit.comment'].includes(n.type)).sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y);
  const names = inner.map(n => n.label ?? (n.part ? session.doc.value.parts[n.part]?.name : undefined) ?? session.catalog.find(n.type)?.title ?? n.type);
  return names.length ? `${names.slice(0, 3).join(' → ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'empty';
});
const uses = computed(() => part.value ? usesOf(session.doc.value, part.value.id).length : 0);
const alone = computed(() => !!session.solo.value && JSON.stringify(session.solo.value) === JSON.stringify([...session.partPath.value, props.id]));
/** The port a part's input or output node carries. */
const portName = computed(() => {
  if (node.value.type !== 'kit.partIn' && node.value.type !== 'kit.partOut') return '';
  const p = node.value.inside ? session.doc.value.parts[node.value.inside] : undefined;
  return [...(p?.inputs ?? []), ...(p?.outputs ?? [])].find(q => q.node === props.id)?.id ?? '?';
});
/** Inside a part, a knob that is one of its parameters shows (and sets) the value of the use we came through. */
const useHere = computed(() => session.partPath.value.at(-1));
const paramOf = (p: PortDef) => {
  const inside = node.value.inside;
  if (!inside || !useHere.value) return undefined;
  return session.doc.value.parts[inside]?.params.find(q => q.node === props.id && q.port === p.id);
};
const faceKnobs = computed(() => session.catalog.inputs(node.value).filter(p => faceSet.value.has(p.id) && !connected.value.has(p.id) && p.type === 'signal'));
const worst = computed(() => props.data.issues.some(i => i.severity === 'error') ? 'error' : props.data.issues.some(i => i.severity === 'warning') ? 'warning' : null);
const enumConfig = computed(() => def.value?.config.find(c => c.kind === 'enum' && (c.options?.length ?? 0) <= 4 && !['unit', 'scale', 'quality', 'mode', 'type'].includes(c.id)) ?? (node.value.type === 'kit.voiceIn' ? def.value?.config.find(c => c.id === 'mode') : undefined));
const isWidget = computed(() => def.value?.kind === 'widget');
const box = computed(() => moduleBox(session.catalog, node.value, connected.value, expanded.value));
const rows = computed(() => box.value.rows);
const faceWidth = computed(() => box.value.face);
const leftWidth = computed(() => box.value.left);
const rightWidth = computed(() => box.value.right);
const width = computed(() => box.value.width);
const hasViz = computed(() => vizFor(node.value.type));

function commitValue(port: PortDef, value: number | boolean, gesture?: string) {
  const param = paramOf(port);
  const target = param ? { node: useHere.value!, port: param.id } : { node: props.id, port: port.id };
  const r = session.commit([{ op: 'setValue', node: target.node, port: target.port, value, clamp: true }], { gesture, label: `Set ${target.node}.${target.port}` });
  if (!r.ok) session.toast('warn', r.error.message);
}
function setConfig(key: string, value: string) {
  const r = session.commit([{ op: 'setConfig', node: props.id, key, value }]);
  if (!r.ok) session.toast('warn', r.error.message);
}
const num = (p: PortDef) => {
  const param = paramOf(p);
  const own = param ? session.doc.value.nodes[useHere.value!]?.values[param.id] : undefined;
  return Number(own ?? node.value.values[p.id] ?? p.default ?? 0);
};

const knobRange = (p: PortDef) => ({ min: p.uiMin ?? p.min ?? 0, max: p.uiMax ?? p.max ?? 1 });
const precord = (p: PortDef) => p.binding === 'gate' ? '⎍' : p.binding === 'retrigger' ? '↑' : p.binding === 'reset' || p.binding === 'clear' ? '↺' : '';
const precordTitle = (p: PortDef) => `Pre-cord: unconnected ${p.id} follows ${props.data.scope === 'voice' ? { gate: 'the note gate', retrigger: 'each new note', reset: 'new notes / stolen voices', clear: 'stolen voices' }[p.binding!] : { gate: 'a toggle', retrigger: 'nothing', reset: 'panic', clear: 'panic' }[p.binding!]}`;
const isSmallKnob = (p: PortDef) => !connected.value.has(p.id) && p.type === 'signal' && p.role !== 'audio' && !faceSet.value.has(p.id) && !p.binding && !p.constant && !p.fallback;
const isToggle = (p: PortDef) => !connected.value.has(p.id) && p.type === 'gate' && !p.binding && !p.constant;
const WAVE_ICONS: Record<string, string> = {
  saw: 'M1 11 L10 1 L10 11 L19 1', sine: 'M1 6 C4 -2 7 -2 10 6 C13 14 16 14 19 6', pulse: 'M1 11 L1 1 L7 1 L7 11 L13 11 L13 1 L19 1', square: 'M1 11 L1 1 L10 1 L10 11 L19 11 L19 1',
  triangle: 'M1 11 L5.5 1 L14.5 11 L19 1', lowpass: 'M1 4 L11 4 C14 4 15 11 19 11', flat: 'M1 6 L19 6', soft: 'M1 11 C8 11 7 1 19 1', hard: 'M1 11 L6 11 L14 1 L19 1', asymmetric: 'M1 9 C8 9 8 1 19 1', fold: 'M1 6 L5 1 L10 11 L15 1 L19 6',
};
const widgetValue = computed(() => node.value.values.value);
const voiceText = computed(() => node.value.type === 'kit.voiceIn' ? `${node.value.config.mode === 'mono' ? 'MONO' : `POLY ×${node.value.config.capacity}`}${node.value.config.mode === 'mono' && node.value.config.legato ? ' · legato' : ''}` : '');
</script>

<template>
  <div class="mod" :class="{ selected, voice: data.scope === 'voice', [worst ?? '']: !!worst, comment: node.type === 'kit.comment', part: isPart, port: !!portName }" :style="{ '--c': color, width: `${width}px` }" :data-node="id" :data-part="part?.id">
    <header>
      <svg v-if="data.scope === 'voice'" class="poly" width="12" height="10" viewBox="0 0 12 10" aria-label="per voice"><title>Runs once per voice</title><rect x="0" y="4" width="7" height="6" rx="1" /><rect x="3" y="2" width="7" height="6" rx="1" opacity=".7" /><rect x="5" y="0" width="7" height="6" rx="1" opacity=".45" /></svg>
      <span v-if="isPart" class="partmark" title="A part: Enter or double-click goes inside">◇</span>
      <span class="title">{{ isPart ? (node.label ?? part?.name ?? 'Missing part') : portName ? `${node.type === 'kit.partIn' ? 'in' : 'out'} · ${portName}` : node.label ?? def?.title ?? node.type }}</span>
      <span v-if="def?.category === 'modulation' || def?.category === 'envelope'" class="modarrow" :style="{ color: SIGNAL.modulator }">●→</span>
    </header>
    <div v-if="!def" class="missing">Missing block<br />{{ node.type }}</div>
    <div v-else class="body" :style="{ minHeight: `${rows * 24 + 4}px` }">
      <div class="ins" :style="{ width: `${leftWidth}px` }">
        <div v-for="p in inputs.shown" :key="p.id" class="port in" :title="`${p.id}${p.unit ? ` (${p.unit})` : ''}${p.doc ? ` — ${p.doc}` : ''}`">
          <Handle :id="p.id" type="target" :position="Position.Left" class="ring" :class="{ on: connected.has(p.id) }" :style="{ '--pc': portColor(def, p, 'in') }" />
          <GridKnob v-if="isSmallKnob(p)" size="small" :value="num(p)" v-bind="knobRange(p)" :default="Number(p.default ?? 0)" :scale="p.scale" :unit="p.unit" :color="portColor(def, p, 'in')" :label="paramOf(p) ? `◆ ${p.id} (this use's own value)` : p.id" :class="{ param: !!paramOf(p) }" @change="(v, g) => commitValue(p, v, g)" />
          <button v-else-if="isToggle(p)" class="tgl nodrag" :class="{ on: !!node.values[p.id] }" @click.stop="commitValue(p, !node.values[p.id])">{{ shortLabel(p) }}</button>
          <span v-else-if="p.binding && !connected.has(p.id)" class="precord" :style="{ color: SIGNAL.logic }" :title="precordTitle(p)">{{ precord(p) }}</span>
          <span v-if="!isToggle(p) && !(faceSet.has(p.id) && !connected.has(p.id)) && !(p.role === 'audio' && ['in', 'input', 'left'].includes(p.id) && inputs.shown.length <= 2)" class="plabel">{{ shortLabel(p) }}</span>
        </div>
        <button v-if="inputs.hidden" class="more nodrag" :title="`${inputs.hidden} more inputs`" @click.stop="expanded = true">+{{ inputs.hidden }}</button>
        <button v-else-if="expanded" class="more nodrag" @click.stop="expanded = false">−</button>
      </div>
      <div class="face">
        <div v-if="enumConfig" class="seg nodrag">
          <button v-for="o in enumConfig.options" :key="o" :class="{ on: String(node.config[enumConfig.id] ?? enumConfig.default) === o }" :title="o" @click.stop="setConfig(enumConfig.id, o)">
            <svg v-if="WAVE_ICONS[o]" width="20" height="12" viewBox="0 0 20 12"><path :d="WAVE_ICONS[o]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
            <template v-else>{{ o }}</template>
          </button>
        </div>
        <div v-if="voiceText" class="voicetext">{{ voiceText }}</div>
        <template v-if="isPart">
          <div class="contents" data-testid="part-contents" :title="part?.doc ?? 'What is inside (Enter goes in)'">{{ part ? contents : `No part “${node.part}”` }}</div>
          <div class="partinfo">{{ uses > 1 ? `one of ${uses} uses` : 'used once' }}<span v-if="alone" class="alone"> · alone</span></div>
        </template>
        <ModuleViz v-if="hasViz" :node="node" :color="node.type === 'kit.out' || node.type === 'kit.audioIn' ? '#8d8d8d' : color" :width="Math.max(76, Math.min(faceWidth, 150))" :height="node.type === 'den.envelope' || node.type === 'den.curvedAdsr' ? 46 : 36" />
        <div v-if="faceKnobs.length" class="knobs">
          <GridKnob v-for="p in faceKnobs" :key="p.id" :value="num(p)" v-bind="knobRange(p)" :default="Number(p.default ?? 0)" :scale="p.scale" :unit="p.unit" :color="color" :label="`${paramOf(p) ? '◆ ' : ''}${shortLabel(p)}`" :data-param="paramOf(p)?.id" @change="(v, g) => commitValue(p, v, g)" />
        </div>
        <template v-if="isWidget">
          <div v-if="typeof widgetValue === 'number'" class="readout" :style="{ color }">{{ formatValue(widgetValue, String(node.config.unit || '')) }}</div>
          <div v-else-if="typeof widgetValue === 'boolean'" class="readout" :style="{ color }">{{ widgetValue ? 'ON' : 'OFF' }}</div>
          <div class="muted tiny">{{ node.panel ? 'on panel' : 'not on panel' }}</div>
        </template>
        <button v-if="def.kind === 'codebox'" class="code nodrag" @click.stop="emit('edit-code', id)">{ } Edit code</button>
        <div v-if="node.type === 'kit.comment'" class="note">{{ node.text || 'Comment' }}</div>
      </div>
      <div class="outs" :style="{ width: `${rightWidth}px` }">
        <div v-for="p in outputs" :key="p.id" class="port out">
          <span v-if="!(outputs.length === 1 && p.id === 'out')" class="plabel">{{ p.label ?? p.id }}</span>
          <Handle :id="p.id" type="source" :position="Position.Right" class="dot" :style="{ '--pc': portColor(def, p, 'out') }" />
        </div>
      </div>
    </div>
    <div v-if="worst" class="badge" :title="data.issues.map(i => i.message).join('\n')">!</div>
  </div>
</template>

<style scoped>
.mod { position: relative; background: #2c2c2c; border-radius: 6px; color: #d6d6d6; font-family: Lato, system-ui, sans-serif; font-size: 11px; box-shadow: 0 1px 0 #ffffff08 inset; }
.mod.selected { box-shadow: 0 0 0 2px #d9d9d9; }
.mod.error { box-shadow: 0 0 0 2px #ff3a5c; } .mod.warning { box-shadow: 0 0 0 1px #ffd43b99; }
.mod.selected.error { box-shadow: 0 0 0 2px #d9d9d9, 0 0 0 4px #ff3a5c; }
header { position: relative; text-align: center; padding: 6px 22px 2px; height: 24px; }
.title { color: var(--c); font-size: 14px; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.poly { position: absolute; left: 8px; top: 8px; fill: #ff8c1a; opacity: .55; }
.modarrow { position: absolute; right: 7px; top: 5px; font-size: 11px; letter-spacing: -2px; }
.body { display: flex; align-items: stretch; padding: 2px 0 6px; }
.ins, .outs { display: flex; flex-direction: column; flex: none; }
.face { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 0 2px; min-width: 0; }
.port { position: relative; height: 24px; display: flex; align-items: center; gap: 3px; }
.port.in { padding-left: 16px; } .port.out { padding-right: 16px; justify-content: flex-end; }
.plabel { color: #767676; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 48px; }
.precord { font-size: 12px; width: 12px; text-align: center; }
.knobs { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.seg { display: flex; gap: 2px; }
.seg button { background: transparent; border: 0; box-shadow: none; color: #6a6a6a; font-size: 11px; padding: 1px 4px; border-radius: 3px; cursor: pointer; display: grid; place-items: center; }
.seg button.on { color: var(--c); background: #ffffff0d; }
.voicetext { color: #ff8c1a; font-size: 12px; letter-spacing: .04em; }
.readout { font-size: 15px; font-variant-numeric: tabular-nums; }
.tiny { font-size: 10px; }
.tgl { background: #3a3a3a; border: 0; color: #9a9a9a; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer; }
.tgl.on { background: #ffd43b; color: #1a1a1a; }
.more { margin: 2px 0 0 14px; align-self: flex-start; background: transparent; border: 1px solid #444; color: #999; font-size: 10px; padding: 0 5px; border-radius: 8px; cursor: pointer; }
.code { background: #3a3a3a; border: 0; color: var(--c); font: 12px ui-monospace, monospace; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.note { white-space: pre-wrap; color: #e8e8e8; font-size: 12px; padding: 4px 6px; max-width: 220px; }
.mod.comment { background: #3b3a2e; }
/* A part: a double edge, its contents on the face. Its inputs and outputs inside: a dashed edge. */
.mod.part { background: #262a30; box-shadow: 0 0 0 1px #5ec4ff55, 0 0 0 4px #262a30, 0 0 0 5px #5ec4ff33; }
.mod.part.selected { box-shadow: 0 0 0 2px #d9d9d9, 0 0 0 4px #262a30, 0 0 0 5px #5ec4ff66; }
.mod.port { background: #232323; outline: 1px dashed #5ec4ff66; outline-offset: -1px; }
.partmark { position: absolute; left: 8px; top: 5px; color: #5ec4ff; font-size: 12px; }
.mod.voice .partmark { left: 24px; }
.contents { color: #cfe9ff; font-size: 11.5px; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; }
.partinfo { color: #777; font-size: 10px; }
.alone { color: #ffd43b; }
:deep(.param) { outline: 1px solid #5ec4ff88; border-radius: 50%; }
.missing { padding: 8px; color: #ff3a5c; text-align: center; }
.badge { position: absolute; top: -7px; right: -7px; width: 16px; height: 16px; border-radius: 50%; background: #ff3a5c; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 11px; }
.warning .badge { background: #ffd43b; color: #111; }
/* Ports: rings for inputs, filled dots for outputs, coloured by signal type. */
.port :deep(.vue-flow__handle) { width: 11px; height: 11px; min-width: 0; min-height: 0; border-radius: 50%; border: 2px solid var(--pc); background: #2c2c2c; top: 50%; }
.port.in :deep(.vue-flow__handle) { left: 3px; transform: translateY(-50%); }
.port.out :deep(.vue-flow__handle) { right: 3px; left: auto; transform: translateY(-50%); background: var(--pc); }
.port.in :deep(.vue-flow__handle.on) { background: var(--pc); }
.port :deep(.vue-flow__handle:hover) { box-shadow: 0 0 0 3px #ffffff30; }
</style>

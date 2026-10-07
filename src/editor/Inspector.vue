<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isParamInput, type ConfigDef } from '../core/catalog.ts';
import type { ConfigValue } from '../core/schema.ts';
import { exposeIntents, useSession } from './context.ts';
import ValueField from './ValueField.vue';

const emit = defineEmits<{ (e: 'edit-code', id: string): void }>();
const session = useSession();
const node = computed(() => session.selection.value.length === 1 ? session.doc.value.nodes[session.selection.value[0]!] : undefined);
const def = computed(() => node.value ? session.catalog.find(node.value.type) : undefined);
const scope = computed(() => node.value ? session.validation.value.analysis.scope.get(node.value.id) ?? 'global' : 'global');
const label = ref('');
watch(node, n => { label.value = n?.label ?? ''; }, { immediate: true });
const edges = computed(() => Object.values(session.doc.value.edges));
const issues = computed(() => node.value ? session.issues.value.filter(i => i.node === node.value!.id) : []);
const TEST_SIGNALS = [['chords', 'Chords'], ['drums', 'Drums'], ['noise', 'Noise'], ['off', 'Silence']] as const;
const testSignal = ref(session.engine.testSignalKind);
function setTestSignal(kind: string) { testSignal.value = kind as typeof testSignal.value; session.engine.setTestSignal(kind as never); }
const inputs = computed(() => node.value ? session.catalog.inputs(node.value).filter(p => !p.hidden) : []);
const incoming = (port: string) => edges.value.find(e => e.to.node === node.value?.id && e.to.port === port);

function commit(...args: Parameters<typeof session.commit>) { const r = session.commit(...args); if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`); return r; }
function setConfig(c: ConfigDef, raw: string | boolean) {
  const value: ConfigValue = c.kind === 'number' ? Number(raw) : c.kind === 'boolean' ? Boolean(raw) : String(raw);
  commit([{ op: 'setConfig', node: node.value!.id, key: c.id, value }]);
}
function expose(port: string) {
  const { widget } = exposeIntents(session, node.value!.id, port);
  const id = `${widget.type === 'ui.toggle' ? 'toggle' : 'knob'}${Object.keys(session.doc.value.nodes).length + 1}`;
  const r = commit([{ op: 'addNode', node: { ...widget, id } }, { op: 'connect', from: { node: id, port: 'out' }, to: { node: node.value!.id, port } }], { label: `Expose ${port} to panel` });
  if (r.ok) session.toast('info', `Added "${widget.label}" to the plugin.`);
}
const configDefs = computed(() => def.value?.config ?? []);
</script>

<template>
  <div class="inspector" data-testid="inspector">
    <template v-if="node && def">
      <div class="section">
        <h3>Module</h3>
        <div class="mname">{{ node.label ?? def.title }} <span class="muted">({{ def.title }})</span></div>
        <div class="msub"><span class="mono">{{ node.id }}</span>{{ scope === 'voice' ? ' · runs per voice' : '' }}</div>
        <div class="summary">{{ def.summary }}</div>
        <div v-if="def.doc" class="muted doc">{{ def.doc }}</div>
        <div class="row"><label>Label</label><input v-model="label" type="text" @change="commit([{ op: 'setLabel', node: node.id, label: label || null }])" /></div>
        <button v-if="def.kind === 'codebox'" class="primary" @click="emit('edit-code', node.id)">Edit code</button>
        <div v-if="node.type === 'kit.audioIn'" class="row" title="What this effect patch hears while you try it"><label>Test input</label><select :value="testSignal" data-testid="test-signal" @change="setTestSignal(($event.target as HTMLSelectElement).value)"><option v-for="[id, title] in TEST_SIGNALS" :key="id" :value="id">{{ title }}</option></select></div>
      </div>
      <div v-if="configDefs.length" class="section">
        <h3>Construction (recompiles)</h3>
        <div v-for="c in configDefs" :key="c.id" class="row" :title="c.doc">
          <label>{{ c.label ?? c.id }}</label>
          <select v-if="c.kind === 'enum'" :value="String(node.config[c.id] ?? c.default)" :data-config="c.id" @change="setConfig(c, ($event.target as HTMLSelectElement).value)"><option v-for="o in c.options" :key="o" :value="o">{{ o || '—' }}</option></select>
          <input v-else-if="c.kind === 'boolean'" type="checkbox" :checked="Boolean(node.config[c.id] ?? c.default)" :data-config="c.id" @change="setConfig(c, ($event.target as HTMLInputElement).checked)" />
          <input v-else type="number" :value="node.config[c.id] ?? c.default" :min="c.min" :max="c.max" :step="c.integer ? 1 : 'any'" :data-config="c.id" @change="setConfig(c, ($event.target as HTMLInputElement).value)" />
        </div>
      </div>
      <div v-if="inputs.length" class="section">
        <h3>Inputs</h3>
        <div v-for="p in inputs" :key="p.id" class="row" :title="p.doc">
          <label>{{ p.label ?? p.id }}</label>
          <template v-if="incoming(p.id)">
            <span class="muted">← {{ incoming(p.id)!.from.node }}.{{ incoming(p.id)!.from.port }}</span>
            <button class="small" title="Disconnect" @click="commit([{ op: 'disconnect', id: incoming(p.id)!.id }])">×</button>
          </template>
          <template v-else-if="isParamInput(p, scope)">
            <ValueField :node="node.id" :port="p" :value="node.values[p.id]" />
            <span class="muted unit">{{ p.unit }}</span>
            <button class="small" :data-expose="p.id" title="Put a control for this on the plugin" @click="expose(p.id)">→ Plugin</button>
          </template>
          <span v-else class="muted">{{ p.binding ? `follows ${p.binding}` : p.fallback ? `uses ${p.fallback}` : p.role === 'audio' ? 'silent' : String(p.default) }}</span>
        </div>
      </div>
    </template>
    <div v-else-if="session.selection.value.length > 1" class="section"><h3>{{ session.selection.value.length }} modules selected</h3><div class="muted">Delete, copy (⌘C) or duplicate (⌘D).</div></div>
    <div v-else class="section empty"><div class="muted">Select a module to see all of its settings.</div></div>
    <div v-if="issues.length" class="section">
      <h3>Issues</h3>
      <div v-for="(i, k) in issues" :key="k" class="issue" :class="i.severity"><span class="sev">{{ i.severity }}</span><span>{{ i.message }}<template v-if="i.line"> (line {{ i.line }})</template></span></div>
    </div>
  </div>
</template>

<style scoped>
.doc { margin-top: 4px; font-size: 12px; }
.mname { font-size: 15px; color: #eee; }
.msub { color: #8a8a8a; font-size: 12px; margin: 2px 0 4px; }
.mono { font-family: ui-monospace, monospace; }
.summary { color: #a9a9a9; font-style: italic; font-size: 12.5px; }
.small { padding: 0 6px; font-size: 11px; }
.unit { width: 24px; font-size: 11px; }
.row select, .row input[type=number], .row input[type=text] { flex: 1; min-width: 0; }
</style>

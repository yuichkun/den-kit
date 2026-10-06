<script setup lang="ts">
import { computed, ref } from 'vue';
import { CODEBOX_TEMPLATE } from '../core/codebox.ts';
import type { PortSpec } from '../core/schema.ts';
import { useSession } from './context.ts';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const session = useSession();
const node = computed(() => session.doc.value.nodes[props.id]);
const code = ref(node.value?.code || CODEBOX_TEMPLATE);
const inputs = ref<PortSpec[]>(JSON.parse(JSON.stringify(node.value?.ports?.inputs ?? [{ id: "in", type: "signal" }])));
const outputs = ref<PortSpec[]>(JSON.parse(JSON.stringify(node.value?.ports?.outputs ?? [{ id: "out", type: "signal" }])));
const issues = computed(() => session.issues.value.filter(i => i.node === props.id));
const dirty = computed(() => code.value !== (node.value?.code ?? '') || JSON.stringify({ i: inputs.value, o: outputs.value }) !== JSON.stringify({ i: node.value?.ports?.inputs, o: node.value?.ports?.outputs }));
function apply() {
  const r = session.commit([{ op: 'setCode', node: props.id, code: code.value, ports: { inputs: inputs.value, outputs: outputs.value } }], { label: `Edit ${props.id} code` });
  if (!r.ok) session.toast('warn', r.error.message);
}
function tab(e: KeyboardEvent) {
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target as HTMLTextAreaElement; const s = t.selectionStart; code.value = code.value.slice(0, s) + '  ' + code.value.slice(t.selectionEnd); requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2)); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') apply();
}
const add = (list: PortSpec[], stem: string) => { let k = list.length + 1; while (list.some(p => p.id === `${stem}${k}`)) k++; list.push({ id: `${stem}${k}`, type: 'signal' }); };
</script>

<template>
  <div class="overlay" @pointerdown.self="emit('close')">
    <div class="modal" data-testid="codebox-editor">
      <header><b>Codebox {{ id }}</b><span class="muted">unworklet core API · ⌘/Ctrl+Enter applies</span><span style="flex:1" /><button @click="code = CODEBOX_TEMPLATE">Template</button><button class="primary" :disabled="!dirty" @click="apply">Apply</button><button @click="emit('close')">Close</button></header>
      <div class="body">
        <textarea v-model="code" spellcheck="false" data-testid="codebox-source" @keydown="tab" />
        <aside>
          <h4>Inputs</h4>
          <div v-for="(p, i) in inputs" :key="i" class="port"><input v-model="p.id" type="text" /><select v-model="p.type"><option>signal</option><option>gate</option></select><button @click="inputs.splice(i, 1)">×</button></div>
          <button @click="add(inputs, 'in')">+ input</button>
          <h4>Outputs</h4>
          <div v-for="(p, i) in outputs" :key="i" class="port"><input v-model="p.id" type="text" /><select v-model="p.type"><option>signal</option><option>gate</option></select><button @click="outputs.splice(i, 1)">×</button></div>
          <button @click="add(outputs, 'out')">+ output</button>
          <h4>Problems</h4>
          <div v-if="!issues.length" class="muted">None. {{ session.compileStatus.value === 'compiling' ? 'Compiling…' : '' }}</div>
          <div v-for="(i, k) in issues" :key="k" class="issue" :class="i.severity" data-testid="codebox-issue"><span class="sev">{{ i.line ? `L${i.line}` : i.severity }}</span><span>{{ i.message }}</span></div>
        </aside>
      </div>
      <footer class="muted">tick(i) gets the inputs as Node values and must return {{ '{' }} {{ outputs.map(o => o.id).join(', ') }} {{ '}' }}. Only @unworklet/core can be imported.</footer>
    </div>
  </div>
</template>

<style scoped>
.body { display: grid; grid-template-columns: 1fr 260px; min-height: 0; }
textarea { resize: none; border: 0; border-radius: 0; font: 12.5px/1.5 ui-monospace, Menlo, monospace; padding: 10px; background: #0f1115; white-space: pre; tab-size: 2; }
aside { border-left: 1px solid var(--line); padding: 8px; overflow: auto; font-size: 12px; }
h4 { margin: 8px 0 4px; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.port { display: flex; gap: 4px; margin-bottom: 4px; } .port input { width: 90px; }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isParamInput, type ConfigDef, type PortDef } from '../core/catalog.ts';
import type { ConfigValue } from '../core/schema.ts';
import { RANGE_UNITS, membersOf, partInterface, usesOf } from '../core/parts.ts';
import type { PartParam } from '../core/schema.ts';
import { describeDiff } from '../core/library.ts';
import { describeFace } from '../core/face.ts';
import { faceOnPlugin } from '../plugin/faces.ts';
import { useSession } from './context.ts';
import { ControlError, controlFor } from '../plugin/controls.ts';
import ValueField from './ValueField.vue';
import InputSelect from './InputSelect.vue';
import StackSection from './StackSection.vue';
import { stackable } from '../core/stacks.ts';

const emit = defineEmits<{ (e: 'edit-code', id: string): void }>();
const session = useSession();
const node = computed(() => session.selection.value.length === 1 ? session.doc.value.nodes[session.selection.value[0]!] : undefined);
const def = computed(() => node.value ? session.catalog.find(node.value.type) : undefined);
const scope = computed(() => node.value ? session.validation.value.analysis.scope.get(node.value.id) ?? 'global' : 'global');
const label = ref('');
watch(node, n => { label.value = n?.label ?? ''; }, { immediate: true });
const edges = computed(() => Object.values(session.doc.value.edges));
const issues = computed(() => {
  if (!node.value) return [];
  const path = session.partPath.value;
  return session.issues.value.filter(i => path.length ? i.path?.[path.length] === node.value!.id && path.every((p, k) => i.path![k] === p) : i.node === node.value!.id);
});
const inputs = computed(() => node.value ? session.catalog.inputs(node.value).filter(p => !p.hidden) : []);
const incoming = (port: string) => edges.value.find(e => e.to.node === node.value?.id && e.to.port === port);

function commit(...args: Parameters<typeof session.commit>) { const r = session.commit(...args); if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`); return r; }
function setConfig(c: ConfigDef, raw: string | boolean) {
  const value: ConfigValue = c.kind === 'number' ? Number(raw) : c.kind === 'boolean' ? Boolean(raw) : String(raw);
  commit([{ op: 'setConfig', node: node.value!.id, key: c.id, value }]);
}
function expose(port: string) {
  let made;
  try { made = controlFor(session.doc.value, session.catalog, { node: node.value!.id, port }); }
  catch (error) { if (error instanceof ControlError) { session.toast('warn', error.message); return; } throw error; }
  const r = commit(made.intents, { label: `Expose ${port} to panel` });
  if (r.ok) session.toast('info', made.placed ? `Added "${session.doc.value.nodes[made.id]?.label}" to the plugin.` : `Added "${session.doc.value.nodes[made.id]?.label}" in the corner: the plugin has no free space (make it bigger, or move things).`);
}
const configDefs = computed(() => def.value?.config ?? []);

// ---- parts ---------------------------------------------------------------------------
/** The part a selected use stands for. */
const usedPart = computed(() => node.value?.type === 'kit.part' && node.value.part ? session.doc.value.parts[node.value.part] : undefined);
/** The part the view is inside (what an empty selection shows). */
const here = computed(() => session.scope.value ? session.doc.value.parts[session.scope.value] : undefined);
/** The part whose settings are shown: the selected use's, or the one we are inside. */
const shown = computed(() => usedPart.value ?? (!node.value && session.selection.value.length === 0 ? here.value : undefined));
const partName = ref(''), partDoc = ref('');
watch(shown, p => { partName.value = p?.name ?? ''; partDoc.value = p?.doc ?? ''; }, { immediate: true });
const usesOfShown = computed(() => shown.value ? usesOf(session.doc.value, shown.value.id) : []);
const insideCount = computed(() => shown.value ? membersOf(session.doc.value, shown.value.id).filter(n => !['kit.partIn', 'kit.partOut'].includes(n.type)).length : 0);
const soloPath = computed(() => usedPart.value ? [...session.partPath.value, node.value!.id] : [...session.partPath.value]);
const alone = computed(() => JSON.stringify(session.solo.value) === JSON.stringify(soloPath.value));
function rename() { if (shown.value && partName.value.trim() && partName.value !== shown.value.name) commit([{ op: 'updatePart', part: shown.value.id, name: partName.value }], { label: 'Rename part' }); }
function describe() { if (shown.value && partDoc.value !== (shown.value.doc ?? '')) commit([{ op: 'updatePart', part: shown.value.id, doc: partDoc.value || null }], { label: 'Describe part' }); }
function unpack() { const r = commit([{ op: 'unpackPart', node: node.value!.id }], { label: 'Unpack a part' }); if (r.ok) session.select(r.created); }
function detach() { commit([{ op: 'detachPart', node: node.value!.id }], { label: 'Own copy of a part' }); }
/** Inside a part: is this knob one of the part's parameters? */
const paramOf = (p: PortDef) => node.value?.inside ? session.doc.value.parts[node.value.inside]?.params.find(q => q.node === node.value!.id && q.port === p.id) : undefined;
const useHere = computed(() => session.partPath.value.at(-1));
const useValue = (paramId: string) => useHere.value ? session.doc.value.nodes[useHere.value]?.values[paramId] : undefined;
const useParamPort = (paramId: string) => useHere.value ? session.catalog.input(session.doc.value.nodes[useHere.value]!, paramId) : undefined;
function toggleParam(p: PortDef) {
  const part = node.value!.inside!;
  const param = paramOf(p);
  commit([param ? { op: 'removeParam', part, id: param.id } : { op: 'addParam', part, node: node.value!.id, port: p.id }], { label: param ? 'Hide a parameter' : 'Show a knob on the part' });
}
/** Where a cable comes from, said plainly (a part's input by its name). */
function sourceName(from: { node: string; port: string }) {
  const n = session.doc.value.nodes[from.node];
  if (n?.type === 'kit.partIn' && n.inside) return `the part's input "${session.doc.value.parts[n.inside]?.inputs.find(p => p.node === n.id)?.id ?? '?'}"`;
  return `${from.node}.${from.port}`;
}
function removeParam(id: string) { if (shown.value) commit([{ op: 'removeParam', part: shown.value.id, id }], { label: 'Hide a parameter' }); }
// A parameter's knob range (its own, or the knob's inside): where its knob turns and in what unit.
const paramPorts = computed(() => shown.value ? new Map(partInterface(session.doc.value, session.catalog, shown.value).inputs.map(p => [p.id, p])) : new Map<string, PortDef>());
function rangeOf(p: PartParam) {
  const port = paramPorts.value.get(p.id);
  if (!port || port.type === 'gate') return null;
  return { min: port.uiMin ?? port.min ?? 0, max: port.uiMax ?? port.max ?? 1, unit: port.unit ?? '' };
}
function setRange(p: PartParam, key: 'min' | 'max' | 'unit', e: Event) {
  const now = rangeOf(p), raw = (e.target as HTMLInputElement | HTMLSelectElement).value;
  if (!now || !shown.value) return;
  const next = { ...(p.range ?? {}), min: now.min, max: now.max, unit: now.unit, [key]: key === 'unit' ? raw : Number(raw) };
  if (key !== 'unit' && !Number.isFinite(next[key])) return;
  commit([{ op: 'updatePart', part: shown.value.id, ranges: { [p.id]: next } }], { label: `Range of ${p.label ?? p.id}` });
}
function resetRange(p: PartParam) { if (shown.value) commit([{ op: 'updatePart', part: shown.value.id, ranges: { [p.id]: null } }], { label: `Range of ${p.label ?? p.id}` }); }
// ---- My parts ----
/** Where the shown part stands with My parts (read again when the patch or My parts change). */
const mine = computed(() => { void session.doc.value; void session.myParts.value; return shown.value ? session.myPartStatus(shown.value.id) : null; });
// ---- faces ----
const faceText = computed(() => usedPart.value && node.value ? describeFace(usedPart.value, session.catalog.inputs(node.value)) : '');
const faceOn = computed(() => node.value ? faceOnPlugin(session.doc.value, node.value.id).length > 0 : false);
function putFace() { const r = session.putFace(node.value!.id); session.toast(r.ok ? 'info' : 'warn', r.message); }
function resetFace() { commit([{ op: 'updatePart', part: usedPart.value!.id, face: null }], { label: 'Default face' }); }
function saveMine() { const r = session.saveToMyParts(shown.value!.id); session.toast(r.ok ? 'info' : 'warn', r.message); }
function updateMine() { const r = session.updateFromMyParts(shown.value!.id); session.toast(r.ok ? 'info' : 'warn', r.message); }
</script>

<template>
  <div class="inspector" data-testid="inspector">
    <div v-if="shown" class="section" data-testid="part-inspector">
      <h3>Part</h3>
      <div class="row"><label>Name</label><input v-model="partName" type="text" data-testid="part-name" @change="rename" /></div>
      <textarea v-model="partDoc" rows="2" class="pdoc" placeholder="What it does (the AI reads this too)" data-testid="part-doc" @change="describe" />
      <div class="muted small-text">{{ insideCount }} module{{ insideCount === 1 ? '' : 's' }} inside · used {{ usesOfShown.length }} time{{ usesOfShown.length === 1 ? '' : 's' }}<template v-if="usesOfShown.length > 1"> ({{ usesOfShown.map(n => n.id).join(', ') }})</template>. Edits inside change every use; each use keeps its own parameter values.</div>
      <div class="buttons">
        <button v-if="usedPart" class="primary" data-testid="part-enter" @click="session.enterPart(node!.id)">Go inside <span class="kbd-hint">↵</span></button>
        <button v-else data-testid="part-leave" @click="session.leavePart()">Go out <span class="kbd-hint">Esc</span></button>
        <button :class="{ on: alone }" data-testid="part-alone" @click="session.setSolo(alone ? null : soloPath)">{{ alone ? 'Hear everything' : 'Hear alone' }}</button>
        <template v-if="usedPart">
          <button data-testid="part-unpack" title="Put the modules back in place of this part (⇧⌘G)" @click="unpack">Unpack <span class="kbd-hint">⇧⌘G</span></button>
          <button data-testid="part-detach" :disabled="usesOfShown.length < 2" :title="usesOfShown.length < 2 ? 'Used only here: it is already its own' : 'Give this use its own copy: edits inside it then change only this one'" @click="detach">Own copy</button>
        </template>
      </div>
      <div v-if="usedPart && node" class="face" data-testid="part-face">
        <div class="muted small-text">Face: {{ faceText }}<template v-if="faceOn"> · on the plugin</template></div>
        <div v-if="node.inside" class="muted small-text">Faces go on the plugin from uses in the main patch.</div>
        <div v-else class="buttons">
          <button data-testid="part-face-put" :title="'Put this use\'s controls (its parameters) and decorations on the plugin, together; again puts the current face in place of the one there'" @click="putFace">{{ faceOn ? 'Update face on plugin' : 'Put face on plugin' }}</button>
          <button v-if="usedPart.face" data-testid="part-face-reset" title="Back to the default face (its name over a knob per parameter)" @click="resetFace">Default face</button>
        </div>
      </div>
      <div class="mine" data-testid="my-part">
        <div v-if="mine?.entry" class="muted small-text" data-testid="my-part-status">★ From My parts: {{ mine.entry.name }} v{{ mine.version }}<template v-if="mine.changedHere"> · changed here since</template></div>
        <div v-else-if="shown.from" class="muted small-text" data-testid="my-part-status">★ Came from My parts (“{{ shown.from.id }}” is no longer there).</div>
        <div v-if="mine?.newer" class="newer" data-testid="my-part-newer">
          <div>v{{ mine.newer.version }} is in My parts: {{ mine.diff ? describeDiff(mine.diff) : '' }}.<template v-if="mine.changedHere"> Updating replaces what was changed here.</template></div>
          <button class="primary" data-testid="my-part-update" @click="updateMine">Update to v{{ mine.newer.version }}</button>
        </div>
        <button data-testid="my-part-save" :title="mine?.entry ? 'Save what this part is now as a new version in My parts (other patches are offered the update)' : 'Keep this part in My parts: every patch can place it from the palette'" @click="saveMine">{{ mine?.entry ? `Save as v${(mine.entry.versions.at(-1)?.version ?? 0) + 1}` : 'Save to My parts' }}</button>
      </div>
      <div v-if="!usedPart && shown.params.length" class="plist">
        <div class="muted small-text">Parameters (each use has its own value):</div>
        <template v-for="p in shown.params" :key="p.id">
          <div class="prow" :data-param-row="p.id"><span>◆ {{ p.label ?? p.id }}</span><span class="muted mono">{{ p.node }}.{{ p.port }}</span><button class="small" title="Hide from the part" @click="removeParam(p.id)">×</button></div>
          <div v-if="rangeOf(p)" class="prange" :data-param-range="p.id" :title="p.range ? 'Its own knob range' : 'The range of the knob inside (type to give it its own)'">
            <input type="number" step="any" :value="rangeOf(p)!.min" aria-label="Knob from" data-range="min" @change="setRange(p, 'min', $event)" />
            <span class="muted">–</span>
            <input type="number" step="any" :value="rangeOf(p)!.max" aria-label="Knob to" data-range="max" @change="setRange(p, 'max', $event)" />
            <select :value="rangeOf(p)!.unit" aria-label="Unit" data-range="unit" @change="setRange(p, 'unit', $event)"><option v-for="u in RANGE_UNITS" :key="u" :value="u">{{ u || '—' }}</option></select>
            <button v-if="p.range" class="small" title="Back to the knob's own range" data-range="reset" @click="resetRange(p)">↺</button>
          </div>
        </template>
      </div>
      <div v-else-if="!usedPart" class="muted small-text">No parameters yet: select a module here and press ◇ next to a knob to show it on the part.</div>
    </div>
    <template v-if="node && def">
      <div class="section">
        <h3>{{ usedPart ? 'This use' : 'Module' }}</h3>
        <div class="mname">{{ node.label ?? usedPart?.name ?? def.title }} <span class="muted">({{ usedPart ? 'part' : def.title }})</span></div>
        <div class="msub"><span class="mono">{{ node.id }}</span>{{ scope === 'voice' ? ' · runs per voice' : '' }}<template v-if="node.inside"> · inside {{ session.doc.value.parts[node.inside]?.name }}</template></div>
        <div v-if="!usedPart" class="summary">{{ def.summary }}</div>
        <div v-if="def.doc && !usedPart" class="muted doc">{{ def.doc }}</div>
        <div class="row"><label>Label</label><input v-model="label" type="text" @change="commit([{ op: 'setLabel', node: node.id, label: label || null }])" /></div>
        <button v-if="def.kind === 'codebox'" class="primary" @click="emit('edit-code', node.id)">Edit code</button>
        <div v-if="node.type === 'kit.audioIn'" class="row" title="What this effect patch hears while you try it"><label>Input</label><InputSelect /></div>
      </div>
      <StackSection v-if="stackable(session.catalog, node.type)" :node="node" />
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
        <h3>{{ usedPart ? 'Inputs and parameters' : 'Inputs' }}</h3>
        <div v-for="p in inputs" :key="p.id" class="row" :title="p.doc">
          <label>{{ p.label ?? p.id }}</label>
          <template v-if="incoming(p.id)">
            <span class="muted">← {{ sourceName(incoming(p.id)!.from) }}</span>
            <button class="small" title="Disconnect" @click="commit([{ op: 'disconnect', id: incoming(p.id)!.id }])">×</button>
          </template>
          <template v-else-if="isParamInput(p, scope)">
            <template v-if="paramOf(p) && useHere && useParamPort(paramOf(p)!.id)">
              <ValueField :node="useHere" :port="useParamPort(paramOf(p)!.id)!" :value="useValue(paramOf(p)!.id)" />
            </template>
            <ValueField v-else :node="node.id" :port="p" :value="node.values[p.id]" />
            <span class="muted unit">{{ p.unit }}</span>
            <button v-if="node.inside" class="small ptoggle" :class="{ on: !!paramOf(p) }" :data-param-toggle="p.id" :title="paramOf(p) ? 'Shown on the part: each use has its own value. Click to hide.' : 'Show this knob on the part (each use gets its own value)'" @click="toggleParam(p)">{{ paramOf(p) ? '◆' : '◇' }}</button>
            <button v-else-if="!node.inside" class="small" :data-expose="p.id" title="Put a control for this on the plugin" @click="expose(p.id)">→ Plugin</button>
          </template>
          <span v-else class="muted">{{ p.binding ? `follows ${p.binding}` : p.fallback ? `uses ${p.fallback}` : usedPart && p.role === 'audio' ? 'not connected' : p.role === 'audio' ? 'silent' : String(p.default) }}</span>
        </div>
      </div>
    </template>
    <div v-else-if="session.selection.value.length > 1" class="section"><h3>{{ session.selection.value.length }} modules selected</h3><div class="muted">Make a part (⌘G), delete, copy (⌘C) or duplicate (⌘D).</div></div>
    <div v-else-if="!shown" class="section empty"><div class="muted">Select a module to see all of its settings.</div></div>
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
.pdoc { width: 100%; box-sizing: border-box; margin: 4px 0; font-size: 12px; resize: vertical; }
.small-text { font-size: 11.5px; margin: 2px 0 6px; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.buttons button.on { background: #ffd43b; color: #111; }
.plist { margin-top: 8px; }
.prow { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; }
.prow .mono { font-size: 11px; flex: 1; }
.prange { display: flex; align-items: center; gap: 4px; margin: 0 0 4px 16px; font-size: 11px; }
.prange input { width: 64px; font-size: 11px; padding: 1px 4px; }
.prange select { font-size: 11px; }
.ptoggle { color: #5ec4ff; }
.ptoggle.on { background: #5ec4ff33; }
.face { margin-top: 8px; }
.mine { margin-top: 8px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.newer { background: #ffd27a14; border: 1px solid #ffd27a55; border-radius: 4px; padding: 6px 8px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
</style>

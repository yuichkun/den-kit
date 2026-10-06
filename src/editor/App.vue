<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { STARTERS, type StarterId } from '../core/starters.ts';
import { SESSION } from './context.ts';
import { KitSession } from './session.ts';
import PatchView from './PatchView.vue';
import PanelView from './PanelView.vue';
import CodeView from './CodeView.vue';
import Inspector from './Inspector.vue';
import KeyboardBar from './KeyboardBar.vue';
import CodeboxEditor from './CodeboxEditor.vue';

const props = defineProps<{ session: KitSession }>();
const session = props.session;
provide(SESSION, session);
const view = ref<'patch' | 'panel' | 'code'>('patch');
const editing = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const name = ref(session.doc.value.name);
watch(() => session.doc.value.name, n => { name.value = n; });
const canUndo = computed(() => (session.historyVersion.value, session.history.canUndo));
const canRedo = computed(() => (session.historyVersion.value, session.history.canRedo));
const audioIn = computed(() => session.generated.value.audioIn);
const statusText = computed(() => session.compileStatus.value === 'ok' ? `✓ ${session.compileMessage.value}` : session.compileMessage.value || session.compileStatus.value);

function undoRedo(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); session.redo(); }
  else if (e.key === 'Escape') editing.value = null;
}
onMounted(() => { window.addEventListener('keydown', undoRedo); window.addEventListener('pagehide', () => session.saveNow()); });
onBeforeUnmount(() => window.removeEventListener('keydown', undoRedo));
function rename() { session.commit([{ op: 'setName', name: name.value }]); }
function exportPatch() {
  const blob = new Blob([session.exportText()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${session.doc.value.name.replace(/[^\w-]+/g, '_') || 'patch'}.denkit.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importPatch(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { session.toast('error', 'Import refused: file is larger than 5 MB.'); return; }
  if (session.importText(await file.text())) name.value = session.doc.value.name;
  (e.target as HTMLInputElement).value = '';
}
function loadStarter(e: Event) { const id = (e.target as HTMLSelectElement).value as StarterId; if (id) { session.loadStarter(id); name.value = session.doc.value.name; } (e.target as HTMLSelectElement).value = ''; }
</script>

<template>
  <div class="kit-shell">
    <div class="toolbar">
      <div class="group"><span class="logo"><i v-for="k in 8" :key="k" /></span><b>den-kit</b><input v-model="name" class="name" type="text" data-testid="patch-name" @change="rename" /></div>
      <div class="group">
        <select data-testid="starter" @change="loadStarter"><option value="">Load starter…</option><option v-for="s in STARTERS" :key="s" :value="s">{{ s }}</option></select>
        <button :disabled="!canUndo" title="Undo (⌘Z)" data-testid="undo" @click="session.undo()">↶</button>
        <button :disabled="!canRedo" title="Redo (⇧⌘Z)" data-testid="redo" @click="session.redo()">↷</button>
      </div>
      <div class="group" title="Store/recall snapshots to compare by ear">
        <button data-testid="store-a" @click="session.storeSnapshot('A')">Store A</button><button :disabled="!session.snapshots.A" :class="{ primary: session.snapshots.active === 'A' }" data-testid="recall-a" @click="session.recallSnapshot('A')">A</button>
        <button :disabled="!session.snapshots.B" :class="{ primary: session.snapshots.active === 'B' }" data-testid="recall-b" @click="session.recallSnapshot('B')">B</button><button data-testid="store-b" @click="session.storeSnapshot('B')">Store B</button>
      </div>
      <div class="group"><button @click="fileInput?.click()">Import</button><button @click="exportPatch">Export</button><input ref="fileInput" type="file" accept=".json,.denkit.json,application/json" hidden data-testid="import-file" @change="importPatch" /></div>
      <div class="tabs">
        <button :class="{ active: view === 'patch' }" data-testid="view-patch" @click="view = 'patch'">Patch</button>
        <button :class="{ active: view === 'panel' }" data-testid="view-panel" @click="view = 'panel'">Panel</button>
        <button :class="{ active: view === 'code' }" data-testid="view-code" @click="view = 'code'">Code</button>
      </div>
      <span class="spacer" />
      <slot name="toolbar" />
      <button v-if="session.readOnly.value" class="primary" data-testid="take-over" title="This patch is open in another tab" @click="session.takeOver()">Read-only · Take over</button>
      <span class="status" :class="session.compileStatus.value" data-testid="compile-status" :title="session.compileMessage.value">{{ statusText }}</span>
      <div class="group">
        <select v-if="audioIn" :value="session.engine.testSignalKind" title="Test input for effect patches" @change="session.engine.setTestSignal(($event.target as HTMLSelectElement).value as never)"><option value="chords">Input: chords</option><option value="drums">Input: drums</option><option value="noise">Input: noise</option><option value="off">Input: off</option></select>
        <button v-if="session.engineState.value !== 'running'" class="primary" data-testid="enable-audio" @click="session.enableAudio()">Enable audio</button>
        <template v-else><span class="muted">Vol</span><input type="range" min="0" max="1" step="0.01" :value="session.engine.volume" @input="session.engine.setVolume(Number(($event.target as HTMLInputElement).value))" /></template>
        <button v-if="session.healthMuted.value" class="primary" @click="session.engine.panic(); session.healthMuted.value = false">Reset audio</button>
      </div>
    </div>
    <div class="main">
      <div class="sidebar"><slot name="sidebar-top" /><Inspector @edit-code="id => editing = id" /></div>
      <div class="workspace">
        <PatchView v-if="view === 'patch'" @edit-code="id => editing = id" />
        <PanelView v-else-if="view === 'panel'" />
        <CodeView v-else />
        <slot name="workspace" />
      </div>
    </div>
    <div class="bottom">
      <div v-if="session.engineState.value === 'error' || session.engineState.value === 'suspended'" class="issues" style="color: var(--warn)">{{ session.engineMessage.value }}</div>
      <KeyboardBar />
    </div>
    <CodeboxEditor v-if="editing && session.doc.value.nodes[editing]" :id="editing" @close="editing = null" />
    <div class="toasts"><div v-for="t in session.toasts.value" :key="t.id" class="toast" :class="t.kind" data-testid="toast">{{ t.text }}</div></div>
  </div>
</template>

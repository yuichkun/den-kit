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
import AiStatus from './AiStatus.vue';
import AiBar from './AiBar.vue';
import StartOverlay from './StartOverlay.vue';

const props = defineProps<{ session: KitSession }>();
const session = props.session;
provide(SESSION, session);
const view = ref<'patch' | 'panel' | 'code'>('patch');
const editing = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const menu = ref(false);
const name = ref(session.doc.value.name);
watch(() => session.doc.value.name, n => { name.value = n; });

const STARTER_TITLES: Record<StarterId, string> = { bass: 'Bass', percussion: 'Percussion', pad: 'Pad', chorus: 'Chorus (effect)', rhythmic: 'Rhythmic delay (effect)' };

// One small status in the corner: quiet when all is well, words only when it matters.
const status = computed(() => {
  const s = session.compileStatus.value, msg = session.compileMessage.value;
  if (s === 'compiling' || s === 'waiting') return { cls: 'busy', text: 'Compiling…', title: msg };
  if (s === 'error') return { cls: 'error', text: 'Error', title: msg };
  if (s === 'empty') return { cls: 'muted', text: 'Nothing to play', title: msg };
  if (s === 'ok') return { cls: 'ok', text: `✓ ${(session.lastCompileMs.value / 1000).toFixed(1)} s`, title: msg };
  return { cls: 'muted', text: '', title: '' };
});
// Problems that belong to the whole patch (not one module) and the safety mute.
const banner = computed(() => {
  const lines: string[] = [];
  if (session.healthMessage.value) lines.push(session.healthMessage.value);
  for (const i of session.issues.value) if (!i.node && i.severity === 'error') lines.push(i.message);
  if (session.compileStatus.value === 'error' && !session.compileIssues.value.some(i => i.node)) lines.push(session.compileMessage.value);
  return [...new Set(lines)].slice(0, 3);
});

// ⌘Z / ⇧⌘Z are the only undo controls, so they must work after touching a
// slider, checkbox or menu; only text fields keep their own native undo.
const TEXT_FIELD = 'textarea, [contenteditable], input:not([type]), input[type=text], input[type=number], input[type=search]';
function keys(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest(TEXT_FIELD)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); session.redo(); }
  else if (e.key === 'Escape') { editing.value = null; menu.value = false; }
}
function closeMenu(e: PointerEvent) { if (!(e.target as HTMLElement).closest('.patch-menu')) menu.value = false; }
onMounted(() => {
  window.addEventListener('keydown', keys);
  window.addEventListener('pointerdown', closeMenu, true);
  window.addEventListener('pagehide', () => session.saveNow());
});
onBeforeUnmount(() => { window.removeEventListener('keydown', keys); window.removeEventListener('pointerdown', closeMenu, true); });
function rename() { session.commit([{ op: 'setName', name: name.value }]); }
function loadStarter(id: StarterId) { session.loadStarter(id); name.value = session.doc.value.name; menu.value = false; }
function exportPatch() {
  menu.value = false;
  const blob = new Blob([session.exportText()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${session.doc.value.name.replace(/[^\w-]+/g, '_') || 'patch'}.denkit.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importPatch(e: Event) {
  menu.value = false;
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { session.toast('error', 'Import refused: file is larger than 5 MB.'); return; }
  if (session.importText(await file.text())) name.value = session.doc.value.name;
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <div class="kit-shell">
    <div class="toolbar">
      <div class="group"><span class="logo"><i v-for="k in 8" :key="k" /></span><b>den-kit</b><input v-model="name" class="name" type="text" data-testid="patch-name" @change="rename" /></div>
      <div class="patch-menu">
        <button data-testid="patch-menu" :class="{ open: menu }" @click="menu = !menu">Patch ▾</button>
        <div v-if="menu" class="menu" data-testid="patch-menu-list">
          <div class="menu-head">New from a starter</div>
          <button v-for="s in STARTERS" :key="s" :data-starter="s" @click="loadStarter(s)">{{ STARTER_TITLES[s] }}</button>
          <hr />
          <button @click="fileInput?.click()">Import…</button>
          <button @click="exportPatch">Export</button>
        </div>
        <input ref="fileInput" type="file" accept=".json,.denkit.json,application/json" hidden data-testid="import-file" @change="importPatch" />
      </div>
      <div class="tabs">
        <button :class="{ active: view === 'patch' }" data-testid="view-patch" @click="view = 'patch'">Patch</button>
        <button :class="{ active: view === 'panel' }" data-testid="view-panel" @click="view = 'panel'">Panel</button>
        <button :class="{ active: view === 'code' }" data-testid="view-code" @click="view = 'code'">Code</button>
      </div>
      <span class="spacer" />
      <slot name="toolbar" />
      <AiStatus v-if="session.bridge" :bridge="session.bridge" />
      <span class="status" :class="status.cls" data-testid="compile-status" :title="status.title">{{ status.text }}</span>
    </div>
    <div class="main">
      <div class="sidebar"><Inspector @edit-code="id => editing = id" /></div>
      <div class="workspace">
        <PatchView v-if="view === 'patch'" @edit-code="id => editing = id" />
        <PanelView v-else-if="view === 'panel'" />
        <CodeView v-else />
        <div v-if="banner.length" class="banner" :class="{ below: view === 'patch' }" data-testid="banner"><div v-for="(line, i) in banner" :key="i">{{ line }}</div></div>
        <AiBar v-if="session.fast && view !== 'code'" :fast="session.fast" />
        <slot name="workspace" />
      </div>
    </div>
    <div class="bottom"><KeyboardBar /></div>
    <CodeboxEditor v-if="editing && session.doc.value.nodes[editing]" :id="editing" @close="editing = null" />
    <div class="toasts"><div v-for="t in session.toasts.value" :key="t.id" class="toast" :class="t.kind" data-testid="toast">{{ t.text }}</div></div>
    <StartOverlay />
  </div>
</template>

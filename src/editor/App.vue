<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch, watchEffect } from 'vue';
import { SESSION } from './context.ts';
import { KitSession } from './session.ts';
import { MAX_FILE_BYTES } from '../core/persistence.ts';
import PatchView from './PatchView.vue';
import PluginView from './PluginView.vue';
import CodeView from './CodeView.vue';
import Inspector from './Inspector.vue';
import KeyboardBar from './KeyboardBar.vue';
import CodeboxEditor from './CodeboxEditor.vue';
import AiPanel from './AiPanel.vue';
import StartOverlay from './StartOverlay.vue';
import StartScreen from './StartScreen.vue';
import PluginInspector from './plugin/PluginInspector.vue';
import PartEditor from './plugin/PartEditor.vue';

const props = defineProps<{ session: KitSession; /** Nothing was saved yet: open on the start screen. */ firstRun?: boolean }>();
const session = props.session;
provide(SESSION, session);
const view = ref<'patch' | 'plugin' | 'code'>('patch');
const pluginEdit = ref(false);
watchEffect(() => { props.session.screenFocus.value = view.value === 'plugin' && pluginEdit.value; });
const editing = ref<string | null>(null);
const editingPart = ref<string | null>(null);
const pluginView = ref<InstanceType<typeof PluginView> | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const menu = ref(false);
const name = ref(session.doc.value.name);
watch(() => session.doc.value.name, n => { name.value = n; });
const starting = ref(!!props.firstRun);

// ---- the AI panel: a column on the right, never over the canvas ---------------------
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const aiOpen = ref(stored('den-kit:ai-open') !== '0');
const aiWidth = ref(Math.min(720, Math.max(320, Number(stored('den-kit:ai-width')) || 400)));
watch(aiOpen, open => store('den-kit:ai-open', open ? '1' : '0'));
const ai = ref<InstanceType<typeof AiPanel> | null>(null);
// On a narrow window the panel gives way: at most about a third of the width.
const windowWidth = ref(window.innerWidth);
const onResize = () => { windowWidth.value = window.innerWidth; };
const dockWidth = computed(() => Math.min(aiWidth.value, Math.max(300, Math.round(windowWidth.value * 0.36))));
function resizeAi(e: PointerEvent) {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => { aiWidth.value = Math.round(Math.min(720, Math.max(320, window.innerWidth - m.clientX))); };
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store('den-kit:ai-width', String(aiWidth.value)); };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}
/** Leaving the prompt (Esc): keys go to the patch or the plugin again. */
function backToCanvas() { (document.querySelector('[data-testid=patch-view], [data-testid=plugin-view]') as HTMLElement | null)?.focus(); }

// ---- full screen: only the plugin -------------------------------------------------------
const focusMode = ref(false);
let aiWasOpen = true;
async function setFocus(on: boolean) {
  if (on === focusMode.value) return;
  if (on) {
    aiWasOpen = aiOpen.value; aiOpen.value = false;
    view.value = 'plugin'; pluginEdit.value = false; focusMode.value = true;
    try { await document.documentElement.requestFullscreen?.(); } catch { /* the window still shows only the plugin */ }
  } else {
    focusMode.value = false; aiOpen.value = aiWasOpen;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
}
function fullscreenChange() { if (!document.fullscreenElement && focusMode.value) void setFocus(false); }

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
// Letter keys go by their physical key (e.code), so ⌥ and keyboard layouts do not matter.
const TEXT_FIELD = 'textarea, [contenteditable], input:not([type]), input[type=text], input[type=number], input[type=search]';
function keys(e: KeyboardEvent) {
  if (starting.value) return; // the start screen has the keys
  const mod = e.metaKey || e.ctrlKey;
  // In the AI prompt the view keys still work (no reaching for the mouse); in other text fields (code, names) they do not.
  const field = (e.target as HTMLElement).closest(TEXT_FIELD);
  // An inspector field that shows what the patch has (nothing typed since Enter) leaves the ⌘ keys (⌘Z, ⌥⌘E…) to the app, as in a design tool.
  const settled = field instanceof HTMLInputElement && field.dataset.committed !== undefined && field.value === field.dataset.committed;
  // Esc in an inspector field hands the keys back to the view (no reaching for the mouse).
  if (field instanceof HTMLInputElement && e.key === 'Escape' && field.closest('[data-testid=plugin-inspector], [data-testid=inspector]')) {
    e.preventDefault(); field.blur(); document.querySelector<HTMLElement>('[data-testid=plugin-view], .patch-view')?.focus(); return;
  }
  if (field && !field.matches('[data-testid=ai-input]') && !(settled && mod)) return;
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); aiOpen.value = !aiOpen.value; return; }
  if (mod && e.altKey && e.code === 'KeyE') { e.preventDefault(); view.value = view.value === 'plugin' ? 'patch' : 'plugin'; return; }
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); if (view.value !== 'plugin') { view.value = 'plugin'; pluginEdit.value = true; } else pluginEdit.value = !pluginEdit.value; return; }
  if (mod && e.shiftKey && !e.altKey && e.code === 'KeyF') { e.preventDefault(); void setFocus(!focusMode.value); return; }
  if (mod && e.altKey && e.code === 'KeyN') { e.preventDefault(); openNew(); return; }
  if (field && !settled) return; // the prompt keeps its own undo
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); }
  else if (mod && e.code === 'KeyY') { e.preventDefault(); session.redo(); }
  else if (e.key === 'Escape' && !e.defaultPrevented) { editing.value = null; editingPart.value = null; menu.value = false; if (focusMode.value) void setFocus(false); }
}
function closeMenu(e: PointerEvent) { if (!(e.target as HTMLElement).closest('.patch-menu')) menu.value = false; }
onMounted(() => {
  window.addEventListener('keydown', keys);
  window.addEventListener('pointerdown', closeMenu, true);
  window.addEventListener('pagehide', () => session.saveNow());
  document.addEventListener('fullscreenchange', fullscreenChange);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', keys); window.removeEventListener('pointerdown', closeMenu, true); document.removeEventListener('fullscreenchange', fullscreenChange); window.removeEventListener('resize', onResize); });
function rename() { session.commit([{ op: 'setName', name: name.value }]); }
function openNew() { menu.value = false; starting.value = true; }
function started(asked: boolean) { starting.value = false; view.value = 'patch'; if (asked) aiOpen.value = true; }
async function exportPatch() {
  menu.value = false;
  const blob = new Blob([await session.exportWithAssets()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${session.doc.value.name.replace(/[^\w-]+/g, '_') || 'patch'}.denkit.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importPatch(e: Event) {
  menu.value = false;
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > MAX_FILE_BYTES) { session.toast('error', `Import refused: file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`); return; }
  if (session.importText(await file.text())) name.value = session.doc.value.name;
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <div class="kit-shell" :class="{ focus: focusMode }" :style="{ '--ai-w': aiOpen ? `${dockWidth}px` : '0px' }">
    <div v-show="!focusMode" class="toolbar">
      <div class="group"><span class="logo"><i v-for="k in 8" :key="k" /></span><b>den-kit</b><input v-model="name" class="name" type="text" data-testid="patch-name" @change="rename" /></div>
      <div class="patch-menu">
        <button data-testid="patch-menu" :class="{ open: menu }" @click="menu = !menu">Patch ▾</button>
        <div v-if="menu" class="menu" data-testid="patch-menu-list">
          <button data-testid="menu-new" @click="openNew">New… <span class="kbd-hint">⌥⌘N</span></button>
          <hr />
          <button @click="fileInput?.click()">Import…</button>
          <button @click="exportPatch">Export</button>
        </div>
        <input ref="fileInput" type="file" accept=".json,.denkit.json,application/json" hidden data-testid="import-file" @change="importPatch" />
      </div>
      <div class="tabs">
        <button :class="{ active: view === 'patch' }" data-testid="view-patch" title="Patch (⌥⌘E switches)" @click="view = 'patch'">Patch</button>
        <button :class="{ active: view === 'plugin' }" data-testid="view-plugin" title="Plugin (⌥⌘E switches)" @click="view = 'plugin'">Plugin</button>
        <button :class="{ active: view === 'code' }" data-testid="view-code" @click="view = 'code'">Code</button>
      </div>
      <span class="spacer" />
      <slot name="toolbar" />
      <span class="status" :class="status.cls" data-testid="compile-status" :title="status.title">{{ status.text }}</span>
      <button v-if="!aiOpen && session.fast" class="ai-toggle" data-testid="ai-open" title="Show the AI panel (⌘J)" @click="aiOpen = true">✦ AI <span class="kbd-hint">⌘J</span></button>
    </div>
    <div class="body">
      <div class="left">
        <div class="main">
          <div v-show="!focusMode" class="sidebar">
            <PluginInspector v-if="view === 'plugin' && pluginEdit" @edit-part="id => editingPart = id" @action="name => pluginView?.action(name)" />
            <Inspector v-else @edit-code="id => editing = id" />
          </div>
          <div class="workspace" data-testid="workspace">
            <PatchView v-if="view === 'patch'" @edit-code="id => editing = id" />
            <PluginView v-else-if="view === 'plugin'" ref="pluginView" v-model:edit="pluginEdit" :focus="focusMode" @fullscreen="setFocus(!focusMode)" @edit-part="id => editingPart = id" />
            <CodeView v-else />
            <div v-if="banner.length" class="banner" :class="{ below: view === 'patch' }" data-testid="banner"><div v-for="(line, i) in banner" :key="i">{{ line }}</div></div>
            <button v-if="focusMode" class="leave-focus" data-testid="leave-focus" @click="setFocus(false)">Leave full screen <span class="kbd-hint">Esc</span></button>
            <slot name="workspace" />
          </div>
        </div>
        <div v-show="!focusMode" class="bottom"><KeyboardBar /></div>
      </div>
      <div v-if="session.fast" v-show="aiOpen" class="ai-dock" data-testid="ai-dock" :style="{ width: `${dockWidth}px` }">
        <div class="resizer" title="Drag to resize" @pointerdown="resizeAi" />
        <AiPanel ref="ai" :fast="session.fast" :llm="session.llm" :view="view" @request="aiOpen = true" @leave="backToCanvas" @close="aiOpen = false" @show-plugin="view = 'plugin'" />
      </div>
    </div>
    <CodeboxEditor v-if="editing && session.doc.value.nodes[editing]" :id="editing" @close="editing = null" />
    <PartEditor v-if="editingPart && session.doc.value.ui.elements[editingPart]" :id="editingPart" @close="editingPart = null" />
    <div class="toasts"><div v-for="t in session.toasts.value" :key="t.id" class="toast" :class="t.kind" data-testid="toast">{{ t.text }}</div></div>
    <StartOverlay v-if="!starting" />
    <StartScreen v-if="starting" @close="started" />
  </div>
</template>

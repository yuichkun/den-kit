<script setup lang="ts">
// The code of a canvas, with a live preview: the draft runs as you type
// (after a pause), so mistakes show at once; Apply (⌘Enter) puts it on the plugin.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CanvasElement } from '../../core/ui.ts';
import { pluginSpec } from '../../plugin/build.ts';
import { CANVAS_TEMPLATE } from '../../plugin/inserts.ts';
import PluginWindow from '../../plugin/PluginWindow.vue';
import type { PluginSpec } from '../../plugin/spec.ts';
import { useSession } from '../context.ts';
import { controlWriter } from '../play.ts';
import CodeArea from '../CodeArea.vue';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const session = useSession();
const element = computed(() => session.doc.value.ui.elements[props.id] as CanvasElement | undefined);
const code = ref(element.value?.code ?? CANVAS_TEMPLATE);
const propsText = ref(JSON.stringify(element.value?.props ?? {}, null, 1));
const preview = ref(code.value);
const status = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(code, c => { if (timer) clearTimeout(timer); timer = setTimeout(() => { preview.value = c; }, 600); });
const parsedProps = computed(() => { try { const p = JSON.parse(propsText.value || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } });
const dirty = computed(() => code.value !== element.value?.code || JSON.stringify(parsedProps.value) !== JSON.stringify(element.value?.props));
/** The plugin as it is, with the draft in place of this canvas (and nothing else on top of it). */
const spec = computed<PluginSpec | null>(() => {
  const el = element.value; if (!el) return null;
  const base = pluginSpec(session.doc.value, session.catalog, session.generated.value);
  const draft: CanvasElement = { ...el, code: preview.value, props: parsedProps.value ?? el.props, rect: { x: 0, y: 0, w: el.rect.w, h: el.rect.h } };
  return { ...base, width: el.rect.w, height: el.rect.h, background: [], css: '', items: [{ kind: 'element', id: el.id, element: draft }] };
});
function apply() {
  if (!parsedProps.value) { session.toast('warn', 'Settings must be a JSON object, e.g. {"speed": 2}.'); return; }
  const r = session.commit([{ op: 'updateElement', id: props.id, set: { code: code.value, props: parsedProps.value } }], { label: `Edit ${props.id} code` });
  if (!r.ok) session.toast('warn', r.error.message);
}
function key(e: KeyboardEvent) {
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target as HTMLTextAreaElement; const s = t.selectionStart; code.value = code.value.slice(0, s) + '  ' + code.value.slice(t.selectionEnd); requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2)); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); apply(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close'); }
}
// The preview plays: a canvas that handles the mouse moves the real controls (one ⌘Z each press).
const onChange = controlWriter(session);
const analyser = (probe: number) => probe >= 0 ? session.engine.probeAnalysers[probe] ?? null : session.engine.outAnalyser;
// Opened from the keyboard (Enter on the canvas): the code takes the keys at once, and gives them back to the plugin view on close.
const source = ref<InstanceType<typeof CodeArea> | null>(null);
onMounted(() => void nextTick(() => source.value?.focus()));
onBeforeUnmount(() => document.querySelector<HTMLElement>('[data-testid=plugin-view]')?.focus());
</script>

<template>
  <div class="overlay" @pointerdown.self="emit('close')">
    <div class="modal" data-testid="canvas-editor">
      <header><b>Canvas {{ id }}</b><span class="muted">JavaScript, drawn on a canvas each frame · ⌘/Ctrl+Enter applies · Esc closes</span><span style="flex:1" /><button @click="code = CANVAS_TEMPLATE">Template</button><button class="primary" :disabled="!dirty" data-testid="canvas-apply" @click="apply">Apply</button><button @click="emit('close')">Close</button></header>
      <div class="body">
        <CodeArea ref="source" v-model="code" language="javascript" data-testid="canvas-source" @keydown="key" />
        <aside>
          <h4>Preview</h4>
          <div class="preview"><PluginWindow v-if="spec" :spec="spec" :analyser="analyser" :asset-urls="session.assetUrls.value" @change="onChange" /></div>
          <div v-if="status" class="issue error" data-testid="canvas-status">{{ status }}</div>
          <h4>Settings (f.props)</h4>
          <CodeArea v-model="propsText" language="json" class="props" :class="{ bad: !parsedProps }" rows="4" />
          <h4>What f has</h4>
          <div class="help">f.w, f.h · f.t, f.dt · f.level, f.peak · f.wave, f.spectrum · f.value(id), f.norm(id), f.xy(id), f.on(id), f.range(id) · f.color('accent') · f.props · f.state<br>With pointer(e, f): e.type (down, move, up, wheel, double, leave), e.x, e.y, e.dx, e.dy · f.pointer · f.set(id, value), f.setNorm(id, 0..1) · f.cursor('grab')</div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.body { display: grid; grid-template-columns: 1fr 300px; min-height: 0; }
aside { border-left: 1px solid var(--line); padding: 8px; overflow: auto; font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; }
h4 { margin: 8px 0 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.preview { position: relative; height: 180px; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
.props { border: 1px solid #333; border-radius: 4px; --code-pad: 6px 8px; }
.props.bad { border-color: var(--error); }
.help { color: var(--muted); line-height: 1.5; }
</style>

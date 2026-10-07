<script setup lang="ts">
// Everything on the plugin, front first: click to select (Shift adds), hide and lock decorations.
import { computed } from 'vue';
import { CONTROL_OF } from '../../core/skins.ts';
import { groupOf, stackOrder } from '../../core/ui.ts';
import { useSession } from '../context.ts';

const session = useSession();
const doc = computed(() => session.doc.value);
const rows = computed(() => {
  const placed = Object.values(doc.value.nodes).filter(n => n.panel && CONTROL_OF[n.type]).map(n => n.id);
  return stackOrder(doc.value.ui, placed).reverse().map(id => {
    const el = doc.value.ui.elements[id], node = doc.value.nodes[id];
    const kind = el ? (el.kind === 'shape' ? el.shape : el.kind) : CONTROL_OF[node!.type]!;
    const name = el ? el.name ?? (el.kind === 'text' ? el.text.slice(0, 24) || id : id) : node!.label ?? id;
    return { id, kind, name, el, group: groupOf(doc.value.ui, id) };
  });
});
const selected = computed(() => new Set(session.selection.value));
function pick(id: string, e: MouseEvent) {
  if (e.shiftKey) session.select(selected.value.has(id) ? session.selection.value.filter(x => x !== id) : [...session.selection.value, id]);
  else session.select([id]);
}
const toggle = (id: string, field: 'hidden' | 'locked', value: boolean) => session.commit([{ op: 'updateElement', id, set: { [field]: value || null } }], { label: value ? (field === 'hidden' ? 'Hide' : 'Lock') : (field === 'hidden' ? 'Show' : 'Unlock') });
const ICON: Record<string, string> = { text: 'T', rect: '▭', ellipse: '◯', line: '—', image: '▣', svg: '✦', led: '●', canvas: '{}', knob: '◔', slider: '▮', toggle: '⏻', button: '◉', xy: '✛', keyboard: '▤', scope: '∿', meter: '▁' };
</script>

<template>
  <div class="layers" data-testid="layers">
    <div v-for="r in rows" :key="r.id" class="layer" :class="{ selected: selected.has(r.id), hidden: r.el?.hidden }" :data-layer="r.id" @click="pick(r.id, $event)">
      <span class="icon">{{ ICON[r.kind] ?? '·' }}</span>
      <span class="name">{{ r.name }}</span>
      <span v-if="r.group" class="group" :title="`In group ${r.group}`">{{ r.group }}</span>
      <template v-if="r.el">
        <button type="button" class="flag" :class="{ on: r.el.hidden }" :title="r.el.hidden ? 'Show' : 'Hide'" @click.stop="toggle(r.id, 'hidden', !r.el.hidden)">{{ r.el.hidden ? '⊘' : '◎' }}</button>
        <button type="button" class="flag" :class="{ on: r.el.locked }" :title="r.el.locked ? 'Unlock' : 'Lock (clicks pass through)'" @click.stop="toggle(r.id, 'locked', !r.el.locked)">{{ r.el.locked ? '🔒' : '·' }}</button>
      </template>
    </div>
    <div v-if="!rows.length" class="muted">Nothing on the plugin yet.</div>
  </div>
</template>

<style scoped>
.layer { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.layer:hover { background: #2c2c2c; }
.layer.selected { background: #3a2a14; outline: 1px solid var(--accent); }
.layer.hidden .name { opacity: .45; text-decoration: line-through; }
.icon { width: 18px; text-align: center; color: var(--muted); }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group { font-size: 11px; color: var(--muted); border: 1px solid #444; border-radius: 3px; padding: 0 4px; }
.flag { padding: 0 4px; background: none; box-shadow: none; color: var(--muted); font-size: 12px; }
.flag.on { color: var(--accent); }
</style>

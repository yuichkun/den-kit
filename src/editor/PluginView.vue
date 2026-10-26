<script setup lang="ts">
// The plugin view: the plugin window (Max's presentation mode), drawn by
// PluginWindow. It fills the area it gets (or the whole screen) and the plugin
// scales to it, the way a plugin fits any window size. Play operates the
// controls; Edit (⌘E) lays out, styles and adds things, with design-tool keys:
// click / Shift-click / drag a box to select (a group selects whole; ⌥-click
// or double-click reaches inside), drag to move, handles to resize (Shift keeps
// the shape), arrows nudge (Shift: 10), ⌥+arrows resize, Tab steps through,
// Shift+Space adds, Enter edits text, ⌘G / ⇧⌘G group, ⌘] ⌘[ ⌥⌘] ⌥⌘[ stack,
// ⌥A ⌥D ⌥W ⌥S ⌥H ⌥V align, ⌃⌥H ⌃⌥V spread, ⇧⌘L lock, ⇧⌘H hide, Delete removes,
// ⌘C ⌘V ⌘D copy. Files dropped on it become pictures. Every change is a commit
// like in the patch, so ⌘Z undoes it.
import { useTouches } from './touches.ts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Intent } from '../work/ops.ts';
import { THEMES } from '../work/schema.ts';
import { CONTROL_OF } from '../work/skins.ts';
import { stackOrder, withGroups, assetsOf } from '../work/ui.ts';
import { pluginSpec } from '../screen/build.ts';
import {
  align,
  distribute,
  grow,
  intersects,
  nudge,
  resizeBy,
  type Align,
  type Handle,
} from '../screen/edit.ts';
import { insertIntents } from '../screen/inserts.ts';
import type { PluginIssue } from '../screen/checks.ts';
import type { PluginItem, PluginSpec, Rect } from '../screen/spec.ts';
import PluginWindow from '../screen/PluginWindow.vue';
import InsertMenu from './plugin/InsertMenu.vue';
import { starterPart, withTemplate } from '../workspace/template.ts';
import { partPath } from '../work/files.ts';
import InputSelect from './InputSelect.vue';
import { useSession } from './context.ts';
import { copySelection, duplicate, paste, typing } from './clipboard.ts';
import { claimEnter } from './keys.ts';
import { controlWriter } from './play.ts';
import InkLayer from './InkLayer.vue';
import InkToolbar from './InkToolbar.vue';
import { underlayPicture } from './sketch-picture.ts';

const props = defineProps<{ edit: boolean; focus?: boolean }>();
const emit = defineEmits<{
  (e: 'update:edit', value: boolean): void;
  (e: 'fullscreen'): void;
  (e: 'edit-canvas', id: string): void;
}>();
defineExpose({ action });
const session = useSession();
/** What the AIs of a request with members just changed (outlined in their colour). */
const touches = useTouches(session);
const touchBoxes = computed(() =>
  [...touches.value].flatMap(([id, mark]) => {
    const r = doc.value.ui.elements[id]?.rect ?? doc.value.nodes[id]?.panel;
    return r ? [{ id, ...mark, rect: r }] : [];
  }),
);
const doc = computed(() => session.doc.value);
const win = ref<InstanceType<typeof PluginWindow> | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const drag = ref<{ rects: Record<string, Rect> } | null>(null);
const marquee = ref<Rect | null>(null);
const menu = ref<{ left: number; top: number; at: { x: number; y: number } } | null>(null);
const editingText = ref<string | null>(null);
const textDraft = ref('');
const W = computed(() => doc.value.panel.width);
const H = computed(() => doc.value.panel.height);
const frame = computed<Rect>(() => ({ x: 0, y: 0, w: W.value, h: H.value }));
const placed = computed(() =>
  Object.values(doc.value.nodes)
    .filter(n => n.panel && CONTROL_OF[n.type] && session.catalog.find(n.type)?.kind === 'widget')
    .map(n => n.id),
);
const hasInput = computed(() => Object.values(doc.value.nodes).some(n => n.type === 'kit.audioIn'));
const hiddenWidgets = computed(() =>
  Object.values(doc.value.nodes).filter(
    n => !n.panel && session.catalog.find(n.type)?.kind === 'widget',
  ),
);
const stack = computed(() => stackOrder(doc.value.ui, placed.value));
const rectOf = (id: string): Rect | undefined =>
  drag.value?.rects[id] ?? doc.value.ui.elements[id]?.rect ?? doc.value.nodes[id]?.panel;
const selectable = (id: string) => {
  const el = doc.value.ui.elements[id];
  return !el || (!el.locked && !el.hidden);
};
const selected = computed(
  () => new Set(session.selection.value.filter(id => stack.value.includes(id))),
);
// What the plugin window shows, built from the patch (a drag in progress moves things live).
const spec = computed<PluginSpec>(() => {
  const base = pluginSpec(doc.value, session.catalog, session.generated.value);
  const rects = drag.value?.rects;
  if (!rects) return base;
  const move = (item: PluginItem): PluginItem =>
    !rects[item.id]
      ? item
      : item.kind === 'widget'
        ? { ...item, widget: { ...item.widget, rect: rects[item.id] } }
        : { ...item, element: { ...item.element, rect: rects[item.id]! } };
  return { ...base, items: base.items.map(move) };
});
const analyser = (probe: number) =>
  probe >= 0 ? (session.engine.probeAnalysers[probe] ?? null) : session.engine.outAnalyser;
const scale = () => win.value?.scale ?? 1;
/** Design pixels of a point on the screen. */
function designPoint(clientX: number, clientY: number) {
  const panel = stageEl.value?.querySelector('[data-testid=panel]')?.getBoundingClientRect();
  if (!panel) return { x: W.value / 2, y: H.value / 2 };
  return { x: (clientX - panel.left) / scale(), y: (clientY - panel.top) / scale() };
}

function commit(intents: Intent[], label: string, gesture?: string) {
  if (!intents.length) return null;
  const r = session.commit(intents, { label, gesture });
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r.ok ? r : null;
}

// ---- playing ------------------------------------------------------------------------
const onChange = controlWriter(session);

// ---- checking (the same look-over the AI gets: overlaps, edges, fit, contrast, labels, wiring) ----
const checks = ref<{ running: boolean; issues: PluginIssue[]; stale: boolean } | null>(null);
async function runCheck() {
  checks.value = { running: true, issues: checks.value?.issues ?? [], stale: false };
  try {
    const seen = await session.look();
    if (checks.value) checks.value = { running: false, issues: seen.issues, stale: false };
  } catch (error) {
    session.toast(
      'warn',
      `Could not check the plugin: ${error instanceof Error ? error.message : String(error)}`,
    );
    checks.value = null;
  }
}
function pickIssue(i: PluginIssue) {
  const ids = i.ids.filter(id => stack.value.includes(id) && selectable(id));
  if (ids.length) session.select(ids);
}
watch(
  () => session.doc.value,
  () => {
    if (checks.value && !checks.value.running) checks.value = { ...checks.value, stale: true };
  },
);
function onNote(note: number, on: boolean, velocity: number) {
  if (on) session.noteOn(note, velocity);
  else session.noteOff(note);
}

// ---- selecting -------------------------------------------------------------------------
function pick(id: string, e: PointerEvent | MouseEvent) {
  const inside = e.altKey || e.metaKey || e.ctrlKey;
  const ids = inside ? [id] : withGroups(doc.value.ui, [id]).filter(selectable);
  if (e.shiftKey) {
    const all = ids.every(x => selected.value.has(x));
    session.select(
      all
        ? [...selected.value].filter(x => !ids.includes(x))
        : [...new Set([...selected.value, ...ids])],
    );
  } else if (!ids.every(x => selected.value.has(x)) || inside) session.select(ids);
}
function step(d: number) {
  const list = stack.value.filter(selectable);
  if (!list.length) return;
  const last = [...selected.value].at(-1);
  const i = last ? list.indexOf(last) : -1;
  const next = list[(i + d + list.length) % list.length]!;
  session.select(withGroups(doc.value.ui, [next]).filter(selectable));
}

// ---- moving and resizing -------------------------------------------------------------
function startMove(id: string, e: PointerEvent, handle?: Handle) {
  if (!props.edit || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  menu.value = null;
  if (!handle) pick(id, e);
  const ids = handle ? [id] : [...selected.value];
  if (!ids.length || (!handle && !selected.value.has(id))) return;
  const start = { x: e.clientX, y: e.clientY };
  const r0 = Object.fromEntries(ids.map(x => [x, { ...rectOf(x)! }]));
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  let moved = false;
  const move = (m: PointerEvent) => {
    let dx = (m.clientX - start.x) / scale(),
      dy = (m.clientY - start.y) / scale();
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    if (!handle && m.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    dx = Math.round(dx);
    dy = Math.round(dy);
    drag.value = {
      rects: handle
        ? { [id]: resizeBy(r0[id]!, handle, dx, dy, m.shiftKey) }
        : Object.fromEntries(ids.map(x => [x, { ...r0[x]!, x: r0[x]!.x + dx, y: r0[x]!.y + dy }])),
    };
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    const rects = drag.value?.rects;
    drag.value = null;
    if (moved && rects)
      commit(
        Object.entries(rects).map(([x, rect]) => ({ op: 'setRect' as const, id: x, rect })),
        handle ? 'Resize' : 'Move',
      );
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
/** A press on the background: drag a box to select what it touches (Shift adds). */
function backgroundDown(e: PointerEvent) {
  if (
    !props.edit ||
    e.button !== 0 ||
    (e.target as HTMLElement).closest('[data-item], .insert-menu, .bar')
  )
    return;
  menu.value = null;
  const p0 = designPoint(e.clientX, e.clientY);
  const before = e.shiftKey ? [...selected.value] : [];
  if (!e.shiftKey) session.select([]);
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    const p = designPoint(m.clientX, m.clientY);
    marquee.value = {
      x: Math.min(p0.x, p.x),
      y: Math.min(p0.y, p.y),
      w: Math.abs(p.x - p0.x),
      h: Math.abs(p.y - p0.y),
    };
    const hit = stack.value.filter(id => selectable(id) && intersects(marquee.value!, rectOf(id)!));
    session.select([...new Set([...before, ...withGroups(doc.value.ui, hit).filter(selectable)])]);
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    marquee.value = null;
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}
function doubleClick(id: string, e: MouseEvent) {
  if (!props.edit) return;
  e.stopPropagation();
  session.select([id]);
  const el = doc.value.ui.elements[id];
  if (el?.kind === 'text') startText(id);
  else if (el?.kind === 'canvas') emit('edit-canvas', id);
}
function backgroundDouble(e: MouseEvent) {
  if (!props.edit || (e.target as HTMLElement).closest('[data-item], .insert-menu, .bar')) return;
  openMenu(designPoint(e.clientX, e.clientY), e.clientX, e.clientY);
}

// ---- text -------------------------------------------------------------------------------
function startText(id: string) {
  const el = doc.value.ui.elements[id];
  if (el?.kind !== 'text') return;
  editingText.value = id;
  textDraft.value = el.text;
  void nextTick(() => {
    const ta = stageEl.value?.querySelector<HTMLTextAreaElement>('.text-edit');
    ta?.focus();
    ta?.select();
  });
}
function endText(save: boolean) {
  const id = editingText.value;
  if (!id) return;
  editingText.value = null;
  if (save && doc.value.ui.elements[id]?.kind === 'text')
    commit([{ op: 'updateElement', id, set: { text: textDraft.value } }], 'Text');
  void nextTick(() => stageEl.value?.closest<HTMLElement>('[data-testid=plugin-view]')?.focus());
}
function textKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    endText(false);
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    endText(true);
  }
}

// ---- adding -----------------------------------------------------------------------------
function openMenu(at: { x: number; y: number }, clientX?: number, clientY?: number) {
  const stage = stageEl.value?.getBoundingClientRect();
  if (!stage) return;
  const left = Math.min(
    stage.width - 370,
    Math.max(8, (clientX ?? stage.left + stage.width / 2 - 180) - stage.left),
  );
  const top = Math.min(
    stage.height - 300,
    Math.max(8, (clientY ?? stage.top + stage.height / 3) - stage.top),
  );
  menu.value = { left, top, at };
}
function insert(key: string, asset?: string) {
  const at = menu.value?.at ?? { x: W.value / 2, y: H.value / 2 };
  menu.value = null;
  const meta = asset ? assetsOf(doc.value.files)[asset] : undefined;
  const bind = [...selected.value].find(id => {
    const t = doc.value.nodes[id]?.type;
    return t === 'ui.knob' || t === 'ui.slider' || t === 'ui.toggle';
  });
  const r = commit(
    insertIntents(key, at, doc.value, {
      asset: meta,
      bind,
      codeFiles: name => withTemplate(doc.value.files, { [partPath(name)]: starterPart(name) }),
    }),
    `Add ${key}`,
  );
  if (r) session.select(r.created);
  // A new text opens for typing (its field takes the focus); anything else hands the keys back to the plugin view.
  if (r && key === 'text') startText(r.created[0]!);
  else
    void nextTick(() => stageEl.value?.closest<HTMLElement>('[data-testid=plugin-view]')?.focus());
}
function place(id: string) {
  const n = doc.value.nodes[id]!;
  const size =
    n.type === 'ui.keyboard'
      ? { w: 360, h: 90 }
      : n.type === 'ui.xy'
        ? { w: 160, h: 160 }
        : { w: 84, h: 96 };
  const count = placed.value.length;
  commit(
    [
      {
        op: 'setPanel',
        node: id,
        panel: { x: 16 + (count % 6) * 96, y: 16 + Math.floor(count / 6) * 110, ...size },
      },
    ],
    `Put ${n.label ?? id} on the plugin`,
  );
}
async function dropFiles(e: DragEvent) {
  if (!props.edit || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  const at = designPoint(e.clientX, e.clientY);
  const created: string[] = [];
  // The dropped files, taken while the drop lasts (the list empties after it).
  for (const file of Array.from(e.dataTransfer.files)) {
    const meta = await session.addAssetFile(file);
    if (!meta) continue;
    if (!meta.mime.startsWith('image/')) {
      session.toast('info', `Font "${meta.name}" added: pick it in a text's Font.`);
      continue;
    }
    const r = commit(
      insertIntents(
        'picture',
        { x: at.x + created.length * 16, y: at.y + created.length * 16 },
        doc.value,
        { asset: meta },
      ),
      `Add ${meta.name}`,
    );
    if (r) created.push(...r.created);
  }
  if (created.length) session.select(created);
}
function dragOver(e: DragEvent) {
  if (props.edit && e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

// ---- arranging (keys, the inspector's buttons) -----------------------------------------
/** The selection as units that move together (groups stay whole). */
function units(ids: readonly string[]) {
  const out: string[][] = [],
    seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const g = Object.values(doc.value.ui.groups).find(m => m.includes(id));
    const unit = g ? g.filter(m => ids.includes(m)) : [id];
    unit.forEach(m => seen.add(m));
    out.push(unit);
  }
  return out;
}
const rectsOf = (ids: readonly string[]) =>
  Object.fromEntries(ids.map(id => [id, rectOf(id)!]).filter(([, r]) => r));
const setRects = (rects: Record<string, Rect>, label: string, gesture?: string) =>
  commit(
    Object.entries(rects)
      .filter(([id, r]) => JSON.stringify(r) !== JSON.stringify(rectOf(id)))
      .map(([id, rect]) => ({ op: 'setRect' as const, id, rect })),
    label,
    gesture,
  );
let keyGesture = { kind: '', id: '', at: 0 };
const repeatGesture = (kind: string) => {
  const now = performance.now();
  if (keyGesture.kind !== kind || now - keyGesture.at > 1500)
    keyGesture = { kind, id: `${kind}-${Date.now()}`, at: now };
  keyGesture.at = now;
  return keyGesture.id;
};
function action(name: string) {
  const ids = [...selected.value];
  if (name.startsWith('align-')) {
    if (ids.length)
      setRects(align(rectsOf(ids), name.slice(6) as Align, frame.value, units(ids)), 'Align');
    return;
  }
  if (name === 'distribute-h' || name === 'distribute-v') {
    setRects(distribute(rectsOf(ids), name.endsWith('h') ? 'h' : 'v', units(ids)), 'Spread evenly');
    return;
  }
  if (name === 'group' && ids.length > 1) {
    const r = commit([{ op: 'group', ids }], 'Group');
    if (r) session.select(ids);
    return;
  }
  if (name === 'ungroup') {
    const groups = Object.entries(doc.value.ui.groups)
      .filter(([, m]) => m.some(id => ids.includes(id)))
      .map(([g]) => g);
    commit(
      groups.map(id => ({ op: 'ungroup' as const, id })),
      'Ungroup',
    );
    return;
  }
  if (['front', 'back', 'forward', 'backward'].includes(name) && ids.length) {
    commit([{ op: 'arrange', ids, to: name as 'front' }], 'Arrange');
    return;
  }
}
function toggleFlag(field: 'locked' | 'hidden') {
  const els = [...selected.value].map(id => doc.value.ui.elements[id]).filter(Boolean);
  if (!els.length) return;
  const on = !els.every(el => el![field]);
  commit(
    els.map(el => ({ op: 'updateElement' as const, id: el!.id, set: { [field]: on || null } })),
    field === 'locked' ? (on ? 'Lock' : 'Unlock') : on ? 'Hide' : 'Show',
  );
  if (on) session.select([]);
}
function removeSelection() {
  const ids = [...selected.value];
  if (!ids.length) return;
  commit(
    ids.map(id =>
      doc.value.ui.elements[id]
        ? { op: 'removeElement' as const, id }
        : { op: 'setPanel' as const, node: id, panel: null },
    ),
    'Remove from the plugin',
  );
  session.select([]);
}
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const BRACKET: Record<string, '[' | ']'> = {
  '[': '[',
  ']': ']',
  '“': '[',
  '‘': ']',
  '「': '[',
  '」': ']',
  BracketLeft: '[',
  BracketRight: ']',
};
const ALIGN_KEYS: Record<string, Align> = {
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'top',
  KeyS: 'bottom',
  KeyH: 'hcenter',
  KeyV: 'vcenter',
};
function onKey(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  // ⌥⌘K looks the plugin over from anywhere while editing, the AI prompt included (no reaching for the mouse).
  if (props.edit && mod && e.altKey && e.code === 'KeyK' && !e.defaultPrevented) {
    e.preventDefault();
    void runCheck();
    return;
  }
  if (e.defaultPrevented || typing(e) || editingText.value) return;
  if (!props.edit) {
    if (mod && e.code === 'KeyA') e.preventDefault();
    return;
  } // playing: nothing to select (and no page-wide text selection)
  if (menu.value) return; // the menu has the keys
  const bracket = BRACKET[e.key] ?? (mod ? BRACKET[e.code] : undefined);
  if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyA') {
    e.preventDefault();
    session.select(stack.value.filter(selectable));
  } else if (e.key === 'Tab') {
    e.preventDefault();
    step(e.shiftKey ? -1 : 1);
  } else if (e.key === ' ' && e.shiftKey) {
    e.preventDefault();
    openMenu({ x: W.value / 2, y: H.value / 2 });
  } else if (ARROWS[e.key] && !mod && selected.value.size) {
    e.preventDefault();
    const [x, y] = ARROWS[e.key]!;
    const s = e.shiftKey ? 10 : 1;
    const rects = rectsOf([...selected.value]);
    setRects(
      e.altKey ? grow(rects, x * s, y * s) : nudge(rects, x * s, y * s, frame.value),
      e.altKey ? 'Resize' : 'Nudge',
      repeatGesture(e.altKey ? 'grow' : 'nudge'),
    );
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
    e.preventDefault();
    removeSelection();
  } else if (e.key === 'Escape') {
    if (checks.value) checks.value = null;
    else session.select([]);
  } else if (mod && e.code === 'KeyC') copySelection(session);
  else if (mod && e.code === 'KeyV') {
    e.preventDefault();
    paste(session);
  } else if (mod && e.code === 'KeyD') {
    e.preventDefault();
    duplicate(session);
  } else if (mod && e.code === 'KeyG') {
    e.preventDefault();
    action(e.shiftKey ? 'ungroup' : 'group');
  } else if (mod && e.shiftKey && e.code === 'KeyL') {
    e.preventDefault();
    toggleFlag('locked');
  } else if (mod && e.shiftKey && e.code === 'KeyH') {
    e.preventDefault();
    toggleFlag('hidden');
  } else if (mod && bracket) {
    e.preventDefault();
    action(bracket === ']' ? (e.altKey ? 'front' : 'forward') : e.altKey ? 'back' : 'backward');
  } else if (e.altKey && e.ctrlKey && !e.metaKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
    e.preventDefault();
    action(e.code === 'KeyH' ? 'distribute-h' : 'distribute-v');
  } else if (e.altKey && !mod && ALIGN_KEYS[e.code]) {
    e.preventDefault();
    action(`align-${ALIGN_KEYS[e.code]}`);
  }
}

/** Enter on one selected text or canvas opens it (the text for typing, the canvas's code). */
function onEnter(e: KeyboardEvent): boolean {
  if (
    e.key !== 'Enter' ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    e.isComposing ||
    e.defaultPrevented ||
    !props.edit ||
    menu.value ||
    editingText.value ||
    typing(e) ||
    selected.value.size !== 1
  )
    return false;
  const id = [...selected.value][0]!,
    el = doc.value.ui.elements[id];
  if (el?.kind === 'text') {
    e.preventDefault();
    startText(id);
    return true;
  }
  if (el?.kind === 'canvas') {
    e.preventDefault();
    emit('edit-canvas', id);
    return true;
  }
  return false;
}
// The AI panel offers Enter here before jumping to its prompt; without the panel, the window listener takes it.
const releaseEnter = claimEnter(onEnter);
/** Drawing on the plugin: the pen is in hand while the person looks at the plugin. */
const inking = computed(() => !!session.inking.value && session.seeing.value.view === 'plugin');
/** Lay the sketch under the plugin, a picture to build on (it shows while editing), and rub the marks out. */
async function layUnder() {
  const marks = session.marksHere('plugin');
  if (!marks.length) return;
  const png = await underlayPicture({ width: W.value, height: H.value }, marks);
  const meta = await session.addAssetFile(new File([png], 'sketch.png', { type: 'image/png' }));
  if (
    !meta ||
    !commit(
      [{ op: 'setUnderlay', underlay: { asset: meta.id, opacity: 0.6, visible: true } }],
      'Sketch under the plugin',
    )
  )
    return;
  session.clearSketch('plugin', true);
  session.inking.value = null;
  emit('update:edit', true);
  session.toast(
    'info',
    'The sketch is under the plugin now, to build on: it shows while you edit (the plugin inspector’s reference picture hides it or changes its opacity; ⌘Z takes it back).',
  );
}
/** What the person sees of the plugin: its scale on screen. */
const viewDetails = () => {
  const panel = stageEl.value?.querySelector('[data-testid=panel]');
  const width = panel?.getBoundingClientRect().width;
  return width ? { scale: Math.round((width / W.value) * 100) / 100 } : {};
};
onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onEnter, true);
  session.viewDetails = viewDetails;
});
onBeforeUnmount(() => {
  releaseEnter();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keydown', onEnter, true);
  if (session.viewDetails === viewDetails) session.viewDetails = null;
});
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const selectionBox = computed(() => {
  const ids = [...selected.value];
  if (ids.length < 2) return null;
  const rects = ids.map(id => rectOf(id)!).filter(Boolean);
  const x0 = Math.min(...rects.map(r => r.x)),
    y0 = Math.min(...rects.map(r => r.y));
  return {
    x: x0,
    y: y0,
    w: Math.max(...rects.map(r => r.x + r.w)) - x0,
    h: Math.max(...rects.map(r => r.y + r.h)) - y0,
  };
});
</script>

<template>
  <div class="plugin-view" :class="{ focus }" tabindex="-1" data-testid="plugin-view">
    <div v-if="!focus" class="bar">
      <div class="modes">
        <button
          :class="{ active: !edit }"
          data-testid="plugin-play"
          title="Play (⌘E switches)"
          @click="emit('update:edit', false)"
        >
          Play
        </button>
        <button
          :class="{ active: edit }"
          data-testid="plugin-edit"
          title="Edit the plugin (⌘E switches)"
          @click="emit('update:edit', true)"
        >
          Edit
        </button>
      </div>
      <select
        :value="doc.panel.theme"
        data-testid="plugin-theme"
        title="Base theme (the look's own colours stay on top)"
        @change="
          commit(
            [{ op: 'setTheme', theme: ($event.target as HTMLSelectElement).value as never }],
            'Theme',
          )
        "
      >
        <option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option>
      </select>
      <label v-if="hasInput" class="input">Input <InputSelect /></label>
      <button
        v-if="edit"
        class="small"
        data-testid="plugin-add"
        title="Add text, shapes, pictures, lamps, canvases or controls (Shift+Space)"
        @click="openMenu({ x: W / 2, y: H / 2 })"
      >
        + Add <kbd>⇧Space</kbd>
      </button>
      <button
        v-if="edit"
        class="small"
        data-testid="plugin-check"
        title="Look the plugin over: overlaps, things cut by the edge, text that does not fit or is hard to read, unlabelled or unwired controls (⌥⌘K)"
        @click="runCheck"
      >
        ✓ Check <kbd>⌥⌘K</kbd>
      </button>
      <span class="muted hint">{{
        edit
          ? 'drag · handles resize · ⌥A/D/W/S align · ⌘G group · ⌘]/[ stack · Tab next · Enter text'
          : `${W} × ${H} · scales to the window`
      }}</span>
      <span style="flex: 1" />
      <template v-if="edit && hiddenWidgets.length">
        <span class="muted">Not on the plugin:</span>
        <button v-for="n in hiddenWidgets" :key="n.id" class="small" @click="place(n.id)">
          + {{ n.label ?? n.id }}
        </button>
      </template>
      <button
        class="small"
        data-testid="plugin-fullscreen"
        title="Full screen (⇧⌘F); Esc leaves"
        @click="emit('fullscreen')"
      >
        ⛶ Full screen <kbd>⇧⌘F</kbd>
      </button>
    </div>
    <div
      ref="stageEl"
      class="stage"
      :class="{ editing: edit }"
      @pointerdown="backgroundDown"
      @dblclick="backgroundDouble"
      @dragover="dragOver"
      @drop="dropFiles"
    >
      <PluginWindow
        ref="win"
        :spec="spec"
        :held="session.heldNotes.value"
        :analyser="analyser"
        :asset-urls="session.assetUrls.value"
        :editing="edit"
        @change="onChange"
        @note="onNote"
      >
        <template #cell="{ item }">
          <template v-if="edit">
            <div
              class="shield"
              :class="{
                selected: selected.has(item.id),
                locked: item.kind === 'element' && item.element.locked,
              }"
              :data-shield="item.id"
              @pointerdown="startMove(item.id, $event)"
              @dblclick="doubleClick(item.id, $event)"
            />
            <template v-if="selected.size === 1 && selected.has(item.id)">
              <div
                v-for="h in HANDLES"
                :key="h"
                class="handle"
                :class="h"
                :data-handle="h"
                @pointerdown="startMove(item.id, $event, h)"
              />
            </template>
            <textarea
              v-if="editingText === item.id"
              v-model="textDraft"
              class="text-edit"
              spellcheck="false"
              @keydown="textKey"
              @blur="endText(true)"
              @pointerdown.stop
            />
          </template>
        </template>
        <template #empty>
          <div class="empty" data-testid="plugin-empty">
            Nothing on the plugin yet. Press <kbd>⌘E</kbd> to edit, then <kbd>⇧Space</kbd> to add
            text, shapes, pictures or controls — or in the patch, press “→ Plugin” next to a knob.
          </div>
        </template>
        <template #overlay>
          <div v-if="edit" class="frame" />
          <div
            v-if="selectionBox"
            class="sel-box"
            :style="{
              left: `${selectionBox.x}px`,
              top: `${selectionBox.y}px`,
              width: `${selectionBox.w}px`,
              height: `${selectionBox.h}px`,
            }"
          />
          <div
            v-if="marquee"
            class="marquee"
            data-testid="marquee"
            :style="{
              left: `${marquee.x}px`,
              top: `${marquee.y}px`,
              width: `${marquee.w}px`,
              height: `${marquee.h}px`,
            }"
          />
          <div
            v-for="b in touchBoxes"
            :key="`touch-${b.id}`"
            class="touch"
            :data-touched-by="b.name"
            :style="{
              left: `${b.rect.x}px`,
              top: `${b.rect.y}px`,
              width: `${b.rect.w}px`,
              height: `${b.rect.h}px`,
              '--touch': b.color,
            }"
          >
            <span>{{ b.name }}</span>
          </div>
          <InkLayer view="plugin" :width="W" :height="H" />
        </template>
      </PluginWindow>
      <InkToolbar v-if="inking" view="plugin" @underlay="layUnder" />
      <InsertMenu
        v-if="menu"
        :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
        @pick="insert"
        @close="menu = null"
      />
      <div v-if="checks && edit" class="checks" data-testid="plugin-checks" @pointerdown.stop>
        <header>
          <b>{{
            checks.running
              ? 'Looking…'
              : checks.issues.length
                ? `${checks.issues.length} to look at`
                : 'Nothing to fix'
          }}</b>
          <span v-if="checks.stale" class="muted">· the plugin changed</span>
          <span style="flex: 1" />
          <button class="small" :disabled="checks.running" @click="runCheck">Again</button>
          <button class="small" title="Close (Esc)" @click="checks = null">✕</button>
        </header>
        <button
          v-for="(i, k) in checks.issues"
          :key="k"
          class="issue"
          :class="i.severity"
          :data-code="i.code"
          @click="pickIssue(i)"
        >
          {{ i.message }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-view {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}
.bar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--gray-0);
  background: var(--gray-4);
  flex-wrap: wrap;
  font-size: 13px;
}
.modes {
  display: flex;
  background: var(--gray-2);
  border-radius: 4px;
  padding: 2px;
}
.modes button {
  background: transparent;
  box-shadow: none;
  color: var(--gray-13);
  padding: 3px 12px;
}
.modes button.active {
  background: var(--gray-7);
  color: var(--gray-19);
}
.hint {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 0 1 auto;
}
.input {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--muted);
}
.small {
  padding: 2px 8px;
  font-size: 12px;
}
kbd {
  font-size: 10.5px;
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid var(--gray-9);
  border-radius: 3px;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.frame {
  position: absolute;
  inset: 0;
  outline: 1px dashed color-mix(in srgb, var(--gray-19) 25%, transparent);
  pointer-events: none;
}
.shield {
  position: absolute;
  inset: 0;
  outline: 1px dashed color-mix(in srgb, var(--blue) 31%, transparent);
  cursor: move;
  pointer-events: auto;
}
.shield.selected {
  outline: 2px solid var(--blue);
}
.shield.locked {
  pointer-events: none;
  outline: none;
}
.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px;
  background: var(--gray-19);
  border: 1.5px solid var(--blue-deep);
  border-radius: 2px;
  z-index: 3;
  pointer-events: auto;
}
.handle.nw {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.handle.n {
  left: 50%;
  top: 0;
  cursor: ns-resize;
}
.handle.ne {
  left: 100%;
  top: 0;
  cursor: nesw-resize;
}
.handle.e {
  left: 100%;
  top: 50%;
  cursor: ew-resize;
}
.handle.se {
  left: 100%;
  top: 100%;
  cursor: nwse-resize;
}
.handle.s {
  left: 50%;
  top: 100%;
  cursor: ns-resize;
}
.handle.sw {
  left: 0;
  top: 100%;
  cursor: nesw-resize;
}
.handle.w {
  left: 0;
  top: 50%;
  cursor: ew-resize;
}
.text-edit {
  position: absolute;
  inset: 0;
  z-index: 4;
  width: 100%;
  height: 100%;
  resize: none;
  pointer-events: auto;
  font: inherit;
  background: color-mix(in srgb, var(--gray-0) 80%, transparent);
  color: var(--gray-19);
  border: 2px solid var(--blue);
}
.sel-box {
  position: absolute;
  outline: 1px solid var(--blue);
  pointer-events: none;
}
.marquee {
  position: absolute;
  border: 1px solid var(--blue);
  background: color-mix(in srgb, var(--blue) 13%, transparent);
  pointer-events: none;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 40px;
  text-align: center;
  opacity: 0.75;
  font-size: 15px;
  line-height: 1.6;
}
.checks {
  position: absolute;
  top: 10px;
  right: 10px;
  width: min(380px, calc(100% - 20px));
  max-height: calc(100% - 20px);
  overflow: auto;
  z-index: 6;
  background: color-mix(in srgb, var(--slate-0) 95%, transparent);
  border: 1px solid var(--gray-0);
  border-radius: 6px;
  box-shadow: 0 8px 30px color-mix(in srgb, var(--gray-0) 53%, transparent);
  font-size: 12.5px;
}
.checks header {
  position: sticky;
  top: 0;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 7px 10px;
  background: var(--slate-0);
  border-bottom: 1px solid var(--gray-0);
}
.checks .issue {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px 7px 26px;
  border: 0;
  border-bottom: 1px solid var(--slate-1);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--slate-5);
  line-height: 1.4;
  position: relative;
  white-space: normal;
}
.checks .issue:hover {
  background: var(--slate-1);
}
.checks .issue::before {
  content: '';
  position: absolute;
  left: 10px;
  top: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--yellow);
}
.checks .issue.error::before {
  background: var(--red-soft);
}
.touch {
  position: absolute;
  pointer-events: none;
  border: 2px solid var(--touch);
  border-radius: 4px;
  box-shadow: 0 0 12px color-mix(in srgb, var(--touch) 50%, transparent);
}
.touch span {
  position: absolute;
  top: -18px;
  left: -2px;
  padding: 0 6px;
  border-radius: 4px 4px 0 0;
  background: var(--touch);
  color: var(--gray-0);
  font:
    600 11px/16px Lato,
    system-ui,
    sans-serif;
  white-space: nowrap;
}
</style>

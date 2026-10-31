<script setup lang="ts">
// The sidebar while editing the plugin: what is selected (place and size, its
// look, text, binding, code), or with nothing selected the plugin itself (size,
// theme, colours and fonts, background, default skins, CSS, reference picture);
// then the assets and the layers.
import { computed, ref, watch } from 'vue';
import { THEMES, type PanelRect } from '../../work/schema.ts';
import {
  CONTROL_KINDS,
  CONTROL_OF,
  DEFAULT_SKIN,
  type ControlKind,
  type Skin,
} from '../../work/skins.ts';
import { THEME_TOKENS } from '../../work/themes.ts';
import {
  COLOR_TOKENS,
  FONT_TOKENS,
  FONTS,
  TOKEN_DOC,
  isFontAsset,
  isImageAsset,
  withGroups,
  type ElementStyle,
  type Fill,
  type TextStyle,
  type UiElement,
  type WidgetStyle,
  assetsOf,
} from '../../work/ui.ts';
import type { Intent } from '../../work/ops.ts';
import { partNames, partPath } from '../../work/files.ts';
import { useSession } from '../context.ts';
import AssetPanel from './AssetPanel.vue';
import ColorField from './ColorField.vue';
import FillList from './FillList.vue';
import LayerList from './LayerList.vue';
import NumberField from './NumberField.vue';
import SkinEditor from './SkinEditor.vue';
import StyleEditor from './StyleEditor.vue';
import TextStyleEditor from './TextStyleEditor.vue';
import CodeArea from '../CodeArea.vue';

const emit = defineEmits<{
  (e: 'edit-canvas', id: string): void;
  (e: 'action', name: string): void;
  (e: 'open-project', path?: string): void;
}>();
const session = useSession();
const doc = computed(() => session.doc.value);
const look = computed(() => doc.value.ui.look);
const assets = computed(() => assetsOf(doc.value.files));
const onPlugin = (id: string) =>
  !!doc.value.ui.elements[id] ||
  (!!doc.value.nodes[id]?.panel && !!CONTROL_OF[doc.value.nodes[id]!.type]);
const selected = computed(() => session.selection.value.filter(onPlugin));
const one = computed(() => (selected.value.length === 1 ? selected.value[0]! : null));
const element = computed<UiElement | undefined>(() =>
  one.value ? doc.value.ui.elements[one.value] : undefined,
);
const node = computed(() => (one.value && !element.value ? doc.value.nodes[one.value] : undefined));
const control = computed<ControlKind | undefined>(() =>
  node.value ? CONTROL_OF[node.value.type] : undefined,
);
const rect = computed<PanelRect | undefined>(() => element.value?.rect ?? node.value?.panel);
const controls = computed(() =>
  Object.values(doc.value.nodes).filter(
    n => CONTROL_OF[n.type] && !['ui.keyboard', 'ui.scope', 'ui.meter'].includes(n.type),
  ),
);
// ---- a part's face: controls wired to one use's parameters (or its face on the plugin) can become the part's face ----
const faceUse = computed(() => {
  const sel = selected.value,
    d = doc.value;
  if (!sel.length) return null;
  const uses = new Set<string>();
  for (const id of sel) {
    if (!d.nodes[id]) continue;
    for (const e of Object.values(d.edges)) {
      const to = d.nodes[e.to.node];
      if (e.from.node === id && to?.type === 'kit.part' && to.inside === undefined) uses.add(to.id);
    }
  }
  for (const [g, members] of Object.entries(d.ui.groups)) {
    const use = g.endsWith('Face') ? d.nodes[g.slice(0, -4)] : undefined;
    if (use?.type === 'kit.part' && members.some(m => sel.includes(m))) uses.add(use.id);
  }
  return uses.size === 1 ? [...uses][0]! : null;
});
const facePart = computed(() => {
  const use = faceUse.value ? doc.value.nodes[faceUse.value] : undefined;
  return use?.part ? doc.value.parts[use.part] : undefined;
});
function saveFace() {
  const r = session.saveFace(faceUse.value!, selected.value);
  session.toast(r.ok ? 'info' : 'warn', r.message);
}
/** Decorations alone (no controls of a part) can become a screen part. */
const screenable = computed(
  () =>
    !facePart.value &&
    selected.value.length > 0 &&
    selected.value.every(id => !!doc.value.ui.elements[id]),
);
function makeScreenPart() {
  const r = session.makeScreenPart(selected.value);
  session.toast(r.ok ? 'info' : 'warn', r.message);
}
const grouped = computed(
  () =>
    selected.value.length > 1 &&
    Object.values(doc.value.ui.groups).some(
      m =>
        m.length === withGroups(doc.value.ui, selected.value).length &&
        m.every(id => selected.value.includes(id)),
    ),
);

// One gesture per field while it is being dragged or typed in, so a colour drag is one undo step.
let gesture = { key: '', id: '', at: 0 };
function commit(intents: Intent[], label: string, key?: string) {
  let g: string | undefined;
  if (key) {
    const now = performance.now();
    if (gesture.key !== key || now - gesture.at > 1500)
      gesture = { key, id: `insp-${key}-${Date.now()}`, at: now };
    gesture.at = now;
    g = gesture.id;
  }
  const r = session.commit(intents, { label, gesture: g });
  if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
  return r;
}
const setRect = (patch: Partial<PanelRect>) => {
  if (one.value && rect.value)
    commit([{ op: 'setRect', id: one.value, rect: { ...rect.value, ...patch } }], 'Place');
};
const setEl = (set: Record<string, unknown>, label = 'Change', key?: string) => {
  if (element.value) commit([{ op: 'updateElement', id: element.value.id, set }], label, key);
};
function setWidget(patch: Partial<Record<keyof WidgetStyle, unknown>>, key?: string) {
  if (!node.value) return;
  const next = { ...node.value.style } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (
      v === null ||
      v === undefined ||
      (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)
    )
      delete next[k];
    else next[k] = v;
  }
  commit(
    [
      {
        op: 'setStyle',
        node: node.value.id,
        style: Object.keys(next).length ? (next as WidgetStyle) : null,
      },
    ],
    'Control look',
    key,
  );
}
const widgetToken = (token: string, color: string | null, done: boolean) => {
  const tokens = { ...node.value?.style?.tokens } as Record<string, string>;
  if (color) tokens[token] = color;
  else delete tokens[token];
  setWidget({ tokens }, done ? undefined : `wt-${token}`);
};
const lookTokens = (token: string, value: string | null, done = true) =>
  commit(
    [{ op: 'setLook', look: { tokens: { [token]: value } } }],
    'Look colours',
    done ? undefined : `lt-${token}`,
  );
const label = ref('');
watch(
  node,
  n => {
    label.value = n?.label ?? '';
  },
  { immediate: true },
);
const textDraft = ref('');
watch(
  element,
  e => {
    textDraft.value = e?.kind === 'text' ? e.text : e?.kind === 'svg' ? e.svg : '';
  },
  { immediate: true },
);
const propsDraft = ref('');
watch(
  element,
  e => {
    propsDraft.value = e?.kind === 'canvas' || e?.kind === 'code' ? JSON.stringify(e.props) : '';
  },
  { immediate: true },
);
function setProps() {
  try {
    setEl(
      { props: JSON.parse(propsDraft.value || '{}') },
      element.value?.kind === 'code' ? 'Part settings' : 'Canvas settings',
    );
  } catch {
    session.toast('warn', 'Settings must be JSON, e.g. {"speed": 2}.');
  }
}
// ---- a code part: which part of the project it shows, and the settings the part declares (it reports them when it loads) ----
type PropSpec =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label?: string }
  | { type: 'boolean'; default: boolean; label?: string }
  | { type: 'text' | 'color'; default: string; label?: string }
  | { type: 'select'; default: string; options: string[]; label?: string };
const partList = computed(() => partNames(doc.value.files));
const codeReport = computed(() =>
  element.value?.kind === 'code' ? session.pod?.parts.value[element.value.id] : undefined,
);
const propSpecs = computed<Record<string, PropSpec>>(() => {
  const raw = codeReport.value?.props;
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([, v]) =>
        v &&
        typeof v === 'object' &&
        ['number', 'boolean', 'text', 'color', 'select'].includes(
          (v as { type?: string }).type ?? '',
        ),
    ),
  ) as Record<string, PropSpec>;
});
const propValue = (key: string, spec: PropSpec) => {
  const v = element.value?.kind === 'code' ? element.value.props[key] : undefined;
  return v === undefined ? spec.default : v;
};
function setProp(key: string, value: string | number | boolean | null, done = true) {
  if (element.value?.kind !== 'code') return;
  const next = { ...element.value.props };
  if (value === null) delete next[key];
  else next[key] = value;
  setEl({ props: next }, 'Part setting', done ? undefined : `prop-${key}`);
}
const cssDraft = ref(look.value.css ?? '');
watch(
  () => look.value.css,
  c => {
    cssDraft.value = c ?? '';
  },
);
// The design brief: what the screen is going for, kept to by the AI on every request.
const briefDraft = ref(doc.value.ui.brief ?? '');
watch(
  () => doc.value.ui.brief,
  b => {
    briefDraft.value = b ?? '';
  },
);
const defaultSkinControl = ref<ControlKind>('knob');
const KIND_TITLE: Record<string, string> = {
  text: 'Text',
  shape: 'Shape',
  image: 'Picture',
  svg: 'SVG',
  led: 'Lamp',
  canvas: 'Canvas',
  code: 'Code part',
};
const pictures = computed(() => Object.values(assets.value).filter(isImageAsset));
const fontAssets = computed(() => Object.values(assets.value).filter(isFontAsset));
</script>

<template>
  <div class="plugin-inspector" data-testid="plugin-inspector">
    <div v-if="screenable" class="section" data-testid="screen-part-section">
      <h3>Screen part</h3>
      <div class="muted small">
        Make these decorations a part of their own: saved to My parts, it puts the same screen on
        other plugins.
      </div>
      <button data-testid="make-screen-part" @click="makeScreenPart">Make a screen part</button>
    </div>
    <div v-if="facePart" class="section" data-testid="face-section">
      <h3>Part face</h3>
      <div class="muted small">
        Controls of {{ faceUse }} ({{ facePart.name }}). Saved as its face, every use of
        {{ facePart.name }} can put the same screen on the plugin; uses whose face is on the plugin
        now follow.
      </div>
      <button class="primary as-written" data-testid="save-face" @click="saveFace">
        Save as {{ facePart.name }}'s face
      </button>
    </div>
    <!-- one decoration -->
    <template v-if="element">
      <div class="section">
        <h3>
          {{ KIND_TITLE[element.kind]
          }}<template v-if="element.kind === 'shape'"> · {{ element.shape }}</template>
        </h3>
        <div class="row">
          <label>Name</label
          ><input
            type="text"
            :value="element.name ?? ''"
            :placeholder="element.id"
            @change="setEl({ name: ($event.target as HTMLInputElement).value || null }, 'Rename')"
          />
        </div>
        <div class="row xywh">
          <NumberField
            :value="rect!.x"
            unit="x"
            @update="v => v !== null && setRect({ x: v })"
          /><NumberField
            :value="rect!.y"
            unit="y"
            @update="v => v !== null && setRect({ y: v })"
          /><NumberField
            :value="rect!.w"
            :min="1"
            unit="w"
            @update="v => v !== null && setRect({ w: v })"
          /><NumberField
            :value="rect!.h"
            :min="1"
            unit="h"
            @update="v => v !== null && setRect({ h: v })"
          />
        </div>
        <template v-if="element.kind === 'text'">
          <textarea
            v-model="textDraft"
            rows="2"
            data-field="text"
            placeholder="Text ({value} shows the bound control)"
            @change="setEl({ text: textDraft }, 'Text')"
          />
          <div class="row">
            <label>Shows</label
            ><select
              :value="element.bind ?? ''"
              @change="setEl({ bind: ($event.target as HTMLSelectElement).value || null }, 'Bind')"
            >
              <option value="">just the text</option>
              <option v-for="c in controls" :key="c.id" :value="c.id">
                value of {{ c.label ?? c.id }}
              </option>
            </select>
          </div>
        </template>
        <div v-else-if="element.kind === 'shape'" class="row">
          <label>Shape</label
          ><select
            :value="element.shape"
            @change="setEl({ shape: ($event.target as HTMLSelectElement).value })"
          >
            <option>rect</option>
            <option>ellipse</option>
            <option>line</option>
          </select>
        </div>
        <template v-else-if="element.kind === 'image'">
          <div class="row">
            <label>Picture</label
            ><select
              :value="element.asset"
              @change="setEl({ asset: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="a in pictures" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>
          <div class="row">
            <label>Fit</label
            ><select
              :value="element.fit"
              @change="setEl({ fit: ($event.target as HTMLSelectElement).value })"
            >
              <option>contain</option>
              <option>cover</option>
              <option>stretch</option>
            </select>
          </div>
        </template>
        <CodeArea
          v-else-if="element.kind === 'svg'"
          v-model="textDraft"
          language="xml"
          rows="6"
          class="code"
          @change="setEl({ svg: textDraft }, 'SVG')"
        />
        <template v-else-if="element.kind === 'led'">
          <div class="row">
            <label>Lights</label
            ><select
              :value="element.bind"
              @change="setEl({ bind: ($event.target as HTMLSelectElement).value }, 'Lamp')"
            >
              <option value="@level">with the sound</option>
              <option v-for="c in controls" :key="c.id" :value="c.id">
                with {{ c.label ?? c.id }}
              </option>
            </select>
          </div>
          <div class="row">
            <label>Colour</label
            ><ColorField
              :value="element.color"
              :clearable="false"
              @update="
                (c, done) => c && setEl({ color: c }, 'Lamp colour', done ? undefined : 'led')
              "
            />
          </div>
          <div class="row">
            <label>From</label
            ><input
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="element.threshold"
              @change="
                setEl({ threshold: Number(($event.target as HTMLInputElement).value) }, 'Lamp')
              "
            />
          </div>
        </template>
        <template v-else-if="element.kind === 'canvas'">
          <button
            class="primary"
            type="button"
            data-testid="edit-canvas"
            @click="emit('edit-canvas', element.id)"
          >
            Edit code
          </button>
          <div class="row">
            <label>Settings</label
            ><input
              v-model="propsDraft"
              type="text"
              class="code"
              spellcheck="false"
              placeholder="{}"
              @change="setProps"
            />
          </div>
        </template>
        <template v-else-if="element.kind === 'code'">
          <div class="row">
            <label>Part</label
            ><select
              :value="element.part"
              data-testid="code-part-select"
              @change="setEl({ part: ($event.target as HTMLSelectElement).value }, 'Code part')"
            >
              <option
                v-for="p in partList.includes(element.part)
                  ? partList
                  : [element.part, ...partList]"
                :key="p"
                :value="p"
              >
                {{ p }}
              </option>
            </select>
          </div>
          <div class="muted small" data-testid="code-part-state">
            {{ partPath(element.part) }} ·
            {{ codeReport ? codeReport.state : session.pod?.message.value || 'not loaded' }}
          </div>
          <div
            v-if="codeReport?.error"
            class="code-error small"
            data-testid="code-part-error"
            v-text="codeReport.error"
          />
          <div v-for="(spec, key) in propSpecs" :key="key" class="row" :data-prop="key">
            <label>{{ spec.label ?? key }}</label>
            <input
              v-if="spec.type === 'number'"
              type="number"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step ?? 'any'"
              :value="propValue(String(key), spec)"
              @change="setProp(String(key), Number(($event.target as HTMLInputElement).value))"
            />
            <input
              v-else-if="spec.type === 'boolean'"
              type="checkbox"
              :checked="!!propValue(String(key), spec)"
              @change="setProp(String(key), ($event.target as HTMLInputElement).checked)"
            />
            <select
              v-else-if="spec.type === 'select'"
              :value="propValue(String(key), spec)"
              @change="setProp(String(key), ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
            </select>
            <ColorField
              v-else-if="spec.type === 'color'"
              :value="String(propValue(String(key), spec))"
              :clearable="true"
              @update="(c, done) => setProp(String(key), c, done)"
            />
            <input
              v-else
              type="text"
              :value="propValue(String(key), spec)"
              @change="setProp(String(key), ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div v-if="!Object.keys(propSpecs).length" class="row">
            <label>Settings</label
            ><input
              v-model="propsDraft"
              type="text"
              class="code"
              spellcheck="false"
              placeholder="{}"
              @change="setProps"
            />
          </div>
          <button
            type="button"
            data-testid="open-part-file"
            @click="emit('open-project', partPath(element.part))"
          >
            Open its file
          </button>
        </template>
        <div class="row flags">
          <label class="check"
            ><input
              type="checkbox"
              :checked="!!element.locked"
              @change="
                setEl({ locked: ($event.target as HTMLInputElement).checked || null }, 'Lock')
              "
            />
            locked</label
          ><label class="check"
            ><input
              type="checkbox"
              :checked="!!element.hidden"
              @change="
                setEl({ hidden: ($event.target as HTMLInputElement).checked || null }, 'Hide')
              "
            />
            hidden</label
          >
        </div>
      </div>
      <div v-if="element.kind === 'text'" class="section">
        <h3>Text</h3>
        <TextStyleEditor
          :value="element.textStyle"
          :assets="assets"
          @update="
            (t: TextStyle | null, done: boolean) =>
              setEl({ textStyle: t }, 'Text style', done ? undefined : 'text-style')
          "
        />
      </div>
      <div class="section">
        <h3>Look</h3>
        <StyleEditor
          :value="element.style"
          :assets="assets"
          :shape="element.kind === 'shape' ? element.shape : undefined"
          @update="
            (s: ElementStyle | null, done: boolean) =>
              setEl({ style: s }, 'Style', done ? undefined : 'style')
          "
        />
      </div>
    </template>

    <!-- one control -->
    <template v-else-if="node && control">
      <div class="section">
        <h3>{{ control }}</h3>
        <div class="row">
          <label>Label</label
          ><input
            v-model="label"
            type="text"
            @change="commit([{ op: 'setLabel', node: node.id, label: label || null }], 'Label')"
          />
        </div>
        <div class="row xywh">
          <NumberField
            :value="rect!.x"
            unit="x"
            @update="v => v !== null && setRect({ x: v })"
          /><NumberField
            :value="rect!.y"
            unit="y"
            @update="v => v !== null && setRect({ y: v })"
          /><NumberField
            :value="rect!.w"
            :min="8"
            unit="w"
            @update="v => v !== null && setRect({ w: v })"
          /><NumberField
            :value="rect!.h"
            :min="8"
            unit="h"
            @update="v => v !== null && setRect({ h: v })"
          />
        </div>
        <SkinEditor
          :control="control"
          :value="node.style?.skin"
          :assets="assets"
          :inherited="look.skins[control]?.name ?? DEFAULT_SKIN[control]"
          @update="
            (s: Skin | null, done: boolean) => setWidget({ skin: s }, done ? undefined : 'skin')
          "
        />
      </div>
      <div class="section">
        <h3>Colours</h3>
        <div
          v-for="t in ['accent', 'track', 'knob', 'pointer', 'fg']"
          :key="t"
          class="row"
          :title="TOKEN_DOC[t as never]"
        >
          <label>{{ t }}</label
          ><ColorField
            :value="node.style?.tokens?.[t as never]"
            placeholder="from the look"
            @update="(c, done) => widgetToken(t, c, done)"
          />
        </div>
      </div>
      <div class="section">
        <h3>Label text</h3>
        <TextStyleEditor
          :value="node.style?.textStyle"
          :assets="assets"
          short
          @update="
            (t: TextStyle | null, done: boolean) =>
              setWidget({ textStyle: t }, done ? undefined : 'wtext')
          "
        />
      </div>
      <div class="section">
        <h3>Box</h3>
        <StyleEditor
          :value="node.style?.style"
          :assets="assets"
          @update="
            (s: ElementStyle | null, done: boolean) =>
              setWidget({ style: s }, done ? undefined : 'wbox')
          "
        />
      </div>
    </template>

    <!-- several -->
    <div v-else-if="selected.length > 1" class="section">
      <h3>{{ selected.length }} selected</h3>
      <div class="sub">Align</div>
      <div class="grid3">
        <button type="button" title="Left (⌥A)" @click="emit('action', 'align-left')">⇤ Left</button
        ><button type="button" title="Centre (⌥H)" @click="emit('action', 'align-hcenter')">
          ↔ Centre</button
        ><button type="button" title="Right (⌥D)" @click="emit('action', 'align-right')">
          Right ⇥
        </button>
        <button type="button" title="Top (⌥W)" @click="emit('action', 'align-top')">⤒ Top</button
        ><button type="button" title="Middle (⌥V)" @click="emit('action', 'align-vcenter')">
          ↕ Middle</button
        ><button type="button" title="Bottom (⌥S)" @click="emit('action', 'align-bottom')">
          Bottom ⤓
        </button>
      </div>
      <div class="sub">Spread evenly</div>
      <div class="row">
        <button type="button" title="⌃⌥H" @click="emit('action', 'distribute-h')">Across</button
        ><button type="button" title="⌃⌥V" @click="emit('action', 'distribute-v')">Down</button>
      </div>
      <div class="row">
        <button type="button" title="⌘G" :disabled="grouped" @click="emit('action', 'group')">
          Group</button
        ><button type="button" title="⇧⌘G" @click="emit('action', 'ungroup')">Ungroup</button>
      </div>
      <div class="row">
        <button type="button" title="⌥⌘]" @click="emit('action', 'front')">To front</button
        ><button type="button" title="⌥⌘[" @click="emit('action', 'back')">To back</button>
      </div>
    </div>

    <!-- the plugin itself -->
    <template v-else>
      <div class="section">
        <h3>Design brief</h3>
        <textarea
          v-model="briefDraft"
          rows="3"
          spellcheck="false"
          placeholder="What the screen is going for: the idea, colours, type, layout. The AI keeps to it."
          data-testid="design-brief"
          @change="commit([{ op: 'setBrief', brief: briefDraft.trim() || null }], 'Design brief')"
        />
      </div>
      <div class="section">
        <h3>Plugin</h3>
        <div class="row">
          <label>Size</label
          ><NumberField
            :value="doc.panel.width"
            :min="120"
            :max="4000"
            unit="w"
            @update="
              v =>
                v &&
                commit([{ op: 'setPanelSize', width: v, height: doc.panel.height }], 'Plugin size')
            "
          /><NumberField
            :value="doc.panel.height"
            :min="80"
            :max="4000"
            unit="h"
            @update="
              v =>
                v &&
                commit([{ op: 'setPanelSize', width: doc.panel.width, height: v }], 'Plugin size')
            "
          />
        </div>
        <div class="row">
          <label>Theme</label
          ><select
            :value="doc.panel.theme"
            data-testid="look-theme"
            @change="
              commit(
                [{ op: 'setTheme', theme: ($event.target as HTMLSelectElement).value as never }],
                'Theme',
              )
            "
          >
            <option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="sub">Colours</div>
        <div v-for="t in COLOR_TOKENS" :key="t" class="row" :title="TOKEN_DOC[t]">
          <label>{{ t }}</label
          ><ColorField
            :value="look.tokens[t]"
            :placeholder="THEME_TOKENS[doc.panel.theme][t]"
            @update="(c, done) => lookTokens(t, c, done)"
          />
        </div>
        <div class="sub">Fonts</div>
        <div v-for="t in FONT_TOKENS" :key="t" class="row" :title="TOKEN_DOC[t]">
          <label>{{ t }}</label
          ><select
            :value="look.tokens[t] ?? ''"
            :data-token="t"
            @change="lookTokens(t, ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">
              {{
                FONTS[THEME_TOKENS[doc.panel.theme][t]]?.title ?? THEME_TOKENS[doc.panel.theme][t]
              }}
              (theme)
            </option>
            <option v-for="(f, id) in FONTS" :key="id" :value="id">
              {{ f.title }} — {{ f.doc }}
            </option>
            <option v-for="a in fontAssets" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>
      <div class="section">
        <h3>Background</h3>
        <FillList
          :fills="look.background ?? []"
          :assets="assets"
          @update="
            (f: Fill[], done: boolean) =>
              commit(
                [{ op: 'setLook', look: { background: f.length ? f : null } }],
                'Background',
                done ? undefined : 'bg',
              )
          "
        />
      </div>
      <div class="section">
        <h3>Controls</h3>
        <div class="row">
          <label>Kind</label
          ><select v-model="defaultSkinControl">
            <option v-for="c in CONTROL_KINDS" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <SkinEditor
          :control="defaultSkinControl"
          :value="look.skins[defaultSkinControl]"
          :assets="assets"
          :inherited="DEFAULT_SKIN[defaultSkinControl]"
          @update="
            (s: Skin | null, done: boolean) =>
              commit(
                [{ op: 'setLook', look: { skins: { [defaultSkinControl]: s } } }],
                'Control skins',
                done ? undefined : 'skins',
              )
          "
        />
      </div>
      <div class="section">
        <h3>CSS</h3>
        <CodeArea
          v-model="cssDraft"
          language="css"
          rows="5"
          class="code"
          placeholder="dk-knob::part(label) { letter-spacing: .2em }  ·  url(asset:ID) for pictures"
          data-testid="look-css"
          @change="commit([{ op: 'setLook', look: { css: cssDraft || null } }], 'CSS')"
        />
      </div>
      <div class="section">
        <h3>Reference picture</h3>
        <div class="row">
          <label>Picture</label
          ><select
            :value="doc.ui.underlay?.asset ?? ''"
            data-testid="underlay-asset"
            @change="
              commit(
                [
                  {
                    op: 'setUnderlay',
                    underlay: ($event.target as HTMLSelectElement).value
                      ? {
                          asset: ($event.target as HTMLSelectElement).value,
                          opacity: doc.ui.underlay?.opacity ?? 0.4,
                          visible: true,
                        }
                      : null,
                  },
                ],
                'Reference picture',
              )
            "
          >
            <option value="">none</option>
            <option v-for="a in pictures" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div v-if="doc.ui.underlay" class="row">
          <label>Opacity</label
          ><input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            :value="doc.ui.underlay.opacity"
            @change="
              commit(
                [
                  {
                    op: 'setUnderlay',
                    underlay: {
                      ...doc.ui.underlay!,
                      opacity: Number(($event.target as HTMLInputElement).value),
                    },
                  },
                ],
                'Reference picture',
              )
            "
          /><label class="check"
            ><input
              type="checkbox"
              :checked="doc.ui.underlay.visible"
              @change="
                commit(
                  [
                    {
                      op: 'setUnderlay',
                      underlay: {
                        ...doc.ui.underlay!,
                        visible: ($event.target as HTMLInputElement).checked,
                      },
                    },
                  ],
                  'Reference picture',
                )
              "
            />
            show</label
          >
        </div>
        <div class="muted small">Shown under the plugin while you edit, never while playing.</div>
      </div>
    </template>

    <div class="section">
      <h3>Assets</h3>
      <AssetPanel />
    </div>
    <div class="section">
      <h3>Layers</h3>
      <LayerList />
    </div>
  </div>
</template>

<style scoped>
.plugin-inspector {
  font-size: 13.5px;
}
.row label {
  width: 64px;
}
.row label.check {
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.row input[type='text'],
.row select {
  flex: 1;
  min-width: 0;
}
.xywh {
  gap: 4px;
}
textarea {
  width: 100%;
  resize: vertical;
  margin: 4px 0;
  font-size: 13px;
}
.code {
  margin: 4px 0;
  border-radius: var(--radius-control);
  --code-font: 12px/1.45 var(--font-mono);
  --code-pad: 5px 7px;
  --code-resize: vertical;
}
.sub {
  margin: 8px 0 2px;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.grid3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.grid3 button {
  padding: 4px 2px;
  font-size: 12.5px;
}
.flags {
  gap: 12px;
}
.small {
  font-size: 12px;
}
input[type='range'] {
  flex: 1;
  min-width: 0;
}
.code-error {
  color: var(--state-danger);
  white-space: pre-wrap;
  font-family: var(--font-mono);
}
</style>

<script setup lang="ts">
// The Shared prototype's marks on the plugin: the author's plugin as it is now, still, with each
// control marked. Counting per link (or per browser), a control shows how often it was moved and
// where people left it, in ten steps along its range, and a range most people left at one end
// stands out. With only what people send back, it shows where their settings sit; picking one
// shows it beside the plugin, ready to hear in the work.
import { computed, ref } from 'vue';
import PluginWindow from '../../screen/PluginWindow.vue';
import type { PluginSpec, Rect } from '../../screen/spec.ts';
import {
  plugInMarks,
  position,
  returnedMarks,
  valueAt,
  valueText,
  type Level,
  type Marks,
  type Story,
  type StoryControl,
} from './after-sharing.ts';
import { useListen } from './listen.ts';

const props = defineProps<{
  story: Story;
  level: Level;
  controls: readonly StoryControl[];
  spec: PluginSpec;
  focus: readonly string[];
}>();
const { heard, listen } = useListen();
const counted = computed(() => (props.level === 'returns' ? null : props.level));
const marks = computed(() =>
  counted.value ? plugInMarks(props.story, props.controls, counted.value) : [],
);
const sent = computed(() => returnedMarks(props.story, props.controls));
const rectOf = (id: string): Rect | undefined => props.spec.controls[id]?.rect;
const box = (r: Rect) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});
/** Where the work's control is now, along its range. */
const now = (c: StoryControl) => {
  const v = props.spec.controls[c.id]?.values.value;
  return c.kind === 'range' && typeof v === 'number' ? position(c, v) : null;
};
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const tallest = (m: Marks) => Math.max(1, ...m.bins);
const unit = computed(() => (props.level === 'browsers' ? 'browsers' : 'plays'));
function mostly(m: Marks): string {
  if (!m.moved) return '—';
  if (m.control.kind === 'toggle') return m.bins[1]! >= m.bins[0]! ? 'on' : 'off';
  if (m.control.kind === 'xy') return 'see the dots';
  const i = m.bins.indexOf(Math.max(...m.bins));
  const c = m.control;
  return `${valueAt(c, i / 10)} to ${valueAt(c, (i + 1) / 10)}${c.unit ? ` ${c.unit}` : ''}`;
}
const picked = ref<string | null>(null);
const pickedSetting = computed(() => props.story.returns.find(r => r.id === picked.value) ?? null);
const label = (id: string) => props.controls.find(c => c.id === id)?.label ?? id;
const control = (id: string) => props.controls.find(c => c.id === id);
</script>

<template>
  <section class="on-plugin" data-testid="shared-on-plugin">
    <div class="stage">
      <PluginWindow v-if="controls.length" :spec="spec" preview>
        <template #overlay="{ scale }">
          <div class="veil" />
          <template v-if="counted">
            <template v-for="m in marks" :key="m.control.id">
              <div
                v-if="rectOf(m.control.id)"
                class="mark"
                :class="{ end: m.end, focused: m.end && focus.includes('ends') }"
                :data-mark="m.control.id"
                :style="{ ...box(rectOf(m.control.id)!), '--k': 1 / scale }"
                :title="`${m.control.label}: moved in ${m.moved} of ${m.of} ${unit}`"
              >
                <span class="share">{{ pct(m.moved, m.of) }}%</span>
                <template v-if="m.control.kind === 'xy'">
                  <i
                    v-for="(p, i) in m.points.slice(0, 60)"
                    :key="i"
                    class="dot"
                    :style="{ left: `${p[0] * 100}%`, top: `${(1 - p[1]) * 100}%` }"
                  />
                </template>
                <span v-else-if="m.control.kind === 'range'" class="strip">
                  <i
                    v-for="(n, i) in m.bins"
                    :key="i"
                    class="bin"
                    :style="{ height: `${(100 * n) / tallest(m)}%` }"
                  />
                  <i
                    v-if="now(m.control) !== null"
                    class="now"
                    :style="{ left: `${now(m.control)! * 100}%` }"
                  />
                </span>
              </div>
            </template>
          </template>
          <template v-else>
            <template v-for="s in sent" :key="s.control.id">
              <div
                v-if="rectOf(s.control.id) && s.settings.length"
                class="mark sent"
                :data-mark="s.control.id"
                :style="{ ...box(rectOf(s.control.id)!), '--k': 1 / scale }"
              >
                <span class="share">{{ s.settings.length }}</span>
                <span v-if="s.control.kind === 'range'" class="strip">
                  <button
                    v-for="x in s.settings"
                    :key="x.id"
                    class="pin"
                    :class="{ picked: picked === x.id }"
                    :data-pin="x.id"
                    :title="`“${x.title}”: ${valueText(s.control, x.values)}`"
                    :style="{ left: `${position(s.control, Number(x.values.value)) * 100}%` }"
                    @click="picked = x.id"
                  />
                  <i
                    v-if="now(s.control) !== null"
                    class="now"
                    :style="{ left: `${now(s.control)! * 100}%` }"
                  />
                </span>
                <template v-else-if="s.control.kind === 'xy'">
                  <button
                    v-for="x in s.settings"
                    :key="x.id"
                    class="pin"
                    :class="{ picked: picked === x.id }"
                    :data-pin="x.id"
                    :title="`“${x.title}”: ${valueText(s.control, x.values)}`"
                    :style="{
                      left: `${Number(x.values.x) * 100}%`,
                      top: `${(1 - Number(x.values.y)) * 100}%`,
                    }"
                    @click="picked = x.id"
                  />
                </template>
                <span v-else class="toggle-share">
                  <button
                    v-for="x in s.settings"
                    :key="x.id"
                    class="word"
                    :class="{ picked: picked === x.id }"
                    :data-pin="x.id"
                    @click="picked = x.id"
                  >
                    {{ x.values.value ? 'on' : 'off' }}
                  </button>
                </span>
              </div>
            </template>
          </template>
        </template>
      </PluginWindow>
      <p v-else class="empty" data-testid="shared-no-controls">
        This work has no controls on its plugin. Put a knob on it to see where people leave it.
      </p>
    </div>
    <aside class="key">
      <template v-if="counted">
        <div>
          <h3>How to read it</h3>
          <p>
            The share is how many {{ unit }} that pressed play moved the control. The bars show
            where they left it, from the bottom of its range to the top; the line is where your work
            has it now. A control most people left at one end of its range is outlined.
          </p>
        </div>
        <table class="table" data-testid="shared-controls">
          <thead>
            <tr>
              <th>Control</th>
              <th>Moved in</th>
              <th>Most left it</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in marks"
              :key="m.control.id"
              :class="{ end: m.end, focused: m.end && focus.includes('ends') }"
            >
              <th class="as-written">{{ m.control.label }}</th>
              <td>{{ pct(m.moved, m.of) }}%</td>
              <td>{{ mostly(m) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <template v-else>
        <div>
          <h3>Settings sent back</h3>
          <p v-if="!story.returns.some(r => r.values)">Nobody sent a setting.</p>
          <p v-else>
            Each dot is a setting someone sent back. Pick one to see it; the line is where your work
            has the control now.
          </p>
        </div>
        <div v-if="pickedSetting" class="setting" data-testid="shared-picked">
          <b class="as-written">{{ pickedSetting.title }}</b>
          <p v-if="pickedSetting.text" class="as-written">{{ pickedSetting.text }}</p>
          <ul>
            <li v-for="(values, id) in pickedSetting.values" :key="id">
              <template v-if="control(id)">
                <span class="as-written">{{ label(id) }}</span>
                {{ valueText(control(id)!, values) }}
              </template>
            </li>
          </ul>
          <button :data-listen="pickedSetting.id" @click="listen(pickedSetting)">
            {{ heard === pickedSetting.id ? 'Listening in your work' : 'Listen in your work' }}
          </button>
        </div>
      </template>
    </aside>
  </section>
</template>

<style scoped>
.on-plugin {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}
.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 12px;
}
.empty {
  max-width: 420px;
  margin: 40px auto;
  color: var(--text-muted);
  line-height: 1.5;
}
.veil {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--app-canvas) 45%, transparent);
}
/* Marks sit in the plugin's design pixels; --k (one over the plugin's scale) keeps their text and dots one size on screen. */
.mark {
  position: absolute;
  border: calc(1px * var(--k)) solid var(--accent);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--app-card) 70%, transparent);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: calc(12px * var(--k));
  line-height: 1.2;
}
.mark.end {
  border-width: calc(3px * var(--k));
  border-color: var(--state-warn);
}
.mark.focused {
  box-shadow: 0 0 0 calc(5px * var(--k)) color-mix(in srgb, var(--state-warn) 35%, transparent);
}
.share {
  position: absolute;
  left: calc(4px * var(--k));
  top: calc(3px * var(--k));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.toggle-share {
  position: absolute;
  left: calc(4px * var(--k));
  right: calc(4px * var(--k));
  bottom: calc(4px * var(--k));
  display: flex;
  flex-wrap: wrap;
  gap: calc(3px * var(--k));
  color: var(--text-muted);
}
.strip {
  position: absolute;
  left: calc(4px * var(--k));
  right: calc(4px * var(--k));
  bottom: calc(4px * var(--k));
  height: 30%;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  border-bottom: 1px solid var(--line-strong);
}
.bin {
  flex: 1;
  background: var(--accent);
  border-radius: var(--radius-control) var(--radius-control) 0 0;
}
.now {
  position: absolute;
  top: calc(-3px * var(--k));
  bottom: calc(-3px * var(--k));
  width: calc(2px * var(--k));
  margin-left: calc(-1px * var(--k));
  background: var(--text-primary);
}
.dot {
  position: absolute;
  width: calc(6px * var(--k));
  height: calc(6px * var(--k));
  margin: calc(-3px * var(--k)) 0 0 calc(-3px * var(--k));
  border-radius: 50%;
  background: var(--accent);
}
.pin {
  position: absolute;
  bottom: 0;
  width: calc(14px * var(--k));
  height: calc(14px * var(--k));
  margin-left: calc(-7px * var(--k));
  padding: 0;
  border-radius: 50%;
  clip-path: none;
  background: var(--accent);
  border: calc(2px * var(--k)) solid var(--app-card);
  pointer-events: auto;
}
.mark:not(:has(.strip)) .pin {
  bottom: auto;
  margin-top: calc(-7px * var(--k));
}
.pin.picked {
  background: var(--ink);
  box-shadow: 0 0 0 calc(2px * var(--k)) var(--accent);
}
.word {
  padding: 0 calc(5px * var(--k));
  font-size: calc(11px * var(--k));
  pointer-events: auto;
}
.word.picked {
  background: var(--ink);
  color: var(--text-on-ink);
}
.key {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  max-height: 260px;
  overflow: auto;
  padding: 12px 14px;
  border-top: 1px solid var(--line-subtle);
  background: var(--app-chrome);
  font-size: 12.5px;
  line-height: 1.45;
}
h3 {
  margin: 4px 0 8px;
  font-family: var(--font-control);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: var(--case-control);
  letter-spacing: var(--tracking-control);
  color: var(--text-muted);
}
h3::before {
  content: var(--heading-prefix);
}
.key p {
  margin: 0 0 10px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.table th,
.table td {
  padding: 5px 6px;
  border-bottom: 1px solid var(--line-subtle);
  text-align: left;
}
.table thead th {
  font-size: 11.5px;
  color: var(--text-muted);
}
.table tr.end td:last-child {
  color: var(--state-warn);
  font-weight: 600;
}
.table tr.focused {
  background: color-mix(in srgb, var(--state-warn) 12%, transparent);
}
.setting {
  padding: 10px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
}
.setting p {
  margin: 6px 0;
}
.setting ul {
  margin: 6px 0 10px;
  padding-left: 16px;
}
</style>

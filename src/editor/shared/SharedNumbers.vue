<script setup lang="ts">
// The Shared prototype's numbers: what happened on each link, stage by stage, for a link anyone
// can open; for links given to specific people, one row per person with the days it played and
// the newest version they opened. Only what the level lets den-kit count shows; one line says
// what really happened in the made-up story that the level hides.
import { computed } from 'vue';
import {
  STAGES,
  counted,
  linkRows,
  personRows,
  tally,
  truth,
  type Level,
  type StageId,
  type Story,
} from './after-sharing.ts';

const props = defineProps<{ story: Story; level: Level; focus: readonly string[] }>();
const SHORT: Record<StageId, string> = {
  previews: 'Previews by apps',
  opened: 'Opened',
  played: 'Pressed play',
  listened: '30 s or more',
  moved: 'Moved a control',
  passed: 'Passed on',
  sent: 'Sent back',
};
const totals = computed(() => tally(props.story, new Set(props.story.links.map(l => l.id))));
const rows = computed(() => linkRows(props.story));
const people = computed(() => personRows(props.story));
const truthLine = computed(() => truth(props.story, props.level));
const most = computed(() => Math.max(1, totals.value.previews.count, totals.value.opened.count));
const width = (n: number) => `${(100 * n) / most.value}%`;
const nameOf = (id: string) => props.story.links.find(l => l.id === id)?.name ?? id;
/** The stages a browser can be counted in: visits, not apps' previews, links made or things sent. */
const BY_BROWSER: readonly StageId[] = ['opened', 'played', 'listened', 'moved'];
const browsers = (stage: StageId) => props.level === 'browsers' && BY_BROWSER.includes(stage);
const share = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '');
function ratio(t: Record<StageId, { count: number }>, stage: StageId) {
  if (stage === 'played') return share(t.played.count, t.opened.count);
  if (stage === 'listened') return share(t.listened.count, t.played.count);
  return '';
}
const sent = computed(() => {
  const kinds = { setting: 0, note: 0, remix: 0 };
  for (const r of props.story.returns) kinds[r.kind]++;
  return `${counted(kinds.setting, 'setting')}, ${counted(kinds.note, 'note')} and ${counted(kinds.remix, 'remix', 'remixes')}`;
});
const on = (id: string) => props.focus.includes(id);
</script>

<template>
  <section class="numbers" data-testid="shared-numbers">
    <div v-if="level === 'returns'" class="nothing" data-testid="shared-numbers-none">
      <h3>Nothing is counted</h3>
      <p>
        At this level den-kit counts nothing on the links. What reaches you is only what people send
        back: {{ sent }}.
      </p>
    </div>
    <template v-else-if="story.scene === 'public'">
      <h3>All links, {{ story.days }} days</h3>
      <ol class="funnel" data-testid="shared-funnel">
        <li
          v-for="s in STAGES"
          :key="s.id"
          :class="{ machine: s.machine, focused: on(s.id) }"
          :data-stage="s.id"
          :title="
            s.machine
              ? 'Chat apps and mail checks fetch the page to draw a preview of the link. They are not people.'
              : browsers(s.id)
                ? `${totals[s.id].count} in ${counted(totals[s.id].browsers, 'browser')}`
                : ''
          "
        >
          <span class="name">{{ s.name }}</span>
          <span class="track"
            ><span class="fill" :style="{ width: width(totals[s.id].count) }"
          /></span>
          <span class="count">{{ totals[s.id].count }}</span>
          <span class="sub">{{
            s.machine
              ? 'apps, not people'
              : browsers(s.id)
                ? counted(totals[s.id].browsers, 'browser')
                : ''
          }}</span>
        </li>
      </ol>
      <h3>Each link</h3>
      <table class="table" data-testid="shared-links">
        <thead>
          <tr>
            <th>Link</th>
            <th v-for="s in STAGES" :key="s.id" :class="{ focused: on(s.id) }">
              {{ SHORT[s.id] }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.link.id" :data-link="r.link.id">
            <th :style="{ paddingLeft: `${8 + r.depth * 18}px` }">
              <span class="as-written">{{ r.link.name }}</span>
              <span v-if="r.link.from" class="from">
                made from <span class="as-written">{{ nameOf(r.link.from) }}</span>
              </span>
            </th>
            <td v-for="s in STAGES" :key="s.id" :class="{ focused: on(s.id) }">
              {{ r.tally[s.id].count }}
              <small v-if="ratio(r.tally, s.id)">{{ ratio(r.tally, s.id) }}</small>
              <small v-if="browsers(s.id)">{{ counted(r.tally[s.id].browsers, 'browser') }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-else>
      <h3>Each person you gave a link to, {{ story.days }} days</h3>
      <table class="table" data-testid="shared-people">
        <thead>
          <tr>
            <th>Link</th>
            <th :class="{ focused: on('previews') }">Previews by apps</th>
            <th :class="{ focused: on('opened') }">First opened</th>
            <th :class="{ focused: on('played') }">Pressed play</th>
            <th :class="{ focused: on('days') }">Days it played</th>
            <th :class="{ focused: on('version') }">Newest version opened</th>
            <th>Sent back</th>
            <th v-if="level === 'browsers'" :class="{ focused: on('browsers') }">Browsers</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in people" :key="r.link.id" :data-link="r.link.id">
            <th>
              <span class="as-written">{{ r.link.name }}</span>
            </th>
            <td :class="{ focused: on('previews') }">{{ r.link.previews }}</td>
            <td :class="{ focused: on('opened') }">
              {{ r.firstOpen === null ? 'Not opened' : `Day ${r.firstOpen + 1}` }}
            </td>
            <td :class="{ focused: on('played') }">{{ r.plays }}</td>
            <td :class="{ focused: on('days') }">
              <span class="days" :aria-label="`Played on ${r.days.filter(n => n).length} days`">
                <i
                  v-for="(n, day) in r.days"
                  :key="day"
                  :class="{ played: n > 0, update: story.update?.day === day }"
                  :title="`Day ${day + 1}: ${counted(n, 'press', 'presses')} of play${story.update?.day === day ? ' (new version given)' : ''}`"
                />
              </span>
            </td>
            <td :class="{ focused: on('version') }">
              <template v-if="r.version === null">—</template>
              <template v-else>
                v{{ r.version }}
                <small v-if="story.update && r.version < story.update.version"
                  >not the newest</small
                >
              </template>
            </td>
            <td>{{ r.sent }}</td>
            <td
              v-if="level === 'browsers'"
              :class="{ focused: on('browsers'), warn: r.browsers > 1 }"
            >
              {{ r.browsers }}
              <small v-if="r.browsers > 1">given to one person</small>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="story.update" class="legend">
        <span class="days"><i class="played" /></span> played that day
        <span class="days"><i class="update" /></span> the day you gave version
        {{ story.update.version }}
      </p>
    </template>
    <p class="truth" data-testid="shared-truth">{{ truthLine }}</p>
  </section>
</template>

<style scoped>
.numbers {
  padding: 14px 18px 24px;
  max-width: 1100px;
}
h3 {
  margin: 6px 0 10px;
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
.nothing {
  max-width: 560px;
  padding: 14px 16px;
  background: var(--app-card);
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-panel);
}
.nothing p {
  margin: 0;
  line-height: 1.5;
}
.funnel {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  gap: 4px;
  max-width: 760px;
}
.funnel li {
  display: grid;
  grid-template-columns: 170px 1fr 52px 120px;
  align-items: center;
  gap: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-control);
}
.funnel .name {
  font-size: 13px;
}
.track {
  height: 10px;
  border-bottom: 1px solid var(--line-subtle);
}
.fill {
  display: block;
  height: 100%;
  min-width: 2px;
  background: var(--accent);
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}
.machine .fill {
  background: repeating-linear-gradient(135deg, var(--text-muted) 0 2px, transparent 2px 5px);
}
.machine .name {
  color: var(--text-muted);
}
.count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.sub,
small {
  font-size: 11.5px;
  color: var(--text-muted);
}
.table {
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.table th,
.table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line-subtle);
  text-align: right;
  vertical-align: top;
}
.table thead th {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-muted);
  vertical-align: bottom;
}
.table th:first-child {
  text-align: left;
  font-weight: 600;
}
.table td small {
  display: block;
  white-space: nowrap;
}
.table tbody th {
  white-space: nowrap;
}
.from {
  display: block;
  font-weight: 400;
  font-size: 11.5px;
  color: var(--text-muted);
}
.focused {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.warn {
  color: var(--state-warn);
}
.days {
  display: inline-flex;
  gap: 2px;
  vertical-align: middle;
}
.days i {
  width: 9px;
  height: 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-control);
}
.days i.played {
  background: var(--accent);
  border-color: var(--accent);
}
.days i.update {
  box-shadow: -3px 0 0 -1px var(--text-primary);
}
.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.legend .days {
  margin-left: 8px;
}
.truth {
  max-width: 640px;
  margin-top: 16px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-muted);
}
</style>

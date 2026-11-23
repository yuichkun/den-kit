// The page of counts (docs/usage-receiver.md, Read the counts): what the counts are for, drawn from
// the tables the daily run writes (store.ts), for the people Cloudflare Access lets in (access.ts).
// The Worker answers GET / with it. It shows fixed views and changes nothing; the page has no
// script. Days are UTC, and a week starts on Monday.
import { admitted, fetchKeys, type FetchKeys } from './access.ts';
import {
  barList,
  esc,
  formatCount,
  formatShare,
  lineChart,
  meterList,
  shortDay,
  table,
  tiles,
  type Series,
} from './charts.ts';
import { addDays, dayOf } from './days.ts';
import type { Env } from './receive.ts';
import { DAILY_RECORDS, type D1Database } from './store.ts';

export interface DashboardEnv extends Env {
  /** The Access team's address, https://<team>.cloudflareaccess.com (wrangler.jsonc). */
  TEAM_DOMAIN?: string;
  /** The audience (AUD) tag of the Access application in front of the page (wrangler.jsonc). */
  POLICY_AUD?: string;
}

/** Days in the daily charts, weeks in the weekly charts and in the retention table. */
const DAYS = 90;
const WEEKS = 26;
const COHORT_WEEKS = 12;
/** Weeks of new installs whose first week the first-week bars count. */
const FIRST_WEEKS = 4;
/** Days of records taken, today's included. */
const INTAKE_DAYS = 7;
/** Days the feature notes sum up. */
const RECENT_DAYS = 28;
/** Versions and operating systems drawn on their own line; the rest are "Other". */
const VERSIONS = 5;
const SYSTEMS = 4;

/** How far new installs get, in this order. */
const STEPS = [
  ['app_used', 'Opened den-kit'],
  ['sound_played', 'Played a sound'],
  ['work_edited', 'Changed a work'],
  ['ai_requested', 'Asked the AI'],
  ['work_exported', 'Exported a work'],
] as const;
const FEATURES = [
  ['ai_requested', 'AI requests'],
  ['code_part_added', 'Code parts added'],
  ['work_exported', 'Exports'],
] as const;
const RETURNS = [1, 7, 30] as const;

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/**
 * Answers a request for the page at `now`: 404 while Access is not set up in wrangler.jsonc, 403
 * without a token Access signed for the page, and 503 when the keys or the counts cannot be read.
 */
export async function dashboard(
  request: Request,
  env: DashboardEnv,
  now: Date,
  keys: FetchKeys = fetchKeys,
): Promise<Response> {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return reply(404);
  if (request.method !== 'GET') return reply(405, { allow: 'GET' });
  try {
    const access = { team: env.TEAM_DOMAIN, aud: env.POLICY_AUD };
    if (!(await admitted(request, access, now, keys))) return reply(403);
    return new Response(page(await load(env.DB, dayOf(now))), { headers: HEADERS });
  } catch {
    return reply(503);
  }
}

function reply(status: number, headers?: Record<string, string>) {
  return new Response(null, { status, headers });
}

interface Active {
  start: string;
  dimension: string;
  value: string;
  installs: number;
}
interface Counts {
  today: string;
  /** The last day counted: yesterday. */
  to: string;
  daily: Active[];
  weekly: Active[];
  events: Array<{ day: string; event: string; events: number; installs: number }>;
  cohorts: Array<{ day: string; metric: string; installs: number }>;
  intake: Array<{ day: string; records: number; skipped: number }>;
}

/** The Monday of the week of `day`. */
const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
/** The Monday of the last week whose days have all passed by the end of `day`. */
const lastFullWeek = (day: string) => addDays(monday(addDays(day, 1)), -7);
/** The days from `first` to `last`, every `step` days. */
function range(first: string, last: string, step = 1): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, step)) days.push(day);
  return days;
}

async function load(db: D1Database, today: string): Promise<Counts> {
  const to = addDays(today, -1);
  const week = lastFullWeek(to);
  const [daily, weekly, events, cohorts, intake] = await db.batch([
    db
      .prepare(
        `SELECT start, dimension, value, installs FROM active
         WHERE period = 'day' AND start BETWEEN ?1 AND ?2 AND dimension IN ('all', 'version')`,
      )
      .bind(addDays(to, 1 - DAYS), to),
    db
      .prepare(
        `SELECT start, dimension, value, installs FROM active
         WHERE period = 'week' AND start BETWEEN ?1 AND ?2 AND dimension IN ('all', 'os')`,
      )
      .bind(addDays(week, -7 * (WEEKS - 1)), week),
    db
      .prepare('SELECT day, event, events, installs FROM event_counts WHERE day BETWEEN ?1 AND ?2')
      .bind(addDays(to, 1 - DAYS), to),
    db
      .prepare('SELECT day, metric, installs FROM cohorts WHERE day BETWEEN ?1 AND ?2')
      .bind(addDays(week, -7 * (COHORT_WEEKS - 1)), addDays(week, 6)),
    db
      .prepare('SELECT day, records, skipped FROM intake WHERE day BETWEEN ?1 AND ?2')
      .bind(addDays(today, 1 - INTAKE_DAYS), today),
  ]);
  return {
    today,
    to,
    daily: daily.results as unknown as Active[],
    weekly: weekly.results as unknown as Active[],
    events: events.results as unknown as Counts['events'],
    cohorts: cohorts.results as unknown as Counts['cohorts'],
    intake: intake.results as unknown as Counts['intake'],
  };
}

/** The installs of each value of a dimension on each day: by[day][value]. */
function byDay(rows: Active[], dimension: string) {
  const by = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.dimension !== dimension) continue;
    if (!by.has(row.start)) by.set(row.start, new Map());
    by.get(row.start)!.set(row.value, row.installs);
  }
  return by;
}

const newest = new Intl.Collator('en', { numeric: true });

/**
 * A line for each of the `most` values with the most installs on the last day that has any, and
 * one for the rest: the installs on each of the other values the daily run keeps, added up, since
 * an install that updates counts on each of its values; as shares of all installs when `shares`.
 * Lines take the palette's colors in the order of their values, newest first, so the newest
 * version is always the first color.
 */
function breakdown(
  rows: Active[],
  dimension: string,
  days: string[],
  most: number,
  shares: boolean,
): Series[] {
  const all = byDay(rows, 'all');
  const by = byDay(rows, dimension);
  const last = days.findLast(day => by.get(day)?.size);
  if (!last) return [];
  const chosen = [...by.get(last)!]
    .sort((a, b) => b[1] - a[1] || newest.compare(a[0], b[0]))
    .slice(0, most)
    .map(([value]) => value)
    .sort((a, b) => newest.compare(b, a));
  const value = (day: string, installs: number) => {
    const total = all.get(day)?.get('') ?? 0;
    if (!total) return null;
    return shares ? installs / total : installs;
  };
  const series: Series[] = chosen.map((name, i) => ({
    name,
    slot: i + 1,
    values: days.map(day => value(day, by.get(day)?.get(name) ?? 0)),
  }));
  const other = days.map(day =>
    value(
      day,
      [...(by.get(day) ?? [])].reduce(
        (sum, [name, installs]) => (chosen.includes(name) ? sum : sum + installs),
        0,
      ),
    ),
  );
  if (other.some(v => v)) series.push({ name: 'Other', slot: 0, values: other });
  return series;
}

function page(c: Counts): string {
  const { to } = c;
  const all = byDay(c.daily, 'all');
  const firstDay = [...all.keys()].sort()[0];
  const days = firstDay ? range(firstDay, to) : [];
  const allWeekly = byDay(c.weekly, 'all');
  const week = lastFullWeek(to);
  const firstWeek = [...allWeekly.keys()].sort()[0];
  const weeks = firstWeek ? range(firstWeek, week, 7) : [];
  const active = (day: string) => all.get(day)?.get('') ?? 0;

  // Cohorts: the new installs of each day, and how many came back or did each step.
  const cohort = new Map<string, Map<string, number>>();
  for (const row of c.cohorts) {
    if (!cohort.has(row.day)) cohort.set(row.day, new Map());
    cohort.get(row.day)!.set(row.metric, row.installs);
  }
  const sum = (first: string, last: string, metric: string) =>
    range(first, last).reduce((n, day) => n + (cohort.get(day)?.get(metric) ?? 0), 0);
  /** The share of a week's new installs with `metric`, once its last day has passed for all of them. */
  const rate = (start: string, metric: string, after: number) => {
    const installs = sum(start, addDays(start, 6), 'installs');
    if (!installs || addDays(start, 6 + after) > to) return null;
    return {
      part: sum(start, addDays(start, 6), metric) / installs,
      count: sum(start, addDays(start, 6), metric),
    };
  };
  const cohortWeeks = range(addDays(week, -7 * (COHORT_WEEKS - 1)), week, 7).reverse();

  const day7Week = lastFullWeek(addDays(to, -7));
  const day7 = rate(day7Week, 'day_7', 7);
  const summary = tiles([
    {
      label: 'Active installs',
      value: days.length ? formatCount(active(to)) : '—',
      note: `on ${shortDay(to)}`,
    },
    {
      label: 'Active installs',
      value: weeks.length ? formatCount(allWeekly.get(week)?.get('') ?? 0) : '—',
      note: `week of ${shortDay(week)}`,
    },
    {
      label: 'New installs',
      value: cohort.size ? formatCount(sum(week, addDays(week, 6), 'installs')) : '—',
      note: `week of ${shortDay(week)}`,
    },
    {
      label: 'Back on day 7',
      value: day7 ? formatShare(day7.part) : '—',
      note: `of new installs in the week of ${shortDay(day7Week)}`,
    },
  ]);

  const retention = table(
    ['Week of', 'New installs', ...RETURNS.map(n => `Day ${n}`)],
    cohortWeeks.map(start => [
      start,
      formatCount(sum(start, addDays(start, 6), 'installs')),
      ...RETURNS.map(n => {
        const r = rate(start, `day_${n}`, n);
        return r ? `${formatShare(r.part)} (${formatCount(r.count)})` : '—';
      }),
    ]),
  );

  // First week: new installs whose first 7 days have all passed, over FIRST_WEEKS weeks.
  const firstWeekEnd = addDays(lastFullWeek(addDays(to, -6)), 6);
  const firstWeekStart = addDays(firstWeekEnd, 1 - 7 * FIRST_WEEKS);
  const started = sum(firstWeekStart, firstWeekEnd, 'installs');
  const steps = barList(
    `Of ${formatCount(started)} installs new from ${shortDay(firstWeekStart)} to ${shortDay(firstWeekEnd)}, the share that did each in their first 7 days`,
    STEPS.map(([event, name]) => ({
      name,
      value: sum(firstWeekStart, firstWeekEnd, event),
      of: started,
    })),
  );

  const recent = days.slice(-RECENT_DAYS);
  const features = FEATURES.map(([event, name]) => {
    const rows = new Map(c.events.filter(e => e.event === event).map(e => [e.day, e]));
    const used = recent.reduce((n, day) => n + (rows.get(day)?.installs ?? 0), 0);
    const seen = recent.reduce((n, day) => n + active(day), 0);
    const total = recent.reduce((n, day) => n + (rows.get(day)?.events ?? 0), 0);
    const note = recent.length
      ? `Last ${recent.length} days: ${formatCount(total)}, from ${formatCount(Math.round(used / recent.length))} installs a day on average${seen ? ` (${formatShare(used / seen)} of active installs)` : ''}.`
      : '';
    return (
      lineChart({
        title: `${name} each day`,
        days,
        narrow: true,
        series: [{ name, slot: 1, values: days.map(day => rows.get(day)?.events ?? 0) }],
      }) + (note ? `<p class="note">${esc(note)}</p>` : '')
    );
  });

  const intake = new Map(c.intake.map(row => [row.day, row]));
  const records = meterList(
    `Records received each day, of the ${formatCount(DAILY_RECORDS)} a day the receiver takes`,
    range(addDays(c.today, 1 - INTAKE_DAYS), c.today)
      .reverse()
      .map(day => {
        const row = intake.get(day);
        return {
          name: day === c.today ? `${day} (today)` : day,
          value: (row?.records ?? 0) + (row?.skipped ?? 0),
          limit: DAILY_RECORDS,
          note: `${formatCount(row?.skipped ?? 0)} skipped`,
        };
      }),
  );

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>den-kit usage</title><style>${STYLE}</style></head><body><main>
<header><h1>den-kit usage</h1><p>Counts of the usage data people allow den-kit to send, up to ${esc(shortDay(to))}. Days are UTC; the receiver counts each day shortly after it ends. <a href="https://github.com/yuichkun/den-kit/blob/main/docs/usage-receiver.md">What each count means</a>.</p></header>
${summary}
<section><h2>Active installs</h2><div class="grid">${lineChart({
    title: 'Active installs each day',
    days,
    series: [{ name: 'Active installs', slot: 1, values: days.map(active) }],
  })}${lineChart({
    title: 'Active installs each week',
    days: weeks,
    weekly: true,
    series: [
      {
        name: 'Active installs',
        slot: 1,
        values: weeks.map(start => allWeekly.get(start)?.get('') ?? 0),
      },
    ],
  })}</div></section>
<section><h2>Versions and operating systems</h2><div class="grid">${lineChart({
    title: 'Share of active installs on each version, each day',
    days,
    series: breakdown(c.daily, 'version', days, VERSIONS, true),
    shares: true,
  })}${lineChart({
    title: 'Active installs on each operating system, each week',
    days: weeks,
    weekly: true,
    series: breakdown(c.weekly, 'os', weeks, SYSTEMS, false),
  })}</div><p class="note">Each chart draws the versions or operating systems with the most installs on its last day; the rest are Other. An install that updates during a day or week counts on both versions.</p></section>
<section><h2>Retention</h2><figure><figcaption>New installs each week, and the share that sent an event on day 1, 7 and 30 after their first</figcaption>${retention}</figure></section>
<section><h2>First week</h2>${steps}</section>
<section><h2>Features</h2><div class="grid three">${features.map(f => `<div>${f}</div>`).join('')}</div></section>
<section><h2>Records received</h2>${records}</section>
</main></body></html>`;
}

// The palette is the dataviz reference instance, checked with its validator in both modes; three
// light slots are under 3:1 on the surface, so every line has a label and a table.
const STYLE = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.1);--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--other:#898781;--track:#cde2fb}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.1);--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--track:#0d366b}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:32px 0 12px}
header p{margin:0;color:var(--ink-2);max-width:72ch}
a{color:inherit}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:20px}
.tile,figure{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin:0}
.tile .label{color:var(--ink-2)}
.tile .value{font-size:28px;font-weight:600;margin:2px 0}
.note{color:var(--muted);font-size:12px;margin:8px 0 0}
.tile .note{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px}
.grid.three{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
figcaption{font-weight:600;margin-bottom:8px}
svg{display:block;width:100%;height:auto}
svg .grid{stroke:var(--grid);stroke-width:1}
svg .axis{stroke:var(--axis);stroke-width:1}
svg .tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
svg .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
svg .area{opacity:.1}
svg .dot{stroke:var(--surface);stroke-width:2}
svg .end{fill:var(--ink-2);font-size:12px}
svg .leader{stroke:var(--axis);stroke-width:1}
svg .hit{fill:transparent;pointer-events:all}
svg .hover{visibility:hidden;pointer-events:none}
svg .col:hover .hover{visibility:visible}
svg .cross{stroke:var(--axis);stroke-width:1}
svg .tip{fill:var(--surface);stroke:var(--axis);stroke-width:1}
svg .hover text{font-size:12px}
svg .value{fill:var(--ink);font-weight:600}
svg .name{fill:var(--ink-2)}
.key{stroke-width:2;stroke-linecap:round}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;margin:0 0 8px;padding:0;color:var(--ink-2);font-size:12px}
.legend li{display:flex;align-items:center;gap:6px;white-space:nowrap}
details{margin-top:8px;font-size:12px;color:var(--ink-2)}
summary{cursor:pointer}
.scroll{overflow-x:auto}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%}
details table{margin-top:8px}
th,td{text-align:right;padding:4px 8px;border-bottom:1px solid var(--grid);font-weight:400;white-space:nowrap}
th:first-child{text-align:left}
thead th{color:var(--muted)}
.bars,.meters{list-style:none;margin:0;padding:0;display:grid;gap:10px 12px;grid-template-columns:minmax(110px,max-content) 1fr}
.meters{grid-template-columns:minmax(110px,max-content) 1fr max-content}
.bars li,.meters li{display:grid;grid-column:1/-1;grid-template-columns:subgrid;align-items:center;row-gap:4px}
@media (max-width:560px){.bars{grid-template-columns:1fr}.meters{grid-template-columns:1fr max-content}.bars li>.label,.meters li>.label{grid-column:1/-1}}
.label{color:var(--ink-2)}
.track{display:flex;align-items:center;gap:8px;min-width:0}
.bar{flex:none;height:14px;width:calc((100% - 8.5em) * var(--part));background:var(--s1);border-radius:0 4px 4px 0}
.figure{white-space:nowrap;color:var(--ink-2);font-variant-numeric:tabular-nums}
.meters .figure{text-align:right}
.meter{height:8px;background:var(--track);border-radius:4px;overflow:hidden}
.meter span{display:block;height:100%;width:calc(100% * var(--part));background:var(--s1);border-radius:4px}
.empty{color:var(--muted);margin:0}
`;

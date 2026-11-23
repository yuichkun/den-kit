// A prototype, not a feature: what an author could learn after sharing a work, so the team can
// compare ways of showing it by touch. Every number and message is made up from the open work's
// own controls, the same each time for the same work. Nothing is collected, kept or sent.
//
// One made-up story per way of sharing (a link anyone can open, or links given to specific
// people) holds everything that "happened", including who each visitor was. What the author sees
// is cut from it by how much den-kit would learn: only what people send back from the page,
// counts per link (one person cannot be told from another), or browsers told apart (a random ID
// kept in each browser). The decisions say, for each next decision of the author, whether the
// view and the amount chosen answer it.
import type { WidgetSpec } from '../../screen/spec.ts';
import type { Intent } from '../../work/ops.ts';
import type { PatchDocument } from '../../work/schema.ts';

export type Scene = 'public' | 'people';
export type Level = 'returns' | 'links' | 'browsers';
export type Lens = 'numbers' | 'returns' | 'plugin';
type Values = Record<string, number | boolean>;

export const SCENES: ReadonlyArray<{ id: Scene; name: string }> = [
  { id: 'public', name: 'Shared with anyone' },
  { id: 'people', name: 'Given to specific people' },
];
export const LEVELS: ReadonlyArray<{ id: Level; name: string; keeps: string }> = [
  {
    id: 'returns',
    name: 'Only what people send',
    keeps:
      'den-kit keeps only what a person chooses to send back from the page: a setting, a note or a remix. It counts nothing.',
  },
  {
    id: 'links',
    name: 'Counts per link',
    keeps:
      'den-kit also counts what happens on each link: previews drawn by apps, opens, presses of play, how long it played and which controls moved. It cannot tell one person from another.',
  },
  {
    id: 'browsers',
    name: 'Tells browsers apart',
    keeps:
      'den-kit also keeps a random ID in each browser that opens the page, so it can tell browsers apart and see one come back. One person on two devices is two browsers.',
  },
];
export const LENSES: ReadonlyArray<{ id: Lens; name: string }> = [
  { id: 'numbers', name: 'Numbers' },
  { id: 'returns', name: 'Sent back' },
  { id: 'plugin', name: 'On the plugin' },
];
const rank = (level: Level) => LEVELS.findIndex(l => l.id === level);
/** “1 browser”, “3 browsers”. */
export const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const lensName = (lens: Lens) => LENSES.find(l => l.id === lens)!.name;
export const levelName = (level: Level) => LEVELS.find(l => l.id === level)!.name;

// ---- the controls the story moves -----------------------------------------------------------

/** A control on the plugin that people can leave somewhere: a knob or slider, a toggle, an XY pad. */
export interface StoryControl {
  id: string;
  label: string;
  kind: 'range' | 'toggle' | 'xy';
  min: number;
  max: number;
  log: boolean;
  unit: string;
}

/** The controls on the plugin (not the ones only in the patch), in patch order. */
export function storyControls(widgets: readonly WidgetSpec[]): StoryControl[] {
  return widgets.flatMap((w): StoryControl[] => {
    if (!w.rect) return [];
    const base = { id: w.id, label: w.label, min: 0, max: 1, log: false, unit: '' };
    if (w.type === 'ui.knob' || w.type === 'ui.slider') {
      const min = Number(w.config.min ?? 0),
        max = Number(w.config.max ?? 1);
      if (!(max > min)) return [];
      const log = w.config.scale === 'log' && min > 0;
      return [{ ...base, kind: 'range', min, max, log, unit: String(w.config.unit ?? '') }];
    }
    if (w.type === 'ui.toggle') return [{ ...base, kind: 'toggle' }];
    if (w.type === 'ui.xy') return [{ ...base, kind: 'xy' }];
    return [];
  });
}

/** Where a value sits along a range control, from 0 to 1 (by ratio on a log control). */
export function position(c: StoryControl, value: number): number {
  const v = Math.min(c.max, Math.max(c.min, value));
  return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) : (v - c.min) / (c.max - c.min);
}
/** A value rounded to about three digits of its range (on a log range, of the value itself). */
function rounded(c: StoryControl, v: number): number {
  const step = c.log ? v : c.max - c.min;
  const digits = Math.min(6, Math.max(0, 3 - Math.ceil(Math.log10(Math.abs(step) || 1))));
  return Number(v.toFixed(digits));
}
/** The value at a place along a range control. */
export function valueAt(c: StoryControl, at: number): number {
  const t = Math.min(1, Math.max(0, at));
  return rounded(c, c.log ? c.min * (c.max / c.min) ** t : c.min + t * (c.max - c.min));
}
/** A value as the person reads it: on or off, x and y, or the number and its unit. */
export function valueText(c: StoryControl, values: Values): string {
  if (c.kind === 'toggle') return values.value ? 'on' : 'off';
  if (c.kind === 'xy') return `x ${Number(values.x).toFixed(2)}, y ${Number(values.y).toFixed(2)}`;
  const unit = c.unit && c.unit !== 'mix' && c.unit !== 'gain' ? ` ${c.unit}` : '';
  return `${rounded(c, Number(values.value))}${unit}`;
}

// ---- the made-up story ----------------------------------------------------------------------

export interface StoryLink {
  id: string;
  /** What the author called it: where they posted it, or who they gave it to. */
  name: string;
  /** For a link someone made from another one to pass the work on: that link, and who made it. */
  from?: string;
  by?: { person: number; browser: number };
  /** How many times apps fetched the page to draw a preview of the link (chat apps, mail checks). */
  previews: number;
}
export interface Visit {
  link: string;
  /** Who it was and in which browser: the story's truth, which den-kit never holds as such. */
  person: number;
  browser: number;
  day: number;
  /** Pressed play: the page plays nothing before. */
  played: boolean;
  seconds: number;
  /** The controls the visit moved, and where it left them. */
  left: Record<string, Values>;
  /** The version of the work the link gave that day (a link always gives the newest). */
  version: number;
}
export interface Returned {
  id: string;
  kind: 'setting' | 'note' | 'remix';
  link: string;
  person: number;
  day: number;
  /** What the person called it and what they wrote, shown as written. */
  title: string;
  text: string;
  /** A setting: the controls it holds and their values. */
  values?: Record<string, Values>;
}
export interface Story {
  scene: Scene;
  days: number;
  /** A new version of the work, given from this day on. */
  update: { day: number; version: number } | null;
  links: StoryLink[];
  visits: Visit[];
  returns: Returned[];
}

/** The same numbers for the same seed (mulberry32 over an FNV-1a hash). */
function randomFrom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where people like each control: a place along it and how far they stray; the first range control is left at its top. */
type Taste = Record<string, { at: number; spread: number; on: number }>;
function tastes(rand: () => number, controls: readonly StoryControl[]): Taste {
  const top = controls.find(c => c.kind === 'range')?.id;
  return Object.fromEntries(
    controls.map(c => [
      c.id,
      c.id === top
        ? { at: 0.97, spread: 0.08, on: 0.5 }
        : { at: 0.25 + rand() * 0.5, spread: 0.06 + rand() * 0.08, on: 0.3 + rand() * 0.5 },
    ]),
  );
}
const near = (rand: () => number, at: number, spread: number) =>
  Math.min(1, Math.max(0, at + (rand() + rand() + rand() - 1.5) * spread * 1.6));
function leave(rand: () => number, c: StoryControl, taste: Taste): Values {
  const t = taste[c.id]!;
  if (c.kind === 'toggle') return { value: rand() < t.on };
  if (c.kind === 'xy') {
    const x = near(rand, t.at, t.spread),
      y = near(rand, 1 - t.at, t.spread);
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  }
  return { value: valueAt(c, near(rand, t.at, t.spread)) };
}
/** Some controls moved on one visit: the first ones on the plugin more often. */
function moveSome(
  rand: () => number,
  controls: readonly StoryControl[],
  taste: Taste,
): Record<string, Values> {
  const left: Record<string, Values> = {};
  const count = 1 + Math.floor(rand() * Math.min(3, controls.length));
  for (let i = 0; i < count; i++) {
    const c = controls[Math.floor(rand() ** 1.6 * controls.length)]!;
    left[c.id] = leave(rand, c, taste);
  }
  return left;
}
const later = (rand: () => number, scale: number) => Math.floor(-Math.log(1 - rand()) * scale);

/** The story of a work after it was shared, made up from its controls. */
export function makeStory(scene: Scene, seed: string, controls: readonly StoryControl[]): Story {
  const rand = randomFrom(`${scene}:${seed}:${controls.map(c => c.id).join(',')}`);
  return scene === 'public' ? publicStory(rand, controls) : peopleStory(rand, controls);
}

const SETTING_NAMES = ['Darker', 'Long tail', 'Tight', 'Slow bloom', 'Night drive', 'Wide'];
const SETTING_TEXTS = [
  'Great on a Rhodes.',
  'My go-to for slow songs.',
  '',
  'Works on drums too.',
  'Ended up here after an hour.',
  '',
];

function publicStory(rand: () => number, controls: readonly StoryControl[]): Story {
  const days = 14;
  const taste = tastes(rand, controls);
  const links: StoryLink[] = [
    { id: 'social', name: 'Social post', previews: 38 + Math.floor(rand() * 14) },
    { id: 'forum', name: 'Forum thread', previews: 7 + Math.floor(rand() * 7) },
    { id: 'site', name: 'My site', previews: 2 + Math.floor(rand() * 3) },
  ];
  /** How likely someone who opens the page presses play, and how soon after sharing people come. */
  const press: Record<string, number> = { social: 0.42, forum: 0.72, site: 0.6, passed: 0.8 };
  const soon: Record<string, number> = { social: 1.4, forum: 3.2, site: 6, passed: 1.5 };
  const arrivals: Array<{ link: string; day: number }> = [];
  const from = (link: string) => (link.startsWith('passed') ? 'passed' : link);
  const arrive = (link: string, after: number) => {
    const day = after + later(rand, soon[from(link)]!);
    if (day < days) arrivals.push({ link, day });
  };
  const comers = 120 + Math.floor(rand() * 40);
  for (let i = 0; i < comers; i++) {
    const r = rand();
    arrive(r < 0.55 ? 'social' : r < 0.88 ? 'forum' : 'site', 0);
  }
  const visits: Visit[] = [];
  let person = 0,
    browser = 0;
  for (let k = 0; k < arrivals.length; k++) {
    const a = arrivals[k]!;
    const p = person++;
    const visitDays = [a.day];
    if (rand() < 0.24)
      for (let n = 1 + Math.floor(rand() * 2), d = a.day; n > 0; n--) {
        d += 1 + later(rand, 2.5);
        if (d < days) visitDays.push(d);
      }
    // Some who come back come on another device: another browser.
    const browsers = visitDays.length > 1 && rand() < 0.4 ? [browser++, browser++] : [browser++];
    visitDays.forEach((day, n) => {
      const played = rand() < (n > 0 ? 0.88 : press[from(a.link)]!);
      const seconds = played ? Math.round(4 + later(rand, 48)) : 0;
      const left =
        played && seconds > 12 && controls.length && rand() < 0.62
          ? moveSome(rand, controls, taste)
          : {};
      visits.push({
        link: a.link,
        person: p,
        browser: browsers[n % browsers.length]!,
        day,
        played,
        seconds,
        left,
        version: 1,
      });
    });
    const first = visits.find(v => v.person === p && v.day === a.day)!;
    const passed = links.filter(l => l.from).length;
    if (first.played && first.seconds > 20 && passed < 5 && rand() < 0.12) {
      const link: StoryLink = {
        id: `passed${passed + 1}`,
        name: 'A listener’s link',
        from: a.link,
        by: { person: p, browser: first.browser },
        previews: 2 + Math.floor(rand() * 9),
      };
      links.push(link);
      for (let n = 3 + Math.floor(rand() * 9); n > 0; n--) arrive(link.id, a.day);
    }
  }
  // What people sent back: settings from some who moved controls, two notes, one remix.
  const returns: Returned[] = [];
  const moved = visits.filter(v => Object.keys(v.left).length);
  const top = controls.find(c => c.kind === 'range');
  for (const v of moved) {
    if (returns.length >= 4) break;
    if (rand() > 0.07) continue;
    const n = returns.length;
    returns.push({
      id: `r${n + 1}`,
      kind: 'setting',
      link: v.link,
      person: v.person,
      day: v.day,
      title: SETTING_NAMES[n % SETTING_NAMES.length]!,
      text: SETTING_TEXTS[n % SETTING_TEXTS.length]!,
      values: v.left,
    });
  }
  const long = visits.filter(v => v.seconds > 60);
  const say = (kind: Returned['kind'], title: string, text: string, v?: Visit) => {
    if (v)
      returns.push({
        id: `r${returns.length + 1}`,
        kind,
        link: v.link,
        person: v.person,
        day: v.day,
        title,
        text,
      });
  };
  say(
    'note',
    'An hour on headphones',
    'Played it for an hour on headphones. It took me a while to find where it gets interesting.',
    long[Math.floor(rand() * long.length)],
  );
  if (top)
    say(
      'note',
      `${top.label} all the way up`,
      `I kept ${top.label} at the top the whole time. Could it go further?`,
      moved.find(v => v.left[top.id] && position(top, Number(v.left[top.id]!.value)) > 0.9),
    );
  const maker = links.find(l => l.by);
  say(
    'remix',
    'Two echoes',
    'Made my own version with a second echo. Thanks for the idea!',
    maker
      ? visits.find(v => v.person === maker.by!.person)
      : long[Math.floor(rand() * long.length)],
  );
  returns.sort((x, y) => x.day - y.day);
  return { scene: 'public', days, update: null, links, visits, returns };
}

function peopleStory(rand: () => number, controls: readonly StoryControl[]): Story {
  const days = 14;
  const update = { day: 6, version: 2 };
  const taste = tastes(rand, controls);
  const links: StoryLink[] = [
    { id: 'engineer', name: 'For the mix engineer', previews: 1 },
    { id: 'drummer', name: 'For the drummer', previews: 2 },
    { id: 'studio', name: 'For the game studio', previews: 2 },
  ];
  const visits: Visit[] = [];
  const visit = (link: string, person: number, browser: number, day: number, played: boolean) => {
    const seconds = played ? 30 + Math.floor(rand() * 600) : 0;
    const left = played && controls.length && rand() < 0.6 ? moveSome(rand, controls, taste) : {};
    const version = day >= update.day ? update.version : 1;
    visits.push({ link, person, browser, day, played, seconds, left, version });
  };
  // The mix engineer opens it at once and plays it on most days, the new version too.
  const start = Math.floor(rand() * 2);
  for (let day = start; day < days; day++)
    if (day === start || day === update.day + 2 || rand() < 0.5)
      for (let n = 1 + Math.floor(rand() * 2); n > 0; n--) visit('engineer', 0, 0, day, true);
  // The drummer plays it twice and passes the link on to two bandmates; nobody opens it after the new version.
  const d0 = 2 + Math.floor(rand() * 2);
  visit('drummer', 1, 1, d0, true);
  visit('drummer', 1, 1, d0 + 1, true);
  visit('drummer', 2, 2, d0 + 1, true);
  visit('drummer', 3, 3, d0 + 2, rand() < 0.7);
  // At the game studio, a mail check fetches the link and someone opens it once without pressing play.
  visit('studio', 4, 4, 4 + Math.floor(rand() * 5), false);
  const returns: Returned[] = [];
  const engineer = visits.filter(v => v.link === 'engineer');
  const setting = engineer.find(v => Object.keys(v.left).length);
  if (setting)
    returns.push({
      id: 'r1',
      kind: 'setting',
      link: 'engineer',
      person: 0,
      day: setting.day,
      title: 'Vocal bus',
      text: 'Where I ended up for the chorus.',
      values: setting.left,
    });
  const top = controls.find(c => c.kind === 'range');
  returns.push({
    id: `r${returns.length + 1}`,
    kind: 'note',
    link: 'engineer',
    person: 0,
    day: update.day + 2,
    title: 'Every day this week',
    text: top
      ? `Using it every day this week. Could ${top.label} go a bit further?`
      : 'Using it every day this week. Thank you!',
  });
  return { scene: 'people', days, update, links, visits, returns };
}

// ---- what the author sees, at each level ----------------------------------------------------

export const STAGES = [
  { id: 'previews', name: 'Previews drawn by apps', machine: true },
  { id: 'opened', name: 'Opened the page', machine: false },
  { id: 'played', name: 'Pressed play', machine: false },
  { id: 'listened', name: 'Played 30 s or more', machine: false },
  { id: 'moved', name: 'Moved a control', machine: false },
  { id: 'passed', name: 'Passed it on', machine: false },
  { id: 'sent', name: 'Sent something back', machine: false },
] as const;
export type StageId = (typeof STAGES)[number]['id'];
/** How often, in how many browsers, and by how many people (the story's truth). */
export interface Tally {
  count: number;
  browsers: number;
  people: number;
}

const distinct = <T>(items: readonly T[], key: (item: T) => number) => new Set(items.map(key)).size;
function tallyOf<T>(items: readonly T[], browser: (i: T) => number, person: (i: T) => number) {
  return {
    count: items.length,
    browsers: distinct(items, browser),
    people: distinct(items, person),
  };
}

/** What happened on some links, stage by stage. */
export function tally(story: Story, links: ReadonlySet<string>): Record<StageId, Tally> {
  const visits = story.visits.filter(v => links.has(v.link));
  const played = visits.filter(v => v.played);
  const made = story.links.filter(l => l.from && links.has(l.from) && l.by);
  const sent = story.returns.filter(r => links.has(r.link));
  const byVisit = (items: readonly Visit[]) =>
    tallyOf(
      items,
      v => v.browser,
      v => v.person,
    );
  return {
    previews: {
      count: story.links.filter(l => links.has(l.id)).reduce((n, l) => n + l.previews, 0),
      browsers: 0,
      people: 0,
    },
    opened: byVisit(visits),
    played: byVisit(played),
    listened: byVisit(played.filter(v => v.seconds >= 30)),
    moved: byVisit(played.filter(v => Object.keys(v.left).length)),
    passed: tallyOf(
      made,
      l => l.by!.browser,
      l => l.by!.person,
    ),
    sent: {
      count: sent.length,
      browsers: distinct(sent, r => r.person),
      people: distinct(sent, r => r.person),
    },
  };
}

/** The author's links in order, each followed by the links made from it to pass it on. */
export function linkRows(
  story: Story,
): Array<{ link: StoryLink; depth: number; tally: Record<StageId, Tally> }> {
  const rows: Array<{ link: StoryLink; depth: number; tally: Record<StageId, Tally> }> = [];
  const add = (link: StoryLink, depth: number) => {
    rows.push({ link, depth, tally: tally(story, new Set([link.id])) });
    for (const child of story.links.filter(l => l.from === link.id)) add(child, depth + 1);
  };
  for (const link of story.links.filter(l => !l.from)) add(link, 0);
  return rows;
}

/** Each link given to one person: when it was first opened, the days it played, the newest version opened. */
export interface PersonRow {
  link: StoryLink;
  firstOpen: number | null;
  opens: number;
  plays: number;
  /** Presses of play on each day. */
  days: number[];
  version: number | null;
  sent: number;
  browsers: number;
  people: number;
}
export function personRows(story: Story): PersonRow[] {
  return story.links
    .filter(l => !l.from)
    .map(link => {
      const visits = story.visits.filter(v => v.link === link.id);
      const days = Array.from({ length: story.days }, () => 0);
      for (const v of visits) if (v.played) days[v.day]!++;
      return {
        link,
        firstOpen: visits.length ? Math.min(...visits.map(v => v.day)) : null,
        opens: visits.length,
        plays: visits.filter(v => v.played).length,
        days,
        version: visits.length ? Math.max(...visits.map(v => v.version)) : null,
        sent: story.returns.filter(r => r.link === link.id).length,
        browsers: distinct(visits, v => v.browser),
        people: distinct(visits, v => v.person),
      };
    });
}

/** One line on what really happened in the story that the level hides. */
export function truth(story: Story, level: Level): string {
  const all = tally(story, new Set(story.links.map(l => l.id)));
  if (story.scene === 'public') {
    if (level === 'returns')
      return `In this made-up story, ${all.opened.people} people opened a link and ${all.played.people} pressed play. At this level den-kit knows none of it.`;
    if (level === 'links')
      return `In this made-up story, ${all.opened.people} people opened a link. Counting per link shows ${all.opened.count} opens: a person who comes back counts again.`;
    return `In this made-up story, ${all.opened.people} people used ${all.opened.browsers} browsers. Telling browsers apart shows ${all.opened.browsers}: a phone and a laptop are two.`;
  }
  const shared = personRows(story).find(r => r.people > 1);
  if (!shared) return '';
  if (level === 'returns')
    return `In this made-up story, “${shared.link.name}” was opened by ${shared.people} people. At this level den-kit knows none of it.`;
  if (level === 'links')
    return `In this made-up story, “${shared.link.name}” was opened by ${shared.people} people. Per link, that is ${shared.opens} opens: it looks the same as one person coming back.`;
  return `In this made-up story, “${shared.link.name}” was opened by ${shared.people} people in ${shared.browsers} browsers.`;
}

/** Where people left one control: along it in ten bins (toggles: off and on; XY pads: points). */
export interface Marks {
  control: StoryControl;
  /** Plays (or browsers) that moved it, out of the ones that pressed play. */
  moved: number;
  of: number;
  bins: number[];
  points: Array<[number, number]>;
  /** Most were left at one end of the range. */
  end: 'top' | 'bottom' | null;
}
export function plugInMarks(
  story: Story,
  controls: readonly StoryControl[],
  level: 'links' | 'browsers',
): Marks[] {
  const played = story.visits.filter(v => v.played);
  return controls.map(control => {
    let lefts = played.filter(v => v.left[control.id]);
    let of = played.length;
    if (level === 'browsers') {
      // A browser counts once, where it last left the control.
      const last = new Map<number, Visit>();
      for (const v of lefts) last.set(v.browser, v);
      lefts = [...last.values()];
      of = distinct(played, v => v.browser);
    }
    const values = lefts.map(v => v.left[control.id]!);
    const bins = Array.from({ length: control.kind === 'toggle' ? 2 : 10 }, () => 0);
    const points: Array<[number, number]> = [];
    for (const value of values) {
      if (control.kind === 'toggle') bins[value.value ? 1 : 0]!++;
      else if (control.kind === 'xy') points.push([Number(value.x), Number(value.y)]);
      else bins[Math.min(9, Math.floor(position(control, Number(value.value)) * 10))]!++;
    }
    const total = values.length;
    const end =
      control.kind !== 'range' || total < 5
        ? null
        : bins[9]! / total >= 0.3
          ? 'top'
          : bins[0]! / total >= 0.3
            ? 'bottom'
            : null;
    return { control, moved: total, of, bins, points, end };
  });
}

/** Where the settings people sent back leave each control. */
export function returnedMarks(
  story: Story,
  controls: readonly StoryControl[],
): Array<{
  control: StoryControl;
  settings: Array<{ id: string; title: string; values: Values }>;
}> {
  return controls.map(control => ({
    control,
    settings: story.returns
      .filter(r => r.values?.[control.id])
      .map(r => ({ id: r.id, title: r.title, values: r.values![control.id]! })),
  }));
}

/** A returned setting as edits of the author's work: one undo step, the controls it still has. */
export function settingIntents(doc: PatchDocument, returned: Returned): Intent[] {
  return Object.entries(returned.values ?? {}).flatMap(([node, values]) =>
    doc.nodes[node]
      ? Object.entries(values).map(([port, value]) => ({
          op: 'setValue' as const,
          node,
          port,
          value,
          clamp: true,
        }))
      : [],
  );
}

/** What the person did on the receiver's side, added to the story as one more visitor. */
export interface You {
  /** Previews the chat app drew of the link. */
  previews: number;
  /** One visit each time they opened the link, all in one browser. */
  visits: Visit[];
  returns: Returned[];
  passed: StoryLink | null;
}
export const YOU = -1;
export const nobody = (): You => ({ previews: 0, visits: [], returns: [], passed: null });
/** The link the receiver's side opens: the social post, or the one given to the mix engineer. */
export const receiverLink = (scene: Scene) => (scene === 'public' ? 'social' : 'engineer');
export function withYou(story: Story, you: You, link: string): Story {
  return {
    ...story,
    links: [
      ...story.links.map(l => (l.id === link ? { ...l, previews: l.previews + you.previews } : l)),
      ...(you.passed ? [you.passed] : []),
    ],
    visits: [...story.visits, ...you.visits],
    returns: [...story.returns, ...you.returns],
  };
}

// ---- the author's next decisions --------------------------------------------------------------

export interface Decision {
  id: string;
  scene: Scene;
  question: string;
  /** The edit or step the answer leads to. */
  next: string;
  /** The view that answers it, and the least den-kit has to learn for that. */
  lens: Lens;
  level: Level;
  /** What a lower level still tells (nothing when missing). */
  below?: Partial<Record<Level, string>>;
  /** What stays unsure even then. */
  caveat?: string;
  /** What the view highlights for it: stages, columns or controls. */
  focus: string[];
}
export const DECISIONS: readonly Decision[] = [
  {
    id: 'first-sound',
    scene: 'public',
    question: 'Does the sound it starts with keep people playing?',
    next: 'Change the sound it starts with',
    lens: 'numbers',
    level: 'links',
    below: {
      returns: 'Only the people who send something back say so, and they are the keen ones.',
    },
    caveat: 'Counts plays, not people: someone who comes back counts again.',
    focus: ['played', 'listened'],
  },
  {
    id: 'where',
    scene: 'public',
    question: 'Where did the people who played come from?',
    next: 'Choose where to post the next version',
    lens: 'numbers',
    level: 'links',
    below: { returns: 'A sent-back item says which link it came through. Nothing else does.' },
    focus: ['played'],
  },
  {
    id: 'page',
    scene: 'public',
    question: 'Does the page make people press play?',
    next: 'Change what shows before play',
    lens: 'numbers',
    level: 'links',
    caveat: 'Previews drawn by apps are counted apart: they are not people.',
    focus: ['previews', 'opened', 'played'],
  },
  {
    id: 'ranges',
    scene: 'public',
    question: 'Which controls do people move, and do their ranges fit?',
    next: 'Change a control’s range or where it starts',
    lens: 'plugin',
    level: 'links',
    below: { returns: 'Only where the people who sent a setting left the controls.' },
    focus: ['ends'],
  },
  {
    id: 'made',
    scene: 'public',
    question: 'What did people make from it?',
    next: 'Credit them, or build on their idea',
    lens: 'returns',
    level: 'returns',
    caveat:
      'Only what people chose to send. The links they made to pass it on show in Numbers when den-kit counts per link.',
    focus: ['remix', 'setting'],
  },
  {
    id: 'started',
    scene: 'people',
    question: 'Did each of them get it and start using it?',
    next: 'Follow up with the ones who did not',
    lens: 'numbers',
    level: 'links',
    below: { returns: 'Only the ones who wrote back.' },
    caveat: 'A link given to one person stands for that person; an app’s preview is not them.',
    focus: ['previews', 'opened', 'played'],
  },
  {
    id: 'kept',
    scene: 'people',
    question: 'Do they keep using it in their work?',
    next: 'Decide whether to keep improving it for them',
    lens: 'numbers',
    level: 'links',
    caveat: 'A link counts every use: it cannot tell them from someone they passed it to.',
    focus: ['days'],
  },
  {
    id: 'version',
    scene: 'people',
    question: 'Did the new version reach them?',
    next: 'Tell them about it, or keep the old one for them',
    lens: 'numbers',
    level: 'links',
    focus: ['version'],
  },
  {
    id: 'wants',
    scene: 'people',
    question: 'What do they want changed?',
    next: 'Make the next version',
    lens: 'returns',
    level: 'returns',
    focus: ['note', 'setting'],
  },
  {
    id: 'beyond',
    scene: 'people',
    question: 'Did it go further than the people you gave it to?',
    next: 'Ask them, or give a new link',
    lens: 'numbers',
    level: 'browsers',
    below: { links: 'More opens than you expect, but one person coming back looks the same.' },
    caveat: 'One person on two devices also counts as two browsers.',
    focus: ['browsers'],
  },
];

export type AnswerState = 'here' | 'elsewhere' | 'partly' | 'no';
/** Whether a view at a level answers a decision, and what is missing or unsure. */
export function answer(
  d: Decision,
  lens: Lens,
  level: Level,
): { state: AnswerState; text: string } {
  if (rank(level) >= rank(d.level))
    return lens === d.lens
      ? { state: 'here', text: d.caveat ?? 'This view answers it.' }
      : { state: 'elsewhere', text: `${lensName(d.lens)} answers it.` };
  const below = d.below?.[level];
  return below
    ? { state: 'partly', text: below }
    : { state: 'no', text: `den-kit would have to learn more: ${levelName(d.level)}.` };
}

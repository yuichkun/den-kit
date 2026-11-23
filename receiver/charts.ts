// The parts of the page of counts (dashboard.ts), as HTML and SVG text with no script: line charts
// with a table of their values, lists of bars and of meters, and tiles. Hovering a chart shows its
// values on that day with CSS alone; every value is also in the chart's table, so nothing needs
// the hover. Colors are the slots of the page's palette (dashboard.ts, STYLE). Every text put in
// the page goes through `esc`.

/** Text made safe to put in HTML, in an element or an attribute. */
export const esc = (text: string | number) =>
  String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const whole = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const share = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
export const formatCount = (n: number) => whole.format(n);
export const formatShare = (n: number) => share.format(n);

/** A day as "Nov 16". */
export const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export interface Series {
  name: string;
  /** The palette slot: 1 to 5, or 0 for the rest ("Other"). */
  slot: number;
  /** One value for each day of the chart; null where there is none. */
  values: Array<number | null>;
}

export interface LineChart {
  /** What the chart shows. */
  title: string;
  /** The day of each value; for weekly values, the Monday of the week. */
  days: string[];
  weekly?: boolean;
  series: Series[];
  /** Values are shares of 1, drawn from 0 to 100%. */
  shares?: boolean;
  /** Narrow, to sit three in a row: drawn on fewer units, so that its text stays as large. */
  narrow?: boolean;
}

const H = 208;
const TOP = 12;
const BOTTOM = 24;
const LEFT = 44;
const PLOT_H = H - TOP - BOTTOM;
/** The least room between two end labels. */
const LABEL_GAP = 13;
/** About how wide a character of 12px text is, to make room for labels the page cannot measure. */
const CHAR = 6.8;

const color = (slot: number) => (slot ? `var(--s${slot})` : 'var(--other)');

/** Round ticks from 0 that cover `max`, about four steps; whole numbers for counts. */
export function ticks(max: number, shares = false): number[] {
  if (shares) return [0, 0.25, 0.5, 0.75, 1];
  const rough = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * power).find(s => s >= rough) ?? power * 10);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/** A chart of lines over days, with its legend, the values on hover, and a table of the values. */
export function lineChart(chart: LineChart): string {
  const { days, series } = chart;
  const n = days.length;
  const W = chart.narrow ? 360 : 560;
  const format = chart.shares ? formatShare : formatCount;
  const values = series.flatMap(s => s.values.filter((v): v is number => v !== null));
  if (!n || !values.length) return empty(chart.title);
  const steps = ticks(Math.max(...values), chart.shares);
  const top = steps[steps.length - 1];
  const one = series.length === 1;
  const endText = (s: Series, v: number) => (one ? format(v) : `${s.name} ${format(v)}`);
  const longest = Math.max(
    ...series.map(s => {
      const last = s.values.findLast(v => v !== null);
      return last === undefined ? 0 : endText(s, last).length;
    }),
  );
  const plotW = W - LEFT - Math.min(200, Math.max(48, 16 + CHAR * longest));
  const x = (i: number) => LEFT + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => TOP + PLOT_H - (Math.min(v, top) / top) * PLOT_H;
  const r = (v: number) => Math.round(v * 10) / 10;
  const dayName = (day: string) => (chart.weekly ? `Week of ${shortDay(day)}` : shortDay(day));

  const grid = steps
    .map(
      t =>
        `<line class="${t ? 'grid' : 'axis'}" x1="${LEFT}" x2="${LEFT + plotW}" y1="${r(y(t))}" y2="${r(y(t))}"/>` +
        `<text class="tick" x="${LEFT - 6}" y="${r(y(t)) + 4}" text-anchor="end">${esc(chart.shares ? formatShare(t) : t >= 10_000 ? compact.format(t) : formatCount(t))}</text>`,
    )
    .join('');
  const labelled = [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k * (n - 1)) / 4)))];
  const xLabels = labelled
    .map(i => {
      const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      return `<text class="tick" x="${r(x(i))}" y="${H - 6}" text-anchor="${anchor}">${esc(shortDay(days[i]))}</text>`;
    })
    .join('');

  const lines = series
    .map(s => {
      const path = s.values
        .map((v, i) =>
          v === null ? '' : `${i && s.values[i - 1] !== null ? 'L' : 'M'}${r(x(i))} ${r(y(v))}`,
        )
        .join('');
      const area =
        one && s.values.every(v => v !== null)
          ? `<path class="area" fill="${color(s.slot)}" d="${path}L${r(x(n - 1))} ${TOP + PLOT_H}L${r(x(0))} ${TOP + PLOT_H}Z"/>`
          : '';
      return `${area}<path class="line" stroke="${color(s.slot)}" d="${path}"/>`;
    })
    .join('');

  // End labels at the right, moved apart where they would touch, with a hairline to the line's end.
  const ends = series
    .map(s => {
      const last = s.values.findLastIndex(v => v !== null);
      const value = s.values[last] as number;
      return { s, last, value, at: y(value), label: y(value) };
    })
    .filter(e => e.last >= 0)
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < ends.length; i++)
    ends[i].label = Math.max(ends[i].label, ends[i - 1].label + LABEL_GAP);
  const overflow = ends.length ? ends[ends.length - 1].label - (TOP + PLOT_H) : 0;
  if (overflow > 0) for (const e of ends) e.label -= overflow;
  for (let i = ends.length - 2; i >= 0; i--)
    ends[i].label = Math.min(ends[i].label, ends[i + 1].label - LABEL_GAP);
  const labelX = LEFT + plotW + 8;
  const endMarks = ends
    .map(e => {
      const text = endText(e.s, e.value);
      const moved = Math.abs(e.label - e.at) > 2 || e.last < n - 1;
      return (
        (moved
          ? `<line class="leader" x1="${r(x(e.last)) + 5}" y1="${r(e.at)}" x2="${labelX - 3}" y2="${r(e.label)}"/>`
          : '') +
        `<circle class="dot" cx="${r(x(e.last))}" cy="${r(e.at)}" r="4" fill="${color(e.s.slot)}"/>` +
        `<text class="end" x="${labelX}" y="${r(e.label) + 4}">${esc(text)}</text>`
      );
    })
    .join('');

  // One column for each day: hovering it shows a hairline, the points and every value.
  const column = plotW / Math.max(n - 1, 1);
  const columns = days
    .map((day, i) => {
      const left = Math.max(LEFT, x(i) - column / 2);
      const right = Math.min(LEFT + plotW, x(i) + column / 2);
      const rows = series.filter(s => s.values[i] !== null);
      const texts = rows.map(s =>
        one ? format(s.values[i]!) : `${format(s.values[i]!)} ${s.name}`,
      );
      const width = Math.round(
        20 + CHAR * Math.max(dayName(day).length, ...texts.map(t => t.length + 3)),
      );
      const height = 14 + 18 * (rows.length + 1);
      const tipX = x(i) + 10 + width > W - 2 ? x(i) - 10 - width : x(i) + 10;
      const tip = rows
        .map(
          (s, k) =>
            `<line x1="10" x2="20" y1="${36 + 18 * k}" y2="${36 + 18 * k}" stroke="${color(s.slot)}" class="key"/>` +
            `<text x="26" y="${40 + 18 * k}"><tspan class="value">${esc(format(s.values[i]!))}</tspan>${one ? '' : ` <tspan class="name">${esc(s.name)}</tspan>`}</text>`,
        )
        .join('');
      return (
        `<g class="col"><rect class="hit" x="${r(left)}" y="${TOP}" width="${r(right - left)}" height="${PLOT_H}"/>` +
        `<g class="hover" aria-hidden="true"><line class="cross" x1="${r(x(i))}" x2="${r(x(i))}" y1="${TOP}" y2="${TOP + PLOT_H}"/>` +
        rows
          .map(
            s =>
              `<circle class="dot" cx="${r(x(i))}" cy="${r(y(s.values[i]!))}" r="4" fill="${color(s.slot)}"/>`,
          )
          .join('') +
        `<g transform="translate(${r(tipX)} ${TOP})"><rect class="tip" width="${width}" height="${height}" rx="6"/>` +
        `<text x="10" y="20" class="name">${esc(dayName(day))}</text>${tip}</g></g></g>`
      );
    })
    .join('');

  const legend = one
    ? ''
    : `<ul class="legend">${series
        .map(
          s =>
            `<li><svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" stroke="${color(s.slot)}" class="key"/></svg>${esc(s.name)}</li>`,
        )
        .join('')}</ul>`;
  const table =
    `<details><summary>Table</summary><div class="scroll"><table><thead><tr><th>${chart.weekly ? 'Week of' : 'Day'}</th>` +
    series.map(s => `<th>${esc(s.name)}</th>`).join('') +
    `</tr></thead><tbody>` +
    days
      .map((day, i) => ({ day, i }))
      .reverse()
      .map(
        ({ day, i }) =>
          `<tr><th>${esc(day)}</th>${series
            .map(s => `<td>${s.values[i] === null ? '' : esc(format(s.values[i]!))}</td>`)
            .join('')}</tr>`,
      )
      .join('') +
    `</tbody></table></div></details>`;
  return (
    `<figure><figcaption>${esc(chart.title)}</figcaption>${legend}` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chart.title)}">${grid}${xLabels}${lines}${endMarks}${columns}</svg>` +
    `${table}</figure>`
  );
}

export interface Bar {
  name: string;
  value: number;
  /** The whole that `value` is a part of. */
  of: number;
}

/** Horizontal bars of shares, in the order given, each with its share and count at its end. */
export function barList(title: string, bars: Bar[]): string {
  if (!bars.length || !bars[0].of) return empty(title);
  return (
    `<figure><figcaption>${esc(title)}</figcaption><ol class="bars">` +
    bars
      .map(b => {
        const part = b.of ? b.value / b.of : 0;
        return (
          `<li><span class="label">${esc(b.name)}</span><span class="track">` +
          `<span class="bar" style="--part:${Math.round(part * 1000) / 1000}"></span>` +
          `<span class="figure">${esc(formatShare(part))} · ${esc(formatCount(b.value))}</span></span></li>`
        );
      })
      .join('') +
    `</ol></figure>`
  );
}

export interface Meter {
  name: string;
  value: number;
  limit: number;
  /** More about the value, after its share of the limit. */
  note: string;
}

/** A meter for each row: how much of its limit the value takes. */
export function meterList(title: string, meters: Meter[]): string {
  if (!meters.length) return empty(title);
  return (
    `<figure><figcaption>${esc(title)}</figcaption><ul class="meters">` +
    meters
      .map(m => {
        const part = m.limit ? Math.min(m.value / m.limit, 1) : 1;
        return (
          `<li><span class="label">${esc(m.name)}</span>` +
          `<span class="meter"><span style="--part:${Math.round(part * 1000) / 1000}"></span></span>` +
          `<span class="figure">${esc(formatCount(m.value))} (${esc(formatShare(m.limit ? m.value / m.limit : 1))})${m.note ? ` · ${esc(m.note)}` : ''}</span></li>`
        );
      })
      .join('') +
    `</ul></figure>`
  );
}

export interface Tile {
  label: string;
  value: string;
  note: string;
}

export const tiles = (list: Tile[]) =>
  `<div class="tiles">${list
    .map(
      t =>
        `<div class="tile"><div class="label">${esc(t.label)}</div><div class="value">${esc(t.value)}</div><div class="note">${esc(t.note)}</div></div>`,
    )
    .join('')}</div>`;

/** A table with a header row; cells are text. */
export const table = (head: string[], rows: string[][]) =>
  `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map(
      row =>
        `<tr>${row.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`;

const empty = (title: string) =>
  `<figure><figcaption>${esc(title)}</figcaption><p class="empty">No counts yet.</p></figure>`;

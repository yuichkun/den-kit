// Tide Bells — a sound installation for a shore: six bells stand at different
// heights, and the waves ring the ones the water reaches.
// Nothing is played: a slow swell rises and falls by itself. A codebox (Tide
// table) turns the hour (khour, 0 to 24) into the height of the tide; the sea
// comes in from nothing when the sound starts. The water is the tide plus the
// swell. One bell is a part (Bell), struck each time the water rises past its
// height (an FM pair, bright as it is struck, mellowing as it rings). The part
// runs ×6 and two `each` spreads give each copy its height and its note, higher
// up the shore and higher in pitch, so low tide rings the low bells and high
// tide the high ones; bells under water stay quiet. The sea is noise that swells
// with the same wave, louder and brighter at high tide.
// The design follows the thinking of Tide Guide (Apple Design Awards 2026,
// Visuals and Graphics): one full-screen chart that reads at a glance, large
// plain figures for now, and colours that follow the sky at the hour. The
// screen is one canvas edge to edge, the day's tide drawn as a score for the
// bells: each bell is a line at its height, heavy in the hours the water
// reaches it, and the hour's line carries the bells now. Each setting is
// dragged where it acts (the hour on the curve, Bay in the sky, Sea in the
// water, Bells by their names, Waves on a wave); Waves, Sea, Bells and Bay are
// kept in the patch. The one control on the plugin is a meter of the bells,
// drawn as the bar that ends their lines.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The tide at an hour of the day, in metres. The chart canvas uses the same formula. */
export const TIDE_TABLE = `import { defineSubgraph, type Node } from '@unworklet/core';

// The tide at an hour of the day (0 to 24): two highs and two lows a day, one
// high a little lower than the other. Out: the height in metres (0.3 to 2.1).
export default defineSubgraph(() => ({
  tick(i: { hour: Node<'f32'> }) {
    const twice = i.hour.sub(3.2).mul((2 * Math.PI) / 12.42).cos();
    const once = i.hour.sub(5).mul((2 * Math.PI) / 24.84).cos();
    return { height: twice.mul(0.82).add(once.mul(0.1)).add(1.2) };
  },
}));
`;

/** The bells, low to high: their heights on the shore (metres) and their notes. */
const BELLS = [
  { height: 0.6, note: 69 },
  { height: 0.9, note: 71 },
  { height: 1.2, note: 74 },
  { height: 1.5, note: 76 },
  { height: 1.8, note: 78 },
  { height: 2.1, note: 81 },
];
/** How far a wave reaches above and below the tide, in metres. */
const REACH = 0.45;

/** The day's tide as the bells' score, in the colours of the sky at the hour; it takes the mouse. */
export const TIDE_CHART = `// The day's tide as a score for the six bells, under the sky of the hour. The
// hour is khour (0 to 24); the tide comes from the same table as the codebox's,
// so the curve is what the sound plays. The bells (props.heights in metres and
// props.notes, low to high, as lists) are six lines across the day at their
// heights, named at the right. The waves wash props.reach metres above and below
// the tide, so a line is drawn heavy where the water reaches it: those are the
// hours that bell rings. The hour's line carries the bells now, filled where the
// water reaches them; a bell swings when its note jumps in the spectrum (a strike
// is heard), and the water on the line bobs with the waves, read from how loud
// the sea is (the low end of the spectrum, below the bells).
// Each setting is drawn where it acts and dragged there: the hour along the curve
// (or its handle); Bay (kbay) up and down in the sky, where the tide's echoes
// hang; Sea (ksea) up and down in the water, whose lines thicken; Bells (kbells)
// up and down by the bells' names, whose lines grow heavier; Waves (kwaves) left
// and right on the wave drawn on the water. Figures are drawn in the system font.
const TAU = Math.PI * 2;
const tide = h => 1.2 + 0.82 * Math.cos((h - 3.2) * TAU / 12.42) + 0.1 * Math.cos((h - 5) * TAU / 24.84);
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
// The sky by the hour: [hour, top, horizon].
const SKY = [
  [0, '#0b1424', '#1b2b47'],
  [4.8, '#111c37', '#3b3f68'],
  [6.3, '#4a6ca4', '#f2b78d'],
  [8.5, '#6aa6dc', '#d3e8f6'],
  [12.5, '#4b97d6', '#cde5f5'],
  [16.5, '#6799cf', '#f0d7b0'],
  [18.7, '#394883', '#ee8b5f'],
  [20.2, '#17203d', '#4a3b65'],
  [24, '#0b1424', '#1b2b47'],
];
const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c, a) => (a === undefined ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')');
const light = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function skyAt(h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return [mix(rgb(t0), rgb(t1), t), mix(rgb(b0), rgb(b1), t)];
    }
  }
  return [rgb(SKY[0][1]), rgb(SKY[0][2])];
}
// How much daylight there is (0 night, 1 day).
const daylight = h => clamp(Math.min((h - 5.2) / 2.2, (20 - h) / 2.2), 0, 1);
const two = n => String(n).padStart(2, '0');
const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return two(Math.floor(m / 60)) + ':' + two(m % 60); };
const metres = m => m.toFixed(2) + ' m';
const pct = v => Math.round(v * 100) + '%';
// The highs and lows between two hours (where the slope turns).
function turns(from, to) {
  const out = [];
  let prev = tide(from) - tide(from - 0.02);
  for (let h = from + 0.02; h <= to; h += 0.02) {
    const d = tide(h) - tide(h - 0.02);
    if (d > 0 !== prev > 0) out.push({ h: h - 0.01, high: prev > 0, m: tide(h - 0.01) });
    prev = d;
  }
  return out;
}
const list = v => String(v ?? '').split(/[ ,]+/).filter(Boolean).map(Number);
const bellsOf = props => { const notes = list(props.notes); return list(props.heights).map((height, k) => ({ height, note: notes[k] ?? 69 })); };
const band = note => (64 * Math.log((440 * Math.pow(2, (note - 69) / 12)) / 96)) / Math.log(250);
function at(spectrum, b) {
  const i = Math.max(0, Math.min(62, Math.floor(b))), t = b - i;
  return spectrum[i] * (1 - t) + spectrum[i + 1] * t;
}
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = n => { const k = Math.round(n); return NAMES[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1); };
// The settings drawn on the picture: control, range, how its label reads, which way it drags.
const SET = {
  kbay: { lo: 0, hi: 1, axis: 'y', read: v => 'bay ' + pct(v) },
  ksea: { lo: 0, hi: 1, axis: 'y', read: v => 'sea ' + pct(v) },
  kbells: { lo: 0, hi: 1, axis: 'y', read: v => 'bells ' + pct(v) },
  kwaves: { lo: 3, hi: 12, axis: 'x', read: v => 'waves ' + v.toFixed(1) + '/min' },
};
// Where things are: the big figures above the day; the day from L to R; the bells' names right of R.
function layout(w, h) {
  const TOP = 150, BOT = h - 40, L = 0, R = w - 58;
  return {
    TOP, BOT, L, R,
    X: hr => L + (hr / 24) * (R - L),
    H: x => ((x - L) / (R - L)) * 24,
    Y: m => BOT - (m / 2.7) * (BOT - TOP),
    // The labels that are handles: control: [x, y, width, height] (y is the text's top).
    labels: { kbay: [20, 122, 110, 22], ksea: [14, BOT - 56, 90, 22], kwaves: [14, BOT - 30, 190, 22], kbells: [w - 110, TOP + 38, 102, 22] },
  };
}
function zoneAt(e, f) {
  const { TOP, BOT, L, R, X, H, Y, labels } = layout(f.w, f.h);
  const hour = clamp(f.value('khour'), 0, 24);
  if (Math.hypot(e.x - X(hour), e.y - Y(tide(hour))) < 20) return 'hour';
  for (const id in labels) { const [x, y, w, h] = labels[id]; if (e.x >= x && e.x <= x + w && e.y >= y && e.y <= y + h) return id; }
  if (e.x > R && e.y >= TOP - 34 && e.y <= BOT) return 'kbells';
  if (e.x < L || e.x > R || e.y < TOP - 40 || e.y > BOT) return '';
  const cy = Y(tide(H(e.x)));
  if (Math.abs(e.y - cy) < 14) return 'hour';
  return e.y < cy ? 'kbay' : 'ksea';
}
export default {
  setup(ctx, f) {
    const n = bellsOf(f.props).length;
    Object.assign(f.state, { drag: '', over: '', hi: 0, lo: 1, sw: 0, avg: new Array(n).fill(0), last: new Array(n).fill(-10), day: turns(0, 24) });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, bells = bellsOf(f.props), reach = f.props.reach || 0.45;
    const { TOP, BOT, L, R, X, H, Y, labels } = layout(w, h);
    const hour = clamp(f.value('khour'), 0, 24);
    const bay = f.value('kbay'), sea = f.value('ksea'), loud = f.value('kbells'), waves = f.value('kwaves');
    const [top, low] = skyAt(hour);
    const ink = light(top) > 0.5 ? [15, 27, 43] : [244, 247, 251];
    const ink2 = light(low) > 0.55 ? [15, 27, 43] : [244, 247, 251];
    const day = daylight(hour);
    const water = mix([22, 56, 96], [44, 128, 196], day);
    const active = id => s.over === id || s.drag === id;
    // The sky of this hour, edge to edge.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(low));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const curve = (dy) => { ctx.beginPath(); for (let x = L; x < R; x += 3) ctx.lineTo(x, Y(tide(H(x))) + dy); ctx.lineTo(R, Y(tide(24)) + dy); };
    // Bay: the tide's echoes hang in the sky, more of them and further up as the bay opens.
    const echoes = Math.round(bay * 5);
    ctx.lineWidth = active('kbay') ? 1.5 : 1;
    for (let k = 1; k <= echoes; k++) {
      ctx.strokeStyle = css(ink2, (0.42 - k * 0.06) * (active('kbay') ? 1.5 : 1));
      curve(-k * 11); ctx.stroke();
    }
    // The water under the tide, its lines thicker and closer as the sea grows louder.
    ctx.beginPath(); ctx.moveTo(L, h);
    for (let x = L; x < R; x += 3) ctx.lineTo(x, Y(tide(H(x))));
    ctx.lineTo(R, Y(tide(24))); ctx.lineTo(R, h); ctx.closePath();
    ctx.fillStyle = css(water, 0.66); ctx.fill();
    if (sea > 0.01) {
      ctx.save(); ctx.clip();
      const gap = 24 - sea * 12;
      ctx.strokeStyle = css(ink2, 0.07 + sea * 0.2 + (active('ksea') ? 0.12 : 0));
      ctx.lineWidth = 0.6 + sea * 0.9;
      for (let y = h - 30; y > TOP - 40; y -= gap) {
        ctx.beginPath();
        for (let x = L; x <= R; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.04 + y * 0.3 + f.t * (waves / 60) * TAU) * 1);
        ctx.stroke();
      }
      ctx.restore();
    }
    // The bells: one line each at its height, heavy where the waves reach it during the day.
    const now = tide(hour);
    ctx.font = '600 12px ' + FONT; ctx.textBaseline = 'middle';
    bells.forEach(b => {
      const y = Math.round(Y(b.height)) + 0.5;
      ctx.strokeStyle = css(ink2, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
      ctx.strokeStyle = css(ink2, 0.85); ctx.lineWidth = 1.5 + loud * 2.5 + (active('kbells') ? 1 : 0);
      ctx.lineCap = 'butt';
      let on = false;
      ctx.beginPath();
      for (let x = L; x <= R; x += 2) {
        const reached = Math.abs(tide(H(x)) - b.height) <= reach;
        if (reached && !on) ctx.moveTo(x, y);
        if (reached) ctx.lineTo(x, y);
        on = reached;
      }
      ctx.stroke();
      ctx.fillStyle = css(ink2, 0.95); ctx.textAlign = 'left';
      ctx.fillText(noteName(b.note), R + 8, y);
    });
    // The tide.
    ctx.strokeStyle = css(ink2); ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    curve(0); ctx.stroke();
    // Highs and lows, all of them, the same way.
    ctx.font = '600 12px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = css(ink2);
    const x = X(hour);
    for (const q of s.day) {
      const qx = X(q.h), qy = Y(q.m);
      ctx.beginPath(); ctx.arc(qx, qy, 3, 0, TAU); ctx.fill();
      // The one beside the hour's line would sit among the bells: its dot is enough.
      if (Math.abs(qx - x) > 64) ctx.fillText((q.high ? 'High ' : 'Low ') + clock(q.h), qx, q.high ? qy - 12 : qy + 22);
    }
    // The waves, read from how loud the sea is (below the bells' notes).
    let v = 0;
    for (let i = 1; i <= 6; i++) v += f.spectrum[i] / 6;
    s.hi = v > s.hi ? v : s.hi - (s.hi - v) * f.dt * 0.08;
    s.lo = v < s.lo ? v : s.lo + (v - s.lo) * f.dt * 0.08;
    const sw = s.hi - s.lo > 0.03 ? ((v - s.lo) / (s.hi - s.lo)) * 2 - 1 : 0;
    s.sw += (sw - s.sw) * Math.min(1, f.dt * 4);
    const live = now + reach * s.sw;
    // The hour: its line, the water on it now, and the bells hung on it at their heights.
    ctx.strokeStyle = css(ink2, 0.6); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP - 12); ctx.lineTo(Math.round(x) + 0.5, BOT); ctx.stroke();
    ctx.fillStyle = css(ink2, 0.25);
    ctx.fillRect(x - 9, Y(now + reach), 18, Y(now - reach) - Y(now + reach));
    ctx.fillStyle = css(ink2); ctx.fillRect(x - 12, Y(live) - 1, 24, 2);
    const jumps = bells.map((b, k) => { const val = at(f.spectrum, band(b.note)); const j = val - s.avg[k]; s.avg[k] += (val - s.avg[k]) * Math.min(1, f.dt * 2); return j; });
    let reached = 0;
    bells.forEach((b, k) => {
      const j = jumps[k];
      if (j > 0.09 && j >= (jumps[k - 1] ?? 0) && j >= (jumps[k + 1] ?? 0) && f.t - s.last[k] > 0.5) s.last[k] = f.t;
      const by = Y(b.height), inReach = Math.abs(b.height - now) <= reach;
      if (inReach) reached++;
      const age = f.t - s.last[k], ring = inReach && age < 1.6 ? 1 - age / 1.6 : 0;
      const sway = Math.sin(age * 16) * 4 * ring;
      ctx.lineWidth = 2; ctx.strokeStyle = css(ink2);
      ctx.fillStyle = inReach ? css(ink2) : css(top);
      ctx.beginPath(); ctx.arc(x + sway, by, 6.5, 0, TAU); ctx.fill(); ctx.stroke();
      if (ring > 0) {
        ctx.strokeStyle = css(ink2, ring); ctx.lineWidth = 1.5;
        for (const r0 of [13, 21]) { ctx.beginPath(); ctx.arc(x, by, r0 + (1 - ring) * 10, 0, TAU); ctx.stroke(); }
      }
    });
    // The handle on the curve.
    const hot = active('hour');
    ctx.fillStyle = css(top); ctx.strokeStyle = css(ink2); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, Y(now), hot ? 12 : 10, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = css(ink2);
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + d * 17, Y(now) - 5); ctx.lineTo(x + d * 23, Y(now)); ctx.lineTo(x + d * 17, Y(now) + 5); ctx.closePath(); ctx.fill(); }
    // The day's sky along the bottom edge: night at both ends; the hours above it.
    for (let sx = L; sx < R; sx += 2) { ctx.fillStyle = css(skyAt(H(sx))[0]); ctx.fillRect(sx, h - 7, Math.min(2, R - sx), 7); }
    ctx.fillStyle = css(ink2, 0.9); ctx.font = '500 11px ' + FONT;
    for (const hr of [0, 6, 12, 18, 24]) { ctx.textAlign = hr === 0 ? 'left' : hr === 24 ? 'right' : 'center'; ctx.fillText(two(hr) + ':00', hr === 0 ? 4 : hr === 24 ? R : X(hr), h - 15); }
    // The settings' labels, on what they set; the one under the pointer is underlined.
    ctx.textBaseline = 'top'; ctx.font = '600 13px ' + FONT;
    for (const id in labels) {
      const [lx, ly, lw] = labels[id];
      const text = SET[id].read(f.value(id)) + (SET[id].axis === 'y' ? ' ↕' : ' ↔');
      const on = active(id);
      ctx.fillStyle = css(id === 'kbay' ? ink : ink2);
      ctx.globalAlpha = on ? 1 : 0.86;
      if (id === 'kwaves') {
        // A wave on the water, moving at the waves' pace: drag it to set how many come a minute.
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let wx = 0; wx <= 44; wx += 2) ctx.lineTo(lx + wx, ly + 8 - Math.sin(wx / 44 * TAU * (waves / 4) - f.t * (waves / 60) * TAU * 4) * 4);
        ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillText(text, lx + 52, ly + 1);
        if (on) ctx.fillRect(lx + 52, ly + 17, ctx.measureText(text).width, 1.5);
      } else {
        const right = id === 'kbells';
        ctx.textAlign = right ? 'right' : 'left';
        const tx = right ? lx + lw : lx;
        ctx.fillText(text, tx, ly + 1);
        if (on) { const tw = ctx.measureText(text).width; ctx.fillRect(right ? tx - tw : tx, ly + 17, tw, 1.5); }
      }
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
    // Now, in large plain figures; the name and that it plays by itself, small, at the right.
    const rising = tide(hour + 0.02) > now;
    ctx.textAlign = 'left'; ctx.fillStyle = css(ink);
    ctx.font = '600 58px ' + FONT; ctx.fillText(clock(hour), 20, 80);
    ctx.font = '500 17px ' + FONT; ctx.fillText((rising ? 'Rising, ' : 'Falling, ') + metres(now) + '   ·   ' + reached + ' of ' + bells.length + ' bells in reach', 23, 108);
    ctx.textAlign = 'right';
    ctx.font = '700 15px ' + FONT; ctx.fillText('Tide Bells', w - 20, 34);
    ctx.font = '500 13px ' + FONT; ctx.globalAlpha = 0.8; ctx.fillText('plays by itself', w - 20, 52); ctx.globalAlpha = 1;
  },
  pointer(e, f) {
    const s = f.state, { L, R, H } = layout(f.w, f.h);
    const zone = zoneAt(e, f);
    if (e.type === 'down' && zone) {
      s.drag = zone;
      if (zone !== 'hour') Object.assign(s, { x0: e.x, y0: e.y, v0: f.value(zone) });
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag === 'hour' && (e.type === 'down' || e.type === 'move'))
      f.set('khour', Math.round(clamp(H(clamp(e.x, L, R)), 0, 24) * 12) / 12);
    else if (s.drag && e.type === 'move') {
      const d = SET[s.drag];
      const moved = d.axis === 'y' ? s.y0 - e.y : e.x - s.x0;
      f.set(s.drag, clamp(s.v0 + (moved / 160) * (d.hi - d.lo), d.lo, d.hi));
    }
    if (e.type === 'wheel' && zone) {
      if (zone === 'hour') f.set('khour', clamp(f.value('khour') + Math.sign(e.dy) * 0.25, 0, 24));
      else { const d = SET[zone]; f.set(zone, clamp(f.value(zone) - Math.sign(e.dy) * (d.hi - d.lo) / 40, d.lo, d.hi)); }
    }
    if (!s.drag) s.over = zone;
    const which = s.drag || zone;
    f.cursor(s.drag === 'hour' ? 'grabbing' : which === 'hour' || which === 'kwaves' ? 'ew-resize' : which ? 'ns-resize' : 'default');
  },
};
`;

export function tide(catalog: Catalog) {
  const inside = ['wet1', 'env1', 'mtof1', 'modhz1', 'devamt1', 'dev1', 'fm1', 'sq1', 'vca1'];
  return workInSteps(
    'tide',
    'Tide Bells',
    catalog,
    [760, 548],
    [
      [
        // ---- the hour, the tide, the waves ----
        add('table1', 'kit.codebox', {
          label: 'Tide table',
          code: TIDE_TABLE,
          ports: {
            inputs: [{ id: 'hour', type: 'signal' }],
            outputs: [{ id: 'height', type: 'signal' }],
          },
        }),
        ...patchControl('khour', 'Hour', 'table1.hour', [0, 24, 'linear', ''], 14.5),
        // The sea comes in from nothing when the sound starts (the bells ring in turn as it passes them).
        add('always1', 'kit.compare', { label: 'Always', values: { b: -1 } }),
        add('comein1', 'den.envelope', {
          label: 'Coming in',
          values: { attack: 8, decay: 0.1, sustain: 1, release: 1 },
        }),
        add('tide1', 'kit.mul', { label: 'Tide' }),
        wire('always1.out', 'comein1.gate'),
        wire('table1.height', 'tide1.a'),
        wire('comein1.level', 'tide1.b'),
        add('rate1', 'kit.mul', { label: 'Waves (Hz)', values: { b: 1 / 60 } }),
        // One wave for the whole shore: the bells and the sea.
        add('swell1', 'den.lfo', { label: 'Swell' }),
        add('reach1', 'kit.mul', { label: 'Reach', values: { b: REACH } }),
        add('water1', 'kit.add', { label: 'Water' }),
        wire('rate1.out', 'swell1.rate'),
        wire('swell1.out', 'reach1.a'),
        wire('tide1.out', 'water1.a'),
        wire('reach1.out', 'water1.b'),
        // ---- one bell: struck each time the water rises past its height ----
        add('wet1', 'kit.compare', { label: 'Reached' }),
        add('env1', 'den.envelope', {
          label: 'Ring',
          values: { attack: 0.002, decay: 6, sustain: 0, release: 6 },
        }),
        add('mtof1', 'kit.mtof'),
        add('modhz1', 'kit.mul', { label: 'Bell ratio', values: { b: 1.4 } }),
        add('devamt1', 'kit.mul', { label: 'Brightness' }),
        add('dev1', 'kit.mul', { label: 'Strike', values: { b: 2.4 } }),
        add('fm1', 'den.frequencyModulation', { label: 'Bell' }),
        add('sq1', 'kit.mul', { label: 'Fade' }),
        add('vca1', 'kit.mul', { label: 'Bell out' }),
        wire('water1.out', 'wet1.a'),
        wire('wet1.out', 'env1.gate'),
        wire('mtof1.out', 'fm1.carrierHz'),
        wire('mtof1.out', 'modhz1.a'),
        wire('modhz1.out', 'fm1.modulatorHz'),
        wire('mtof1.out', 'devamt1.a'),
        wire('env1.level', 'devamt1.b'),
        wire('devamt1.out', 'dev1.a'),
        wire('dev1.out', 'fm1.deviationHz'),
        wire('env1.level', 'sq1.a'),
        wire('env1.level', 'sq1.b'),
        wire('fm1.out', 'vca1.a'),
        wire('sq1.out', 'vca1.b'),
        // ---- the sea: noise that swells with the wave, louder and brighter at high tide ----
        add('sea01', 'kit.scale', { label: 'Swell 0..1', values: { scale: 0.5, offset: 0.5 } }),
        add('crest1', 'kit.mul', { label: 'Crest' }),
        add('wash1', 'kit.scale', { label: 'Wash', values: { scale: 0.85, offset: 0.15 } }),
        add('near1', 'kit.scale', {
          label: 'Nearer at high tide',
          values: { scale: 0.6, offset: 1.2 },
        }),
        add('seaamp1', 'kit.mul', { label: 'Sea level' }),
        add('bright1', 'kit.mul', { label: 'Brighter at the crest', values: { b: 2.4 } }),
        add('seahz1', 'kit.cutoffMod', { label: 'Sea tone', values: { hz: 380 } }),
        add('noisel1', 'den.seededNoise', { label: 'Sea L', config: { seed: 21 } }),
        add('noiser1', 'den.seededNoise', { label: 'Sea R', config: { seed: 77 } }),
        add('seal1', 'den.filter', { label: 'Sea tone L', values: { resonance: 0.5 } }),
        add('sear1', 'den.filter', { label: 'Sea tone R', values: { resonance: 0.5 } }),
        add('seavl1', 'kit.mul', { label: 'Sea L out' }),
        add('seavr1', 'kit.mul', { label: 'Sea R out' }),
        add('sealvl1', 'kit.gain', { label: 'Sea', values: { gain: 0.6 } }),
        add('sealvr1', 'kit.gain', { label: 'Sea R level', values: { gain: 0.6 } }),
        wire('swell1.out', 'sea01.in'),
        wire('sea01.out', 'crest1.a'),
        wire('sea01.out', 'crest1.b'),
        wire('crest1.out', 'wash1.in'),
        wire('table1.height', 'near1.in'),
        wire('wash1.out', 'seaamp1.a'),
        wire('near1.out', 'seaamp1.b'),
        wire('crest1.out', 'bright1.a'),
        wire('bright1.out', 'seahz1.octaves'),
        wire('noisel1.out', 'seal1.input'),
        wire('noiser1.out', 'sear1.input'),
        wire('seahz1.out', 'seal1.cutoff'),
        wire('seahz1.out', 'sear1.cutoff'),
        wire('seal1.out', 'seavl1.a'),
        wire('seaamp1.out', 'seavl1.b'),
        wire('sear1.out', 'seavr1.a'),
        wire('seaamp1.out', 'seavr1.b'),
        wire('seavl1.out', 'sealvl1.in'),
        wire('seavr1.out', 'sealvr1.in'),
        // ---- the shore: bells across, the sea under them, a wide bay ----
        add('belllvl1', 'kit.gain', { label: 'Bells', values: { gain: 0.5 } }),
        add('splay1', 'kit.splay', { label: 'Across the shore', values: { width: 0.8 } }),
        add('suml1', 'kit.add', { label: 'Left' }),
        add('sumr1', 'kit.add', { label: 'Right' }),
        add('bay1', 'den.algorithmicReverb', {
          label: 'Bay',
          config: { roomScale: 1, decaySeconds: 6, dampingHz: 5000 },
          values: { mix: 0.35 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.45 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.45 } }),
        add('out1', 'kit.out'),
        wire('vca1.out', 'belllvl1.in'),
        wire('belllvl1.out', 'splay1.in'),
        wire('splay1.left', 'suml1.a'),
        wire('sealvl1.out', 'suml1.b'),
        wire('splay1.right', 'sumr1.a'),
        wire('sealvr1.out', 'sumr1.b'),
        wire('suml1.out', 'bay1.left'),
        wire('sumr1.out', 'bay1.right'),
        wire('bay1.left', 'gl1.in'),
        wire('bay1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        // The bell becomes a part (the water comes in; the ring goes out).
        { op: 'makePart', ids: inside, name: 'Bell', id: 'bell', node: 'bell1' },
      ],
      // Its knobs: where the bell stands, and its note.
      doc =>
        onlyParams(doc, 'bell', [
          {
            node: 'wet1',
            port: 'b',
            id: 'height',
            label: 'Height',
            range: { min: 0, max: 2.6 },
          },
          {
            node: 'mtof1',
            port: 'note',
            id: 'note',
            label: 'Note',
            range: { min: 48, max: 96, unit: 'note' },
          },
        ]),
      doc => {
        const bell = doc.parts.bell!;
        return [
          {
            op: 'updatePart',
            part: 'bell',
            doc: 'One bell on the shore, struck each time the water rises past its height. Height is where it stands (metres), Note is its pitch.',
            labels: { [bell.inputs[0]!.id]: 'Water', [bell.outputs[0]!.id]: 'Ring' },
          },
        ];
      },
      [
        { op: 'setCount', node: 'bell1', count: BELLS.length },
        {
          op: 'setSpread',
          node: 'bell1',
          port: 'height',
          spread: { kind: 'each', values: BELLS.map(b => b.height) },
        },
        {
          op: 'setSpread',
          node: 'bell1',
          port: 'note',
          spread: { kind: 'each', values: BELLS.map(b => b.note) },
        },
        // ---- the shore's dials, kept in the patch: the picture moves them ----
        ...patchControl('kwaves', 'Waves a minute', 'rate1.a', [3, 12, 'linear', ''], 6.5),
        ...patchControl('ksea', 'Sea', ['sealvl1.gain', 'sealvr1.gain'], [0, 1, 'linear', ''], 0.6),
        ...patchControl('kbells', 'Bells', 'belllvl1.gain', [0, 1, 'linear', ''], 0.5),
        ...patchControl('kbay', 'Bay', 'bay1.mix', [0, 1, 'linear', ''], 0.35),
        // ---- the plugin: the day's tide as the bells' score, edge to edge, in the colours of the hour ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#17203d',
              fg: '#f4f7fb',
              accent: '#ee8b5f',
              track: '#2c3a63',
              knob: '#394883',
              pointer: '#f4f7fb',
              muted: '#a9b4cc',
              glow: '#ee8b5f',
              font: 'system',
              labelFont: 'system',
              valueFont: 'system',
            },
            background: [{ kind: 'color', color: '#17203d' }],
          },
        },
        el({
          kind: 'canvas',
          name: 'The day’s tide and the bells',
          code: TIDE_CHART,
          rect: r(0, 0, 760, 548),
          props: {
            heights: BELLS.map(b => b.height).join(' '),
            notes: BELLS.map(b => b.note).join(' '),
            reach: REACH,
          },
        }),
        // How loud the bells ring now: the bar that ends the bells' lines, from the lowest to the highest.
        ...control('mbells', 'ui.meter', 'Bells ringing', null, r(700, 228, 5, 202), {
          style: {
            skin: {
              name: 'bar',
              params: { fill: '#ffffff', surface: 'rgba(255, 255, 255, 0.25)', scale: false },
            },
          },
        }),
        wire('belllvl1.out', 'mbells.in'),
      ],
    ],
  );
}

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
// Visuals and Graphics): a rich full-screen picture that shows the sea's
// numbers so plainly that anyone reads them, animation that belongs to the
// water, large plain figures for now, and a palette that follows the colour of
// the sky through the day. The screen is one canvas edge to edge: the shore at
// the hour seen from the quay, the water standing on a row of posts with the
// six bronze bells hung on them, the sun or the moon over the hour, and on the
// quay the day's tide inlaid as a ribbon. Each setting is dragged where it acts
// (the hour along the ribbon or by the sun, Bells on the bells, Bay on the
// headlands, Sea and Waves on the water), its value on a tag by the hand; they
// are kept in the patch. The one control on the plugin is a scope of the bells
// laid on the horizon, so the horizon hums when they ring.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The tide at an hour of the day, in metres. The shore canvas uses the same formula. */
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

/** Where the horizon lies on the canvas, and the stretch of it the bells' scope draws (canvas pixels: y, then x from and to). */
const HORIZON = { y: 222, x0: 237, x1: 527 };
/** The colour of the horizon line, the canvas's and the scope's. */
const HORIZON_LINE = '#9c6a2e';

/** The shore at the hour, seen from the quay: the water on the posts, the six bells, the sky; it takes the mouse. */
export const TIDE_SHORE = `// The shore at the hour, seen from the quay: the sky and the sea of the hour,
// and the bells hung on a row of posts standing in the water. The hour is khour
// (0 to 24); the tide comes from the same table as the codebox's, so where the
// water stands on the posts is what the sound plays. The waves wash props.reach
// metres above and below the tide: the posts are dark where they wash, and a
// bell rings while they reach its lip. The bells (props.heights in metres and
// props.notes, low to high, as lists) hang at their heights, the lowest on the
// left; what is under the water is seen through it, and a bell the waves reach
// swings when its note jumps in the spectrum (a strike is heard). The water on
// the posts bobs with the waves, read from how loud the sea is (the low end of
// the spectrum, below the bells). The sun or the moon stands over the hour on
// its arc; headlands close the bay in as Bay (kbay) rises; crests on the sea
// grow with Sea (ksea) and drift at the pace of the waves (kwaves). The quay at
// the bottom carries the work's name and the day's tide inlaid as a ribbon:
// thicker at high tide, in the colour of each hour's sky, marked at the hour.
// Drag along the ribbon, or the sun or the moon, for the hour; a bell or its
// post up and down for Bells (kbells); a headland up and down for Bay; the sea
// up and down for Sea and across for Waves. A setting's name and value show on
// a stone tag by the hand. The horizon is a line in props.line, left open from
// x0 to x1 of props.horizon ("y x0 x1"), where the plugin's scope of the bells
// lies on it. Figures are drawn in the system font.
const TAU = Math.PI * 2;
const tide = h => 1.2 + 0.82 * Math.cos((h - 3.2) * TAU / 12.42) + 0.1 * Math.cos((h - 5) * TAU / 24.84);
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
// The sky by the hour: [hour, top, middle, horizon].
const SKY = [
  [0, '#0a1322', '#111d33', '#1c2b48'],
  [4.8, '#101a33', '#1e2647', '#3d3f6a'],
  [6.3, '#45679f', '#9a8fb0', '#f3b48a'],
  [8.5, '#5f9fd8', '#9cc6ea', '#d8eaf6'],
  [12.5, '#4a92d3', '#8fbfe6', '#d2e7f5'],
  [16.5, '#5d92cc', '#a9bfdc', '#f1d9b4'],
  [18.7, '#36447f', '#8f6a8f', '#f08a5c'],
  [20.2, '#161f3c', '#2a2a50', '#4b3b66'],
  [24, '#0a1322', '#111d33', '#1c2b48'],
];
// The sea by the hour: [hour, far, near].
const SEA = [
  [0, '#152338', '#08111d'],
  [4.8, '#24284a', '#0b1426'],
  [6.3, '#7d7a92', '#1f3b52'],
  [8.5, '#7fb1c4', '#1d5a6e'],
  [12.5, '#77acc2', '#195a70'],
  [16.5, '#9fb0b8', '#215468'],
  [18.7, '#b07a72', '#1d2f4c'],
  [20.2, '#2b2a4a', '#0d1528'],
  [24, '#152338', '#08111d'],
];
const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c, a) => (a === undefined ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')');
const light = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const frac = v => v - Math.floor(v);
// A table's colours at an hour.
function colours(table, h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i], b = table[i + 1];
    if (h >= a[0] && h <= b[0]) { const t = (h - a[0]) / (b[0] - a[0]); return a.slice(1).map((c, k) => mix(rgb(c), rgb(b[k + 1]), t)); }
  }
  return table[0].slice(1).map(rgb);
}
// How much daylight there is (0 night, 1 day).
const daylight = h => clamp(Math.min((h - 5.2) / 2.2, (20 - h) / 2.2), 0, 1);
const two = n => String(n).padStart(2, '0');
const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return two(Math.floor(m / 60)) + ':' + two(m % 60); };
const pct = v => Math.round(v * 100) + '%';
const list = v => String(v ?? '').split(/[ ,]+/).filter(Boolean).map(Number);
const bellsOf = props => { const notes = list(props.notes); return list(props.heights).map((height, k) => ({ height, note: notes[k] ?? 69 })); };
const band = note => (64 * Math.log((440 * Math.pow(2, (note - 69) / 12)) / 96)) / Math.log(250);
function heard(spectrum, b) {
  const i = Math.max(0, Math.min(62, Math.floor(b))), t = b - i;
  return spectrum[i] * (1 - t) + spectrum[i + 1] * t;
}
// The settings dragged on the picture: range, and which way each drags.
const SET = {
  kbay: { lo: 0, hi: 1, axis: 'y' },
  ksea: { lo: 0, hi: 1, axis: 'y' },
  kwaves: { lo: 3, hi: 12, axis: 'x' },
  kbells: { lo: 0, hi: 1, axis: 'y' },
};
// A bell's size, and how far its lip hangs below the arm that holds it.
const BELL = 34, HANG = BELL + 8;
// Where things are: the horizon at YH, the quay from QY down; a height in metres
// is at Y(m) on the posts; the ribbon runs from RX0 to RX1 with its foot at RB;
// post k of n stands at PX(k, n), its top at TOP.
function layout(f) {
  const [hy, gx0, gx1] = list(f.props.horizon);
  const w = f.w, h = f.h, YH = hy || 222, QY = h - 54, E = 3.5, K = (QY - 12 - YH) / (E + 0.15);
  const RX0 = 236, RX1 = w - 24;
  return {
    w, h, YH, QY, RX0, RX1, RB: QY + 32, GX0: gx0 || 0, GX1: gx1 || 0,
    Y: m => YH + (E - m) * K,
    TOP: YH + (E - 2.75) * K,
    RX: hr => RX0 + (hr / 24) * (RX1 - RX0),
    RH: x => clamp(((x - RX0) / (RX1 - RX0)) * 24, 0, 24),
    PX: (k, n) => 140 + (n > 1 ? (k * 460) / (n - 1) : 230),
  };
}
// The sun by day, the moon by night, on their arcs over the hour.
function skyBody(hour, L) {
  const sun = daylight(hour) > 0.5;
  const el = sun ? Math.sin(Math.PI * clamp((hour - 5.8) / 13.8, 0, 1)) : Math.sin(Math.PI * clamp((((hour - 19.6) % 24) + 24) % 24 / 10.2, 0, 1));
  return { x: L.RX(hour), y: L.YH - 6 - el * 150, sun };
}
// The headlands: how high and how far in they reach at Bay b.
const capes = b => ({ hl: 8 + b * 56, wl: 70 + b * 150, hr: 5 + b * 44, wr: 60 + b * 160 });
function zoneAt(e, f) {
  const L = layout(f), hour = clamp(f.value('khour'), 0, 24), bells = bellsOf(f.props), n = bells.length;
  if (e.y > L.QY + 2 && e.x > L.RX0 - 10 && e.x < L.RX1 + 10) return 'hour';
  const b = skyBody(hour, L);
  if (Math.hypot(e.x - b.x, e.y - b.y) < 22) return 'hour';
  for (let k = 0; k < n; k++) {
    const px = L.PX(k, n);
    if (e.x > px - 12 && e.x < px + 24 + BELL / 2 + 6 && e.y > L.TOP - 8 && e.y < L.QY) return 'kbells';
  }
  const c = capes(f.value('kbay'));
  if (e.y > L.YH - Math.max(c.hl, c.hr) - 30 && e.y < L.YH + 10 && (e.x < Math.max(c.wl, 120) || e.x > L.w - Math.max(c.wr, 120))) return 'kbay';
  if (e.y > L.YH && e.y < L.QY) return 'water';
  return '';
}
// A bell's outline, its lip at the origin, its crown s above.
function bellPath(ctx, s) {
  const w = s / 2;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * 0.8, -s * 0.08, -w * 0.62, -s * 0.26, -w * 0.6, -s * 0.52);
  ctx.bezierCurveTo(-w * 0.58, -s * 0.86, -w * 0.42, -s, 0, -s);
  ctx.bezierCurveTo(w * 0.42, -s, w * 0.58, -s * 0.86, w * 0.6, -s * 0.52);
  ctx.bezierCurveTo(w * 0.62, -s * 0.26, w * 0.8, -s * 0.08, w, 0);
  ctx.closePath();
}
// Moves the drawing to a bell hung at (x, y) and swung by a, its lip at the origin.
function hangAt(ctx, x, y, a) {
  ctx.translate(x, y); ctx.rotate(a); ctx.translate(0, HANG);
}
// The tag by the hand: a slab of the quay's stone with the setting cut into it, on a leader from the point (its top at ty, or above the point).
function tag(ctx, text, ax, ay, stone, carve, line, w, ty) {
  ctx.font = '700 11px ' + FONT; ctx.letterSpacing = '1px'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const m = ctx.measureText(text), tw = (typeof m.width === 'number' ? m.width : text.length * 8) + 20;
  const right = ax + 16 + tw < w - 6, x0 = Math.round(right ? ax + 16 : ax - 16 - tw), y0 = Math.round(Math.max(6, ty ?? ay - 36));
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(right ? x0 : x0 + tw, y0 + 12); ctx.stroke();
  ctx.fillStyle = line; ctx.beginPath(); ctx.arc(ax, ay, 2.5, 0, TAU); ctx.fill();
  ctx.fillStyle = stone; ctx.fillRect(x0, y0, Math.round(tw), 24);
  ctx.fillStyle = carve; ctx.fillText(text, x0 + 10, y0 + 12.5);
  ctx.letterSpacing = '0px';
}
export default {
  setup(ctx, f) {
    const n = bellsOf(f.props).length;
    Object.assign(f.state, { drag: '', over: '', axis: '', hi: 0, lo: 1, sw: 0, avg: new Array(n).fill(0), last: new Array(n).fill(-10) });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, bells = bellsOf(f.props), n = bells.length, reach = f.props.reach || 0.45;
    const L = layout(f), Y = L.Y;
    const hour = clamp(f.value('khour'), 0, 24);
    const bay = f.value('kbay'), sea = f.value('ksea'), loud = f.value('kbells'), waves = f.value('kwaves');
    const [top, mid, low] = colours(SKY, hour), [far, near] = colours(SEA, hour);
    const day = daylight(hour);
    const ink = light(top) > 0.45 ? [15, 27, 43] : [244, 247, 251];
    const foam = mix([150, 170, 190], [240, 246, 246], day);
    const stone = mix([43, 47, 59], [217, 209, 191], day);
    const carve = light(stone) > 0.5 ? mix(stone, [20, 22, 28], 0.72) : mix(stone, [240, 236, 226], 0.62);
    const wood = mix([42, 44, 54], [143, 136, 124], day), wet = mix(wood, [38, 52, 46], 0.55), drowned = mix(wood, near, 0.74);
    const iron = mix([24, 26, 32], [52, 50, 54], day);
    const bronze = mix([84, 66, 60], [190, 132, 58], day), shade = mix(bronze, [40, 24, 10], 0.42), shine = mix(bronze, [255, 236, 190], 0.5);
    const zone = s.drag || s.over;
    const active = id => zone === id || (zone === 'water' && (id === 'ksea' || id === 'kwaves'));
    // The sky of this hour.
    const g = ctx.createLinearGradient(0, 0, 0, L.YH);
    g.addColorStop(0, css(top)); g.addColorStop(0.55, css(mid)); g.addColorStop(1, css(low));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, L.YH);
    // The sun or the moon over the hour, set behind the horizon when it is low.
    const body = skyBody(hour, L), hotHour = active('hour');
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, L.YH); ctx.clip();
    if (body.sun) {
      ctx.fillStyle = '#fff3d6'; ctx.beginPath(); ctx.arc(body.x, body.y, 14, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#e9edf5'; ctx.beginPath(); ctx.arc(body.x, body.y, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = css(mix(top, mid, clamp(body.y / L.YH, 0, 1))); ctx.beginPath(); ctx.arc(body.x + 5.5, body.y - 3, 10.5, 0, TAU); ctx.fill();
    }
    if (hotHour) { ctx.strokeStyle = css(ink); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(body.x, body.y, 20, 0, TAU); ctx.stroke(); }
    ctx.restore();
    // The headlands at both ends of the bay, closing in as it echoes more.
    const c = capes(bay), land = mix(mix(low, far, 0.5), ink[0] > 100 ? [8, 12, 24] : [30, 40, 56], 0.45);
    ctx.fillStyle = css(land); ctx.strokeStyle = css(ink); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, L.YH); ctx.lineTo(0, L.YH - c.hl);
    ctx.bezierCurveTo(c.wl * 0.35, L.YH - c.hl, c.wl * 0.52, L.YH - c.hl * 0.6, c.wl * 0.68, L.YH - c.hl * 0.32);
    ctx.bezierCurveTo(c.wl * 0.8, L.YH - c.hl * 0.12, c.wl * 0.92, L.YH, c.wl, L.YH);
    ctx.closePath(); ctx.fill(); if (active('kbay')) ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w, L.YH); ctx.lineTo(w, L.YH - c.hr);
    ctx.bezierCurveTo(w - c.wr * 0.25, L.YH - c.hr, w - c.wr * 0.45, L.YH - c.hr * 0.8, w - c.wr * 0.62, L.YH - c.hr * 0.42);
    ctx.bezierCurveTo(w - c.wr * 0.78, L.YH - c.hr * 0.12, w - c.wr * 0.9, L.YH, w - c.wr, L.YH);
    ctx.closePath(); ctx.fill(); if (active('kbay')) ctx.stroke();
    // The sea of this hour, paler towards the horizon.
    const g2 = ctx.createLinearGradient(0, L.YH, 0, L.QY);
    g2.addColorStop(0, css(far)); g2.addColorStop(0.3, css(mix(far, near, 0.62))); g2.addColorStop(1, css(near));
    ctx.fillStyle = g2; ctx.fillRect(0, L.YH, w, L.QY - L.YH);
    // The sun or the moon on the water: a scatter of glints under it, wider towards the quay.
    if (body.y < L.YH - 4) {
      const gl = body.sun ? [255, 243, 214] : [226, 232, 244], power = (body.sun ? 0.75 : 0.45) * (1 - (body.y - 60) / (L.YH * 1.6));
      for (let i = 0; i < 46; i++) {
        const r1 = frac(Math.sin(i * 12.9898) * 43758.5), r2 = frac(Math.sin(i * 78.233) * 12543.1);
        const d = Math.pow(i / 46, 1.4), y = L.YH + 2 + d * (L.QY - L.YH - 24);
        const x = body.x + (r1 * 2 - 1) * (4 + d * 46) + Math.sin(f.t * 0.7 + i) * 2;
        const len = 1.5 + r2 * (2 + d * 10), lit = 0.5 + 0.5 * Math.sin(f.t * (1.3 + r2 * 2) + i * 2.3);
        ctx.fillStyle = css(gl, clamp(power * (1 - d * 0.85) * lit, 0, 1));
        ctx.fillRect(x - len / 2, y, len, 1 + d);
      }
    }
    // Whitecaps on the sea: more and longer as the sea grows, drifting at the waves' pace.
    const crests = Math.round(6 + sea * 34);
    for (let i = 0; i < crests; i++) {
      const r1 = frac(Math.sin(i * 91.7) * 4375.85), r2 = frac(Math.sin(i * 47.3 + 1.3) * 9137.5), d = Math.pow(r2, 0.8);
      const y = L.YH + 5 + d * (L.QY - L.YH - 14), len = 3 + d * 14 * (0.5 + sea * 0.8);
      const x = frac(r1 + f.t * (waves / 60) * (0.012 + d * 0.03)) * (w + 60) - 30;
      const life = 0.55 + 0.45 * Math.sin(f.t * (waves / 60) * TAU + i * 1.9);
      ctx.fillStyle = css(foam, clamp((0.14 + sea * 0.4) * (0.45 + d * 0.55) * life * (active('ksea') ? 1.5 : 1), 0, 1));
      ctx.fillRect(x - len / 2, y, len, 1 + d * 1.2);
      ctx.fillRect(x - len * 0.15, y - 1 - d, len * 0.45, 1);
    }
    // The horizon, left open where the scope of the bells lies on it.
    ctx.fillStyle = f.props.line || '${HORIZON_LINE}';
    ctx.fillRect(0, L.YH - 0.75, L.GX0, 1.5); ctx.fillRect(L.GX1, L.YH - 0.75, w - L.GX1, 1.5);
    // The waves, read from how loud the sea is (below the bells' notes).
    let v = 0;
    for (let i = 1; i <= 6; i++) v += f.spectrum[i] / 6;
    s.hi = v > s.hi ? v : s.hi - (s.hi - v) * f.dt * 0.08;
    s.lo = v < s.lo ? v : s.lo + (v - s.lo) * f.dt * 0.08;
    const sw = s.hi - s.lo > 0.03 ? ((v - s.lo) / (s.hi - s.lo)) * 2 - 1 : 0;
    s.sw += (sw - s.sw) * Math.min(1, f.dt * 4);
    const now = tide(hour), live = now + reach * s.sw, wl = Y(live), wash = Y(now + reach);
    // The posts: dry above the waves, dark where they wash, fading into the water below it.
    const deep = ctx.createLinearGradient(0, wl, 0, Math.min(L.QY, wl + 120));
    deep.addColorStop(0, css(drowned)); deep.addColorStop(1, css(drowned, 0));
    for (let k = 0; k < n; k++) {
      const px = Math.round(L.PX(k, n));
      ctx.fillStyle = css(wood); ctx.fillRect(px - 4.5, L.TOP, 9, wash - L.TOP);
      ctx.fillStyle = css(wet); ctx.fillRect(px - 4.5, wash, 9, Math.max(0, wl - wash));
      ctx.fillStyle = deep; ctx.fillRect(px - 4.5, wl, 9, L.QY - wl);
      ctx.fillStyle = css(mix(wood, [0, 0, 0], 0.3)); ctx.fillRect(px - 5.5, L.TOP - 3, 11, 3);
    }
    // The bells, each on an arm off its post.
    const jumps = bells.map((b, k) => { const val = heard(f.spectrum, band(b.note)); const j = val - s.avg[k]; s.avg[k] += (val - s.avg[k]) * Math.min(1, f.dt * 2); return j; });
    let reached = 0;
    bells.forEach((b, k) => {
      const j = jumps[k];
      if (j > 0.09 && j >= (jumps[k - 1] ?? 0) && j >= (jumps[k + 1] ?? 0) && f.t - s.last[k] > 0.5) s.last[k] = f.t;
      const px = Math.round(L.PX(k, n)), bx = px + 24, lip = Y(b.height), arm = lip - HANG, inReach = Math.abs(b.height - now) <= reach;
      if (inReach) reached++;
      const age = f.t - s.last[k], ring = inReach && age < 1.6 ? 1 - age / 1.6 : 0;
      const a = Math.sin(age * 14) * (0.12 + loud * 0.3) * ring;
      ctx.fillStyle = css(arm < wl ? iron : drowned);
      ctx.fillRect(px + 4, arm - 1.5, bx - px - 2, 3);
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px + 4.5, arm + 9); ctx.lineTo(px + 13, arm + 1); ctx.stroke();
      ctx.save();
      ctx.translate(bx, arm); ctx.rotate(a);
      ctx.strokeStyle = css(shade); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 4.2, 3.6, 0, TAU); ctx.stroke();
      ctx.translate(0, HANG);
      bellPath(ctx, BELL); ctx.fillStyle = css(bronze); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = css(shade); ctx.fillRect(BELL * 0.12, -BELL - 2, BELL, BELL + 4); ctx.restore();
      ctx.strokeStyle = css(shine); ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-BELL * 0.18, -BELL * 0.8); ctx.quadraticCurveTo(-BELL * 0.26, -BELL * 0.46, -BELL * 0.36, -BELL * 0.16); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = css(shade); ctx.fillRect(-BELL / 2, -2, BELL, 2);
      ctx.beginPath(); ctx.arc(0, 3.5, 3.2, 0, TAU); ctx.fill();
      if (active('kbells')) { bellPath(ctx, BELL); ctx.strokeStyle = css(foam); ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
      // What is under the water is seen through it.
      if (lip > wl) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, wl, w, h); ctx.clip();
        hangAt(ctx, bx, arm, a); bellPath(ctx, BELL); ctx.fillStyle = css(near, 0.72); ctx.fill();
        ctx.restore();
      }
      if (ring > 0) {
        ctx.strokeStyle = css(shine, ring); ctx.lineWidth = 1.5;
        for (const r0 of [BELL * 0.8, BELL * 1.15]) {
          const rr = r0 + (1 - ring) * 10 * (0.5 + loud);
          ctx.beginPath(); ctx.arc(bx, lip - BELL / 2, rr, -0.55, 0.55); ctx.stroke();
          ctx.beginPath(); ctx.arc(bx, lip - BELL / 2, rr, Math.PI - 0.55, Math.PI + 0.55); ctx.stroke();
        }
      }
    });
    // The water on each post, lapping round it: the near side of the ring brighter.
    for (let k = 0; k < n; k++) {
      const px = Math.round(L.PX(k, n)), bob = Math.sin(f.t * 2.2 + k * 1.7) * 0.6;
      ctx.strokeStyle = css(foam, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(px, wl + bob, 11, 2.8, 0, Math.PI, TAU); ctx.stroke();
      ctx.strokeStyle = css(foam, 0.9); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(px, wl + bob, 11, 2.8, 0, 0, Math.PI); ctx.stroke();
      ctx.strokeStyle = css(foam, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px - 26, wl + 3 - bob); ctx.lineTo(px - 15, wl + 3 - bob); ctx.moveTo(px + 15, wl + 3 + bob); ctx.lineTo(px + 28, wl + 3 + bob); ctx.stroke();
    }
    // The quay: its edge, the name cut into it, and the day's tide inlaid as a ribbon in the colours of each hour's sky.
    ctx.fillStyle = css(stone); ctx.fillRect(0, L.QY, w, h - L.QY);
    ctx.fillStyle = css(mix(stone, [0, 0, 0], 0.3)); ctx.fillRect(0, L.QY, w, 2);
    ctx.fillStyle = css(mix(stone, [255, 255, 255], 0.3)); ctx.fillRect(0, L.QY + 2, w, 1);
    ctx.fillStyle = css(carve); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '800 14px ' + FONT; ctx.letterSpacing = '3px'; ctx.fillText('TIDE BELLS', 24, L.QY + 27);
    ctx.font = '500 11px ' + FONT; ctx.letterSpacing = '0.5px'; ctx.fillText('plays by itself', 24, L.QY + 43);
    ctx.letterSpacing = '0px';
    for (let x = L.RX0; x < L.RX1; x += 2) {
      const hr = L.RH(x + 1), th = 2 + clamp((tide(hr) - 0.3) / 1.8, 0, 1) * 16, [t0, m0] = colours(SKY, hr);
      ctx.fillStyle = css(mix(t0, m0, 0.35)); ctx.fillRect(x, L.RB - th, 2.4, th);
    }
    ctx.strokeStyle = css(carve, 0.45); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = L.RX0; x <= L.RX1; x += 3) ctx.lineTo(x, L.RB - 2 - clamp((tide(L.RH(x)) - 0.3) / 1.8, 0, 1) * 16 - 0.5);
    ctx.stroke();
    ctx.fillStyle = css(carve); ctx.fillRect(L.RX0, L.RB, L.RX1 - L.RX0, 1);
    ctx.font = '600 10px ' + FONT; ctx.textAlign = 'center';
    for (const hr of [0, 6, 12, 18, 24]) { const x = L.RX(hr); ctx.fillRect(Math.round(x) - 0.5, L.RB + 1, 1, 3); ctx.fillText(String(hr), x, L.RB + 15); }
    const mx = Math.round(L.RX(hour));
    ctx.fillRect(mx - (hotHour ? 1.5 : 1), L.QY + 9, hotHour ? 3 : 2, L.RB + 4 - L.QY - 9);
    ctx.beginPath(); ctx.moveTo(mx - 5, L.QY + 5); ctx.lineTo(mx + 5, L.QY + 5); ctx.lineTo(mx, L.QY + 11); ctx.closePath(); ctx.fill();
    // Now, in large plain figures, in the sky.
    const rising = tide(hour + 0.02) > now;
    ctx.textAlign = 'left'; ctx.fillStyle = css(ink);
    ctx.font = '600 62px ' + FONT; ctx.fillText(clock(hour), 20, 90);
    ctx.font = '500 15px ' + FONT;
    ctx.fillText((rising ? 'Tide coming in' : 'Tide going out') + '  ·  ' + now.toFixed(2) + ' m  ·  ' + reached + ' of ' + n + ' bells in reach', 23, 118);
    // The tag by the hand.
    const p = f.pointer;
    if (zone && p) {
      let text, ax, ay, line, ty;
      if (zone === 'hour') {
        text = 'THE HOUR ' + clock(hour) + ' ↔';
        const onSun = s.drag ? s.from === 'sun' : p.y < L.QY;
        [ax, ay, line] = onSun ? [body.x + 14, body.y + 6, css(ink)] : [mx, L.QY + 6, css(carve)];
      } else if (zone === 'kbells') {
        let k = 0;
        for (let i = 1; i < n; i++) if (Math.abs(p.x - L.PX(i, n) - 12) < Math.abs(p.x - L.PX(k, n) - 12)) k = i;
        text = 'BELLS ' + pct(loud) + ' ↕';
        // Above the row of posts, clear of the other bells.
        [ax, ay, line, ty] = [L.PX(k, n) + 24, Y(bells[k].height) - BELL / 2, css(foam), L.TOP - 36];
      } else if (zone === 'kbay') {
        text = 'ECHO OFF THE BAY ' + pct(bay) + ' ↕';
        [ax, ay, line] = [p.x, Math.min(p.y, L.YH - 2), css(ink)];
      } else {
        text = 'SEA ' + pct(sea) + ' ↕  ·  WAVES ' + waves.toFixed(1) + ' A MINUTE ↔';
        [ax, ay, line] = [p.x, p.y, css(foam)];
      }
      tag(ctx, text, ax, ay, css(stone), css(carve), line, w, ty);
    }
  },
  pointer(e, f) {
    const s = f.state, L = layout(f);
    const zone = zoneAt(e, f);
    if (e.type === 'down' && zone) {
      Object.assign(s, { drag: zone, axis: '', x0: e.x, y0: e.y, v0: {}, from: e.y < L.QY ? 'sun' : 'ribbon' });
      for (const id in SET) s.v0[id] = f.value(id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag === 'hour' && (e.type === 'down' || e.type === 'move'))
      f.set('khour', Math.round(L.RH(e.x) * 12) / 12);
    else if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = s.y0 - e.y;
      if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = s.drag === 'water' ? (s.axis === 'x' ? 'kwaves' : s.axis === 'y' ? 'ksea' : '') : s.drag;
      if (id && SET[id]) { const d = SET[id]; f.set(id, clamp(s.v0[id] + ((d.axis === 'x' ? dx : dy) / 160) * (d.hi - d.lo), d.lo, d.hi)); }
    }
    if (e.type === 'wheel' && zone) {
      if (zone === 'hour') f.set('khour', clamp(f.value('khour') + Math.sign(e.dy) * 0.25, 0, 24));
      else { const id = zone === 'water' ? 'ksea' : zone, d = SET[id]; f.set(id, clamp(f.value(id) - Math.sign(e.dy) * (d.hi - d.lo) / 40, d.lo, d.hi)); }
    }
    if (!s.drag) s.over = zone;
    const which = s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : which === 'hour' ? 'ew-resize' : which === 'water' ? 'move' : which ? 'ns-resize' : 'default');
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
        // ---- the plugin: the shore at the hour, edge to edge, in the colours of the hour ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#14465a',
              fg: '#f4f1ea',
              accent: '#c08a3e',
              track: '#1f5a70',
              knob: '#2b6a80',
              pointer: '#f4f1ea',
              muted: '#9fc0cc',
              glow: '#c08a3e',
              font: 'system',
              labelFont: 'system',
              valueFont: 'system',
            },
            background: [{ kind: 'color', color: '#14465a' }],
          },
        },
        // One pixel past each edge, so no sliver of the background shows round it.
        el({
          kind: 'canvas',
          name: 'The shore and the bells',
          code: TIDE_SHORE,
          rect: r(-1, -1, 762, 550),
          props: {
            heights: BELLS.map(b => b.height).join(' '),
            notes: BELLS.map(b => b.note).join(' '),
            reach: REACH,
            horizon: `${HORIZON.y} ${HORIZON.x0} ${HORIZON.x1}`,
            line: HORIZON_LINE,
          },
        }),
        // The bells as they ring, laid on the horizon between the headlands (the canvas leaves it open there).
        ...control(
          'horizon1',
          'ui.scope',
          'Bells over the sea',
          null,
          r(HORIZON.x0 - 1, HORIZON.y - 15, HORIZON.x1 - HORIZON.x0, 28),
          {
            style: {
              skin: {
                name: 'line',
                params: { surface: 'transparent', line: HORIZON_LINE, width: 1.5 },
              },
            },
          },
        ),
        wire('belllvl1.out', 'horizon1.in'),
      ],
    ],
  );
}

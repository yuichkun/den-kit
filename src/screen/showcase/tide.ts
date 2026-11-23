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
// screen is one canvas edge to edge: the day's tide under the sky of the hour,
// and the six bells hung as tubes on a post at the hour, wet where the waves
// wash it, topped by the sun or the moon. Each setting is dragged where it acts
// (the hour by the post or the curve, Bells by the tubes, Bay in the sky, Sea
// and Waves in the water), its value on a plate by the hand; Waves, Sea, Bells
// and Bay are kept in the patch. The one control on the plugin is a meter of
// the bells, under the name.
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
export const TIDE_CHART = `// The day's tide under the sky of the hour, and the six bells on a post at the
// hour. The hour is khour (0 to 24); the tide comes from the same table as the
// codebox's, so the curve is what the sound plays. The waves wash props.reach
// metres above and below the tide, and a bell rings while they reach its
// height: the post is wet where they wash it. The bells
// (props.heights in metres and props.notes, low to high, as lists) hang on the
// post as tubes at their heights, longer the lower the note, each with a faint
// dotted line across the day where it hangs. A tube is filled while the water
// reaches it and swings when its note jumps in the spectrum (a strike is heard);
// the water on the post bobs with the waves, read from how loud the sea is (the
// low end of the spectrum, below the bells). The sun or the moon tops the post.
// Drag the post, its sun or moon, or the curve along the day for the hour; the
// tubes up and down for Bells (kbells); the sky up and down for Bay (kbay), the
// tide's echoes hanging over the curve; the water up and down for Sea (ksea),
// its lines thicker, and left and right for Waves (kwaves), their pace. A
// setting's name and value show on a plate by the hand. Figures are drawn in the
// system font.
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
// The settings dragged on the picture: range, and which way each drags.
const SET = {
  kbay: { lo: 0, hi: 1, axis: 'y' },
  ksea: { lo: 0, hi: 1, axis: 'y' },
  kwaves: { lo: 3, hi: 12, axis: 'x' },
  kbells: { lo: 0, hi: 1, axis: 'y' },
};
// Where things are: the big figures top left; the day from L to R, edge to edge; the post's sun or moon at HEAD.
function layout(w, h) {
  const TOP = 150, BOT = h - 24, L = 0, R = w;
  return {
    TOP, BOT, L, R, HEAD: TOP - 22,
    X: hr => L + (hr / 24) * (R - L),
    H: x => ((x - L) / (R - L)) * 24,
    Y: m => BOT - (m / 2.7) * (BOT - TOP),
  };
}
// A tube's length: longer the lower its note.
const tubeLen = (k, n) => 34 - (k / Math.max(1, n - 1)) * 16;
function zoneAt(e, f) {
  const { TOP, L, R, HEAD, X, H, Y } = layout(f.w, f.h);
  const x = X(clamp(f.value('khour'), 0, 24)), bells = bellsOf(f.props);
  if (bells.length) {
    const hi = Y(Math.max(...bells.map(b => b.height))) - 8, lo = Y(Math.min(...bells.map(b => b.height))) + 40;
    if (e.x > x + 4 && e.x < x + 30 && e.y > hi && e.y < lo) return 'kbells';
  }
  if (Math.abs(e.x - x) < 14 && e.y > HEAD - 18) return 'hour';
  if (e.x < L || e.x > R || e.y < TOP - 40) return '';
  const cy = Y(tide(H(e.x)));
  if (Math.abs(e.y - cy) < 12) return 'hour';
  return e.y < cy ? 'kbay' : 'water';
}
// The plate by the hand: its text on the ink, clamped inside.
function plate(ctx, text, x, y, align, ink, paper, w) {
  ctx.font = '600 13px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * 7.5) + 16;
  const x0 = clamp(align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2, 6, w - tw - 6);
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(Math.round(x0), Math.round(y - 12), Math.round(tw), 24, 12); ctx.fill();
  ctx.fillStyle = paper; ctx.fillText(text, Math.round(x0 + 8), Math.round(y) + 0.5);
}
export default {
  setup(ctx, f) {
    const n = bellsOf(f.props).length;
    Object.assign(f.state, { drag: '', over: '', axis: '', hi: 0, lo: 1, sw: 0, avg: new Array(n).fill(0), last: new Array(n).fill(-10), day: turns(0, 24) });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, bells = bellsOf(f.props), reach = f.props.reach || 0.45;
    const { TOP, BOT, L, R, HEAD, X, H, Y } = layout(w, h);
    const hour = clamp(f.value('khour'), 0, 24);
    const bay = f.value('kbay'), sea = f.value('ksea'), loud = f.value('kbells'), waves = f.value('kwaves');
    const [top, low] = skyAt(hour);
    const ink = light(top) > 0.5 ? [15, 27, 43] : [244, 247, 251];
    const ink2 = light(low) > 0.55 ? [15, 27, 43] : [244, 247, 251];
    const day = daylight(hour);
    const water = mix([22, 56, 96], [44, 128, 196], day);
    const zone = s.drag || s.over;
    const active = id => zone === id || (zone === 'water' && (id === 'ksea' || id === 'kwaves'));
    // The sky of this hour, edge to edge.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(low));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const curve = dm => { ctx.beginPath(); for (let x = L; x <= R; x += 3) ctx.lineTo(x, Y(tide(H(x)) + dm)); };
    // Bay: the tide's echoes hang in the sky, more of them and further up as the bay opens.
    const echoes = Math.round(bay * 5);
    ctx.lineWidth = active('kbay') ? 1.5 : 1;
    for (let k = 1; k <= echoes; k++) {
      ctx.strokeStyle = css(ink2, (0.42 - k * 0.06) * (active('kbay') ? 1.5 : 1));
      ctx.beginPath(); for (let x = L; x <= R; x += 3) ctx.lineTo(x, Y(tide(H(x))) - k * 11); ctx.stroke();
    }
    // The water under the tide, its lines thicker and closer as the sea grows louder, moving at the waves' pace.
    ctx.beginPath(); ctx.moveTo(L, h);
    for (let x = L; x <= R; x += 3) ctx.lineTo(x, Y(tide(H(x))));
    ctx.lineTo(R, h); ctx.closePath();
    ctx.fillStyle = css(water, 0.66); ctx.fill();
    if (sea > 0.01) {
      ctx.save(); ctx.clip();
      const gap = 24 - sea * 12;
      ctx.strokeStyle = css(ink2, 0.07 + sea * 0.2 + (active('ksea') ? 0.12 : 0));
      ctx.lineWidth = 0.6 + sea * 0.9;
      for (let y = h - 6; y > TOP - 40; y -= gap) {
        ctx.beginPath();
        for (let x = L; x <= R; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.04 + y * 0.3 + f.t * (waves / 60) * TAU) * (active('kwaves') ? 2 : 1));
        ctx.stroke();
      }
      ctx.restore();
    }
    // Where each bell hangs, dotted across the day.
    ctx.setLineDash([2, 6]); ctx.lineWidth = 1; ctx.strokeStyle = css(ink2, 0.5);
    bells.forEach(b => { const y = Math.round(Y(b.height)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); });
    ctx.setLineDash([]);
    // The tide.
    ctx.strokeStyle = css(ink2); ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    curve(0); ctx.stroke();
    // Highs and lows, all of them, the same way; a name beside the post goes to the side away from it.
    const x = X(hour);
    ctx.font = '600 12px ' + FONT; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = css(ink2);
    for (const q of s.day) {
      const qx = X(q.h), qy = Y(q.m), near = Math.abs(qx - x) < 44;
      ctx.beginPath(); ctx.arc(qx, qy, 3, 0, TAU); ctx.fill();
      ctx.textAlign = !near ? 'center' : qx < x ? 'right' : 'left';
      const tx = !near ? qx : qx < x ? Math.min(qx + 30, x - 10) : Math.max(qx - 30, x + 32);
      ctx.fillText((q.high ? 'High ' : 'Low ') + clock(q.h), clamp(tx, 30, w - 30), q.high ? qy - 12 : qy + 22);
    }
    // The waves, read from how loud the sea is (below the bells' notes).
    let v = 0;
    for (let i = 1; i <= 6; i++) v += f.spectrum[i] / 6;
    s.hi = v > s.hi ? v : s.hi - (s.hi - v) * f.dt * 0.08;
    s.lo = v < s.lo ? v : s.lo + (v - s.lo) * f.dt * 0.08;
    const sw = s.hi - s.lo > 0.03 ? ((v - s.lo) / (s.hi - s.lo)) * 2 - 1 : 0;
    s.sw += (sw - s.sw) * Math.min(1, f.dt * 4);
    const now = tide(hour), live = now + reach * s.sw;
    // The post at the hour: wet where the waves wash it, the water on it now, and the bells hung on it.
    const hot = active('hour');
    ctx.fillStyle = css(ink2);
    ctx.fillRect(Math.round(x) - (hot ? 2 : 1.5), HEAD + 14, hot ? 4 : 3, h - HEAD - 14);
    ctx.fillRect(Math.round(x) - 3.5, Y(now + reach), 7, Y(now - reach) - Y(now + reach));
    ctx.fillRect(x - 14, Y(live) - 1, 28, 2);
    const jumps = bells.map((b, k) => { const val = at(f.spectrum, band(b.note)); const j = val - s.avg[k]; s.avg[k] += (val - s.avg[k]) * Math.min(1, f.dt * 2); return j; });
    let reached = 0;
    bells.forEach((b, k) => {
      const j = jumps[k];
      if (j > 0.09 && j >= (jumps[k - 1] ?? 0) && j >= (jumps[k + 1] ?? 0) && f.t - s.last[k] > 0.5) s.last[k] = f.t;
      const by = Y(b.height), inReach = Math.abs(b.height - now) <= reach;
      if (inReach) reached++;
      const age = f.t - s.last[k], ring = inReach && age < 1.6 ? 1 - age / 1.6 : 0;
      const hx = x + 14, len = tubeLen(k, bells.length), tw = 7 + loud * 3 + (active('kbells') ? 1 : 0);
      ctx.strokeStyle = css(ink2); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(hx, by); ctx.stroke();
      ctx.save();
      ctx.translate(hx, by); ctx.rotate(Math.sin(age * 14) * 0.3 * ring);
      ctx.fillStyle = inReach ? css(ink2) : css(mix(top, low, by / h));
      ctx.beginPath(); ctx.roundRect(-tw / 2, 1, tw, len, tw / 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (ring > 0) {
        ctx.strokeStyle = css(ink2, ring); ctx.lineWidth = 1.5;
        for (const r0 of [12, 19]) { ctx.beginPath(); ctx.arc(hx, by + len / 2, r0 + (1 - ring) * 8, -0.7, 0.7); ctx.stroke(); }
      }
    });
    // The water's mark on the curve.
    ctx.fillStyle = css(mix(top, low, Y(now) / h)); ctx.strokeStyle = css(ink2); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, Y(now), 6, 0, TAU); ctx.fill(); ctx.stroke();
    // The sun or the moon on top of the post.
    const r0 = hot ? 15 : 13, behind = css(mix(top, low, HEAD / h));
    ctx.lineWidth = 2; ctx.strokeStyle = css(ink2);
    if (day > 0.5) {
      ctx.fillStyle = '#fff3d4';
      ctx.beginPath(); ctx.arc(x, HEAD, r0, 0, TAU); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = '#eef1f7';
      ctx.beginPath(); ctx.arc(x, HEAD, r0, 0, TAU); ctx.fill();
      ctx.fillStyle = behind;
      ctx.beginPath(); ctx.arc(x + r0 * 0.45, HEAD - r0 * 0.25, r0 * 0.85, 0, TAU); ctx.fill();
    }
    // Now, in large plain figures; the name, that it plays by itself and the bells' meter's name at the right.
    const rising = tide(hour + 0.02) > now;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = css(ink);
    ctx.font = '600 58px ' + FONT; ctx.fillText(clock(hour), 20, 80);
    ctx.font = '500 17px ' + FONT; ctx.fillText((rising ? 'Rising, ' : 'Falling, ') + metres(now) + '   ·   ' + reached + ' of ' + bells.length + ' bells in reach', 23, 108);
    ctx.textAlign = 'right';
    ctx.font = '700 15px ' + FONT; ctx.fillText('Tide Bells', w - 20, 34);
    ctx.font = '500 13px ' + FONT; ctx.globalAlpha = 0.8; ctx.fillText('plays by itself', w - 20, 52);
    ctx.fillText('bells', w - 152, 72); ctx.globalAlpha = 1;
    // The plate by the hand.
    const p = f.pointer;
    if (zone && p) {
      const text = zone === 'hour' ? 'the hour ' + clock(hour) + ' ↔'
        : zone === 'kbells' ? 'bells ' + pct(loud) + ' ↕'
        : zone === 'kbay' ? 'echo off the bay ' + pct(bay) + ' ↕'
        : 'sea ' + pct(sea) + ' ↕ · waves ' + waves.toFixed(1) + ' a minute ↔';
      const at2 = zone === 'hour' ? [x + 22, HEAD, 'left'] : zone === 'kbells' ? [x + 34, p.y, 'left'] : [p.x, Math.max(16, p.y - 28), 'center'];
      plate(ctx, text, at2[0], at2[1], at2[2], css(ink2), css(mix(top, low, 0.5)), w);
    }
  },
  pointer(e, f) {
    const s = f.state, { L, R, H } = layout(f.w, f.h);
    const zone = zoneAt(e, f);
    if (e.type === 'down' && zone) {
      Object.assign(s, { drag: zone, axis: '', x0: e.x, y0: e.y, v0: {} });
      for (const id in SET) s.v0[id] = f.value(id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag === 'hour' && (e.type === 'down' || e.type === 'move'))
      f.set('khour', Math.round(clamp(H(clamp(e.x, L, R)), 0, 24) * 12) / 12);
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
        // How loud the bells ring now, beside the name the canvas draws.
        ...control('mbells', 'ui.meter', 'Bells ringing', null, r(616, 66, 124, 5), {
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

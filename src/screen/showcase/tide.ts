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
// screen is one canvas edge to edge: the day's tide (drag its handle to set the
// hour), the shore now with the six bells drawn at their heights and the band
// the waves wash, and the shore's dials as tide-table figures you drag (Waves,
// Sea, Bells and Bay are kept in the patch). The one control on the plugin is a
// meter of the bells under their dial.
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

/** The day's tide and the shore, in the colours of the sky at the hour; it takes the mouse. */
export const TIDE_CHART = `// The day's tide (left) and the shore now (right), the sky behind both in the
// colours of the hour. The hour is khour (0 to 24); the tide comes from the same
// table as the codebox's, so the curve and the water are what the sound plays.
// The bells (props.heights in metres and props.notes, low to high, as lists)
// stand on the shore at their heights; the waves wash props.reach metres above
// and below the tide (the wet band), so the bells in that band are the ones that
// ring. A bell swings when its note jumps in the spectrum (a strike is heard).
// The water on the shore rises and falls with the waves, read from how loud the
// sea is (the low end of the spectrum, below the bells). Drag the handle along
// the day to set the hour; drag a figure of the shore's dials (top right) up or
// down to set it. Figures are drawn in the system font.
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
const css = c => 'rgb(' + c.join(',') + ')';
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
// The shore's dials: control, name, range, how the figure reads.
const DIALS = [
  ['kwaves', 'waves / min', 3, 12, v => v.toFixed(1)],
  ['ksea', 'sea', 0, 1, v => Math.round(v * 100) + '%'],
  ['kbells', 'bells', 0, 1, v => Math.round(v * 100) + '%'],
  ['kbay', 'bay', 0, 1, v => Math.round(v * 100) + '%'],
];
// Where things are: the day from L to R, the shore from R to the right edge, the dials top right.
function layout(w, h) {
  const shore = w - 196, TOP = 168, BOT = h - 34;
  return {
    shore, TOP, BOT, L: 18, R: shore - 16,
    Y: m => BOT - (m / 2.7) * (BOT - TOP),
    dial: k => ({ x: w - 384 + k * 94, y: 22, w: 90, h: 60 }),
  };
}
// The ground of the shore at x, in metres (it climbs to the right).
const ground = (x, shore, w) => 0.15 + ((x - shore - 34) / (w - shore - 34)) * 2.55;
// A bell, its crown at the origin, its lip s * 16 below.
function bellPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(-2.2 * s, 0);
  ctx.lineTo(2.2 * s, 0);
  ctx.bezierCurveTo(5.4 * s, 0.6 * s, 5 * s, 8 * s, 6 * s, 11.5 * s);
  ctx.quadraticCurveTo(6.6 * s, 13.6 * s, 8.4 * s, 15 * s);
  ctx.lineTo(-8.4 * s, 15 * s);
  ctx.quadraticCurveTo(-6.6 * s, 13.6 * s, -6 * s, 11.5 * s);
  ctx.bezierCurveTo(-5 * s, 8 * s, -5.4 * s, 0.6 * s, -2.2 * s, 0);
  ctx.closePath();
}
export default {
  setup(ctx, f) {
    const n = bellsOf(f.props).length;
    Object.assign(f.state, { drag: false, over: '', hi: 0, lo: 1, sw: 0, avg: new Array(n).fill(0), last: new Array(n).fill(-10), day: turns(0, 24) });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, bells = bellsOf(f.props), reach = f.props.reach || 0.45;
    const { shore, TOP, BOT, L, R, Y, dial } = layout(w, h);
    const X = hr => L + (hr / 24) * (R - L);
    const hour = clamp(f.value('khour'), 0, 24);
    const [top, low] = skyAt(hour);
    const ink = light(top) > 0.5 ? '#0f1b2b' : '#f4f7fb';
    const ink2 = light(low) > 0.55 ? '#0f1b2b' : '#f4f7fb';
    const day = daylight(hour);
    const water = mix([22, 56, 96], [44, 128, 196], day);
    const sand = mix([34, 38, 56], [196, 176, 140], day), wet = mix([24, 28, 44], [132, 116, 92], day);
    // The sky of this hour, edge to edge.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(low));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // The day: the tide over 24 hours, the water under it to the bottom edge.
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= shore; x += 3) ctx.lineTo(x, Y(tide(((x - L) / (R - L)) * 24)));
    ctx.lineTo(shore, h); ctx.closePath();
    ctx.fillStyle = css(water); ctx.globalAlpha = 0.62; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let x = 0; x <= shore; x += 3) ctx.lineTo(x, Y(tide(((x - L) / (R - L)) * 24)));
    ctx.strokeStyle = ink2; ctx.lineWidth = 2; ctx.stroke();
    // The day's sky along the bottom edge: night at both ends; the hours above it.
    for (let x = 0; x < shore; x += 2) { ctx.fillStyle = css(skyAt(((x - L) / (R - L)) * 24)[0]); ctx.fillRect(x, h - 7, 2, 7); }
    ctx.fillStyle = '#f4f7fb'; ctx.font = '500 11px ' + FONT; ctx.globalAlpha = 0.9;
    for (const hr of [0, 6, 12, 18, 24]) { ctx.textAlign = hr === 0 ? 'left' : hr === 24 ? 'right' : 'center'; ctx.fillText(two(hr) + ':00', hr === 0 ? 4 : hr === 24 ? R + 12 : X(hr), h - 15); }
    ctx.globalAlpha = 1;
    // Highs and lows, all of them, the same way.
    const now = tide(hour), x = X(hour);
    ctx.font = '600 12px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = ink2;
    for (const q of s.day) {
      const qx = X(q.h), qy = Y(q.m), near = Math.abs(qx - x) < 52;
      ctx.beginPath(); ctx.arc(qx, qy, 2.5, 0, TAU); ctx.fill();
      ctx.fillText((q.high ? 'High ' : 'Low ') + clock(q.h) + '  ' + metres(q.m), qx, q.high ? qy - (near ? 30 : 12) : qy + (near ? 40 : 21));
    }
    // The waves, read from how loud the sea is (below the bells' notes).
    let v = 0;
    for (let i = 1; i <= 6; i++) v += f.spectrum[i] / 6;
    s.hi = v > s.hi ? v : s.hi - (s.hi - v) * f.dt * 0.08;
    s.lo = v < s.lo ? v : s.lo + (v - s.lo) * f.dt * 0.08;
    const sw = s.hi - s.lo > 0.03 ? ((v - s.lo) / (s.hi - s.lo)) * 2 - 1 : 0;
    s.sw += (sw - s.sw) * Math.min(1, f.dt * 4);
    const live = now + reach * s.sw;
    // The shore now: the ground, the band the waves wash, the bells, the water over what it covers.
    ctx.beginPath(); ctx.moveTo(shore + 34, h);
    for (let gx = shore + 34; gx <= w; gx += 4) ctx.lineTo(gx, Y(ground(gx, shore, w)));
    ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = css(sand); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = css(wet); ctx.fillRect(shore, Y(now + reach), w - shore, Y(now - reach) - Y(now + reach));
    ctx.restore();
    const jumps = bells.map((b, k) => { const val = at(f.spectrum, band(b.note)); const j = val - s.avg[k]; s.avg[k] += (val - s.avg[k]) * Math.min(1, f.dt * 2); return j; });
    let reached = 0;
    bells.forEach((b, k) => {
      const j = jumps[k];
      if (j > 0.09 && j >= (jumps[k - 1] ?? 0) && j >= (jumps[k + 1] ?? 0) && f.t - s.last[k] > 0.5) s.last[k] = f.t;
      const bx = shore + 34 + ((b.height - 0.15) / 2.55) * (w - shore - 34), gy = Y(b.height);
      const inReach = Math.abs(b.height - now) <= reach, under = b.height < now - reach;
      if (inReach) reached++;
      const age = f.t - s.last[k], ring = inReach && age < 1.6 ? 1 - age / 1.6 : 0;
      ctx.strokeStyle = ink2; ctx.lineWidth = 1.5; ctx.globalAlpha = under ? 0.5 : 1;
      ctx.beginPath(); ctx.moveTo(bx, gy); ctx.lineTo(bx, gy - 7); ctx.stroke();
      ctx.save(); ctx.translate(bx, gy - 26); ctx.rotate(Math.sin(age * 16) * 0.35 * ring);
      bellPath(ctx, 1.15);
      ctx.fillStyle = inReach ? ink2 : css(sand); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (ring > 0) {
        ctx.globalAlpha = ring; ctx.lineWidth = 1.5;
        for (const r0 of [13, 19]) { ctx.beginPath(); ctx.arc(bx, gy - 17, r0 + (1 - ring) * 8, -0.7, 0.7); ctx.stroke(); ctx.beginPath(); ctx.arc(bx, gy - 17, r0 + (1 - ring) * 8, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    });
    // The water on the shore at the tide, fading in from the day; the waves wash up the slope to where they reach now.
    const fade = ctx.createLinearGradient(shore, 0, shore + 70, 0);
    fade.addColorStop(0, 'rgba(' + water.join(',') + ',0.4)'); fade.addColorStop(1, 'rgba(' + water.join(',') + ',0.78)');
    ctx.fillStyle = fade;
    ctx.beginPath(); ctx.moveTo(shore, h);
    for (let wx = shore; wx <= w; wx += 3) ctx.lineTo(wx, Y(now) + Math.sin(wx * 0.09 - f.t * 2.2) * 2);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    if (live > now) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(shore + 34, h);
      for (let gx = shore + 34; gx <= w; gx += 4) ctx.lineTo(gx, Y(ground(gx, shore, w)));
      ctx.lineTo(w, h); ctx.closePath(); ctx.clip();
      ctx.fillStyle = css(water); ctx.globalAlpha = 0.55; ctx.fillRect(shore, Y(live), w - shore, Y(now) - Y(live));
      ctx.restore(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = ink2; ctx.lineWidth = 1.5;
    const gxAt = m => shore + 34 + ((m - 0.15) / 2.55) * (w - shore - 34);
    ctx.beginPath(); ctx.moveTo(shore + 40, Y(now)); ctx.lineTo(gxAt(now), Y(now)); ctx.stroke();
    ctx.font = '600 12px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = ink2;
    ctx.fillText(reached + ' of ' + bells.length + ' in reach', shore + 8, Y(now + reach) + 4);
    // The hour: one line and its handle on the curve.
    const hot = s.drag === 'hour' || s.over === 'hour';
    ctx.strokeStyle = ink2; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(now) + 10); ctx.lineTo(Math.round(x) + 0.5, h - 30); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(top); ctx.strokeStyle = ink2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, Y(now), hot ? 11 : 9, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink2;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + d * 16, Y(now) - 5); ctx.lineTo(x + d * 22, Y(now)); ctx.lineTo(x + d * 16, Y(now) + 5); ctx.closePath(); ctx.fill(); }
    // Now, in large plain figures, under the name; it plays by itself.
    const rising = tide(hour + 0.02) > now;
    ctx.textAlign = 'left'; ctx.fillStyle = ink;
    ctx.font = '700 15px ' + FONT; ctx.fillText('Tide Bells', 22, 34);
    ctx.font = '500 13px ' + FONT; ctx.globalAlpha = 0.8; ctx.fillText('plays by itself', 112, 34); ctx.globalAlpha = 1;
    ctx.font = '600 58px ' + FONT; ctx.fillText(clock(hour), 20, 96);
    ctx.font = '500 17px ' + FONT; ctx.fillText((rising ? 'Rising' : 'Falling') + ', ' + metres(now), 23, 124);
    // The shore's dials, like a tide table: drag a figure up or down.
    DIALS.forEach(([id, name, , , show], k) => {
      const d = dial(k), on = s.over === 'dial' + k || (s.drag === 'dial' && s.k === k);
      ctx.fillStyle = ink; ctx.textAlign = 'left';
      ctx.font = '500 12px ' + FONT; ctx.globalAlpha = 0.85; ctx.fillText(name, d.x, d.y + 12); ctx.globalAlpha = 1;
      ctx.font = '600 26px ' + FONT; ctx.fillText(show(f.value(id)), d.x, d.y + 44);
      const tw = ctx.measureText(show(f.value(id))).width;
      ctx.globalAlpha = on ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(d.x + tw + 6, d.y + 29); ctx.lineTo(d.x + tw + 10, d.y + 24); ctx.lineTo(d.x + tw + 14, d.y + 29); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(d.x + tw + 6, d.y + 35); ctx.lineTo(d.x + tw + 10, d.y + 40); ctx.lineTo(d.x + tw + 14, d.y + 35); ctx.closePath(); ctx.fill();
      if (on) ctx.fillRect(d.x, d.y + 50, tw, 1.5);
      ctx.globalAlpha = 1;
    });
  },
  pointer(e, f) {
    const s = f.state, { shore, R, L, dial } = layout(f.w, f.h);
    let k = -1;
    for (let i = 0; i < DIALS.length; i++) { const d = dial(i); if (e.x >= d.x && e.x <= d.x + d.w && e.y >= d.y && e.y <= d.y + d.h) k = i; }
    const inDay = e.x < shore && e.y > 136;
    if (e.type === 'down') {
      if (k >= 0) Object.assign(s, { drag: 'dial', k, y0: e.y, v0: f.value(DIALS[k][0]) });
      else if (inDay) s.drag = 'hour';
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = false;
    if (s.drag === 'hour' && (e.type === 'down' || e.type === 'move'))
      f.set('khour', Math.round(clamp(((e.x - L) / (R - L)) * 24, 0, 24) * 12) / 12);
    if (s.drag === 'dial' && e.type === 'move') {
      const [id, , lo, hi] = DIALS[s.k];
      f.set(id, clamp(s.v0 + ((s.y0 - e.y) / 160) * (hi - lo), lo, hi));
    }
    if (e.type === 'wheel') {
      if (k >= 0) { const [id, , lo, hi] = DIALS[k]; f.set(id, clamp(f.value(id) - Math.sign(e.dy) * (hi - lo) / 40, lo, hi)); }
      else if (inDay) f.set('khour', clamp(f.value('khour') + Math.sign(e.dy) * 0.25, 0, 24));
    }
    if (!s.drag) s.over = k >= 0 ? 'dial' + k : inDay ? 'hour' : '';
    f.cursor(s.drag === 'hour' ? 'grabbing' : s.drag === 'dial' || k >= 0 ? 'ns-resize' : inDay ? 'ew-resize' : 'default');
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
        // ---- the plugin: the day's tide and the shore, edge to edge, in the colours of the hour ----
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
          name: 'The day’s tide and the shore',
          code: TIDE_CHART,
          rect: r(0, 0, 760, 548),
          props: {
            heights: BELLS.map(b => b.height).join(' '),
            notes: BELLS.map(b => b.note).join(' '),
            reach: REACH,
          },
        }),
        // How loud the bells ring now, under their dial.
        ...control('mbells', 'ui.meter', 'Bells ringing', null, r(564, 78, 64, 3), {
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

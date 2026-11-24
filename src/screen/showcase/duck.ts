// Yield — a delay whose echoes give way while you play and come back when you stop.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop.
// The design follows the thinking of the ABB A400 EV charger's interface (iF
// DESIGN AWARD 2025): the clarity of road signs — heavy type, basic shapes,
// fixed and moving graphics together, and colours that always mean the same
// thing. The plugin is one canvas, a road seen from beside and above it as it
// goes away to the right, under an overhead sign that hides where it ends, read
// in time: you stand at its start as the priority road's diamond, and the
// echoes stand after you along it as give-way signs, one every Repeat, smaller
// the further they are. The rule hangs over the road on the overhead sign, with
// the plugin's name. Red is the one colour for giving way: the edge of each
// give-way sign, which grows while the echoes give way, and the rule. Every
// setting is dragged on the shape it changes, its value on a plate on that
// shape's post while the hand is on it; the controls are kept in the patch. The
// one control on the plugin is a meter of how far the echoes are giving way
// now: a give-way sign on the overhead sign whose white, what the echoes keep,
// sinks to its point as they give way, leaving red.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The colour that means "the echoes are giving way", everywhere on the plugin. */
const GIVE = '#c81e24';
/** The overhead sign, and the meter on it: a give-way sign whose white sinks to its point as the echoes give way. */
const SIGN = { x: 16, y: 16, w: 736, h: 118 };
const NOW = { x: 658, y: 34, w: 58 };

/** The road: you, the echoes after you and the rule over it; each setting is dragged on its shape. */
export const ROAD = `// The road, seen from beside and above it as it goes away to the right, over
// flat ground to the horizon under the overhead sign. You stand at its start, a
// diamond on your post as big as what you play now, over a thin diamond
// outline: When louder than (kthresh). The echoes stand after you along the
// road's far side as give-way signs, one every Repeat (ktime), smaller the
// further down the road they are, as the road narrows; each whole sign, post and
// face, fades into the ground the quieter its echo is against you (Echo level
// kmix for the first, each next one Feedback kfb of the last; gone 40 dB down),
// its corners a little rounder each time round the loop's lowpass (Tone ktone).
// While you play louder than the threshold the echoes give way: the white of
// each sign shrinks with what it gives way and its red edge grows.
// What you play runs away down the middle of the road from where you stand, as
// wide as it was loud, and each echo jumps as a note reaches it.
// What you play is worked out from the output level (a canvas hears only the
// output): the output's own echoes, placed as the settings place them, are
// taken out of it; that is held against When louder than (with the ducker's
// 3 dB of hysteresis), and the echoes drop by Depth (kdepth) in 8 ms and come
// back over Back after (krel). The output is read after the app's volume, so
// the threshold is only near.
// Over the road hangs the overhead sign: the plugin's name (text on the
// plugin), the rule, and the meter of how far the echoes give way now (a
// give-way sign on the plugin, its red rim drawn here). The rule: across is
// 1.5 s; while you play (0.1 s to 0.5 s, your diamond over it) the echoes'
// level drops by Depth, full height 40 dB, then comes back over Back after, the
// time it takes to get most of the way; red is what they give way.
// Drag your diamond up and down for When louder than; the first echo, or the
// road up to it, along the road for Repeat and up and down for Echo level (when
// it stands close to you, the half nearer to it is its); a later echo, or the
// road after the first, up and down for Feedback and left and right for Tone;
// the overhead sign up and down for Depth and left and right for Back after. A
// drag keeps to the direction it starts in; scrolling moves the up-and-down
// setting. While the hand is on a shape, the settings it moves show on a plate
// on its post, or for the rule on the overhead sign.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const RED = '${GIVE}', WHITE = '#ffffff', ROADC = '#505456', LINE = '#e4e3dd', METAL = '#6b6e6f', SKY = '#e4e2dc';
const FLOOR = -60, MAXK = 12, RULE = 1.5, ROOT3 = Math.sqrt(3);
const SIGN = ${JSON.stringify(SIGN)}, NOW = ${JSON.stringify(NOW)};
const A = { l: 288, r: 590, top: 74, bot: 120 }; // the rule's drawing on the overhead sign
// The road: it goes away towards VP (off to the right); P0 is its far edge where you stand,
// ACROSS its width there. Down the road t seconds, a thing looks 1 / (1 + K t) as big.
const VP = { x: 900, y: 176 }, P0 = { x: 168, y: 412 }, ACROSS = { x: 270, y: 106 }, K = 0.75;
const SIDE = -0.035; // the posts stand just beyond the far edge
const POST = 100, H1 = 84, DH = 62; // at your place: a post's height to its sign, a give-way sign, half your diamond at 0 dB
const RIM = 0.72; // a give-way sign's white against its red edge, when it gives nothing
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const at = (hist, t) => {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1];
  return 0;
};
const secs = s => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');
const hz = v => (v < 1000 ? Math.round(v) + ' Hz' : (v / 1000).toFixed(1) + ' kHz');
const pct = v => Math.round(v * 100) + '%';
const dB = v => (Math.round(v) < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' dB';
const near = t => 1 / (1 + K * t);
// How strong an echo's sign stands, 0 to 1, for its level against you: full at 0 dB and over, gone 40 dB down.
const strength = a => clamp(1 + (20 * Math.log10(Math.max(a, 1e-6))) / 40, 0, 1);
// A colour part of the way u into another (both #rrggbb; else left as it is): a sign faded into the ground.
function into(a, b, u) {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(a) || !hex.test(b)) return a;
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), x = rgb(a), y = rgb(b);
  return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * u)).join(',') + ')';
}
// A point on the ground t seconds down the road, u across it (0 its far edge, 1 its near edge).
function ground(t, u) {
  const s = near(t);
  return { x: VP.x + (P0.x + u * ACROSS.x - VP.x) * s, y: VP.y + (P0.y + u * ACROSS.y - VP.y) * s, s };
}
// How far down the road a post at x stands.
const tAt = x => (1 / clamp((VP.x - x) / (VP.x - P0.x - SIDE * ACROSS.x), 0.1, 3) - 1) / K;
// The settings' ranges, and which one each part of the road moves by the way it is dragged.
const SET = {
  kthresh: { lo: -60, hi: 0 },
  ktime: { lo: 0.05, hi: 1.2 },
  kmix: { lo: 0, hi: 1.5 },
  kfb: { lo: 0, hi: 0.9 },
  ktone: { lo: 800, hi: 12000 },
  kdepth: { lo: 0, hi: 40 },
  krel: { lo: 0.05, hi: 1.5 },
};
const AXES = {
  you: { y: 'kthresh' },
  first: { x: 'ktime', y: 'kmix' },
  later: { x: 'ktone', y: 'kfb' },
  rule: { x: 'krel', y: 'kdepth' },
};
// A give-way sign: a triangle on its point, centred at (x, y), H tall, its corners rounded by r.
function tri(ctx, x, y, H, r) {
  const hw = H / ROOT3, top = y - H / 3, tip = y + (2 * H) / 3, rr = Math.min(r, H * 0.3);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.arcTo(x + hw, top, x, tip, rr);
  ctx.arcTo(x, tip, x - hw, top, rr);
  ctx.arcTo(x - hw, top, x + hw, top, rr);
  ctx.closePath();
}
// The priority road's diamond, centred at (x, y), hh from its centre to a corner.
function diamond(ctx, x, y, hh) {
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hh, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hh, y);
  ctx.closePath();
}
function quad(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}
const textWidth = (ctx, text, size) => {
  const m = ctx.measureText(text);
  return typeof m.width === 'number' ? m.width : text.length * size * 0.6;
};
// A plate on a post with the settings of the shape the hand is on: white, ruled in black, like the plates under
// road signs; its top at y.
function plate(ctx, ink, lines, x, y, size) {
  ctx.font = '700 ' + size.toFixed(1) + 'px ' + FONT;
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, textWidth(ctx, l, size));
  tw = Math.round(tw + size * 1.3);
  const lh = size * 1.3, ph = Math.round(lines.length * lh + size * 0.7), x0 = Math.round(x - tw / 2), y0 = Math.round(y);
  ctx.fillStyle = WHITE;
  ctx.fillRect(x0, y0, tw, ph);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.75, y0 + 0.75, tw - 1.5, ph - 1.5);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + size * 0.35 + lh * (i + 0.5) + 0.5));
}
function zoneAt(e, f) {
  if (e.x >= SIGN.x && e.x <= SIGN.x + SIGN.w && e.y >= SIGN.y && e.y <= SIGN.y + SIGN.h) return 'rule';
  if (e.y < SIGN.y + SIGN.h + 6) return '';
  const you = ground(0, SIDE), T = Math.max(0.01, f.value('ktime')), first = ground(T, SIDE);
  if (e.x < Math.min(you.x + DH + 8, (you.x + first.x) / 2)) return 'you';
  return e.x <= first.x + Math.max((H1 * first.s) / ROOT3, 28) ? 'first' : 'later';
}
// How a drag moves a setting: the shapes follow the hand where they can.
function move(id, v0, dx, dy, s) {
  const d = SET[id];
  let v;
  if (id === 'ktime') v = tAt(s.sx + dx);
  else if (id === 'kmix') v = v0 - dy / (H1 * s.ss);
  else if (id === 'kthresh') v = v0 + (dy / DH) * FLOOR;
  else if (id === 'kfb') v = v0 - (dy / 160) * (d.hi - d.lo);
  else if (id === 'kdepth') v = v0 + (dy / (A.bot - A.top)) * 40;
  else v = v0 * Math.pow(d.hi / d.lo, dx / 200);
  return clamp(v, d.lo, d.hi);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { hist: [], r: 0, on: false, show: -120, slow: -120, notes: [], last: -10, drag: '', over: '', axis: '' });
  },
  draw(ctx, f) {
    const s = f.state;
    if (!s.hist) Object.assign(s, { hist: [], r: 0, on: false, show: -120, slow: -120, notes: [], last: -10, drag: '', over: '', axis: '' });
    const w = f.w, h = f.h, ink = f.color('fg'), field = f.color('bg');
    const T = Math.max(0.01, f.value('ktime')), fb = f.value('kfb'), mix = f.value('kmix');
    const tone = f.value('ktone'), depth = f.value('kdepth'), thresh = f.value('kthresh');
    const rel = Math.max(0.01, f.value('krel'));
    // What you play: the output less its own echoes.
    const g = Math.pow(10, -s.r / 20);
    let e2 = 0;
    for (let k = 1; k <= MAXK; k++) {
      const a = mix * Math.pow(fb, k - 1);
      if (a < 0.003) break;
      e2 += (a * at(s.hist, f.t - k * T)) ** 2;
    }
    const dry = Math.sqrt(Math.max(0, f.level * f.level - g * g * e2));
    const level = 20 * Math.log10(dry + 1e-9);
    s.on = level >= thresh || (s.on && level > thresh - 3);
    const target = s.on ? depth : 0;
    s.r += (target - s.r) * (1 - Math.exp(-f.dt / (target > s.r ? 0.008 : rel)));
    s.hist.push([f.t, dry]);
    while (s.hist.length && s.hist[0][0] < f.t - Math.max(4, MAXK * T) - 0.5) s.hist.shift();
    // A note: the level jumps 6 dB over where it has been.
    if (level > s.slow + 6 && level > FLOOR + 12 && f.t - s.last > 0.15) {
      s.notes.push(f.t);
      s.last = f.t;
    }
    s.slow += (level - s.slow) * (1 - Math.exp(-f.dt / 0.25));
    while (s.notes.length && s.notes[0] < f.t - MAXK * T - 1) s.notes.shift();
    s.show = level > s.show ? level : s.show + (level - s.show) * (1 - Math.exp(-f.dt / 0.12));
    const active = id => s.over === id || s.drag === id;
    const frac = v => clamp((v - FLOOR) / -FLOOR, 0, 1);
    // The sky down to the horizon, and the flat ground from it.
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, w, VP.y);
    ctx.fillStyle = field;
    ctx.fillRect(0, VP.y, w, h - VP.y);
    // The road, its edge lines and its middle line, away to the right.
    const NEAR = -0.85, FAR = 40;
    ctx.fillStyle = ROADC;
    quad(ctx, [ground(NEAR, 0), ground(FAR, 0), ground(FAR, 1), ground(NEAR, 1)]);
    ctx.fillStyle = LINE;
    for (const [u0, u1] of [[0.035, 0.045], [0.955, 0.965]]) quad(ctx, [ground(NEAR, u0), ground(FAR, u0), ground(FAR, u1), ground(NEAR, u1)]);
    // The middle line is what you play: its dashes run away down the road from where you stand,
    // each as wide as you played while it passed you.
    const DASH = 0.25, LONG = 0.13;
    for (let m = Math.floor((f.t + 0.85) / DASH); m >= 0; m--) {
      const t0 = f.t - m * DASH;
      if (t0 > 12) break;
      let v = 0;
      if (t0 >= 0) for (let a = 0; a <= LONG; a += 0.02) v = Math.max(v, at(s.hist, m * DASH - a));
      const half = 0.008 + 0.1 * frac(20 * Math.log10(v + 1e-9));
      quad(ctx, [ground(t0, 0.5 - half), ground(t0 + LONG, 0.5 - half), ground(t0 + LONG, 0.5 + half), ground(t0, 0.5 + half)]);
    }
    // The echoes, the furthest first: each a give-way sign on its post, its red edge growing as it gives way.
    const q = (Math.log(12000 / tone) / Math.log(15)) * 0.48;
    const signs = [];
    for (let k = 1; k <= MAXK; k++) {
      // The whole sign, post and face, as big as its place down the road makes it; as strong as its echo is loud.
      const p = ground(k * T, SIDE), strong = strength(mix * Math.pow(fb, k - 1)), H = H1 * p.s;
      if (k > 1 && (p.x - H / ROOT3 > w || strong <= 0)) break;
      signs.push({ k, x: p.x, foot: p.y, s: p.s, strong, tip: p.y - POST * p.s, H, r: 0.25 * (1 - Math.exp(-k * q)) });
    }
    const give = clamp(s.r / 40, 0, 1);
    for (let i = signs.length - 1; i >= 0; i--) {
      const { k, x, foot, s: sc, strong, tip, H, r } = signs[i];
      ctx.fillStyle = METAL;
      if (strong <= 0) {
        // No echo: an outline where the first would stand, to drag it back up.
        const y = tip - (2 * H) / 3;
        tri(ctx, x, y, H, 0);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // A note reaching the echo: its sign jumps up on its post and settles back.
      let ping = 0;
      for (const n of s.notes) {
        const age = f.t - n - k * T;
        if (age >= 0 && age < 0.45) ping = Math.max(ping, 1 - age / 0.45);
      }
      const face = H * (1 + 0.14 * ping), y = tip - (2 * face) / 3, pw = Math.max(1.5, 5 * sc), fade = 1 - strong;
      ctx.fillStyle = into(METAL, field, fade);
      ctx.fillRect(x - pw / 2, y, pw, foot - y);
      tri(ctx, x, y, face, r * face);
      ctx.fillStyle = into(RED, field, fade);
      ctx.fill();
      const inner = face * RIM * (1 - give);
      if (inner > 1) {
        tri(ctx, x, y, inner, r * inner);
        ctx.fillStyle = into(WHITE, field, fade);
        ctx.fill();
      }
      if (active(i === 0 ? 'first' : 'later')) {
        tri(ctx, x, y, face + 14 * sc, r * (face + 14 * sc));
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // You: your post, the diamond as big as what you play, and When louder than as a thin outline.
    const you = ground(0, SIDE), cy = you.y - POST;
    ctx.fillStyle = METAL;
    ctx.fillRect(you.x - 3, cy, 6, you.y - cy);
    const hh = Math.max(8, DH * frac(s.show)), th = DH * frac(thresh);
    diamond(ctx, you.x, cy, hh);
    ctx.fillStyle = WHITE;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    diamond(ctx, you.x, cy, hh * 0.72);
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = active('you') ? 3 : 2;
    diamond(ctx, you.x, cy, th);
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.save();
    diamond(ctx, you.x, cy, hh * 0.72);
    ctx.clip();
    diamond(ctx, you.x, cy, th);
    ctx.strokeStyle = WHITE;
    ctx.stroke();
    ctx.restore();
    // The overhead sign: hung from above, black, ruled in white; the name, the rule, now.
    ctx.fillStyle = METAL;
    for (const x of [SIGN.x + 120, SIGN.x + SIGN.w - 120]) ctx.fillRect(x - 4, 0, 8, SIGN.y + 8);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(SIGN.x, SIGN.y, SIGN.w, SIGN.h, 10);
    ctx.fill();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = active('rule') ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(SIGN.x + 7, SIGN.y + 7, SIGN.w - 14, SIGN.h - 14, 6);
    ctx.stroke();
    ctx.fillStyle = WHITE;
    for (const x of [252, 626]) ctx.fillRect(x - 1.5, SIGN.y + 7, 3, SIGN.h - 14);
    // The rule: while you play, the echoes' level drops by Depth and comes back over Back after.
    const tx = t => A.l + (t / RULE) * (A.r - A.l);
    const dy = d => A.top + (Math.min(40, d) / 40) * (A.bot - A.top);
    const lvl = t => (t < 0.1 ? 0 : t < 0.5 ? depth : depth * Math.exp(-(t - 0.5) / rel));
    const curve = () => {
      for (let x = A.l; x <= A.r; x += 2) ctx.lineTo(x, dy(lvl(((x - A.l) / (A.r - A.l)) * RULE)));
    };
    ctx.beginPath();
    ctx.moveTo(A.l, A.top);
    curve();
    ctx.lineTo(A.r, A.top);
    ctx.closePath();
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.beginPath();
    curve();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'miter';
    ctx.stroke();
    const ey = dy(lvl(RULE));
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(A.r + 12, ey);
    ctx.lineTo(A.r, ey - 7);
    ctx.lineTo(A.r, ey + 7);
    ctx.closePath();
    ctx.fill();
    // While you play: your diamond over the time you play, bracketed.
    const b0 = tx(0.1), b1 = tx(0.5);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b0, SIGN.y + 52);
    ctx.lineTo(b0, SIGN.y + 46);
    ctx.lineTo(b1, SIGN.y + 46);
    ctx.lineTo(b1, SIGN.y + 52);
    ctx.stroke();
    diamond(ctx, (b0 + b1) / 2, SIGN.y + 29, 12);
    ctx.fillStyle = WHITE;
    ctx.fill();
    diamond(ctx, (b0 + b1) / 2, SIGN.y + 29, 7.5);
    ctx.fillStyle = ink;
    ctx.fill();
    // Now: the meter is the white of a give-way sign; its red edge is drawn here.
    const nh = (NOW.w * ROOT3) / 2, nx = NOW.x + NOW.w / 2, ny = NOW.y + nh / 3;
    tri(ctx, nx, ny, nh / RIM, 0);
    ctx.fillStyle = RED;
    ctx.fill();
    // The settings of the shape under the hand: on a plate on its post, or for the rule on the overhead sign.
    const z = s.drag || s.over;
    const on = k => {
      const g = ground(k * T, SIDE), q = signs[k - 1] || { x: g.x, s: g.s, tip: g.y - POST * g.s };
      return { x: q.x, y: q.tip + 8 * q.s, size: Math.max(11, 13 * q.s) };
    };
    if (z === 'you') plate(ctx, ink, ['louder than', dB(thresh)], you.x, cy + DH + 10, 13);
    if (z === 'first') { const q = on(1); plate(ctx, ink, ['every ' + secs(T), 'level ' + pct(mix)], q.x, q.y, q.size); }
    if (z === 'later') { const q = on(2); plate(ctx, ink, ['tone ' + hz(tone), 'each ' + pct(fb) + ' of the last'], q.x, q.y, q.size); }
    if (z === 'rule') {
      ctx.font = '700 13px ' + FONT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = WHITE;
      ctx.fillText('gives way ' + dB(depth) + ' · back in ' + secs(rel), A.r + 14, SIGN.y + 29);
    }
  },
  pointer(e, f) {
    const s = f.state, zone = zoneAt(e, f);
    if (e.type === 'down' && zone) {
      Object.assign(s, { drag: zone, axis: AXES[zone].x ? '' : 'y', x0: e.x, y0: e.y, from: {} });
      for (const id of Object.values(AXES[zone])) s.from[id] = f.value(id);
      const T = Math.max(0.01, f.value('ktime')), p = ground(T, SIDE);
      Object.assign(s, { sx: p.x, ss: p.s });
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = e.y - s.y0;
      if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = s.axis && AXES[s.drag][s.axis];
      if (id) f.set(id, move(id, s.from[id], dx, dy, s));
    }
    if (e.type === 'wheel' && zone) {
      const id = AXES[zone].y, d = SET[id];
      f.set(id, clamp(f.value(id) - (Math.sign(e.dy) * (d.hi - d.lo)) / 60, d.lo, d.hi));
    }
    if (!s.drag) s.over = zone;
    const z = s.drag || zone;
    f.cursor(!z ? 'default' : z === 'you' ? 'ns-resize' : s.drag ? 'grabbing' : 'grab');
  },
};
`;

export function duck(catalog: Catalog) {
  return work(
    'duck',
    'Yield',
    catalog,
    [768, 444],
    [
      // ---- sound ----
      add('in1', 'kit.audioIn'),
      add('dly1', 'den.delayFx', {
        config: { maxDelaySeconds: 2, tone: 'lowpass', stereoPhaseCycles: 0.5 },
        values: {
          timeLeftSeconds: 0.375,
          timeRightSeconds: 0.5,
          feedback: 0.5,
          cutoffHz: 4000,
          mix: 1,
        },
      }),
      add('duck1', 'den.dynamics', {
        label: 'Ducker',
        config: { mode: 'rms', operation: 'duck' },
        values: { thresholdDb: -32, ratio: 8, rangeDb: 24, attack: 0.008, release: 0.35 },
      }),
      add('mixl1', 'kit.mix', { label: 'Mix L', config: { channels: 2 }, values: { level2: 0.8 } }),
      add('mixr1', 'kit.mix', { label: 'Mix R', config: { channels: 2 }, values: { level2: 0.8 } }),
      add('out1', 'kit.out'),
      wire('in1.left', 'dly1.left'),
      wire('in1.right', 'dly1.right'),
      wire('dly1.left', 'duck1.left'),
      wire('dly1.right', 'duck1.right'),
      wire('in1.left', 'duck1.sidechainLeft'),
      wire('in1.right', 'duck1.sidechainRight'),
      wire('in1.left', 'mixl1.in1'),
      wire('duck1.left', 'mixl1.in2'),
      wire('in1.right', 'mixr1.in1'),
      wire('duck1.right', 'mixr1.in2'),
      wire('mixl1.out', 'out1.left'),
      wire('mixr1.out', 'out1.right'),
      // ---- the plugin: the road; each setting is dragged on its shape ----
      ...patchControl(
        'ktime',
        'Repeat',
        ['dly1.timeLeftSeconds', 'dly1.timeRightSeconds'],
        [0.05, 1.2, 'log', 's'],
        0.375,
      ),
      ...patchControl('kfb', 'Feedback', 'dly1.feedback', [0, 0.9, 'linear', ''], 0.5),
      ...patchControl('ktone', 'Tone', 'dly1.cutoffHz', [800, 12000, 'log', 'Hz'], 4000),
      ...patchControl(
        'kmix',
        'Echo level',
        ['mixl1.level2', 'mixr1.level2'],
        [0, 1.5, 'linear', ''],
        0.8,
      ),
      ...patchControl('kdepth', 'Depth', 'duck1.rangeDb', [0, 40, 'linear', 'dB'], 24),
      ...patchControl(
        'kthresh',
        'When louder than',
        'duck1.thresholdDb',
        [-60, 0, 'linear', 'dB'],
        -32,
      ),
      ...patchControl('krel', 'Back after', 'duck1.release', [0.05, 1.5, 'log', 's'], 0.35),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#d2d0c9',
            fg: '#111111',
            accent: GIVE,
            track: '#b9b7b0',
            knob: '#ffffff',
            pointer: '#111111',
            muted: '#4c4b47',
            glow: GIVE,
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'lato',
          },
          background: [{ kind: 'color', color: '#d2d0c9' }],
          skins: {
            meter: { name: 'bar', params: { fill: '#ffffff', surface: GIVE, scale: false } },
          },
          // The meter is a give-way sign: cut to the triangle, its white (what the echoes keep, the ducker's gain on
          // the meter's dB scale) sinks to its point as they give way, leaving red.
          css: '[data-widget=grm1] dk-scope::part(canvas) { clip-path: polygon(0 0, 100% 0, 50% 86.6%); border-radius: 0; }',
        },
      },
      el({ kind: 'canvas', name: 'The road', code: ROAD, rect: r(0, 0, 768, 444) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'YIELD',
        rect: r(SIGN.x + 22, SIGN.y + 20, 200, 80),
        textStyle: { font: 'bebas-neue', size: 84, color: '#ffffff', align: 'left', spacing: 0.04 },
      }),
      // How far the echoes give way now: a give-way sign on the overhead sign.
      ...control('grm1', 'ui.meter', 'Giving way', null, r(NOW.x, NOW.y, NOW.w, NOW.w)),
      wire('duck1.gain', 'grm1.in'),
    ],
  );
}

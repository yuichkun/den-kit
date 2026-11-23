// Yield — a delay whose echoes give way while you play and come back when you stop.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop.
// The design follows the thinking of the ABB A400 EV charger's interface (iF
// DESIGN AWARD 2025): the clarity of road signs — heavy type, basic shapes,
// fixed and moving graphics together, and colours that always mean the same
// thing. The plugin is one canvas, a road seen from beside it as it goes away
// to the right, read in time: you stand at its start as the priority road's
// diamond, and the echoes stand after you along it as give-way signs, one every
// Repeat, smaller the further they are. The rule hangs over the road on an
// overhead sign, with the plugin's name. Red is the one colour for giving way:
// the edge of each give-way sign, which grows while the echoes give way, and the
// rule. Every setting is dragged on the shape it changes, its value on a sign
// by it while the hand is on it; the controls are kept in the patch. The one
// control on the plugin is a meter of how far the echoes are giving way now: a
// give-way sign on the overhead sign that fills with red.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The colour that means "the echoes are giving way", everywhere on the plugin. */
const GIVE = '#c81e24';
/** The overhead sign, and the meter on it: a give-way sign whose white fills with red. */
const SIGN = { x: 16, y: 16, w: 736, h: 118 };
const NOW = { x: 658, y: 34, w: 58 };

/** The road: you, the echoes after you and the rule over it; each setting is dragged on its shape. */
export const ROAD = `// The road, seen from beside it as it goes away to the right. You stand at its
// start, a diamond on your post as big as what you play now, over a dashed
// diamond: When louder than (kthresh). The echoes stand after you along the
// road's far side as give-way signs, one every Repeat (ktime), smaller the
// further down the road they are; each is as big against its post as it is loud
// against you (Echo level kmix for the first, each next one Feedback kfb of the
// last), its corners a little rounder each time round the loop's lowpass (Tone
// ktone), and a plate on its post says when it comes. While you play louder
// than the threshold the echoes give way: the white of each sign shrinks with
// what it gives way and its red edge grows. What you play runs away down the
// middle of the road from where you stand, as wide as it was loud, and each
// echo answers as a note reaches it.
// What you play is worked out from the output level (a canvas hears only the
// output): the output's own echoes, placed as the settings place them, are
// taken out of it; that is held against When louder than (with the ducker's
// 3 dB of hysteresis), and the echoes drop by Depth (kdepth) in 8 ms and come
// back over Back after (krel). The output is read after the app's volume, so
// the threshold is only near.
// Over the road hangs the overhead sign: the plugin's name (text on the
// plugin), the rule, and the meter of how far the echoes give way now (a
// give-way sign on the plugin, its rim drawn here). The rule: across is 1.5 s;
// while you play (0.1 s to 0.5 s) the echoes' level drops by Depth, full height
// 40 dB, then comes back over Back after, the time it takes to get most of the
// way; red is what they give way.
// Drag your diamond up and down for When louder than; the first echo, or the
// road up to it, along the road for Repeat and up and down for Echo level; a
// later echo, or the road after the first, up and down for Feedback and left
// and right for Tone; the overhead sign up and down for Depth and left and
// right for Back after. A drag keeps to the direction it starts in; scrolling
// moves the up-and-down setting. The settings a shape moves show on a sign by
// it while the hand is on it.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const RED = '${GIVE}', WHITE = '#ffffff', ROADC = '#1d2323', METAL = '#5d7570', SKY = '#d6efe8';
const FLOOR = -60, MAXK = 12, RULE = 1.5, ROOT3 = Math.sqrt(3);
const SIGN = ${JSON.stringify(SIGN)}, NOW = ${JSON.stringify(NOW)};
const A = { l: 288, r: 590, top: 76, bot: 112 }; // the rule's drawing on the overhead sign
// The road: it goes away towards VP (off to the right); P0 is its far edge where you stand,
// ACROSS its width there. Down the road t seconds, a thing looks 1 / (1 + K t) as big.
const VP = { x: 900, y: 170 }, P0 = { x: 168, y: 412 }, ACROSS = { x: 330, y: 130 }, K = 0.75;
const SIDE = -0.035; // the posts stand just beyond the far edge
const POST = 168, H1 = 128, DH = 62; // at your place: a post's height to its sign, an echo as loud as you, half your diamond at 0 dB
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
// A plate on a post, saying when an echo comes: white, ruled in black; smaller further away.
function plate(ctx, ink, text, x, y, size, hot) {
  ctx.font = '700 ' + size.toFixed(1) + 'px ' + FONT;
  const tw = textWidth(ctx, text, size) + size * 1.1, ph = size * 1.75;
  ctx.fillStyle = WHITE;
  ctx.fillRect(x - tw / 2, y - ph / 2, tw, ph);
  ctx.strokeStyle = ink;
  ctx.lineWidth = hot ? 2 : 1.25;
  ctx.strokeRect(x - tw / 2 + 0.5, y - ph / 2 + 0.5, tw - 1, ph - 1);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  return tw;
}
// The settings of what the hand is on, on a small sign by it: black, ruled in white like the overhead sign.
function tag(ctx, f, text, x, y) {
  ctx.font = '700 13px ' + FONT;
  const tw = Math.round(textWidth(ctx, text, 13) + 24), x0 = Math.round(clamp(x - tw / 2, 6, f.w - tw - 6)), y0 = Math.round(y - 14);
  ctx.fillStyle = f.color('fg');
  ctx.beginPath();
  ctx.roundRect(x0, y0, tw, 28, 5);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x0 + 3.5, y0 + 3.5, tw - 7, 21, 3);
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + tw / 2, y0 + 14.5);
}
function zoneAt(e, f) {
  if (e.x >= SIGN.x && e.x <= SIGN.x + SIGN.w && e.y >= SIGN.y && e.y <= SIGN.y + SIGN.h) return 'rule';
  if (e.y < SIGN.y + SIGN.h + 6) return '';
  const you = ground(0, SIDE);
  if (e.x < you.x + DH + 8) return 'you';
  const T = Math.max(0.01, f.value('ktime')), first = ground(T, SIDE);
  const hw = Math.max(14, H1 * f.value('kmix') * first.s) / ROOT3;
  return e.x <= first.x + Math.max(hw, 28) ? 'first' : 'later';
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
    // The sky down to the horizon, the ground under it.
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, w, VP.y);
    // The road, its edge lines and its middle line, away to the right.
    const NEAR = -0.85, FAR = 40;
    ctx.fillStyle = ROADC;
    quad(ctx, [ground(NEAR, 0), ground(FAR, 0), ground(FAR, 1), ground(NEAR, 1)]);
    ctx.fillStyle = WHITE;
    for (const [u0, u1] of [[0.035, 0.05], [0.95, 0.965]]) quad(ctx, [ground(NEAR, u0), ground(FAR, u0), ground(FAR, u1), ground(NEAR, u1)]);
    // The middle line is what you play: its dashes run away down the road from where you stand,
    // each as wide as you played while it passed you.
    const DASH = 0.25, LONG = 0.13;
    for (let m = Math.floor((f.t + 0.85) / DASH); m >= 0; m--) {
      const t0 = f.t - m * DASH;
      if (t0 > 12) break;
      let v = 0;
      if (t0 >= 0) for (let a = 0; a <= LONG; a += 0.02) v = Math.max(v, at(s.hist, m * DASH - a));
      const half = 0.01 + 0.17 * frac(20 * Math.log10(v + 1e-9));
      quad(ctx, [ground(t0, 0.5 - half), ground(t0 + LONG, 0.5 - half), ground(t0 + LONG, 0.5 + half), ground(t0, 0.5 + half)]);
    }
    // The echoes, the furthest first: each a give-way sign on its post, its red edge growing as it gives way.
    const q = (Math.log(12000 / tone) / Math.log(15)) * 0.48;
    const signs = [];
    for (let k = 1; k <= MAXK; k++) {
      const p = ground(k * T, SIDE), H = H1 * mix * Math.pow(fb, k - 1) * p.s;
      if (k > 1 && (p.x - H / ROOT3 > w || H < 2)) break;
      signs.push({ k, x: p.x, foot: p.y, s: p.s, y: p.y - POST * p.s, H, r: 0.25 * (1 - Math.exp(-k * q)) });
    }
    const give = clamp(s.r / 40, 0, 1);
    for (let i = signs.length - 1; i >= 0; i--) {
      const { k, x, foot, s: sc, y, H, r } = signs[i];
      ctx.fillStyle = METAL;
      ctx.fillRect(x - 2.5 * sc, y, 5 * sc, foot - y);
      if (H < 2) {
        // No echo: where the first would stand, to drag it back up.
        tri(ctx, x, y, 16 * sc, 0);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      tri(ctx, x, y, H, r * H);
      ctx.fillStyle = RED;
      ctx.fill();
      const inner = H * RIM * (1 - give);
      if (inner > 1) {
        tri(ctx, x, y, inner, r * inner);
        ctx.fillStyle = WHITE;
        ctx.fill();
      }
      let ping = 0;
      for (const n of s.notes) {
        const age = f.t - n - k * T;
        if (age >= 0 && age < 0.45) ping = Math.max(ping, 1 - age / 0.45);
      }
      if (ping > 0) {
        const big = H * (1.1 + (1 - ping) * 0.3);
        tri(ctx, x, y, big, r * big);
        ctx.globalAlpha = ping;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (active(i === 0 ? 'first' : 'later')) {
        tri(ctx, x, y, H + 14 * sc, r * (H + 14 * sc));
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // The plates on the posts, saying when each echo comes, while they have room.
    let edge = Infinity;
    for (let i = signs.length - 1; i >= 0; i--) {
      const { k, x, foot, s: sc, y, H } = signs[i], size = Math.max(9, 13 * sc);
      if (H < (i ? 8 : 2)) continue;
      ctx.font = '700 ' + size.toFixed(1) + 'px ' + FONT;
      const tw = textWidth(ctx, secs(k * T), size) + size * 1.1;
      if (x + tw / 2 + 4 > edge || x + tw / 2 > w - 4) continue;
      plate(ctx, ink, secs(k * T), x, Math.max(y + (2 * H) / 3 + size, foot - POST * sc * 0.34), size, i === 0 && active('first'));
      edge = x - tw / 2;
    }
    // You: your post, its plate, the diamond as big as what you play, and When louder than, dashed.
    const you = ground(0, SIDE), cy = you.y - POST;
    ctx.fillStyle = METAL;
    ctx.fillRect(you.x - 3, cy, 6, you.y - cy);
    plate(ctx, ink, 'you', you.x, you.y - 40, 13, active('you'));
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
    ctx.setLineDash([6, 5]);
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
    ctx.setLineDash([]);
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
    ctx.fillStyle = WHITE;
    ctx.fillRect(tx(0.1), SIGN.y + 18, tx(0.5) - tx(0.1), 24);
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
    ctx.font = '700 14px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    ctx.fillText('you play', (tx(0.1) + tx(0.5)) / 2, SIGN.y + 30.5);
    // Now: the meter is the white of a give-way sign; its red edge is drawn here.
    const nh = (NOW.w * ROOT3) / 2, nx = NOW.x + NOW.w / 2, ny = NOW.y + nh / 3;
    tri(ctx, nx, ny, nh / RIM, 0);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.font = '700 13px ' + FONT;
    ctx.fillText('now', nx, SIGN.y + SIGN.h - 20);
    // The settings of the shape under the hand, on a sign by it.
    const z = s.drag || s.over, first = signs[0], second = signs[1] && signs[1].H >= 3 ? signs[1] : null;
    const row = SIGN.y + SIGN.h + 26;
    if (z === 'you') tag(ctx, f, 'louder than ' + dB(thresh), you.x + 20, row);
    if (z === 'first') tag(ctx, f, 'repeat ' + secs(T) + ' · level ' + pct(mix), first.x, row);
    if (z === 'later') tag(ctx, f, 'tone ' + hz(tone) + ' · keeps ' + pct(fb), second ? second.x + 40 : first.x + 100, row);
    if (z === 'rule') tag(ctx, f, 'gives way ' + dB(depth) + ' · back in ' + secs(rel), (A.l + A.r) / 2, row);
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
      add('gr1', 'kit.scale', { label: 'Ducking', values: { scale: -1, offset: 1 } }),
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
      wire('duck1.gain', 'gr1.in'),
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
            bg: '#bfe6dc',
            fg: '#111111',
            accent: GIVE,
            track: '#a6d3c7',
            knob: '#ffffff',
            pointer: '#111111',
            muted: '#3a5a54',
            glow: GIVE,
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'lato',
          },
          background: [{ kind: 'color', color: '#bfe6dc' }],
          skins: {
            meter: { name: 'bar', params: { fill: GIVE, surface: '#ffffff', scale: false } },
          },
          // The meter is the white of a give-way sign: cut to the triangle, it fills with red from its point.
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
      wire('gr1.out', 'grm1.in'),
    ],
  );
}

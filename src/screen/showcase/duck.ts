// Yield — a delay whose echoes give way while you play and come back when you stop.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop.
// The design follows the thinking of the ABB A400 EV charger's interface (iF
// DESIGN AWARD 2025): the clarity of road signs — heavy type, basic shapes,
// fixed and moving graphics together, and colours that always mean the same
// thing. The plugin is one canvas, a road low across it read left to right in
// time: you stand at its start as a diamond, and the echoes stand after you as
// triangles on their points, one every Repeat, each as tall as it is loud. Red
// is the one colour for giving way: what the echoes give way while you play,
// and the rule on the plate above you. Every setting is dragged on the shape it
// changes; the controls are kept in the patch. The one control on the plugin is
// a meter of how far the echoes are giving way now, on the rule's plate.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The colour that means "the echoes are giving way", everywhere on the plugin. */
const GIVE = '#c81e24';

/** The road: you, the echoes after you and the rule above you; each setting is dragged on its shape. */
export const ROAD = `// The road, read left to right in time: 2 s of it after you. You stand at its
// start, a diamond as big as what you play now, over a dashed diamond: When
// louder than (kthresh). The echoes stand after you, one every Repeat (ktime),
// each a triangle on its point as tall as it is loud against you (Echo level
// kmix for the first, each next one Feedback kfb of the last), its corners a
// little rounder each time round the loop's lowpass (Tone ktone). While you
// play louder than the threshold the echoes give way: each shrinks to what is
// heard, and the red is what it gives way. Each note you play runs along the
// road as a small diamond, and each echo answers as the note reaches it.
// What you play is worked out from the output level (a canvas hears only the
// output): the output's own echoes, placed as the settings place them, are
// taken out of it; that is held against When louder than (with the ducker's
// 3 dB of hysteresis), and the echoes drop by Depth (kdepth) in 8 ms and come
// back over Back after (krel). The output is read after the app's volume, so
// the threshold is only near.
// Under the road, a plate under each shape: you, then each echo's time. Above
// you, the rule's plate: across is 1.5 s; while you play (0.1 s to 0.5 s) the
// echoes' level drops by Depth, full height 40 dB, then comes back over Back
// after, the time it takes to get most of the way; red is what they give way.
// Drag the diamond up and down for When louder than; the first echo, or the
// road up to it, left and right for Repeat and up and down for Echo level; a
// later echo, or the road after the first, up and down for Feedback and left
// and right for Tone; the rule up and down for Depth and left and right for
// Back after. A drag keeps to the direction it starts in; scrolling moves the
// up-and-down setting.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const RED = '${GIVE}';
const FLOOR = -60, SPAN = 2, MAXK = 12, RULE = 1.5, ROOT3 = Math.sqrt(3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const at = (hist, t) => {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1];
  return 0;
};
const secs = s => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');
const hz = v => (v < 1000 ? Math.round(v) + ' Hz' : (v / 1000).toFixed(1) + ' kHz');
const pct = v => Math.round(v * 100) + '%';
const dB = v => (Math.round(v) < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' dB';
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
// Where things are: the road low across, you at X0, the 2 s after you to X1; the rule's plate P above you.
function layout(w, h) {
  const ROAD = h - 54, X0 = 112, X1 = w - 24;
  const P = { x: 20, y: 18, w: 300, h: 114 };
  return {
    ROAD, X0, X1, P,
    pps: (X1 - X0) / SPAN,
    X: t => X0 + (t / SPAN) * (X1 - X0),
    H1: 166, // an echo as loud as you, in px
    DH: 120, // half the diamond's height at 0 dB
    A: { l: P.x + 16, r: P.x + P.w - 48, top: P.y + 44, bot: P.y + 88 }, // the rule's drawing
  };
}
// An echo: a triangle on its point at x on the road, H tall, its corners rounded by r.
function tri(ctx, x, road, H, r) {
  const hw = H / ROOT3, rr = Math.min(r, H * 0.3), tip = road + rr, top = tip - H;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.arcTo(x + hw, top, x, tip, rr);
  ctx.arcTo(x, tip, x - hw, top, rr);
  ctx.arcTo(x - hw, top, x + hw, top, rr);
  ctx.closePath();
}
// You: a diamond on its point at x on the road, 2·hh tall.
function diamond(ctx, x, road, hh) {
  const hw = hh * 0.8;
  ctx.beginPath();
  ctx.moveTo(x, road - 2 * hh);
  ctx.lineTo(x + hw, road - hh);
  ctx.lineTo(x, road);
  ctx.lineTo(x - hw, road - hh);
  ctx.closePath();
}
// A label on the field, edged in the field's colour so it reads over the shapes; underlined when its shape is under the hand.
function say(ctx, f, text, x, y, align, hot) {
  ctx.font = '600 13px ' + FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = f.color('bg');
  ctx.strokeText(text, x, y);
  ctx.fillStyle = f.color('fg');
  ctx.fillText(text, x, y);
  if (hot) {
    const tw = ctx.measureText(text).width;
    ctx.fillRect(align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x, y + 4, tw, 1.5);
  }
}
// A plate under the road, centred at x: white, edged in black.
function plate(ctx, f, text, x, y, hot) {
  ctx.font = '600 12px ' + FONT;
  const pw = ctx.measureText(text).width + 14;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = f.color('fg');
  ctx.lineWidth = hot ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.roundRect(x - pw / 2, y, pw, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = f.color('fg');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 10.5);
}
function zoneAt(e, f) {
  const { ROAD, X0, X, H1, P } = layout(f.w, f.h);
  if (e.x >= P.x && e.x <= P.x + P.w && e.y >= P.y && e.y <= P.y + P.h) return 'rule';
  if (e.y > ROAD + 36 || e.y < 20) return '';
  if (e.x < X0 + 24) return e.y > 30 ? 'you' : '';
  const x1 = X(Math.max(0.01, f.value('ktime'))), hw = Math.max(12, H1 * f.value('kmix')) / ROOT3;
  if (e.x <= x1 + Math.max(hw, 40)) return e.y > 50 ? 'first' : '';
  return e.y > 104 ? 'later' : '';
}
// How a drag moves a setting: the shapes follow the hand where they can.
function move(id, v0, dx, dy, L) {
  const d = SET[id];
  let v;
  if (id === 'ktime') v = v0 + dx / L.pps;
  else if (id === 'kmix') v = v0 - dy / L.H1;
  else if (id === 'kthresh') v = v0 + (dy / 2 / L.DH) * FLOOR;
  else if (id === 'kfb') v = v0 - (dy / 160) * (d.hi - d.lo);
  else if (id === 'kdepth') v = v0 + (dy / (L.A.bot - L.A.top)) * 40;
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
    const w = f.w, h = f.h, L = layout(w, h), { ROAD, X0, X, H1, DH, P, A } = L;
    const fg = f.color('fg'), bg = f.color('bg');
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
    while (s.hist.length && s.hist[0][0] < f.t - MAXK * T - 0.5) s.hist.shift();
    // A note: the level jumps 6 dB over where it has been.
    if (level > s.slow + 6 && level > FLOOR + 12 && f.t - s.last > 0.15) {
      s.notes.push(f.t);
      s.last = f.t;
    }
    s.slow += (level - s.slow) * (1 - Math.exp(-f.dt / 0.25));
    while (s.notes.length && s.notes[0] < f.t - SPAN - 1) s.notes.shift();
    s.show = level > s.show ? level : s.show + (level - s.show) * (1 - Math.exp(-f.dt / 0.12));
    const active = id => s.over === id || s.drag === id;
    ctx.clearRect(0, 0, w, h);
    // The road, edge to edge; each note you play runs along it, a small diamond.
    ctx.fillStyle = fg;
    ctx.fillRect(0, ROAD, w, 6);
    for (const n of s.notes) {
      const age = f.t - n;
      ctx.globalAlpha = clamp(1 - age / (SPAN + 1), 0, 1);
      diamond(ctx, X(age), ROAD, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The echoes, the furthest first: red is what each gives way now.
    const q = (Math.log(12000 / tone) / Math.log(15)) * 0.48;
    const signs = [];
    for (let k = 1; k <= MAXK; k++) {
      const x = X(k * T), H = H1 * mix * Math.pow(fb, k - 1);
      if (k > 1 && (x - H / ROOT3 > w || H < 3)) break;
      signs.push({ k, x, H, r: 0.25 * (1 - Math.exp(-k * q)) });
    }
    for (let i = signs.length - 1; i >= 0; i--) {
      const { k, x, H, r } = signs[i];
      if (H < 3) {
        // No echo: where the first would stand, to drag it back up.
        tri(ctx, x, ROAD, 14, 0);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (g < 0.995) {
        tri(ctx, x, ROAD, H, r * H);
        ctx.fillStyle = RED;
        ctx.fill();
      }
      tri(ctx, x, ROAD, H * g, r * H * g);
      ctx.fillStyle = fg;
      ctx.fill();
      let ping = 0;
      for (const n of s.notes) {
        const age = f.t - n - k * T;
        if (age >= 0 && age < 0.45) ping = Math.max(ping, 1 - age / 0.45);
      }
      if (ping > 0) {
        const big = H * g * (1.12 + (1 - ping) * 0.3);
        tri(ctx, x, ROAD, big, r * big);
        ctx.globalAlpha = ping;
        ctx.strokeStyle = fg;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (active(i === 0 ? 'first' : 'later')) {
        tri(ctx, x, ROAD, H + 12, r * (H + 12));
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // You, and When louder than: dashed, black on the field and light where it crosses you.
    const frac = v => clamp((v - FLOOR) / -FLOOR, 0, 1);
    const hh = Math.max(3, DH * frac(s.show)), th = DH * frac(thresh);
    diamond(ctx, X0, ROAD, hh);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = active('you') ? 3 : 2;
    diamond(ctx, X0, ROAD, th);
    ctx.strokeStyle = fg;
    ctx.stroke();
    ctx.save();
    diamond(ctx, X0, ROAD, hh);
    ctx.clip();
    diamond(ctx, X0, ROAD, th);
    ctx.strokeStyle = bg;
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    // The labels, on what they set.
    say(ctx, f, 'louder than', X0, ROAD - 2 * th - 29, 'center', false);
    say(ctx, f, dB(thresh) + ' ↕', X0, ROAD - 2 * th - 12, 'center', active('you'));
    const first = signs[0], second = signs[1] && signs[1].H >= 3 ? signs[1] : null;
    const H1now = Math.max(14, first.H);
    say(ctx, f, 'level ' + pct(mix) + ' ↕', first.x, ROAD - H1now - 12, 'center', active('first'));
    const lx = second ? second.x : first.x + H1now / ROOT3 + 24;
    const ly = second ? ROAD - second.H - 31 : ROAD - 48;
    const la = second ? 'center' : 'left';
    say(ctx, f, 'keeps ' + pct(fb) + ' ↕', lx, ly, la, active('later'));
    say(ctx, f, 'tone ' + hz(tone) + ' ↔', lx, ly + 17, la, active('later'));
    // The plates under the road: you, then each echo's time (only the first while they crowd).
    plate(ctx, f, 'you', X0, ROAD + 12, active('you'));
    signs.forEach(({ k, x, H }, i) => {
      if (i > 0 && (L.pps * T < 64 || H < 8 || x > w - 24)) return;
      plate(ctx, f, secs(k * T) + (i === 0 ? ' ↔' : ''), x, ROAD + 12, i === 0 && active('first'));
    });
    // The rule: while you play, the echoes' level drops by Depth and comes back over Back after.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = fg;
    ctx.lineWidth = active('rule') ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(P.x, P.y, P.w, P.h, 6);
    ctx.fill();
    ctx.stroke();
    const tx = t => A.l + (t / RULE) * (A.r - A.l);
    const dy = d => A.top + (Math.min(40, d) / 40) * (A.bot - A.top);
    const lvl = t => (t < 0.1 ? 0 : t < 0.5 ? depth : depth * Math.exp(-(t - 0.5) / rel));
    const curve = () => {
      for (let x = A.l; x <= A.r; x += 2) ctx.lineTo(x, dy(lvl(((x - A.l) / (A.r - A.l)) * RULE)));
    };
    ctx.fillStyle = fg;
    ctx.fillRect(tx(0.1), P.y + 12, tx(0.5) - tx(0.1), 18);
    ctx.beginPath();
    ctx.moveTo(A.l, A.top);
    curve();
    ctx.lineTo(A.r, A.top);
    ctx.closePath();
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.beginPath();
    curve();
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'miter';
    ctx.stroke();
    ctx.font = '600 12px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = bg;
    ctx.fillText('you play', (tx(0.1) + tx(0.5)) / 2, P.y + 21.5);
    ctx.fillStyle = fg;
    ctx.textAlign = 'right';
    ctx.fillText('back in ' + secs(rel) + ' ↔', A.r, P.y + 21.5);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('gives way up to ' + dB(depth) + ' ↕', A.l, A.bot + 16);
    ctx.textAlign = 'center';
    ctx.fillText('now', P.x + P.w - 26, A.bot + 16);
  },
  pointer(e, f) {
    const s = f.state, L = layout(f.w, f.h), zone = zoneAt(e, f);
    if (e.type === 'down' && zone) {
      Object.assign(s, { drag: zone, axis: AXES[zone].x ? '' : 'y', x0: e.x, y0: e.y, from: {} });
      for (const id of Object.values(AXES[zone])) s.from[id] = f.value(id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = e.y - s.y0;
      if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = s.axis && AXES[s.drag][s.axis];
      if (id) f.set(id, move(id, s.from[id], dx, dy, L));
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
            accent: '#111111',
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
            meter: { name: 'bar', params: { fill: GIVE, surface: '#e2e2e2', scale: false } },
          },
        },
      },
      el({ kind: 'canvas', name: 'The road', code: ROAD, rect: r(0, 0, 768, 444) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'YIELD',
        rect: r(464, 8, 280, 76),
        textStyle: { font: 'bebas-neue', size: 80, color: GIVE, align: 'right', spacing: 0.04 },
      }),
      el({
        kind: 'text',
        name: 'What it does',
        text: 'a delay whose echoes give way while you play',
        rect: r(404, 80, 340, 16),
        textStyle: { font: 'lato', size: 13, weight: 700, color: 'muted', align: 'right' },
      }),
      // How far the echoes give way now, on the rule's plate.
      ...control('grm1', 'ui.meter', 'Giving way', null, r(290, 62, 8, 44)),
      wire('gr1.out', 'grm1.in'),
    ],
  );
}

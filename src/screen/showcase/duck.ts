// Yield — a delay whose echoes give way while you play and come back when you stop.
// A delay whose echoes duck under what you play (a ducker keyed by the dry
// input) and bloom when you stop.
// The design follows the thinking of the ABB A400 EV charger's interface (iF
// DESIGN AWARD 2025): the clarity of road signs — heavy type, basic shapes,
// fixed and moving graphics together, and colours that always mean the same
// thing. Three signs read left to right: the echo (black), how far the echoes
// give way (amber, the one colour for giving way, wherever it appears), and
// what they are doing now, drawn live as a row of echoes sinking and rising.
// Every figure is its own control (drag it up or down), with a bar of ten
// segments under it, the way a charger shows how full it is.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The colour that means "the echoes are giving way", everywhere on the plugin. */
const DUCK = '#f0a000';

/** A sign's figures as its controls: rows of the canvas, each moving one control. */
const figures = (
  rows: Array<{ id: string; y: number; h: number; amber?: boolean }>,
) => `// The sign's figures are its controls: press a figure and drag up or down
// (up: more), or scroll on it. Under each figure, ten segments show its
// setting; the arrows at the right darken under the hand.
const ROWS = ${JSON.stringify(rows)}, AMBER = '${DUCK}';
const rowAt = y => ROWS.findIndex(r => y >= r.y && y < r.y + r.h);
export default {
  setup(ctx, f) {
    f.state.drag = -1;
  },
  draw(ctx, f) {
    ctx.clearRect(0, 0, f.w, f.h);
    const fg = f.color('fg'), track = f.color('track'), p = f.pointer;
    const seg = (f.w - 36 - 9 * 3) / 10;
    ROWS.forEach((row, i) => {
      const lit = Math.round(f.norm(row.id) * 10), y = row.y + row.h - 8;
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = k < lit ? (row.amber ? AMBER : fg) : track;
        ctx.fillRect(Math.round(18 + k * (seg + 3)), y, Math.round(seg), 6);
      }
      const hot = f.state.drag === i || (p && p.over && rowAt(p.y) === i);
      const cx = f.w - 14, cy = row.y + (row.h - 8) / 2;
      ctx.fillStyle = hot ? fg : track;
      ctx.beginPath(); ctx.moveTo(cx - 7, cy - 4); ctx.lineTo(cx, cy - 12); ctx.lineTo(cx + 7, cy - 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 7, cy + 4); ctx.lineTo(cx, cy + 12); ctx.lineTo(cx + 7, cy + 4); ctx.fill();
    });
  },
  pointer(e, f) {
    if (e.type === 'down') {
      const i = rowAt(e.y);
      f.state.drag = i;
      if (i >= 0) Object.assign(f.state, { from: e.y, start: f.norm(ROWS[i].id) });
    }
    if (e.type === 'up' || e.type === 'leave') f.state.drag = -1;
    const d = f.state.drag;
    if (d >= 0 && e.type === 'move')
      f.setNorm(ROWS[d].id, Math.min(1, Math.max(0, f.state.start + (f.state.from - e.y) / 160)));
    if (e.type === 'wheel') {
      const i = rowAt(e.y);
      if (i >= 0) f.setNorm(ROWS[i].id, Math.min(1, Math.max(0, f.norm(ROWS[i].id) - e.dy / 1000)));
    }
    f.cursor(d >= 0 ? 'grabbing' : 'ns-resize');
  },
};
`;

/** The rule as a sign: the echo level drops by Depth at once and comes back over Back after. */
export const GIVE_WAY_RULE = `// The rule drawn to scale: across is 1.5 s; the echoes' level (the black
// line) drops by Depth (kdepth, full height 40 dB) while you play, from 0.1 s
// to 0.5 s, then comes back over Back after (krel), the time it takes to get
// most of the way. The amber area is what the echoes give way.
const SPAN = 1.5;
export default function draw(ctx, f) {
  const w = f.w, h = f.h, top = 4, bottom = h - 4;
  const depth = f.value('kdepth'), rel = Math.max(0.01, f.value('krel'));
  const yOf = db => top + (Math.min(40, db) / 40) * (bottom - top);
  const dbAt = t => (t < 0.1 ? 0 : t < 0.5 ? depth : depth * Math.exp(-(t - 0.5) / rel));
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(0, top);
  for (let x = 0; x <= w; x += 2) ctx.lineTo(x, yOf(dbAt((x / w) * SPAN)));
  ctx.lineTo(w, top);
  ctx.closePath();
  ctx.fillStyle = '${DUCK}';
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) ctx.lineTo(x, yOf(dbAt((x / w) * SPAN)));
  ctx.strokeStyle = f.color('fg');
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.stroke();
}
`;

/** The echoes now: a row spaced at the repeat time, sinking under what you play and rising back. */
export const ECHOES_NOW = `// What the echoes are doing now, worked out from the settings and the output
// level (a canvas hears only the output). The output's own echoes, placed as
// the settings place them (Repeat ktime, Feedback kfb, Echo level kmix), are
// taken out of it to estimate what you play; that is held against When
// louder than (kthresh, with the ducker's 3 dB of hysteresis), and the echoes
// drop by Depth (kdepth) in 8 ms and come back over Back after (krel). The
// output is read after the app's volume, so the threshold is only near.
// Left: you, live. Then the echoes of the last thing you played, spaced at
// the repeat time on a 1.6 s road, each Feedback quieter; the amber part of
// each is how far it is giving way now. The dashed line is When louder than.
// The scale runs from -60 dB to 10 dB above When louder than, so the bars use
// the height; anything louder reaches the top.
const FLOOR = -60, SPAN = 1.6, MAXK = 12;
const at = (hist, t) => {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1];
  return 0;
};
export default {
  setup(ctx, f) {
    Object.assign(f.state, { hist: [], r: 0, on: false, peak: -120 });
  },
  draw(ctx, f) {
    const s = f.state;
    if (!s.hist) Object.assign(s, { hist: [], r: 0, on: false, peak: -120 });
    const T = Math.max(0.01, f.value('ktime')), fb = f.value('kfb'), mix = f.value('kmix');
    const depth = f.value('kdepth'), thresh = f.value('kthresh'), rel = Math.max(0.01, f.value('krel'));
    const g = Math.pow(10, -s.r / 20);
    let e2 = 0;
    for (let k = 1; k <= MAXK; k++) {
      const a = mix * Math.pow(fb, k - 1);
      if (a < 0.003) break;
      e2 += (a * at(s.hist, f.t - k * T)) ** 2;
    }
    const dry = Math.sqrt(Math.max(0, f.level * f.level - g * g * e2));
    const db = 20 * Math.log10(dry + 1e-9);
    s.on = db >= thresh || (s.on && db > thresh - 3);
    const target = s.on ? depth : 0;
    s.r += (target - s.r) * (1 - Math.exp(-f.dt / (target > s.r ? 0.008 : rel)));
    s.hist.push([f.t, dry]);
    while (s.hist.length && s.hist[0][0] < f.t - MAXK * T - 0.5) s.hist.shift();
    s.peak = Math.max(db, s.peak - f.dt * 6);
    const w = f.w, h = f.h, base = h - 14, top = 6;
    const ceil = Math.min(0, thresh + 10);
    const yOf = v => base - (Math.max(0, Math.min(ceil - FLOOR, v - FLOOR)) / (ceil - FLOOR)) * (base - top);
    const fg = f.color('fg'), track = f.color('track');
    ctx.clearRect(0, 0, w, h);
    // The road: the ground line and a tick every half second.
    ctx.fillStyle = track;
    for (let t = 0; t <= SPAN; t += 0.5) ctx.fillRect(Math.round(28 + (t / SPAN) * (w - 40)), base + 4, 2, 8);
    // You.
    ctx.fillStyle = fg;
    const yy = yOf(db);
    ctx.fillRect(0, yy, 18, base - yy);
    // The echoes.
    for (let k = 1; k <= MAXK; k++) {
      const x = 28 + ((k * T) / SPAN) * (w - 40);
      if (x > w - 12) break;
      const level = s.peak + 20 * Math.log10(Math.max(1e-6, mix * Math.pow(fb, k - 1)));
      const full = yOf(level), heard = yOf(level - s.r);
      ctx.fillStyle = '${DUCK}';
      ctx.fillRect(Math.round(x), full, 12, heard - full);
      ctx.fillStyle = fg;
      ctx.fillRect(Math.round(x), heard, 12, base - heard);
    }
    ctx.fillRect(0, base, w, 3);
    // When louder than.
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    const ty = Math.round(yOf(thresh)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke();
    ctx.setLineDash([]);
  },
};
`;

export function duck(catalog: Catalog) {
  const label = {
    size: 11,
    weight: 700,
    color: '#4d4d4d',
    align: 'left' as const,
    spacing: 0.1,
    case: 'upper' as const,
  };
  const sign = (name: string, x: number, band: string, ink: string, caption: string) => [
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} sign`,
      rect: r(x, 76, 232, 348),
      locked: true,
      style: {
        radius: 16,
        fill: [{ kind: 'color', color: '#ffffff' }],
        stroke: { color: '#111111', width: 3, style: 'solid' },
      },
    }),
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} band`,
      rect: r(x, 76, 232, 44),
      locked: true,
      style: { radius: 16, fill: [{ kind: 'color', color: band }] },
    }),
    el({
      kind: 'shape',
      shape: 'rect',
      name: `${name} band edge`,
      rect: r(x, 104, 232, 16),
      locked: true,
      style: { fill: [{ kind: 'color', color: band }] },
    }),
    el({
      kind: 'text',
      name: `${name} title`,
      text: name,
      rect: r(x + 18, 84, 196, 30),
      textStyle: { font: 'bebas-neue', size: 28, color: ink, align: 'left', spacing: 0.06 },
    }),
    el({
      kind: 'text',
      name: `${name} caption`,
      text: caption,
      rect: r(x + 18, 130, 196, 14),
      textStyle: label,
    }),
  ];
  /** A figure that shows a control's value (the canvas over it moves the control). */
  const figure = (name: string, bind: string, x: number, y: number, size: number) =>
    el({
      kind: 'text',
      name: `${name} figure`,
      text: '{value}',
      bind,
      rect: r(x + 16, y, 180, Math.round(size * 1.2)),
      textStyle: { font: 'oswald', size, weight: 600, color: '#111111', align: 'left' },
    });
  const small = (text: string, x: number, y: number) =>
    el({
      kind: 'text',
      name: `${text} label`,
      text,
      rect: r(x + 18, y, 196, 14),
      textStyle: label,
    });
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
      // ---- the plugin: three signs; their figures are the controls ----
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
            bg: '#e6e7e3',
            fg: '#111111',
            accent: '#111111',
            track: '#d9dad5',
            knob: '#ffffff',
            pointer: '#111111',
            muted: '#4d4d4d',
            glow: DUCK,
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'lato',
          },
          background: [{ kind: 'color', color: '#e6e7e3' }],
          skins: { meter: { name: 'bar', params: { fill: DUCK, scale: false } } },
          css: 'dk-scope::part(canvas) { border-radius: 0; }',
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Yield',
        rect: r(24, 12, 200, 52),
        textStyle: { font: 'bebas-neue', size: 54, color: 'fg', align: 'left', spacing: 0.04 },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Title bar',
        rect: r(150, 36, 594, 6),
        locked: true,
        style: { fill: [{ kind: 'color', color: '#111111' }] },
      }),
      // The echo: how long, how many, how bright, how loud.
      ...sign('Echo', 24, '#111111', '#ffffff', 'repeats every'),
      figure('Repeat', 'ktime', 24, 150, 52),
      small('feedback', 24, 236),
      figure('Feedback', 'kfb', 24, 250, 26),
      small('tone', 24, 296),
      figure('Tone', 'ktone', 24, 310, 26),
      small('echo level', 24, 356),
      figure('Echo level', 'kmix', 24, 370, 26),
      el({
        kind: 'canvas',
        name: 'Echo figures',
        code: figures([
          { id: 'ktime', y: 0, h: 88 },
          { id: 'kfb', y: 92, h: 58 },
          { id: 'ktone', y: 152, h: 58 },
          { id: 'kmix', y: 212, h: 58 },
        ]),
        rect: r(27, 146, 226, 272),
      }),
      // Giving way: how far down, from how loud, how fast back.
      ...sign('Give way', 274, DUCK, '#111111', 'echoes drop by up to'),
      figure('Depth', 'kdepth', 274, 150, 52),
      small('when louder than', 274, 236),
      figure('When louder than', 'kthresh', 274, 250, 26),
      small('back after', 274, 296),
      figure('Back after', 'krel', 274, 310, 26),
      el({
        kind: 'canvas',
        name: 'Give way figures',
        code: figures([
          { id: 'kdepth', y: 0, h: 88, amber: true },
          { id: 'kthresh', y: 92, h: 58 },
          { id: 'krel', y: 152, h: 58 },
        ]),
        rect: r(277, 146, 226, 212),
      }),
      el({
        kind: 'canvas',
        name: 'The rule',
        code: GIVE_WAY_RULE,
        rect: r(292, 364, 196, 46),
      }),
      // Now: the echoes as they are at this moment, and what goes out.
      ...sign('Now', 524, '#111111', '#ffffff', 'the echoes now'),
      el({ kind: 'canvas', name: 'Echoes now', code: ECHOES_NOW, rect: r(542, 150, 196, 206) }),
      el({
        kind: 'text',
        name: 'Down label',
        text: 'down',
        rect: r(542, 364, 50, 14),
        textStyle: label,
      }),
      ...control('grm1', 'ui.meter', 'Down', null, r(598, 366, 140, 10)),
      wire('gr1.out', 'grm1.in'),
      el({
        kind: 'text',
        name: 'Out label',
        text: 'out',
        rect: r(542, 388, 50, 14),
        textStyle: label,
      }),
      ...control('outm1', 'ui.meter', 'Out', null, r(598, 390, 140, 10), {
        style: { skin: { name: 'bar', params: { fill: '#111111', scale: false } } },
      }),
      wire('mixl1.out', 'outm1.in'),
    ],
  );
}

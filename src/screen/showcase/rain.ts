// Rain Field — a sound installation of rain all around the listener: drops on
// the glass, wind with the rain further off, thunder far away and drips from a
// gutter, each placed in the space by hand.
// One raindrop is a part (Drop): a slow wobble ticks; at each tick one random
// number decides whether a drop falls and another how high it rings; the drop
// is a short burst of noise through a narrow band. The part runs ×16: each copy
// falls on its own (its own random numbers, and its own pace and pitch from
// spreads), and Splay spreads the copies across the stereo field. The drips are
// the same part used once more, slower and lower. Where a sound sits is another
// part (Place): Level from how near it is, Pan from which side, and Behind,
// which dulls a sound behind the listener (most when straight behind); it is
// used once for each of the four sounds. A small room holds it all.
// The design follows the thinking of Odio (Apple Design Awards 2022,
// Innovation), an app of sound worlds you mix through a circular interface,
// with animations that move in step with the sound: the plugin is one canvas,
// the space around you seen from above, edge to edge, with you in the middle and
// the half behind you drawn duller. Each sound is a source drawn in the field,
// sized by how near it is and moving with what is heard; you drag it nearer,
// further, left or right (its Level, Pan and Behind stay in the patch). The Drop
// part's knobs (Rain, Pitch, Splash: every copy at once), Drops across and Room
// are figures in the corners you drag, also kept in the patch; the plugin's
// meters show how much each sound makes.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The four sounds: their controls (level, pan and behind, kept in the patch), colour and where they start. */
const LAYERS = [
  {
    name: 'Drops',
    level: 'kdrops',
    pan: 'kdropspan',
    back: 'kdropsback',
    color: '#2430d6',
    at: [0.7, 0],
    behind: false,
  },
  {
    name: 'Wind and far rain',
    level: 'kwind',
    pan: 'kwindpan',
    back: 'kwindback',
    color: '#e23d17',
    at: [0.4, 0.6],
    behind: false,
  },
  {
    name: 'Thunder',
    level: 'kthunder',
    pan: 'kthunderpan',
    back: 'kthunderback',
    color: '#151a0b',
    at: [0.35, -0.7],
    behind: false,
  },
  {
    name: 'Drips',
    level: 'kdrips',
    pan: 'kdripspan',
    back: 'kdripsback',
    color: '#b8137a',
    at: [0.55, 0.4],
    behind: true,
  },
] as const;

/** The field around the listener, seen from above, edge to edge; it takes the mouse. */
export const FIELD = `// The space around you, seen from above, you in the middle (front is up); the
// half behind you is drawn duller, as it is heard. Each sound is a drawn source:
// how near it is sets its level (1 in the middle, 0 at the ring) and its size,
// the side it is on sets its pan (-1 left, +1 right), and the half it is in sets
// its Behind switch. Drag a source to move the sound. The sources move with
// what is heard: drops land as ripples by the Drops source and light its sixteen
// dots, one for each copy of the Drop part (sharp jumps high in the spectrum), a
// drip makes one wider ripple (a jump around its note, props.dripHz), the wind's
// lines follow the low middle of the spectrum, and thunder rolls out of its
// source when the lowest bands rise. The figures in the corners are the Drop
// part's knobs (they set all sixteen copies at once), how wide the drops spread
// across and the room: drag one up or down. The bars at the bottom right are
// the plugin's meters of each sound; the names beside them are drawn here.
const TAU = Math.PI * 2;
const LAYERS = [
  { name: 'drops', level: 'kdrops', pan: 'kdropspan', back: 'kdropsback', color: '#2430d6' },
  { name: 'wind', level: 'kwind', pan: 'kwindpan', back: 'kwindback', color: '#e23d17' },
  { name: 'thunder', level: 'kthunder', pan: 'kthunderpan', back: 'kthunderback', color: '#151a0b' },
  { name: 'drips', level: 'kdrips', pan: 'kdripspan', back: 'kdripsback', color: '#b8137a' },
];
const FRONT = '#b9d35a', BEHIND = '#93a06b', INK = '#141a0b';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const dull = c => { const a = hex(c), b = hex(BEHIND); return 'rgb(' + a.map((v, i) => Math.round(v * 0.45 + b[i] * 0.55)).join(',') + ')'; };
// The figures you drag: control, name, range, log or not, how it reads, where (from the corners).
const DIALS = [
  { id: 'knob1', name: 'rain', min: 0.5, max: 16, log: true, show: v => v.toFixed(1) + ' /s', at: (w, h) => [18, h - 84] },
  { id: 'knob2', name: 'pitch', min: 400, max: 8000, log: true, show: v => (v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz'), at: (w, h) => [18, h - 56] },
  { id: 'knob3', name: 'splash', min: 0.005, max: 0.4, log: true, show: v => Math.round(v * 1000) + ' ms', at: (w, h) => [18, h - 28] },
  { id: 'kwidth', name: 'drops across', min: 0, max: 1, log: false, show: v => Math.round(v * 100) + '%', at: (w, h) => [w - 168, 44] },
  { id: 'kroom', name: 'room', min: 0, max: 1, log: false, show: v => Math.round(v * 100) + '%', at: (w, h) => [w - 168, 74] },
];
const normOf = (d, v) => (d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min));
const valueOf = (d, n) => { n = clamp(n, 0, 1); return d.log ? d.min * Math.pow(d.max / d.min, n) : d.min + n * (d.max - d.min); };
function dialAt(w, h, x, y) {
  for (let k = 0; k < DIALS.length; k++) { const [dx, dy] = DIALS[k].at(w, h); if (x >= dx - 6 && x <= dx + 150 && y >= dy - 24 && y <= dy + 7) return k; }
  return -1;
}
function spot(f, k, R) {
  const L = LAYERS[k];
  const r = (1 - clamp(f.value(L.level), 0, 1)) * R, a = Math.asin(clamp(f.value(L.pan), -1, 1));
  return { x: r * Math.sin(a), y: (f.on(L.back) ? 1 : -1) * r * Math.cos(a) };
}
// How big a source is drawn (nearer is louder and bigger), and how near the mouse must be to take it.
const size = (f, k) => 13 + 13 * clamp(f.value(LAYERS[k].level), 0, 1);
const grabAt = (f, k) => Math.min(32, size(f, k) + 6);
function source(ctx, k, x, y, z, color, s, t) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (k === 0) {
    // Drops: sixteen dots, one for each copy of the Drop part, spread as wide as they fall across.
    const across = 0.35 + 0.65 * s.across;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, lit = Math.max(0, 1 - (t - (s.lit[i] || -9)) / 0.5);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * z * 1.25 * across, y + Math.sin(a) * z * 0.8, 2.2 + z * 0.06 + lit * 3, 0, TAU); ctx.fill();
    }
  } else if (k === 1) {
    // Wind: three lines that run and bend as hard as it blows.
    ctx.lineWidth = 2.5;
    for (let j = -1; j <= 1; j++) {
      ctx.beginPath();
      for (let u = -1; u <= 1.001; u += 0.1) ctx.lineTo(x + u * z * 1.2, y + j * z * 0.45 + Math.sin(u * 3 + t * (2 + 6 * s.wind) + j) * z * (0.12 + 0.25 * s.wind));
      ctx.stroke();
    }
  } else if (k === 2) {
    // Thunder: a jagged ring that spikes as it rolls.
    const roll = Math.max(0, 1 - (t - s.lastThunder) / 3);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU, rr = z * (i % 2 ? 0.55 : 0.95 + roll * 0.5); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  } else {
    // Drips: a drop falling from a gutter, and the ring where it lands.
    const fall = clamp((t - s.lastDrip) / 0.35, 0, 1);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x - z * 0.7, y - z); ctx.lineTo(x + z * 0.7, y - z); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - z + 5 + fall * z * 0.9, 3.5 + z * 0.08, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + z * 0.35, z * 0.75, z * 0.3, 0, 0, TAU); ctx.stroke();
  }
}
const band = hz => (64 * Math.log(hz / 96)) / Math.log(250);
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: -1, over: -1, dial: -1, hot: -1, prev: null, ripples: [], lit: [], lastDrop: 0, drip: 0, lastDrip: -10, low: 0, lastThunder: -10, windLo: 1, windHi: 0, wind: 0, across: 0.85 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 22;
    const at = k => { const p = spot(f, k, R); return { x: cx + p.x, y: cy + p.y }; };
    s.across = clamp(f.value('kwidth'), 0, 1);
    // Ahead of you and behind you: the half behind is duller, as it is heard.
    ctx.fillStyle = FRONT; ctx.fillRect(0, 0, w, cy);
    ctx.fillStyle = BEHIND; ctx.fillRect(0, cy, w, h - cy);
    // How far you hear: rings for how near, the ring at the edge, marks around it.
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.22;
    for (const q of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.arc(cx, cy, R * q, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU, l = i % 6 ? 4 : 9; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3)); ctx.lineTo(cx + Math.cos(a) * (R + 3 + l), cy + Math.sin(a) * (R + 3 + l)); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK; ctx.font = '600 12px ' + FONT; ctx.textAlign = 'center';
    ctx.fillText('front', cx, cy - R + 20);
    ctx.fillText('behind: duller', cx, cy + R - 12);
    ctx.textAlign = 'left'; ctx.fillText('left', cx - R + 10, cy - 8);
    ctx.textAlign = 'right'; ctx.fillText('right', cx + R - 10, cy - 8);
    // What is heard: spectral jumps for drops and drips, the low end for thunder and wind
    // (the first frame only sets where each starts from).
    const first = !s.prev;
    if (first) s.prev = new Float32Array(f.spectrum);
    let flux = 0;
    for (let i = 30; i < 58; i++) flux += Math.max(0, f.spectrum[i] - s.prev[i]);
    const dripBand = band(f.props.dripHz || 700), bi = Math.max(0, Math.min(62, Math.floor(dripBand)));
    const drip = f.spectrum[bi] * (1 - (dripBand - bi)) + f.spectrum[bi + 1] * (dripBand - bi);
    if (first) s.drip = drip;
    const dripJump = drip - s.drip;
    s.drip += (drip - s.drip) * Math.min(1, f.dt * 3);
    let low = 0;
    for (let i = 0; i < 4; i++) low += f.spectrum[i] / 4;
    if (first) s.low = low;
    const lowJump = low - s.low;
    s.low += (low - s.low) * Math.min(1, f.dt * 0.6);
    let wind = 0;
    for (let i = 8; i < 17; i++) wind += f.spectrum[i] / 9;
    s.windHi = wind > s.windHi ? wind : s.windHi - (s.windHi - wind) * f.dt * 0.1;
    s.windLo = wind < s.windLo ? wind : s.windLo + (wind - s.windLo) * f.dt * 0.1;
    s.wind += ((s.windHi - s.windLo > 0.02 ? (wind - s.windLo) / (s.windHi - s.windLo) : 0) - s.wind) * Math.min(1, f.dt * 3);
    s.prev.set(f.spectrum);
    const dropsAt = at(0), dripsAt = at(3), thunderAt = at(2);
    if (flux > 0.6 && f.t - s.lastDrop > 0.05 && f.value('kdrops') > 0.02) {
      s.lastDrop = f.t;
      s.lit[Math.floor(Math.random() * 16)] = f.t;
      const a = Math.random() * TAU, d = Math.random() * size(f, 0) * (0.6 + s.across);
      s.ripples.push({ x: dropsAt.x + Math.cos(a) * d, y: dropsAt.y + Math.sin(a) * d * 0.7, born: f.t, life: 0.9, size: 18, k: 0 });
    }
    if (dripJump > 0.08 && f.t - s.lastDrip > 0.35 && f.value('kdrips') > 0.02) {
      s.lastDrip = f.t;
      s.ripples.push({ x: dripsAt.x, y: dripsAt.y, born: f.t, life: 1.5, size: 56, k: 3 });
    }
    if (lowJump > 0.05 && f.t - s.lastThunder > 2 && f.value('kthunder') > 0.02) {
      s.lastThunder = f.t;
      s.ripples.push({ x: thunderAt.x, y: thunderAt.y, born: f.t, life: 3.2, size: R * 1.3, k: 2 });
    }
    s.ripples = s.ripples.filter(q => f.t - q.born < q.life).slice(-80);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    for (const q of s.ripples) {
      const age = (f.t - q.born) / q.life, c = LAYERS[q.k].color;
      ctx.strokeStyle = q.y > cy ? dull(c) : c; ctx.globalAlpha = (1 - age) * (q.k === 2 ? 0.35 : 0.9); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, 3 + age * q.size, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // You, from above: shoulders, a head, ears and a nose to the front, and the way you face.
    ctx.fillStyle = INK; ctx.globalAlpha = 0.1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 74, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy + 3, 21, 9, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = FRONT; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 9.5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 3.5, cy - 9); ctx.lineTo(cx, cy - 15); ctx.lineTo(cx + 3.5, cy - 9); ctx.closePath(); ctx.fill();
    ctx.font = '600 12px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('you', cx, cy + 28);
    // The sounds where they are, behind you duller; the one under the mouse ringed.
    for (let k = LAYERS.length - 1; k >= 0; k--) {
      const L = LAYERS[k], p = at(k), z = size(f, k), behind = f.on(L.back);
      const color = behind ? dull(L.color) : L.color;
      ctx.globalAlpha = f.value(L.level) <= 0.02 ? 0.4 : 1;
      if (s.over === k || s.drag === k) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, grabAt(f, k) + 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      source(ctx, k, p.x, p.y, z, color, s, f.t);
      ctx.fillStyle = behind ? dull(INK) : INK; ctx.font = '600 12px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(k === 0 ? 'drops ×16' : L.name, p.x, p.y + z + 18);
      ctx.globalAlpha = 1;
    }
    // The name, and the figures you drag: the Drop part's knobs (every copy at once), the spread and the room.
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.font = '800 24px ' + FONT; ctx.fillText('Rain Field', 18, 38);
    ctx.font = '700 13px ' + FONT; ctx.fillText('one drop ×16', 18, h - 132);
    ctx.font = '500 12px ' + FONT; ctx.fillText('sets every copy', 18, h - 114);
    DIALS.forEach((d, k) => {
      const [x, y] = d.at(w, h), txt = d.show(f.value(d.id)), on = s.hot === k || s.dial === k;
      ctx.fillStyle = INK; ctx.font = '700 20px ' + FONT; ctx.fillText(txt, x, y);
      const tw = ctx.measureText(txt).width;
      ctx.font = '500 12px ' + FONT; ctx.globalAlpha = 0.8; ctx.fillText(d.name, x + tw + 8, y); ctx.globalAlpha = on ? 1 : 0.45;
      ctx.beginPath(); ctx.moveTo(x - 10, y - 13); ctx.lineTo(x - 7, y - 17); ctx.lineTo(x - 4, y - 13); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 10, y - 8); ctx.lineTo(x - 7, y - 4); ctx.lineTo(x - 4, y - 8); ctx.closePath(); ctx.fill();
      if (on) ctx.fillRect(x, y + 4, tw, 1.5);
      ctx.globalAlpha = 1;
    });
    // The names beside the plugin's meters (bottom right).
    ctx.font = '600 12px ' + FONT; ctx.textAlign = 'right';
    LAYERS.forEach((L, k) => { ctx.fillStyle = INK; ctx.fillText(L.name, w - 92, h - 92 + k * 22); });
  },
  pointer(e, f) {
    const s = f.state, cx = f.w / 2, cy = f.h / 2, R = Math.min(f.w, f.h) / 2 - 22;
    const near = () => {
      for (let k = 0; k < LAYERS.length; k++) {
        const p = spot(f, k, R);
        if (Math.hypot(e.x - cx - p.x, e.y - cy - p.y) < grabAt(f, k)) return k;
      }
      return -1;
    };
    s.over = near();
    const hot = s.over >= 0 ? -1 : dialAt(f.w, f.h, e.x, e.y);
    if (e.type === 'down') {
      if (s.over >= 0) s.drag = s.over;
      else if (hot >= 0) Object.assign(s, { dial: hot, y0: e.y, n0: normOf(DIALS[hot], f.value(DIALS[hot].id)) });
    }
    if (e.type === 'up' || e.type === 'leave') { s.drag = -1; s.dial = -1; }
    if (s.drag >= 0 && (e.type === 'down' || e.type === 'move')) {
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy), L = LAYERS[s.drag];
      f.set(L.level, 1 - Math.min(R, d) / R);
      f.set(L.pan, d < 1 ? 0 : clamp(dx / d, -1, 1));
      f.set(L.back, dy > 0);
    }
    if (s.dial >= 0 && e.type === 'move') { const d = DIALS[s.dial]; f.set(d.id, valueOf(d, s.n0 + (s.y0 - e.y) / 160)); }
    if (e.type === 'wheel' && hot >= 0) { const d = DIALS[hot]; f.set(d.id, valueOf(d, normOf(d, f.value(d.id)) - Math.sign(e.dy) * 0.025)); }
    s.hot = s.dial >= 0 ? s.dial : hot;
    f.cursor(s.drag >= 0 ? 'grabbing' : s.dial >= 0 || hot >= 0 ? 'ns-resize' : s.over >= 0 ? 'grab' : 'default');
  },
};
`;

/** How the knobs' names read on this plugin (the Drop's face and the others alike). */
const KNOB_TEXT = {
  textStyle: { font: 'lato', size: 11, color: 'fg', case: 'upper' as const, spacing: 0.14 },
};

/** The Drop's own screen: its three knobs under its name, with a lamp for the sound. */
export const DROP_FACE: PartFace = {
  width: 284,
  height: 176,
  controls: [
    {
      param: 'rain',
      type: 'ui.knob',
      rect: { x: 12, y: 64, w: 84, h: 100 },
      label: 'Rain',
      style: KNOB_TEXT,
    },
    {
      param: 'pitch',
      type: 'ui.knob',
      rect: { x: 100, y: 64, w: 84, h: 100 },
      label: 'Pitch',
      style: KNOB_TEXT,
    },
    {
      param: 'splash',
      type: 'ui.knob',
      rect: { x: 188, y: 64, w: 84, h: 100 },
      label: 'Splash',
      style: KNOB_TEXT,
    },
  ],
  elements: [
    {
      id: 'frame',
      kind: 'shape',
      shape: 'rect',
      rect: { x: 0, y: 0, w: 284, h: 176 },
      style: {
        radius: 14,
        fill: [{ kind: 'color', color: '#232c33' }],
        stroke: { color: '#ffffff1a', width: 1, style: 'solid' },
      },
    },
    {
      id: 'title',
      kind: 'text',
      text: 'DROP',
      rect: { x: 16, y: 14, w: 140, h: 18 },
      textStyle: {
        font: 'lato',
        size: 13,
        weight: 700,
        color: 'accent',
        align: 'left',
        spacing: 0.24,
      },
    },
    {
      id: 'what',
      kind: 'text',
      text: 'one drop, sixteen times: these knobs play every copy',
      rect: { x: 16, y: 34, w: 252, h: 14 },
      textStyle: { size: 10, color: 'muted', align: 'left' },
    },
    {
      id: 'lamp',
      kind: 'led',
      bind: '@level',
      color: 'accent',
      threshold: 0.02,
      rect: { x: 258, y: 18, w: 10, h: 10 },
    },
  ],
};

export function rain(catalog: Catalog) {
  const drop = [
    'tick1',
    'up1',
    'down1',
    'chance1',
    'pass1',
    'fall1',
    'env1',
    'noise1',
    'pitch1',
    'jitter1',
    'band1',
    'ring1',
    'vca1',
  ];
  const place = [
    'pan1',
    'balL1',
    'balR1',
    'clL1',
    'clR1',
    'lvl1',
    'gL1',
    'gR1',
    'outL1',
    'outR1',
    'back1',
    'side1',
    'dull1',
    'tone1',
    'lpL1',
    'lpR1',
  ];
  return workInSteps(
    'rain',
    'Rain Field',
    catalog,
    [760, 500],
    [
      [
        // ---- one drop: a tick, a chance, a burst of noise through a narrow band ----
        add('tick1', 'den.lfo', { label: 'Tick', values: { rate: 6 } }),
        add('up1', 'kit.compare', { label: 'Tick up' }),
        add('down1', 'kit.compare', { label: 'Tick down' }),
        add('chance1', 'den.randomModulator', { label: 'Chance' }),
        add('pass1', 'kit.compare', { label: 'Falls?', values: { b: 0 } }),
        add('fall1', 'kit.mul', { label: 'Fall' }),
        add('env1', 'den.envelope', {
          label: 'Splash',
          values: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.025 },
        }),
        add('noise1', 'den.seededNoise', { label: 'Water' }),
        add('pitch1', 'den.randomModulator', { label: 'Which pitch' }),
        add('jitter1', 'kit.scale', { label: 'Jitter', values: { scale: 0.7, offset: 0 } }),
        add('band1', 'kit.cutoffMod', { label: 'Pitch', values: { hz: 2400 } }),
        add('ring1', 'den.stateVariableFilter', { label: 'Ring', values: { q: 6 } }),
        add('vca1', 'kit.mul', { label: 'Drop' }),
        // While the tick is up the random numbers run; when it falls they hold, and the drop falls if the chance passed.
        wire('tick1.out', 'up1.a'),
        wire('tick1.out', 'down1.b'),
        wire('up1.out', 'chance1.trigger'),
        wire('up1.out', 'pitch1.trigger'),
        wire('chance1.out', 'pass1.a'),
        wire('pass1.out', 'fall1.a'),
        wire('down1.out', 'fall1.b'),
        wire('fall1.out', 'env1.gate'),
        wire('pitch1.out', 'jitter1.in'),
        wire('jitter1.out', 'band1.octaves'),
        wire('band1.out', 'ring1.cutoffHz'),
        wire('noise1.out', 'ring1.input'),
        wire('ring1.bandpass', 'vca1.a'),
        wire('env1.level', 'vca1.b'),
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.85 } }),
        wire('vca1.out', 'splay1.in'),
        // ---- where a sound sits: Level from how near, Pan from which side (left and right kept in balance),
        // Behind dulls it: straight behind, a lowpass at 4 kHz takes its highs; at the sides it stays as it is ----
        add('pan1', 'kit.add', { label: 'Pan', values: { a: 0, b: 0 } }),
        add('balL1', 'kit.scale', { label: 'Left side', values: { scale: -1, offset: 1 } }),
        add('balR1', 'kit.scale', { label: 'Right side', values: { scale: 1, offset: 1 } }),
        add('clL1', 'kit.clamp', { label: 'Left at most 1', values: { min: 0, max: 1 } }),
        add('clR1', 'kit.clamp', { label: 'Right at most 1', values: { min: 0, max: 1 } }),
        add('lvl1', 'kit.add', { label: 'Level', values: { a: 0.7, b: 0 } }),
        add('gL1', 'kit.mul', { label: 'Left gain' }),
        add('gR1', 'kit.mul', { label: 'Right gain' }),
        add('outL1', 'kit.mul', { label: 'Left' }),
        add('outR1', 'kit.mul', { label: 'Right' }),
        wire('pan1.out', 'balL1.in'),
        wire('pan1.out', 'balR1.in'),
        wire('balL1.out', 'clL1.in'),
        wire('balR1.out', 'clR1.in'),
        wire('clL1.out', 'gL1.a'),
        wire('clR1.out', 'gR1.a'),
        wire('lvl1.out', 'gL1.b'),
        wire('lvl1.out', 'gR1.b'),
        wire('splay1.left', 'outL1.a'),
        wire('splay1.right', 'outR1.a'),
        wire('gL1.out', 'outL1.b'),
        wire('gR1.out', 'outR1.b'),
        add('back1', 'kit.mul', { label: 'Behind', values: { a: 0 } }),
        add('side1', 'kit.mul', { label: 'Pan × pan' }),
        add('dull1', 'kit.scale', {
          label: 'Duller (Hz)',
          values: { scale: 16000, offset: -16000 },
        }),
        add('tone1', 'kit.add', { label: 'Tone (Hz)', values: { b: 20000 } }),
        add('lpL1', 'den.filter', { label: 'Left tone', values: { resonance: 0.707 } }),
        add('lpR1', 'den.filter', { label: 'Right tone', values: { resonance: 0.707 } }),
        wire('pan1.out', 'side1.a'),
        wire('pan1.out', 'side1.b'),
        wire('side1.out', 'dull1.in'),
        wire('dull1.out', 'back1.b'),
        wire('back1.out', 'tone1.a'),
        wire('outL1.out', 'lpL1.input'),
        wire('outR1.out', 'lpR1.input'),
        wire('tone1.out', 'lpL1.cutoff'),
        wire('tone1.out', 'lpR1.cutoff'),
        // ---- the field: four sounds into a small room ----
        add('mixl1', 'kit.mix', { label: 'Left', config: { channels: 4 } }),
        add('mixr1', 'kit.mix', { label: 'Right', config: { channels: 4 } }),
        wire('lpL1.out', 'mixl1.in1'),
        wire('lpR1.out', 'mixr1.in1'),
        // Wind and the rain further off: low noise, its tone swept by gusts.
        add('air1', 'den.seededNoise', { label: 'Air', config: { seed: 7 } }),
        add('gust1', 'den.lfo', { label: 'Gusts', values: { rate: 0.11 } }),
        add('gustamt1', 'kit.scale', { label: 'Gust depth', values: { scale: 1.2, offset: 0 } }),
        add('airtone1', 'kit.cutoffMod', { label: 'Air tone', values: { hz: 420 } }),
        add('farlp1', 'den.filter', { label: 'Far rain', values: { resonance: 0.7 } }),
        add('farlvl1', 'kit.gain', { label: 'Far level', values: { gain: 0.2 } }),
        wire('air1.out', 'farlp1.input'),
        wire('gust1.out', 'gustamt1.in'),
        wire('gustamt1.out', 'airtone1.octaves'),
        wire('airtone1.out', 'farlp1.cutoff'),
        wire('farlp1.out', 'farlvl1.in'),
        // Thunder: now and then (a slow tick, and a chance), a long low rumble.
        add('tlfo1', 'den.lfo', { label: 'Thunder tick', values: { rate: 0.06 } }),
        add('tup1', 'kit.compare', { label: 'Now?', values: { b: 0.97 } }),
        add('tchance1', 'den.randomModulator', { label: 'Thunder chance', config: { seed: 3 } }),
        add('tpass1', 'kit.compare', { label: 'Rolls?', values: { b: -0.3 } }),
        add('troll1', 'kit.mul', { label: 'Roll' }),
        add('tenv1', 'den.envelope', {
          label: 'Rumble',
          values: { attack: 0.5, decay: 1.2, sustain: 0.6, release: 4.5 },
        }),
        add('tnoise1', 'den.seededNoise', { label: 'Thunder noise', config: { seed: 13 } }),
        add('tlp1', 'den.filter', { label: 'Far off', values: { cutoff: 120, resonance: 0.8 } }),
        add('tvca1', 'kit.mul', { label: 'Thunder' }),
        add('tsat1', 'kit.tanh', { label: 'Weight', values: { drive: 3 } }),
        add('tlvl1', 'kit.gain', { label: 'Thunder level', values: { gain: 0.5 } }),
        wire('tlfo1.out', 'tup1.a'),
        wire('tup1.out', 'tchance1.trigger'),
        wire('tchance1.out', 'tpass1.a'),
        wire('tup1.out', 'troll1.a'),
        wire('tpass1.out', 'troll1.b'),
        wire('troll1.out', 'tenv1.gate'),
        wire('tnoise1.out', 'tlp1.input'),
        wire('tlp1.out', 'tvca1.a'),
        wire('tenv1.level', 'tvca1.b'),
        wire('tvca1.out', 'tsat1.in'),
        wire('tsat1.out', 'tlvl1.in'),
        add('room1', 'den.algorithmicReverb', {
          label: 'Room',
          config: { roomScale: 0.6, decaySeconds: 0.9, dampingHz: 6000 },
          values: { mix: 0.25 },
        }),
        add('lvl1l', 'kit.gain', { label: 'Level L', values: { gain: 3 } }),
        add('lvl1r', 'kit.gain', { label: 'Level R', values: { gain: 3 } }),
        add('safel1', 'kit.tanh', { label: 'Safe L' }),
        add('safer1', 'kit.tanh', { label: 'Safe R' }),
        add('out1', 'kit.out'),
        wire('mixl1.out', 'room1.left'),
        wire('mixr1.out', 'room1.right'),
        wire('room1.left', 'lvl1l.in'),
        wire('room1.right', 'lvl1r.in'),
        wire('lvl1l.out', 'safel1.in'),
        wire('lvl1r.out', 'safer1.in'),
        wire('safel1.out', 'out1.left'),
        wire('safer1.out', 'out1.right'),
        // The drop becomes a part (its cable to Splay is its output), and so does where a sound sits.
        { op: 'makePart', ids: drop, name: 'Drop', id: 'drop', node: 'drop1' },
        { op: 'makePart', ids: place, name: 'Place', id: 'place', node: 'place1' },
      ],
      // Their knobs: how often a drop ticks, how high it rings, how long it splashes; how near a sound is, which side, and whether behind.
      doc => [
        ...onlyParams(doc, 'drop', [
          {
            node: 'tick1',
            port: 'rate',
            id: 'rain',
            label: 'Rain',
            range: { min: 0.5, max: 16, scale: 'log', unit: 'Hz' },
          },
          {
            node: 'band1',
            port: 'hz',
            id: 'pitch',
            label: 'Pitch',
            range: { min: 400, max: 8000, scale: 'log', unit: 'Hz' },
          },
          {
            node: 'env1',
            port: 'decay',
            id: 'splash',
            label: 'Splash',
            range: { min: 0.005, max: 0.4, scale: 'log', unit: 's' },
          },
        ]),
        ...onlyParams(doc, 'place', [
          { node: 'lvl1', port: 'a', id: 'level', label: 'Level', range: { min: 0, max: 1 } },
          { node: 'pan1', port: 'a', id: 'pan', label: 'Pan', range: { min: -1, max: 1 } },
          { node: 'back1', port: 'a', id: 'behind', label: 'Behind', range: { min: 0, max: 1 } },
        ]),
      ],
      doc => {
        const where = doc.parts.place!;
        const [inL, inR] = where.inputs.map(p => p.id);
        const [outL, outR] = where.outputs.map(p => p.id);
        return [
          {
            op: 'updatePart',
            part: 'drop',
            doc: 'One raindrop: a tick, a chance that it falls, and a short burst of noise ringing in a narrow band. Use it many times (×N): every copy falls on its own.',
            face: DROP_FACE,
          },
          {
            op: 'updatePart',
            part: 'place',
            doc: 'Where a sound sits around the listener: Level from how near it is, Pan from which side (the far side fades out, the near side stays), Behind (0 or 1) dulls it behind the listener, most when straight behind. Takes and gives left and right.',
            labels: { [inL!]: 'Left in', [inR!]: 'Right in', [outL!]: 'Left', [outR!]: 'Right' },
          },
          // ×16, each copy at its own pace and pitch.
          { op: 'setCount', node: 'drop1', count: 16 },
          {
            op: 'setSpread',
            node: 'drop1',
            port: 'rain',
            spread: { kind: 'random', amount: 0.8, seed: 5 },
          },
          {
            op: 'setSpread',
            node: 'drop1',
            port: 'pitch',
            spread: { kind: 'random', amount: 0.7, seed: 9 },
          },
          // The drips: the same drop once more, slower, lower and longer.
          add('drip1', 'kit.part', {
            part: 'drop',
            label: 'Drips',
            values: { rain: 0.9, pitch: 700, splash: 0.18 },
          }),
          // Each sound in its place.
          add('place2', 'kit.part', { part: 'place', label: 'Wind’s place' }),
          add('place3', 'kit.part', { part: 'place', label: 'Thunder’s place' }),
          add('place4', 'kit.part', { part: 'place', label: 'Drips’ place' }),
          ...(
            [
              ['farlvl1.out', 'place2', 2],
              ['tlvl1.out', 'place3', 3],
              ['drip1.out', 'place4', 4],
            ] as const
          ).flatMap(([from, use, n]) => [
            wire(from, `${use}.${inL}`),
            wire(from, `${use}.${inR}`),
            wire(`${use}.${outL}`, `mixl1.in${n}`),
            wire(`${use}.${outR}`, `mixr1.in${n}`),
          ]),
          ...LAYERS.flatMap((l, i) => [
            ...patchControl(
              l.level,
              `${l.name}: near`,
              `place${i + 1}.level`,
              [0, 1, 'linear', ''],
              l.at[0],
            ),
            ...patchControl(
              l.pan,
              `${l.name}: side`,
              `place${i + 1}.pan`,
              [-1, 1, 'linear', ''],
              l.at[1],
            ),
            add(l.back, 'ui.toggle', { label: `${l.name}: behind`, values: { value: l.behind } }),
            wire(`${l.back}.out`, `place${i + 1}.behind`),
          ]),
          // ---- the plugin: the space around you, edge to edge ----
          {
            op: 'setLook',
            look: {
              tokens: {
                bg: '#b9d35a',
                fg: '#141a0b',
                accent: '#2430d6',
                track: '#7d8a58',
                knob: '#b9d35a',
                pointer: '#141a0b',
                muted: '#46521f',
                glow: '#2430d6',
                font: 'system',
                labelFont: 'system',
                valueFont: 'system',
              },
              background: [{ kind: 'color', color: '#b9d35a' }],
            },
          },
          el({
            kind: 'canvas',
            name: 'The space around you',
            code: FIELD,
            rect: r(0, 0, 760, 500),
            props: { dripHz: 700 },
          }),
          // How much each sound makes: the plugin's meters, bottom right (the field draws their names).
          ...(
            [
              ['mdrops', 'drop1.out'],
              ['mwind', 'farlvl1.out'],
              ['mthunder', 'tlvl1.out'],
              ['mdrips', 'drip1.out'],
            ] as const
          ).flatMap(([id, from], i) => [
            ...control(id, 'ui.meter', LAYERS[i]!.name, null, r(676, 400 + i * 22, 68, 4), {
              style: {
                skin: {
                  name: 'bar',
                  params: { fill: LAYERS[i]!.color, surface: '#7d8a58', scale: false },
                },
              },
            }),
            wire(from, `${id}.in`),
          ]),
          // The rest is moved by the field's figures: kept in the patch.
          ...patchControl('kwidth', 'Drops across', 'splay1.width', [0, 1, 'linear', ''], 0.85),
          ...patchControl('kroom', 'Room', 'room1.mix', [0, 1, 'linear', ''], 0.25),
          // The Drop's knobs: they set the part for all 16 copies.
          ...patchControl('knob1', 'Rain', 'drop1.rain', [0.5, 16, 'log', 'Hz'], 6),
          ...patchControl('knob2', 'Pitch', 'drop1.pitch', [400, 8000, 'log', 'Hz'], 2400),
          ...patchControl('knob3', 'Splash', 'drop1.splash', [0.005, 0.4, 'log', 's'], 0.035),
        ];
      },
    ],
  );
}

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
// a disc of lime ground around you seen from behind and above, you standing in
// the middle and the half behind you veiled duller. Each sound stands on a
// stake where it is, and is drawn on the ground as it is heard (ripples, grass
// bending, a cloud's shadow, a drip); you drag a stake nearer, further, left or
// right (its Level, Pan and Behind stay in the patch). The Drop part's knobs
// (Rain, Pitch, Splash: every copy at once), Drops across and Room are set by
// dragging the ground, also kept in the patch; your body is the plugin's meter
// of what reaches you.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The four sounds: their controls (level, pan and behind, kept in the patch) and where they start. */
const LAYERS = [
  {
    name: 'Drops',
    level: 'kdrops',
    pan: 'kdropspan',
    back: 'kdropsback',
    at: [0.6, -0.35],
    behind: false,
  },
  {
    name: 'Wind and far rain',
    level: 'kwind',
    pan: 'kwindpan',
    back: 'kwindback',
    at: [0.4, 0.6],
    behind: false,
  },
  {
    name: 'Thunder',
    level: 'kthunder',
    pan: 'kthunderpan',
    back: 'kthunderback',
    at: [0.35, -0.7],
    behind: false,
  },
  {
    name: 'Drips',
    level: 'kdrips',
    pan: 'kdripspan',
    back: 'kdripsback',
    at: [0.55, 0.4],
    behind: true,
  },
] as const;

/** The ground around the listener, seen from behind and above; it takes the mouse. */
export const FIELD = `// The space around you: a disc of ground seen from behind and above you, front
// far up the screen and behind near, you standing in the middle; the half
// behind you is veiled duller, as it is heard. Each sound stands on a stake
// where it is: how near it is to you sets its level (1 at your feet, 0 at the
// rim), the side it is on sets its pan (-1 left, +1 right), and the half it is
// in sets its Behind switch. Drag a stake to move its sound. Each sound is drawn
// on the ground as it is heard: drops land as white ripples in a patch round
// their stake (sharp jumps high in the spectrum), the wind bends a patch of
// grass (the low middle of the spectrum), thunder is a cloud's shadow that
// darkens and rolls out when the lowest bands rise, and a drip falls down its
// stake and rings once (a jump around its note, props.dripHz). The rest is set
// on the ground, with a plate by the hand saying what: the drops' patch takes
// Rain (knob1, up and down) and Drops across (kwidth, left and right: the
// patch's width); the ground inside the rim takes each drop's Pitch (knob2,
// left and right) and Splash (knob3, up and down), seen in the ripples; outside
// the rim, Room (kroom, up and down), drawn as an echo of the rim. A drag keeps
// to the direction it starts in; scrolling moves the up-and-down setting.
const TAU = Math.PI * 2;
const LAYERS = [
  { name: 'drops', level: 'kdrops', pan: 'kdropspan', back: 'kdropsback' },
  { name: 'wind', level: 'kwind', pan: 'kwindpan', back: 'kwindback' },
  { name: 'thunder', level: 'kthunder', pan: 'kthunderpan', back: 'kthunderback' },
  { name: 'drips', level: 'kdrips', pan: 'kdripspan', back: 'kdripsback' },
];
const INK = '#141a0b', DULL = '#56633a', WHITE = '#fbfdf0', DISC = '#c5dd68', ECHO = '#141a0b';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The settings set on the ground: control, range, log or not, how it reads.
const SET = {
  knob1: { lo: 0.5, hi: 16, log: true, show: v => v.toFixed(1) + ' a second' },
  knob2: { lo: 400, hi: 8000, log: true, show: v => (v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz') },
  knob3: { lo: 0.005, hi: 0.4, log: true, show: v => Math.round(v * 1000) + ' ms' },
  kwidth: { lo: 0, hi: 1, log: false, show: v => Math.round(v * 100) + '%' },
  kroom: { lo: 0, hi: 1, log: false, show: v => Math.round(v * 100) + '%' },
};
const AXES = { patch: { x: 'kwidth', y: 'knob1' }, ground: { x: 'knob2', y: 'knob3' }, room: { y: 'kroom' } };
const normOf = (id, v) => { const d = SET[id]; return clamp(d.log ? Math.log(v / d.lo) / Math.log(d.hi / d.lo) : (v - d.lo) / (d.hi - d.lo), 0, 1); };
const valueOf = (id, n) => { const d = SET[id]; n = clamp(n, 0, 1); return d.log ? d.lo * Math.pow(d.hi / d.lo, n) : d.lo + n * (d.hi - d.lo); };
// The camera, D behind you: the rim runs from 150 down to 26 above the bottom, 340 either side at its widest.
const D = 7;
function lens(w, h) {
  const HF = ((h - 26 - 150) * (D * D - 1)) / 2, F = 340 * Math.sqrt(D * D - 1);
  return { cx: w / 2, HOR: h - 26 - HF / (D - 1), HF, F };
}
/** A point on the ground (x right, z ahead, the rim 1 from you) on the screen, and how big things there are drawn. */
function toScreen(L, x, z) { const d = D + z; return { x: L.cx + (L.F * x) / d, y: L.HOR + L.HF / d, s: D / d }; }
/** A point on the screen back on the ground. */
function toGround(L, sx, sy) { const d = L.HF / Math.max(1, sy - L.HOR); return { x: ((sx - L.cx) * d) / L.F, z: d - D }; }
/** Where a point on the ground is on the screen, for a field w × h. */
export const ground = (x, z, w, h) => toScreen(lens(w, h), x, z);
/** A ring of radius r on the ground round (x, z), as a path. */
function ring(ctx, L, x, z, r) {
  const n = r > 0.5 ? 128 : 36;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, p = toScreen(L, x + Math.cos(a) * r, z + Math.sin(a) * r); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
  ctx.closePath();
}
function spot(f, k) {
  const L = LAYERS[k], r = 1 - clamp(f.value(L.level), 0, 1), a = Math.asin(clamp(f.value(L.pan), -1, 1));
  return { x: r * Math.sin(a), z: (f.on(L.back) ? -1 : 1) * r * Math.cos(a) };
}
const patchOf = f => 0.06 + 0.2 * clamp(f.value('kwidth'), 0, 1);
/** The part under the hand: a stake (or its foot), the drops' patch, the ground inside the rim, or outside it. */
function where(f, L, x, y) {
  for (let k = 0; k < LAYERS.length; k++) {
    const g = spot(f, k), p = toScreen(L, g.x, g.z), top = p.y - 34 * p.s;
    if (Math.abs(x - p.x) < 12 && y > top - 12 && y < p.y + 10) return { kind: 'source', k };
  }
  const g = toGround(L, x, y), d = spot(f, 0);
  if (Math.hypot(g.x - d.x, g.z - d.z) < patchOf(f)) return { kind: 'patch' };
  return { kind: Math.hypot(g.x, g.z) <= 1 ? 'ground' : 'room' };
}
function plate(ctx, text, x, y, w) {
  ctx.font = '700 12px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * 6.8) + 18;
  const x0 = clamp(x - tw / 2, 6, w - tw - 6);
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(Math.round(x0), Math.round(y - 12), Math.round(tw), 24, 12); ctx.fill();
  ctx.fillStyle = DISC; ctx.fillText(text, Math.round(x0 + 9), Math.round(y) + 0.5);
}
const band = hz => (64 * Math.log(hz / 96)) / Math.log(250);
export default {
  setup(ctx, f) {
    const blades = [];
    // Grass in loose rows, so it reads as a patch of ground rather than a scribble.
    for (let i = 0; i < 30; i++) { const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 30) * 0.13; blades.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8, ph: i * 0.7, len: 0.8 + 0.4 * ((i * 7) % 5) / 4 }); }
    Object.assign(f.state, { drag: null, prev: null, ripples: [], blades, lastDrop: 0, drip: 0, lastDrip: -10, low: 0, lastThunder: -10, windLo: 1, windHi: 0, wind: 0 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, L = lens(w, h), C = toScreen(L, 0, 0);
    const room = clamp(f.value('kroom'), 0, 1), splash = normOf('knob3', f.value('knob3')), pitch = normOf('knob2', f.value('knob2'));
    const p = f.pointer, hot = s.drag ? s.drag.at : p && p.over ? where(f, L, p.x, p.y) : null;
    ctx.clearRect(0, 0, w, h);
    // The room: an echo of the rim outside it, further out the more the room rings.
    ctx.strokeStyle = ECHO; ctx.lineWidth = 1.2; ctx.setLineDash([4, 6]);
    ctx.globalAlpha = hot && hot.kind === 'room' ? 0.7 : 0.3;
    ring(ctx, L, 0, 0, 1.04 + 0.16 * room); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // The ground you hear, the half behind you veiled.
    ring(ctx, L, 0, 0, 1); ctx.fillStyle = DISC; ctx.fill();
    ctx.save();
    ring(ctx, L, 0, 0, 1); ctx.clip();
    const veil = ctx.createLinearGradient(0, C.y - 8, 0, C.y + 60);
    veil.addColorStop(0, 'rgba(20, 26, 11, 0)'); veil.addColorStop(1, 'rgba(20, 26, 11, 0.13)');
    ctx.fillStyle = veil; ctx.fillRect(0, C.y - 8, w, h - C.y + 8);
    ctx.restore();
    ring(ctx, L, 0, 0, 1); ctx.strokeStyle = INK; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
    const far = toScreen(L, 0, 1), near = toScreen(L, 0, -1), side = toScreen(L, 1, -1 / D);
    ctx.fillStyle = INK; ctx.font = '600 12px ' + FONT; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 0.75;
    ctx.textAlign = 'center'; ctx.fillText('front', far.x, far.y - 10); ctx.fillText('behind', near.x, Math.min(h - 6, near.y + 20));
    ctx.textAlign = 'left'; ctx.fillText('left', L.cx - (side.x - L.cx) + 12, side.y + 4);
    ctx.textAlign = 'right'; ctx.fillText('right', side.x - 12, side.y + 4);
    ctx.globalAlpha = 1;
    // What is heard: spectral jumps for drops and drips, the low end for thunder and wind
    // (the first frame only sets where each starts from).
    const sp = f.spectrum || new Float32Array(64), first = !s.prev;
    if (first) s.prev = new Float32Array(sp);
    let flux = 0;
    for (let i = 30; i < 58; i++) flux += Math.max(0, sp[i] - s.prev[i]);
    const dripBand = band(f.props.dripHz || 700), bi = clamp(Math.floor(dripBand), 0, 62);
    const drip = sp[bi] * (1 - (dripBand - bi)) + sp[bi + 1] * (dripBand - bi);
    if (first) s.drip = drip;
    const dripJump = drip - s.drip;
    s.drip += (drip - s.drip) * Math.min(1, f.dt * 3);
    let low = 0;
    for (let i = 0; i < 4; i++) low += sp[i] / 4;
    if (first) s.low = low;
    const lowJump = low - s.low;
    s.low += (low - s.low) * Math.min(1, f.dt * 0.6);
    let wind = 0;
    for (let i = 8; i < 17; i++) wind += sp[i] / 9;
    s.windHi = wind > s.windHi ? wind : s.windHi - (s.windHi - wind) * f.dt * 0.1;
    s.windLo = wind < s.windLo ? wind : s.windLo + (wind - s.windLo) * f.dt * 0.1;
    s.wind += ((s.windHi - s.windLo > 0.02 ? (wind - s.windLo) / (s.windHi - s.windLo) : 0) - s.wind) * Math.min(1, f.dt * 3);
    s.prev.set(sp);
    const at = [0, 1, 2, 3].map(k => spot(f, k)), pr = patchOf(f);
    if (flux > 0.6 && f.t - s.lastDrop > 0.05 && f.value('kdrops') > 0.02) {
      s.lastDrop = f.t;
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * pr;
      s.ripples.push({ x: at[0].x + Math.cos(a) * d, z: at[0].z + Math.sin(a) * d, born: f.t, life: 0.5 + splash, size: 0.025 + 0.06 * splash, k: 0 });
    }
    if (dripJump > 0.08 && f.t - s.lastDrip > 0.35 && f.value('kdrips') > 0.02) {
      s.lastDrip = f.t;
      s.ripples.push({ x: at[3].x, z: at[3].z, born: f.t + 0.35, life: 1.6, size: 0.13, k: 3 });
    }
    if (lowJump > 0.05 && f.t - s.lastThunder > 2 && f.value('kthunder') > 0.02) s.lastThunder = f.t;
    s.ripples = s.ripples.filter(q => f.t - q.born < q.life).slice(-80);
    // Thunder: a cloud's shadow, darker and wider while it rolls.
    const roll = Math.max(0, 1 - (f.t - s.lastThunder) / 3);
    ctx.fillStyle = INK; ctx.globalAlpha = 0.06 + 0.14 * roll;
    ring(ctx, L, at[2].x, at[2].z, 0.19 + 0.09 * roll); ctx.fill();
    ctx.globalAlpha = 1;
    // The ripples: white rings for drops and drips, more rings the lower they ring.
    ctx.save();
    ring(ctx, L, 0, 0, 1); ctx.clip();
    const rings = 1 + Math.round(2 * (1 - pitch));
    for (const q of s.ripples) {
      const age = (f.t - q.born) / q.life;
      if (age < 0) continue;
      const behind = q.z < 0;
      ctx.strokeStyle = WHITE; ctx.lineWidth = 1.6; ctx.globalAlpha = (1 - age) * (behind ? 0.5 : 0.95);
      for (let j = 0; j < (q.k === 3 ? 2 : rings); j++) { ring(ctx, L, q.x, q.z, (0.004 + age * q.size) * (1 - j * 0.32)); ctx.stroke(); }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // The drops' patch while the hand is on it.
    if (hot && hot.kind === 'patch') { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ring(ctx, L, at[0].x, at[0].z, pr); ctx.stroke(); ctx.setLineDash([]); }
    // The wind: a patch of grass, bent and swaying as hard as it blows.
    const wb = toScreen(L, at[1].x, at[1].z);
    ctx.strokeStyle = at[1].z < 0 ? DULL : INK; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.globalAlpha = f.value('kwind') <= 0.02 ? 0.4 : 1;
    for (const b of s.blades) {
      const q = toScreen(L, at[1].x + b.x, at[1].z + b.z), len = (9 + 6 * s.wind) * b.len * q.s;
      const lean = ((1.5 + 5 * s.wind) * Math.sin(f.t * (1.2 + 3 * s.wind) + b.ph) + 2 + 5 * s.wind) * q.s;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.quadraticCurveTo(q.x + lean * 0.2, q.y - len * 0.6, q.x + lean, q.y - len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The stakes, far ones first, each with its name (a plate while the hand is on it); a drip runs down its own.
    const order = [0, 1, 2, 3].sort((a, b) => at[b].z - at[a].z);
    for (const k of order) {
      const g = at[k], q = toScreen(L, g.x, g.z), top = q.y - 34 * q.s, color = g.z < 0 ? DULL : INK;
      ctx.globalAlpha = f.value(LAYERS[k].level) <= 0.02 ? 0.4 : 1;
      ctx.fillStyle = color; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 5 * q.s, 2.2 * q.s, 0, 0, TAU); ctx.fill();
      ctx.lineWidth = 2 * q.s; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, top); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, top, 3.4 * q.s, 0, TAU); ctx.fill();
      if (k === 3) {
        const fall = (f.t - s.lastDrip) / 0.35;
        if (fall >= 0 && fall < 1) { ctx.beginPath(); ctx.arc(q.x + 6 * q.s, top + fall * (q.y - top), 2.6 * q.s, 0, TAU); ctx.fill(); }
      }
      const on = hot && hot.kind === 'source' && hot.k === k;
      if (on) {
        const v = clamp(f.value(LAYERS[k].level), 0, 1);
        plate(ctx, LAYERS[k].name + ' · ' + Math.round(v * 100) + '% near' + (g.z < 0 ? ', behind' : ''), q.x, top - 22, w);
      } else {
        ctx.font = '700 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(LAYERS[k].name, q.x, top - 10);
      }
      ctx.globalAlpha = 1;
    }
    // You: the plugin's meter is your body (what reaches you); a head on it, your shadow at your feet.
    ctx.fillStyle = INK; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.ellipse(C.x, C.y, 10, 3.5, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(C.x, C.y - 33, 6, 0, TAU); ctx.fill();
    ctx.font = '700 13px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('you', C.x + 11, C.y - 29);
    // The settings set on the ground: a plate by the hand.
    if (hot && p && hot.kind !== 'source') {
      const v = id => SET[id].show(f.value(id));
      const text = hot.kind === 'patch' ? 'rain ' + v('knob1') + ' ↕ · across ' + v('kwidth') + ' ↔'
        : hot.kind === 'ground' ? 'each drop: pitch ' + v('knob2') + ' ↔ · splash ' + v('knob3') + ' ↕'
        : 'room ' + v('kroom') + ' ↕';
      plate(ctx, text, p.x, p.y - 30, w);
    }
  },
  pointer(e, f) {
    const s = f.state, L = lens(f.w, f.h);
    if (e.type === 'down') {
      const at = where(f, L, e.x, e.y);
      if (at.kind === 'source') { const g = spot(f, at.k), q = toScreen(L, g.x, g.z); s.drag = { at, ox: q.x - e.x, oy: q.y - e.y }; }
      else {
        const from = {};
        for (const id of Object.values(AXES[at.kind])) from[id] = normOf(id, f.value(id));
        s.drag = { at, x0: e.x, y0: e.y, from, axis: at.kind === 'room' ? 'y' : null };
      }
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && d.at.kind === 'source' && (e.type === 'down' || e.type === 'move')) {
      const g = toGround(L, e.x + d.ox, e.y + d.oy), r = Math.hypot(g.x, g.z), Lk = LAYERS[d.at.k];
      f.set(Lk.level, 1 - Math.min(1, r));
      f.set(Lk.pan, r < 0.001 ? 0 : clamp(g.x / r, -1, 1));
      f.set(Lk.back, g.z < 0);
    } else if (d && e.type === 'move') {
      const dx = e.x - d.x0, dy = e.y - d.y0;
      if (!d.axis && Math.hypot(dx, dy) > 4) d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = d.axis && AXES[d.at.kind][d.axis];
      if (id) f.set(id, valueOf(id, d.from[id] + (d.axis === 'x' ? dx : -dy) / 200));
    }
    if (e.type === 'wheel') {
      const at = where(f, L, e.x, e.y), id = at.kind === 'source' ? null : AXES[at.kind].y;
      if (id) f.set(id, valueOf(id, normOf(id, f.value(id)) - Math.sign(e.dy) * 0.025));
    }
    const at = d ? d.at : where(f, L, e.x, e.y);
    f.cursor(d && d.at.kind === 'source' ? 'grabbing' : at.kind === 'source' ? 'grab' : at.kind === 'room' ? 'ns-resize' : 'move');
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
          // ---- the plugin: the ground around you, seen from behind and above ----
          {
            op: 'setLook',
            look: {
              tokens: {
                bg: '#b9d35a',
                fg: '#141a0b',
                accent: '#141a0b',
                track: '#8ea53f',
                knob: '#c5dd68',
                pointer: '#141a0b',
                muted: '#3f4a1c',
                glow: '#141a0b',
                font: 'baloo-2',
                labelFont: 'baloo-2',
                valueFont: 'baloo-2',
              },
              background: [{ kind: 'color', color: '#b9d35a' }],
            },
          },
          el({
            kind: 'canvas',
            name: 'The ground around you',
            code: FIELD,
            rect: r(0, 0, 760, 500),
            props: { dripHz: 700 },
          }),
          el({
            kind: 'text',
            name: 'Title',
            text: 'Rain Field',
            rect: r(24, 14, 300, 48),
            textStyle: { font: 'baloo-2', size: 36, weight: 700, color: 'fg', align: 'left' },
          }),
          // You, in the middle of the field: your body is how loud it is where you stand, both ears.
          add('ears1', 'kit.add', { label: 'Both ears' }),
          wire('safel1.out', 'ears1.a'),
          wire('safer1.out', 'ears1.b'),
          ...control('myou', 'ui.meter', 'What reaches you', null, r(377, 263, 6, 26), {
            style: {
              skin: { name: 'bar', params: { fill: '#141a0b', surface: '#8ea53f', scale: false } },
            },
          }),
          wire('ears1.out', 'myou.in'),
          // The rest is set by dragging the ground: kept in the patch.
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

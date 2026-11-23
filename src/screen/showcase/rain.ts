// Rain Field — a sound installation of rain all around the listener: drops
// close by, wind with the rain further off, thunder far away and drips from a
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
// Innovation), an app of sound worlds you mix by placing sounds round you,
// with animations that move in step with the sound: the plugin is one canvas,
// a clearing in a wood, in the rain, seen from straight above, you under an
// umbrella in the middle. Each sound is drawn as the thing it is, where it is
// (a small cloud raining on its puddle, a patch of long grass in the wind, a
// storm cloud, a shed's gutter dripping into a water butt), the only things
// drawn with an ink edge, and moves as it is heard; you drag a thing nearer,
// further, left, right or behind you (its Level, Pan and Behind stay in the
// patch). The Drop part's knobs (Rain, Pitch, Splash: every copy at once),
// Drops across and Room are set by dragging the puddle, the open ground and the
// wood, also kept in the patch.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { add, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

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

/** The clearing round the listener, seen from straight above; it takes the mouse. */
export const FIELD = `// A clearing in a wood, in the rain, seen from straight above: you under an
// umbrella in the middle, ahead up the screen (your footprints come in from
// behind you). Each sound is the thing it is, where it is, and only the four
// sounds have an ink edge: the drops are a small cloud raining on its puddle,
// the wind a patch of long grass, the thunder a storm cloud and the drips a
// shed's gutter running into a water butt. How near a thing is to you sets its
// level (1 at your feet, 0 at the edge of the wood), the side it is on sets
// its pan (-1 left, +1 right), and the half it is in sets its Behind switch.
// Drag a thing to move its sound. Each moves as it is heard: drops ring on the
// puddle (sharp jumps high in the spectrum), the grass bends and sheds leaves
// with the low middle of the spectrum, the storm cloud flashes when the lowest
// bands jump, a drip falls into the butt when the band at its note jumps
// (props.dripHz), and rain patters on your umbrella as loud as it all is. Rain
// falls and splashes on the mown grass as loud as the far rain is (kwind), and
// harder over the puddle the higher Rain is (knob1). The rest is set by
// dragging, with words by the hand saying what and how much: the puddle takes
// Rain (knob1, up and down) and Drops across (kwidth, left and right: the
// puddle's width); the open ground takes each drop's Pitch (knob2, left and
// right) and Splash (knob3, up and down), seen in the ripples; the wood takes
// Room (kroom, up and down), drawn as echoes coming back off its edge. A drag
// keeps to the direction it starts in; scrolling moves the up-and-down setting.
const TAU = Math.PI * 2;
const LAYERS = [
  { name: 'The drops', level: 'kdrops', pan: 'kdropspan', back: 'kdropsback' },
  { name: 'The wind', level: 'kwind', pan: 'kwindpan', back: 'kwindback' },
  { name: 'The thunder', level: 'kthunder', pan: 'kthunderpan', back: 'kthunderback' },
  { name: 'The drips', level: 'kdrips', pan: 'kdripspan', back: 'kdripsback' },
];
const INK = '#141a0b', GROUND = '#b9d35a', STRIPE = '#c3db66', TUFT = '#9cb544', MOWN = '#dcec9f', CUT = '#93ac3b';
const LEAF_HI = '#a6c04d', WATER = '#4b5f20', WHITE = '#fbfdf0';
const STORM = '#585d53', STORM_HI = '#72776c', ROOF = '#8f9589', ROOF_LO = '#5c6256';
// The wood: the shade under it, its broadleaves in three greens with their lit sides, and its pines.
const SHADE = '#34481a', CROWN = ['#5a7526', '#67842c', '#4e6820'], CROWN_HI = ['#7b9937', '#88a63e', '#6f8c31'];
const PINE = '#3d5520', PINE_HI = '#57742b';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** The same random numbers every time, from a seed. */
function seeded(n) { let s = n >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// The settings set by dragging: control, range, log or not, how it reads.
const SET = {
  knob1: { lo: 0.5, hi: 16, log: true, show: v => v.toFixed(1) + ' drops a second' },
  knob2: { lo: 400, hi: 8000, log: true, show: v => (v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz') },
  knob3: { lo: 0.005, hi: 0.4, log: true, show: v => Math.round(v * 1000) + ' ms' },
  kwidth: { lo: 0, hi: 1, log: false, show: v => Math.round(v * 100) + '%' },
  kroom: { lo: 0, hi: 1, log: false, show: v => Math.round(v * 100) + '%' },
};
const AXES = { patch: { x: 'kwidth', y: 'knob1' }, ground: { x: 'knob2', y: 'knob3' }, room: { y: 'kroom' } };
const normOf = (id, v) => { const d = SET[id]; return clamp(d.log ? Math.log(v / d.lo) / Math.log(d.hi / d.lo) : (v - d.lo) / (d.hi - d.lo), 0, 1); };
const valueOf = (id, n) => { const d = SET[id]; n = clamp(n, 0, 1); return d.log ? d.lo * Math.pow(d.hi / d.lo, n) : d.lo + n * (d.hi - d.lo); };
/** The clearing on the screen: you in the middle, the edge of the wood 1 away (it is wider across than ahead). */
function layout(w, h) { return { cx: w / 2, cy: h * 0.47, RX: w * 0.434, RZ: h * 0.39 }; }
/** A point on the ground (x right, z ahead, the edge of the wood 1 from you) on the screen. */
function toScreen(L, x, z) { return { x: L.cx + x * L.RX, y: L.cy - z * L.RZ }; }
/** A point on the screen back on the ground. */
function toGround(L, sx, sy) { return { x: (sx - L.cx) / L.RX, z: (L.cy - sy) / L.RZ }; }
/** Where a point on the ground is on the screen, for a field w × h. */
export const ground = (x, z, w, h) => toScreen(layout(w, h), x, z);
function spot(f, k) {
  const L = LAYERS[k], r = 1 - clamp(f.value(L.level), 0, 1), a = Math.asin(clamp(f.value(L.pan), -1, 1));
  return { x: r * Math.sin(a), z: (f.on(L.back) ? -1 : 1) * r * Math.cos(a) };
}
// How far the drops' puddle reaches on the ground: wider with Drops across, and at its narrowest still out
// past its cloud's sides, where it takes the hand.
const patchOf = f => 0.09 + 0.11 * clamp(f.value('kwidth'), 0, 1);
// What each thing covers round its spot on the screen: left, top, right, bottom.
const BOX = [[-20, -15, 20, 13], [-40, -28, 46, 22], [-44, -30, 44, 28], [-26, -21, 38, 26]];
function boxOf(L, f, k) {
  const g = spot(f, k), p = toScreen(L, g.x, g.z), b = BOX[k];
  return { x0: p.x + b[0], y0: p.y + b[1], x1: p.x + b[2], y1: p.y + b[3], p, g };
}
const UMBRELLA = 26;
/** The part under the hand: a thing (the clouds over the rest), you, the puddle, the wood or the open ground. */
function where(f, L, x, y) {
  for (const k of [2, 0, 3, 1]) {
    const b = boxOf(L, f, k);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { kind: 'source', k };
  }
  if (Math.hypot(x - L.cx, y - L.cy) < UMBRELLA) return { kind: 'you' };
  const g = toGround(L, x, y), d = spot(f, 0);
  if (Math.hypot(g.x - d.x, g.z - d.z) < patchOf(f)) return { kind: 'patch' };
  if (Math.hypot(g.x, g.z) > 1.06 || (f.state.crowns || []).some(t => Math.hypot(x - t.x, y - t.y) < t.r * 0.8)) return { kind: 'room' };
  return { kind: 'ground' };
}
/**
 * The wood round the clearing: a ring of crowns just past the edge of hearing (they lean into the clearing; the
 * echoes come off them), and more behind them out to the edges of the field. A crown is a broadleaf (round lobes
 * about its middle, in one of three greens) or a pine (a star of needles).
 */
function wood(w, h, L, R) {
  const crowns = [];
  const grow = (x, y, r, edge) => {
    const tone = Math.floor(R() * 3);
    if (R() < 0.3) return crowns.push({ x, y, r: r * 0.8, edge, pine: true, tone, spikes: 10 + Math.floor(R() * 6), turn: R() * TAU });
    const lobes = [], n = 5 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R() * 0.7, d = r * (0.3 + R() * 0.3);
      lobes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: r * (0.4 + R() * 0.25) });
    }
    lobes.push({ x: 0, y: 0, r: r * 0.62 });
    crowns.push({ x, y, r, edge, pine: false, tone, lobes });
  };
  for (let i = 0; i < 44; i++) {
    const a = ((i + R() * 0.6) / 44) * TAU, d = 1.08 + R() * 0.14;
    grow(L.cx + Math.cos(a) * d * L.RX, L.cy - Math.sin(a) * d * L.RZ, 20 + R() * 22, true);
  }
  for (let i = 0; i < 400 && crowns.length < 100; i++) {
    const x = R() * w, y = R() * h, g = toGround(L, x, y);
    if (Math.hypot(g.x, g.z) > 1.3) grow(x, y, 26 + R() * 24, false);
  }
  return crowns.sort((a, b) => a.y - b.y);
}
/** A crown's outline (a broadleaf's lobes or a pine's star), moved by dx, dy and scaled by k about its middle. */
function crown(ctx, t, dx, dy, k) {
  const x = t.x + dx, y = t.y + dy;
  if (t.pine) {
    for (let i = 0; i < t.spikes * 2; i++) {
      const a = t.turn + (i / (t.spikes * 2)) * TAU, r = t.r * k * (i % 2 ? 0.6 : 1);
      if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    return;
  }
  for (const l of t.lobes) { ctx.moveTo(x + l.x * k + l.r * k, y + l.y * k); ctx.arc(x + l.x * k, y + l.y * k, l.r * k, 0, TAU); }
}
/** Round lobes as one shape with an ink edge: the edges first, then the fill over the inner ones. */
function lumps(ctx, x, y, lobes, fill, edge) {
  ctx.beginPath();
  for (const l of lobes) { ctx.moveTo(x + l.x + l.r, y + l.y); ctx.arc(x + l.x, y + l.y, l.r, 0, TAU); }
  ctx.strokeStyle = INK; ctx.lineWidth = edge * 2; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
}
function lobePath(ctx, x, y, lobes, k) {
  for (const l of lobes) { ctx.moveTo(x + l.x + l.r * k, y + l.y); ctx.arc(x + l.x, y + l.y, l.r * k, 0, TAU); }
}
// A small rain cloud and a storm cloud, as round lobes about their middle.
const SHOWER = [{ x: -11, y: 2, r: 8 }, { x: -2, y: -4, r: 10 }, { x: 9, y: 0, r: 8 }, { x: 1, y: 5, r: 8 }];
const THUNDERHEAD = [
  { x: -27, y: 4, r: 15 }, { x: -11, y: -9, r: 19 }, { x: 9, y: -8, r: 17 }, { x: 26, y: 4, r: 14 },
  { x: 1, y: 8, r: 18 }, { x: -17, y: 12, r: 12 }, { x: 17, y: 12, r: 13 },
];
/** Words by the hand: ink straight on the grass, the first line bold. */
function words(ctx, lines, x, y, w) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let width = 0;
  for (let i = 0; i < lines.length; i++) {
    ctx.font = (i ? '500 12px ' : '700 13px ') + FONT;
    const m = ctx.measureText(lines[i]);
    width = Math.max(width, typeof m.width === 'number' ? m.width : lines[i].length * 7);
  }
  const x0 = clamp(x, width / 2 + 10, w - width / 2 - 10);
  ctx.fillStyle = INK;
  for (let i = 0; i < lines.length; i++) {
    ctx.font = (i ? '500 12px ' : '700 13px ') + FONT;
    ctx.fillText(lines[i], x0, Math.round(y + i * 16));
  }
}
const band = hz => (64 * Math.log(hz / 96)) / Math.log(250);
export default {
  setup(ctx, f) {
    const w = f.w, h = f.h, R = seeded(7), L = layout(w, h);
    const crowns = wood(w, h, L, R);
    // Long grass in a loose patch, its blades of different lengths.
    const blades = [];
    for (let i = 0; i < 46; i++) { const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 46); blades.push({ x: Math.cos(a) * r * 32, y: Math.sin(a) * r * 18, ph: i * 0.7, len: 0.75 + 0.45 * R(), dark: R() < 0.4 }); }
    const shore = [];
    for (let i = 0; i < 5; i++) shore.push(R() * TAU);
    Object.assign(f.state, { drag: null, prev: null, ripples: [], rain: [], hits: [], leaves: [], rings: [], blades, crowns, shore, lastDrop: 0, drip: 0, lastDrip: -10, low: 0, lastThunder: -10, windLo: 1, windHi: 0, wind: 0, owe: { far: 0, near: 0, hit: 0, leaf: 0, ring: 0 } });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, L = layout(w, h), C = { x: L.cx, y: L.cy };
    const room = clamp(f.value('kroom'), 0, 1), splash = normOf('knob3', f.value('knob3')), pitch = normOf('knob2', f.value('knob2'));
    const p = f.pointer, hot = s.drag ? s.drag.at : p && p.over ? where(f, L, p.x, p.y) : null;
    const dt = Math.min(0.1, f.dt || 0.016), props = f.props || {};
    // What is heard: spectral jumps for drops and drips, the low end for thunder and wind
    // (the first frame only sets where each starts from).
    const sp = f.spectrum || new Float32Array(64), first = !s.prev;
    if (first) s.prev = new Float32Array(sp);
    let flux = 0;
    for (let i = 30; i < 58; i++) flux += Math.max(0, sp[i] - s.prev[i]);
    const dripBand = band(props.dripHz || 700), bi = clamp(Math.floor(dripBand), 0, 62);
    const drip = sp[bi] * (1 - (dripBand - bi)) + sp[bi + 1] * (dripBand - bi);
    if (first) s.drip = drip;
    const dripJump = drip - s.drip;
    s.drip += (drip - s.drip) * Math.min(1, dt * 3);
    let low = 0;
    for (let i = 0; i < 4; i++) low += sp[i] / 4;
    if (first) s.low = low;
    const lowJump = low - s.low;
    s.low += (low - s.low) * Math.min(1, dt * 0.6);
    let wind = 0;
    for (let i = 8; i < 17; i++) wind += sp[i] / 9;
    s.windHi = wind > s.windHi ? wind : s.windHi - (s.windHi - wind) * dt * 0.1;
    s.windLo = wind < s.windLo ? wind : s.windLo + (wind - s.windLo) * dt * 0.1;
    s.wind += ((s.windHi - s.windLo > 0.02 ? (wind - s.windLo) / (s.windHi - s.windLo) : 0) - s.wind) * Math.min(1, dt * 3);
    s.prev.set(sp);
    const at = [0, 1, 2, 3].map(k => toScreen(L, spot(f, k).x, spot(f, k).z)), quiet = k => f.value(LAYERS[k].level) <= 0.02;
    const pr = patchOf(f), PX = pr * L.RX, PY = pr * L.RZ;
    if (flux > 0.6 && f.t - s.lastDrop > 0.05 && !quiet(0)) {
      s.lastDrop = f.t;
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 0.85;
      s.ripples.push({ x: at[0].x + Math.cos(a) * d * PX, y: at[0].y + Math.sin(a) * d * PY, born: f.t, life: 0.5 + splash, size: 7 + 26 * splash, k: 0 });
    }
    if (dripJump > 0.08 && f.t - s.lastDrip > 0.35 && !quiet(3)) {
      s.lastDrip = f.t;
      s.ripples.push({ x: 0, y: 0, born: f.t + 0.35, life: 1.6, size: 9, k: 3 });
    }
    if (lowJump > 0.05 && f.t - s.lastThunder > 2 && !quiet(2)) s.lastThunder = f.t;
    s.ripples = s.ripples.filter(q => f.t - q.born < q.life).slice(-80);
    // Rain in the air: everywhere as loud as the far rain, and over the puddle as hard as Rain; the far rain
    // splashes on the grass of the clearing.
    const owe = s.owe;
    const far = clamp(f.value('kwind'), 0, 1);
    owe.far += dt * 600 * far;
    owe.near += quiet(0) ? 0 : dt * (20 + 120 * normOf('knob1', f.value('knob1')));
    owe.ring += dt * 30 * far;
    for (; owe.far >= 1; owe.far--) s.rain.push({ x: Math.random() * w, y: Math.random() * h, born: f.t, life: 0.3 + Math.random() * 0.15 });
    for (; owe.near >= 1; owe.near--) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random());
      s.rain.push({ x: at[0].x + Math.cos(a) * d * PX, y: at[0].y + Math.sin(a) * d * PY, born: f.t, life: 0.25 + Math.random() * 0.1 });
    }
    for (; owe.ring >= 1; owe.ring--) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 0.95;
      s.rings.push({ x: L.cx + Math.cos(a) * d * L.RX, y: L.cy + Math.sin(a) * d * L.RZ, born: f.t, size: 3 + Math.random() * 3 });
    }
    s.rain = s.rain.filter(q => f.t - q.born < q.life).slice(-420);
    s.rings = s.rings.filter(q => f.t - q.born < 0.6).slice(-40);
    const roll = Math.max(0, 1 - (f.t - s.lastThunder) / 3), flash = f.t - s.lastThunder < 0.22;

    // The ground: grass mown in stripes, the far rain splashing on it.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = GROUND; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.rotate(-0.38); ctx.fillStyle = STRIPE; ctx.beginPath();
    for (let i = -14; i < 14; i += 2) ctx.rect(-w, i * 24, w * 2, 24);
    ctx.fill(); ctx.restore();
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1;
    for (const q of s.rings) { const age = (f.t - q.born) / 0.6; ctx.globalAlpha = 0.8 * (1 - age); ctx.beginPath(); ctx.arc(q.x, q.y, 0.5 + age * q.size, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // The name, small, at the top of the clearing.
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '700 11px ' + FONT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
    ctx.fillStyle = INK; ctx.fillText('RAIN FIELD', L.cx + 2.5, 96);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    // Your footprints, in from the wood behind you to where you stand.
    const y0 = L.cy + L.RZ * 0.98;
    for (let i = 0, y = y0; y > C.y + UMBRELLA + 10; i++, y -= 20) {
      const side = i % 2 ? 1 : -1, x = C.x + 10 * Math.sin((y0 - y) / 70) + side * 5;
      ctx.fillStyle = CUT; ctx.globalAlpha = 0.5 + 0.5 * (1 - (y - C.y) / (y0 - C.y));
      ctx.beginPath(); ctx.ellipse(x, y, 2.6, 4.6, side * 0.12, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Echoes coming back off the wood: rings moving in from its edge toward you, more of them the more the room
    // rings (under the crowns, which break them where they lean in).
    const echoes = Math.round(room * 4);
    if (echoes) {
      ctx.strokeStyle = INK; ctx.lineWidth = 1;
      for (let j = 0; j < echoes; j++) {
        const u = (j + ((f.t * 0.2) % 1)) / 4, k = 0.99 - 0.3 * Math.pow(u, 1.5);
        ctx.globalAlpha = (hot && hot.kind === 'room' ? 0.6 : 0.3) * (1 - u) * (1 - u);
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * TAU, m = k * (1 + 0.025 * Math.sin(3 * a + 1.3) + 0.018 * Math.sin(5 * a + 0.4) + 0.012 * Math.sin(9 * a + 2.1));
          if (i) ctx.lineTo(L.cx + Math.cos(a) * L.RX * m, L.cy + Math.sin(a) * L.RZ * m); else ctx.moveTo(L.cx + Math.cos(a) * L.RX * m, L.cy + Math.sin(a) * L.RZ * m);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // The wood round the clearing: deep shade under it, each crown's shadow on the grass, then the crowns lit
    // from the top left; no ink edge, as only the sounds have one.
    ctx.fillStyle = SHADE; ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.ellipse(L.cx, L.cy, L.RX * 1.16, L.RZ * 1.16, 0, 0, TAU); ctx.fill('evenodd');
    ctx.fillStyle = INK; ctx.globalAlpha = 0.2; ctx.beginPath();
    for (const t of s.crowns) crown(ctx, t, 7, 9, 1);
    ctx.fill(); ctx.globalAlpha = 1;
    for (const t of s.crowns) {
      ctx.fillStyle = t.pine ? PINE : CROWN[t.tone]; ctx.beginPath(); crown(ctx, t, 0, 0, 1); ctx.fill();
      ctx.fillStyle = t.pine ? PINE_HI : CROWN_HI[t.tone]; ctx.beginPath(); crown(ctx, t, -t.r * 0.16, -t.r * 0.18, 0.6); ctx.fill();
    }
    // The drops' puddle, its edge a little uneven, a drop ringing where each lands (more rings the lower they ring).
    const puddle = () => {
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU, k = 1 + 0.07 * Math.sin(3 * a + s.shore[0]) + 0.05 * Math.sin(5 * a + s.shore[1]);
        const x = at[0].x + Math.cos(a) * PX * k, y = at[0].y + Math.sin(a) * PY * k;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    ctx.globalAlpha = quiet(0) ? 0.45 : 1;
    puddle(); ctx.fillStyle = WATER; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.save(); puddle(); ctx.clip();
    ctx.strokeStyle = MOWN; ctx.globalAlpha *= 0.35; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(at[0].x - PX * 0.25, at[0].y - PY * 0.3, PX * 0.45, PY * 0.35, 0, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    ctx.globalAlpha = 1;
    const rings = 1 + Math.round(2 * (1 - pitch));
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5;
    for (const q of s.ripples) {
      const age = (f.t - q.born) / q.life;
      if (q.k !== 0 || age < 0) continue;
      ctx.globalAlpha = 1 - age;
      for (let j = 0; j < rings; j++) { ctx.beginPath(); ctx.arc(q.x, q.y, (2 + age * q.size) * (1 - j * 0.3), 0, TAU); ctx.stroke(); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    if (hot && hot.kind === 'patch') { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.ellipse(at[0].x, at[0].y, PX * 1.14, PY * 1.14, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    // The wind: a patch of long grass combed one way, harder and faster as it blows, shedding leaves in gusts.
    const g1 = at[1];
    ctx.globalAlpha = quiet(1) ? 0.45 : 1;
    ctx.fillStyle = TUFT; ctx.beginPath(); ctx.ellipse(g1.x + 4, g1.y + 1, 40, 24, 0, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    for (const dark of [false, true]) {
      ctx.strokeStyle = dark ? '#46551c' : INK; ctx.lineWidth = dark ? 1.4 : 1.7; ctx.beginPath();
      for (const b of s.blades) {
        if (b.dark !== dark) continue;
        const x = g1.x + b.x - 6, y = g1.y + b.y, sway = Math.sin(f.t * (1.4 + 3 * s.wind) + b.ph - b.x * 0.06);
        const lean = (9 + 8 * s.wind + (2 + 5 * s.wind) * sway) * b.len;
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.55, y - 3.5 * b.len, x + lean, y - 1 * b.len + sway * 1.5);
      }
      ctx.stroke();
    }
    owe.leaf += quiet(1) ? 0 : dt * Math.max(0, s.wind - 0.3) * 5;
    for (; owe.leaf >= 1; owe.leaf--) { const b = s.blades[Math.floor(Math.random() * s.blades.length)]; s.leaves.push({ x: g1.x + b.x, y: g1.y + b.y, born: f.t, ph: Math.random() * TAU }); }
    s.leaves = s.leaves.filter(q => f.t - q.born < 2.4).slice(-10);
    for (const q of s.leaves) {
      const age = f.t - q.born, x = q.x + age * (50 + 40 * s.wind), y = q.y + Math.sin(age * 4 + q.ph) * 6 + age * 4;
      ctx.globalAlpha = Math.min(1, (2.4 - age) / 0.7);
      ctx.save(); ctx.translate(x, y); ctx.rotate(age * 3 + q.ph);
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.quadraticCurveTo(0, -3.2, 5, 0); ctx.quadraticCurveTo(0, 3.2, -5, 0);
      ctx.fillStyle = LEAF_HI; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // The drips: a shed's roof seen from above, its gutter running into a water butt; a drip falls and rings in it.
    const d3 = at[3], butt = { x: d3.x + 27, y: d3.y + 15 };
    ctx.globalAlpha = quiet(3) ? 0.45 : 1;
    ctx.fillStyle = INK; ctx.globalAlpha *= 0.16; ctx.fillRect(d3.x - 23 + 6, d3.y - 18 + 8, 46, 30); ctx.globalAlpha = quiet(3) ? 0.45 : 1;
    ctx.fillStyle = ROOF; ctx.fillRect(d3.x - 23, d3.y - 18, 46, 15);
    ctx.fillStyle = ROOF_LO; ctx.fillRect(d3.x - 23, d3.y - 3, 46, 15);
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha *= 0.3; ctx.beginPath();
    for (let x = d3.x - 19; x < d3.x + 22; x += 4) { ctx.moveTo(x, d3.y - 17); ctx.lineTo(x, d3.y + 11); }
    ctx.stroke(); ctx.globalAlpha = quiet(3) ? 0.45 : 1;
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(d3.x - 23, d3.y - 3); ctx.lineTo(d3.x + 23, d3.y - 3); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(d3.x - 23, d3.y - 18, 46, 30);
    ctx.strokeStyle = INK; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(d3.x - 23, d3.y + 13.5); ctx.lineTo(d3.x + 22, d3.y + 13.5); ctx.stroke();
    ctx.strokeStyle = ROOF; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(butt.x, butt.y, 8.5, 0, TAU); ctx.fillStyle = WATER; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = ROOF_LO; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(butt.x, butt.y, 7, 0, TAU); ctx.clip();
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.2;
    for (const q of s.ripples) {
      const age = (f.t - q.born) / q.life;
      if (q.k !== 3 || age < 0) continue;
      ctx.globalAlpha = (1 - age) * (quiet(3) ? 0.45 : 1);
      for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(butt.x, butt.y, (1 + age * q.size) * (1 - j * 0.4), 0, TAU); ctx.stroke(); }
    }
    ctx.restore();
    const fall = (f.t - s.lastDrip) / 0.35;
    if (fall >= 0 && fall < 1) { ctx.fillStyle = WHITE; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(d3.x + 21 + fall * (butt.x - d3.x - 21), d3.y + 13 + fall * (butt.y - d3.y - 13), 2.2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    // You: an umbrella seen from above, rain pattering on it as loud as it all is.
    owe.hit += dt * 40 * clamp((f.level || 0) * 5, 0, 1);
    for (; owe.hit >= 1; owe.hit--) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * (UMBRELLA - 4); s.hits.push({ x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r, born: f.t }); }
    s.hits = s.hits.filter(q => f.t - q.born < 0.3).slice(-40);
    ctx.fillStyle = INK; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.arc(C.x + 6, C.y + 8, UMBRELLA, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    const tips = [];
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i + 0.5) * (TAU / 8); tips.push({ x: C.x + Math.cos(a) * UMBRELLA, y: C.y + Math.sin(a) * UMBRELLA }); }
    for (let i = 0; i < 8; i++) {
      const a = tips[i], b = tips[(i + 1) % 8], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(a.x, a.y);
      ctx.quadraticCurveTo(C.x + (mx - C.x) * 0.9, C.y + (my - C.y) * 0.9, b.x, b.y); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#2a3413' : INK; ctx.fill();
    }
    ctx.strokeStyle = GROUND; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath();
    for (const t of tips) { ctx.moveTo(C.x, C.y); ctx.lineTo(t.x, t.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = WHITE;
    for (const q of s.hits) { ctx.globalAlpha = 1 - (f.t - q.born) / 0.3; ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(C.x, C.y, 3.2, 0, TAU); ctx.fillStyle = GROUND; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
    // While a thing is dragged, the edge of hearing: beyond it a sound is silent.
    if (s.drag && s.drag.at.kind === 'source') { ctx.strokeStyle = INK; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.ellipse(C.x, C.y, L.RX, L.RZ, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    // The clouds' shadows on everything below them.
    ctx.fillStyle = INK; ctx.globalAlpha = quiet(0) ? 0.06 : 0.13; ctx.beginPath(); lobePath(ctx, at[0].x + 10, at[0].y + 13, SHOWER, 1); ctx.fill();
    ctx.globalAlpha = (quiet(2) ? 0.06 : 0.14) + 0.12 * roll; ctx.beginPath(); lobePath(ctx, at[2].x + 16, at[2].y + 22, THUNDERHEAD, 1); ctx.fill();
    ctx.globalAlpha = 1;
    // The rain in the air: seen from straight above, each drop falls in toward the point below you, longer further out.
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.1; ctx.lineCap = 'round'; ctx.globalAlpha = 0.75; ctx.beginPath();
    for (const q of s.rain) {
      const u = (f.t - q.born) / q.life, ox = q.x - C.x, oy = q.y - C.y, k = 0.25 * (1 - u);
      const hx = q.x + ox * k, hy = q.y + oy * k, len = Math.max(2, Math.hypot(ox, oy) * 0.085), n = Math.hypot(ox, oy) || 1;
      ctx.moveTo(hx, hy); ctx.lineTo(hx + (ox / n) * len, hy + (oy / n) * len);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // The drops' cloud, low over its puddle.
    ctx.globalAlpha = quiet(0) ? 0.45 : 1;
    lumps(ctx, at[0].x, at[0].y, SHOWER, '#f2f6e2', 1.4);
    ctx.globalAlpha = 1;
    // The storm cloud, trembling while the thunder rolls, white with a bolt under it when it flashes.
    const jx = roll ? Math.sin(f.t * 37) * roll : 0, T = { x: at[2].x + jx, y: at[2].y };
    ctx.globalAlpha = quiet(2) ? 0.45 : 1;
    lumps(ctx, T.x, T.y, THUNDERHEAD, flash ? '#eef4d8' : STORM, 1.5);
    if (!flash) { ctx.fillStyle = STORM_HI; ctx.beginPath(); for (const l of THUNDERHEAD) if (l.y < 6) { ctx.moveTo(T.x + l.x - 3 + l.r * 0.62, T.y + l.y - 4); ctx.arc(T.x + l.x - 3, T.y + l.y - 4, l.r * 0.62, 0, TAU); } ctx.fill(); }
    else {
      const bolt = [[2, 8], [12, 24], [5, 27], [17, 46], [8, 48], [20, 66]];
      ctx.beginPath(); bolt.forEach((q, i) => (i ? ctx.lineTo(T.x + q[0], T.y + q[1]) : ctx.moveTo(T.x + q[0], T.y + q[1])));
      ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = WHITE; ctx.lineWidth = 2.6; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Words by the hand: what a thing is and how much, or what dragging here sets; kept off the other things,
    // and for the wood, on the grass at its edge.
    if (!hot || !p) return;
    const v = id => SET[id].show(f.value(id));
    let lines, ax = p.x, above = p.y - 40, below = p.y + 30, skip = -1;
    if (hot.kind === 'source') {
      const k = hot.k, b = boxOf(L, f, k), near = Math.round(clamp(f.value(LAYERS[k].level), 0, 1) * 100);
      lines = [LAYERS[k].name, near + '% near, ' + (f.on(LAYERS[k].back) ? 'behind you' : 'in front')];
      const y0 = k === 0 ? Math.min(b.y0, at[0].y - PY * 1.1) : b.y0, y1 = k === 0 ? Math.max(b.y1, at[0].y + PY * 1.1) : b.y1;
      ax = (b.x0 + b.x1) / 2; above = y0 - 26; below = y1 + 18; skip = k;
    } else if (hot.kind === 'room') {
      const g = toGround(L, p.x, p.y), d = Math.hypot(g.x, g.z) || 1, q = toScreen(L, (g.x / d) * 0.82, (g.z / d) * 0.82);
      lines = ['The wood’s echo', v('kroom') + ' ↕'];
      ax = q.x; above = q.y - 8; below = q.y + 8;
    } else {
      lines = hot.kind === 'patch' ? ['The drops’ puddle', 'rain ' + v('knob1') + ' ↕ · ' + v('kwidth') + ' across ↔']
        : hot.kind === 'ground' ? ['Each drop', 'pitch ' + v('knob2') + ' ↔ · splash ' + v('knob3') + ' ↕']
        : ['You, under your umbrella', 'all of it plays round you'];
    }
    // What the words keep off: the other things, the puddle, you and the name.
    const keep = [0, 1, 2, 3].filter(k => k !== skip).map(k => boxOf(L, f, k));
    if (hot.kind !== 'patch' && skip !== 0) keep.push({ x0: at[0].x - PX, y0: at[0].y - PY, x1: at[0].x + PX, y1: at[0].y + PY });
    if (hot.kind !== 'you') keep.push({ x0: C.x - UMBRELLA, y0: C.y - UMBRELLA, x1: C.x + UMBRELLA, y1: C.y + UMBRELLA });
    keep.push({ x0: L.cx - 60, y0: 84, x1: L.cx + 60, y1: 98 });
    const tall = 16 * lines.length, clash = y => y < 16 || y + tall > h - 4 || keep.some(b => b.x1 > ax - 110 && b.x0 < ax + 110 && b.y1 > y - 14 && b.y0 < y + tall - 12);
    const y = [above, below, above - 34, below + 34, above - 68, below + 68].find(y => !clash(y));
    words(ctx, lines, ax, y === undefined ? above : y, w);
  },
  pointer(e, f) {
    const s = f.state, L = layout(f.w, f.h);
    if (e.type === 'down') {
      const at = where(f, L, e.x, e.y);
      if (at.kind === 'source') { const q = boxOf(L, f, at.k).p; s.drag = { at, ox: q.x - e.x, oy: q.y - e.y }; }
      else if (AXES[at.kind]) {
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
      const at = where(f, L, e.x, e.y), id = AXES[at.kind] && AXES[at.kind].y;
      if (id) f.set(id, valueOf(id, normOf(id, f.value(id)) - Math.sign(e.dy) * 0.025));
    }
    const at = d ? d.at : where(f, L, e.x, e.y);
    f.cursor(d && d.at.kind === 'source' ? 'grabbing' : at.kind === 'source' ? 'grab' : at.kind === 'room' ? 'ns-resize' : at.kind === 'you' ? 'default' : 'move');
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
          // ---- the plugin: the clearing round you, seen from straight above ----
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
                font: 'system',
                labelFont: 'system',
                valueFont: 'system',
              },
              background: [{ kind: 'color', color: '#b9d35a' }],
            },
          },
          el({
            kind: 'canvas',
            name: 'The clearing round you',
            code: FIELD,
            rect: r(0, 0, 760, 500),
            props: { dripHz: 700 },
          }),
          // The rest is set by dragging the puddle, the ground and the wood: kept in the patch.
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

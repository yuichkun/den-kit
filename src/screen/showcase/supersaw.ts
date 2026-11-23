// Septet — a supersaw whose seven saws are all on the screen at once.
// One saw is a part (Saw): it reads its copy number, so copy k of 7 plays a
// little off the note — spread evenly from flat to sharp by Detune, plus a
// small fixed drift of its own. Used ×7 in every voice, its thick cable goes
// through Splay (Width: from one centre saw to a wall from left to right), a
// lowpass per side that opens with each note, and a hall. Detune and Drift are
// the Saw's own parameters, set for every copy at once; turning them never
// recompiles.
// The design follows the thinking of the Tektronix 5 Series MSO (Red Dot 2018,
// Product Design): an instrument made for touch, where every incoming signal is
// on one large display at once and gestures on the display replace most
// physical controls. The whole plugin is that display, read like a scope's: the
// seven copies run as seven stacked channels, each across the life of a note,
// so the amp's and the filter's settings shape the teeth of every channel and
// Detune shows as teeth that fall out of step from one channel to the next.
// Every setting is a cursor or a handle on what it changes: the channels'
// tabs (Drift), the stereo ruler over them (Width), the named triangles of the
// time ruler under them (Attack, Filter decay and Release), the hall's dots
// after the note with their own SPACE tab, and the output's spectrum at the
// bottom, with a line at Cutoff that also takes Resonance and one where Env
// opens it to. Dragging across the channels spreads them (Detune). The name
// stands at the display's top right, like an instrument's model on its bezel.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { random01 } from '../../work/stacks.ts';
import { add, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** How far each of the seven copies drifts, −1…+1: the random number Which saw gives it, scaled as Drift way does. */
const OWN = Array.from({ length: 7 }, (_, k) => 2 * random01(1, [k]) - 1);

/** The display: the seven saws as channels across a note's life, the stereo ruler, the time ruler and the spectrum; each setting is dragged where it shows. */
export const SAW_LANES = `// The whole plugin is one display, read like a scope's: the seven copies of the
// Saw as seven channels stacked, each across the life of one note, and under
// them the output's spectrum.
// A lane is one copy (its tab on the left, numbered 1 to 7), from the key going
// down on the left to after it is let go at the KEY UP mark. Its teeth are as
// tall as the amp makes the note: up over Attack (katt), held, and gone over
// Release (krel) after the key is let go. They are as sharp as the lowpass
// lets them be: opened by Env (kenv) with the note, closing over Filter decay
// (kdec) to where it holds, and back to Cutoff (kcut) after the key is let go;
// after each tooth's drop the filter rings as hard as Resonance (kres). Copy k
// plays Detune × (its place from -1 to +1) semitones off the note plus Drift ×
// its own number from -1 to +1 (kdetune, kdrift; the numbers in props.drift,
// the ones the patch's Which saw gives each copy), so its teeth come round at
// a rate of their own (the difference shown 8× larger): drawn in step where the
// key goes down, the lanes part from there, a thin line joins each tooth to the
// same tooth in the next lane, and the lines fan out as far as the copies are
// detuned and zigzag as far as they drift. Each tab stands as high by its lane's
// middle as its copy plays sharp, a thin line leading from it to that middle.
// After the copies stop, the hall rings on as a field of dots, its height the
// square root of Space (kspace), the way loudness is heard, with its own tab,
// SPACE, on its top. The ruler on top is where Width (kwidth) puts each copy
// from left to right, numbered as its tab is. Each triangle of the time ruler is
// named. The band at the bottom is the output's spectrum from low to high,
// smoothed, over dotted lines at 100 Hz, 1 kHz and 10 kHz named above it, with
// a line at Cutoff and a dotted one where Env opens it to with each note, each
// named by its triangle.
// Drag the lanes across for Detune; a tab up and down for Drift; a triangle on
// the time ruler under the lanes, or its line through them, across for Attack
// or Release (the upper row) or Filter decay (the lower row); the hall's dots
// up and down for Space; the bracket on the top ruler for Width; in the band,
// Cutoff's line across, or up and down for Resonance, and Env's across. The
// name and value of what the hand is on show by it, on a white card.
// Wheel: finer steps; double click: first value.
const list = v => String(v ?? '').split(/[ ,]+/).filter(Boolean).map(Number);
const N = 7, ZOOM = 8, TEETH = 16;
export const L = { x0: 56, x1: 736, top: 60, lane: 48 };
const RULER = { x0: 70, x1: 394, y: 30 };
export const TIME = { y: 404 };
export const SPEC = { x0: 56, x1: 736, top: 446, bot: 500 };
const KEYUP = L.x0 + 320;
const FMIN = 60, FMAX = 20000;
const FIRST = { kdetune: 0.35, kdrift: 0.08, kwidth: 0.8, kcut: 900, kenv: 2.5, kres: 0.9, katt: 0.01, kdec: 0.6, krel: 0.5, kspace: 0.22 };
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lanesBottom = () => L.top + N * L.lane;
const placeOf = k => (k / (N - 1)) * 2 - 1;
export const fx = hz => SPEC.x0 + (Math.log(clamp(hz, FMIN, FMAX) / FMIN) / Math.log(FMAX / FMIN)) * (SPEC.x1 - SPEC.x0);
const xf = x => FMIN * Math.pow(FMAX / FMIN, clamp((x - SPEC.x0) / (SPEC.x1 - SPEC.x0), 0, 1));
// The time ruler is a note's life, each stretch on a log scale of its own: where the note is up after Attack
// (1 ms to 2 s), where the filter's opening has closed to its hold after Filter decay (20 ms to 3 s), both
// before the key is let go at KEYUP, and where Release has taken the note away after it (20 ms to 4 s).
const ATT = 104, DEC = 250, REL = 290;
export const attX = att => L.x0 + 6 + (Math.log(clamp(att, 0.001, 2) / 0.001) / Math.log(2000)) * ATT;
export const decX = dec => L.x0 + 10 + (Math.log(clamp(dec, 0.02, 3) / 0.02) / Math.log(150)) * DEC;
export const relX = rel => KEYUP + 12 + (Math.log(clamp(rel, 0.02, 4) / 0.02) / Math.log(200)) * REL;
// The amp at x, 0 to 1: up over Attack, down to its sustain (0.85) over its 0.3 s decay, held, then gone over Release.
function ampAt(x, xa, xr) {
  if (x <= L.x0 || x >= xr) return 0;
  if (x < xa) return (x - L.x0) / Math.max(1, xa - L.x0);
  if (x < KEYUP) { const u = Math.min(1, (x - xa) / 36); return 1 - 0.15 * (1 - (1 - u) * (1 - u)); }
  const u = (x - KEYUP) / Math.max(1, xr - KEYUP);
  return 0.85 * (1 - u) * (1 - u);
}
// The filter's envelope at x, 0 to 1: open at once, closing over Filter decay to its hold (0.4), let go over 0.4 s.
function filterAt(x, xd) {
  if (x <= L.x0) return 1;
  if (x < xd) { const u = (x - L.x0) / Math.max(1, xd - L.x0); return 0.4 + 0.6 * (1 - u) * (1 - u); }
  if (x < KEYUP) return 0.4;
  const u = (x - KEYUP) / Math.max(1, relX(0.4) - KEYUP);
  return u >= 1 ? 0 : 0.4 * (1 - u) * (1 - u);
}
function show(v, unit) {
  if (unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
  if (unit === 's') return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
  if (unit === 'oct') return v.toFixed(1) + ' oct';
  return Math.round(v * 100) + '%';
}
const signed = v => (Math.round(v * 100) > 0 ? '+' : Math.round(v * 100) < 0 ? '−' : '') + Math.abs(v).toFixed(2);
// Which setting a point takes: the top ruler, a tab, a time cursor's line, the hall's dots, the lanes, a row of
// the time ruler, or a cursor in the band (Env's is never left of Cutoff's, so where they meet, the right of
// the line is Env's). Lines that meet in the lanes are each still taken on their own row of the time ruler.
export function where(x, y, f) {
  const lb = lanesBottom();
  if (y < L.top - 8) return x > RULER.x0 - 24 && x < RULER.x1 + 24 ? { id: 'kwidth', kind: 'width' } : null;
  if (y < lb) {
    if (x < L.x0 - 4) return x >= 6 ? { id: 'kdrift', kind: 'drift' } : null;
    if (x > L.x1 + 6) return null;
    const xa = attX(f.value('katt')), xd = decX(f.value('kdec')), xr = relX(f.value('krel'));
    let best = null, bd = 6;
    for (const [id, cx] of [['katt', xa], ['kdec', xd], ['krel', xr]]) { const d = Math.abs(x - cx); if (d < bd) { bd = d; best = id; } }
    if (best) return { id: best, kind: 'time' };
    return x > xr ? { id: 'kspace', kind: 'space' } : { id: 'kdetune', kind: 'lanes' };
  }
  if (y < SPEC.top - 8) {
    if (y >= TIME.y + 13) return { id: 'kdec', kind: 'time' };
    return { id: x < KEYUP ? 'katt' : 'krel', kind: 'time' };
  }
  if (x < SPEC.x0 - 12 || x > SPEC.x1 + 12) return null;
  const a = fx(f.value('kcut')), b = fx(f.value('kcut') * Math.pow(2, f.value('kenv')));
  return x > (a + b) / 2 ? { id: 'kenv', kind: 'filter' } : { id: 'kcut', kind: 'filter' };
}
// A small triangle pointing up at (x, y): a handle on a ruler.
function tri(ctx, x, y, fill, ink, big) {
  const r = big ? 7 : 5.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r, y + r * 1.5); ctx.lineTo(x - r, y + r * 1.5); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.stroke();
}
// What the hand is on, by it: the setting's name in capitals and its value on a card, ruled round in ink, so it
// reads over the teeth as well as the ground.
function readout(ctx, lines, x, y, align, ink, card, w) {
  ctx.font = '700 12px ' + FONT; ctx.textBaseline = 'middle';
  let tw = 0;
  for (const l of lines) { const m = ctx.measureText(l); tw = Math.max(tw, (m && m.width) || l.length * 7); }
  const x0 = Math.round(clamp(align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x, 14, w - tw - 14));
  const ch = lines.length * 15 + 7, y0 = Math.round(y - ch / 2);
  ctx.fillStyle = card; ctx.fillRect(x0 - 8, y0, tw + 16, ch);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.strokeRect(x0 - 7.25, y0 + 0.75, tw + 14.5, ch - 1.5);
  ctx.fillStyle = ink; ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, x0, Math.round(y + (i - (lines.length - 1) / 2) * 15) + 0.5));
}
export default {
  setup(ctx, f) {
    f.state.drag = null;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const ink = f.color('fg'), white = f.color('accent'), grid = f.color('track'), bg = f.color('bg');
    const detune = f.value('kdetune'), drift = f.value('kdrift'), width = f.value('kwidth'), own = list(f.props.drift);
    const cutHz = f.value('kcut'), env = f.value('kenv'), rel = f.value('krel'), space = f.value('kspace');
    const res = f.value('kres'), att = f.value('katt'), dec = f.value('kdec');
    const xa = attX(att), xd = decX(dec), xr = relX(rel), lb = lanesBottom();
    const loud = Math.min(1, f.level * 6);
    const p = f.pointer;
    const hot = s.drag ? s.drag : p && p.over ? where(p.x, p.y, f) : null;
    const is = id => hot && hot.id === id;
    ctx.clearRect(0, 0, w, h);
    // The graticule: ten divisions across the lanes, dotted.
    ctx.fillStyle = grid;
    for (let i = 0; i <= 10; i++) {
      const x = Math.round(L.x0 + ((L.x1 - L.x0) * i) / 10);
      for (let y = L.top; y < lb; y += 4) ctx.fillRect(x, y, 1, 2);
    }
    // The lanes: each copy's teeth across the note, standing on its line, as tall as the amp, as round as the
    // lowpass, ringing with Resonance after each drop; all in step where the key goes down.
    const T = (L.x1 - L.x0) / TEETH;
    const A = L.lane * 0.3 * (0.8 + 0.2 * loud);
    const ring = clamp((res - 0.7) / 3.2, 0, 1);
    const roundAt = x => clamp(Math.log2(5000 / (cutHz * Math.pow(2, env * filterAt(x, xd)))) / 5, 0, 0.85);
    const lanes = [];
    for (let k = 0; k < N; k++) {
      const mid = L.top + k * L.lane + L.lane / 2, foot = mid + A;
      const st = detune * placeOf(k) + drift * (own[k] || 0);
      const ratio = 1 + ZOOM * (Math.pow(2, st / 12) - 1);
      const at = n => L.x0 + (n / ratio) * T;
      const tall = x => 2 * A * ampAt(x, xa, xr);
      const falls = [];
      ctx.save();
      ctx.beginPath(); ctx.rect(L.x0, mid - L.lane / 2, xr - L.x0, L.lane); ctx.clip();
      ctx.beginPath(); ctx.moveTo(L.x0, foot);
      for (let n = 0; at(n) < xr; n++) {
        const x0 = at(n), x1 = at(n + 1), fall = (roundAt((x0 + x1) / 2) * 0.62 * T) / ratio;
        const top = x1 - fall, rx = Math.max(1, top - x0);
        // The ramp up, ringing at its foot as hard as Resonance (the faster the more open the filter).
        const P = clamp(T * 0.16 * (1 - roundAt(x0) * 0.6), 3.5, T / 3), rA = ring * 0.55;
        if (rA > 0.02 && rx > 6)
          for (let x = x0; x < Math.min(top, x0 + P * 4); x += 1.5) {
            const t = tall(x), y = foot - t * ((x - x0) / rx) - t * rA * Math.exp(-(x - x0) / (P * 1.4)) * Math.sin((2 * Math.PI * (x - x0)) / P);
            ctx.lineTo(x, Math.min(foot, y));
          }
        else ctx.lineTo(x0, foot);
        const t1 = tall(top);
        ctx.lineTo(top, foot - t1);
        // The drop: straight down with the filter open, round-shouldered as it closes.
        ctx.quadraticCurveTo(x1 - fall * 0.3, foot - t1, x1, foot);
        falls.push([n + 1, x1, top]);
      }
      ctx.lineTo(L.x0, foot);
      ctx.closePath();
      ctx.fillStyle = ink; ctx.fill();
      ctx.restore();
      ctx.fillRect(L.x0, foot, xr - L.x0, 1);
      lanes.push({ mid, foot, st, falls, tall });
    }
    // The threads: each tooth's drop joined to the same tooth's top in the next lane, while the note sounds.
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < N - 1; k++) {
      const a = lanes[k], b = lanes[k + 1], next = new Map(b.falls.map(q => [q[0], q]));
      for (const [n, x1] of a.falls) {
        const q = next.get(n);
        if (!q || x1 >= xr || q[2] >= xr || a.tall(x1) < 1 || b.tall(q[2]) < 1) continue;
        ctx.moveTo(x1, a.foot); ctx.lineTo(q[2], b.foot - b.tall(q[2]));
      }
    }
    ctx.stroke();
    // The hall: once the copies stop, a field of dots as tall as Space (on a square-root scale, as loudness
    // is heard), dying away to the right.
    const cy = (L.top + lb) / 2, half = (lb - L.top) / 2;
    const hall = x => half * Math.sqrt(space) * Math.exp((-2.4 * (x - xr - 8)) / (L.x1 - KEYUP));
    ctx.fillStyle = is('kspace') ? white : ink;
    for (let x = Math.ceil((xr + 8) / 6) * 6, i = 0; x <= L.x1; x += 6, i++) {
      const hh = hall(x);
      for (let y = cy - hh + ((i % 2) * 3); y <= cy + hh; y += 6) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
    const hx = xr + 8, hy = cy - hall(hx);
    // The time cursors: a line through the lanes at Attack, Filter decay and Release.
    for (const [id, x] of [['katt', xa], ['kdec', xd], ['krel', xr]]) {
      ctx.fillStyle = white;
      if (is(id)) ctx.fillRect(Math.round(x) - 1, L.top, 2, TIME.y - L.top);
      else for (let y = L.top; y < TIME.y; y += 6) ctx.fillRect(Math.round(x), y, 1, 3);
    }
    // The hall's tab on the top of its dots, named: a tab like the copies', pointing back at the note.
    {
      ctx.font = '700 9px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const m = ctx.measureText('SPACE'), tw = ((m && m.width) || 30) + 12, x0 = Math.min(hx, w - tw - 14), on = is('kspace');
      ctx.beginPath();
      ctx.moveTo(x0, hy); ctx.lineTo(x0 + 6, hy - 7); ctx.lineTo(x0 + 6 + tw, hy - 7); ctx.lineTo(x0 + 6 + tw, hy + 7); ctx.lineTo(x0 + 6, hy + 7);
      ctx.closePath(); ctx.fillStyle = on ? white : ink; ctx.fill();
      ctx.fillStyle = on ? ink : bg; ctx.fillText('SPACE', x0 + 12, hy + 0.5);
    }
    // The tabs: copy k's number, as high by its lane's middle as it plays sharp, and a thin line from its point to
    // that middle (level while the copy plays in tune).
    ctx.font = '700 10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lanes.forEach((ln, k) => {
      const ty = ln.mid - clamp(ln.st * 20, -L.lane / 2 + 8, L.lane / 2 - 8);
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(34, ty); ctx.lineTo(L.x0 - 1, ln.mid); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, ty - 7); ctx.lineTo(28, ty - 7); ctx.lineTo(34, ty); ctx.lineTo(28, ty + 7); ctx.lineTo(10, ty + 7); ctx.closePath();
      ctx.fillStyle = is('kdrift') ? white : ink; ctx.fill();
      ctx.fillStyle = is('kdrift') ? ink : bg; ctx.fillText(String(k + 1), 19, ty + 0.5);
    });
    // Width: the ruler from left to right, a diamond for each copy, the bracket around them.
    const cx = (RULER.x0 + RULER.x1) / 2, rhalf = (RULER.x1 - RULER.x0) / 2, ry = RULER.y;
    ctx.fillStyle = ink;
    ctx.fillRect(RULER.x0, ry, RULER.x1 - RULER.x0, 1.5);
    ctx.fillRect(RULER.x0, ry - 5, 1.5, 11); ctx.fillRect(RULER.x1 - 1.5, ry - 5, 1.5, 11); ctx.fillRect(cx, ry - 3, 1.5, 7);
    ctx.font = '700 11px ' + FONT; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillText('L', RULER.x0 - 8, ry + 1);
    ctx.textAlign = 'left'; ctx.fillText('R', RULER.x1 + 6, ry + 1);
    const bw = Math.max(4, width * rhalf);
    ctx.fillStyle = is('kwidth') ? white : ink;
    ctx.fillRect(cx - bw - 1, ry - 13, 2.5, 27); ctx.fillRect(cx + bw - 1, ry - 13, 2.5, 27);
    ctx.fillRect(cx - bw - 1, ry - 13, 7, 2.5); ctx.fillRect(cx + bw - 5, ry - 13, 7, 2.5);
    ctx.fillRect(cx - bw - 1, ry + 11.5, 7, 2.5); ctx.fillRect(cx + bw - 5, ry + 11.5, 7, 2.5);
    for (let k = 0; k < N; k++) {
      const x = cx + placeOf(k) * width * rhalf, r = 4.5 + loud * 1.5;
      ctx.beginPath(); ctx.moveTo(x, ry - r); ctx.lineTo(x + r, ry + 0.75); ctx.lineTo(x, ry + r + 1.5); ctx.lineTo(x - r, ry + 0.75); ctx.closePath();
      ctx.fillStyle = white; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.stroke();
    }
    // Each copy's number over its diamond, as on its tab, while the diamonds are far enough apart to tell.
    if ((width * rhalf * 2) / (N - 1) >= 11) {
      ctx.font = '700 9px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = ink;
      for (let k = 0; k < N; k++) ctx.fillText(String(k + 1), cx + placeOf(k) * width * rhalf, ry - 20);
    }
    // The time ruler: the note's life, the key let go at KEY UP; Attack and Release on the upper row, Filter
    // decay on the lower one.
    ctx.fillStyle = ink;
    ctx.fillRect(L.x0, TIME.y, L.x1 - L.x0, 1.5);
    ctx.fillRect(L.x0, TIME.y - 5, 1.5, 10); ctx.fillRect(KEYUP, TIME.y - 5, 2, 14);
    ctx.font = '700 9px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('KEY UP', KEYUP - 5, TIME.y + 9);
    tri(ctx, xa, TIME.y + 2, white, ink, is('katt'));
    tri(ctx, xr, TIME.y + 2, white, ink, is('krel'));
    ctx.fillStyle = ink; ctx.fillRect(Math.round(xd), TIME.y + 2, 1, 13);
    tri(ctx, xd, TIME.y + 15, white, ink, is('kdec'));
    // Each triangle's name beside it (Attack's on its left where Filter decay's line would cross it).
    ctx.fillStyle = ink; ctx.textAlign = 'left';
    const attLeft = xd > xa && xd < xa + 52;
    ctx.textAlign = attLeft ? 'right' : 'left'; ctx.fillText('ATTACK', attLeft ? xa - 10 : xa + 10, TIME.y + 9);
    ctx.textAlign = 'left'; ctx.fillText('RELEASE', xr + 10, TIME.y + 9);
    ctx.fillText('FILTER DECAY', xd + 10, TIME.y + 22);
    // The band: the output's spectrum, filled, its outline smoothed across the bands and over time; a line at
    // Cutoff, a dotted one where Env opens it to.
    const spec = f.spectrum || new Float32Array(64), sh = SPEC.bot - SPEC.top - 6;
    if (!s.spec) s.spec = new Float32Array(64);
    // Its scale: a dotted line at each decade, as the graticule over the lanes is, named above the band.
    ctx.font = '600 8px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const [hz, name] of [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']]) {
      const x = Math.round(fx(hz));
      ctx.fillStyle = grid;
      for (let y = SPEC.top; y < SPEC.bot; y += 4) ctx.fillRect(x, y, 1, 2);
      ctx.fillStyle = ink; ctx.fillText(name, x + 3, SPEC.top - 6);
    }
    const pts = [];
    for (let k = 0; k < 64; k++) {
      const a = spec[k] || 0, v = ((k ? spec[k - 1] || 0 : a) + 2 * a + (k < 63 ? spec[k + 1] || 0 : a)) / 4;
      s.spec[k] += (v - s.spec[k]) * 0.35;
      const hz = 96 * Math.pow(250, (k + 0.5) / 64);
      if (hz <= FMAX) pts.push([fx(hz), SPEC.bot - clamp(s.spec[k] * 1.4, 0, 1) * sh]);
    }
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.moveTo(fx(96 * Math.SQRT1_2), SPEC.bot); ctx.lineTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.quadraticCurveTo(pts[k - 1][0], pts[k - 1][1], (pts[k - 1][0] + pts[k][0]) / 2, (pts[k - 1][1] + pts[k][1]) / 2);
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.lineTo(SPEC.x1, SPEC.bot); ctx.closePath(); ctx.fill();
    ctx.fillRect(SPEC.x0, SPEC.bot, SPEC.x1 - SPEC.x0, 1.5);
    const fa = fx(cutHz), fb = fx(cutHz * Math.pow(2, env));
    ctx.fillStyle = is('kcut') ? white : ink;
    ctx.fillRect(Math.round(fa) - 1, SPEC.top, 2.5, SPEC.bot - SPEC.top);
    ctx.fillStyle = is('kenv') ? white : ink;
    for (let y = SPEC.top; y < SPEC.bot; y += 4) ctx.fillRect(Math.round(fb) - 1, y, 2.5, 2);
    if (fb - fa > 12) {
      ctx.fillStyle = ink;
      ctx.fillRect(fa, SPEC.top + 5, fb - fa - 6, 1.5);
      ctx.beginPath(); ctx.moveTo(fb - 1, SPEC.top + 5.75); ctx.lineTo(fb - 7, SPEC.top + 2); ctx.lineTo(fb - 7, SPEC.top + 9.5); ctx.fill();
    }
    tri(ctx, fa, SPEC.bot + 3, white, ink, is('kcut'));
    tri(ctx, fb, SPEC.bot + 3, white, ink, is('kenv'));
    // Each cursor's name beside it, as on the time ruler (Cutoff's on its left where Env's is close, Env's on
    // its left at the band's end).
    ctx.font = '700 9px ' + FONT; ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
    const cutLeft = fb - fa < 64, envLeft = fb > w - 34;
    ctx.textAlign = cutLeft ? 'right' : 'left'; ctx.fillText('CUTOFF', cutLeft ? fa - 10 : fa + 10, SPEC.bot + 9);
    ctx.textAlign = envLeft ? 'right' : 'left'; ctx.fillText('ENV', envLeft ? fb - 10 : fb + 10, SPEC.bot + 9);
    // What the hand is on, by it.
    if (hot) {
      const id = hot.id, px = p && p.over ? p.x : 0, py = p && p.over ? p.y : 0;
      const k = clamp(Math.floor((py - L.top) / L.lane), 0, N - 1), ln = lanes[k];
      const say = {
        kdetune: [['DETUNE ±' + detune.toFixed(2) + ' semitones'], px, clamp(py - 24, L.top + 8, lb - 8), 'center'],
        kdrift: [['SAW ' + (k + 1) + ' OF 7  ' + signed(ln.st) + ' semitones', 'DRIFT ' + drift.toFixed(2) + ' semitones'], L.x0 + 8, ln.mid, 'left'],
        kwidth: [['WIDTH ' + show(width, '')], cx, 50, 'center'],
        katt: [['ATTACK ' + show(att, 's')], xa + 10, lb - 14, 'left'],
        kdec: [['FILTER DECAY ' + show(dec, 's')], xd + 10, lb - 14, 'left'],
        krel: [['RELEASE ' + show(rel, 's')], xr + 10, lb - 14, 'left'],
        kspace: [['SPACE ' + show(space, '')], hx + 12, hy, 'left'],
        kcut: [['CUTOFF ' + show(cutHz, 'Hz'), 'RESONANCE ' + res.toFixed(2)], fa - 10, SPEC.top + 18, 'right'],
        kenv: [['ENV +' + show(env, 'oct')], fb + 10, SPEC.top + 18, 'left'],
      }[id];
      if (say) readout(ctx, say[0], say[1], say[2], say[3], ink, white, w);
    }
  },
  pointer(e, f) {
    const s = f.state;
    const fine = e.shift ? 0.1 : 1;
    if (e.type === 'down') {
      const t = where(e.x, e.y, f);
      s.drag = t ? { ...t, x: e.x, y: e.y, axis: '', from: f.value(t.id), norm: f.norm(t.id), res: f.norm('kres') } : null;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && e.type === 'move') {
      const dx = e.x - d.x, dy = e.y - d.y;
      if (d.kind === 'lanes') f.set('kdetune', clamp(d.from + (dx / 400) * fine, 0, 1));
      else if (d.kind === 'drift') f.setNorm('kdrift', clamp(d.norm - (dy / 200) * fine, 0, 1));
      else if (d.kind === 'space') {
        // The handle follows the hand: its height over the middle is the square root of Space.
        const half = (lanesBottom() - L.top) / 2, hh = clamp(Math.sqrt(d.from) * half - dy * fine, 0, half);
        f.set('kspace', (hh / half) * (hh / half));
      }
      else if (d.kind === 'time') {
        // Each time moves as far along its log scale as the hand moves, from where it was pressed.
        if (d.id === 'katt') f.set('katt', clamp(d.from * Math.pow(2000, (dx / ATT) * fine), 0.001, 2));
        else if (d.id === 'kdec') f.set('kdec', clamp(d.from * Math.pow(150, (dx / DEC) * fine), 0.02, 3));
        else f.set('krel', clamp(d.from * Math.pow(200, (dx / REL) * fine), 0.02, 4));
      } else if (d.kind === 'filter' && d.id === 'kenv')
        // In octaves from where it started, so a press alone keeps Env even with the cursor held at the band's end.
        f.set('kenv', clamp(d.from + (dx * fine * Math.log2(FMAX / FMIN)) / (SPEC.x1 - SPEC.x0), 0, 6));
      else if (d.kind === 'filter') {
        // Cutoff's line: across for Cutoff, up and down for Resonance (the way the drag starts).
        if (!d.axis && Math.hypot(dx, dy) > 4) d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (d.axis === 'x') f.set('kcut', clamp(xf(fx(d.from) + dx * fine), 60, 8000));
        if (d.axis === 'y') f.setNorm('kres', clamp(d.res - (dy / 120) * fine, 0, 1));
      }
    }
    if (d && d.kind === 'width' && (e.type === 'down' || e.type === 'move'))
      f.set('kwidth', clamp(Math.abs(e.x - (RULER.x0 + RULER.x1) / 2) / ((RULER.x1 - RULER.x0) / 2), 0, 1));
    if (e.type === 'wheel' || e.type === 'double') {
      const t = where(e.x, e.y, f);
      if (t && e.type === 'wheel') f.setNorm(t.id, clamp(f.norm(t.id) - (e.dy / 100) * 0.01 * fine, 0, 1));
      if (t && e.type === 'double') f.set(t.id, FIRST[t.id]);
    }
    const at = s.drag ?? where(e.x, e.y, f);
    const kind = at && at.kind;
    f.cursor(!at ? 'default' : s.drag ? 'grabbing' : kind === 'drift' || kind === 'space' ? 'ns-resize' : kind === 'filter' ? 'grab' : 'ew-resize');
  },
};
`;

/** How the knobs read on this plugin (the Saw's face and the others alike). */
const KNOB = {
  textStyle: { size: 10, weight: 700, color: 'muted', case: 'upper' as const, spacing: 0.14 },
};
const CARD = {
  radius: 10,
  fill: [{ kind: 'color' as const, color: '#ffffff' }],
  stroke: { color: '#d9dde2', width: 1, style: 'solid' as const },
};

/** The Saw's own screen, for a plugin that puts it on: Detune and Drift under its name. */
export const SAW_FACE: PartFace = {
  width: 208,
  height: 140,
  controls: [
    {
      param: 'detune',
      type: 'ui.knob',
      rect: { x: 8, y: 26, w: 96, h: 108 },
      label: 'Detune',
      style: KNOB,
    },
    {
      param: 'drift',
      type: 'ui.knob',
      rect: { x: 104, y: 26, w: 96, h: 108 },
      label: 'Drift',
      style: KNOB,
    },
  ],
  elements: [
    {
      id: 'frame',
      kind: 'shape',
      shape: 'rect',
      rect: { x: 0, y: 0, w: 208, h: 140 },
      style: CARD,
    },
    {
      id: 'title',
      kind: 'text',
      text: 'Saw ×7',
      rect: { x: 14, y: 9, w: 90, h: 18 },
      textStyle: { size: 13, weight: 700, color: 'fg', align: 'left' },
    },
    {
      id: 'what',
      kind: 'text',
      text: 'every copy at once',
      rect: { x: 94, y: 11, w: 104, h: 14 },
      textStyle: { size: 10, color: 'muted', align: 'right' },
    },
  ],
};

export function supersaw(catalog: Catalog) {
  const inside = ['copy1', 'spread1', 'driftdir1', 'drift1', 'offset1', 'note1', 'mtof1', 'osc1'];
  return workInSteps(
    'supersaw',
    'Septet',
    catalog,
    [760, 520],
    [
      [
        // ---- one saw of seven: the note, moved by where this copy sits and a little drift of its own ----
        add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
        add('copy1', 'kit.copy', { label: 'Which saw' }),
        add('spread1', 'kit.mul', { label: 'Spread', values: { b: 0.35 } }),
        add('driftdir1', 'kit.scale', { label: 'Drift way', values: { scale: 2, offset: -1 } }),
        add('drift1', 'kit.mul', { label: 'Drift', values: { b: 0.08 } }),
        add('offset1', 'kit.add', { label: 'Off by' }),
        add('note1', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'Saw', config: { waveform: 'saw' } }),
        wire('copy1.position', 'spread1.a'),
        wire('copy1.random', 'driftdir1.in'),
        wire('driftdir1.out', 'drift1.a'),
        wire('spread1.out', 'offset1.a'),
        wire('drift1.out', 'offset1.b'),
        wire('voice1.note', 'note1.a'),
        wire('offset1.out', 'note1.b'),
        wire('note1.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        // ---- the voice: Splay, a lowpass per side that opens with each note, the amp ----
        add('splay1', 'kit.splay', { label: 'Width', values: { width: 0.8 } }),
        add('fenv1', 'den.envelope', {
          label: 'Filter Env',
          values: { attack: 0.005, decay: 0.6, sustain: 0.4, release: 0.4 },
        }),
        add('envamt1', 'kit.mul', { label: 'Env Amount', values: { b: 2.5 } }),
        add('cut1', 'kit.cutoffMod', { values: { hz: 900 } }),
        add('lpl1', 'den.filter', { label: 'Lowpass L', values: { resonance: 0.9 } }),
        add('lpr1', 'den.filter', { label: 'Lowpass R', values: { resonance: 0.9 } }),
        add('aenv1', 'den.envelope', {
          label: 'Amp Env',
          values: { attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.5 },
        }),
        add('vel1', 'kit.mul', { label: 'Velocity' }),
        add('vcal1', 'kit.mul', { label: 'VCA L' }),
        add('vcar1', 'kit.mul', { label: 'VCA R' }),
        add('mixl1', 'kit.voiceMix', { label: 'Voices L' }),
        add('mixr1', 'kit.voiceMix', { label: 'Voices R' }),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1.2, decaySeconds: 2.8, dampingHz: 7000 },
          values: { mix: 0.22 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.25 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.25 } }),
        add('out1', 'kit.out'),
        wire('osc1.out', 'splay1.in'),
        wire('splay1.left', 'lpl1.input'),
        wire('splay1.right', 'lpr1.input'),
        wire('fenv1.level', 'envamt1.a'),
        wire('envamt1.out', 'cut1.octaves'),
        wire('cut1.out', 'lpl1.cutoff'),
        wire('cut1.out', 'lpr1.cutoff'),
        wire('aenv1.level', 'vel1.a'),
        wire('voice1.velocity', 'vel1.b'),
        wire('lpl1.out', 'vcal1.a'),
        wire('vel1.out', 'vcal1.b'),
        wire('lpr1.out', 'vcar1.a'),
        wire('vel1.out', 'vcar1.b'),
        wire('vcal1.out', 'mixl1.in'),
        wire('vcar1.out', 'mixr1.in'),
        wire('aenv1.done', 'mixl1.done'),
        wire('aenv1.done', 'mixr1.done'),
        wire('mixl1.out', 'hall1.left'),
        wire('mixr1.out', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        // The saw becomes a part (the note comes in, the saw goes out).
        { op: 'makePart', ids: inside, name: 'Saw', id: 'saw', node: 'saw1' },
      ],
      // Its knobs, in semitones: how far apart the seven are, and how far each drifts on its own.
      doc =>
        onlyParams(doc, 'saw', [
          {
            node: 'spread1',
            port: 'b',
            id: 'detune',
            label: 'Detune',
            range: { min: 0, max: 1, unit: 'st' },
          },
          {
            node: 'drift1',
            port: 'b',
            id: 'drift',
            label: 'Drift',
            range: { min: 0, max: 0.5, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'saw',
          doc: 'One saw of a supersaw: copy k of N plays the note off by its place (from −Detune to +Detune) and a small drift of its own. Use it ×7 into Splay.',
          labels: { a: 'Note' },
          face: SAW_FACE,
        },
        { op: 'setCount', node: 'saw1', count: 7 },
        // ---- the plugin: one display, operated on the display ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#e5432a',
              fg: '#0a0a0a',
              accent: '#ffffff',
              track: '#b8301b',
              knob: '#0a0a0a',
              pointer: '#ffffff',
              muted: '#ffffff',
              glow: '#ffffff',
              font: 'michroma',
              labelFont: 'michroma',
              valueFont: 'jetbrains-mono',
            },
            background: [{ kind: 'color', color: '#e5432a' }],
            skins: { meter: { name: 'bar', params: { scale: false } } },
          },
        },
      ],
      // The Saw's parameters, for every copy at once, and the voice's: in the patch, moved on the display.
      () => [
        ...patchControl('kdetune', 'Detune', 'saw1.detune', [0, 1, 'linear', 'st'], 0.35),
        ...patchControl('kdrift', 'Drift', 'saw1.drift', [0, 0.5, 'linear', 'st'], 0.08),
        ...patchControl('kwidth', 'Width', 'splay1.width', [0, 1, 'linear', ''], 0.8),
        ...patchControl('kcut', 'Cutoff', 'cut1.hz', [60, 8000, 'log', 'Hz'], 900),
        ...patchControl('kenv', 'Env', 'envamt1.b', [0, 6, 'linear', 'oct'], 2.5),
        ...patchControl(
          'kres',
          'Resonance',
          ['lpl1.resonance', 'lpr1.resonance'],
          [0.5, 6, 'linear', ''],
          0.9,
        ),
        ...patchControl('katt', 'Attack', 'aenv1.attack', [0.001, 2, 'log', 's'], 0.01),
        ...patchControl('kdec', 'Filter decay', 'fenv1.decay', [0.02, 3, 'log', 's'], 0.6),
        ...patchControl('krel', 'Release', 'aenv1.release', [0.02, 4, 'log', 's'], 0.5),
        ...patchControl('kspace', 'Space', 'hall1.mix', [0, 1, 'linear', ''], 0.22),
        el({
          kind: 'canvas',
          name: 'Seven saws',
          code: SAW_LANES,
          rect: r(0, 0, 760, 520),
          // Each copy's own number, −1…+1, as Which saw (seed 1) gives it to copy k of the seven.
          props: { drift: OWN.map(v => v.toFixed(3)).join(' ') },
        }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'SEPTET',
          rect: r(536, 20, 200, 20),
          textStyle: {
            font: 'michroma',
            size: 13,
            weight: 400,
            color: 'fg',
            align: 'right',
            spacing: 0.2,
          },
        }),
      ],
    ],
  );
}

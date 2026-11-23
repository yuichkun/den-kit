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
// seven copies run as seven stacked lanes, each at its own pitch, so Detune
// shows as lanes that drift against each other, and every other setting is a
// cursor or a handle on a trace of its own: the stereo ruler over the lanes
// (Width), the amp lane under them (Release, and the hall's tail for Space) and
// the filter band at the bottom (the output's spectrum, with a cursor at Cutoff
// and one where Env opens it to). Dragging across the lanes spreads them
// (Detune); dragging their offsets up and down scatters them (Drift).
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The display: the seven saws as lanes, the stereo ruler, the amp lane and the filter band; each setting is dragged where it shows. */
export const SAW_LANES = `// The whole plugin is one display, read like a scope's: every copy of the Saw
// on its own lane at once, cursors and handles on the traces themselves.
// Lanes: copy k plays Detune × (its place from -1 to +1) semitones off the note
// plus a small drift of its own (kdetune, kdrift), so each lane is drawn at its
// own pitch (the difference shown 8× larger) and slides against the middle lane
// as fast as it beats, slowed down for the eye; a lower Cutoff (kcut, opened by
// Env, kenv) rounds the teeth. Drag across the lanes: Detune. The offsets on the
// right, drag them up and down: Drift. The ruler on top is where Width (kwidth)
// puts each copy from left to right: drag its bracket. The amp lane is a note's
// life: up, held, let go over Release (krel), with the hall's tail (kspace)
// dotted under it; drag the release mark across, the tail up and down. The
// filter band is the output's spectrum with two cursors: a at Cutoff, b where
// Env opens it to; drag either. Wheel: finer steps; double click: first value.
const DRIFT = [0.42, -0.77, 0.15, -0.31, 0.88, -0.56, 0.69];
const N = 7, ZOOM = 8, TEETH = 18;
const L = { x0: 72, x1: 640, top: 64, lane: 44 };
const RULER = { x0: 412, x1: 736, y: 40 };
const AMP = { top: 384, h: 56, off: 150, rel: 250 };
const SPEC = { x0: 72, x1: 540, top: 452, bot: 508 };
const FMIN = 60, FMAX = 20000;
const FIRST = { kdetune: 0.35, kdrift: 0.08, kwidth: 0.8, kcut: 900, kenv: 2.5, krel: 0.5, kspace: 0.22 };
const SANS = 'system-ui, sans-serif', MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lanesBottom = () => L.top + N * L.lane;
const placeOf = k => (k / (N - 1)) * 2 - 1;
const fx = hz => SPEC.x0 + (Math.log(clamp(hz, FMIN, FMAX) / FMIN) / Math.log(FMAX / FMIN)) * (SPEC.x1 - SPEC.x0);
const xf = x => FMIN * Math.pow(FMAX / FMIN, clamp((x - SPEC.x0) / (SPEC.x1 - SPEC.x0), 0, 1));
// Where Release lets go of the note, and where the sound has gone (log time: 20 ms to 4 s).
const relX = rel => L.x0 + AMP.off + 10 + (Math.log(rel / 0.02) / Math.log(200)) * AMP.rel;
function show(v, unit) {
  if (unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
  if (unit === 's') return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
  if (unit === 'st') return v.toFixed(2) + ' st';
  if (unit === 'oct') return v.toFixed(1) + ' oct';
  return Math.round(v * 100) + '%';
}
function where(x, y) {
  if (y < 60) return x > RULER.x0 - 24 ? { id: 'kwidth', kind: 'width' } : null;
  if (y >= L.top && y < lanesBottom()) {
    if (x >= L.x0 - 12 && x < L.x1 + 8) return { id: 'kdetune', kind: 'lanes' };
    if (x >= L.x1 + 8) return { id: 'kdrift', kind: 'drift' };
  }
  if (y >= AMP.top - 6 && y < AMP.top + AMP.h + 4 && x >= L.x0 - 12 && x < L.x1 + 8) return { id: 'krel', kind: 'amp' };
  if (y >= SPEC.top - 6 && x >= SPEC.x0 - 12 && x < SPEC.x1 + 12) return { id: 'kcut', kind: 'filter' };
  return null;
}
// In the amp lane, the release mark (across) or the hall's tail (up and down); in the filter band, the nearer cursor.
function pick(t, x, f) {
  if (!t) return null;
  if (t.kind === 'amp') return x < relX(f.value('krel')) + 24 ? { ...t, id: 'krel' } : { ...t, id: 'kspace' };
  if (t.kind === 'filter') {
    const a = fx(f.value('kcut')), b = fx(f.value('kcut') * Math.pow(2, f.value('kenv')));
    return Math.abs(x - b) < Math.abs(x - a) && b - a > 3 ? { ...t, id: 'kenv' } : { ...t, id: 'kcut' };
  }
  return t;
}
function label(ctx, text, x, y, align, ink, weight) {
  ctx.font = (weight || 600) + ' 11px ' + MONO;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}
export default {
  setup(ctx, f) {
    f.state.drag = null;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const ink = f.color('fg'), white = f.color('accent'), grid = f.color('track');
    const detune = f.value('kdetune'), drift = f.value('kdrift'), width = f.value('kwidth');
    const cutHz = f.value('kcut'), env = f.value('kenv'), rel = f.value('krel'), space = f.value('kspace');
    const open = cutHz * Math.pow(2, env * 0.4);
    const round = clamp(Math.log2(5000 / open) / 5, 0, 0.85);
    const loud = Math.min(1, f.level * 6);
    const p = f.pointer;
    const hot = s.drag ? s.drag : p && p.over ? pick(where(p.x, p.y), p.x, f) : null;
    const is = id => hot && hot.id === id;
    ctx.clearRect(0, 0, w, h);
    // The graticule: ten divisions across the lanes, dotted.
    ctx.fillStyle = grid;
    for (let i = 0; i <= 10; i++) {
      const x = Math.round(L.x0 + ((L.x1 - L.x0) * i) / 10);
      for (let y = L.top; y < AMP.top + AMP.h; y += 4) ctx.fillRect(x, y, 1, 2);
    }
    // The lanes: one copy each, its number in a tab on the left edge, its offset on the right.
    const T = (L.x1 - L.x0) / TEETH;
    const knot = TEETH / 2 + (TEETH / 2 - 2) * Math.sin(f.t * 0.45);
    for (let k = 0; k < N; k++) {
      const y0 = L.top + k * L.lane, mid = y0 + L.lane / 2;
      const st = detune * placeOf(k) + drift * DRIFT[k];
      const ratio = 1 + ZOOM * (Math.pow(2, st / 12) - 1);
      const amp = L.lane * 0.3 * (0.5 + 0.5 * loud);
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.roundRect(24, mid - 11, 30, 22, 5); ctx.fill();
      ctx.fillStyle = white;
      ctx.font = '700 13px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(k + 1), 39, mid + 0.5);
      ctx.fillStyle = grid;
      for (let x = L.x0; x < L.x1; x += 3) ctx.fillRect(x, Math.round(mid), 1, 1);
      // Teeth where this copy's phase is whole: all lanes meet at the knot and part away from it.
      ctx.save();
      ctx.beginPath(); ctx.rect(L.x0, y0, L.x1 - L.x0, L.lane); ctx.clip();
      ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      const at = n => L.x0 + ((n + (ratio - 1) * knot) / ratio) * T;
      const first = Math.floor(-(ratio - 1) * knot) - 1;
      const fall = (round * 0.6 * T) / ratio;
      for (let n = first; at(n) < L.x1 + T; n++) {
        const xa = at(n), xb = at(n + 1);
        if (n === first) ctx.moveTo(xa, mid + amp);
        ctx.lineTo(xb - fall, mid - amp);
        ctx.lineTo(xb, mid + amp);
      }
      ctx.stroke();
      ctx.restore();
      label(ctx, (st >= 0 ? '+' : '−') + Math.abs(st).toFixed(2), 736, mid + 0.5, 'right', is('kdrift') ? white : ink, 700);
    }
    // Drift: the offsets' own handle, under them.
    label(ctx, 'drift ' + drift.toFixed(2) + ' ↕', 736, lanesBottom() + 4, 'right', is('kdrift') ? white : ink);
    if (is('kdrift')) { ctx.fillStyle = white; ctx.fillRect(L.x1 + 30, L.top + 4, 1.5, lanesBottom() - L.top - 8); }
    // The part: one Saw used seven times; its two settings move every copy at once.
    ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '800 14px ' + SANS; ctx.fillText('SAW ×7', 24, 26);
    ctx.font = '600 11px ' + SANS; ctx.fillText('one part, seven copies', 24, 44);
    ctx.fillRect(38, 52, 2, L.top + L.lane / 2 - 63);
    // Detune: the lanes' own handle, over them; a crosshair where the hand is.
    label(ctx, '↔ detune ±' + detune.toFixed(2) + ' st', L.x0 + 128, 44, 'left', is('kdetune') ? white : ink, 700);
    if (is('kdetune') && p && p.over) {
      ctx.fillStyle = white;
      ctx.fillRect(Math.round(clamp(p.x, L.x0, L.x1)), L.top, 1.5, lanesBottom() - L.top);
    }
    // Width: the ruler from left to right, a diamond for each copy, the bracket around them.
    const cx = (RULER.x0 + RULER.x1) / 2, half = (RULER.x1 - RULER.x0) / 2, ry = RULER.y;
    ctx.fillStyle = ink;
    ctx.fillRect(RULER.x0, ry, RULER.x1 - RULER.x0, 1.5);
    ctx.fillRect(RULER.x0, ry - 5, 1.5, 11); ctx.fillRect(RULER.x1 - 1.5, ry - 5, 1.5, 11); ctx.fillRect(cx, ry - 3, 1.5, 7);
    label(ctx, 'L', RULER.x0 - 8, ry + 1, 'right', ink, 700);
    label(ctx, 'R', RULER.x1 + 6, ry + 1, 'left', ink, 700);
    const bw = Math.max(4, width * half);
    ctx.fillStyle = is('kwidth') ? white : ink;
    ctx.fillRect(cx - bw - 1, ry - 13, 2.5, 27); ctx.fillRect(cx + bw - 1, ry - 13, 2.5, 27);
    ctx.fillRect(cx - bw - 1, ry - 13, 7, 2.5); ctx.fillRect(cx + bw - 5, ry - 13, 7, 2.5);
    ctx.fillRect(cx - bw - 1, ry + 11.5, 7, 2.5); ctx.fillRect(cx + bw - 5, ry + 11.5, 7, 2.5);
    for (let k = 0; k < N; k++) {
      const x = cx + placeOf(k) * width * half, r = 4.5 + loud * 1.5;
      ctx.beginPath(); ctx.moveTo(x, ry - r); ctx.lineTo(x + r, ry + 0.75); ctx.lineTo(x, ry + r + 1.5); ctx.lineTo(x - r, ry + 0.75); ctx.closePath();
      ctx.fillStyle = white; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.stroke();
    }
    label(ctx, 'width ' + show(width, '') + ' ↔', cx, 14, 'center', is('kwidth') ? white : ink, 700);
    // The amp lane: a note goes up, holds, is let go over Release; the hall's tail, dotted, rings on.
    const a0 = AMP.top, ab = AMP.top + AMP.h - 6, ah = AMP.h - 14;
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.roundRect(24, a0 + AMP.h / 2 - 11, 30, 22, 5); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(29, a0 + AMP.h / 2 + 6); ctx.lineTo(32, a0 + AMP.h / 2 - 6); ctx.lineTo(37, a0 + AMP.h / 2 - 2); ctx.lineTo(43, a0 + AMP.h / 2 - 2); ctx.lineTo(49, a0 + AMP.h / 2 + 6); ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillRect(L.x0, ab, L.x1 - L.x0, 1.5);
    const xOff = L.x0 + AMP.off, xRel = relX(rel), sus = ab - ah * 0.85;
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(L.x0, ab); ctx.lineTo(L.x0 + 6, ab - ah); ctx.quadraticCurveTo(L.x0 + 14, sus, L.x0 + 44, sus);
    ctx.lineTo(xOff, sus);
    for (let i = 1; i <= 24; i++) { const u = i / 24; ctx.lineTo(xOff + (xRel - xOff) * u, ab - (ab - sus) * (1 - u) * (1 - u)); }
    ctx.stroke();
    // The hall's tail: as loud as Space, ringing on for its 2.8 s after the note is let go.
    const tail = ab - ah * 0.9 * space;
    ctx.fillStyle = is('kspace') ? white : ink;
    for (let x = L.x0 + 10; x < L.x1; x += 5) {
      const u = x < xOff ? 1 : Math.exp(-((x - xOff) / (L.x1 - xOff)) * 3.2);
      const y = ab - (ab - tail) * u * Math.min(1, (x - L.x0) / 30);
      ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 2);
    }
    // The release mark and the tail's handle.
    ctx.fillStyle = is('krel') ? white : ink;
    ctx.fillRect(Math.round(xRel) - 1, a0 + 2, 2.5, ab - a0 - 2);
    ctx.fillRect(Math.round(xOff), sus - 4, 1.5, ab - sus + 4);
    label(ctx, 'release ' + show(rel, 's') + ' ↔', xRel + 8, a0 + 9, 'left', is('krel') ? white : ink, 700);
    const hx = L.x0 + 96;
    ctx.beginPath(); ctx.arc(hx, tail - 1, is('kspace') ? 5.5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = white; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.stroke();
    label(ctx, 'space ' + show(space, '') + ' ↕', hx + 10, space > 0.45 ? tail + 11 : tail - 11, 'left', is('kspace') ? white : ink, 700);
    // The filter band: the output's spectrum; a at Cutoff, b where Env opens it to.
    const spec = f.spectrum || new Float32Array(64);
    const sh = SPEC.bot - SPEC.top - 16;
    ctx.fillStyle = ink;
    for (let k = 0; k < 64; k++) {
      const lo = 96 * Math.pow(250, k / 64), hi = 96 * Math.pow(250, (k + 1) / 64);
      if (hi < FMIN || lo > FMAX) continue;
      const x = fx(lo), bw2 = Math.max(1, Math.min(3, fx(hi) - x - 1)), v = clamp((spec[k] || 0) * 1.4, 0, 1);
      ctx.fillRect(Math.round(x), Math.round(SPEC.bot - v * sh), Math.round(bw2), Math.round(v * sh));
    }
    ctx.fillRect(SPEC.x0, SPEC.bot, SPEC.x1 - SPEC.x0, 1.5);
    const xa = fx(cutHz), xb = fx(cutHz * Math.pow(2, env));
    ctx.fillStyle = is('kcut') ? white : ink;
    ctx.fillRect(Math.round(xa) - 1, SPEC.top, 2.5, SPEC.bot - SPEC.top);
    ctx.fillStyle = is('kenv') ? white : ink;
    for (let y = SPEC.top; y < SPEC.bot; y += 4) ctx.fillRect(Math.round(xb) - 1, y, 2.5, 2);
    ctx.fillStyle = ink;
    if (xb - xa > 12) {
      ctx.fillRect(xa, SPEC.top + 22, xb - xa, 1.5);
      ctx.beginPath(); ctx.moveTo(xb, SPEC.top + 22.75); ctx.lineTo(xb - 6, SPEC.top + 19); ctx.lineTo(xb - 6, SPEC.top + 26.5); ctx.fill();
    }
    label(ctx, 'a  cutoff ' + show(cutHz, 'Hz'), xa + 7, SPEC.top + 8, 'left', is('kcut') ? white : ink, 700);
    const envText = 'b  env +' + show(env, 'oct');
    const right = xb + 7 + envText.length * 6.7 > SPEC.x1 + 40;
    label(ctx, envText, right ? xb - 7 : Math.max(xb + 7, xa + 150), SPEC.top + 34, right ? 'right' : 'left', is('kenv') ? white : ink, 700);
  },
  pointer(e, f) {
    const s = f.state;
    const fine = e.shift ? 0.1 : 1;
    if (e.type === 'down') {
      const t = pick(where(e.x, e.y), e.x, f);
      s.drag = t ? { ...t, x: e.x, y: e.y, axis: '', from: f.value(t.id), norm: f.norm(t.id), rel: f.value('krel'), space: f.value('kspace') } : null;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && (e.type === 'down' || e.type === 'move')) {
      const dx = e.x - d.x, dy = e.y - d.y;
      if (d.kind === 'lanes') f.set('kdetune', clamp(d.from + (dx / 400) * fine, 0, 1));
      else if (d.kind === 'drift') f.setNorm('kdrift', clamp(d.norm - (dy / 200) * fine, 0, 1));
      else if (d.kind === 'width') f.set('kwidth', clamp(Math.abs(e.x - (RULER.x0 + RULER.x1) / 2) / ((RULER.x1 - RULER.x0) / 2), 0, 1));
      else if (d.kind === 'filter') {
        if (d.id === 'kcut') f.set('kcut', clamp(xf(fx(d.from) + dx * fine), 60, 8000));
        else f.set('kenv', clamp(Math.log2(xf(fx(f.value('kcut') * Math.pow(2, d.from)) + dx * fine) / f.value('kcut')), 0, 6));
      } else if (d.kind === 'amp' && e.type === 'move') {
        if (!d.axis && Math.hypot(dx, dy) > 4) d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (d.axis === 'x') f.set('krel', clamp(d.rel * Math.pow(200, (dx / AMP.rel) * fine), 0.02, 4));
        if (d.axis === 'y') f.set('kspace', clamp(d.space - (dy / (AMP.h - 14) / 0.9) * fine, 0, 1));
      }
    }
    if (e.type === 'wheel' || e.type === 'double') {
      const t = pick(where(e.x, e.y), e.x, f);
      if (t && e.type === 'wheel') f.setNorm(t.id, clamp(f.norm(t.id) - (e.dy / 100) * 0.01 * fine, 0, 1));
      if (t && e.type === 'double') f.set(t.id, FIRST[t.id]);
    }
    const at = s.drag ?? where(e.x, e.y);
    const kind = at && at.kind;
    f.cursor(!at ? 'default' : s.drag ? 'grabbing' : kind === 'drift' ? 'ns-resize' : kind === 'amp' ? 'grab' : 'ew-resize');
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
        ...patchControl('krel', 'Release', 'aenv1.release', [0.02, 4, 'log', 's'], 0.5),
        ...patchControl('kspace', 'Space', 'hall1.mix', [0, 1, 'linear', ''], 0.22),
        el({
          kind: 'canvas',
          name: 'Seven saws',
          code: SAW_LANES,
          rect: r(0, 0, 760, 520),
        }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'SEPTET',
          rect: r(556, 472, 180, 34),
          textStyle: { font: 'michroma', size: 24, weight: 400, color: 'fg', align: 'right' },
        }),
        ...control('vu1', 'ui.meter', 'Out', null, r(576, 458, 160, 6), {
          style: { tokens: { track: '#b8301b', accent: '#0a0a0a' } },
        }),
        wire('gl1.out', 'vu1.in'),
      ],
    ],
  );
}

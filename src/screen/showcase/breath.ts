// Exhale — a sound installation for a quiet room: a soft chord and the sound of
// air swell in and out at the pace of slow breathing, so people can breathe
// along with it.
// Nothing is played. A slow sine is the breath (Breaths a minute); on the way
// in the chord opens and grows and the air rises through a band, on the way out
// they settle; Depth sets how far (at 0 the chord holds still and the air is gone). One tone of the chord is a part (Tone): a
// saw, a little off pitch by its copy's own random number, through a lowpass
// that opens with the breath. The part runs ×5 and an `each` spread gives each
// copy its interval above the key (a wide, open chord); Splay spreads them and
// a long hall holds everything.
// The design follows the thinking of Loóna (Apple Design Awards 2021, Visuals
// and Graphics), calm sessions in which type, colour, motion and 3D are made
// together for one soothing scene: here the whole plugin is one picture, a
// gallery at night where a great soft form of air sits on the polished floor
// and rises, rounds and goes taut as the breath comes in, then settles and
// creases as it goes out, in step with what is heard. A card on the wall names
// the work and shows the settings under the hand, and a slit of light in the
// wall is the meter. The settings are on the picture: the form for Depth and
// Breaths a minute, the room for Hall and Warmth. Key is kept in the patch.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The slit of light in the gallery's back wall: its left, top, width and height (its light is the meter). */
const SLIT = { x: 92, y: 24, w: 6, h: 214 };

/** The gallery: a great soft form of air that breathes; it takes the mouse. */
export const SCENE = `// A gallery at night seen from the front: a great soft form of air sits on
// the polished floor and breathes. How full the breath is comes from the output
// level, eased and placed between the quietest and loudest of the last few
// breaths, so the form moves with what is heard: as the breath comes in it
// rises, rounds and goes taut, as far as Depth (kdepth) lets it; as it goes
// out it settles, spreads and creases; the blower that fills it turns faster
// as it fills. The room is the hall: the more Hall (kspace), the further off
// its back wall. Warmth (kwarm) turns the light on the form from cool lilac to
// warm rose. The card on the wall names the work and says what the hand is on.
// Drag the form up and down for Depth, left and right for Breaths a minute
// (kbpm); drag the room up and down for Hall, left and right for Warmth. A drag
// keeps to the direction it starts in; scrolling moves the up-and-down setting.
// The slit of light in the wall (props.slit: its left, top, width and height)
// holds the plugin's meter.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SET = { kdepth: { lo: 0, hi: 1 }, kbpm: { lo: 3, hi: 10 }, kspace: { lo: 0, hi: 1 }, kwarm: { lo: 200, hi: 1600 } };
const AXES = { form: { x: 'kbpm', y: 'kdepth' }, room: { x: 'kwarm', y: 'kspace' } };
// The light on the form, shadow to highlight: cool, and warm.
const COOL = [[70, 60, 126], [124, 112, 182], [180, 170, 228], [234, 230, 251]];
const WARM = [[116, 64, 104], [176, 110, 146], [226, 166, 180], [252, 230, 224]];
const WALL = '#1b1534', WALL_LO = '#271f4b', FLOOR = '#221a45', FLOOR_LO = '#372b69', INK = '#0f0a21', CARD = '#ece6f8', TEXT = '#1f1842';
/** The floor line (further up the bigger the hall), where the form stands, and the eye. */
function layout(w, h, hall) { const FL = Math.round(h * 0.58 - 36 * hall); return { cx: w / 2, FL, BY: FL + 104, EYE: Math.round(h * 0.3) }; }
/** How wide and tall the form is, for how full the breath is (b) and how deep (d). */
function sizeOf(b, d) { const k = (b - 0.5) * 2 * d; return { k, W: 424 - 44 * k, H: 228 + 88 * k }; }
/** The form's outline: a soft dome over its base, the front edge bulging toward you. */
function outline(ctx, cx, by, W, H, sc, ox, oy) {
  ctx.beginPath();
  for (let i = 0; i <= 56; i++) {
    const t = Math.PI - (i / 56) * Math.PI, c = Math.cos(t), s = Math.sin(t);
    const x = cx + ox + (W / 2) * sc * Math.sign(c) * Math.pow(Math.abs(c), 0.75), y = by + oy - H * sc * Math.pow(s, 0.8);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.quadraticCurveTo(cx + ox, by + oy + 24 * sc, cx + ox - (W / 2) * sc, by + oy);
  ctx.closePath();
}
/** Whether a point is on the form. */
function onForm(x, y, cx, by, W, H) {
  const u = (x - cx) / (W / 2);
  if (Math.abs(u) > 1) return false;
  const c = Math.pow(Math.abs(u), 1 / 0.75), top = by - H * Math.pow(Math.sqrt(Math.max(0, 1 - c * c)), 0.8);
  return y >= top && y <= by + 24 * (1 - u * u) * 0.5;
}
const mix = (a, b, t) => 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
/** A visitor in a long coat, seen from behind as they look at the form: feet at (x, y), this tall. */
function visitor(ctx, x, y, tall, coat) {
  const T = tall, r = T * 0.062, top = y - T;
  ctx.beginPath(); ctx.ellipse(x, top + r, r * 0.92, r, 0, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - T * 0.035, top + r * 1.9);
  ctx.quadraticCurveTo(x - T * 0.13, top + r * 2.1, x - T * 0.125, top + T * 0.3);
  ctx.lineTo(x - T * 0.12 * coat, top + T * 0.74);
  ctx.lineTo(x + T * 0.12 * coat, top + T * 0.74);
  ctx.lineTo(x + T * 0.125, top + T * 0.3);
  ctx.quadraticCurveTo(x + T * 0.13, top + r * 2.1, x + T * 0.035, top + r * 1.9);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - T * 0.07, top + T * 0.72); ctx.lineTo(x - T * 0.055, y); ctx.lineTo(x - T * 0.012, y); ctx.lineTo(x - T * 0.008, top + T * 0.74);
  ctx.moveTo(x + T * 0.07, top + T * 0.72); ctx.lineTo(x + T * 0.055, y); ctx.lineTo(x + T * 0.012, y); ctx.lineTo(x + T * 0.008, top + T * 0.74);
  ctx.fill();
}
function move(id, v0, dx, dy) {
  const d = SET[id];
  let v;
  if (id === 'kdepth') v = v0 - dy / 240;
  else if (id === 'kspace') v = v0 - dy / 160;
  else if (id === 'kbpm') v = v0 + dx / 60;
  else v = v0 * Math.pow(d.hi / d.lo, dx / 240);
  return clamp(v, d.lo, d.hi);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { lvl: 0, lo: 1, hi: 0, b: 0.5, drag: '', over: '', axis: '' });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    if (s.b === undefined) Object.assign(s, { lvl: 0, lo: 1, hi: 0, b: 0.5, drag: '', over: '', axis: '' });
    // How full the breath is.
    const dt = Math.min(0.1, f.dt || 0.016);
    s.lvl += ((f.level || 0) - s.lvl) * Math.min(1, dt * 3);
    s.hi = s.lvl > s.hi ? s.lvl : s.hi - (s.hi - s.lvl) * dt * 0.05;
    s.lo = s.lvl < s.lo ? s.lvl : s.lo + (s.lvl - s.lo) * dt * 0.05;
    const full = s.hi - s.lo > s.hi * 0.15 ? (s.lvl - s.lo) / (s.hi - s.lo) : 0.5;
    s.b += (clamp(full, 0, 1) - s.b) * Math.min(1, dt * 2);
    const depth = f.value('kdepth'), bpm = f.value('kbpm'), hall = clamp(f.value('kspace'), 0, 1), warm = f.value('kwarm');
    const L = layout(w, h, hall), { cx, FL, BY, EYE } = L, { k, W, H } = sizeOf(s.b, depth);
    const t = clamp(Math.log(warm / 200) / Math.log(8), 0, 1), band = i => mix(COOL[i], WARM[i], t);
    const zone = s.drag || s.over;
    ctx.clearRect(0, 0, w, h);
    // The back wall, its concrete panels smaller the further off it is.
    let g = ctx.createLinearGradient(0, 0, 0, FL);
    g.addColorStop(0, WALL); g.addColorStop(1, WALL_LO);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, FL);
    const P = 104 - 34 * hall;
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = zone === 'room' ? 0.09 : 0.04; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = cx % P; x < w; x += P) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, FL); }
    for (let y = FL - P * 0.9; y > 0; y -= P * 0.9) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // The floor, polished, its joints running toward the eye.
    g = ctx.createLinearGradient(0, FL, 0, h);
    g.addColorStop(0, FLOOR); g.addColorStop(1, FLOOR_LO);
    ctx.fillStyle = g; ctx.fillRect(0, FL, w, h - FL);
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = zone === 'room' ? 0.1 : 0.05; ctx.beginPath();
    for (let i = -8; i <= 8; i++) { const xb = cx + i * 120, a = (FL - EYE) / (h - EYE); ctx.moveTo(cx + (xb - cx) * a, FL); ctx.lineTo(xb, h); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = INK; ctx.fillRect(0, FL - 1, w, 2);
    // The slit of light in the wall (the meter is its light), and the line it throws on the floor.
    const slit = String((f.props || {}).slit || '').split(' ').map(Number), SX = slit[0] || 92, ST = slit[1] || 24, SW = slit[2] || 6, SH = slit[3] || 228;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(SX - 2, ST - 2, SW + 4, SH + 4, 5); ctx.fill();
    ctx.fillStyle = '#efe6ff'; ctx.globalAlpha = 0.08 + 0.22 * clamp((f.level || 0) * 4, 0, 1);
    ctx.beginPath(); ctx.moveTo(SX, FL); ctx.lineTo(SX + SW, FL); ctx.lineTo(SX + SW - 30, h); ctx.lineTo(SX - 46, h); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // The form's shadow, and its reflection in the floor.
    ctx.fillStyle = INK; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(cx, BY + 8, W * 0.53, 15, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(0, BY + 10, w, h); ctx.clip();
    ctx.translate(0, 1.55 * (BY + 10)); ctx.scale(1, -0.55);
    outline(ctx, cx, BY, W, H, 1, 0, 0); ctx.fillStyle = band(1); ctx.globalAlpha = 0.07; ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    // The blower on the floor that fills it, its fan turning, and its duct running into the form.
    s.fan = (s.fan || 0) + dt * (3 + 12 * s.b);
    const bx = cx - W * 0.5 - 50, byy = BY + 26, ex = cx - W * 0.36, ey = BY + 4;
    ctx.strokeStyle = INK; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx + 14, byy - 6); ctx.bezierCurveTo(bx + 40, byy + 26, ex - 40, ey + 30, ex, ey); ctx.stroke();
    ctx.strokeStyle = band(1); ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = band(0); ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 12; i++) {
      const u = i / 12, a = 1 - u, x = a * a * a * (bx + 14) + 3 * a * a * u * (bx + 40) + 3 * a * u * u * (ex - 40) + u * u * u * ex;
      const y = a * a * a * (byy - 6) + 3 * a * a * u * (byy + 26) + 3 * a * u * u * (ey + 30) + u * u * u * ey;
      ctx.moveTo(x - 3, y - 3.5); ctx.lineTo(x + 3, y + 3.5);
    }
    ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(bx - 16, byy - 22, 32, 26, 4); ctx.fill();
    ctx.strokeStyle = band(1); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(bx, byy - 9, 9, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = s.fan + (i * TAU) / 4; ctx.moveTo(bx, byy - 9); ctx.lineTo(bx + Math.cos(a) * 7.5, byy - 9 + Math.sin(a) * 7.5); }
    ctx.stroke();
    // The form: light in steps from its shadow to its top, its seams, creases as it empties, a shine as it fills.
    ctx.save();
    outline(ctx, cx, BY, W, H, 1, 0, 0); ctx.fillStyle = band(0); ctx.fill(); ctx.clip();
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath(); ctx.ellipse(cx - W * 0.05 * i, BY - H * (0.42 + 0.09 * i), W * (0.56 - 0.12 * i), H * (0.7 - 0.15 * i), 0, 0, TAU);
      ctx.fillStyle = band(i); ctx.fill();
    }
    ctx.strokeStyle = band(0); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const u of [-0.62, -0.3, 0, 0.3, 0.62]) {
      ctx.moveTo(cx + u * W * 0.1, BY - H * 0.99);
      ctx.quadraticCurveTo(cx + u * W * 0.48, BY - H * 0.78, cx + u * W * 0.5, BY + 22 * (1 - u * u));
    }
    ctx.stroke();
    const crease = clamp(-k, 0, 1);
    if (crease > 0.02) {
      ctx.globalAlpha = 0.55 * crease; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let i = 0; i < 11; i++) {
        const u = -0.86 + i * 0.172, x0 = cx + u * W * 0.5, y0 = BY + 20 * (1 - u * u), lift = H * (0.18 + 0.12 * ((i * 7) % 3) / 2);
        ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + (i % 2 ? 10 : -10), y0 - lift * 0.5, x0 + (i % 2 ? 4 : -4), y0 - lift);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.35 + 0.35 * clamp(k, 0, 1); ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(cx - W * 0.17, BY - H * 0.76, W * 0.075, H * 0.06, -0.25, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    if (zone === 'form') { outline(ctx, cx, BY, W, H, 1, 0, 0); ctx.strokeStyle = '#efe9fb'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]); }
    // Visitors, for scale.
    ctx.fillStyle = INK;
    visitor(ctx, 38, BY + 52, 74, 1.1);
    visitor(ctx, 642, BY + 30, 60, 1);
    visitor(ctx, 676, BY + 36, 64, 1.2);
    // The card on the wall: the work's name, and what the hand is on.
    const cw = 208, chh = 68, cxl = w - cw - 26, cy = FL - 156;
    ctx.fillStyle = CARD; ctx.fillRect(cxl, cy, cw, chh);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = TEXT;
    ctx.font = '700 14px ' + FONT; ctx.fillText('Exhale', cxl + 12, cy + 22);
    const lines = zone === 'form' ? ['depth ' + Math.round(depth * 100) + '%  ↕', bpm.toFixed(1) + ' breaths a minute  ↔']
      : zone === 'room' ? ['hall ' + Math.round(hall * 100) + '%  ↕', 'warmth ' + Math.round(warm) + ' Hz  ↔']
      : ['air and sound, a breath every ' + Math.round(60 / Math.max(1, bpm)) + ' s', 'drag the form, or the room'];
    ctx.font = '500 11px ' + FONT; ctx.fillText(lines[0], cxl + 12, cy + 40);
    ctx.globalAlpha = zone ? 1 : 0.62; ctx.fillText(lines[1], cxl + 12, cy + 55); ctx.globalAlpha = 1;
  },
  pointer(e, f) {
    const s = f.state, b = s.b === undefined ? 0.5 : s.b, L = layout(f.w, f.h, clamp(f.value('kspace'), 0, 1)), { W, H } = sizeOf(b, f.value('kdepth'));
    const zone = onForm(e.x, e.y, L.cx, L.BY, W, H) ? 'form' : 'room';
    if (e.type === 'down') {
      Object.assign(s, { drag: zone, axis: '', x0: e.x, y0: e.y, from: {} });
      for (const id of Object.values(AXES[zone])) s.from[id] = f.value(id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = e.y - s.y0;
      if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = s.axis && AXES[s.drag][s.axis];
      if (id) f.set(id, move(id, s.from[id], dx, dy));
    }
    if (e.type === 'wheel') {
      const id = AXES[zone].y, d = SET[id];
      f.set(id, clamp(f.value(id) - (Math.sign(e.dy) * (d.hi - d.lo)) / 50, d.lo, d.hi));
    }
    s.over = e.type === 'leave' ? '' : s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : 'grab');
  },
};
`;

export function breath(catalog: Catalog) {
  const inside = ['idx1', 'wob1', 'note1', 'note2', 'mtof1', 'osc1', 'lp1'];
  return workInSteps(
    'breath',
    'Exhale',
    catalog,
    [760, 500],
    [
      [
        // ---- the breath: a slow sine, 0 (out) to 1 (in) ----
        add('rate1', 'kit.mul', { label: 'Breaths (Hz)', values: { b: 1 / 60 } }),
        add('breath1', 'den.lfo', { label: 'Breath' }),
        add('in1', 'kit.scale', { label: 'How full', values: { scale: 0.5, offset: 0.5 } }),
        add('out1n', 'kit.scale', { label: 'How empty', values: { scale: -1, offset: 1 } }),
        add('deep1', 'kit.mul', { label: 'Depth' }),
        add('swell1', 'kit.scale', { label: 'Swell', values: { scale: -1, offset: 1 } }),
        add('bamt1', 'kit.mul', { label: 'Breath, as deep as Depth' }),
        wire('rate1.out', 'breath1.rate'),
        wire('breath1.out', 'in1.in'),
        wire('in1.out', 'out1n.in'),
        wire('out1n.out', 'deep1.a'),
        wire('deep1.out', 'swell1.in'),
        wire('in1.out', 'bamt1.a'),
        // The chord's tone opens with the breath.
        add('open1', 'kit.mul', { label: 'Opening', values: { b: 1.8 } }),
        add('cut1', 'kit.cutoffMod', { label: 'Tone', values: { hz: 520 } }),
        wire('bamt1.out', 'open1.a'),
        wire('open1.out', 'cut1.octaves'),
        // ---- one tone of the chord ----
        add('idx1', 'kit.copy', { label: 'Which tone' }),
        add('wob1', 'kit.scale', { label: 'A little off', values: { scale: 0.12, offset: -0.06 } }),
        add('note1', 'kit.add', { label: 'Interval' }),
        add('note2', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'Tone', config: { waveform: 'saw' } }),
        add('lp1', 'den.stateVariableFilter', { label: 'Soft', values: { q: 0.6 } }),
        wire('idx1.random', 'wob1.in'),
        wire('note1.out', 'note2.a'),
        wire('wob1.out', 'note2.b'),
        wire('note2.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        wire('osc1.out', 'lp1.input'),
        wire('cut1.out', 'lp1.cutoffHz'),
        // ---- the chord across, and the air, swelling; a long hall ----
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.75 } }),
        add('chl1', 'kit.mul', { label: 'Chord L' }),
        add('chr1', 'kit.mul', { label: 'Chord R' }),
        wire('lp1.lowpass', 'splay1.in'),
        wire('splay1.left', 'chl1.a'),
        wire('splay1.right', 'chr1.a'),
        wire('swell1.out', 'chl1.b'),
        wire('swell1.out', 'chr1.b'),
        add('air1', 'den.seededNoise', { label: 'Air', config: { seed: 31 } }),
        add('airhz1', 'kit.cutoffMod', { label: 'Air rising', values: { hz: 380 } }),
        add('airband1', 'kit.mul', { label: 'Air sweep', values: { b: 2.2 } }),
        add('airf1', 'den.stateVariableFilter', { label: 'Air band', values: { q: 0.9 } }),
        add('airpow1', 'kit.mul', { label: 'Air swell' }),
        add('airamt1', 'kit.mul', { label: 'Air level', values: { b: 0.35 } }),
        add('airvca1', 'kit.mul', { label: 'Air' }),
        wire('in1.out', 'airband1.a'),
        wire('airband1.out', 'airhz1.octaves'),
        wire('airhz1.out', 'airf1.cutoffHz'),
        wire('air1.out', 'airf1.input'),
        wire('bamt1.out', 'airpow1.a'),
        wire('bamt1.out', 'airpow1.b'),
        wire('airpow1.out', 'airamt1.a'),
        wire('airf1.bandpass', 'airvca1.a'),
        wire('airamt1.out', 'airvca1.b'),
        add('suml1', 'kit.add', { label: 'Left' }),
        add('sumr1', 'kit.add', { label: 'Right' }),
        wire('chl1.out', 'suml1.a'),
        wire('airvca1.out', 'suml1.b'),
        wire('chr1.out', 'sumr1.a'),
        wire('airvca1.out', 'sumr1.b'),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1, decaySeconds: 5, dampingHz: 4500 },
          values: { mix: 0.45 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.16 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.16 } }),
        add('out1', 'kit.out'),
        wire('suml1.out', 'hall1.left'),
        wire('sumr1.out', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        ...patchControl('kkey', 'Key', 'note1.a', [45, 57, 'linear', 'note'], 50),
        ...patchControl('kbpm', 'Breaths a minute', 'rate1.a', [3, 10, 'linear', ''], 6),
        ...patchControl('kdepth', 'Depth', ['deep1.b', 'bamt1.b'], [0, 1, 'linear', ''], 0.8),
        ...patchControl('kwarm', 'Warmth', 'cut1.hz', [200, 1600, 'log', 'Hz'], 520),
        ...patchControl('kspace', 'Hall', 'hall1.mix', [0, 1, 'linear', ''], 0.45),
        { op: 'makePart', ids: inside, name: 'Tone', id: 'tone', node: 'tone1' },
      ],
      // Its one knob: which tone of the chord this copy is, above the key.
      doc =>
        onlyParams(doc, 'tone', [
          {
            node: 'note1',
            port: 'b',
            id: 'interval',
            label: 'Interval',
            range: { min: -12, max: 24, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'tone',
          doc: 'One tone of the chord: a saw, a little off pitch by its own random number, through a lowpass that opens with the breath. Interval is its note above the key.',
        },
        { op: 'setCount', node: 'tone1', count: 5 },
        {
          op: 'setSpread',
          node: 'tone1',
          port: 'interval',
          spread: { kind: 'each', values: [-12, 0, 7, 14, 19] },
        },
        // ---- the plugin: one picture that breathes ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#1b1534',
              fg: '#ece6f8',
              accent: '#b7a6ee',
              track: '#2e2556',
              knob: '#3b3070',
              pointer: '#ece6f8',
              muted: '#9187bf',
              glow: '#b7a6ee',
              font: 'system',
              labelFont: 'system',
              valueFont: 'system',
            },
            background: [{ kind: 'color', color: '#1b1534' }],
            skins: { meter: { name: 'bar', params: {} } },
          },
        },
        el({
          kind: 'canvas',
          name: 'The gallery',
          code: SCENE,
          rect: r(0, 0, 760, 500),
          props: { slit: `${SLIT.x} ${SLIT.y} ${SLIT.w} ${SLIT.h}` },
        }),
        // The slit of light in the wall is how loud the room is.
        ...control(
          'mlevel',
          'ui.meter',
          'Light through the slit',
          null,
          r(SLIT.x, SLIT.y, SLIT.w, SLIT.h),
          {
            style: {
              skin: { name: 'bar', params: { fill: '#fbf8ff', surface: '#c7bbef', scale: false } },
            },
          },
        ),
        wire('gl1.out', 'mlevel.in'),
      ],
    ],
  );
}

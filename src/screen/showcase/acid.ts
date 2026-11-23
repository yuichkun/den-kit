// Contour — an acid bass whose filter is a hill you take hold of.
// A mono saw/square bass through a driven ladder filter, with a snappy filter
// envelope and glide. The design follows the thinking of Elektron Overbridge's
// interface (Red Dot: Best of the Best 2016, User Interface Design): no copy of
// a hardware panel, free of rotary wheels and sliders; every setting is a graph
// edited where it is drawn, and nothing hides in menus. The filter's response is
// the screen, a solid warm-white hill on ultramarine paper across its whole
// width: drag its summit (across: Cutoff, up: Resonance), and drag the dot on
// the dashed outline (or scroll) for how far each note opens it. Contour lines in
// the paper's blue inside the hill are the sound's last moments of spectrum, so
// what the hill lets through is seen in what plays. Three octaves of bass keys lie along the hill's
// foot, each under its own pitch on the hill's frequency axis, so a played key is
// where its note's first ridge rises and the summit shows which notes it passes;
// every C has a tick on the ground, and right of the keys the octaves are named
// under it, so keys and names read as one axis. The hill's three settings are set
// in figures under the keys, with the title under them at the foot, like a map's.
// Beside them, three small graphs drawn in line, sharing their top and their
// ground, carry the rest: each note's filter envelope, the glide between notes,
// and the wave (saw or square) with Drive.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The hill's frequency axis, A0 to 12 kHz: it puts the C1 key on the plugin's left margin. */
const AXIS = { lo: 27.5, hi: 12000 };
/** The C of each octave, C1 to C9 (Hz): the keys show C1 to C4, the names under the hill the rest. */
const C = (octave: number) => 32.703 * 2 ** (octave - 1);
/** The plugin's left margin: the title, the C1 key and the figures start there. */
const MARGIN = 16;

/** What every Contour graph shares (canvas code): the handle (one kind on every graph), the plate by the hand, a graph's name. */
const PARTS = `const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** A handle: a paper disc with an ink ring round it, bigger under the hand. */
function ring(ctx, x, y, r, paper, ink) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = paper; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = ink; ctx.stroke();
}
/** A small graph's line and the light fill under it (the hill alone is solid ink). */
function inLine(ctx, ink, track) {
  ctx.fillStyle = track; ctx.fill();
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.stroke();
}
/** A setting's name and value by the hand, set like a label on a map: paper, a rule round it in the ink. */
function plate(ctx, text, x, y, w, ink, paper, size) {
  ctx.font = '700 ' + size + 'px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * size * 0.56) + 16, ph = size + 10;
  const x0 = Math.max(2, Math.min(w - tw - 2, x - tw / 2)), y0 = Math.max(2, y - ph / 2);
  ctx.fillStyle = paper; ctx.fillRect(Math.round(x0), Math.round(y0), Math.round(tw), ph);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.strokeRect(Math.round(x0) + 0.75, Math.round(y0) + 0.75, Math.round(tw) - 1.5, ph - 1.5);
  ctx.fillStyle = ink; ctx.fillText(text, Math.round(x0 + 8), Math.round(y0 + ph / 2) + 0.5);
}
/** The graph's name, small, at its top left (or as high as y). */
function name(ctx, text, color, y) {
  ctx.font = '700 11px ' + FONT; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = color; ctx.fillText(text, 0, y ?? 11);
}
`;

/** The filter as a hill: the ladder's response from Cutoff and Resonance, the recent spectrum inside it; it takes the mouse. */
export const FILTER_HILL = `// The filter as a hill: the ladder's response, drawn from Cutoff (kcut) and
// Resonance (kres), filled from the ground; its summit is the resonance peak.
// Inside it run contour lines in the paper's colour, the sound's last moments of
// spectrum: a new line every 60 ms, older lines higher and fainter (flat while
// nothing plays).
// The dashed outline is where each note opens the filter to (Sweep, kenv), with
// a dot on its summit; it comes down to the ground like the hill. Drag the
// summit: across is the cutoff, up the resonance; press anywhere else and the
// summit comes to the hand. Drag the dot across, or scroll: Sweep. A handle
// moves as far as the hand does, so pressing one changes nothing, even where it
// is held at the edge of the graph; where the dot meets the summit, the right
// of it is the dot's. Each handle is named above it as its figure under the hill
// is ("cutoff", "sweep"). While the hand is on a handle, small arrows by it show
// the ways it moves (in place of its name); the values are the figures. Across, the graph runs from A0 to 12 kHz (LO, HI);
// the keys under it are laid on that axis, and every C stands on the ground
// as a short tick.
export const LO = ${AXIS.lo}, HI = ${AXIS.hi};
const TOP = 30, BOTTOM = -40, PAD = 28, ROWS = 18, GAP = 12;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const xOf = (hz, w) => (Math.log(hz / LO) / Math.log(HI / LO)) * w;
const hzOf = (x, w) => LO * Math.pow(HI / LO, Math.min(1, Math.max(0, x / w)));
const yOf = (db, h) => PAD + ((TOP - db) / (TOP - BOTTOM)) * (h - PAD);
const dbOf = (y, h) => TOP - ((y - PAD) / (h - PAD)) * (TOP - BOTTOM);
function gain(hz, fc, k) {
  const x = hz / fc, x2 = x * x;
  const re = 1 - 6 * x2 + x2 * x2 + 4 * k, im = 4 * x - 4 * x * x2;
  return (1 + 4 * k) / Math.sqrt(re * re + im * im);
}
const dbAt = (hz, fc, k) => 20 * Math.log10(gain(hz, fc, k));
/** Where the curve peaks (as a ratio of the cutoff) and how high (dB), found on a fine scan. */
function peakOf(k) {
  let best = 0, at = 1;
  for (let x = 0.5; x <= 1.3; x += 0.005) {
    const g = gain(x, 1, k);
    if (g > best) { best = g; at = x; }
  }
  return { at, db: 20 * Math.log10(best) };
}
function resonanceAt(db) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (peakOf(mid).db < db) lo = mid;
    else hi = mid;
  }
  return lo;
}
/** The hill's outline, closed along the ground (added to the current path). */
function hill(ctx, w, h, fc, k) {
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 1; x += 2) ctx.lineTo(x, Math.min(h, yOf(Math.min(TOP + 6, dbAt(hzOf(x, w), fc, k)), h)));
  ctx.lineTo(w, h);
  ctx.closePath();
}
/** How loud the spectrum is at a frequency (64 bands from 96 Hz up, 0..1). */
function levelAt(sp, hz) {
  const b = (64 * Math.log(hz / 96)) / Math.log(250) - 0.5;
  if (!sp || b < -4 || b > 63) return 0;
  // Below the first band it fades out over half an octave, so the lines rise smoothly.
  if (b < 0) return (sp[0] || 0) * (1 + b / 4);
  const i = Math.floor(b), t = b - i;
  return (sp[i] || 0) * (1 - t) + (sp[Math.min(63, i + 1)] || 0) * t;
}
/** Where the summit and the dot sit (each held inside the graph), and how high the peak really is. */
export function marks(f) {
  const fc = f.value('kcut'), k = f.value('kres'), pk = peakOf(k);
  const open = Math.min(HI, fc * Math.pow(2, f.value('kenv')));
  return { fc, k, open, at: pk.at, db: pk.db, px: xOf(fc * pk.at, f.w), ox: Math.min(f.w - 10, xOf(open * pk.at, f.w)), y: yOf(Math.min(TOP, pk.db), f.h) };
}
/** The part under the hand: the dot (near it, on the summit's right: it is never left of it), the summit (near it), or nothing. */
function zone(x, y, m) {
  const dOpen = Math.hypot(x - m.ox, y - m.y), dPeak = Math.hypot(x - m.px, y - m.y);
  if (dOpen < 16 && x > (m.ox + m.px) / 2) return 'open';
  return dPeak < 44 ? 'peak' : '';
}
/** Small arrowheads round a handle, r from its middle: left and right, and up and down too. Each is solid against what is behind it: ink on the paper, paper on the hill (the one pointing down). */
function arrows(ctx, x, y, r, both, ink, paper) {
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  for (const [dx, dy] of both ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
    const tx = x + dx * r, ty = y + dy * r, onHill = dy > 0;
    ctx.fillStyle = onHill ? paper : ink; ctx.strokeStyle = onHill ? ink : paper;
    ctx.beginPath();
    ctx.moveTo(tx + dx * 5, ty + dy * 5);
    ctx.lineTo(tx - dy * 5, ty + dx * 5);
    ctx.lineTo(tx + dy * 5, ty - dx * 5);
    ctx.closePath(); ctx.stroke(); ctx.fill();
  }
}
/** A short tick on the ground at every C, C1 to C9 (added to the current path). */
function ticks(ctx, w, h) {
  for (let n = 1; n <= 9; n++) {
    const x = Math.round(xOf(32.703 * Math.pow(2, n - 1), w)) + 0.5;
    ctx.moveTo(x, h); ctx.lineTo(x, h - 7);
  }
}
${PARTS}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: '', hist: [], last: 0 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, m = marks(f);
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg');
    ctx.clearRect(0, 0, w, h);
    if (f.t - s.last > 0.06) {
      s.last = f.t;
      s.hist.unshift(Array.from(f.spectrum || []));
      if (s.hist.length > ROWS) s.hist.pop();
    }
    // The hill.
    ctx.beginPath(); hill(ctx, w, h, m.fc, m.k);
    ctx.fillStyle = ink; ctx.fill();
    // Its contour lines: what plays raises them.
    ctx.save();
    ctx.beginPath(); hill(ctx, w, h, m.fc, m.k); ctx.clip();
    ctx.strokeStyle = paper; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    for (let row = 0; row < ROWS; row++) {
      const sp = s.hist[row], base = h - 6 - row * GAP;
      ctx.globalAlpha = 0.9 * Math.pow(1 - row / ROWS, 1.5);
      ctx.beginPath();
      for (let x = 0; x <= w + 3; x += 3) {
        const y = base - levelAt(sp, hzOf(x, w)) * h * 0.11;
        if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // The hill's edge, drawn over the ends of the lines so the slope stays clean.
    ctx.beginPath(); hill(ctx, w, h, m.fc, m.k); ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
    // The axis: a tick at every C, ink on the paper and paper on the hill.
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ticks(ctx, w, h); ctx.stroke();
    ctx.save();
    ctx.beginPath(); hill(ctx, w, h, m.fc, m.k); ctx.clip();
    ctx.strokeStyle = paper; ctx.beginPath(); ticks(ctx, w, h); ctx.stroke();
    ctx.restore();
    // Where each note opens it: dashed where it stands above the hill, down to the ground.
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = ink;
    let on = false;
    ctx.beginPath();
    for (let x = 0; x <= w + 1; x += 2) {
      const hz = hzOf(x, w), a = dbAt(hz, m.open, m.k), y = Math.min(h, yOf(Math.min(TOP + 6, a), h));
      const shown = a - dbAt(hz, m.fc, m.k) > 1 && y < h - 1;
      if (shown && on) ctx.lineTo(x, y);
      else if (shown) ctx.moveTo(x, y);
      on = shown;
    }
    ctx.stroke(); ctx.setLineDash([]);
    const p = f.pointer, hot = s.drag || (p && p.over ? zone(p.x, p.y, m) : '');
    // The dot over the summit, so it shows where the two meet.
    ring(ctx, m.px, m.y, hot === 'peak' ? 11 : 8, paper, ink);
    ring(ctx, m.ox, m.y, hot === 'open' ? 11 : 8, paper, ink);
    if (hot === 'peak') arrows(ctx, m.px, m.y, 21, true, ink, paper);
    if (hot === 'open') arrows(ctx, m.ox, m.y, 16, false, ink, paper);
    // Each handle's name above it (kept inside the graph; side by side, away from each other, where the two are close),
    // unless the summit's arrows are there.
    ctx.font = '700 11px ' + FONT; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = ink;
    const apart = m.ox - m.px > 56;
    if (hot !== 'peak') {
      ctx.textAlign = apart ? 'center' : 'right';
      ctx.fillText('cutoff', apart ? clamp(m.px, 22, w - 22) : Math.max(38, m.px - 4), m.y - 16);
    }
    if (hot !== 'peak' || m.ox - m.px > 40) {
      ctx.textAlign = apart ? 'center' : 'left';
      ctx.fillText('sweep', apart ? clamp(m.ox, 22, w - 22) : Math.min(m.ox + 4, w - 36), m.y - 16);
    }
  },
  pointer(e, f) {
    const s = f.state, m = marks(f), at = zone(e.x, e.y, m);
    if (e.type === 'down') {
      s.drag = at === 'open' ? 'open' : 'peak';
      // A handle taken hold of keeps where it started; a press away from both brings the summit to the hand.
      // The summit is taken from where it is drawn (held at the graph's top, however high the peak really is).
      s.from = at ? { x: e.x, y: e.y, env: f.value('kenv'), hz: m.fc * m.at, db: Math.min(TOP, m.db), k: m.k } : null;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    const o = s.from, moved = o && e.type === 'move' && (e.x !== o.x || e.y !== o.y);
    if (e.type === 'wheel') f.set('kenv', clamp(f.value('kenv') - e.dy / 200, 0, 6));
    else if (s.drag === 'open' && moved) f.set('kenv', clamp(o.env + (Math.log2(HI / LO) * (e.x - o.x)) / f.w, 0, 6));
    else if (s.drag === 'peak' && (o ? moved : e.type === 'down' || e.type === 'move')) {
      // At or above the top, a drag only ever raises Resonance: the peak may already be higher than the graph shows.
      const to = o && o.db + dbOf(e.y, f.h) - dbOf(o.y, f.h);
      const k = !o ? resonanceAt(dbOf(e.y, f.h)) : e.y === o.y ? o.k : to >= TOP ? Math.max(o.k, resonanceAt(to)) : resonanceAt(to);
      f.set('kres', k);
      f.set('kcut', clamp((o ? o.hz * Math.pow(HI / LO, (e.x - o.x) / f.w) : hzOf(e.x, f.w)) / peakOf(k).at, 40, 4000));
    }
    f.cursor(s.drag === 'peak' ? 'grabbing' : s.drag === 'open' || at === 'open' ? 'ew-resize' : 'grab');
  },
};
`;

/** Each note's filter envelope, in line: Sweep is its height (set on the hill), Decay its length; it takes the mouse. */
export const ENVELOPE_GRAPH = `// Each note's filter envelope, drawn in line: it jumps up as far as the
// note opens the filter (Sweep, kenv, set on the hill) and closes again over
// Decay (kdec). Drag across it: Decay, the end of the slope at the hand. Time
// runs on a square-root scale, so short decays get room. A dot runs down the
// slope each time a note starts (seen in the output level).
const TMAX = 1.2, OMAX = 6, LEFT = 2, RIGHT = 12;
${PARTS}
function frame(f) {
  const base = f.h - 12, top = 30;
  return {
    base, top,
    xT: t => LEFT + Math.sqrt(Math.max(0, t) / TMAX) * (f.w - LEFT - RIGHT),
    yO: o => base - (o / OMAX) * (base - top),
  };
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: false, prev: 0, start: -10 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, g = frame(f);
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg'), muted = f.color('muted'), track = f.color('track');
    const decay = f.value('kdec'), peak = g.yO(f.value('kenv')), x0 = g.xT(0), end = g.xT(decay);
    const at = u => peak + (g.base - peak) * (1 - (1 - u) * (1 - u));
    ctx.clearRect(0, 0, w, h);
    name(ctx, 'each note', muted);
    ctx.fillStyle = track; ctx.fillRect(0, g.base, w, 2);
    ctx.beginPath();
    ctx.moveTo(x0, g.base); ctx.lineTo(x0, peak);
    for (let i = 1; i <= 40; i++) ctx.lineTo(g.xT((decay * i) / 40), at(i / 40));
    ctx.closePath();
    inLine(ctx, ink, track);
    // A note starts when the output jumps up; the dot rides the slope while it closes.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.start > 0.09) s.start = f.t;
    s.prev = f.level;
    const age = f.t - s.start;
    if (age >= 0 && age < decay) { ctx.beginPath(); ctx.arc(g.xT(age), at(age / decay), 3.5, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill(); }
    const p = f.pointer, hot = s.drag || (p && p.over);
    ring(ctx, end, g.base + 1, hot ? 9 : 7, paper, ink);
    if (hot) plate(ctx, 'decay ' + decay.toFixed(2) + ' s ↔', end, g.base - 26, w, ink, paper, 11);
  },
  pointer(e, f) {
    const s = f.state;
    if (e.type === 'down') s.drag = true;
    if (e.type === 'up' || e.type === 'leave') s.drag = false;
    if (s.drag && (e.type === 'down' || e.type === 'move')) {
      const u = Math.max(0, Math.min(1, (e.x - LEFT) / (f.w - LEFT - RIGHT)));
      f.set('kdec', Math.max(0.03, Math.min(1.2, u * u * TMAX)));
    }
    f.cursor('ew-resize');
  },
};
`;

/** Glide as the pitch's slope from one note to the next, in line; it takes the mouse. */
export const GLIDE_GRAPH = `// Glide (kglide): how long a note slides to the next, drawn as the pitch's
// path: a low note on the ground, the slide up, the next note at the top (the
// three small graphs share their top and their ground). Drag across it: the
// longer the slope, the slower the slide.
const GMAX = 0.3, X0 = 34, RIGHT = 34;
${PARTS}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg'), muted = f.color('muted'), track = f.color('track');
    const glide = f.value('kglide'), lo = h - 12, hi = 30, x1 = Math.max(X0 + 2, X0 + (glide / GMAX) * (w - X0 - RIGHT));
    ctx.clearRect(0, 0, w, h);
    name(ctx, 'glide', muted);
    // The pitch's path alone: a line, no fill (the graphs with an area fill it).
    ctx.fillStyle = track; ctx.fillRect(0, lo, w, 2);
    ctx.beginPath();
    ctx.moveTo(1, lo); ctx.lineTo(X0, lo); ctx.lineTo(x1, hi); ctx.lineTo(w - 1, hi);
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.stroke();
    const p = f.pointer, hot = s.drag || (p && p.over);
    ring(ctx, x1, hi, hot ? 9 : 7, paper, ink);
    if (hot) plate(ctx, 'glide ' + Math.round(glide * 1000) + ' ms ↔', x1, hi + 22, w, ink, paper, 11);
  },
  pointer(e, f) {
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move'))
      f.set('kglide', Math.max(0, Math.min(GMAX, ((e.x - X0) / (f.w - X0 - RIGHT)) * GMAX)));
    f.cursor('ew-resize');
  },
};
`;

/** The oscillator's wave, saw or square, rounded by Drive, in line; it takes the mouse. */
export const WAVE_GRAPH = `// The wave into the filter: two cycles of saw, or of square while Wave (tsq) is
// on, rounder the harder Drive (kdrive) pushes the filter, drawn in line from
// the middle. Its handle rides the wave in the half for the wave (the left half
// saw, the right half square), on the saw's slope, which Drive rounds up; press
// and drag anywhere on it, across for the wave (the half the hand is in), up for
// Drive (by as much as the hand moves, so a press alone keeps it).
const DMAX = 8;
${PARTS}
function frame(f) {
  const top = 30, base = f.h - 12;
  return { top, base, mid: (top + base) / 2, amp: (base - top) / 2 - 1 };
}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, g = frame(f);
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg'), muted = f.color('muted'), track = f.color('track');
    const mix = f.on('tsq') ? 1 : 0, drive = f.value('kdrive');
    const p = f.pointer, hot = s.drag || (p && p.over);
    ctx.clearRect(0, 0, w, h);
    // While the hand is on it, the plate takes the name's place.
    if (hot) plate(ctx, (mix ? 'square' : 'saw') + ' ↔ · drive ' + drive.toFixed(1) + ' ↕', w / 2, 10, w, ink, paper, 11);
    else name(ctx, 'wave', muted);
    const round = v => Math.tanh(v * drive * 0.5) / Math.tanh(drive * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, g.mid);
    for (let x = 0; x <= w; x++) {
      const ph = x === w ? 1 : ((x / w) * 2) % 1;
      const v = (1 - mix) * (1 - 2 * ph) + mix * (ph < 0.5 ? 1 : -1);
      ctx.lineTo(x, g.mid - round(v) * g.amp);
    }
    ctx.lineTo(w, g.mid);
    ctx.closePath();
    inLine(ctx, ink, track);
    ring(ctx, mix ? w * 0.625 : w * 0.125, g.mid - round(mix ? 1 : 0.5) * g.amp, hot ? 9 : 7, paper, ink);
  },
  pointer(e, f) {
    const g = frame(f), s = f.state;
    if (e.type === 'down') s.drag = { y: e.y, drive: f.value('kdrive') };
    if (e.type === 'up' || e.type === 'leave') s.drag = false;
    if (s.drag && (e.type === 'down' || e.type === 'move')) {
      if (e.x > f.w / 2 !== f.on('tsq')) f.set('tsq', e.x > f.w / 2);
      const drive = s.drag.drive + ((s.drag.y - e.y) / (g.base - g.top)) * (DMAX - 1);
      if (e.type === 'move') f.set('kdrive', Math.max(1, Math.min(DMAX, drive)));
    }
    f.cursor(s.drag ? 'grabbing' : 'move');
  },
};
`;

/** The hill across the plugin, on the frequency axis AXIS. */
const HILL = { x: 0, y: 0, w: 760, h: 352 };
/** Where a frequency stands across the hill. */
const across = (hz: number) => (Math.log(hz / AXIS.lo) / Math.log(AXIS.hi / AXIS.lo)) * HILL.w;
/**
 * The keys along the hill's foot, C1 to C4: an octave of seven white keys spans
 * an octave of the axis, and each C stands under its own pitch (a C key's middle
 * at the C's frequency).
 */
const KEYS = (() => {
  const key = (across(C(2)) - across(C(1))) / 7;
  return { x: across(C(1)) - key / 2, w: key * 22, octaves: 3, start: 24 };
})();
/** The small graphs under the hill, right of the figures: each note, glide, wave, the last ending on the right margin as the keys start on the left one. */
const GRAPHS = { x: [328, 472, 616] as const, w: 128, y: 376, h: 116 };

export function acid(catalog: Catalog) {
  /** One of the hill's settings in figures under the keys: its name, then its value (text bound to it). */
  const figure = (label: string, bind: string, x: number) => [
    el({
      kind: 'text',
      name: `${label} name`,
      text: label,
      rect: r(x, 408, 96, 14),
      textStyle: { size: 11, weight: 700, color: 'muted', align: 'left' },
    }),
    el({
      kind: 'text',
      name: `${label} value`,
      text: '{value}',
      bind,
      rect: r(x, 424, 96, 24),
      textStyle: { size: 19, weight: 700, color: 'fg', align: 'left', spacing: -0.01 },
    }),
  ];
  /** The name of an octave's C under its tick on the hill's ground, right of the keys (the keys name C1 to C4). */
  const octaveName = (octave: number) =>
    el({
      kind: 'text',
      name: `C${octave}`,
      text: `C${octave}`,
      rect: r(across(C(octave)) - 14, HILL.h + 4, 28, 12),
      textStyle: { size: 10, weight: 400, color: 'muted', align: 'center' },
    });
  return work(
    'acid',
    'Contour',
    catalog,
    [760, 500],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', {
        config: { mode: 'mono', capacity: 1, heldCapacity: 32, legato: true },
      }),
      add('glide1', 'den.pitchGlide'),
      add('mtof1', 'kit.mtof'),
      add('saw1', 'den.oscillator', { config: { waveform: 'saw' } }),
      add('sqr1', 'den.virtualAnalogSource', {
        config: { waveform: 'pulse' },
        values: { duty: 0.5 },
      }),
      add('wave1', 'kit.crossfade', { label: 'Saw / Square' }),
      add('fenv1', 'den.envelope', {
        label: 'Filter Env',
        values: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.08 },
      }),
      add('envamt1', 'kit.mul', { label: 'Env Amount' }),
      add('cut1', 'kit.cutoffMod'),
      add('ladder1', 'den.characterFilter'),
      add('aenv1', 'den.envelope', {
        label: 'Amp Env',
        values: { attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.06 },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('mix1', 'kit.voiceMix'),
      add('sat1', 'kit.tanh', { values: { drive: 1.3 } }),
      add('gain1', 'kit.gain', { values: { gain: 0.6 } }),
      add('out1', 'kit.out'),
      wire('voice1.note', 'glide1.target'),
      wire('glide1.out', 'mtof1.note'),
      wire('mtof1.out', 'saw1.frequency'),
      wire('mtof1.out', 'sqr1.frequencyHz'),
      wire('saw1.out', 'wave1.a'),
      wire('sqr1.out', 'wave1.b'),
      wire('wave1.out', 'ladder1.input'),
      wire('fenv1.level', 'envamt1.a'),
      wire('envamt1.out', 'cut1.octaves'),
      wire('cut1.out', 'ladder1.poleHz'),
      wire('ladder1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'mix1.in'),
      wire('aenv1.done', 'mix1.done'),
      wire('mix1.out', 'sat1.in'),
      wire('sat1.out', 'gain1.in'),
      wire('gain1.out', 'out1.left'),
      // Every setting lives in the patch, off the plugin: the graphs move them.
      ...patchControl('kcut', 'Cutoff', 'cut1.hz', [40, 4000, 'log', 'Hz'], 340),
      ...patchControl('kres', 'Resonance', 'ladder1.resonance', [0, 1, 'linear', ''], 0.72),
      ...patchControl('kenv', 'Sweep', 'envamt1.b', [0, 6, 'linear', 'oct'], 3.4),
      ...patchControl('kdec', 'Decay', 'fenv1.decay', [0.03, 1.2, 'log', 's'], 0.2),
      ...patchControl('kglide', 'Glide', 'glide1.seconds', [0, 0.3, 'linear', 's'], 0.06),
      ...patchControl('kdrive', 'Drive', 'ladder1.drive', [1, 8, 'linear', 'gain'], 2.2),
      add('tsq', 'ui.toggle', { label: 'Wave', values: { value: false } }),
      wire('tsq.out', 'wave1.mix'),
      // ---- the plugin: a hill on ultramarine paper; the graphs are the controls ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#1e32d6',
            fg: '#f4f1e6',
            accent: '#f4f1e6',
            track: '#4757df',
            knob: '#4757df',
            pointer: '#f4f1e6',
            muted: '#b4baf0',
            glow: '#f4f1e6',
            font: 'system',
            labelFont: 'system',
            valueFont: 'system',
          },
          background: [{ kind: 'color', color: '#1e32d6' }],
          // The keys in the hill's colours: white keys ruled in the paper's blue, the sharps the paper's blue; a played key turns navy.
          css: '[data-widget=keys1] { --dk-key-white: #f4f1e6; --dk-key-black: #1e32d6; --dk-key-line: #1e32d6; --dk-key-label: #10186b; --dk-key-down: #10186b; --dk-key-down-black: #10186b; --dk-key-down-label: #f4f1e6; }',
        },
      },
      el({
        kind: 'canvas',
        name: 'The filter’s hill',
        code: FILTER_HILL,
        rect: r(HILL.x, HILL.y, HILL.w, HILL.h),
      }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(KEYS.x, HILL.h, KEYS.w, 46), {
        style: {
          skin: { name: 'piano', params: { octaves: KEYS.octaves, start: KEYS.start } },
        },
      }),
      ...[5, 6, 7, 8, 9].map(octaveName),
      ...figure('cutoff', 'kcut', MARGIN),
      ...figure('resonance', 'kres', MARGIN + 96),
      ...figure('sweep', 'kenv', MARGIN + 192),
      // The title at the foot, like a map's: under the figures, on the left margin.
      el({
        kind: 'text',
        name: 'Title',
        text: 'Contour',
        rect: r(MARGIN, 462, 160, 22),
        textStyle: { size: 17, weight: 700, color: 'accent', align: 'left', spacing: -0.01 },
      }),
      el({
        kind: 'canvas',
        name: 'Each note',
        code: ENVELOPE_GRAPH,
        rect: r(GRAPHS.x[0], GRAPHS.y, GRAPHS.w, GRAPHS.h),
      }),
      el({
        kind: 'canvas',
        name: 'Glide',
        code: GLIDE_GRAPH,
        rect: r(GRAPHS.x[1], GRAPHS.y, GRAPHS.w, GRAPHS.h),
      }),
      el({
        kind: 'canvas',
        name: 'Wave',
        code: WAVE_GRAPH,
        rect: r(GRAPHS.x[2], GRAPHS.y, GRAPHS.w, GRAPHS.h),
      }),
    ],
  );
}

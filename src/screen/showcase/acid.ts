// Contour — an acid bass whose filter is a hill you take hold of.
// A mono saw/square bass through a driven ladder filter, with a snappy filter
// envelope and glide. The design follows the thinking of Elektron Overbridge's
// interface (Red Dot: Best of the Best 2016, User Interface Design): no copy of
// a hardware panel, free of rotary wheels and sliders; every setting is a graph
// edited where it is drawn, and nothing hides in menus. The filter's response is
// the screen, a solid ultramarine hill on white paper: drag its summit (across:
// Cutoff, up: Resonance), and drag the dot on the dashed outline (or scroll) for
// how far each note opens it. White contour lines inside the hill are the
// sound's last moments of spectrum, so what the hill lets through is seen in what
// plays. Its three settings are set in figures under it. Beside it, three small
// graphs filled the same way carry the rest: each note's filter envelope, the
// glide between notes, and the wave (saw or square), rounded by Drive. Two
// octaves of keys play bass notes.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** What every Contour graph shares (canvas code): the handle, the plate by the hand, a graph's name. */
const PARTS = `const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** A handle: a disc with a ring round it. */
function ring(ctx, x, y, r, fill, line, lw) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.stroke();
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
// Inside it run white contour lines, the sound's last moments of spectrum: a new
// line every 60 ms, older lines higher and fainter (flat while nothing plays).
// The dashed outline is where each note opens the filter to (Sweep, kenv), with
// a dot on its summit; it comes down to the ground like the hill. Drag the
// summit: across is the cutoff, up the resonance; press anywhere else and the
// summit comes to the hand. Drag the dot across, or scroll: Sweep. A handle
// moves as far as the hand does, so pressing one changes nothing, even where it
// is held at the edge of the graph; where the dot meets the summit, the right
// of it is the dot's. While the hand is on a handle, small arrows by it show
// the ways it moves; the values are the figures under the hill.
const LO = 30, HI = 20000, TOP = 30, BOTTOM = -40, PAD = 28, ROWS = 18, GAP = 12;
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
/** Small arrowheads round a handle, r from its middle: left and right, and up and down too; rimmed in paper, so they show on the hill. */
function arrows(ctx, x, y, r, both, ink, paper) {
  ctx.fillStyle = ink; ctx.strokeStyle = paper; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  for (const [dx, dy] of both ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
    const tx = x + dx * r, ty = y + dy * r;
    ctx.beginPath();
    ctx.moveTo(tx + dx * 5, ty + dy * 5);
    ctx.lineTo(tx - dy * 5, ty + dx * 5);
    ctx.lineTo(tx + dy * 5, ty - dx * 5);
    ctx.closePath(); ctx.stroke(); ctx.fill();
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
    ring(ctx, m.px, m.y, hot === 'peak' ? 12 : 9, paper, ink, 3);
    ring(ctx, m.ox, m.y, hot === 'open' ? 8 : 6, ink, paper, 2.5);
    if (hot === 'peak') arrows(ctx, m.px, m.y, 21, true, ink, paper);
    if (hot === 'open') arrows(ctx, m.ox, m.y, 16, false, ink, paper);
  },
  pointer(e, f) {
    const s = f.state, m = marks(f), at = zone(e.x, e.y, m);
    if (e.type === 'down') {
      s.drag = at === 'open' ? 'open' : 'peak';
      // A handle taken hold of keeps where it started; a press away from both brings the summit to the hand.
      s.from = at ? { x: e.x, y: e.y, env: f.value('kenv'), hz: m.fc * m.at, db: m.db, k: m.k } : null;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    const o = s.from, moved = o && e.type === 'move' && (e.x !== o.x || e.y !== o.y);
    if (e.type === 'wheel') f.set('kenv', clamp(f.value('kenv') - e.dy / 200, 0, 6));
    else if (s.drag === 'open' && moved) f.set('kenv', clamp(o.env + (Math.log2(HI / LO) * (e.x - o.x)) / f.w, 0, 6));
    else if (s.drag === 'peak' && (o ? moved : e.type === 'down' || e.type === 'move')) {
      const k = !o ? resonanceAt(dbOf(e.y, f.h)) : e.y === o.y ? o.k : resonanceAt(o.db + dbOf(e.y, f.h) - dbOf(o.y, f.h));
      f.set('kres', k);
      f.set('kcut', clamp((o ? o.hz * Math.pow(HI / LO, (e.x - o.x) / f.w) : hzOf(e.x, f.w)) / peakOf(k).at, 40, 4000));
    }
    f.cursor(s.drag === 'peak' ? 'grabbing' : s.drag === 'open' || at === 'open' ? 'ew-resize' : 'grab');
  },
};
`;

/** Each note's filter envelope, filled: Sweep is its height (set on the hill), Decay its length; it takes the mouse. */
export const ENVELOPE_GRAPH = `// Each note's filter envelope, filled like the hill: it jumps up as far as the
// note opens the filter (Sweep, kenv, set on the hill) and closes again over
// Decay (kdec). Drag across it: Decay, the end of the slope at the hand. Time
// runs on a square-root scale, so short decays get room. A dot runs down the
// slope each time a note starts (seen in the output level).
const TMAX = 1.2, OMAX = 6, LEFT = 2, RIGHT = 12;
${PARTS}
function frame(f) {
  const base = f.h - 12, top = 26;
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
    name(ctx, 'each note', muted, Math.max(11, peak - 8));
    ctx.fillStyle = track; ctx.fillRect(0, g.base, w, 2);
    ctx.beginPath();
    ctx.moveTo(x0, g.base); ctx.lineTo(x0, peak);
    for (let i = 1; i <= 40; i++) ctx.lineTo(g.xT((decay * i) / 40), at(i / 40));
    ctx.closePath();
    ctx.fillStyle = ink; ctx.fill();
    // A note starts when the output jumps up; the dot rides the slope while it closes.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.start > 0.09) s.start = f.t;
    s.prev = f.level;
    const age = f.t - s.start;
    if (age >= 0 && age < decay) ring(ctx, g.xT(age), at(age / decay), 4, paper, ink, 2);
    const p = f.pointer, hot = s.drag || (p && p.over);
    ring(ctx, end, g.base + 1, hot ? 8 : 6, paper, ink, 3);
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

/** Glide as the pitch's slope from one note to the next, filled; it takes the mouse. */
export const GLIDE_GRAPH = `// Glide (kglide): how long a note slides to the next, filled like the hill: a
// low note, the slide up, the next note. Drag across it: the longer the slope,
// the slower the slide.
const GMAX = 0.3, X0 = 34, RIGHT = 34;
${PARTS}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg'), muted = f.color('muted');
    const glide = f.value('kglide'), lo = h - 10, hi = 24, x1 = Math.max(X0 + 2, X0 + (glide / GMAX) * (w - X0 - RIGHT));
    ctx.clearRect(0, 0, w, h);
    name(ctx, 'glide', muted);
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, lo); ctx.lineTo(X0, lo); ctx.lineTo(x1, hi); ctx.lineTo(w, hi); ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = ink; ctx.fill();
    const p = f.pointer, hot = s.drag || (p && p.over);
    ring(ctx, x1, hi, hot ? 8 : 6, paper, ink, 3);
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

/** The oscillator's wave, saw or square, rounded by Drive, filled; it takes the mouse. */
export const WAVE_GRAPH = `// The wave into the filter: two cycles of saw, or of square while Wave (tsq) is
// on, rounder the harder Drive (kdrive) pushes the filter, filled from the
// middle. The wave is the handle: press and drag, across for the wave (the left
// half saw, the right half square), up for Drive.
const DMAX = 8;
${PARTS}
function frame(f) {
  const top = 24, base = f.h - 4;
  return { top, base, mid: (top + base) / 2, amp: (base - top) / 2 - 1 };
}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, g = frame(f);
    const ink = f.color('accent'), paper = f.color('bg'), fg = f.color('fg'), muted = f.color('muted');
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
    ctx.fillStyle = ink; ctx.fill();
  },
  pointer(e, f) {
    const g = frame(f);
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      if (e.x > f.w / 2 !== f.on('tsq')) f.set('tsq', e.x > f.w / 2);
      f.set('kdrive', 1 + Math.max(0, Math.min(1, (g.base - e.y) / (g.base - g.top))) * (DMAX - 1));
    }
    f.cursor(f.state.drag ? 'grabbing' : 'move');
  },
};
`;

export function acid(catalog: Catalog) {
  const hill = { x: 0, y: 0, w: 528, h: 360 };
  /** One of the hill's settings in figures under it: its name, then its value (text bound to it). */
  const figure = (label: string, bind: string, x: number) => [
    el({
      kind: 'text',
      name: `${label} name`,
      text: label,
      rect: r(x, hill.h + 12, 150, 16),
      textStyle: { size: 12, weight: 700, color: 'muted', align: 'left' },
    }),
    el({
      kind: 'text',
      name: `${label} value`,
      text: '{value}',
      bind,
      rect: r(x, hill.h + 28, 150, 30),
      textStyle: { size: 26, weight: 700, color: 'fg', align: 'left', spacing: -0.01 },
    }),
  ];
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
      // ---- the plugin: a hill on white paper; the graphs are the controls ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#f2f3f8',
            fg: '#0f1240',
            accent: '#1e32d6',
            track: '#d5d9ee',
            knob: '#e4e7f4',
            pointer: '#1e32d6',
            muted: '#4f5784',
            glow: '#1e32d6',
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'lato',
          },
          background: [{ kind: 'color', color: '#f2f3f8' }],
          // The keys in the hill's two colours: paper keys with blue rules, ultramarine sharps; a played key turns the figures' navy.
          css: '[data-widget=keys1] { --dk-key-white: #fbfbfe; --dk-key-black: #1e32d6; --dk-key-line: #b9c0e4; --dk-key-label: #4f5784; --dk-key-down: #0f1240; --dk-key-down-black: #0f1240; --dk-key-down-label: #f2f3f8; }',
        },
      },
      el({
        kind: 'canvas',
        name: 'The filter’s hill',
        code: FILTER_HILL,
        rect: r(hill.x, hill.y, hill.w, hill.h),
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Contour',
        rect: r(548, 14, 188, 50),
        textStyle: { size: 44, weight: 700, color: 'accent', align: 'right', spacing: -0.02 },
      }),
      ...figure('cutoff', 'kcut', 24),
      ...figure('resonance', 'kres', 196),
      ...figure('sweep', 'kenv', 368),
      el({
        kind: 'canvas',
        name: 'Each note',
        code: ENVELOPE_GRAPH,
        rect: r(548, 88, 188, 124),
      }),
      el({ kind: 'canvas', name: 'Glide', code: GLIDE_GRAPH, rect: r(548, 232, 188, 64) }),
      el({ kind: 'canvas', name: 'Wave', code: WAVE_GRAPH, rect: r(548, 316, 188, 100) }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(24, 436, 712, 48), {
        style: { skin: { name: 'piano', params: { octaves: 2, start: 36 } } },
      }),
    ],
  );
}

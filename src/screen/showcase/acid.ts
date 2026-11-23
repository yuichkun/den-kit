// Contour — an acid bass whose filter is a curve you take hold of.
// A mono saw/square bass through a driven ladder filter, with a snappy filter
// envelope and glide. The design follows the thinking of Elektron Overbridge's
// interface (Red Dot: Best of the Best 2016, User Interface Design): no copy of
// a hardware panel, free of rotary wheels and sliders; every setting is a graph
// edited where it is drawn, and nothing hides in menus. The filter's response is
// the screen: drag its peak (across: Cutoff, up: Resonance), and drag the mark on
// the dashed curve (or scroll) for how far each note opens it. The sound's last
// moments of spectrum run under the curve as stacked lines, so what the curve
// does is seen in what plays. Beside it, three small graphs carry the rest: each
// note's filter envelope (two marks), the glide between notes (the pitch's
// slope), and the wave from saw to square, rounded by Drive. Pads in one row play
// an octave of bass notes.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** A diamond mark, the handle shape every Contour graph uses (canvas code, shared by the graphs below). */
const MARK = `function mark(ctx, x, y, r, fill, line) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
}
/** A small label beside a mark, on the background colour so lines under it do not cross it;
 * kept inside the canvas (it flips to the left near the right edge). */
function tag(ctx, text, x, y, w, color, back) {
  ctx.font = '11px ui-monospace, monospace';
  const tw = ctx.measureText(text).width, lx = x + 12 + tw > w ? x - 12 - tw : x + 12, ly = Math.max(11, y);
  ctx.fillStyle = back;
  ctx.fillRect(lx - 3, ly - 11, tw + 6, 15);
  ctx.fillStyle = color;
  ctx.fillText(text, lx, ly);
}
`;

/** The ladder's response from Cutoff and Resonance, over the output's recent spectrum; it takes the mouse. */
export const FILTER_GRAPH = `// The ladder's response, drawn from Cutoff (kcut) and Resonance (kres), over the
// sound's last moments of spectrum: a new line every 60 ms, older lines drift up
// and fade. Drag the peak (or press anywhere): across is the cutoff, up is the
// resonance (the peak follows the hand). Drag the hollow mark on the dashed
// curve across, or scroll: Sweep (kenv), how far each note opens the filter.
const LO = 30, HI = 12000, TOP = 30, BOTTOM = -36, ROWS = 14;
const xOf = (hz, w) => (Math.log(hz / LO) / Math.log(HI / LO)) * w;
const hzOf = (x, w) => LO * Math.pow(HI / LO, Math.min(1, Math.max(0, x / w)));
const yOf = (db, h) => ((TOP - db) / (TOP - BOTTOM)) * h;
const dbOf = (y, h) => TOP - (y / h) * (TOP - BOTTOM);
function gain(hz, fc, k) {
  const x = hz / fc, x2 = x * x;
  const re = 1 - 6 * x2 + x2 * x2 + 4 * k, im = 4 * x - 4 * x * x2;
  return (1 + 4 * k) / Math.sqrt(re * re + im * im);
}
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
  let lo = 0, hi = 0.95;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (peakOf(mid).db < db) lo = mid;
    else hi = mid;
  }
  return lo;
}
function curve(ctx, w, h, fc, k) {
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const db = 20 * Math.log10(gain(hzOf(x, w), fc, k));
    const y = yOf(Math.max(BOTTOM - 8, Math.min(TOP + 8, db)), h);
    if (x) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
}
/** Where the two marks sit: the peak of the response, and the peak of the dashed curve. */
function marks(f) {
  const fc = f.value('kcut'), k = f.value('kres'), pk = peakOf(k);
  const open = Math.min(HI, fc * Math.pow(2, f.value('kenv')));
  const y = yOf(Math.min(TOP, pk.db), f.h);
  return { fc, k, pk, open, px: xOf(fc * pk.at, f.w), ox: Math.min(f.w - 8, xOf(open * pk.at, f.w)), y };
}
${MARK}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: '', hist: [], last: 0 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, m = marks(f);
    const fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted'), track = f.color('track'), bg = f.color('bg');
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = track;
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(xOf(hz, w)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (const db of [24, 12, 0, -12, -24]) {
      const y = Math.round(yOf(db, h)) + 0.5;
      ctx.globalAlpha = db === 0 ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // The sound's own spectrum (64 bands from 96 Hz up, 0..1 is -100..-20 dB), its last moments stacked.
    if (f.t - s.last > 0.06) {
      s.last = f.t;
      s.hist.unshift(Array.from(f.spectrum));
      if (s.hist.length > ROWS) s.hist.pop();
    }
    ctx.strokeStyle = fg;
    for (let row = s.hist.length - 1; row >= 0; row--) {
      const sp = s.hist[row];
      ctx.globalAlpha = 0.36 * (1 - row / ROWS);
      // Each line runs from the first band that sounds to the last, so silence adds no flat lines.
      let i0 = sp.findIndex(v => v >= 0.05), i1 = sp.length - 1;
      while (i1 > i0 && sp[i1] < 0.05) i1--;
      if (i0 < 0) continue;
      ctx.beginPath();
      for (let i = Math.max(0, i0 - 1); i <= Math.min(sp.length - 1, i1 + 1); i++) {
        const x = xOf(96 * Math.pow(250, (i + 0.5) / 64), w);
        const y = h - 2 - sp[i] * h * 0.6 - row * 6;
        if (i > Math.max(0, i0 - 1)) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        if (x > w) break;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Where each note opens it: the dashed curve, and its mark.
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.25;
    curve(ctx, w, h, m.open, m.k);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    mark(ctx, m.ox, m.y, s.drag === 'open' ? 8 : 6, bg, fg);
    tag(ctx, 'sweep', m.ox, m.y - 12, w, muted, bg);
    // The response.
    curve(ctx, w, h, m.fc, m.k);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const p = f.pointer;
    const hot = s.drag === 'peak' || (p && p.over && Math.hypot(p.x - m.px, p.y - m.y) < 24);
    mark(ctx, m.px, m.y, hot ? 11 : 9, accent, bg);
    tag(ctx, 'cutoff · res', m.px, m.y - 14, w, fg, bg);
  },
  pointer(e, f) {
    const s = f.state, m = marks(f);
    const dOpen = Math.hypot(e.x - m.ox, e.y - m.y), nearOpen = dOpen < 16 && dOpen < Math.hypot(e.x - m.px, e.y - m.y);
    if (e.type === 'down') s.drag = nearOpen ? 'open' : 'peak';
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (e.type === 'wheel') f.set('kenv', Math.max(0, Math.min(6, f.value('kenv') - e.dy / 200)));
    else if (s.drag === 'open' && (e.type === 'down' || e.type === 'move'))
      f.set('kenv', Math.max(0, Math.min(6, Math.log2(hzOf(e.x, f.w) / m.pk.at / m.fc))));
    else if (s.drag === 'peak' && (e.type === 'down' || e.type === 'move')) {
      const k = resonanceAt(dbOf(e.y, f.h));
      f.set('kres', k);
      f.set('kcut', Math.max(40, Math.min(4000, hzOf(e.x, f.w) / peakOf(k).at)));
    }
    f.cursor(s.drag === 'peak' ? 'grabbing' : s.drag === 'open' || nearOpen ? 'ew-resize' : 'grab');
  },
};
`;

/** Each note's filter envelope: Sweep is its height, Decay its length; it takes the mouse. */
export const ENVELOPE_GRAPH = `// Each note's filter envelope: how far it opens the filter (Sweep, kenv: drag the
// top mark up or down) and how fast it closes again (Decay, kdec: drag the end
// mark across). Time runs on a square-root scale, so short decays get room.
// A dot runs down the slope each time a note starts (seen in the output level).
const TMAX = 1.2, OMAX = 6, LEFT = 10, RIGHT = 14;
${MARK}
function frame(f) {
  const base = f.h - 16, top = 34;
  return {
    base, top,
    xT: t => LEFT + Math.sqrt(Math.max(0, t) / TMAX) * (f.w - LEFT - RIGHT),
    yO: o => base - (o / OMAX) * (base - top),
  };
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: '', prev: 0, start: -10 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, g = frame(f);
    const accent = f.color('accent'), track = f.color('track'), fg = f.color('fg'), muted = f.color('muted'), bg = f.color('bg');
    const decay = f.value('kdec'), sweep = f.value('kenv');
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = muted;
    ctx.fillText('each note', 0, 11);
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    for (const t of [0.05, 0.1, 0.2, 0.4, 0.8]) {
      const x = Math.round(g.xT(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, g.top - 6); ctx.lineTo(x, g.base); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, g.base + 0.5); ctx.lineTo(w, g.base + 0.5); ctx.stroke();
    const peak = g.yO(sweep), x0 = g.xT(0), end = g.xT(decay);
    const at = u => peak + (g.base - peak) * (1 - (1 - u) * (1 - u));
    ctx.beginPath();
    ctx.moveTo(0, g.base);
    ctx.lineTo(x0, g.base);
    ctx.lineTo(x0, peak);
    for (let i = 1; i <= 40; i++) ctx.lineTo(g.xT((decay * i) / 40), at(i / 40));
    ctx.lineTo(w, g.base);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // A note starts when the output jumps up; the dot rides the slope while it closes.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.start > 0.09) s.start = f.t;
    s.prev = f.level;
    const age = f.t - s.start;
    if (age >= 0 && age < decay) {
      ctx.beginPath();
      ctx.arc(g.xT(age), at(age / decay), 4, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.fill();
    }
    mark(ctx, x0, peak, s.drag === 'sweep' ? 8 : 6, accent, bg);
    tag(ctx, 'sweep', x0, peak - 6, w, fg, bg);
    mark(ctx, end, g.base, s.drag === 'decay' ? 8 : 6, accent, bg);
    tag(ctx, 'decay ' + decay.toFixed(2) + ' s', end, h - 1, w, fg, bg);
  },
  pointer(e, f) {
    const s = f.state, g = frame(f);
    const x0 = g.xT(0), peak = g.yO(f.value('kenv')), end = g.xT(f.value('kdec'));
    const toSweep = Math.hypot(e.x - x0, e.y - peak) < Math.hypot(e.x - end, e.y - g.base);
    if (e.type === 'down') s.drag = toSweep ? 'sweep' : 'decay';
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag === 'sweep' && (e.type === 'down' || e.type === 'move'))
      f.set('kenv', Math.max(0, Math.min(OMAX, ((g.base - e.y) / (g.base - g.top)) * OMAX)));
    if (s.drag === 'decay' && (e.type === 'down' || e.type === 'move')) {
      const u = Math.max(0, Math.min(1, (e.x - LEFT) / (f.w - LEFT - RIGHT)));
      f.set('kdec', Math.max(0.03, Math.min(1.2, u * u * TMAX)));
    }
    f.cursor((s.drag || (toSweep ? 'sweep' : 'decay')) === 'sweep' ? 'ns-resize' : 'ew-resize');
  },
};
`;

/** Glide as the pitch's slope from one note to the next; it takes the mouse. */
export const GLIDE_GRAPH = `// Glide (kglide): how long a note slides to the next. The line is the pitch: a
// low note, then the slide up to the next one. Drag the mark at the top of the
// slide across: the longer the slope, the slower the slide.
const GMAX = 0.3, X0 = 56, RIGHT = 56;
${MARK}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const accent = f.color('accent'), track = f.color('track'), fg = f.color('fg'), muted = f.color('muted'), bg = f.color('bg');
    const glide = f.value('kglide'), span = w - X0 - RIGHT, lo = h - 8, hi = 26;
    const x1 = X0 + (glide / GMAX) * span;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = muted;
    ctx.fillText('glide', 0, 11);
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X0 + 0.5, hi - 8); ctx.lineTo(X0 + 0.5, lo + 4);
    ctx.moveTo(X0 + span + 0.5, hi - 8); ctx.lineTo(X0 + span + 0.5, lo + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, lo);
    ctx.lineTo(X0, lo);
    ctx.lineTo(Math.max(X0 + 1, x1), hi);
    ctx.lineTo(w, hi);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    mark(ctx, x1, hi, s.drag ? 8 : 6, accent, bg);
    tag(ctx, Math.round(glide * 1000) + ' ms', x1, hi + 18, w, fg, bg);
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

/** The oscillator's wave from saw to square, rounded by Drive; it takes the mouse. */
export const WAVE_GRAPH = `// The wave into the filter: Saw to square (kwave) across, Drive (kdrive) up.
// Two cycles of the wave between saw and square, drawn rounder the harder Drive
// pushes the filter. Drag the mark: across for the wave, up for Drive.
const DMAX = 8, PAD = 8;
${MARK}
function frame(f) {
  const top = 22, base = f.h - 16;
  return { top, base, mid: (top + base) / 2, amp: (base - top) / 2 - 2 };
}
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, g = frame(f);
    const accent = f.color('accent'), track = f.color('track'), fg = f.color('fg'), muted = f.color('muted'), bg = f.color('bg');
    const mix = f.value('kwave'), drive = f.value('kdrive');
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = muted;
    ctx.fillText('wave', 0, 11);
    ctx.fillText('saw', 0, h - 1);
    ctx.textAlign = 'right';
    ctx.fillText('square', w, h - 1);
    ctx.textAlign = 'left';
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Math.round(g.mid) + 0.5); ctx.lineTo(w, Math.round(g.mid) + 0.5); ctx.stroke();
    const round = v => Math.tanh(v * drive * 0.5) / Math.tanh(drive * 0.5);
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const ph = ((x / w) * 2) % 1;
      const v = (1 - mix) * (1 - 2 * ph) + mix * (ph < 0.5 ? 1 : -1);
      const y = g.mid - round(v) * g.amp;
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const hx = PAD + mix * (w - 2 * PAD), hy = g.base - ((drive - 1) / (DMAX - 1)) * (g.base - g.top);
    mark(ctx, hx, hy, s.drag ? 8 : 6, fg, bg);
    tag(ctx, 'drive ' + drive.toFixed(1), hx, hy - 8, w, fg, bg);
  },
  pointer(e, f) {
    const g = frame(f);
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      f.set('kwave', Math.max(0, Math.min(1, (e.x - PAD) / (f.w - 2 * PAD))));
      f.set('kdrive', 1 + Math.max(0, Math.min(1, (g.base - e.y) / (g.base - g.top))) * (DMAX - 1));
    }
    f.cursor(f.state.drag ? 'grabbing' : 'move');
  },
};
`;

/** Frequencies printed under the filter graph, where the graph draws their lines. */
const AXIS = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
] as const;

export function acid(catalog: Catalog) {
  const graph = { x: 24, y: 76, w: 480, h: 296 };
  const xOf = (hz: number) => graph.x + (Math.log(hz / 30) / Math.log(12000 / 30)) * graph.w;
  const readout = (label: string, bind: string, x: number) => [
    el({
      kind: 'text',
      name: `${label} label`,
      text: label,
      rect: r(x, 20, 90, 16),
      textStyle: { size: 11, color: 'muted', align: 'left' },
    }),
    el({
      kind: 'text',
      name: `${label} value`,
      text: '{value}',
      bind,
      rect: r(x, 36, 90, 22),
      textStyle: { font: 'jetbrains-mono', size: 16, color: 'fg', align: 'left' },
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
      ...patchControl('kres', 'Resonance', 'ladder1.resonance', [0, 0.95, 'linear', ''], 0.72),
      ...patchControl('kenv', 'Sweep', 'envamt1.b', [0, 6, 'linear', 'oct'], 3.4),
      ...patchControl('kdec', 'Decay', 'fenv1.decay', [0.03, 1.2, 'log', 's'], 0.2),
      ...patchControl('kglide', 'Glide', 'glide1.seconds', [0, 0.3, 'linear', 's'], 0.06),
      ...patchControl('kdrive', 'Drive', 'ladder1.drive', [1, 8, 'linear', ''], 2.2),
      ...patchControl('kwave', 'Saw to square', 'wave1.mix', [0, 1, 'linear', ''], 0),
      // ---- the plugin: the graphs are the controls ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#121417',
            fg: '#eceff1',
            accent: '#ff7d45',
            track: '#262a2f',
            knob: '#1b1e22',
            pointer: '#ffffff',
            muted: '#8d959d',
            glow: '#ff7d45',
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#121417' }],
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Contour',
        rect: r(24, 14, 260, 44),
        textStyle: { font: 'jetbrains-mono', size: 30, weight: 700, color: 'fg', align: 'left' },
      }),
      ...readout('cutoff', 'kcut', 466),
      ...readout('resonance', 'kres', 556),
      ...readout('sweep', 'kenv', 646),
      el({
        kind: 'canvas',
        name: 'Filter response',
        code: FILTER_GRAPH,
        rect: r(graph.x, graph.y, graph.w, graph.h),
      }),
      ...AXIS.map(([hz, text]) =>
        el({
          kind: 'text',
          name: `${text} Hz mark`,
          text,
          rect: r(Math.round(xOf(hz)) - 20, graph.y + graph.h + 4, 40, 14),
          textStyle: { font: 'jetbrains-mono', size: 10, color: 'muted', align: 'center' },
        }),
      ),
      el({
        kind: 'canvas',
        name: 'Each note',
        code: ENVELOPE_GRAPH,
        rect: r(524, 76, 212, 140),
      }),
      el({ kind: 'canvas', name: 'Glide', code: GLIDE_GRAPH, rect: r(524, 228, 212, 56) }),
      el({ kind: 'canvas', name: 'Wave', code: WAVE_GRAPH, rect: r(524, 296, 212, 76) }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(24, 410, 712, 66), {
        style: {
          skin: {
            name: 'pads',
            params: {
              count: 13,
              columns: 13,
              start: 36,
              scale: 'chromatic',
              colors: 'outline',
              press: 'sink',
              radius: 6,
              gap: 6,
            },
          },
        },
      }),
    ],
  );
}

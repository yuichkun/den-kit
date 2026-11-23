// Contour — an acid bass whose filter is a curve you take hold of.
// A mono saw/square bass through a driven ladder filter, with a snappy filter
// envelope and glide. The design follows the thinking of Elektron Overbridge's
// interface (Red Dot: Best of the Best 2016, User Interface Design): no copy of
// a hardware panel; frequencies are graphs edited where they are drawn, and
// nothing hides in menus. The filter's response is the screen: drag its peak
// (across: Cutoff, up: Resonance), scroll for how far each note opens it; the
// envelope is a second graph dragged the same way. The sound's own spectrum
// runs under the curve, so what the curve does is seen in what plays.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The ladder's response from Cutoff and Resonance, over the output's spectrum; it takes the mouse. */
export const FILTER_GRAPH = `// The ladder's response, drawn from Cutoff (kcut) and Resonance (kres), over the
// sound's own spectrum. Press or drag: across is the cutoff, up is the resonance
// (the peak follows the hand). Scroll: Sweep (kenv), how far each note opens it,
// drawn as the dashed curve and the span along the floor.
const LO = 30, HI = 12000, TOP = 30, BOTTOM = -36;
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
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h;
    const fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted'), track = f.color('track');
    const fc = f.value('kcut'), k = f.value('kres'), sweep = f.value('kenv');
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
    // The sound's own spectrum: 64 bands from 96 Hz up, 0..1 is -100..-20 dB.
    ctx.beginPath();
    ctx.moveTo(xOf(96, w), h);
    for (let i = 0; i < f.spectrum.length; i++) {
      const x = xOf(96 * Math.pow(250, (i + 0.5) / 64), w);
      ctx.lineTo(x, h - f.spectrum[i] * h * 0.85);
      if (x > w) break;
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = muted;
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Where each note opens it: the curve at the top of the sweep, and the span along the floor.
    const open = Math.min(HI, fc * Math.pow(2, sweep));
    const xa = xOf(fc, w), xb = xOf(open, w);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.25;
    curve(ctx, w, h, open, k);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(xa, h - 5, Math.max(0, xb - xa), 5);
    ctx.globalAlpha = 1;
    ctx.fillRect(xb - 1, h - 12, 2, 12);
    // The response, filled below its line.
    curve(ctx, w, h, fc, k);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    curve(ctx, w, h, fc, k);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // The handle on the peak.
    const pk = peakOf(k);
    const px = xOf(fc * pk.at, w), py = yOf(Math.min(TOP, pk.db), h);
    const p = f.pointer;
    const hot = f.state.drag || (p && p.over && Math.hypot(p.x - px, p.y - py) < 24);
    ctx.beginPath();
    ctx.arc(px, py, hot ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = f.color('bg');
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  },
  pointer(e, f) {
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (e.type === 'wheel') f.set('kenv', Math.max(0, Math.min(6, f.value('kenv') - e.dy / 200)));
    else if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      const k = resonanceAt(dbOf(e.y, f.h));
      f.set('kres', k);
      f.set('kcut', Math.max(40, Math.min(4000, hzOf(e.x, f.w) / peakOf(k).at)));
    }
    f.cursor(f.state.drag ? 'grabbing' : 'grab');
  },
};
`;

/** The filter envelope as a shape: Sweep is its height, Decay its length; it takes the mouse. */
export const ENVELOPE_GRAPH = `// The filter envelope: how far each note opens the filter (Sweep, kenv, up)
// and how fast it closes again (Decay, kdec, across). Press or drag to set both.
// A dot runs down the slope each time a note starts (seen in the output level).
const TMAX = 1.4, OMAX = 6, PAD = 10;
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: false, prev: 0, start: -10 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const accent = f.color('accent'), track = f.color('track'), fg = f.color('fg');
    const decay = f.value('kdec'), sweep = f.value('kenv');
    const base = h - PAD, top = PAD + 6;
    const xT = t => (t / TMAX) * w;
    const yO = o => base - (o / OMAX) * (base - top);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    for (let t = 0.25; t < TMAX; t += 0.25) {
      const x = Math.round(xT(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top - 6); ctx.lineTo(x, base); ctx.stroke();
    }
    for (const o of [0, 2, 4, 6]) {
      const y = Math.round(yO(o)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const peak = yO(sweep), end = xT(decay);
    ctx.beginPath();
    ctx.moveTo(0, base); ctx.lineTo(2, peak); ctx.lineTo(end, base); ctx.closePath();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, base); ctx.lineTo(2, peak); ctx.lineTo(end, base); ctx.lineTo(w, base);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // A note starts when the output jumps up; the dot rides the slope while it closes.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.start > 0.09) s.start = f.t;
    s.prev = f.level;
    const age = f.t - s.start;
    if (age >= 0 && age < decay) {
      const x = 2 + (end - 2) * (age / decay), y = peak + (base - peak) * (age / decay);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = fg; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(end, base, 5, 0, Math.PI * 2);
    ctx.fillStyle = f.color('bg'); ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  },
  pointer(e, f) {
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      const base = f.h - PAD, top = PAD + 6;
      f.set('kdec', Math.max(0.03, Math.min(1.2, (e.x / f.w) * TMAX)));
      f.set('kenv', Math.max(0, Math.min(OMAX, ((base - e.y) / (base - top)) * OMAX)));
    }
    f.cursor(f.state.drag ? 'grabbing' : 'crosshair');
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
] as const;

export function acid(catalog: Catalog) {
  const graph = { x: 24, y: 92, w: 480, h: 236 };
  const xOf = (hz: number) => graph.x + (Math.log(hz / 30) / Math.log(12000 / 30)) * graph.w;
  const caption = (text: string, x: number, y: number, w: number) =>
    el({
      kind: 'text',
      name: `${text} caption`,
      text,
      rect: r(x, y, w, 14),
      textStyle: { size: 10, weight: 700, color: 'muted', align: 'left', spacing: 0.16, case: 'upper' },
    });
  const readout = (label: string, bind: string, x: number) => [
    caption(label, x, 22, 92),
    el({
      kind: 'text',
      name: `${label} value`,
      text: '{value}',
      bind,
      rect: r(x, 38, 90, 22),
      textStyle: { font: 'jetbrains-mono', size: 16, color: 'fg', align: 'left' },
    }),
  ];
  const row = { skin: { name: 'bar', params: { radius: 2, label: 'top' } } };
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
      // The filter's controls live in the patch, off the plugin: the graphs move them.
      ...patchControl('kcut', 'Cutoff', 'cut1.hz', [40, 4000, 'log', 'Hz'], 340),
      ...patchControl('kres', 'Resonance', 'ladder1.resonance', [0, 0.95, 'linear', ''], 0.72),
      ...patchControl('kenv', 'Sweep', 'envamt1.b', [0, 6, 'linear', 'oct'], 3.4),
      ...patchControl('kdec', 'Decay', 'fenv1.decay', [0.03, 1.2, 'log', 's'], 0.2),
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
          skins: {
            slider: { name: 'bar', params: { radius: 2, label: 'top' } },
            keyboard: { name: 'piano', params: { octaves: 3, start: 36, lit: '#ff7d45' } },
          },
          css: [
            'dk-slider { position: relative; }',
            'dk-slider::part(label) { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--dk-muted); }',
            'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 12px; color: var(--dk-fg); }',
            'dk-slider::part(track) { max-height: 6px; margin-top: 6px; }',
            '[data-widget=keys1] { --dk-key-white: #1f2328; --dk-key-black: #0c0e10; --dk-key-line: #2e3339; --dk-key-label: #8d959d; --dk-key-down-label: #121417; }',
          ].join('\n'),
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Contour',
        rect: r(24, 18, 200, 30),
        textStyle: { size: 24, weight: 700, color: 'fg', align: 'left' },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'Acid bass. Drag the peak; scroll for how far each note opens it.',
        rect: r(24, 50, 420, 16),
        textStyle: { size: 12, color: 'muted', align: 'left' },
      }),
      ...readout('Cutoff', 'kcut', 466),
      ...readout('Resonance', 'kres', 556),
      ...readout('Sweep', 'kenv', 646),
      el({
        kind: 'shape',
        shape: 'line',
        name: 'Rule',
        rect: r(24, 76, 712, 1),
        locked: true,
        style: { stroke: { color: '#ffffff14', width: 1, style: 'solid' } },
      }),
      caption('Filter', 24, 84 - 2, 120),
      el({ kind: 'canvas', name: 'Filter response', code: FILTER_GRAPH, rect: r(graph.x, graph.y, graph.w, graph.h) }),
      ...AXIS.map(([hz, text]) =>
        el({
          kind: 'text',
          name: `${text} Hz mark`,
          text,
          rect: r(Math.round(xOf(hz)) - 20, graph.y + graph.h + 4, 40, 14),
          textStyle: { font: 'jetbrains-mono', size: 10, color: 'muted', align: 'center' },
        }),
      ),
      caption('Envelope', 524, 84 - 2, 120),
      el({ kind: 'canvas', name: 'Filter envelope', code: ENVELOPE_GRAPH, rect: r(524, 92, 212, 120) }),
      ...control('kglide', 'ui.slider', 'Glide', 'glide1.seconds', r(524, 226, 212, 34), {
        min: 0,
        max: 0.3,
        unit: 's',
        value: 0.06,
        style: row,
      }),
      ...control('kdrive', 'ui.slider', 'Drive', 'ladder1.drive', r(524, 266, 212, 34), {
        min: 1,
        max: 8,
        value: 2.2,
        style: row,
      }),
      ...control('kwave', 'ui.slider', 'Saw to square', 'wave1.mix', r(524, 306, 212, 34), {
        min: 0,
        max: 1,
        value: 0,
        style: row,
      }),
      ...control('keys1', 'ui.keyboard', 'Keys', null, r(24, 368, 712, 108)),
    ],
  );
}

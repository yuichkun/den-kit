// Low Res — a lo-fi effect: fewer bits, a slower sample rate, a wobble, some hiss.
// A codebox crushes the sound (holds a sample `rate` times a second, rounds it
// to `bits`), a short modulated delay makes it waver like a stretched tape, a
// lowpass dulls it and hiss is mixed in.
// The design follows the thinking of the NieR:Automata UI design team's work
// (CEDEC AWARDS 2018, Visual Arts, top prize): flat design as the base, with
// motion and a sense of material to make an inorganic world feel present, and
// detail worked out down to the thin rules and small type. The display is the
// crusher at work: the output snapped to the grid the codebox rounds and holds
// to (rows: the levels Bits leaves, columns: the samples Rate keeps), with
// what the crushing adds filled in.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

export const CRUSHER = `import { defineSubgraph, f32, select, state, type Node } from '@unworklet/core';

// Lo-fi: hold a new sample \`rate\` times a second, rounded to \`bits\` bits.
export default defineSubgraph((config: { sampleRate: number }) => {
  const phase = state.f32(0).named('phase');
  const heldL = state.f32(0).named('heldL');
  const heldR = state.f32(0).named('heldR');
  return {
    tick(i: { left: Node<'f32'>; right: Node<'f32'>; bits: Node<'f32'>; rate: Node<'f32'> }) {
      const next = phase.read().add(i.rate.clamp(100, config.sampleRate).div(config.sampleRate));
      const take = next.gte(1);
      phase.write(select(take, next.sub(1), next));
      const steps = f32(2).pow(i.bits.clamp(2, 16).sub(1));
      const crush = (x: Node<'f32'>) => x.mul(steps).add(0.5).floor().div(steps);
      const left = select(take, crush(i.left), heldL.read());
      const right = select(take, crush(i.right), heldR.read());
      heldL.write(left);
      heldR.write(right);
      return { left, right };
    },
  };
});
`;

/** The crusher at work, and its control: the output on the grid of levels (Bits) and held samples (Rate). */
export const CRUSH_GRID = `// The output wave on the crusher's grid, and the crusher's control. Columns
// are the samples Rate (frate) keeps, drawn when at least 4 px apart; rows the
// levels Bits (fbits) allows, drawn when at least 5 px apart. f.wave is 256
// points taken from the last 2048 samples of the output (every 8th, about
// 43 ms at 48 kHz), so a kept sample lasts SR / rate / 8 points. The wave is
// zoomed to fit the box (grid and all: its loudest point of about the last
// second reaches 90% of the half height) and snapped to the grid, held and then
// rounded as the codebox does; each kept sample is a small square. Press or
// drag: across is Rate (log, 1.5 to 48 kHz), up is Bits (2 to 16), the same
// ranges as the two controls; the handle shows where they are.
const SR = 48000, PER_POINT = 2048 / 256;
const RMIN = 1500, RMAX = 48000, BMIN = 2, BMAX = 16;
export default {
  setup(ctx, f) {
    f.state.drag = false;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, mid = h / 2, n = f.wave.length, dx = w / (n - 1);
    let top = 0;
    for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(f.wave[i]));
    // Zoomed to fit: the loudest point of the last second or so reaches 90% of the half height (at most 24 times).
    const peak = Math.max(top, (f.state.top ?? top) * Math.exp(-f.dt / 1.5));
    f.state.top = peak;
    const zoom = Math.min(24, 0.9 / Math.max(peak, 1e-4));
    const amp = mid * zoom;
    const fg = f.color('fg'), accent = f.color('accent'), track = f.color('track'), muted = f.color('muted');
    const bits = Math.max(BMIN, Math.min(BMAX, f.value('fbits')));
    const rate = Math.max(RMIN, Math.min(RMAX, f.value('frate')));
    const steps = Math.pow(2, bits - 1);
    const hold = SR / rate / PER_POINT;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = track;
    // Rows: the levels Bits allows.
    const rowGap = amp / steps;
    if (rowGap >= 5) {
      for (let k = -steps; k <= steps; k++) {
        const y = Math.round(mid - k * rowGap) + 0.5;
        if (y < 0 || y > h) continue;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }
    // Columns: one per kept sample.
    if (hold * dx >= 4) {
      for (let x = 0; x < w; x += hold * dx) {
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      }
    }
    ctx.fillStyle = muted;
    ctx.fillRect(0, Math.round(mid), w, 1);
    // The wave snapped: held for \`hold\` points, rounded to the levels.
    const ys = new Float32Array(n), kept = [];
    let held = 0, next = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) { held = Math.round(f.wave[i] * steps) / steps; next += hold; kept.push(i); }
      ys[i] = Math.max(1, Math.min(h - 1, mid - held * amp));
    }
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(0, ys[0]);
    for (let i = 1; i < n; i++) {
      if (ys[i] !== ys[i - 1]) { ctx.lineTo(i * dx, ys[i - 1]); ctx.lineTo(i * dx, ys[i]); }
    }
    ctx.lineTo(w, ys[n - 1]);
    ctx.stroke();
    if (hold * dx >= 4) {
      ctx.fillStyle = accent;
      for (const i of kept) ctx.fillRect(Math.round(i * dx) - 2, Math.round(ys[i]) - 2, 4, 4);
    }
    // The handle: where Rate (across) and Bits (up) are.
    const hx = (Math.log(rate / RMIN) / Math.log(RMAX / RMIN)) * w;
    const hy = (1 - (bits - BMIN) / (BMAX - BMIN)) * h;
    const p = f.pointer;
    const hot = f.state.drag || (p && p.over && Math.hypot(p.x - hx, p.y - hy) < 28);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(Math.round(hx), 1, 1, h - 2);
    ctx.fillRect(1, Math.round(hy), w - 2, 1);
    ctx.globalAlpha = 1;
    const s = hot ? 12 : 9;
    ctx.fillRect(Math.round(hx - s / 2), Math.round(hy - s / 2), s, s);
    ctx.fillStyle = f.color('bg');
    ctx.fillRect(Math.round(hx - 2), Math.round(hy - 2), 4, 4);
    const label = (rate / 1000).toFixed(1) + ' kHz  ' + Math.round(bits) + ' bit';
    ctx.font = '11px ui-monospace, monospace';
    const tw = label.length * 6.7; // monospace at 11 px
    const lx = hx + 12 + tw + 8 > w ? hx - 12 - tw - 8 : hx + 12;
    const ly = hy - 22 < 2 ? hy + 8 : hy - 22;
    ctx.fillStyle = fg;
    ctx.fillRect(Math.round(lx), Math.round(ly), Math.round(tw + 8), 15);
    ctx.fillStyle = f.color('bg');
    ctx.textBaseline = 'middle';
    ctx.fillText(label, Math.round(lx + 4), Math.round(ly + 8));
    // The corner marks.
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.5;
    const c = 12;
    for (const [x, y, ax, ay] of [[1, 1, 1, 1], [w - 1, 1, -1, 1], [1, h - 1, 1, -1], [w - 1, h - 1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + ay * c); ctx.lineTo(x, y); ctx.lineTo(x + ax * c, y); ctx.stroke();
    }
  },
  pointer(e, f) {
    if (e.type === 'down') f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      f.setNorm('frate', Math.min(1, Math.max(0, e.x / f.w)));
      const ny = Math.min(1, Math.max(0, 1 - e.y / f.h));
      f.set('fbits', Math.round(BMIN + ny * (BMAX - BMIN)));
    }
    f.cursor(f.state.drag ? 'grabbing' : 'crosshair');
  },
};
`;

/** Wobble, Hiss and Tone as numbers on tick rulers: press or drag along a ruler to set it. */
export const TAPE_RULERS = `// Three rulers, one under each of the numbers Wobble (fwob), Hiss (fhiss) and
// Tone (ftone), BLOCK px apart. 33 ticks, a long one every 8; the red mark is
// the setting. Press or drag across a block: the mark goes to the hand.
const IDS = ['fwob', 'fhiss', 'ftone'], BLOCK = 96, RULER = 56, PAD = 4;
export default {
  setup(ctx, f) {
    f.state.drag = -1;
  },
  draw(ctx, f) {
    const w = f.w, fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted');
    ctx.clearRect(0, 0, w, f.h);
    const p = f.pointer;
    for (let b = 0; b < IDS.length; b++) {
      const y = b * BLOCK + RULER, span = w - PAD * 2;
      const hot = f.state.drag === b || (p && p.over && Math.floor(p.y / BLOCK) === b);
      ctx.fillStyle = hot ? fg : muted;
      ctx.fillRect(PAD, y + 8, span, 1);
      for (let k = 0; k <= 32; k++) {
        const x = Math.round(PAD + (span * k) / 32), long = k % 8 === 0;
        ctx.fillRect(x, y + (long ? 0 : 4), 1, long ? 8 : 4);
      }
      const mx = Math.round(PAD + span * f.norm(IDS[b]));
      ctx.fillStyle = accent;
      ctx.fillRect(PAD, y + 7, mx - PAD, 3);
      ctx.fillRect(mx - 1, y - 4, 3, 16);
    }
  },
  pointer(e, f) {
    const b = Math.floor(e.y / BLOCK);
    if (e.type === 'down' && b >= 0 && b < IDS.length) f.state.drag = b;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = -1;
    const d = f.state.drag;
    if (d >= 0 && (e.type === 'down' || e.type === 'move'))
      f.setNorm(IDS[d], Math.min(1, Math.max(0, (e.x - PAD) / (f.w - PAD * 2))));
    f.cursor(d >= 0 ? 'grabbing' : 'ew-resize');
  },
};
`;

/** A field of fine dots behind everything: the material the screen is printed on. */
export const DOT_FIELD = `// Fine dots in rows, every 6 px; a slow band of slightly larger dots drifts
// down the screen, so the surface is never quite still.
export default {
  draw(ctx, f) {
    const w = f.w, h = f.h, band = ((f.t * 18) % (h + 120)) - 60;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = f.color('track');
    for (let y = 3; y < h; y += 6)
      for (let x = 3; x < w; x += 6) {
        const near = Math.max(0, 1 - Math.abs(y - band) / 60);
        const r = 0.6 + near * 0.5;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
  },
};
`;

export function lofi(catalog: Catalog) {
  const mono = (size: number, color: string) => ({
    font: 'jetbrains-mono',
    size,
    color,
    align: 'left' as const,
  });
  return work(
    'lofi',
    'Low Res',
    catalog,
    [720, 452],
    [
      // ---- sound ----
      add('in1', 'kit.audioIn'),
      add('crush1', 'kit.codebox', {
        label: 'Crusher',
        code: CRUSHER,
        ports: {
          inputs: [
            { id: 'left', type: 'signal' },
            { id: 'right', type: 'signal' },
            { id: 'bits', type: 'signal' },
            { id: 'rate', type: 'signal' },
          ],
          outputs: [
            { id: 'left', type: 'signal' },
            { id: 'right', type: 'signal' },
          ],
        },
        values: { bits: 8, rate: 11025 },
      }),
      add('wobble1', 'den.delayFx', {
        label: 'Wobble',
        config: { maxDelaySeconds: 0.05, tone: 'flat', stereoPhaseCycles: 0.1 },
        values: {
          timeLeftSeconds: 0.012,
          timeRightSeconds: 0.012,
          feedback: 0,
          mix: 1,
          rateHz: 0.62,
          depthSeconds: 0.0015,
        },
      }),
      add('tonel1', 'den.filter', { label: 'Tone L', values: { cutoff: 5200, resonance: 0.6 } }),
      add('toner1', 'den.filter', { label: 'Tone R', values: { cutoff: 5200, resonance: 0.6 } }),
      add('noisel1', 'den.seededNoise', { label: 'Hiss L', config: { seed: 11 } }),
      add('noiser1', 'den.seededNoise', { label: 'Hiss R', config: { seed: 4242 } }),
      add('hpl1', 'den.stateVariableFilter', {
        label: 'Hiss tone L',
        values: { cutoffHz: 3200, q: 0.7 },
      }),
      add('hpr1', 'den.stateVariableFilter', {
        label: 'Hiss tone R',
        values: { cutoffHz: 3200, q: 0.7 },
      }),
      add('mixl1', 'kit.mix', {
        label: 'Mix L',
        config: { channels: 2 },
        values: { level1: 1, level2: 0.012 },
      }),
      add('mixr1', 'kit.mix', {
        label: 'Mix R',
        config: { channels: 2 },
        values: { level1: 1, level2: 0.012 },
      }),
      add('out1', 'kit.out'),
      wire('in1.left', 'crush1.left'),
      wire('in1.right', 'crush1.right'),
      wire('crush1.left', 'wobble1.left'),
      wire('crush1.right', 'wobble1.right'),
      wire('wobble1.left', 'tonel1.input'),
      wire('wobble1.right', 'toner1.input'),
      wire('noisel1.out', 'hpl1.input'),
      wire('noiser1.out', 'hpr1.input'),
      wire('tonel1.out', 'mixl1.in1'),
      wire('hpl1.highpass', 'mixl1.in2'),
      wire('toner1.out', 'mixr1.in1'),
      wire('hpr1.highpass', 'mixr1.in2'),
      wire('mixl1.out', 'out1.left'),
      wire('mixr1.out', 'out1.right'),
      // ---- the plugin: the crusher's grid is its control; the tape's numbers beside it ----
      ...patchControl('fbits', 'bits', 'crush1.bits', [2, 16, 'linear', ''], 8),
      ...patchControl('frate', 'rate', 'crush1.rate', [1500, 48000, 'log', 'Hz'], 11025),
      ...patchControl('fwob', 'wobble', 'wobble1.depthSeconds', [0, 0.005, 'linear', 's'], 0.0015),
      ...patchControl(
        'fhiss',
        'hiss',
        ['mixl1.level2', 'mixr1.level2'],
        [0, 0.06, 'linear', ''],
        0.012,
      ),
      ...patchControl(
        'ftone',
        'tone',
        ['tonel1.cutoff', 'toner1.cutoff'],
        [900, 14000, 'log', 'Hz'],
        5200,
      ),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#dedacf',
            fg: '#24231f',
            accent: '#c4472c',
            track: '#c9c4b6',
            knob: '#ece9e1',
            pointer: '#24231f',
            muted: '#58554c',
            glow: '#c4472c',
            font: 'jetbrains-mono',
            labelFont: 'jetbrains-mono',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#dedacf' }],
          skins: {
            meter: { name: 'bar', params: { fill: 'accent', surface: 'track', scale: false } },
          },
          css: 'dk-scope::part(canvas) { border-radius: 0; }',
        },
      },
      el({ kind: 'canvas', name: 'Surface', code: DOT_FIELD, rect: r(0, 0, 720, 452) }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Display',
        rect: r(24, 24, 480, 340),
        locked: true,
        style: { fill: [{ kind: 'color', color: '#ebe8e0' }] },
      }),
      el({ kind: 'canvas', name: 'The grid', code: CRUSH_GRID, rect: r(24, 24, 480, 340) }),
      el({
        kind: 'text',
        name: 'Rate axis',
        text: '◀ rate {value} ▶',
        bind: 'frate',
        rect: r(24, 372, 240, 14),
        textStyle: mono(11, 'muted'),
      }),
      el({
        kind: 'text',
        name: 'Bits axis',
        text: '▲ bits ▼',
        rect: r(264, 372, 240, 14),
        textStyle: { ...mono(11, 'muted'), align: 'right' },
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'LOW / RES',
        rect: r(24, 400, 240, 30),
        textStyle: { ...mono(24, 'fg'), weight: 700, spacing: 0.3 },
      }),
      el({
        kind: 'text',
        name: 'Description',
        text: 'fewer bits, a slower rate, a wobble, some hiss',
        rect: r(264, 410, 432, 14),
        textStyle: { ...mono(11, 'muted'), align: 'right' },
      }),
      ...[
        ['wobble', 'fwob', 'how far the tape wavers'],
        ['hiss', 'fhiss', 'noise under it'],
        ['tone', 'ftone', 'where it dulls'],
      ].flatMap(([label, id, about], i) => [
        el({
          kind: 'text',
          name: `${label} label`,
          text: `■ ${label}`,
          rect: r(528, 24 + i * 96, 168, 14),
          textStyle: { ...mono(11, 'fg'), weight: 700, spacing: 0.12 },
        }),
        el({
          kind: 'text',
          name: `${label} value`,
          text: '{value}',
          bind: id,
          rect: r(528, 40 + i * 96, 168, 28),
          textStyle: mono(22, 'fg'),
        }),
        el({
          kind: 'text',
          name: `${label} about`,
          text: about!,
          rect: r(528, 98 + i * 96, 168, 14),
          textStyle: mono(10, 'muted'),
        }),
      ]),
      el({ kind: 'canvas', name: 'Tape rulers', code: TAPE_RULERS, rect: r(528, 24, 168, 288) }),
      el({
        kind: 'text',
        name: 'Out label',
        text: '■ out',
        rect: r(528, 330, 168, 14),
        textStyle: { ...mono(11, 'fg'), weight: 700, spacing: 0.12 },
      }),
      ...control('outm1', 'ui.meter', 'out', null, r(528, 352, 168, 8)),
      wire('mixl1.out', 'outm1.in'),
    ],
  );
}

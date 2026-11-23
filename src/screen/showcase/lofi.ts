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
import { add, control, el, r, wire, work } from './build.ts';

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

/** The crusher at work: the output on the grid of levels (Bits) and held samples (Rate). */
export const CRUSH_GRID = `// The output wave (256 samples, about 5 ms) on the crusher's grid: rows are the
// levels Bits (fbits) leaves (drawn when they are far enough apart to see),
// columns the samples Rate (frate) keeps. The wave is snapped to that grid
// (held, then rounded, as the codebox does) and what that adds is filled in.
// Quiet sound is zoomed in (up to 16 times, eased), grid and all, so the steps
// stay in view. A thin scan line sweeps across, and corner marks frame it.
const SR = 48000;
export default {
  draw(ctx, f) {
    let top = 0;
    for (let i = 0; i < f.wave.length; i++) top = Math.max(top, Math.abs(f.wave[i]));
    const want = Math.min(16, Math.max(1, 0.8 / Math.max(top, 1e-3)));
    const zoom = (f.state.zoom ?? want) + (want - (f.state.zoom ?? want)) * Math.min(1, f.dt * 3);
    f.state.zoom = zoom;
    const w = f.w, h = f.h, mid = h / 2, amp = h * 0.42 * zoom;
    const fg = f.color('fg'), muted = f.color('muted'), accent = f.color('accent'), track = f.color('track');
    const bits = Math.max(2, Math.min(16, f.value('fbits')));
    const rate = Math.max(100, f.value('frate'));
    const steps = Math.pow(2, bits - 1);
    const hold = SR / rate, n = f.wave.length, dx = w / (n - 1);
    ctx.clearRect(0, 0, w, h);
    // Rows: the levels left, when at least 5 px apart.
    const rowGap = amp / steps;
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    if (rowGap >= 5) {
      for (let k = -steps; k <= steps; k++) {
        const y = Math.round(mid - k * rowGap) + 0.5;
        if (y < 0 || y > h) continue;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }
    // Columns: one per kept sample, when at least 4 px apart.
    if (hold * dx >= 4) {
      ctx.globalAlpha = 0.6;
      for (let x = 0; x < w; x += hold * dx) {
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = muted;
    ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(w, mid + 0.5); ctx.stroke();
    // The wave snapped: held for \`hold\` samples, rounded to the levels.
    const snapped = new Float32Array(n);
    let held = 0, next = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) { held = Math.round(f.wave[i] * steps) / steps; next += hold; }
      snapped[i] = held;
    }
    // What the crushing adds: between the wave and its snapped copy.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(i * dx, mid - f.wave[i] * amp);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(i * dx, mid - snapped[i] * amp);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(i * dx, mid - f.wave[i] * amp);
    ctx.stroke();
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * dx, y = mid - snapped[i] * amp;
      if (i === 0) ctx.moveTo(x, y);
      else { ctx.lineTo(x, mid - snapped[i - 1] * amp); ctx.lineTo(x, y); }
    }
    ctx.stroke();
    // The scan line, and the corner marks.
    const sx = ((f.t * 0.25) % 1) * w;
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(Math.round(sx), 0, 1, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.5;
    const c = 12;
    for (const [x, y, ax, ay] of [[1, 1, 1, 1], [w - 1, 1, -1, 1], [1, h - 1, 1, -1], [w - 1, h - 1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + ay * c); ctx.lineTo(x, y); ctx.lineTo(x + ax * c, y); ctx.stroke();
    }
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
  const row = { skin: { name: 'bar', params: { radius: 0, label: 'top' } } };
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
      // ---- the plugin: the crusher's grid, and the settings beside it ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#dcddd8',
            fg: '#272926',
            accent: '#c4472c',
            track: '#c3c5bf',
            knob: '#eeefeb',
            pointer: '#272926',
            muted: '#4a4c47',
            glow: '#c4472c',
            font: 'jetbrains-mono',
            labelFont: 'jetbrains-mono',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#dcddd8' }],
          skins: { slider: { name: 'bar', params: { radius: 0, label: 'top' } } },
          css: [
            'dk-slider { position: relative; }',
            'dk-slider::part(label) { text-align: left; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: var(--dk-muted); }',
            'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 11px; color: var(--dk-fg); }',
            'dk-slider::part(track) { max-height: 3px; margin-top: 8px; }',
          ].join('\n'),
        },
      },
      el({ kind: 'canvas', name: 'Surface', code: DOT_FIELD, rect: r(0, 0, 720, 452) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'LOW / RES',
        rect: r(24, 20, 300, 28),
        textStyle: { ...mono(20, 'fg'), weight: 700, spacing: 0.3 },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'fewer bits, a slower rate, a wobble, some hiss',
        rect: r(24, 50, 420, 16),
        textStyle: mono(11, 'muted'),
      }),
      el({
        kind: 'text',
        name: 'Unit',
        text: 'CRUSHER / CODEBOX',
        rect: r(480, 26, 216, 14),
        textStyle: { ...mono(10, 'muted'), align: 'right', spacing: 0.2 },
      }),
      el({
        kind: 'shape',
        shape: 'line',
        name: 'Rule',
        rect: r(24, 74, 672, 1),
        locked: true,
        style: { stroke: { color: '#272926', width: 1, style: 'solid' } },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Display',
        rect: r(24, 92, 432, 300),
        locked: true,
        style: { fill: [{ kind: 'color', color: '#e7e8e4' }] },
      }),
      el({ kind: 'canvas', name: 'The grid', code: CRUSH_GRID, rect: r(24, 92, 432, 300) }),
      el({
        kind: 'text',
        name: 'Display caption',
        text: 'OUT, ZOOMED TO FIT, ON THE GRID  /  5 MS',
        rect: r(24, 400, 432, 14),
        textStyle: { ...mono(10, 'muted'), spacing: 0.12 },
      }),
      el({
        kind: 'text',
        name: 'Settings caption',
        text: '01  CRUSH',
        rect: r(480, 92, 216, 14),
        textStyle: { ...mono(10, 'fg'), weight: 700, spacing: 0.2 },
      }),
      ...control('fbits', 'ui.slider', 'bits', 'crush1.bits', r(480, 116, 216, 34), {
        min: 2,
        max: 16,
        value: 8,
        style: row,
      }),
      ...control('frate', 'ui.slider', 'rate', 'crush1.rate', r(480, 160, 216, 34), {
        min: 1500,
        max: 48000,
        scale: 'log',
        unit: 'Hz',
        value: 11025,
        style: row,
      }),
      el({
        kind: 'text',
        name: 'Tape caption',
        text: '02  TAPE',
        rect: r(480, 222, 216, 14),
        textStyle: { ...mono(10, 'fg'), weight: 700, spacing: 0.2 },
      }),
      ...control('fwob', 'ui.slider', 'wobble', 'wobble1.depthSeconds', r(480, 246, 216, 34), {
        min: 0,
        max: 0.005,
        unit: 's',
        value: 0.0015,
        style: row,
      }),
      ...control('fhiss', 'ui.slider', 'hiss', ['mixl1.level2', 'mixr1.level2'], r(480, 290, 216, 34), {
        min: 0,
        max: 0.06,
        value: 0.012,
        style: row,
      }),
      ...control('ftone', 'ui.slider', 'tone', ['tonel1.cutoff', 'toner1.cutoff'], r(480, 334, 216, 34), {
        min: 900,
        max: 14000,
        scale: 'log',
        unit: 'Hz',
        value: 5200,
        style: row,
      }),
    ],
  );
}

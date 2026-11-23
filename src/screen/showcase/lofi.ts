// Low Res — a lo-fi effect: fewer bits, a slower sample rate, a wobble, some hiss.
// A codebox crushes the sound (holds a sample `rate` times a second, rounds it
// to `bits`), a short modulated delay makes it waver like a stretched tape, a
// lowpass dulls it and hiss is mixed in.
// The design follows the thinking of the NieR:Automata UI design team's work
// (CEDEC AWARDS 2018, Visual Arts, top prize): flat design as the base, with
// motion and a sense of material to make an inorganic world feel present, and
// detail worked out down to the thin rules and small type. Here the whole
// plugin is one 1-bit screen, white on black, its grey only ever dots: the
// output snapped to the grid the codebox rounds and holds to, edge to edge,
// with the spectrum under it (where Tone cuts, how high the hiss lies) and the
// tape's wobble above it. Each setting is dragged where it shows.
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

/** The screen: the output on the crusher's grid, the spectrum under it, the wobble above; every setting is dragged where it shows. */
export const CRUSH_GRID = `// One 1-bit screen, white on black; grey is only ever dots. Columns are the
// samples Rate (frate) keeps, top to bottom, drawn when at least 4 px apart;
// rows the levels Bits (fbits) allows, drawn in the wave's field when at least
// 5 px apart. f.wave is 256 points taken from the last 2048 samples of the
// output (every 8th, about 43 ms at 48 kHz), so a kept sample lasts
// SR / rate / 8 points. The wave is zoomed to fit its field (grid and all: its
// loudest point of about the last second reaches 90% of the half height) and
// snapped to the grid, held and then rounded as the codebox does; each kept
// sample is a small square. In the field, press or drag: across is Rate (log,
// 1.5 to 48 kHz), up is Bits (2 to 16), the same ranges as the two controls.
// Under the field, the output's spectrum (f.spectrum, 64 bands from 96 Hz to
// 24 kHz) as stacks of blocks: Tone (ftone) is the cut, the bands above it
// drawn hollow, and Hiss (fhiss) the dotted floor with noise under it; drag
// across for Tone, up and down for Hiss. Above the field, the tape's wobble
// (fwob): a wave as deep as it, at the wobble's pace; drag it up and down. A
// drag in a strip keeps to the direction it starts in.
const SR = 48000, PER_POINT = 2048 / 256, FONT = 'ui-monospace, "SF Mono", Menlo, monospace';
const RMIN = 1500, RMAX = 48000, BMIN = 2, BMAX = 16;
const TOP = 64, BAND = 86, WOB = [0, 0.005], HISS = [0, 0.06], TONE = [900, 14000];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const val = (f, id, [lo, hi]) => clamp(Number(f.value(id)) || lo, lo, hi);
// The band of f.spectrum a frequency falls in, and back.
const bandOf = hz => (64 * Math.log(hz / 96)) / Math.log(250);
// Where a point is: the wobble (top strip, right half), the spectrum (bottom strip) or the field.
function zoneAt(x, y, w, h) {
  if (y < TOP) return x > w * 0.5 ? 'wob' : '';
  if (y > h - BAND) return 'band';
  return 'field';
}
// A label in small type, edged in black so it reads over the blocks.
function tag(ctx, text, x, y, align, ink, edge) {
  ctx.font = '11px ' + FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (edge) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = edge;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: '', axis: '' });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, n = f.wave.length, dx = w / (n - 1), s = f.state;
    const fg = f.color('fg'), muted = f.color('muted');
    const fieldTop = TOP, fieldBot = h - BAND, mid = (fieldTop + fieldBot) / 2, half = (fieldBot - fieldTop) / 2;
    let top = 0;
    for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(f.wave[i]));
    // Zoomed to fit: the loudest point of the last second or so reaches 90% of the half height (at most 24 times).
    const peak = Math.max(top, (s.top ?? top) * Math.exp(-f.dt / 1.5));
    s.top = peak;
    const zoom = Math.min(24, 0.9 / Math.max(peak, 1e-4));
    const amp = half * zoom;
    const bits = clamp(f.value('fbits'), BMIN, BMAX), rate = clamp(f.value('frate'), RMIN, RMAX);
    const steps = Math.pow(2, bits - 1), hold = SR / rate / PER_POINT;
    ctx.clearRect(0, 0, w, h);
    // Rows: the levels Bits allows, as dots; a slow band drifting down the field draws them twice as fine.
    ctx.fillStyle = muted;
    const rowGap = amp / steps, sweep = fieldTop + ((f.t * 14) % (fieldBot - fieldTop + 80)) - 40;
    if (rowGap >= 5) {
      for (let k = -steps; k <= steps; k++) {
        const y = Math.round(mid - k * rowGap);
        if (y < fieldTop + 2 || y > fieldBot - 2) continue;
        const step = Math.abs(y - sweep) < 40 ? 2 : 4;
        for (let x = 1; x < w; x += step) ctx.fillRect(x, y, 1, 1);
      }
    }
    // Columns: one per kept sample, top to bottom, dotted.
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    if (hold * dx >= 4) {
      for (let x = 0; x < w; x += hold * dx) {
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // The thin rules: the field's top and bottom, and its middle as dots.
    ctx.fillStyle = fg;
    ctx.fillRect(0, fieldTop, w, 1);
    ctx.fillRect(0, fieldBot, w, 1);
    for (let x = 0; x < w; x += 2) ctx.fillRect(x, Math.round(mid), 1, 1);
    // The wave snapped: held for \`hold\` points, rounded to the levels.
    const ys = new Float32Array(n), kept = [];
    let held = 0, next = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) { held = Math.round(f.wave[i] * steps) / steps; next += hold; kept.push(i); }
      ys[i] = clamp(mid - held * amp, fieldTop + 2, fieldBot - 2);
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
    if (hold * dx >= 4) for (const i of kept) ctx.fillRect(Math.round(i * dx) - 2, Math.round(ys[i]) - 2, 5, 5);
    // The handle: where Rate (across) and Bits (up) are; its figures show under the hand.
    const hx = (Math.log(rate / RMIN) / Math.log(RMAX / RMIN)) * w;
    const hy = fieldBot - ((bits - BMIN) / (BMAX - BMIN)) * (fieldBot - fieldTop);
    const p = f.pointer;
    const hot = s.drag === 'field' || (p && p.over && !s.drag && zoneAt(p.x, p.y, w, h) === 'field');
    for (let y = fieldTop + 1; y < fieldBot; y += 3) ctx.fillRect(Math.round(hx), y, 1, 1);
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, Math.round(hy), 1, 1);
    const sz = hot ? 13 : 9;
    ctx.fillRect(Math.round(hx - sz / 2), Math.round(hy - sz / 2), sz, sz);
    ctx.fillStyle = f.color('bg');
    ctx.fillRect(Math.round(hx - 2), Math.round(hy - 2), 4, 4);
    if (hot) {
      const label = (rate / 1000).toFixed(1) + ' kHz  ' + Math.round(bits) + ' bit';
      ctx.font = '11px ' + FONT;
      const tw = label.length * 6.7;
      const lx = hx + 12 + tw + 8 > w ? hx - 12 - tw - 8 : hx + 12;
      const ly = hy - 22 < fieldTop + 2 ? hy + 8 : hy - 22;
      ctx.fillStyle = fg;
      ctx.fillRect(Math.round(lx), Math.round(ly), Math.round(tw + 8), 15);
      tag(ctx, label, Math.round(lx + 4), Math.round(ly + 8), 'left', f.color('bg'));
    }
    // Under the field: the spectrum as stacks of blocks; the bands above Tone hollow; Hiss the dotted floor.
    const spec = f.spectrum || new Float32Array(64);
    const tone = val(f, 'ftone', TONE), hiss = val(f, 'fhiss', HISS), wob = val(f, 'fwob', WOB);
    const by = h - 10, bh = BAND - 30, bw = w / 64, cut = bandOf(tone) * bw;
    const floor = by - (hiss / HISS[1]) * bh;
    const bandHot = s.drag === 'band' || (p && p.over && !s.drag && zoneAt(p.x, p.y, w, h) === 'band');
    ctx.fillStyle = fg;
    for (let k = 0; k < 64; k++) {
      const x = Math.round(k * bw) + 1, level = clamp((spec[k] || 0) * 1.5, 0, 1), blocks = Math.round(level * (bh / 4));
      for (let j = 0; j < blocks; j++) {
        const y = by - 4 - j * 4;
        if (k * bw < cut) ctx.fillRect(x, y, Math.max(1, Math.round(bw) - 3), 3);
        else { ctx.fillRect(x, y, Math.max(1, Math.round(bw) - 3), 1); }
      }
    }
    // The hiss: noise under its floor, as many specks as it is loud.
    const specks = Math.round((hiss / HISS[1]) * 160);
    for (let i = 0; i < specks; i++) {
      const sx = Math.floor(Math.random() * w), sy = by - Math.random() * (by - floor);
      ctx.fillRect(sx, Math.round(sy), 1, 1);
    }
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, Math.round(floor), 1, 1);
    ctx.fillRect(Math.round(cut), h - BAND + 8, bandHot ? 2 : 1, BAND - 18);
    const bg = f.color('bg');
    tag(ctx, 'tone ' + (tone / 1000).toFixed(1) + ' kHz ↔', cut + (cut > w - 120 ? -8 : 8), h - BAND + 16, cut > w - 120 ? 'right' : 'left', fg, bg);
    tag(ctx, 'hiss ' + Math.round((hiss / HISS[1]) * 100) + '% ↕', w - 8, Math.max(h - BAND + 34, floor - 9), 'right', bandHot ? fg : muted, bg);
    // Above the field: the tape's wobble, a wave as deep as it, at its pace.
    const wx = w * 0.56, ww = w * 0.2, wy = TOP / 2, depth = (wob / WOB[1]) * 14;
    const wobHot = s.drag === 'wob' || (p && p.over && !s.drag && zoneAt(p.x, p.y, w, h) === 'wob');
    ctx.fillStyle = fg;
    for (let x = 0; x < ww; x += 2) ctx.fillRect(Math.round(wx + x), Math.round(wy + Math.sin(x / 9 - f.t * 0.62 * 2 * Math.PI) * depth), 2, 2);
    tag(ctx, 'wobble ' + (wob * 1000).toFixed(1) + ' ms ↕', wx + ww + 14, wy, 'left', wobHot ? fg : muted);
    // The header: the rate is the text beside the title (bound to it); the bits follow it.
    ctx.font = '12px ' + FONT;
    tag(ctx, '· ' + Math.round(bits) + ' bit', 222, 32, 'left', fg);
  },
  pointer(e, f) {
    const s = f.state, w = f.w, h = f.h, zone = zoneAt(e.x, e.y, w, h);
    if (e.type === 'down' && zone) {
      Object.assign(s, { drag: zone, axis: '', x0: e.x, y0: e.y, tone0: val(f, 'ftone', TONE), hiss0: val(f, 'fhiss', HISS), wob0: val(f, 'fwob', WOB) });
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag === 'field' && (e.type === 'down' || e.type === 'move')) {
      f.setNorm('frate', clamp(e.x / w, 0, 1));
      const ny = clamp((h - BAND - e.y) / (h - BAND - TOP), 0, 1);
      f.set('fbits', Math.round(BMIN + ny * (BMAX - BMIN)));
    } else if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = e.y - s.y0;
      if (s.drag === 'wob') f.set('fwob', clamp(s.wob0 - (dy / 120) * WOB[1], WOB[0], WOB[1]));
      else {
        if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (s.axis === 'x') f.set('ftone', clamp(96 * Math.pow(250, (bandOf(s.tone0) + (dx / w) * 64) / 64), TONE[0], TONE[1]));
        if (s.axis === 'y') f.set('fhiss', clamp(s.hiss0 - (dy / (BAND - 30)) * HISS[1], HISS[0], HISS[1]));
      }
    }
    if (e.type === 'wheel' && zone === 'band') f.set('fhiss', clamp(val(f, 'fhiss', HISS) - Math.sign(e.dy) * 0.002, HISS[0], HISS[1]));
    if (e.type === 'wheel' && zone === 'wob') f.set('fwob', clamp(val(f, 'fwob', WOB) - Math.sign(e.dy) * 0.0002, WOB[0], WOB[1]));
    const z = s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : z === 'field' ? 'crosshair' : z === 'wob' ? 'ns-resize' : z === 'band' ? 'grab' : 'default');
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
      // ---- the plugin: one 1-bit screen; every setting is dragged where it shows ----
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
            bg: '#0a0a0a',
            fg: '#f5f5f5',
            accent: '#f5f5f5',
            track: '#2e2e2e',
            knob: '#1a1a1a',
            pointer: '#f5f5f5',
            muted: '#9a9a9a',
            glow: '#f5f5f5',
            font: 'jetbrains-mono',
            labelFont: 'jetbrains-mono',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#0a0a0a' }],
          skins: {
            meter: {
              name: 'led',
              params: {
                segments: 10,
                low: '#f5f5f5',
                mid: '#f5f5f5',
                high: '#f5f5f5',
                off: 'track',
              },
            },
          },
        },
      },
      el({ kind: 'canvas', name: 'The screen', code: CRUSH_GRID, rect: r(0, 0, 720, 452) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'LOW/RES',
        rect: r(20, 18, 120, 26),
        textStyle: { ...mono(20, 'fg'), weight: 700, spacing: 0.2 },
      }),
      el({
        kind: 'text',
        name: 'Rate',
        text: '{value}',
        bind: 'frate',
        rect: r(150, 24, 90, 16),
        textStyle: mono(12, 'fg'),
      }),
      ...control('outm1', 'ui.meter', 'out', null, r(20, 48, 120, 6)),
      wire('mixl1.out', 'outm1.in'),
    ],
  );
}

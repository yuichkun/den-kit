// Low Res — a lo-fi effect: fewer bits, a slower sample rate, a wobble, some hiss.
// A codebox crushes the sound (holds a sample `rate` times a second, rounds it
// to `bits`), a short modulated delay makes it waver like a stretched tape, a
// lowpass dulls it and hiss is mixed in.
// The design follows the thinking of the NieR:Automata UI design team's work
// (CEDEC AWARDS 2018, Visual Arts, top prize): flat design as the base, with
// motion and a sense of material to make an inorganic world feel present, and
// detail worked out down to the thin rules and small type. Here the sound is a
// landscape of flat-shaded blocks on a concrete-grey table, built on the grid
// the crusher holds and rounds to: fewer, wider columns at a lower Rate, fewer,
// taller steps with fewer Bits. Its rows sway with the wobble, its tops dim
// with the tone, the hiss speckles the floor, and three pillars in front set
// those three, each as tall as its value. Each setting is dragged where it
// shows, with its value on a plate by the hand.
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

/** The scene: the sound as a landscape of blocks on the crusher's grid, and three pillars for the wobble, the hiss and the tone; every setting is dragged where it shows. */
export const CRUSH_GRID = `// The sound as a landscape of blocks, seen from above at an angle, flat-shaded
// like a model on a table. Front to back: what was just heard, then the moments
// before it (a row about every 33 ms). Across: half of the last 43 ms of the
// output (f.wave), from where it last rose through zero (so the rows line up
// as a steady sound repeats), cut into columns, each holding the sound's value
// at its start as the crusher holds a sample; more columns the higher Rate is (frate: 6 at
// 1.5 kHz to 40 at 48 kHz, log). Up: the value, rounded to the levels Bits
// allows (fbits: 2^(bits-1) a side, at most 16 a side drawn), each level a
// block in the stack. The sound is zoomed to fit (its loudest point of about
// the last second reaches 90% of the height). The rows sway with the wobble
// (fwob), the tops are lit as bright as Tone lets the sound through (ftone),
// the hiss (fhiss) speckles the floor, and the older a row, the further it
// fades into the table. Drag the landscape: across for Rate,
// up and down for Bits. The three pillars in front are the wobble (it sways),
// the hiss (its faces speckle) and the tone (its top lights): pull each up and
// down, its height is its value. The value shows on a plate by the hand.
const SR = 48000, RMIN = 1500, RMAX = 48000, BMIN = 2, BMAX = 16;
const WOB = [0, 0.005], HISS = [0, 0.06], TONE = [900, 14000];
const ROWS = 14, LI = 520, LJ = 200, H = 112, OX = 214, OY = 150, CX = 0.866, CY = 0.36;
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const val = (f, id, [lo, hi]) => clamp(Number(f.value(id)) || lo, lo, hi);
const lnorm = (v, lo, hi) => Math.log(v / lo) / Math.log(hi / lo);
// A colour token as red, green and blue (hex or rgb()), to mix two of them; another form is used as it is.
function rgb(c) {
  c = String(c).trim();
  if (c[0] === '#') {
    let x = c.slice(1);
    if (x.length < 6) x = x.split('').map(d => d + d).join('');
    const v = parseInt(x.slice(0, 6), 16);
    return isNaN(v) ? null : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const a = c.indexOf('('), b = c.indexOf(')');
  return c.startsWith('rgb') && a > 0 && b > a ? c.slice(a + 1, b).split(/[ ,/]+/).slice(0, 3).map(Number) : null;
}
function mix(c0, c1, t) {
  const a = rgb(c0), b = rgb(c1);
  if (!a || !b) return t < 0.5 ? c0 : c1;
  return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',') + ')';
}
/** The landscape's grid for a Rate and Bits: its columns, and its levels a side. */
export const grid = (rate, bits) => ({
  columns: Math.round(6 + 34 * clamp(lnorm(rate, RMIN, RMAX), 0, 1)),
  levels: Math.min(16, Math.pow(2, Math.round(clamp(bits, BMIN, BMAX)) - 1)),
});
// From the floor's coordinates (i across, j front to back, in px) and a height, to the screen.
const P = (i, j, y) => [OX + (i - j) * CX, OY + (i + j) * CY - y];
// The pillars: where each stands on the floor, what it sets.
const PILLARS = [
  { id: 'fwob', kind: 'wob', name: 'wobble', i: 160, j: LJ + 110, range: WOB, log: false },
  { id: 'fhiss', kind: 'hiss', name: 'hiss', i: 260, j: LJ + 110, range: HISS, log: false },
  { id: 'ftone', kind: 'tone', name: 'tone', i: 360, j: LJ + 110, range: TONE, log: true },
];
const SIDE = 22, PH = 104;
const pnorm = (f, q) => { const v = val(f, q.id, q.range); return q.log ? lnorm(v, q.range[0], q.range[1]) : (v - q.range[0]) / (q.range[1] - q.range[0]); };
function inside(x, y, pts) {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = pts[a], [xb, yb] = pts[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}
function zoneAt(x, y, f) {
  for (const q of PILLARS) {
    const [bx, by] = P(q.i + SIDE / 2, q.j + SIDE / 2, 0), top = 8 + pnorm(f, q) * PH;
    if (Math.abs(x - bx) < SIDE + 4 && y < by + 14 && y > by - top - 22) return q;
  }
  const hull = [P(0, 0, H), P(LI, 0, H), P(LI, 0, 0), P(LI, LJ, 0), P(0, LJ, 0), P(0, LJ, H)];
  return inside(x, y, hull) ? { id: 'frate', kind: 'land' } : null;
}
// A prism standing on the floor: its top, its left face and its right face.
function prism(ctx, i0, j0, di, dj, y, top, left, right, edge) {
  const a = P(i0, j0, y), b = P(i0 + di, j0, y), c = P(i0 + di, j0 + dj, y), d = P(i0, j0 + dj, y);
  const c0 = P(i0 + di, j0 + dj, 0), b0 = P(i0 + di, j0, 0), d0 = P(i0, j0 + dj, 0);
  ctx.fillStyle = right; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c0[0], c0[1]); ctx.lineTo(b0[0], b0[1]); ctx.closePath(); ctx.fill();
  ctx.fillStyle = left; ctx.beginPath(); ctx.moveTo(d[0], d[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c0[0], c0[1]); ctx.lineTo(d0[0], d0[1]); ctx.closePath(); ctx.fill();
  ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
  return [a, b, c, d];
}
function plate(ctx, text, x, y, ink, paper) {
  ctx.font = '700 12px ' + MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const tw = ctx.measureText(text).width + 14;
  const x0 = Math.round(clamp(x - tw / 2, 6, 714 - tw));
  ctx.fillStyle = ink; ctx.fillRect(x0, Math.round(y - 11), Math.round(tw), 22);
  ctx.fillStyle = paper; ctx.fillText(text, x0 + 7, Math.round(y) + 0.5);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { rows: [], tick: 0, drag: null });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, wave = f.wave, n = wave.length;
    const ink = f.color('fg'), bg = f.color('bg'), lite = f.color('accent'), mid = f.color('knob'), dark = f.color('track'), muted = f.color('muted');
    const rate = val(f, 'frate', [RMIN, RMAX]), bits = val(f, 'fbits', [BMIN, BMAX]);
    const wob = val(f, 'fwob', WOB), hiss = val(f, 'fhiss', HISS), tone = val(f, 'ftone', TONE);
    const { columns: C, levels: L } = grid(rate, bits);
    if (!s.rows) Object.assign(s, { rows: [], tick: 0 });
    // Zoomed to fit: the loudest point of the last second or so reaches 90% of the height (at most 24 times).
    let top = 0;
    for (let k = 0; k < n; k++) top = Math.max(top, Math.abs(wave[k]));
    const peak = Math.max(top, (s.top ?? top) * Math.exp(-(f.dt || 0.016) / 1.5));
    s.top = peak;
    const zoom = Math.min(24, 0.9 / Math.max(peak, 1e-4));
    // A new row every other frame: each column holds the value at its start, rounded to the levels.
    s.tick = (s.tick || 0) + 1;
    if (s.tick % 2 === 1 || !s.rows.length) {
      const row = [];
      let k0 = 0;
      for (let k = 1; k < n / 2; k++) if (wave[k - 1] < 0 && wave[k] >= 0) { k0 = k; break; }
      for (let c = 0; c < C; c++) {
        const v = clamp((wave[k0 + Math.floor((c / C) * (n / 2))] || 0) * zoom, -1, 1);
        row.push(Math.round(v * L) / L);
      }
      s.rows.push(row);
      if (s.rows.length > ROWS) s.rows.shift();
    }
    ctx.clearRect(0, 0, w, h);
    // The floor: a dot at every 40 px, and the hiss as specks on it.
    ctx.fillStyle = dark;
    for (let i = -120; i <= LI + 80; i += 40) for (let j = -40; j <= LJ + 160; j += 40) { const [x, y] = P(i, j, 0); if (x > 0 && x < w && y > 0 && y < h) ctx.fillRect(Math.round(x), Math.round(y), 2, 2); }
    const specks = Math.round(((hiss - HISS[0]) / (HISS[1] - HISS[0])) * 420);
    for (let k = 0; k < specks; k++) {
      const [x, y] = P(-60 + Math.random() * (LI + 140), -20 + Math.random() * (LJ + 140), 0);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    // The landscape, back to front. Each block's top is lit as bright as Tone lets the sound through,
    // and each row fades into the table the older it is.
    const ui = LI / C, uj = LJ / ROWS, stepH = H / (2 * L);
    const light = lnorm(tone, TONE[0], TONE[1]), lit = mix(mid, lite, 0.25 + 0.75 * light);
    const shades = [];
    for (let j = 0; j < ROWS; j++) { const fade = ((ROWS - 1 - j) / (ROWS - 1)) * 0.8; shades.push([mix(lit, bg, fade), mix(mid, bg, fade), mix(dark, bg, fade)]); }
    const R = s.rows.length, sway = ((wob - WOB[0]) / (WOB[1] - WOB[0])) * ui * 1.6;
    const cells = [];
    for (let r = 0; r < R; r++) {
      const row = s.rows[r], j = ROWS - R + r, off = Math.sin(f.t * 0.62 * 2 * Math.PI - j * 0.55) * sway;
      for (let c = 0; c < C; c++) cells.push([c, j, row[Math.min(row.length - 1, Math.floor((c / C) * row.length))], off]);
    }
    cells.sort((a, b) => a[0] * ui + a[1] * uj - (b[0] * ui + b[1] * uj));
    for (const [c, j, v, off] of cells) {
      const y = Math.max(2, ((v + 1) / 2) * H), now = j === ROWS - 1;
      const [tp, lf, rt] = shades[j];
      const corners = prism(ctx, c * ui + off, j * uj, ui, uj, y, tp, lf, rt, now && ui >= 9 ? ink : null);
      // The levels as blocks: on the front row, a line across its face at every level, where they are far enough apart.
      if (now && stepH >= 5 && ui >= 7) {
        ctx.beginPath();
        for (let k = 1; k * stepH < y - 1; k++) {
          const [x0, y0] = P(c * ui + off + ui, j * uj + uj, k * stepH), [x1, y1] = P(c * ui + off, j * uj + uj, k * stepH);
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        }
        ctx.lineWidth = 0.75; ctx.strokeStyle = ink; ctx.stroke();
      }
      if (now) { ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(corners[3][0], corners[3][1]); ctx.lineTo(corners[2][0], corners[2][1]); ctx.stroke(); }
    }
    // The three pillars: the wobble sways, the hiss speckles, the tone lights its top.
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? zoneAt(p.x, p.y, f) : null;
    for (const q of PILLARS) {
      const v = pnorm(f, q), hgt = 8 + v * PH;
      const sw = q.kind === 'wob' ? Math.sin(f.t * 0.62 * 2 * Math.PI) * v * 6 : 0;
      const on = hot && hot.id === q.id;
      prism(ctx, q.i + sw, q.j, SIDE, SIDE, hgt, q.kind === 'tone' ? mix(dark, lite, v) : dark, muted, ink, null);
      const [nx, ny] = P(q.i + SIDE, q.j + SIDE, 0);
      ctx.font = '600 11px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = bg; ctx.fillRect(Math.round(nx - 36), Math.round(ny + 8), 52, 16);
      ctx.fillStyle = on ? ink : muted;
      ctx.fillText(q.name, Math.round(nx - 10), Math.round(ny + 16));
      if (q.kind === 'hiss') {
        ctx.fillStyle = lite;
        for (let k = 0; k < Math.round(v * 70); k++) {
          const [x, y] = P(q.i + SIDE, q.j + Math.random() * SIDE, Math.random() * hgt);
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
          const [x2, y2] = P(q.i + Math.random() * SIDE, q.j + SIDE, Math.random() * hgt);
          ctx.fillRect(Math.round(x2), Math.round(y2), 1, 1);
        }
      }
      if (on) { const [x, y] = P(q.i + SIDE / 2, q.j + SIDE / 2, hgt); ctx.fillStyle = ink; ctx.fillRect(Math.round(x) - 5, Math.round(y) - 18, 10, 2); }
    }
    // The bits beside the rate (the rate is the text bound to it); the meter's name.
    ctx.font = '400 12px ' + MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = ink;
    ctx.fillText('· ' + Math.round(bits) + ' bit', 644, 65);
    ctx.textAlign = 'right'; ctx.fillStyle = muted;
    ctx.fillText('out', 552, 85);
    // The plate by the hand.
    if (hot && p) {
      const text = hot.kind === 'land' ? 'rate ' + (rate / 1000).toFixed(1) + ' kHz ↔ · bits ' + Math.round(bits) + ' ↕'
        : hot.kind === 'wob' ? 'wobble ' + (wob * 1000).toFixed(1) + ' ms'
        : hot.kind === 'hiss' ? 'hiss ' + Math.round(((hiss - HISS[0]) / (HISS[1] - HISS[0])) * 100) + '%'
        : 'tone ' + (tone / 1000).toFixed(1) + ' kHz';
      // On a pillar the plate rides above its top; on the landscape, above the hand.
      const q = PILLARS.find(z => z.id === hot.id);
      const [px, py] = q ? P(q.i + SIDE / 2, q.j + SIDE / 2, 8 + pnorm(f, q) * PH) : [p.x, p.y + 10];
      plate(ctx, text, px, Math.max(14, py - 40), ink, bg);
    }
  },
  pointer(e, f) {
    const s = f.state, zone = zoneAt(e.x, e.y, f), fine = e.shift ? 0.1 : 1;
    if (e.type === 'down' && zone) {
      s.drag = { ...zone, x0: e.x, y0: e.y, rate0: f.norm('frate'), bits0: val(f, 'fbits', [BMIN, BMAX]), v0: zone.kind === 'land' ? 0 : f.norm(zone.id) };
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && e.type === 'move') {
      const dx = e.x - d.x0, dy = e.y - d.y0;
      if (d.kind === 'land') {
        f.setNorm('frate', clamp(d.rate0 + (dx / 320) * fine, 0, 1));
        f.set('fbits', clamp(Math.round(d.bits0 - (dy / 18) * fine), BMIN, BMAX));
      } else f.setNorm(d.id, clamp(d.v0 - (dy / PH) * fine, 0, 1));
    }
    if (e.type === 'wheel' && zone && zone.kind !== 'land') f.setNorm(zone.id, clamp(f.norm(zone.id) - Math.sign(e.dy) * 0.02 * fine, 0, 1));
    const z = s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : !z ? 'default' : z.kind === 'land' ? 'move' : 'ns-resize');
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
            bg: '#c9c7bf',
            fg: '#1f1f1d',
            accent: '#f4f3ee',
            track: '#6f6c65',
            knob: '#a3a098',
            pointer: '#1f1f1d',
            muted: '#4f4d48',
            glow: '#1f1f1d',
            font: 'jetbrains-mono',
            labelFont: 'jetbrains-mono',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#c9c7bf' }],
          skins: {
            meter: {
              name: 'led',
              params: {
                segments: 10,
                low: '#1f1f1d',
                mid: '#1f1f1d',
                high: '#1f1f1d',
                off: 'knob',
              },
            },
          },
        },
      },
      el({ kind: 'canvas', name: 'The landscape', code: CRUSH_GRID, rect: r(0, 0, 720, 452) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'LOW/RES',
        rect: r(470, 20, 230, 30),
        textStyle: { ...mono(22, 'fg'), align: 'right', weight: 700, spacing: 0.2 },
      }),
      el({
        kind: 'text',
        name: 'Rate',
        text: '{value}',
        bind: 'frate',
        rect: r(540, 57, 100, 16),
        textStyle: { ...mono(12, 'fg'), align: 'right' },
      }),
      ...control('outm1', 'ui.meter', 'out', null, r(560, 82, 140, 6)),
      wire('mixl1.out', 'outm1.in'),
    ],
  );
}

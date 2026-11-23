// Low Res — a lo-fi effect: fewer bits, a slower sample rate, a wobble, some hiss.
// A codebox crushes the sound (holds a sample `rate` times a second, rounds it
// to `bits`), a short modulated delay makes it waver like a stretched tape, a
// lowpass dulls it and hiss is mixed in.
// The design follows the thinking of the NieR:Automata UI design team's work
// (CEDEC AWARDS 2018, Visual Arts, top prize): flat design as the base, with
// motion and a sense of material to make an inorganic world feel present, and
// detail worked out down to the thin rules and small type. Here the screen is
// one bit, white on black, its shades patterns of white dots and its words in
// its own pixel letters. The sound is a landscape of blocks built on the grid
// the crusher holds and rounds to: fewer, wider columns at a lower Rate, fewer,
// taller steps with fewer Bits; its front row is solid, so its steps read as
// the wave, and a ruler on each edge marks the grid, its value at its end. In
// front, on the dotted grid of the table's floor, stand the towers for the
// wobble, the hiss and the tone, each on a square of the grid, as tall as its
// value, its name in front of it, and the OUT tower, whose face is the meter.
// Each setting is dragged where it shows; under the hand, its name or ruler
// reads its value in black on a white bar, as a chosen item does in a list.
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

/** How the floor goes onto the screen (a step across, a step towards you), and the OUT tower, whose face is the meter. */
const VIEW = { OX: 120, OY: 160, AX: 0.98, AY: 0.1, BX: -0.5, BY: 0.3 };
const OUT = { i: 760, j: 520, s: 40, h: 92 };
const face = {
  x: VIEW.OX + OUT.i * VIEW.AX + (OUT.j + OUT.s) * VIEW.BX,
  y: VIEW.OY + OUT.i * VIEW.AY + (OUT.j + OUT.s) * VIEW.BY - OUT.h,
  w: OUT.s * VIEW.AX,
};

/** The scene: the sound as a landscape of blocks on the crusher's grid, a ruler for each side of the grid, and the towers; every setting is dragged where it shows. */
export const CRUSH_GRID = `// The sound as a landscape of blocks on a black table, drawn in one bit: white
// and black only, a face's shade a pattern of white dots. Front to back: what
// was just heard, then the moments before it (a row about every 33 ms). Across:
// half of the last 43 ms of the output (f.wave), from where it last rose
// through zero (so the rows line up as a steady sound repeats), cut into
// columns, each holding the sound's value at its start as the crusher holds a
// sample; more columns the higher Rate is (frate: 6 at 1.5 kHz to 40 at 48 kHz,
// log). Up: the value, rounded to the levels Bits allows (fbits: 2^(bits-1) a
// side, at most 16 a side drawn), each level a block in the stack. The sound is
// zoomed to fit (its loudest point of about the last second reaches 90% of the
// height). The front row is solid (white tops, dotted fronts), so its steps
// read as the wave; the rows behind are black with white edges, the older the
// sparser their edges; a black side closes the landscape at its right end, the
// rows cut through on it (each row's last column, dotted). A
// ruler along the front has a tick at every column, the rate at its end; one at
// the left has a tick at every level, the bits under it. The rows sway with the
// wobble (fwob). In front, on a floor ruled in dots every 40 px, stand three towers
// here and there, each on a square of the floor, as tall as its value, its name
// upright in front of it: the wobble (it sways), the hiss (its faces fizz with
// white dots, the more the louder) and the tone; and the OUT tower, whose face
// is the meter on the plugin. Every tower has a white top, a dotted front and a
// black side. Drag the landscape across for Rate and up and down for Bits, or a
// ruler along itself; pull a tower up and down. Under the hand, the tower's name
// reads its value, or the ruler's value at its end, black on a white bar. Words
// are in the screen's own pixel letters, the work's name large on the floor at
// the front left; no line of the floor runs into a word.
const SR = 48000, RMIN = 1500, RMAX = 48000, BMIN = 2, BMAX = 16;
const WOB = [0, 0.005], HISS = [0, 0.06], TONE = [900, 14000];
const ROWS = 12, LI = 560, LJ = 180, H = 120;
const { OX, OY, AX, AY, BX, BY } = ${JSON.stringify(VIEW)};
const OUT = ${JSON.stringify(OUT)};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const val = (f, id, [lo, hi]) => clamp(Number(f.value(id)) || lo, lo, hi);
const lnorm = (v, lo, hi) => Math.log(v / lo) / Math.log(hi / lo);
/** The landscape's grid for a Rate and Bits: its columns, and its levels a side. */
export const grid = (rate, bits) => ({
  columns: Math.round(6 + 34 * clamp(lnorm(rate, RMIN, RMAX), 0, 1)),
  levels: Math.min(16, Math.pow(2, Math.round(clamp(bits, BMIN, BMAX)) - 1)),
});
// From the floor's coordinates (i across, j front to back, in px) and a height, to the screen.
const P = (i, j, y) => [OX + i * AX + j * BX, OY + i * AY + j * BY - y];
// The towers in front, here and there on the floor, each on a square of its dots: where each stands (i across, j front to back), what it sets.
const TS = OUT.s, TH = 86;
const TOWERS = [
  { id: 'fwob', kind: 'wob', name: 'WOBBLE', i: 240, j: 480, range: WOB, log: false },
  { id: 'fhiss', kind: 'hiss', name: 'HISS', i: 400, j: 560, range: HISS, log: false },
  { id: 'ftone', kind: 'tone', name: 'TONE', i: 600, j: 480, range: TONE, log: true },
];
// The table's floor in front of the landscape, ruled every 40 px: its first and last i and j.
const FLOOR = { i0: 160, i1: 840, j0: 400, j1: 640 };
const tnorm = (f, q) => { const v = val(f, q.id, q.range); return q.log ? lnorm(v, q.range[0], q.range[1]) : (v - q.range[0]) / (q.range[1] - q.range[0]); };
const tall = (f, q) => 24 + tnorm(f, q) * TH;
// The screen's pixel letters, five by seven.
const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####', M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#', S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.....|.....|.....|.....|.....|.##..|.##..', '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
  '·': '.....|.....|.....|.##..|.##..|.....|.....',
};
function px(ctx, text, x, y, size, align) {
  const t = String(text).toUpperCase(), wdt = t.length * 6 * size - size;
  let x0 = Math.round(align === 'right' ? x - wdt : align === 'center' ? x - wdt / 2 : x);
  const y0 = Math.round(y);
  for (const ch of t) {
    const g = GLYPHS[ch];
    if (g) g.split('|').forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') ctx.fillRect(x0 + c * size, y0 + r * size, size + 0.5, size + 0.5); });
    x0 += 6 * size;
  }
  return wdt;
}
// A shade: white dots in a tile (a dot is 2 px), as a pattern; plain white or black where patterns cannot be made.
function shade(ctx, size, dots, ink, paper) {
  if (typeof OffscreenCanvas !== 'function' || typeof ctx.createPattern !== 'function') return null;
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = paper; g.fillRect(0, 0, size, size);
  g.fillStyle = ink; for (const [x, y] of dots) g.fillRect(x, y, 2, 2);
  return ctx.createPattern(c, 'repeat');
}
function inside(x, y, pts) {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = pts[a], [xb, yb] = pts[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}
function zoneAt(x, y, f) {
  for (const q of TOWERS) {
    const [x0, y0] = P(q.i, q.j + TS, 0), [x1] = P(q.i + TS, q.j, 0);
    if (x > x0 - 4 && x < x1 + 4 && y < y0 + 8 && y > y0 - tall(f, q) - 34) return q;
  }
  const [rx0, ry0] = P(0, LJ + 8, 0), [rx1, ry1] = P(LI, LJ + 8, 0);
  if (x > rx0 && x < rx1 && Math.abs(y - (ry0 + ((x - rx0) / (rx1 - rx0)) * (ry1 - ry0))) < 9) return { id: 'frate', kind: 'rate' };
  const [bx, by] = P(-8, LJ, 0);
  if (Math.abs(x - bx) < 12 && y < by + 6 && y > by - H - 6) return { id: 'fbits', kind: 'bits' };
  const hull = [P(0, 0, H), P(LI, 0, H), P(LI, 0, 0), P(LI, LJ, 0), P(0, LJ, 0), P(0, LJ, H)];
  return inside(x, y, hull) ? { id: 'frate', kind: 'land' } : null;
}
// A block standing on the floor: its right face, its front face and its top; filled, then edged if asked.
function prism(ctx, i0, j0, di, dj, y, top, front, right, edge) {
  const a = P(i0, j0, y), b = P(i0 + di, j0, y), c = P(i0 + di, j0 + dj, y), d = P(i0, j0 + dj, y);
  const c0 = P(i0 + di, j0 + dj, 0), b0 = P(i0 + di, j0, 0), d0 = P(i0, j0 + dj, 0);
  const faces = [[right, [b, c, c0, b0]], [front, [d, c, c0, d0]], [top, [a, b, c, d]]];
  for (const [fill, q] of faces) {
    if (fill === null) continue;
    ctx.beginPath(); q.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
  }
  return [a, b, c, d];
}
// Where a word in pixel letters goes, size 2, its top at y, centred on x (kept on the screen); with the margin a bar
// under it takes.
function box(text, x, y) {
  const wdt = String(text).length * 12 - 2, x0 = Math.round(clamp(x - wdt / 2, 8, 712 - wdt));
  return { x: x0, y: Math.round(y), w: wdt, x0: x0 - 6, y0: Math.round(y) - 5, x1: x0 + wdt + 6, y1: Math.round(y) + 19 };
}
// A word in pixel letters; under the hand, black on a white bar.
function word(ctx, text, b, on, ink, paper) {
  if (on) { ctx.fillStyle = ink; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
  ctx.fillStyle = on ? paper : ink;
  px(ctx, text, b.x, b.y, 2, 'left');
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { rows: [], tick: 0, drag: null });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state, wave = f.wave, n = wave.length;
    const ink = f.color('fg'), paper = f.color('bg');
    const rate = val(f, 'frate', [RMIN, RMAX]), bits = val(f, 'fbits', [BMIN, BMAX]);
    const wob = val(f, 'fwob', WOB), hiss = val(f, 'fhiss', HISS), tone = val(f, 'ftone', TONE);
    const { columns: C, levels: L } = grid(rate, bits);
    if (!s.rows) Object.assign(s, { rows: [], tick: 0 });
    if (!s.shades) {
      const d50 = shade(ctx, 4, [[0, 0], [2, 2]], ink, paper), d25 = shade(ctx, 4, [[0, 0]], ink, paper);
      s.shades = { d50: d50 || ink, d25: d25 || paper };
    }
    const { d50, d25 } = s.shades;
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
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? zoneAt(p.x, p.y, f) : null;
    const on = q => !!hot && hot.id === q.id && hot.kind === q.kind;
    // The words: each tower's name in front of it (its value under the hand), OUT's, the rulers' values, the work's name.
    const [r1x, r1y] = P(LI, LJ + 8, 0), [b0x, b0y] = P(-8, LJ, 0);
    const words = TOWERS.map(q => {
      const text = !on(q) ? q.name
        : q.kind === 'wob' ? 'WOBBLE ' + (wob * 1000).toFixed(1) + ' MS'
        : q.kind === 'hiss' ? 'HISS ' + Math.round(((hiss - HISS[0]) / (HISS[1] - HISS[0])) * 100) + '%'
        : 'TONE ' + (tone / 1000).toFixed(1) + ' KHZ';
      const [x, y] = P(q.i + TS / 2, q.j + TS, 0);
      return { text, b: box(text, x, y + 14), on: on(q) };
    });
    const [ox, oy] = P(OUT.i + OUT.s / 2, OUT.j + OUT.s, 0);
    words.push({ text: 'OUT', b: box('OUT', ox, oy + 14), on: false });
    const rateText = (rate / 1000).toFixed(1) + ' KHZ', bitsText = Math.round(bits) + ' BIT';
    const rateOn = !!hot && (hot.kind === 'rate' || hot.kind === 'land'), bitsOn = !!hot && (hot.kind === 'bits' || hot.kind === 'land');
    const rb = box(rateText, 0, r1y - 2), bb = box(bitsText, 0, b0y + 14);
    Object.assign(rb, { x: Math.round(r1x + 10), x0: Math.round(r1x + 4), x1: Math.round(r1x + 10) + rb.w + 6 });
    Object.assign(bb, { x: 16, x0: 10, x1: 16 + bb.w + 6 });
    words.push({ text: rateText, b: rb, on: rateOn }, { text: bitsText, b: bb, on: bitsOn });
    const title = { x0: 10, y0: h - 44, x1: 16 + 7 * 18 + 3, y1: h - 10 };
    // The table's floor in front: a dotted line every 40 px each way, stopping short of every word.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    for (const b of [...words.map(z => z.b), title]) ctx.rect(b.x0 - 3, b.y0 - 3, b.x1 - b.x0 + 6, b.y1 - b.y0 + 6);
    ctx.clip('evenodd');
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
    ctx.beginPath();
    for (let j = FLOOR.j0; j <= FLOOR.j1; j += 40) { const [x0, y0] = P(FLOOR.i0, j, 0), [x1, y1] = P(FLOOR.i1, j, 0); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    for (let i = FLOOR.i0; i <= FLOOR.i1; i += 40) { const [x0, y0] = P(i, FLOOR.j0, 0), [x1, y1] = P(i, FLOOR.j1, 0); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    // The work's name, large, on the floor at the front left.
    ctx.fillStyle = ink; px(ctx, 'LOW RES', 16, h - 37, 3, 'left');
    // The rulers: along the front a tick at every column; at the left a tick at every level, the bits under it.
    const ui = LI / C, uj = LJ / ROWS;
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath();
    const [r0x, r0y] = P(0, LJ + 8, 0);
    ctx.moveTo(r0x, r0y); ctx.lineTo(r1x, r1y);
    for (let c = 0; c <= C; c++) { const [x0, y0] = P(c * ui, LJ + 8, 0), [x1, y1] = P(c * ui, LJ + 16, 0); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.moveTo(b0x, b0y); ctx.lineTo(b0x, b0y - H);
    for (let k = 0; k <= 2 * L; k++) { const yk = (k / (2 * L)) * H, [x0, y0] = P(-8, LJ, yk), [x1, y1] = P(-15, LJ, yk); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.stroke();
    // The landscape, back to front, a row at a time. The front row is solid; the rows behind are black,
    // edged in white, their edges sparser the older they are. Nothing of it shows past its right end, even as the
    // rows sway: it is cut at the black side that closes it.
    const R = s.rows.length, sway = ((wob - WOB[0]) / (WOB[1] - WOB[0])) * ui * 1.6;
    const side = [P(LI, LJ, 0), P(LI, 0, 0), P(LI, 0, H), P(LI, LJ, H)];
    ctx.save();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(side[2][0], 0);
    for (const [x, y] of [side[2], side[1], side[0]]) ctx.lineTo(x, y);
    ctx.lineTo(side[0][0], h); ctx.lineTo(0, h); ctx.closePath(); ctx.clip();
    for (let r = 0; r < R; r++) {
      const row = s.rows[r], j = ROWS - R + r, off = Math.sin(f.t * 0.62 * 2 * Math.PI - j * 0.55) * sway, now = j === ROWS - 1;
      const age = (ROWS - 1 - j) / (ROWS - 1);
      if (!now) ctx.setLineDash(age > 0.66 ? [1, 3] : age > 0.33 ? [2, 2] : []);
      for (let c = 0; c < C; c++) {
        const v = row[Math.min(row.length - 1, Math.floor((c / C) * row.length))], y = Math.max(2, ((v + 1) / 2) * H);
        if (now) prism(ctx, c * ui + off, j * uj, ui, uj, y, ink, d50, paper, paper);
        else prism(ctx, c * ui + off, j * uj, ui, uj, y, paper, paper, paper, ink);
      }
      ctx.setLineDash([]);
    }
    // The front row's steps, as a line: the wave as the crusher left it.
    const front = s.rows[R - 1];
    if (front) {
      const off = Math.sin(f.t * 0.62 * 2 * Math.PI - (ROWS - 1) * 0.55) * sway;
      ctx.beginPath();
      for (let c = 0; c < C; c++) {
        const y = Math.max(2, ((front[c] + 1) / 2) * H), [x0, y0] = P(c * ui + off, LJ, y), [x1, y1] = P((c + 1) * ui + off, LJ, y);
        if (c) ctx.lineTo(x0, y0); else ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    // The landscape's right end: one black side, edged in white, over the ends of its rows, and on it the rows cut
    // through, dotted: each row's last column, as tall as it stands.
    ctx.beginPath(); side.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = paper; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    for (let r = 0; r < R; r++) {
      const row = s.rows[r], j = ROWS - R + r, v = row[Math.min(row.length - 1, Math.floor(((C - 1) / C) * row.length))];
      const y = Math.max(2, ((v + 1) / 2) * H);
      [P(LI, j * uj, 0), P(LI, j * uj, y), P(LI, (j + 1) * uj, y), P(LI, (j + 1) * uj, 0)].forEach(([x, yy], k) => (k ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)));
      ctx.closePath();
    }
    ctx.fillStyle = d25; ctx.fill(); ctx.stroke();
    // The towers, back to front: the wobble sways, the hiss fizzes. OUT's face is the meter.
    for (const q of [...TOWERS].sort((a, b) => a.j - b.j)) {
      const v = tnorm(f, q), hgt = tall(f, q);
      const sw = q.kind === 'wob' ? Math.sin(f.t * 0.62 * 2 * Math.PI) * v * 6 : 0;
      prism(ctx, q.i + sw, q.j, TS, TS, hgt, ink, d25, paper, on(q) ? ink : null);
      ctx.strokeStyle = ink; ctx.lineWidth = 1;
      const [ex, ey] = P(q.i + sw + TS, q.j + TS, 0), [tx, ty] = P(q.i + sw + TS, q.j + TS, hgt);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
      if (q.kind === 'hiss') {
        ctx.fillStyle = ink;
        for (let k = 0; k < Math.round(v * 120); k++) {
          const [x, y] = P(q.i + Math.random() * TS, q.j + TS, Math.random() * hgt);
          ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
      }
    }
    prism(ctx, OUT.i, OUT.j, OUT.s, OUT.s, OUT.h, ink, d25, paper, ink);
    for (const z of words) word(ctx, z.text, z.b, z.on, ink, paper);
  },
  pointer(e, f) {
    const s = f.state, zone = zoneAt(e.x, e.y, f), fine = e.shift ? 0.1 : 1;
    if (e.type === 'down' && zone) {
      s.drag = { ...zone, x0: e.x, y0: e.y, rate0: f.norm('frate'), bits0: val(f, 'fbits', [BMIN, BMAX]), v0: zone.kind === 'land' || zone.kind === 'rate' || zone.kind === 'bits' ? 0 : f.norm(zone.id) };
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && e.type === 'move') {
      const dx = e.x - d.x0, dy = e.y - d.y0;
      if (d.kind === 'land' || d.kind === 'rate') f.setNorm('frate', clamp(d.rate0 + (dx / 320) * fine, 0, 1));
      if (d.kind === 'land' || d.kind === 'bits') f.set('fbits', clamp(Math.round(d.bits0 - (dy / 18) * fine), BMIN, BMAX));
      if (d.kind !== 'land' && d.kind !== 'rate' && d.kind !== 'bits') f.setNorm(d.id, clamp(d.v0 - (dy / TH) * fine, 0, 1));
    }
    if (e.type === 'wheel' && zone && zone.kind !== 'land' && zone.kind !== 'rate' && zone.kind !== 'bits') f.setNorm(zone.id, clamp(f.norm(zone.id) - Math.sign(e.dy) * 0.02 * fine, 0, 1));
    const z = s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : !z ? 'default' : z.kind === 'land' ? 'move' : z.kind === 'rate' ? 'ew-resize' : 'ns-resize');
  },
};
`;

export function lofi(catalog: Catalog) {
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
            fg: '#ffffff',
            accent: '#ffffff',
            track: '#0a0a0a',
            knob: '#ffffff',
            pointer: '#ffffff',
            muted: '#ffffff',
            glow: '#ffffff',
            font: 'share-tech-mono',
            labelFont: 'share-tech-mono',
            valueFont: 'share-tech-mono',
          },
          background: [{ kind: 'color', color: '#0a0a0a' }],
          skins: {
            meter: {
              name: 'bar',
              params: { fill: '#ffffff', surface: 'rgba(0, 0, 0, 0)', scale: false },
            },
          },
          // The meter is the OUT tower's face: slanted as the face is, see-through, it fills with white from the floor.
          css: `[data-widget=outm1] dk-scope::part(canvas) { transform: skewY(${((Math.atan(VIEW.AY / VIEW.AX) * 180) / Math.PI).toFixed(2)}deg); transform-origin: 0 0; border-radius: 0; }`,
        },
      },
      el({ kind: 'canvas', name: 'The landscape', code: CRUSH_GRID, rect: r(0, 0, 720, 452) }),
      ...control('outm1', 'ui.meter', 'out', null, r(face.x, face.y, face.w, OUT.h)),
      wire('mixl1.out', 'outm1.in'),
    ],
  );
}

// Shape Drums — a drum toy for children: eight shapes to tap, and a beat to join.
// Pitched toy drums (a sine with a pitch drop plus a little filtered noise) on
// a pentatonic scale, so any two taps sound good together; a soft shaker beat
// can be switched on to play along with.
// The design follows the thinking of Rytmos (Apple Design Awards 2024,
// Interaction): play is clear without being explained, the gestures are simple
// and fun, and each thing added joins the music. Each shape is itself a drum,
// seen from above on a pink floor: a flat head in its own colour inside a rim,
// a few bolts, and one hard shadow cast the same way by all of them. They sit in
// a circle round the Beat, the low notes big at the bottom and the high ones
// small at the top, so size is pitch and nothing needs reading. A tapped drum
// lights in its own shape (the pad is clipped to it), the beat's four steps go
// round the Beat while it plays, and each hit sends a pop of bits out from the
// middle. How the drums sound is three toys down the side, drawn the same way:
// a ball that bounces higher (Bounce), a bell that rings longer (Ring) and a cup
// that fizzes more (Fizz); the one under the hand lifts and shows its setting.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The ink of the work: text, shadows, the Beat, the toys' lines. */
const INK = '#2c0d31';
/** The hard shadow every drum and toy casts: straight down, this far, in the ink. */
const SHADOW = { dy: 7, color: 'rgba(44, 13, 49, 0.3)' };
/** The middle of the drum circle, where the Beat sits. */
const MID = { x: 304, y: 318 };

/** The board under the drums: the beat's four steps round the Beat, and a pop of bits with every hit. */
export const BOARD = `// The floor under the drums. Round the Beat button go the beat's four steps:
// while the beat is on (tbeat) the step it is on lights. The beat plays at 100 a
// minute, and each hit heard pulls the steps towards it, so they follow the
// shaker even though a canvas cannot see the beat itself. A hit is a jump in
// the output level: a pop of small bits flies out from the middle, between the
// drums, and fades; the bigger the jump, the more bits (a drum sends a handful,
// the soft shaker one or two).
const CX = ${MID.x}, CY = ${MID.y}, R = 74;
const BEAT = 60 / 100;
const BITS = ['#2c45cf', '#ff4b2b', '#ffc531', '#3d1446', '#12a594', '#fff3df', '#ff8a1e', '#49b6f4'];
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, phase: 0, bits: [], seed: 7, n: 0 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, on = f.on('tbeat'), ink = f.color('fg');
    const jump = f.level - s.prev;
    if (jump > s.prev * 0.35 + 0.004) {
      if (on) {
        const e = ((((f.t - s.phase) % BEAT) + BEAT * 1.5) % BEAT) - BEAT / 2;
        s.phase += e * 0.5;
      }
      const count = Math.max(1, Math.min(7, Math.round(jump * 120)));
      for (let k = 0; k < count; k++) {
        s.seed = (s.seed * 16807) % 2147483647;
        const u = s.seed / 2147483647;
        s.bits.push({ t: f.t, a: u * Math.PI * 2, far: 150 + (k % 3) * 55, c: BITS[s.n++ % 8], kind: k % 3, spin: u * 6 });
      }
      s.bits = s.bits.slice(-42);
    }
    s.prev = s.prev * 0.8 + f.level * 0.2;
    s.bits = s.bits.filter(b => f.t - b.t < 0.9);
    ctx.clearRect(0, 0, w, h);
    // The pop: dots, squares and triangles flying out, spinning, fading.
    for (const b of s.bits) {
      const age = (f.t - b.t) / 0.9, d = R + 16 + b.far * Math.sqrt(age);
      ctx.save();
      ctx.translate(CX + Math.cos(b.a) * d, CY + Math.sin(b.a) * d);
      ctx.rotate(b.spin + age * 5);
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = b.c;
      ctx.beginPath();
      if (b.kind === 0) ctx.arc(0, 0, 5, 0, Math.PI * 2);
      else if (b.kind === 1) ctx.rect(-5, -5, 10, 10);
      else { ctx.moveTo(0, -6); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
    }
    // The beat's four steps, a quarter of the way round each.
    const now = Math.floor((f.t - s.phase) / BEAT), at = ((now % 4) + 4) % 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a0 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.24, a1 = a0 + Math.PI / 2 - 0.48, lit = on && i === at;
      ctx.globalAlpha = lit ? 1 : on ? 0.55 : 0.22;
      ctx.strokeStyle = lit ? f.color('accent') : ink;
      ctx.lineWidth = lit ? 11 : 7;
      ctx.beginPath(); ctx.arc(CX, CY, R, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};
`;

/** How the drums sound: three toys down the side, pulled up and down (Bounce, Ring, Fizz). */
export const TOYS = `// Three toys, one above the other, that change how the drums sound. Drag one
// up for more of it, down for less, or turn the wheel over it: Bounce (kbounce)
// is how far each hit's pitch drops, drawn as how high the ball bounces; Ring
// (kring) is how long a hit rings, drawn as the sound marks round a bell; Fizz
// (kfizz) is how much rattle each hit has, drawn as bubbles rising from a cup.
// They are drawn like the drums: flat, with the same hard shadow. The toy under
// the hand lifts and shows its setting on a plate above it.
const IDS = ['kbounce', 'kring', 'kfizz'];
const SHADE = '${SHADOW.color}', DROP = ${SHADOW.dy};
function plate(ctx, text, x, y, w, ink, paper) {
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * 7.4) + 20;
  const x0 = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(Math.round(x0), Math.round(y - 13), Math.round(tw), 26, 13); ctx.fill();
  ctx.fillStyle = paper; ctx.fillText(text, Math.round(x0 + 10), Math.round(y) + 0.5);
}
// Fill the path just traced twice: its shadow (lift more when it is under the hand), then itself.
function solid(ctx, trace, color, lift) {
  ctx.save(); ctx.translate(0, DROP + lift); trace(); ctx.fillStyle = SHADE; ctx.fill(); ctx.restore();
  trace(); ctx.fillStyle = color; ctx.fill();
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: -1, y0: 0, n0: 0 });
  },
  draw(ctx, f) {
    const s = f.state, p = f.pointer, w = f.w, zh = f.h / 3, t = f.t, cx = w / 2;
    const ink = f.color('fg'), cream = '#fff3df';
    const under = s.drag >= 0 ? s.drag : p && p.over ? Math.max(0, Math.min(2, Math.floor(p.y / zh))) : -1;
    ctx.clearRect(0, 0, w, f.h);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const z = i * zh, n = f.norm(IDS[i]), lift = i === under ? 4 : 0, floor = z + zh - 28;
      if (i === 0) {
        // Bounce: the ball's path, as high as Bounce, and the ball riding it over its shadow.
        const top = floor - 18 - n * (zh - 78), a = 22, b = w - 22, ride = u => floor - 13 - (floor - 13 - top) * 4 * u * (1 - u);
        ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.setLineDash([1, 8]);
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) { const u = k / 24; if (k) ctx.lineTo(a + (b - a) * u, ride(u)); else ctx.moveTo(a, ride(0)); }
        ctx.stroke(); ctx.setLineDash([]);
        const u = (t / 1.1) % 1, x = a + (b - a) * u, y = ride(u), high = (floor - 13 - y) / Math.max(1, floor - 13 - top);
        ctx.fillStyle = SHADE;
        ctx.beginPath(); ctx.ellipse(x, floor + 2, 13 - 5 * high, 4 - high, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = SHADE; ctx.beginPath(); ctx.roundRect(16, floor + 9, w - 32, 4, 2); ctx.fill();
        ctx.fillStyle = '#ff4b2b'; ctx.beginPath(); ctx.arc(x, y - lift, 13, 0, Math.PI * 2); ctx.fill();
      } else if (i === 1) {
        // Ring: a bell, with as many sound marks each side as it rings long.
        const bx = cx, by = z + zh / 2 + 4 - lift, marks = 1 + Math.round(n * 3);
        ctx.strokeStyle = ink; ctx.lineWidth = 4;
        for (let k = 0; k < marks; k++) {
          ctx.globalAlpha = 1 - k / (marks + 0.6);
          const rr = 36 + k * 11;
          ctx.beginPath(); ctx.arc(bx, by, rr, -0.5, 0.5); ctx.stroke();
          ctx.beginPath(); ctx.arc(bx, by, rr, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const bell = () => {
          ctx.beginPath();
          ctx.moveTo(bx - 25, by + 19);
          ctx.quadraticCurveTo(bx - 19, by + 12, bx - 18, by - 4);
          ctx.quadraticCurveTo(bx - 17, by - 26, bx, by - 26);
          ctx.quadraticCurveTo(bx + 17, by - 26, bx + 18, by - 4);
          ctx.quadraticCurveTo(bx + 19, by + 12, bx + 25, by + 19);
          ctx.closePath();
        };
        solid(ctx, () => { ctx.beginPath(); ctx.arc(bx, by + 23, 6, 0, Math.PI * 2); }, ink, lift);
        solid(ctx, bell, '#ffc531', lift);
        ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(bx, by - 30, 4.5, 0, Math.PI * 2); ctx.fill();
      } else {
        // Fizz: a cup, and bubbles rising from it, as many as there is fizz.
        const top = floor - 40 - lift, count = Math.round(n * 12), span = top - (z + 34);
        for (let k = 0; k < Math.max(1, count); k++) {
          const seed = Math.sin(k * 12.9898) * 43758.5453, u = seed - Math.floor(seed);
          const x = cx - 22 + u * 44 + Math.sin(t * 3 + k) * 3, y = top - 6 - ((t * (16 + u * 18) + u * span) % span);
          ctx.globalAlpha = count ? 1 : 0.4;
          ctx.fillStyle = cream; ctx.strokeStyle = ink; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 3 + u * 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        solid(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(cx - 32, top); ctx.lineTo(cx + 32, top); ctx.lineTo(cx + 24, floor + 4 - lift); ctx.lineTo(cx - 24, floor + 4 - lift);
          ctx.closePath();
        }, '#12a594', lift);
        ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(cx - 34, top - 3, 68, 6, 3); ctx.fill();
      }
    }
    // The setting of the toy under the hand, on a plate above it.
    if (under >= 0) {
      const v = f.value(IDS[under]);
      const text = under === 0 ? 'bounce ' + Math.round(v) + ' st ↕' : under === 1 ? 'ring ' + v.toFixed(2) + ' s ↕' : 'fizz ' + v.toFixed(2) + ' ↕';
      plate(ctx, text, cx, under * zh + 16, w, ink, cream);
    }
  },
  pointer(e, f) {
    const zh = f.h / 3, s = f.state, at = Math.max(0, Math.min(2, Math.floor(e.y / zh)));
    if (e.type === 'down') {
      s.drag = at;
      s.y0 = e.y;
      s.n0 = f.norm(IDS[at]);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = -1;
    if (s.drag >= 0 && e.type === 'move')
      f.setNorm(IDS[s.drag], Math.max(0, Math.min(1, s.n0 + (s.y0 - e.y) / (zh * 1.6))));
    if (e.type === 'wheel') f.setNorm(IDS[at], Math.max(0, Math.min(1, f.norm(IDS[at]) - Math.sign(e.dy) * 0.05)));
    f.cursor('ns-resize');
  },
};
`;

/** A drum's shape, in a 100×100 box: its outline, where its head is scaled about, its bolts. */
interface Shape {
  name: string;
  /** The outline (SVG path data). */
  d: string;
  /** The head inside the rim: the outline scaled about `mid`, unless the shape has its own. */
  mid: [number, number];
  head?: string;
  /** The pad's outline in CSS (clip-path), so a tap lights the drum in its own shape. */
  clip: (s: number) => string;
  /** Points on the rim that the bolts sit round (the head's middle pulled out to them). */
  bolts: Array<[number, number]>;
}
const poly = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
const clipPoly = (pts: Array<[number, number]>) =>
  `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
const mids = (pts: Array<[number, number]>) =>
  pts.map(([x, y], i): [number, number] => {
    const [u, v] = pts[(i + 1) % pts.length]!;
    return [(x + u) / 2, (y + v) / 2];
  });
const round = (cx: number, cy: number, r: number, n: number, from = 0, to = 360) =>
  Array.from({ length: n }, (_, i): [number, number] => {
    const a = ((from + ((to - from) * (i + 0.5)) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
const TRIANGLE: Array<[number, number]> = [
  [50, 8],
  [94, 88],
  [6, 88],
];
const DIAMOND: Array<[number, number]> = [
  [50, 4],
  [96, 50],
  [50, 96],
  [4, 50],
];
const HEXAGON: Array<[number, number]> = [
  [50, 6],
  [88, 28],
  [88, 72],
  [50, 94],
  [12, 72],
  [12, 28],
];
const STAR: Array<[number, number]> = [
  [50, 6],
  [61, 38],
  [95, 38],
  [68, 58],
  [78, 92],
  [50, 72],
  [22, 92],
  [32, 58],
  [5, 38],
  [39, 38],
];
/** The half moon's dome, from its left corner over the top to its right one. */
const DOME = round(50, 74, 48, 16, 180, 360);
const SHAPES: Shape[] = [
  {
    name: 'Circle',
    d: 'M50 8 A42 42 0 1 1 49.99 8 Z',
    mid: [50, 50],
    clip: () => 'circle(42% at 50% 50%)',
    bolts: round(50, 50, 42, 8),
  },
  {
    name: 'Square',
    d: 'M24 12 H76 A12 12 0 0 1 88 24 V76 A12 12 0 0 1 76 88 H24 A12 12 0 0 1 12 76 V24 A12 12 0 0 1 24 12 Z',
    mid: [50, 50],
    clip: () => 'inset(12% round 12%)',
    bolts: mids([
      [12, 12],
      [88, 12],
      [88, 88],
      [12, 88],
    ]),
  },
  {
    name: 'Triangle',
    d: poly(TRIANGLE),
    mid: [50, 61],
    clip: () => clipPoly(TRIANGLE),
    bolts: mids(TRIANGLE),
  },
  {
    name: 'Diamond',
    d: poly(DIAMOND),
    mid: [50, 50],
    clip: () => clipPoly(DIAMOND),
    bolts: mids(DIAMOND),
  },
  {
    name: 'Hexagon',
    d: poly(HEXAGON),
    mid: [50, 50],
    clip: () => clipPoly(HEXAGON),
    bolts: mids(HEXAGON),
  },
  { name: 'Star', d: poly(STAR), mid: [50, 55], clip: () => clipPoly(STAR), bolts: [] },
  {
    name: 'Half moon',
    d: 'M2 74 A48 48 0 0 1 98 74 Z',
    mid: [50, 56],
    clip: () =>
      clipPoly([
        [2, 74],
        ...DOME.map(([x, y]): [number, number] => [+x.toFixed(1), +y.toFixed(1)]),
        [98, 74],
      ]),
    bolts: round(50, 74, 48, 5, 180, 360),
  },
  {
    name: 'Ring',
    d: 'M50 8 A42 42 0 1 1 49.99 8 Z M50 24 A26 26 0 1 0 50.01 24 Z',
    mid: [50, 50],
    head: 'M50 12 A38 38 0 1 1 49.99 12 Z M50 20 A30 30 0 1 0 50.01 20 Z',
    // A ring with its hole: the pad is clipped to the band (in pixels of a pad s across).
    clip: s => {
      const k = s / 100;
      // From the top of the circle nearly all the way round: clockwise for the edge, back the other way for the hole.
      const c = (r: number, sweep: 0 | 1) =>
        `M${50 * k} ${(50 - r) * k} A${r * k} ${r * k} 0 1 ${sweep} ${(sweep ? 49.99 : 50.01) * k} ${(50 - r) * k} Z`;
      return `path(evenodd, '${c(42, 1)} ${c(26, 0)}')`;
    },
    bolts: [],
  },
];
/** How far in the head starts: the rim is the outline's last 18 % towards the middle. */
const HEAD = 0.82;
const channels = (c: string) =>
  [0, 1, 2].map(i => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16) / 255);
const hex = (rgb: number[]) =>
  `#${rgb
    .map(v =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** Mix two #rrggbb colours: `k` of the second. */
function mix(a: string, b: string, k: number): string {
  const x = channels(a),
    y = channels(b);
  return hex(x.map((v, i) => v * (1 - k) + y[i]! * k));
}
/** A colour moved in lightness and saturation, keeping its hue (HSL). */
function shift(c: string, dl: number, ds: number): string {
  const [r, g, b] = channels(c) as [number, number, number];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d
    ? 0
    : max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  const L = Math.max(0.12, Math.min(0.92, l + dl)),
    S = Math.max(0, Math.min(1, s + ds)),
    C = (1 - Math.abs(2 * L - 1)) * S,
    X = C * (1 - Math.abs((h % 2) - 1)),
    m = L - C / 2;
  const [u, v, w] = [
    [C, X, 0],
    [X, C, 0],
    [0, C, X],
    [0, X, C],
    [X, 0, C],
    [C, 0, X],
  ][Math.floor(h) % 6]!;
  return hex([u! + m, v! + m, w! + m]);
}
/** The rim of a drum: its colour, darker and a little richer. */
const rimOf = (c: string) => shift(c, -0.16, 0.08);
/** How light a colour looks (0 black, 1 white). */
const lightness = (c: string) => {
  const [r, g, b] = channels(c) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** The wash a tapped drum takes. */
function litOf(c: string): string {
  const lit = lightness(c) > 0.8 ? rimOf(c) : shift(c, 0.16, 0.1);
  const [r, g, b] = channels(lit).map(v => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, 0.7)`;
}
/** A drum as an SVG picture a little bigger than its pad (room for the shadow): rim, head, bolts. */
function drumSvg(shape: Shape, color: string, s: number): string {
  const m = (8 * 100) / s,
    dy = (SHADOW.dy * 100) / s,
    [mx, my] = shape.mid;
  const rim = rimOf(color),
    bolt = mix(rim, '#fff3df', 0.55);
  const outline = (fill: string, extra = '') =>
    `<path d="${shape.d}" fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="5" stroke-linejoin="round"${extra}/>`;
  const head = shape.head
    ? `<path d="${shape.head}" fill="${color}" fill-rule="evenodd"/>`
    : `<path d="${shape.d}" fill="${color}" transform="translate(${mx * (1 - HEAD)} ${my * (1 - HEAD)}) scale(${HEAD})"/>`;
  const bolts = shape.bolts
    .map(([x, y]) => {
      const bx = mx + (x - mx) * 0.91,
        by = my + (y - my) * 0.91;
      return `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="2.6" fill="${bolt}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${100 + 2 * m} ${100 + 2 * m}"><g transform="translate(0 ${dy.toFixed(2)})">${outline(SHADOW.color)}</g>${outline(rim)}${head}${bolts}</svg>`;
}

/** The drums round the Beat: the lowest note biggest, at the bottom; the highest smallest, at the top (a square box, s across). */
const DRUMS = [
  { shape: 0, note: 48, color: '#2c45cf', x: 144, y: 415, s: 150 },
  { shape: 1, note: 50, color: '#ff4b2b', x: 319, y: 420, s: 140 },
  { shape: 2, note: 52, color: '#ffc531', x: 36, y: 304, s: 132 },
  { shape: 3, note: 55, color: '#3d1446', x: 443, y: 307, s: 126 },
  { shape: 4, note: 57, color: '#12a594', x: 67, y: 159, s: 118 },
  { shape: 5, note: 60, color: '#fff3df', x: 426, y: 162, s: 112 },
  { shape: 6, note: 62, color: '#ff8a1e', x: 186, y: 86, s: 106 },
  { shape: 7, note: 64, color: '#49b6f4', x: 319, y: 89, s: 100 },
];

export function toy(catalog: Catalog) {
  return work(
    'toy',
    'Shape Drums',
    catalog,
    [760, 580],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
      add('penv1', 'den.envelope', {
        label: 'Pitch Env',
        values: { attack: 0, decay: 0.07, sustain: 0, release: 0.04 },
      }),
      add('pdepth1', 'kit.mul', { label: 'Bounce' }),
      add('pmod1', 'kit.pitchMod'),
      add('osc1', 'den.oscillator', { config: { waveform: 'sine' } }),
      add('noise1', 'den.seededNoise'),
      add('nfreq1', 'kit.mul', { label: 'Noise Pitch', values: { b: 3 } }),
      add('nfilter1', 'den.stateVariableFilter', { values: { q: 2.2 } }),
      add('nenv1', 'den.envelope', {
        label: 'Noise Env',
        values: { attack: 0, decay: 0.05, sustain: 0, release: 0.03 },
      }),
      add('nvca1', 'kit.mul', { label: 'Noise VCA' }),
      add('mix1', 'kit.mix', { config: { channels: 2 } }),
      add('aenv1', 'den.envelope', {
        label: 'Amp Env',
        values: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.06 },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vmix1', 'kit.voiceMix'),
      add('gain1', 'kit.gain', { values: { gain: 0.4 } }),
      add('room1', 'den.algorithmicReverb', {
        config: { roomScale: 0.7, decaySeconds: 0.9, dampingHz: 7000 },
        values: { mix: 0.16 },
      }),
      add('out1', 'kit.out'),
      wire('penv1.level', 'pdepth1.a'),
      wire('pdepth1.out', 'pmod1.semitones'),
      wire('voice1.pitch', 'pmod1.hz'),
      wire('pmod1.out', 'osc1.frequency'),
      wire('voice1.pitch', 'nfreq1.a'),
      wire('nfreq1.out', 'nfilter1.cutoffHz'),
      wire('noise1.out', 'nfilter1.input'),
      wire('nfilter1.bandpass', 'nvca1.a'),
      wire('nenv1.level', 'nvca1.b'),
      wire('osc1.out', 'mix1.in1'),
      wire('nvca1.out', 'mix1.in2'),
      wire('mix1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'vmix1.in'),
      wire('aenv1.done', 'vmix1.done'),
      wire('vmix1.out', 'gain1.in'),
      wire('room1.left', 'out1.left'),
      wire('room1.right', 'out1.right'),
      // ---- a beat to play along with: a soft shaker, on when the switch is ----
      add('beat1', 'den.musicalLfo', {
        label: 'Beat',
        config: { mode: 'tempo', waveform: 'square', beatsPerCycle: '1' },
        values: { rate: 100 },
      }),
      add('bgate1', 'kit.compare', { label: 'On the beat', values: { b: 0 } }),
      add('benv1', 'den.envelope', {
        label: 'Shake',
        values: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.05 },
      }),
      add('bnoise1', 'den.seededNoise', { label: 'Beads', config: { seed: 3 } }),
      add('bband1', 'den.stateVariableFilter', {
        label: 'Shaker',
        values: { cutoffHz: 6500, q: 1.4 },
      }),
      add('bvca1', 'kit.mul', { label: 'Shaker VCA' }),
      add('bon1', 'kit.mul', { label: 'Beat on' }),
      add('blevel1', 'kit.gain', { label: 'Beat level', values: { gain: 0.5 } }),
      add('sum1', 'kit.add', { label: 'Drums + beat' }),
      wire('beat1.value', 'bgate1.a'),
      wire('bgate1.out', 'benv1.gate'),
      wire('bnoise1.out', 'bband1.input'),
      wire('bband1.bandpass', 'bvca1.a'),
      wire('benv1.level', 'bvca1.b'),
      wire('bvca1.out', 'bon1.a'),
      wire('bon1.out', 'blevel1.in'),
      wire('gain1.out', 'sum1.a'),
      wire('blevel1.out', 'sum1.b'),
      wire('sum1.out', 'room1.left'),
      wire('sum1.out', 'room1.right'),
      // ---- the plugin: shapes that are drums, in a circle round the Beat ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#f7a6c6',
            fg: INK,
            accent: '#ff4b2b',
            track: '#e98bb2',
            knob: '#fff3df',
            pointer: INK,
            muted: '#6d2a62',
            glow: '#ff4b2b',
            font: 'fredoka',
            labelFont: 'fredoka',
            valueFont: 'fredoka',
          },
          background: [{ kind: 'color', color: '#f7a6c6' }],
          skins: { toggle: { name: 'button', params: { radius: 56 } } },
          css: [
            // The Beat: a round ink button that turns red while the beat plays, casting the drums' shadow.
            `[data-widget=tbeat] dk-toggle::part(button) { border: 0; background: ${INK}; color: #fff3df; font-size: 22px; font-weight: 600; box-shadow: 0 ${SHADOW.dy}px 0 ${SHADOW.color}; }`,
            '[data-widget=tbeat] dk-toggle[aria-checked=true]::part(button) { background: #ff4b2b; color: #fff3df; }',
            // Each pad is clipped to its drum's outline, so a tap lights the drum in its own shape.
            ...DRUMS.map(
              (d, i) =>
                `[data-widget=pads${i + 1}] dk-keyboard::part(keyboard) { clip-path: ${SHAPES[d.shape]!.clip(d.s)}; }`,
            ),
          ].join('\n'),
        },
      },
      el({ kind: 'canvas', name: 'Floor', code: BOARD, rect: r(0, 0, 760, 580) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Shape Drums',
        rect: r(36, 22, 360, 44),
        textStyle: { font: 'fredoka', size: 36, weight: 600, color: 'fg', align: 'left' },
      }),
      // Each drum: its picture, and over it a see-through pad that lights in its shape when tapped.
      ...DRUMS.flatMap((d, i) => {
        const shape = SHAPES[d.shape]!;
        return [
          el({
            kind: 'svg',
            name: `${shape.name} drum`,
            svg: drumSvg(shape, d.color, d.s),
            rect: r(d.x - 8, d.y - 8, d.s + 16, d.s + 16),
          }),
          ...control(
            `pads${i + 1}`,
            'ui.keyboard',
            `${shape.name} drum`,
            null,
            r(d.x, d.y, d.s, d.s),
            {
              style: {
                skin: {
                  name: 'pads',
                  params: {
                    count: 1,
                    columns: 1,
                    start: d.note,
                    scale: 'same',
                    colors: 'outline',
                    press: 'sink',
                    radius: 0,
                    gap: 0,
                    labels: '\u200b',
                  },
                },
                // A tap lights a drum: a lighter, richer wash of its own colour (a drum too light for that takes its rim's).
                tokens: { accent: litOf(d.color) },
              },
            },
          ),
        ];
      }),
      ...control('tbeat', 'ui.toggle', 'Beat', 'bon1.b', r(MID.x - 56, MID.y - 56, 112, 112), {
        value: false,
        style: { textStyle: { font: 'fredoka', size: 22, weight: 600 } },
      }),
      // How the drums sound: three toys down the side, pulled up and down.
      ...patchControl('kbounce', 'Bounce', 'pdepth1.b', [0, 24, 'linear', 'st'], 14),
      ...patchControl('kring', 'Ring', 'aenv1.decay', [0.05, 1.2, 'log', 's'], 0.3),
      ...patchControl('kfizz', 'Fizz', 'mix1.level2', [0, 2, 'linear', ''], 0.5),
      el({ kind: 'canvas', name: 'Toys', code: TOYS, rect: r(600, 92, 144, 476) }),
    ],
  );
}

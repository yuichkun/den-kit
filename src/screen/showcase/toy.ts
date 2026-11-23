// Shape Drums — a drum toy for children: eight shapes to tap, and a beat to join.
// Pitched toy drums (a sine with a pitch drop plus a little filtered noise) on
// a pentatonic scale, so any two taps sound good together; a soft shaker beat
// can be switched on to play along with.
// The design follows the thinking of Rytmos (Apple Design Awards 2024,
// Interaction): play is clear without being explained, the gestures are simple
// and fun, and each thing added joins the music. The screen is a playroom seen
// from straight above: a foam play mat of three tiles by three fills its height,
// running off the top, the left and the bottom, with one drum on each outer tile
// and the Beat on the middle one. The low notes are big on the bottom row and
// the high ones small on the top, rising left to right, so size is pitch and
// nothing needs reading. Every drum is drawn by one rule: a flat head in its own
// colour, a rim round its edge with bolts spaced evenly along it, and the same
// hard shadow. A tapped drum lights in its own shape (the pad is clipped to it),
// four studs round the Beat count its steps while it plays, and each hit sends
// a pop of bits out from the middle. How the drums sound is three toys on the
// floor beside the mat, under the name of the work, each centred beside a row
// of the mat: a ball that bounces higher (Bounce), a top that spins longer
// (Ring) and a glass of soda that fizzes more (Fizz); the one under the hand
// lifts, and its name gets a row of dots for how much.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The ink of the work: text, shadows, the Beat. */
const INK = '#2c0d31';
/** The hard shadow every drum and toy casts: straight down, this far, in the ink. */
const SHADOW = { dy: 7, opacity: 0.3, color: 'rgba(44, 13, 49, 0.3)' };
/** The plugin's size. */
const W = 760,
  H = 580;
/** The foam mat: three tiles by three, as tall as the plugin (running off its top, left and bottom), and a border strip this wide down its right side. */
export const MAT = {
  tile: H / 3,
  border: 24,
  color: '#f7a6c6',
  groove: '#d77ba4',
  light: '#ffc8de',
};
/** The floor beside the mat: painted boards running up the screen, their joints a shade darker, the ends of their lengths on the lines of the mat's seams. */
const FLOOR = { x: 3 * MAT.tile + MAT.border, color: '#c42f6c', joint: '#ad2860' };
/** The middle of the middle tile, where the Beat sits. */
const MID = { x: 1.5 * MAT.tile, y: 1.5 * MAT.tile };
/** The Beat's four studs, on a ring this far from its middle. */
const STUDS = { r: 75 };

/** The mat under the drums: four studs round the Beat count the beat's steps, and a pop of bits flies out with every hit. */
export const BOARD = `// On the mat, under the drums. Round the Beat button are four studs on a dotted
// ring, one for each step of the beat, at twelve, three, six and nine o'clock:
// while the beat is on (tbeat) the step it is on lights. The beat plays at 100
// a minute, and each hit heard pulls the steps towards it, so they follow the
// shaker even though a canvas cannot see the beat itself. A hit is a jump in
// the output level: a pop of small bits flies out from the middle, between the
// drums, and fades; the bigger the jump, the more bits (a drum sends a handful,
// the soft shaker one or two).
const CX = ${MID.x}, CY = ${MID.y}, R = ${STUDS.r};
const CREAM = '#fff3df', SHADE = '${SHADOW.color}';
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
    // The beat's four steps: a dotted ring printed round the Beat, and on it four
    // studs with the drums' hard shadow, the one the beat is on lit.
    ctx.fillStyle = ink; ctx.globalAlpha = 0.24;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(CX + Math.cos(a) * R, CY + Math.sin(a) * R, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const now = Math.floor((f.t - s.phase) / BEAT), at = ((now % 4) + 4) % 4;
    for (let i = 0; i < 4; i++) {
      const lit = on && i === at, a = (i - 1) * Math.PI / 2, x = CX + Math.cos(a) * R, y = CY + Math.sin(a) * R, rr = lit ? 9 : 7;
      ctx.fillStyle = SHADE; ctx.beginPath(); ctx.arc(x, y + 3, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? f.color('accent') : CREAM; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }
  },
};
`;

/** How the drums sound: three toys on the floor beside the mat, pulled up and down (Bounce, Ring, Fizz). */
export const TOYS = `// Three toys on the floor beside the mat, one beside each row of it, that change
// how the drums sound. Drag one up for more of it, down for less, or turn the wheel
// over it: Bounce (kbounce) is how far each hit's pitch drops, drawn as how high
// a ball bounces; Ring (kring) is how long a hit rings, drawn as how long a top
// spins (the trail it leaves on the floor); Fizz (kfizz) is how much rattle each
// hit has, drawn as the bubbles in a glass of soda. They are drawn like the
// drums: flat, in the drums' colours, with the same hard shadow. Each has its
// name under it, and the toy and its name are centred on the row as the drums
// are on theirs; the toy under the hand lifts, and a row of five dots under its
// name says how much.
const IDS = ['kbounce', 'kring', 'kfizz'];
const NAMES = ['BOUNCE', 'RING', 'FIZZ'];
const SHADE = '${SHADOW.color}', DROP = ${SHADOW.dy};
const RED = '#ff4b2b', YELLOW = '#ffc531', TEAL = '#12a594', CREAM = '#fff3df';
// How far each toy reaches above the floor it stands on (the ball at its highest hop, the top's knob, the straw), and how far below it its name sits.
const TOP = [62, 62, 96], NAME = 28;
// Fill the path just traced twice: its shadow (lift more when it is under the hand), then itself.
function solid(ctx, trace, color, lift) {
  ctx.save(); ctx.translate(0, DROP + lift); trace(); ctx.fillStyle = SHADE; ctx.fill(); ctx.restore();
  trace(); ctx.fillStyle = color; ctx.fill();
}
// A dotted line along a run of points: the way the ball goes, the trail the top leaves.
function dotted(ctx, pts, gap) {
  let left = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], len = Math.hypot(x1 - x0, y1 - y0);
    while (left <= len) {
      const u = len ? left / len : 0;
      ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 1.6, 0, Math.PI * 2); ctx.fill();
      left += gap;
    }
    left -= len;
  }
}
// A toy's name, and under it (while the hand is on it) five dots, as many filled as there is of it.
function name(ctx, i, x, y, n, shown) {
  ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const spaced = 'letterSpacing' in ctx;
  if (spaced) ctx.letterSpacing = '2px';
  ctx.fillStyle = CREAM; ctx.fillText(NAMES[i], x + (spaced ? 1 : 0), y);
  if (spaced) ctx.letterSpacing = '0px';
  if (!shown) return;
  const full = Math.round(n * 5);
  ctx.lineWidth = 1.5; ctx.strokeStyle = CREAM; ctx.fillStyle = CREAM;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath(); ctx.arc(x + (k - 2) * 11, y + 17, 3.2, 0, Math.PI * 2);
    if (k < full) ctx.fill(); else ctx.stroke();
  }
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: -1, y0: 0, n0: 0 });
  },
  draw(ctx, f) {
    const s = f.state, p = f.pointer, w = f.w, zh = f.h / 3, t = f.t, cx = w / 2;
    const under = s.drag >= 0 ? s.drag : p && p.over ? Math.max(0, Math.min(2, Math.floor(p.y / zh))) : -1;
    ctx.clearRect(0, 0, w, f.h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      // Where the toy stands: the toy and its name (6 px either side of its middle) centred on the row, the shadow's drop counted in as for the drums.
      const z = i * zh, n = f.norm(IDS[i]), lift = i === under ? 4 : 0, floor = z + zh / 2 - DROP / 2 + (TOP[i] - NAME - 6) / 2;
      if (i === 0) {
        // Bounce: a ball bouncing along the floor, its first hop as high as Bounce, each next one lower.
        const H = 10 + n * (TOP[0] - 32), hops = [H, H * 0.45, H * 0.2], a = 16, b = w - 16, R = 11;
        const widths = hops.map(v => Math.sqrt(v + 4)), sum = widths.reduce((q, v) => q + v, 0);
        const path = [], at = [];
        let x0 = a;
        for (let k = 0; k < 3; k++) {
          const wk = ((b - a) * widths[k]) / sum;
          at.push([x0, wk, hops[k]]);
          for (let j = 0; j <= 14; j++) { const u = j / 14; path.push([x0 + wk * u, floor - R - hops[k] * 4 * u * (1 - u)]); }
          x0 += wk;
        }
        ctx.fillStyle = CREAM; ctx.globalAlpha = 0.55; dotted(ctx, path, 7); ctx.globalAlpha = 1;
        const x = a + (b - a) * ((t / 1.8) % 1), hop = at.find(q => x <= q[0] + q[1]) || at[2];
        const u = Math.max(0, Math.min(1, (x - hop[0]) / hop[1])), rise = hop[2] * 4 * u * (1 - u), y = floor - R - rise - lift;
        ctx.fillStyle = SHADE;
        ctx.beginPath(); ctx.ellipse(x, floor + 3, R * (1 - 0.4 * (rise / (H + 1))), 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
        // A cream band round the ball, turning as it rolls.
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
        ctx.translate(x, y); ctx.rotate(x / R);
        ctx.strokeStyle = CREAM; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.arc(0, -R * 1.9, R * 1.55, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (i === 1) {
        // Ring: a top spinning on the floor, and the trail it has drawn, as many turns as it rings long.
        const tx = cx + 6, turns = 0.6 + n * 1.9, trail = [];
        for (let k = 0; k <= 160; k++) {
          const u = k / 160, ang = Math.PI * 0.5 + u * turns * Math.PI * 2, rr = 6 + u * 52;
          trail.push([tx + Math.cos(ang) * rr, floor + Math.sin(ang) * rr * 0.32]);
        }
        ctx.fillStyle = CREAM; ctx.globalAlpha = 0.55; dotted(ctx, trail, 6.5); ctx.globalAlpha = 1;
        const wob = Math.sin(t * 4.2) * 0.07, by = floor - lift;
        ctx.save(); ctx.translate(tx, by); ctx.rotate(wob);
        const body = () => {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(-8, -6, -27, -18, -27, -31);
          ctx.bezierCurveTo(-27, -40, -20, -46, -12, -47);
          ctx.lineTo(12, -47);
          ctx.bezierCurveTo(20, -46, 27, -40, 27, -31);
          ctx.bezierCurveTo(27, -18, 8, -6, 0, 0);
          ctx.closePath();
        };
        solid(ctx, () => { ctx.beginPath(); ctx.roundRect(-4.5, -62, 9, 18, 4.5); }, RED, lift);
        solid(ctx, body, YELLOW, lift);
        // Its stripes slide round as it spins.
        ctx.save(); body(); ctx.clip();
        ctx.fillStyle = RED; ctx.fillRect(-30, -33, 60, 7);
        ctx.fillStyle = CREAM; ctx.fillRect(-30, -42, 60, 3);
        ctx.fillStyle = 'rgba(44, 13, 49, 0.16)';
        for (let k = 0; k < 4; k++) {
          const sx = ((t * 70 + k * 15) % 60) - 30;
          ctx.beginPath(); ctx.ellipse(sx, -30, 2.2, 16, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.restore();
      } else {
        // Fizz: a glass of soda with a straw, as many bubbles rising in it as there is fizz.
        const gx = cx - 4, top = floor - 76 - lift, bot = floor - lift, wTop = 25, wBot = 20, level = top + 14;
        const side = y => wBot + ((wTop - wBot) * (bot - y)) / (bot - top);
        const glass = () => {
          ctx.beginPath();
          ctx.moveTo(gx - wTop, top); ctx.lineTo(gx + wTop, top); ctx.lineTo(gx + wBot, bot); ctx.lineTo(gx - wBot, bot);
          ctx.closePath();
        };
        // The straw first, so the glass's near side covers its foot.
        ctx.save(); ctx.translate(gx + 4, bot - 16); ctx.rotate(-0.42);
        ctx.fillStyle = CREAM; ctx.fillRect(-3.5, -86, 7, 86);
        ctx.fillStyle = RED;
        for (let k = 0; k < 7; k++) ctx.fillRect(-3.5, -86 + k * 13, 7, 6);
        ctx.restore();
        ctx.save(); ctx.translate(0, DROP + lift); glass(); ctx.fillStyle = SHADE; ctx.fill(); ctx.restore();
        // The soda, a cream head of foam, the bubbles.
        ctx.save(); glass(); ctx.clip();
        ctx.fillStyle = 'rgba(255, 243, 223, 0.28)'; ctx.fillRect(gx - 30, top, 60, bot - top);
        ctx.fillStyle = TEAL; ctx.fillRect(gx - 30, level, 60, bot - level);
        const count = Math.round(n * 16);
        ctx.fillStyle = CREAM;
        for (let k = 0; k < count; k++) {
          const seed = Math.sin(k * 12.9898) * 43758.5453, u = seed - Math.floor(seed), span = bot - 8 - level;
          const y = bot - 8 - ((t * (14 + u * 22) + u * span) % span), half = side(y) - 6;
          ctx.globalAlpha = 0.95;
          ctx.beginPath(); ctx.arc(gx - half + ((u * 7919) % 1) * half * 2, y, 1.6 + u * 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillRect(gx - 30, level - 2, 60, 4);
        ctx.restore();
        // The glass: its rim and sides catch the light; a thick base.
        ctx.strokeStyle = CREAM; ctx.lineWidth = 2.5; glass(); ctx.stroke();
        ctx.fillStyle = CREAM; ctx.beginPath(); ctx.roundRect(gx - wBot, bot - 6, wBot * 2, 6, 2); ctx.fill();
        // Fizz above the glass: a few drops jumping out of the top.
        const out = Math.round(n * 6);
        for (let k = 0; k < out; k++) {
          const u = (t * 1.3 + k / Math.max(1, out)) % 1, ox = gx - 14 + ((k * 37) % 28);
          ctx.globalAlpha = 1 - u;
          ctx.beginPath(); ctx.arc(ox, top - 4 - u * 22, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      name(ctx, i, cx, floor + NAME, n, i === under);
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

type Pt = [number, number];
/** Points round an arc (degrees, clockwise on screen). */
const arc = (cx: number, cy: number, r: number, from: number, to: number, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
/** Points along cubic curves: a start, then each curve's two handles and its end. */
function cubics(start: Pt, curves: Array<[Pt, Pt, Pt]>, n = 24): Pt[] {
  const out: Pt[] = [start];
  let p0 = start;
  for (const [p1, p2, p3] of curves) {
    for (let i = 1; i <= n; i++) {
      const t = i / n,
        a = (1 - t) ** 3,
        b = 3 * (1 - t) ** 2 * t,
        c = 3 * (1 - t) * t * t,
        d = t ** 3;
      out.push([
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ]);
    }
    p0 = p3;
  }
  return out;
}
const curvePath = (start: Pt, curves: Array<[Pt, Pt, Pt]>) =>
  `M${start.join(' ')} ${curves.map(c => `C${c.map(p => p.join(' ')).join(' ')}`).join(' ')}`;
const lines = (pts: Pt[]): Pt[][] => pts.map((p, i) => [p, pts[(i + 1) % pts.length]!]);
const poly = (pts: Pt[]) => `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
const length = (run: Pt[]) =>
  run.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - run[i]![0], y - run[i]![1]), 0);
/** The point a share `u` of the way along a run of points. */
function along(run: Pt[], u: number): Pt {
  let left = u * length(run);
  for (let i = 1; i < run.length; i++) {
    const [x0, y0] = run[i - 1]!,
      [x1, y1] = run[i]!,
      len = Math.hypot(x1 - x0, y1 - y0);
    if (left <= len)
      return [x0 + ((x1 - x0) * left) / (len || 1), y0 + ((y1 - y0) * left) / (len || 1)];
    left -= len;
  }
  return run[run.length - 1]!;
}

/** A drum's shape, in a 100×100 box: its outline, and the runs of its edge (straight sides, curves) in order. */
interface Shape {
  name: string;
  /** The outline (SVG path data). */
  d: string;
  /** The edge, run by run: bolts are spaced evenly along each run. */
  runs: Pt[][];
}
/** Bolts sit this far apart along the edge (in the box's units, so a bigger drum has bigger, wider-set bolts). */
const BOLT_GAP = 24;
/** The rim: a band this wide (box units) centred on the outline, its bolts on the outline itself. */
const RIM = 10;
const TRIANGLE: Pt[] = [
  [50, 8],
  [94, 88],
  [6, 88],
];
const DIAMOND: Pt[] = [
  [50, 4],
  [96, 50],
  [50, 96],
  [4, 50],
];
const HEXAGON: Pt[] = [
  [50, 6],
  [88, 28],
  [88, 72],
  [50, 94],
  [12, 72],
  [12, 28],
];
const STAR: Pt[] = [
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
/** The heart's two halves: from the dip at the top round the right to the point, and back up the left. */
const HEART_TOP: Pt = [50, 23];
const HEART_RIGHT: Array<[Pt, Pt, Pt]> = [
  [
    [52, 16],
    [57, 11],
    [65, 10],
  ],
  [
    [77, 9],
    [90, 17],
    [92, 33],
  ],
  [
    [94, 52],
    [78, 70],
    [50, 90],
  ],
];
const HEART_LEFT: Array<[Pt, Pt, Pt]> = [
  [
    [22, 70],
    [6, 52],
    [8, 33],
  ],
  [
    [10, 17],
    [23, 9],
    [35, 10],
  ],
  [
    [43, 11],
    [48, 16],
    [50, 23],
  ],
];
const SHAPES: Shape[] = [
  { name: 'Circle', d: 'M50 8 A42 42 0 1 1 49.99 8 Z', runs: [arc(50, 50, 42, -90, 270, 96)] },
  {
    name: 'Square',
    d: 'M24 12 H76 A12 12 0 0 1 88 24 V76 A12 12 0 0 1 76 88 H24 A12 12 0 0 1 12 76 V24 A12 12 0 0 1 24 12 Z',
    runs: [
      [
        [24, 12],
        [76, 12],
      ],
      arc(76, 24, 12, -90, 0, 12),
      [
        [88, 24],
        [88, 76],
      ],
      arc(76, 76, 12, 0, 90, 12),
      [
        [76, 88],
        [24, 88],
      ],
      arc(24, 76, 12, 90, 180, 12),
      [
        [12, 76],
        [12, 24],
      ],
      arc(24, 24, 12, 180, 270, 12),
    ],
  },
  { name: 'Triangle', d: poly(TRIANGLE), runs: lines(TRIANGLE) },
  { name: 'Diamond', d: poly(DIAMOND), runs: lines(DIAMOND) },
  { name: 'Hexagon', d: poly(HEXAGON), runs: lines(HEXAGON) },
  { name: 'Star', d: poly(STAR), runs: lines(STAR) },
  {
    name: 'Half moon',
    d: 'M2 74 A48 48 0 0 1 98 74 Z',
    runs: [
      arc(50, 74, 48, 180, 360, 64),
      [
        [98, 74],
        [2, 74],
      ],
    ],
  },
  {
    name: 'Heart',
    d: `${curvePath(HEART_TOP, HEART_RIGHT)} ${curvePath([50, 90], HEART_LEFT).replace(/^M[^C]*/, '')} Z`,
    runs: [cubics(HEART_TOP, HEART_RIGHT), cubics([50, 90], HEART_LEFT)],
  },
];
/** The bolts round a drum: on its outline, evenly along each run of its edge. */
const boltsOf = (shape: Shape): Pt[] =>
  shape.runs.flatMap(run => {
    const k = Math.max(1, Math.round(length(run) / BOLT_GAP));
    return Array.from({ length: k }, (_, j) => along(run, (j + 0.5) / k));
  });
/** The outline's points, in order (each run's end is the next one's start). */
const outlineOf = (shape: Shape): Pt[] => shape.runs.flatMap(run => run.slice(0, -1));
/** The box round the outline (box units). */
function boundsOf(shape: Shape) {
  const pts = outlineOf(shape),
    xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
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
/** Where a drum's picture goes: round its outline, with room for the rim and (below) the shadow. In panel pixels. */
function pictureRect(shape: Shape, d: { x: number; y: number; s: number }) {
  const k = d.s / 100,
    b = boundsOf(shape),
    m = RIM / 2 + 1;
  const x0 = Math.floor(d.x + (b.x0 - m) * k),
    y0 = Math.floor(d.y + (b.y0 - m) * k),
    x1 = Math.ceil(d.x + (b.x1 + m) * k),
    y1 = Math.ceil(d.y + (b.y1 + m) * k + SHADOW.dy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** A drum as an SVG picture filling its picture rect: shadow, head, rim, bolts. */
function drumSvg(shape: Shape, color: string, d: { x: number; y: number; s: number }): string {
  const k = d.s / 100,
    p = pictureRect(shape, d);
  // The picture's box in the drum's own units.
  const vx = (p.x - d.x) / k,
    vy = (p.y - d.y) / k,
    vw = p.w / k,
    vh = p.h / k;
  const rim = rimOf(color),
    bolt = lightness(rim) > 0.6 ? mix(rim, INK, 0.35) : mix(rim, '#fff3df', 0.55);
  const outline = (fill: string, stroke: string) =>
    `<path d="${shape.d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${RIM}" stroke-linejoin="round"/>`;
  const bolts = boltsOf(shape)
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${bolt}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}"><g opacity="${SHADOW.opacity}" transform="translate(0 ${((SHADOW.dy * 100) / d.s).toFixed(2)})">${outline(INK, INK)}</g>${outline(color, rim)}${bolts}</svg>`;
}
/** A drum's pad: the box round its outline (a little bigger, so the pad's own border falls outside it), clipped to the outline, so a tap lights the drum in its own shape. */
function padOf(shape: Shape, d: { x: number; y: number; s: number }) {
  const k = d.s / 100,
    b = boundsOf(shape),
    x = Math.floor(d.x + b.x0 * k) - 3,
    y = Math.floor(d.y + b.y0 * k) - 3;
  const clip = `polygon(${outlineOf(shape)
    .map(([u, v]) => `${(d.x + u * k - x).toFixed(1)}px ${(d.y + v * k - y).toFixed(1)}px`)
    .join(', ')})`;
  return {
    rect: r(x, y, Math.ceil(d.x + b.x1 * k) + 3 - x, Math.ceil(d.y + b.y1 * k) + 3 - y),
    clip,
  };
}

/** A seam of the foam mat from one point to another (straight across or down): a line with interlocking teeth. */
function seam(ax: number, ay: number, bx: number, by: number): string {
  const across = ay === by,
    len = across ? bx - ax : by - ay,
    n = Math.max(1, Math.round(len / 60)),
    step = len / n;
  const at = (t: number, o: number) =>
    across
      ? `${(ax + t).toFixed(1)} ${(ay + o).toFixed(1)}`
      : `${(ax + o).toFixed(1)} ${(ay + t).toFixed(1)}`;
  const pts = [at(0, 0)];
  for (let i = 0; i < n; i++) {
    const c = (i + 0.5) * step,
      o = i % 2 ? 6 : -6;
    pts.push(at(c - 4.5, 0), at(c - 7, o), at(c + 7, o), at(c + 4.5, 0));
  }
  pts.push(at(len, 0));
  return `M${pts.join(' L')}`;
}
/** The floor beside the mat and the foam mat, drawn once: an SVG picture under everything. */
function matSvg(): string {
  const T = MAT.tile,
    X1 = 3 * T,
    board = (W - FLOOR.x) / 3;
  const out: string[] = [];
  // The floor: three boards running up beside the mat, the ends of their lengths staggered on the lines of the mat's seams.
  for (let k = 0; k < 3; k++) {
    const x = (FLOOR.x + k * board).toFixed(1),
      x1 = (FLOOR.x + (k + 1) * board).toFixed(1),
      y = ((k % 2 ? 1 : 2) * T).toFixed(1);
    if (k) out.push(`<path d="M${x} 0 V${H}" stroke="${FLOOR.joint}" stroke-width="2"/>`);
    out.push(`<path d="M${x} ${y} H${x1}" stroke="${FLOOR.joint}" stroke-width="2"/>`);
  }
  // The mat, its tiles running off the top, left and bottom, its border strip lying on the boards.
  out.push(`<rect x="0" y="0" width="${FLOOR.x}" height="${H}" fill="${MAT.color}"/>`);
  // Its tiles and the strip meet in seams with teeth.
  const seams = [
    ...[1, 2].map(i => seam(i * T, 0, i * T, H)),
    ...[1, 2].map(i => seam(0, i * T, X1, i * T)),
    seam(X1, 0, X1, H),
  ];
  for (const d of seams)
    out.push(
      `<path d="${d}" fill="none" stroke="${MAT.light}" stroke-width="1.2" stroke-linejoin="round" transform="translate(0.9 0.9)"/>`,
      `<path d="${d}" fill="none" stroke="${MAT.groove}" stroke-width="2" stroke-linejoin="round"/>`,
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

/**
 * One drum on each outer tile of the mat (column, row), centred on it with its
 * shadow: the lowest notes, biggest, on the bottom row, the highest, smallest,
 * on the top, rising left to right. `s` is the side of the drum's square box.
 */
export const DRUMS = [
  { shape: 0, note: 48, color: '#2c45cf', tile: [0, 2], s: 159 },
  { shape: 1, note: 50, color: '#ff4b2b', tile: [1, 2], s: 148 },
  { shape: 2, note: 52, color: '#ffc531', tile: [2, 2], s: 140 },
  { shape: 4, note: 55, color: '#12a594', tile: [0, 1], s: 134 },
  { shape: 5, note: 57, color: '#fff3df', tile: [2, 1], s: 125 },
  { shape: 3, note: 60, color: '#3d1446', tile: [0, 0], s: 119 },
  { shape: 6, note: 62, color: '#ff8a1e', tile: [1, 0], s: 112 },
  { shape: 7, note: 64, color: '#49b6f4', tile: [2, 0], s: 106 },
].map(d => {
  const b = boundsOf(SHAPES[d.shape]!),
    k = d.s / 100,
    [col, row] = d.tile as [number, number];
  return {
    ...d,
    x: (col + 0.5) * MAT.tile - ((b.x0 + b.x1) / 2) * k,
    y: (row + 0.5) * MAT.tile - SHADOW.dy / 2 - ((b.y0 + b.y1) / 2) * k,
  };
});

export function toy(catalog: Catalog) {
  return work(
    'toy',
    'Shape Drums',
    catalog,
    [W, H],
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
      // ---- the plugin: a play mat on the floor, a drum on each outer tile and the Beat in the middle ----
      {
        op: 'setLook',
        look: {
          tokens: {
            // The controls sit on the mat, so the mat is the ground their ink is read on.
            bg: MAT.color,
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
          background: [{ kind: 'color', color: FLOOR.color }],
          skins: { toggle: { name: 'button', params: { radius: 56 } } },
          css: [
            // The Beat: a round ink button that turns red while the beat plays, casting the drums' shadow.
            `[data-widget=tbeat] dk-toggle::part(button) { border: 0; background: ${INK}; color: #fff3df; font-size: 22px; font-weight: 600; box-shadow: 0 ${SHADOW.dy}px 0 ${SHADOW.color}; }`,
            '[data-widget=tbeat] dk-toggle[aria-checked=true]::part(button) { background: #ff4b2b; color: #fff3df; }',
            // Each pad is clipped to its drum's outline, so a tap lights the drum in its own shape.
            ...DRUMS.map(
              (d, i) =>
                `[data-widget=pads${i + 1}] dk-keyboard::part(keyboard) { clip-path: ${padOf(SHAPES[d.shape]!, d).clip}; }`,
            ),
          ].join('\n'),
        },
      },
      el({ kind: 'svg', name: 'Play mat', svg: matSvg(), rect: r(0, 0, W, H) }),
      el({ kind: 'canvas', name: 'Floor', code: BOARD, rect: r(0, 0, W, H) }),
      // Each drum: its picture, and over it a see-through pad that lights in its shape when tapped.
      ...DRUMS.flatMap((d, i) => {
        const shape = SHAPES[d.shape]!;
        return [
          el({
            kind: 'svg',
            name: `${shape.name} drum`,
            svg: drumSvg(shape, d.color, d),
            rect: pictureRect(shape, d),
          }),
          ...control(
            `pads${i + 1}`,
            'ui.keyboard',
            `${shape.name} drum`,
            null,
            padOf(shape, d).rect,
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
                    labels: '​',
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
      // The name of the work, on the floor above the toys.
      el({
        kind: 'text',
        name: 'Title',
        text: 'Shape Drums',
        rect: r(FLOOR.x, 10, W - FLOOR.x, 30),
        textStyle: { font: 'fredoka', size: 22, weight: 600, color: '#fff3df', align: 'center' },
      }),
      // How the drums sound: three toys on the floor beside the mat, pulled up and down.
      ...patchControl('kbounce', 'Bounce', 'pdepth1.b', [0, 24, 'linear', 'st'], 14),
      ...patchControl('kring', 'Ring', 'aenv1.decay', [0.05, 1.2, 'log', 's'], 0.3),
      ...patchControl('kfizz', 'Fizz', 'mix1.level2', [0, 2, 'linear', ''], 0.5),
      el({ kind: 'canvas', name: 'Toys', code: TOYS, rect: r(FLOOR.x + 4, 0, 148, H) }),
    ],
  );
}

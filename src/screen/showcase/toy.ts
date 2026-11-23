// Shape Drums — a drum toy for children: eight shapes to tap, and a beat to join.
// Pitched toy drums (a sine with a pitch drop plus a little filtered noise) on
// a pentatonic scale, so any two taps sound good together; a soft shaker beat
// can be switched on to play along with.
// The design follows the thinking of Rytmos (Apple Design Awards 2024,
// Interaction): play is clear without being explained, the gestures are simple
// and fun, and each thing added joins the music. Every pad is a shape in its
// own colour, scattered like toys on a play mat rather than a drum machine's
// grid; nothing needs reading. Held pads sink in (no halo). The beat button
// shows whether it is on, and four dots step along with the beat it plays.
// How the shapes sound is three toys you pull up: a ball that bounces higher
// (Bounce), rings round a bell (Ring) and bubbles (Fizz).
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The board under the pads: a field of dots that jump with every hit, and the beat's four dots. */
export const BOARD = `// A field of dots under the pads. A hit is a jump in the output level: the
// dots swell from the middle outwards and settle again. Beside the beat button,
// four dots step along with the beat while it is on (tbeat): the beat plays at
// 100 a minute, and each hit heard pulls the steps towards it, so they follow
// the shaker even though a canvas cannot see the beat itself.
const BEAT = 60 / 100;
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, hits: [], phase: 0 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, step = 28;
    const on = f.on('tbeat');
    const hit = f.level > s.prev * 1.35 + 0.004;
    if (hit) {
      s.hits.push(f.t);
      if (on) {
        const e = ((((f.t - s.phase) % BEAT) + BEAT * 1.5) % BEAT) - BEAT / 2;
        s.phase += e * 0.5;
      }
    }
    s.prev = s.prev * 0.8 + f.level * 0.2;
    s.hits = s.hits.filter(t => f.t - t < 1.2).slice(-6);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = f.color('track');
    const cx = w / 2, cy = h * 0.42;
    for (let y = step / 2; y < h - 120; y += step)
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot(x - cx, y - cy);
        let swell = 0;
        for (const t of s.hits) {
          const front = (f.t - t) * 700, k = Math.max(0, 1 - Math.abs(d - front) / 60);
          swell += k * (1 - (f.t - t) / 1.2);
        }
        ctx.beginPath(); ctx.arc(x, y, 2.2 + Math.min(4, swell * 4), 0, Math.PI * 2); ctx.fill();
      }
    // The beat's four steps, beside the button (the panel's 206..300, 506).
    const now = Math.floor((f.t - s.phase) / BEAT), at = ((now % 4) + 4) % 4;
    for (let i = 0; i < 4; i++) {
      const x = 214 + i * 28, y = 506;
      ctx.beginPath();
      if (on && i === at) {
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = f.color('accent');
        ctx.fill();
      } else {
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = on ? f.color('fg') : f.color('muted');
        if (on) { ctx.fillStyle = f.color('fg'); ctx.fill(); } else ctx.stroke();
      }
    }
  },
};
`;

/** How the shapes sound: three toys pulled up and down (Bounce, Ring, Fizz). */
export const TOYS = `// Three toys, side by side, that change how the shapes sound. Drag one up for
// more of it, down for less: Bounce (kbounce) is how far each hit's pitch drops,
// drawn as how high the ball bounces; Ring (kring) is how long a hit rings,
// drawn as rings round a bell; Fizz (kfizz) is how much rattle each hit has,
// drawn as bubbles. Each toy wears the colours of a pad.
const TOYS = [
  { id: 'kbounce', hue: 0 },
  { id: 'kring', hue: 225 },
  { id: 'kfizz', hue: 315 },
];
function tile(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: -1, y0: 0, n0: 0 });
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, zone = w / 3, t = f.t;
    ctx.clearRect(0, 0, w, h);
    TOYS.forEach((toy, i) => {
      const x0 = i * zone + 6, x1 = (i + 1) * zone - 6, cx = (x0 + x1) / 2, n = f.norm(toy.id);
      const deep = 'hsl(' + toy.hue + ' 52% 44%)';
      tile(ctx, x0, 0, x1 - x0, h - 6, 18);
      ctx.fillStyle = 'hsl(' + toy.hue + ' 70% 85%)';
      ctx.fill();
      tile(ctx, x0, h - 12, x1 - x0, 6, 3);
      ctx.fillStyle = 'hsl(' + toy.hue + ' 45% 68%)';
      ctx.fill();
      ctx.fillStyle = deep;
      ctx.strokeStyle = deep;
      ctx.lineCap = 'round';
      if (toy.id === 'kbounce') {
        // The ball's path: an arc as high as Bounce, and the ball riding it.
        const floor = h - 18, top = floor - 6 - n * (h - 40), a = x0 + 16, b = x1 - 16;
        ctx.lineWidth = 3;
        ctx.setLineDash([2, 7]);
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const u = k / 24, x = a + (b - a) * u, y = floor - (floor - top) * 4 * u * (1 - u);
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const u = (t / 1.1) % 1, x = a + (b - a) * u, y = floor - (floor - top) * 4 * u * (1 - u);
        ctx.beginPath(); ctx.arc(x, y - 8, 9, 0, Math.PI * 2); ctx.fill();
      } else if (toy.id === 'kring') {
        // A bell with as many rings round it as it rings long.
        const cy = (h - 6) / 2, rings = 1 + Math.round(n * 5);
        ctx.lineWidth = 3;
        for (let k = 0; k < rings; k++) {
          ctx.globalAlpha = 1 - k / (rings + 1);
          ctx.beginPath(); ctx.arc(cx, cy, 13 + k * 7, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
      } else {
        // Bubbles rising, as many as there is fizz.
        const count = Math.round(n * 14), span = h - 26;
        ctx.lineWidth = 2.5;
        for (let k = 0; k < Math.max(1, count); k++) {
          const seed = Math.sin(k * 12.9898) * 43758.5453, rnd = seed - Math.floor(seed);
          const x = x0 + 16 + rnd * (x1 - x0 - 32), y = h - 16 - (((t * (14 + rnd * 18)) + rnd * span) % span);
          const radius = count ? 3 + rnd * 4 : 3;
          ctx.globalAlpha = count ? 1 : 0.45;
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    });
  },
  pointer(e, f) {
    const zone = f.w / 3, s = f.state;
    if (e.type === 'down') {
      s.drag = Math.max(0, Math.min(2, Math.floor(e.x / zone)));
      s.y0 = e.y;
      s.n0 = f.norm(TOYS[s.drag].id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = -1;
    if (s.drag >= 0 && e.type === 'move')
      f.setNorm(TOYS[s.drag].id, Math.max(0, Math.min(1, s.n0 + (s.y0 - e.y) / (f.h * 0.9))));
    f.cursor('ns-resize');
  },
};
`;

/** The shapes on the pads, one per sound (drawn in a 100×100 box, filled with `c`). */
const SHAPES: Array<(c: string) => string> = [
  c => `<circle cx="50" cy="50" r="42" fill="${c}"/>`,
  c => `<rect x="12" y="12" width="76" height="76" rx="12" fill="${c}"/>`,
  c =>
    `<path d="M50 8 L94 88 L6 88 Z" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`,
  c => `<path d="M50 4 L96 50 L50 96 L4 50 Z" fill="${c}"/>`,
  c => `<path d="M50 6 L88 28 L88 72 L50 94 L12 72 L12 28 Z" fill="${c}"/>`,
  c =>
    `<path d="M50 6 L61 38 L95 38 L68 58 L78 92 L50 72 L22 92 L32 58 L5 38 L39 38 Z" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
  c => `<path d="M2 74 A48 48 0 0 1 98 74 Z" fill="${c}"/>`,
  c => `<circle cx="50" cy="50" r="34" fill="none" stroke="${c}" stroke-width="16"/>`,
];
/** A pad's shape colour: the pad's own hue, deeper (the pads are hsl(hue 70% 80%)). */
const shapeColor = (i: number) => `hsl(${Math.round((360 * i) / 8)} 52% 44%)`;

/** The pads: where each sits on the mat and how big it is (a square, s across). */
const PADS = [
  { x: 36, y: 92, s: 176 },
  { x: 240, y: 112, s: 140 },
  { x: 410, y: 84, s: 156 },
  { x: 600, y: 108, s: 124 },
  { x: 64, y: 290, s: 140 },
  { x: 236, y: 274, s: 164 },
  { x: 432, y: 270, s: 146 },
  { x: 606, y: 262, s: 118 },
];
/** Each pad's note: a pentatonic scale from C3, so any two taps sound good together. */
const NOTES = [48, 50, 52, 55, 57, 60, 62, 64];

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
      // ---- the plugin: shapes scattered on a play mat ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#fff8ec',
            fg: '#2d2a5a',
            accent: '#f2643f',
            track: '#efe2cb',
            knob: '#ffffff',
            pointer: '#2d2a5a',
            muted: '#6b6797',
            glow: '#f2643f',
            font: 'fredoka',
            labelFont: 'fredoka',
            valueFont: 'fredoka',
          },
          background: [{ kind: 'color', color: '#fff8ec' }],
          skins: { toggle: { name: 'button', params: { radius: 32 } } },
          css: [
            '[data-widget=tbeat] dk-toggle::part(button) { border: 3px solid var(--dk-fg); font-size: 20px; font-weight: 600; }',
          ].join('\n'),
        },
      },
      el({ kind: 'canvas', name: 'Board', code: BOARD, rect: r(0, 0, 760, 580) }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Shape Drums',
        rect: r(36, 22, 360, 44),
        textStyle: { font: 'fredoka', size: 36, weight: 600, color: 'fg', align: 'left' },
      }),
      // One pad per shape, each its own size, scattered rather than in a grid.
      ...PADS.flatMap((p, i) => [
        ...control(`pads${i + 1}`, 'ui.keyboard', `Pad ${i + 1}`, null, r(p.x, p.y, p.s, p.s), {
          style: {
            skin: {
              name: 'pads',
              params: {
                count: 1,
                columns: 1,
                start: NOTES[i]!,
                scale: 'same',
                colors: 'accent',
                press: 'sink',
                radius: Math.round(p.s * 0.28),
                gap: 0,
                labels: '​',
              },
            },
            tokens: { accent: `hsl(${Math.round((360 * i) / 8)} 70% 80%)` },
          },
        }),
        el({
          kind: 'svg',
          name: `Shape ${i + 1}`,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${SHAPES[i]!(shapeColor(i))}</svg>`,
          rect: r(
            Math.round(p.x + p.s * 0.21),
            Math.round(p.y + p.s * 0.17),
            Math.round(p.s * 0.58),
            Math.round(p.s * 0.58),
          ),
        }),
      ]),
      ...control('tbeat', 'ui.toggle', 'Beat', 'bon1.b', r(36, 474, 156, 64), {
        value: false,
        style: { textStyle: { font: 'fredoka', size: 20, weight: 600 } },
      }),
      // How the shapes sound: three toys pulled up and down.
      ...patchControl('kbounce', 'Bounce', 'pdepth1.b', [0, 24, 'linear', 'st'], 14),
      ...patchControl('kring', 'Ring', 'aenv1.decay', [0.05, 1.2, 'log', 's'], 0.3),
      ...patchControl('kfizz', 'Fizz', 'mix1.level2', [0, 2, 'linear', ''], 0.5),
      el({ kind: 'canvas', name: 'Toys', code: TOYS, rect: r(394, 456, 330, 82) }),
      ...['Bounce', 'Ring', 'Fizz'].map((name, i) =>
        el({
          kind: 'text',
          name: `${name} label`,
          text: name,
          rect: r(394 + i * 110, 542, 110, 22),
          textStyle: { font: 'fredoka', size: 16, weight: 600, color: 'fg', align: 'center' },
        }),
      ),
    ],
  );
}

// Rain Field — a sound installation of rain all around the listener: drops on
// the glass, wind with the rain further off, thunder far away and drips from a
// gutter, each placed in the space by hand.
// One raindrop is a part (Drop): a slow wobble ticks; at each tick one random
// number decides whether a drop falls and another how high it rings; the drop
// is a short burst of noise through a narrow band. The part runs ×16: each copy
// falls on its own (its own random numbers, and its own pace and pitch from
// spreads), and Splay spreads the copies across the stereo field. The drips are
// the same part used once more, slower and lower. Where a sound sits is another
// part (Place): Level from how near it is, Pan from which side, used once for
// each of the four sounds. A small room holds it all. The Drop's face is on the
// plugin, so its knobs play every copy at once.
// The design follows the thinking of Odio (Apple Design Awards 2022,
// Innovation), an app of sound worlds you mix by placing each sound in the space
// around you: the mixer is that space, seen from above, with the listener in
// the middle, and every sound moves with what is heard.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { faceIntents } from '../faces.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The four sounds: their controls (level and pan, kept in the patch), colour, icon and where they start. */
const LAYERS = [
  {
    name: 'Drops',
    level: 'kdrops',
    pan: 'kdropspan',
    color: '#8ec1d6',
    icon: 'drops',
    at: [0.7, 0],
  },
  {
    name: 'Wind and far rain',
    level: 'kwind',
    pan: 'kwindpan',
    color: '#b6c78f',
    icon: 'wind',
    at: [0.4, 0.6],
  },
  {
    name: 'Thunder',
    level: 'kthunder',
    pan: 'kthunderpan',
    color: '#e2b274',
    icon: 'thunder',
    at: [0.35, -0.7],
  },
  {
    name: 'Drips',
    level: 'kdrips',
    pan: 'kdripspan',
    color: '#cba3d8',
    icon: 'drips',
    at: [0.55, 0.4],
  },
] as const;

/** The field around the listener, seen from above; it takes the mouse. */
export const FIELD = `// The space around you, seen from above, you in the middle (front is up).
// Each sound is a dot: how near it is sets its level (1 in the middle, 0 at the
// edge), the side it is on sets its pan (-1 left, +1 right). Drag a dot to move
// the sound; dots behind you stay behind. The dots move with what is heard:
// drops land as small ripples by the Drops dot (sharp jumps high in the
// spectrum), a drip makes one wider ripple (a jump around its note,
// props.dripHz), the wind's arcs follow the low middle of the spectrum, and
// thunder rolls out of its dot when the lowest bands rise.
const TAU = Math.PI * 2;
const LAYERS = [
  { level: 'kdrops', pan: 'kdropspan', color: '#8ec1d6', icon: 'drops' },
  { level: 'kwind', pan: 'kwindpan', color: '#b6c78f', icon: 'wind' },
  { level: 'kthunder', pan: 'kthunderpan', color: '#e2b274', icon: 'thunder' },
  { level: 'kdrips', pan: 'kdripspan', color: '#cba3d8', icon: 'drips' },
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function spot(f, k, R, behind) {
  const L = LAYERS[k];
  const r = (1 - clamp(f.value(L.level), 0, 1)) * R, a = Math.asin(clamp(f.value(L.pan), -1, 1));
  return { x: r * Math.sin(a), y: (behind ? 1 : -1) * r * Math.cos(a) };
}
function icon(ctx, kind, x, y, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'drops') {
    for (const [dx, dy] of [[-4, -2], [4, -4], [0, 5]]) { ctx.moveTo(x + dx + 2.6, y + dy); ctx.arc(x + dx, y + dy, 2.6, 0, TAU); }
    ctx.fill();
  } else if (kind === 'wind') {
    ctx.moveTo(x - 8, y - 4); ctx.lineTo(x + 3, y - 4); ctx.arc(x + 3, y - 7, 3, Math.PI / 2, -Math.PI, true);
    ctx.moveTo(x - 8, y + 1); ctx.lineTo(x + 6, y + 1);
    ctx.moveTo(x - 8, y + 6); ctx.lineTo(x, y + 6); ctx.arc(x, y + 9, 3, -Math.PI / 2, Math.PI, false);
    ctx.stroke();
  } else if (kind === 'thunder') {
    ctx.moveTo(x + 2, y - 9); ctx.lineTo(x - 5, y + 1); ctx.lineTo(x, y + 1); ctx.lineTo(x - 2, y + 9); ctx.lineTo(x + 5, y - 2); ctx.lineTo(x, y - 2); ctx.closePath();
    ctx.fill();
  } else {
    ctx.moveTo(x, y - 9); ctx.bezierCurveTo(x - 2, y - 5, x - 6, y - 1, x - 6, y + 3); ctx.arc(x, y + 3, 6, Math.PI, 0, true); ctx.bezierCurveTo(x + 6, y - 1, x + 2, y - 5, x, y - 9);
    ctx.fill();
  }
}
const band = hz => (64 * Math.log(hz / 96)) / Math.log(250);
export default {
  setup(ctx, f) {
    Object.assign(f.state, { drag: -1, over: -1, behind: [false, false, false, true], prev: null, ripples: [], lastDrop: 0, drip: 0, lastDrip: -10, low: 0, lastThunder: -10, windLo: 1, windHi: 0, wind: 0 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 22;
    const fg = f.color('fg'), muted = f.color('muted'), track = f.color('track'), bg = f.color('bg');
    const at = k => { const p = spot(f, k, R, s.behind[k]); return { x: cx + p.x, y: cy + p.y }; };
    ctx.clearRect(0, 0, w, h);
    // The space: a disc, rings for how near, the left-right and front-back lines.
    ctx.fillStyle = f.color('knob');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = track; ctx.lineWidth = 1;
    for (const q of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * q, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.setLineDash([]);
    // What is heard: spectral jumps for drops and drips, the low end for thunder and wind
    // (the first frame only sets where each starts from).
    const first = !s.prev;
    if (first) s.prev = new Float32Array(f.spectrum);
    let flux = 0;
    for (let i = 30; i < 58; i++) flux += Math.max(0, f.spectrum[i] - s.prev[i]);
    const dripBand = band(f.props.dripHz || 700), bi = Math.max(0, Math.min(62, Math.floor(dripBand)));
    const drip = f.spectrum[bi] * (1 - (dripBand - bi)) + f.spectrum[bi + 1] * (dripBand - bi);
    if (first) s.drip = drip;
    const dripJump = drip - s.drip;
    s.drip += (drip - s.drip) * Math.min(1, f.dt * 3);
    let low = 0;
    for (let i = 0; i < 4; i++) low += f.spectrum[i] / 4;
    if (first) s.low = low;
    const lowJump = low - s.low;
    s.low += (low - s.low) * Math.min(1, f.dt * 0.6);
    let wind = 0;
    for (let i = 8; i < 17; i++) wind += f.spectrum[i] / 9;
    s.windHi = wind > s.windHi ? wind : s.windHi - (s.windHi - wind) * f.dt * 0.1;
    s.windLo = wind < s.windLo ? wind : s.windLo + (wind - s.windLo) * f.dt * 0.1;
    s.wind += ((s.windHi - s.windLo > 0.02 ? (wind - s.windLo) / (s.windHi - s.windLo) : 0) - s.wind) * Math.min(1, f.dt * 3);
    s.prev.set(f.spectrum);
    const dropsAt = at(0), dripsAt = at(3), thunderAt = at(2), windAt = at(1);
    if (flux > 0.6 && f.t - s.lastDrop > 0.05 && f.value('kdrops') > 0.02) {
      s.lastDrop = f.t;
      const a = Math.random() * TAU, d = Math.random() * 34;
      s.ripples.push({ x: dropsAt.x + Math.cos(a) * d, y: dropsAt.y + Math.sin(a) * d, born: f.t, life: 0.9, size: 14, color: LAYERS[0].color });
    }
    if (dripJump > 0.08 && f.t - s.lastDrip > 0.35 && f.value('kdrips') > 0.02) {
      s.lastDrip = f.t;
      s.ripples.push({ x: dripsAt.x, y: dripsAt.y, born: f.t, life: 1.5, size: 46, color: LAYERS[3].color });
    }
    if (lowJump > 0.05 && f.t - s.lastThunder > 2 && f.value('kthunder') > 0.02) {
      s.lastThunder = f.t;
      s.ripples.push({ x: thunderAt.x, y: thunderAt.y, born: f.t, life: 3.2, size: R * 1.2, color: LAYERS[2].color });
    }
    s.ripples = s.ripples.filter(q => f.t - q.born < q.life).slice(-80);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    for (const q of s.ripples) {
      const age = (f.t - q.born) / q.life;
      ctx.strokeStyle = q.color; ctx.globalAlpha = (1 - age) * 0.8; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, 3 + age * q.size, 0, TAU); ctx.stroke();
    }
    // The wind's arcs, facing you, as strong as the wind is heard.
    const toYou = Math.atan2(cy - windAt.y, cx - windAt.x);
    ctx.strokeStyle = LAYERS[1].color; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 1; i <= 3; i++) {
      const rr = 22 + i * 10 + ((f.t * 14) % 10);
      ctx.globalAlpha = Math.max(0, 0.15 + 0.6 * s.wind - i * 0.12);
      ctx.beginPath(); ctx.arc(windAt.x, windAt.y, rr, toYou - 0.5, toYou + 0.5); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // You: a head, its nose to the front, and its ears.
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 6); ctx.lineTo(cx, cy - 13); ctx.lineTo(cx + 4, cy - 6); ctx.fill();
    ctx.fillRect(cx - 11, cy - 3, 3, 6); ctx.fillRect(cx + 8, cy - 3, 3, 6);
    // The sounds: dots with their icons; thunder swells as it rolls.
    for (let k = LAYERS.length - 1; k >= 0; k--) {
      const L = LAYERS[k], p = at(k);
      const quiet = f.value(L.level) <= 0.02;
      const swell = k === 2 ? Math.max(0, 1 - (f.t - s.lastThunder) / 3) * 6 : k === 1 ? s.wind * 3 : 0;
      ctx.globalAlpha = quiet ? 0.45 : 1;
      if (s.over === k || s.drag === k) {
        ctx.strokeStyle = L.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 25 + swell, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = L.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 18 + swell, 0, TAU); ctx.fill();
      icon(ctx, L.icon, p.x, p.y, bg);
    }
    ctx.globalAlpha = 1;
  },
  pointer(e, f) {
    const s = f.state, cx = f.w / 2, cy = f.h / 2, R = Math.min(f.w, f.h) / 2 - 22;
    const near = () => {
      for (let k = 0; k < LAYERS.length; k++) {
        const p = spot(f, k, R, s.behind[k]);
        if (Math.hypot(e.x - cx - p.x, e.y - cy - p.y) < 24) return k;
      }
      return -1;
    };
    s.over = near();
    if (e.type === 'down') s.drag = s.over;
    if (e.type === 'up' || e.type === 'leave') s.drag = -1;
    if (s.drag >= 0 && (e.type === 'down' || e.type === 'move')) {
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy), L = LAYERS[s.drag];
      s.behind[s.drag] = dy > 0;
      f.set(L.level, 1 - Math.min(R, d) / R);
      f.set(L.pan, d < 1 ? 0 : clamp(dx / d, -1, 1));
    }
    f.cursor(s.drag >= 0 ? 'grabbing' : s.over >= 0 ? 'grab' : 'default');
  },
};
`;

/** The legend's icons, drawn like the field's (24 × 24). */
const ICONS: Record<(typeof LAYERS)[number]['icon'], (c: string) => string> = {
  drops: c =>
    `<circle cx="8" cy="10" r="2.6" fill="${c}"/><circle cx="16" cy="8" r="2.6" fill="${c}"/><circle cx="12" cy="17" r="2.6" fill="${c}"/>`,
  wind: c =>
    `<path d="M4 8h11a3 3 0 1 0-3-3M4 13h14M4 18h8a3 3 0 1 1-3 3" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  thunder: c => `<path d="M14 3 7 13h5l-2 8 7-11h-5l2-7z" fill="${c}"/>`,
  drips: c => `<path d="M12 3c-2 4-6 8-6 12a6 6 0 0 0 12 0c0-4-4-8-6-12z" fill="${c}"/>`,
};

/** How the knobs' names read on this plugin (the Drop's face and the others alike). */
const KNOB_TEXT = {
  textStyle: { font: 'lato', size: 11, color: 'fg', case: 'upper' as const, spacing: 0.14 },
};

/** The Drop's own screen: its three knobs under its name, with a lamp for the sound. */
export const DROP_FACE: PartFace = {
  width: 284,
  height: 176,
  controls: [
    {
      param: 'rain',
      type: 'ui.knob',
      rect: { x: 12, y: 64, w: 84, h: 100 },
      label: 'Rain',
      style: KNOB_TEXT,
    },
    {
      param: 'pitch',
      type: 'ui.knob',
      rect: { x: 100, y: 64, w: 84, h: 100 },
      label: 'Pitch',
      style: KNOB_TEXT,
    },
    {
      param: 'splash',
      type: 'ui.knob',
      rect: { x: 188, y: 64, w: 84, h: 100 },
      label: 'Splash',
      style: KNOB_TEXT,
    },
  ],
  elements: [
    {
      id: 'frame',
      kind: 'shape',
      shape: 'rect',
      rect: { x: 0, y: 0, w: 284, h: 176 },
      style: {
        radius: 14,
        fill: [{ kind: 'color', color: '#232c33' }],
        stroke: { color: '#ffffff1a', width: 1, style: 'solid' },
      },
    },
    {
      id: 'title',
      kind: 'text',
      text: 'DROP',
      rect: { x: 16, y: 14, w: 140, h: 18 },
      textStyle: {
        font: 'lato',
        size: 13,
        weight: 700,
        color: 'accent',
        align: 'left',
        spacing: 0.24,
      },
    },
    {
      id: 'what',
      kind: 'text',
      text: 'one drop, sixteen times: these knobs play every copy',
      rect: { x: 16, y: 34, w: 252, h: 14 },
      textStyle: { size: 10, color: 'muted', align: 'left' },
    },
    {
      id: 'lamp',
      kind: 'led',
      bind: '@level',
      color: 'accent',
      threshold: 0.02,
      rect: { x: 258, y: 18, w: 10, h: 10 },
    },
  ],
};

export function rain(catalog: Catalog) {
  const drop = [
    'tick1',
    'up1',
    'down1',
    'chance1',
    'pass1',
    'fall1',
    'env1',
    'noise1',
    'pitch1',
    'jitter1',
    'band1',
    'ring1',
    'vca1',
  ];
  const place = ['pan1', 'balL1', 'balR1', 'clL1', 'clR1', 'lvl1', 'gL1', 'gR1', 'outL1', 'outR1'];
  const field = { x: 24, y: 84, w: 404, h: 392 };
  const R = Math.min(field.w, field.h) / 2 - 22,
    cx = field.x + field.w / 2,
    cy = field.y + field.h / 2;
  const caption = (
    text: string,
    rect: ReturnType<typeof r>,
    align: 'left' | 'center' | 'right' = 'center',
  ) =>
    el({
      kind: 'text',
      name: `${text} label`,
      text,
      rect,
      textStyle: { size: 10, weight: 700, color: 'muted', align, spacing: 0.2, case: 'upper' },
    });
  return workInSteps(
    'rain',
    'Rain Field',
    catalog,
    [760, 500],
    [
      [
        // ---- one drop: a tick, a chance, a burst of noise through a narrow band ----
        add('tick1', 'den.lfo', { label: 'Tick', values: { rate: 6 } }),
        add('up1', 'kit.compare', { label: 'Tick up' }),
        add('down1', 'kit.compare', { label: 'Tick down' }),
        add('chance1', 'den.randomModulator', { label: 'Chance' }),
        add('pass1', 'kit.compare', { label: 'Falls?', values: { b: 0 } }),
        add('fall1', 'kit.mul', { label: 'Fall' }),
        add('env1', 'den.envelope', {
          label: 'Splash',
          values: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.025 },
        }),
        add('noise1', 'den.seededNoise', { label: 'Water' }),
        add('pitch1', 'den.randomModulator', { label: 'Which pitch' }),
        add('jitter1', 'kit.scale', { label: 'Jitter', values: { scale: 0.7, offset: 0 } }),
        add('band1', 'kit.cutoffMod', { label: 'Pitch', values: { hz: 2400 } }),
        add('ring1', 'den.stateVariableFilter', { label: 'Ring', values: { q: 6 } }),
        add('vca1', 'kit.mul', { label: 'Drop' }),
        // While the tick is up the random numbers run; when it falls they hold, and the drop falls if the chance passed.
        wire('tick1.out', 'up1.a'),
        wire('tick1.out', 'down1.b'),
        wire('up1.out', 'chance1.trigger'),
        wire('up1.out', 'pitch1.trigger'),
        wire('chance1.out', 'pass1.a'),
        wire('pass1.out', 'fall1.a'),
        wire('down1.out', 'fall1.b'),
        wire('fall1.out', 'env1.gate'),
        wire('pitch1.out', 'jitter1.in'),
        wire('jitter1.out', 'band1.octaves'),
        wire('band1.out', 'ring1.cutoffHz'),
        wire('noise1.out', 'ring1.input'),
        wire('ring1.bandpass', 'vca1.a'),
        wire('env1.level', 'vca1.b'),
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.85 } }),
        wire('vca1.out', 'splay1.in'),
        // ---- where a sound sits: Level from how near, Pan from which side (left and right kept in balance) ----
        add('pan1', 'kit.add', { label: 'Pan', values: { a: 0, b: 0 } }),
        add('balL1', 'kit.scale', { label: 'Left side', values: { scale: -1, offset: 1 } }),
        add('balR1', 'kit.scale', { label: 'Right side', values: { scale: 1, offset: 1 } }),
        add('clL1', 'kit.clamp', { label: 'Left at most 1', values: { min: 0, max: 1 } }),
        add('clR1', 'kit.clamp', { label: 'Right at most 1', values: { min: 0, max: 1 } }),
        add('lvl1', 'kit.add', { label: 'Level', values: { a: 0.7, b: 0 } }),
        add('gL1', 'kit.mul', { label: 'Left gain' }),
        add('gR1', 'kit.mul', { label: 'Right gain' }),
        add('outL1', 'kit.mul', { label: 'Left' }),
        add('outR1', 'kit.mul', { label: 'Right' }),
        wire('pan1.out', 'balL1.in'),
        wire('pan1.out', 'balR1.in'),
        wire('balL1.out', 'clL1.in'),
        wire('balR1.out', 'clR1.in'),
        wire('clL1.out', 'gL1.a'),
        wire('clR1.out', 'gR1.a'),
        wire('lvl1.out', 'gL1.b'),
        wire('lvl1.out', 'gR1.b'),
        wire('splay1.left', 'outL1.a'),
        wire('splay1.right', 'outR1.a'),
        wire('gL1.out', 'outL1.b'),
        wire('gR1.out', 'outR1.b'),
        // ---- the field: four sounds into a small room ----
        add('mixl1', 'kit.mix', { label: 'Left', config: { channels: 4 } }),
        add('mixr1', 'kit.mix', { label: 'Right', config: { channels: 4 } }),
        wire('outL1.out', 'mixl1.in1'),
        wire('outR1.out', 'mixr1.in1'),
        // Wind and the rain further off: low noise, its tone swept by gusts.
        add('air1', 'den.seededNoise', { label: 'Air', config: { seed: 7 } }),
        add('gust1', 'den.lfo', { label: 'Gusts', values: { rate: 0.11 } }),
        add('gustamt1', 'kit.scale', { label: 'Gust depth', values: { scale: 1.2, offset: 0 } }),
        add('airtone1', 'kit.cutoffMod', { label: 'Air tone', values: { hz: 420 } }),
        add('farlp1', 'den.filter', { label: 'Far rain', values: { resonance: 0.7 } }),
        add('farlvl1', 'kit.gain', { label: 'Far level', values: { gain: 0.2 } }),
        wire('air1.out', 'farlp1.input'),
        wire('gust1.out', 'gustamt1.in'),
        wire('gustamt1.out', 'airtone1.octaves'),
        wire('airtone1.out', 'farlp1.cutoff'),
        wire('farlp1.out', 'farlvl1.in'),
        // Thunder: now and then (a slow tick, and a chance), a long low rumble.
        add('tlfo1', 'den.lfo', { label: 'Thunder tick', values: { rate: 0.06 } }),
        add('tup1', 'kit.compare', { label: 'Now?', values: { b: 0.97 } }),
        add('tchance1', 'den.randomModulator', { label: 'Thunder chance', config: { seed: 3 } }),
        add('tpass1', 'kit.compare', { label: 'Rolls?', values: { b: -0.3 } }),
        add('troll1', 'kit.mul', { label: 'Roll' }),
        add('tenv1', 'den.envelope', {
          label: 'Rumble',
          values: { attack: 0.5, decay: 1.2, sustain: 0.6, release: 4.5 },
        }),
        add('tnoise1', 'den.seededNoise', { label: 'Thunder noise', config: { seed: 13 } }),
        add('tlp1', 'den.filter', { label: 'Far off', values: { cutoff: 120, resonance: 0.8 } }),
        add('tvca1', 'kit.mul', { label: 'Thunder' }),
        add('tsat1', 'kit.tanh', { label: 'Weight', values: { drive: 3 } }),
        add('tlvl1', 'kit.gain', { label: 'Thunder level', values: { gain: 0.5 } }),
        wire('tlfo1.out', 'tup1.a'),
        wire('tup1.out', 'tchance1.trigger'),
        wire('tchance1.out', 'tpass1.a'),
        wire('tup1.out', 'troll1.a'),
        wire('tpass1.out', 'troll1.b'),
        wire('troll1.out', 'tenv1.gate'),
        wire('tnoise1.out', 'tlp1.input'),
        wire('tlp1.out', 'tvca1.a'),
        wire('tenv1.level', 'tvca1.b'),
        wire('tvca1.out', 'tsat1.in'),
        wire('tsat1.out', 'tlvl1.in'),
        add('room1', 'den.algorithmicReverb', {
          label: 'Room',
          config: { roomScale: 0.6, decaySeconds: 0.9, dampingHz: 6000 },
          values: { mix: 0.25 },
        }),
        add('lvl1l', 'kit.gain', { label: 'Level L', values: { gain: 3 } }),
        add('lvl1r', 'kit.gain', { label: 'Level R', values: { gain: 3 } }),
        add('safel1', 'kit.tanh', { label: 'Safe L' }),
        add('safer1', 'kit.tanh', { label: 'Safe R' }),
        add('out1', 'kit.out'),
        wire('mixl1.out', 'room1.left'),
        wire('mixr1.out', 'room1.right'),
        wire('room1.left', 'lvl1l.in'),
        wire('room1.right', 'lvl1r.in'),
        wire('lvl1l.out', 'safel1.in'),
        wire('lvl1r.out', 'safer1.in'),
        wire('safel1.out', 'out1.left'),
        wire('safer1.out', 'out1.right'),
        // The drop becomes a part (its cable to Splay is its output), and so does where a sound sits.
        { op: 'makePart', ids: drop, name: 'Drop', id: 'drop', node: 'drop1' },
        { op: 'makePart', ids: place, name: 'Place', id: 'place', node: 'place1' },
      ],
      // Their knobs: how often a drop ticks, how high it rings, how long it splashes; how near a sound is, and which side.
      doc => [
        ...onlyParams(doc, 'drop', [
          {
            node: 'tick1',
            port: 'rate',
            id: 'rain',
            label: 'Rain',
            range: { min: 0.5, max: 16, scale: 'log', unit: 'Hz' },
          },
          {
            node: 'band1',
            port: 'hz',
            id: 'pitch',
            label: 'Pitch',
            range: { min: 400, max: 8000, scale: 'log', unit: 'Hz' },
          },
          {
            node: 'env1',
            port: 'decay',
            id: 'splash',
            label: 'Splash',
            range: { min: 0.005, max: 0.4, scale: 'log', unit: 's' },
          },
        ]),
        ...onlyParams(doc, 'place', [
          { node: 'lvl1', port: 'a', id: 'level', label: 'Level', range: { min: 0, max: 1 } },
          { node: 'pan1', port: 'a', id: 'pan', label: 'Pan', range: { min: -1, max: 1 } },
        ]),
      ],
      doc => {
        const where = doc.parts.place!;
        const [inL, inR] = where.inputs.map(p => p.id);
        const [outL, outR] = where.outputs.map(p => p.id);
        return [
          {
            op: 'updatePart',
            part: 'drop',
            doc: 'One raindrop: a tick, a chance that it falls, and a short burst of noise ringing in a narrow band. Use it many times (×N): every copy falls on its own.',
            face: DROP_FACE,
          },
          {
            op: 'updatePart',
            part: 'place',
            doc: 'Where a sound sits around the listener: Level from how near it is, Pan from which side (the far side fades out, the near side stays). Takes and gives left and right.',
            labels: { [inL!]: 'Left in', [inR!]: 'Right in', [outL!]: 'Left', [outR!]: 'Right' },
          },
          // ×16, each copy at its own pace and pitch.
          { op: 'setCount', node: 'drop1', count: 16 },
          {
            op: 'setSpread',
            node: 'drop1',
            port: 'rain',
            spread: { kind: 'random', amount: 0.8, seed: 5 },
          },
          {
            op: 'setSpread',
            node: 'drop1',
            port: 'pitch',
            spread: { kind: 'random', amount: 0.7, seed: 9 },
          },
          // The drips: the same drop once more, slower, lower and longer.
          add('drip1', 'kit.part', {
            part: 'drop',
            label: 'Drips',
            values: { rain: 0.9, pitch: 700, splash: 0.18 },
          }),
          // Each sound in its place.
          add('place2', 'kit.part', { part: 'place', label: 'Wind’s place' }),
          add('place3', 'kit.part', { part: 'place', label: 'Thunder’s place' }),
          add('place4', 'kit.part', { part: 'place', label: 'Drips’ place' }),
          ...(
            [
              ['farlvl1.out', 'place2', 2],
              ['tlvl1.out', 'place3', 3],
              ['drip1.out', 'place4', 4],
            ] as const
          ).flatMap(([from, use, n]) => [
            wire(from, `${use}.${inL}`),
            wire(from, `${use}.${inR}`),
            wire(`${use}.${outL}`, `mixl1.in${n}`),
            wire(`${use}.${outR}`, `mixr1.in${n}`),
          ]),
          ...LAYERS.flatMap((l, i) => [
            ...patchControl(
              l.level,
              `${l.name}: near`,
              `place${i + 1}.level`,
              [0, 1, 'linear', ''],
              l.at[0],
            ),
            ...patchControl(
              l.pan,
              `${l.name}: side`,
              `place${i + 1}.pan`,
              [-1, 1, 'linear', ''],
              l.at[1],
            ),
          ]),
          // ---- the plugin: the space around you, the sounds in it, the Drop's face ----
          {
            op: 'setLook',
            look: {
              tokens: {
                bg: '#1c2329',
                fg: '#e9eef1',
                accent: '#8ec1d6',
                track: '#34414a',
                knob: '#232c33',
                pointer: '#e9eef1',
                muted: '#9aa9b3',
                glow: '#8ec1d6',
                font: 'lato',
                labelFont: 'lato',
                valueFont: 'lato',
              },
              background: [{ kind: 'color', color: '#1c2329' }],
              skins: {
                knob: { name: 'ring', params: { thickness: 3, ticks: 0, round: true } },
                slider: { name: 'bar', params: { radius: 2, label: 'top' } },
              },
              css: [
                '/* A lit lamp is a plain dot: no halo. */',
                ':scope { --led-glow: 0px; }',
                'dk-slider { position: relative; }',
                'dk-slider::part(label) { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--dk-muted); }',
                'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 11px; color: var(--dk-fg); }',
                'dk-slider::part(track) { max-height: 4px; margin-top: 8px; }',
              ].join('\n'),
            },
          },
          el({
            kind: 'text',
            name: 'Title',
            text: 'RAIN FIELD',
            rect: r(24, 20, 400, 28),
            textStyle: { size: 22, weight: 700, color: 'fg', align: 'left', spacing: 0.24 },
          }),
          el({
            kind: 'text',
            name: 'Subtitle',
            text: 'Rain all around you. Drag a sound nearer or further, to the left or the right.',
            rect: r(24, 52, 560, 16),
            textStyle: { size: 12, color: 'muted', align: 'left' },
          }),
          el({
            kind: 'canvas',
            name: 'The space around you',
            code: FIELD,
            rect: r(field.x, field.y, field.w, field.h),
            props: { dripHz: 700 },
          }),
          caption('Front', r(cx - 40, cy - R - 16, 80, 12)),
          caption('Behind', r(cx - 40, cy + R + 4, 80, 12)),
          caption('L', r(field.x, cy - 6, 14, 12), 'left'),
          caption('R', r(field.x + field.w - 14, cy - 6, 14, 12), 'right'),
          caption('You', r(cx - 30, cy + 14, 60, 12)),
          caption('Sounds, and how much each makes', r(452, 88, 284, 12), 'left'),
          ...LAYERS.flatMap((l, i) => {
            const y = 108 + i * 32;
            return [
              el({
                kind: 'svg',
                name: `${l.name} icon`,
                svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ICONS[l.icon](l.color)}</svg>`,
                rect: r(452, y, 20, 20),
              }),
              el({
                kind: 'text',
                name: l.name,
                text: l.name,
                rect: r(482, y + 2, 130, 16),
                textStyle: { size: 12, weight: 700, color: 'fg', align: 'left' },
              }),
            ];
          }),
          ...(
            [
              ['mdrops', 'drop1.out'],
              ['mwind', 'farlvl1.out'],
              ['mthunder', 'tlvl1.out'],
              ['mdrips', 'drip1.out'],
            ] as const
          ).flatMap(([id, from], i) => [
            ...control(id, 'ui.meter', LAYERS[i]!.name, null, r(620, 116 + i * 32, 116, 6), {
              style: {
                skin: {
                  name: 'bar',
                  params: { fill: LAYERS[i]!.color, surface: '#34414a', scale: false },
                },
              },
            }),
            wire(from, `${id}.in`),
          ]),
          ...control('kwidth', 'ui.slider', 'Drops across', 'splay1.width', r(452, 248, 134, 36), {
            min: 0,
            max: 1,
            value: 0.85,
          }),
          ...control('kroom', 'ui.slider', 'Room', 'room1.mix', r(602, 248, 134, 36), {
            min: 0,
            max: 1,
            value: 0.25,
          }),
        ];
      },
      // The Drop's face on the plugin: its knobs set the part for all 16 copies.
      doc => faceIntents(doc, catalog, 'drop1', { at: { x: 452, y: 300 } }).intents,
    ],
  );
}

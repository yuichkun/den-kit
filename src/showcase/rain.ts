// Evaluation prompt 11 — Rain hitting a window. Layer a single raindrop, with manual controls for intensity, drop pitch, splashes, and wind.
// One raindrop is a part (Drop): a slow wobble ticks; at each tick one random
// number decides whether a drop falls and another how high it rings; the drop
// is a short burst of noise through a narrow band. The part runs ×16: each copy
// falls on its own (its own random numbers, and its own pace and pitch from
// spreads), and Splay spreads the copies across the stereo field. A gusty low
// noise is the rain further off; a small room holds it all. The Drop's face is
// on the plugin, so its knobs play every copy at once; a canvas draws rain
// running down the glass.
import type { Catalog } from '../core/catalog.ts';
import type { PartFace } from '../core/schema.ts';
import { faceIntents } from '../plugin/faces.ts';
import { add, control, el, onlyParams, r, wire, workInSteps } from './build.ts';

export const RAIN = `// Rain on the glass. Streaks fall slanted by the wind; the louder the rain,
// the more of them and the faster. Where one lands a bead may stay on the
// glass, swell and run down. Colours come from the look (fg, glow).
function streak(w, h, anywhere) {
  return { x: Math.random() * (w + 80), y: anywhere ? Math.random() * h : -Math.random() * 60, len: 10 + Math.random() * 26, v: 0.7 + Math.random() * 0.6, a: 0.12 + Math.random() * 0.3 };
}
export default {
  setup(ctx, f) {
    if (!f.state.streaks) f.state.streaks = Array.from({ length: 160 }, () => streak(f.w, f.h, true));
    if (!f.state.beads) f.state.beads = [];
  },
  draw(ctx, f) {
    const s = f.state;
    const loud = Math.min(1, f.level * 5);
    const shown = Math.floor(s.streaks.length * (0.2 + 0.8 * loud));
    const speed = 420 + loud * 700;
    const rain = f.color('fg'), bead = f.color('glow');
    ctx.clearRect(0, 0, f.w, f.h);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = rain;
    s.streaks.forEach((q, i) => {
      q.y += q.v * speed * f.dt;
      q.x -= q.v * speed * f.dt * 0.12;
      if (q.y - q.len > f.h || q.x < -40) {
        if (i < shown && s.beads.length < 60 && Math.random() < 0.35) s.beads.push({ x: q.x + 40, y: Math.random() * f.h, r: 0.8 + Math.random() * 1.6, v: 0, grow: 0.2 + Math.random() * 0.6 });
        Object.assign(q, streak(f.w, f.h, false));
      }
      if (i >= shown) return;
      ctx.globalAlpha = q.a;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + q.len * 0.12, q.y - q.len); ctx.stroke();
    });
    for (const b of s.beads) {
      b.r += b.grow * f.dt;
      if (b.r > 2.4) { b.v += 30 * f.dt; b.y += b.v * f.dt; }
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = bead;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rain;
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    s.beads = s.beads.filter(b => b.y < f.h + 8);
    ctx.globalAlpha = 1;
  },
};
`;

/** How the knobs' names read on this plugin (the Drop's face and the others alike). */
const KNOB_TEXT = { textStyle: { font: 'lato', size: 12, color: 'fg', case: 'upper' as const, spacing: 0.16 } };

/** The Drop's own screen: its three knobs under its name, with a lamp for the sound. */
export const DROP_FACE: PartFace = {
  width: 330, height: 156,
  controls: [
    { param: 'rain', type: 'ui.knob', rect: { x: 14, y: 50, w: 96, h: 100 }, label: 'Rain', style: KNOB_TEXT },
    { param: 'pitch', type: 'ui.knob', rect: { x: 118, y: 50, w: 96, h: 100 }, label: 'Pitch', style: KNOB_TEXT },
    { param: 'splash', type: 'ui.knob', rect: { x: 222, y: 50, w: 96, h: 100 }, label: 'Splash', style: KNOB_TEXT },
  ],
  elements: [
    { id: 'frame', kind: 'shape', shape: 'rect', rect: { x: 0, y: 0, w: 330, h: 156 }, style: { radius: 16, fill: [{ kind: 'color', color: '#0d1a22c4' }], stroke: { color: '#8fd3ff44', width: 1, style: 'solid' } } },
    { id: 'title', kind: 'text', text: 'DROP', rect: { x: 18, y: 12, w: 140, h: 22 }, textStyle: { font: 'oswald', size: 17, weight: 600, color: 'accent', align: 'left', spacing: 0.3 } },
    { id: 'what', kind: 'text', text: 'one drop · every copy at once', rect: { x: 18, y: 32, w: 240, h: 14 }, textStyle: { size: 10, color: 'muted', align: 'left', spacing: 0.08 } },
    { id: 'lamp', kind: 'led', bind: '@level', color: 'accent', threshold: 0.5, rect: { x: 302, y: 16, w: 10, h: 10 } },
  ],
};

export function rain(catalog: Catalog) {
  const knob = KNOB_TEXT;
  const inside = ['tick1', 'up1', 'down1', 'chance1', 'pass1', 'fall1', 'env1', 'noise1', 'pitch1', 'jitter1', 'band1', 'ring1', 'vca1'];
  return workInSteps('rain', 'Rainfall', catalog, [760, 470], [
    [
      // ---- one drop: a tick, a chance, a burst of noise through a narrow band ----
      add('tick1', 'den.lfo', { label: 'Tick', values: { rate: 6 } }),
      add('up1', 'kit.compare', { label: 'Tick up' }),
      add('down1', 'kit.compare', { label: 'Tick down' }),
      add('chance1', 'den.randomModulator', { label: 'Chance' }),
      add('pass1', 'kit.compare', { label: 'Falls?', values: { b: 0 } }),
      add('fall1', 'kit.mul', { label: 'Fall' }),
      add('env1', 'den.envelope', { label: 'Splash', values: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.025 } }),
      add('noise1', 'den.seededNoise', { label: 'Water' }),
      add('pitch1', 'den.randomModulator', { label: 'Which pitch' }),
      add('jitter1', 'kit.scale', { label: 'Jitter', values: { scale: 0.7, offset: 0 } }),
      add('band1', 'kit.cutoffMod', { label: 'Pitch', values: { hz: 2400 } }),
      add('ring1', 'den.stateVariableFilter', { label: 'Ring', values: { q: 6 } }),
      add('vca1', 'kit.mul', { label: 'Drop' }),
      // While the tick is up the random numbers run; when it falls they hold, and the drop falls if the chance passed.
      wire('tick1.out', 'up1.a'), wire('tick1.out', 'down1.b'),
      wire('up1.out', 'chance1.trigger'), wire('up1.out', 'pitch1.trigger'),
      wire('chance1.out', 'pass1.a'), wire('pass1.out', 'fall1.a'), wire('down1.out', 'fall1.b'), wire('fall1.out', 'env1.gate'),
      wire('pitch1.out', 'jitter1.in'), wire('jitter1.out', 'band1.octaves'), wire('band1.out', 'ring1.cutoffHz'),
      wire('noise1.out', 'ring1.input'), wire('ring1.bandpass', 'vca1.a'), wire('env1.level', 'vca1.b'),
      // ---- the rain: the drops across the field, the far rain in the wind, a small room ----
      add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.85 } }),
      add('air1', 'den.seededNoise', { label: 'Air', config: { seed: 7 } }),
      add('gust1', 'den.lfo', { label: 'Gusts', values: { rate: 0.11 } }),
      add('gustamt1', 'kit.scale', { label: 'Gust depth', values: { scale: 1.2, offset: 0 } }),
      add('airtone1', 'kit.cutoffMod', { label: 'Air tone', values: { hz: 420 } }),
      add('farlp1', 'den.filter', { label: 'Far rain', values: { resonance: 0.7 } }),
      add('farlvl1', 'kit.gain', { label: 'Far level', values: { gain: 0.2 } }),
      add('wind1', 'kit.gain', { label: 'Wind', values: { gain: 0.4 } }),
      add('suml1', 'kit.add', { label: 'Left' }),
      add('sumr1', 'kit.add', { label: 'Right' }),
      add('room1', 'den.algorithmicReverb', { label: 'Room', config: { roomScale: 0.6, decaySeconds: 0.9, dampingHz: 6000 }, values: { mix: 0.25 } }),
      add('lvl1', 'kit.gain', { label: 'Level L', values: { gain: 3 } }),
      add('lvr1', 'kit.gain', { label: 'Level R', values: { gain: 3 } }),
      add('out1', 'kit.out'),
      wire('vca1.out', 'splay1.in'),
      wire('air1.out', 'farlp1.input'), wire('gust1.out', 'gustamt1.in'), wire('gustamt1.out', 'airtone1.octaves'), wire('airtone1.out', 'farlp1.cutoff'), wire('farlp1.out', 'farlvl1.in'), wire('farlvl1.out', 'wind1.in'),
      wire('splay1.left', 'suml1.a'), wire('wind1.out', 'suml1.b'), wire('splay1.right', 'sumr1.a'), wire('wind1.out', 'sumr1.b'),
      wire('suml1.out', 'room1.left'), wire('sumr1.out', 'room1.right'),
      wire('room1.left', 'lvl1.in'), wire('room1.right', 'lvr1.in'), wire('lvl1.out', 'out1.left'), wire('lvr1.out', 'out1.right'),
      // The drop becomes a part (its cable to Splay is its output).
      { op: 'makePart', ids: inside, name: 'Drop', id: 'drop', node: 'drop1' },
    ],
    // Its knobs: how often a copy ticks, how high it rings, how long it splashes (each with a range that suits it).
    doc => onlyParams(doc, 'drop', [
      { node: 'tick1', port: 'rate', id: 'rain', label: 'Rain', range: { min: 0.5, max: 16, scale: 'log', unit: 'Hz' } },
      { node: 'band1', port: 'hz', id: 'pitch', label: 'Pitch', range: { min: 400, max: 8000, scale: 'log', unit: 'Hz' } },
      { node: 'env1', port: 'decay', id: 'splash', label: 'Splash', range: { min: 0.005, max: 0.4, scale: 'log', unit: 's' } },
    ]),
    [
      { op: 'updatePart', part: 'drop', doc: 'One raindrop: a tick, a chance that it falls, and a short burst of noise ringing in a narrow band. Use it many times (×N): every copy falls on its own.', face: DROP_FACE },
      // ×16, each copy at its own pace and pitch.
      { op: 'setCount', node: 'drop1', count: 16 },
      { op: 'setSpread', node: 'drop1', port: 'rain', spread: { kind: 'random', amount: 0.8, seed: 5 } },
      { op: 'setSpread', node: 'drop1', port: 'pitch', spread: { kind: 'random', amount: 0.7, seed: 9 } },
      // ---- the plugin: rain on a window at night ----
      { op: 'setLook', look: {
        tokens: { bg: '#0a1218', fg: '#e6f0f5', accent: '#8fd3ff', track: '#ffffff24', knob: '#14222b', pointer: '#cfeeff', muted: '#8ea6b2', glow: '#bfe6ff', font: 'lato', labelFont: 'lato', valueFont: 'lato' },
        background: [
          { kind: 'linear', angle: 180, stops: [{ color: '#1d3442', at: 0 }, { color: '#0a1218', at: 1 }] },
          { kind: 'radial', x: 0.78, y: 0.08, stops: [{ color: '#8fd3ff26', at: 0 }, { color: '#8fd3ff00', at: 0.7 }] },
        ],
        skins: { knob: { name: 'ring', params: { thickness: 3, ticks: 0, round: true } } },
      } },
      el({ kind: 'canvas', name: 'Rain on the glass', code: RAIN, rect: r(0, 0, 760, 470) }),
      el({ kind: 'text', name: 'Title', text: 'RAINFALL', rect: r(40, 24, 440, 66), textStyle: { font: 'oswald', size: 56, weight: 600, color: 'fg', align: 'left', spacing: 0.12, shadows: [{ x: 0, y: 0, blur: 18, color: '#8fd3ff66' }] } }),
      el({ kind: 'text', name: 'Subtitle', text: 'ONE DROP, SIXTEEN TIMES · WIND · A SMALL ROOM', rect: r(42, 90, 560, 18), textStyle: { font: 'lato', size: 11, color: 'muted', align: 'left', spacing: 0.24 } }),
      el({ kind: 'shape', shape: 'rect', name: 'Air panel', rect: r(392, 292, 328, 156), locked: true, style: { radius: 16, fill: [{ kind: 'color', color: '#0d1a22c4' }], stroke: { color: '#8fd3ff44', width: 1, style: 'solid' } } }),
      el({ kind: 'text', name: 'Air title', text: 'AIR', rect: r(410, 304, 140, 22), textStyle: { font: 'oswald', size: 17, weight: 600, color: 'accent', align: 'left', spacing: 0.3 } }),
      el({ kind: 'text', name: 'Air subtitle', text: 'the rain further off, the room', rect: r(410, 324, 260, 14), textStyle: { size: 10, color: 'muted', align: 'left', spacing: 0.08 } }),
      ...control('kwind', 'ui.knob', 'Wind', 'wind1.gain', r(406, 342, 96, 100), { min: 0, max: 1, value: 0.4, style: knob }),
      ...control('kwidth', 'ui.knob', 'Width', 'splay1.width', r(510, 342, 96, 100), { min: 0, max: 1, value: 0.85, style: knob }),
      ...control('kroom', 'ui.knob', 'Room', 'room1.mix', r(614, 342, 96, 100), { min: 0, max: 1, value: 0.25, style: knob }),
    ],
    // The Drop's face on the plugin: its knobs set the part for all 16 copies.
    doc => faceIntents(doc, catalog, 'drop1', { at: { x: 40, y: 292 } }).intents,
  ]);
}

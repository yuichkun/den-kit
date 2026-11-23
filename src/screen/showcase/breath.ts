// Exhale — a sound installation for a quiet room: a soft chord and the sound of
// air swell in and out at the pace of slow breathing, so people can breathe
// along with it.
// Nothing is played. A slow sine is the breath (Breaths a minute); on the way
// in the chord opens and grows and the air rises through a band, on the way out
// they settle; Depth sets how far (at 0 the chord holds still and the air is gone). One tone of the chord is a part (Tone): a
// saw, a little off pitch by its copy's own random number, through a lowpass
// that opens with the breath. The part runs ×5 and an `each` spread gives each
// copy its interval above the key (a wide, open chord); Splay spreads them and
// a long hall holds everything.
// The design follows the thinking of Loóna (Apple Design Awards 2021, Visuals
// and Graphics), calm sessions in which type, colour, motion and 3D are made
// together for one soothing scene: here the whole plugin is one picture at
// night, a field of points running to the horizon and flowing slowly toward
// you, with a soft swell in the middle that rises as the breath comes in and
// settles as it goes out, in step with what is heard. Deep violet and pale
// lilac, a quiet title, nothing else that asks for attention. The settings are
// on the picture: the field for Depth and Breaths a minute, the sky above it
// for Hall and Warmth. Key is kept in the patch.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The field: points running to the horizon, a swell that rises with the breath; it takes the mouse. */
export const SCENE = `// A room of points at night: a floor and a ceiling running to the horizon,
// both flowing slowly toward you. How full the breath is comes from the output
// level, eased and placed between the quietest and loudest of the last few
// breaths, so the room moves with what is heard: as the breath comes in, the
// floor swells up in the middle and the ceiling lifts into a vault above it, as
// far as Depth (kdepth) lets them, and both settle as it goes out; a slow ripple runs out
// across the floor once a breath (Breaths a minute, kbpm). The ceiling is the
// hall: the more Hall (kspace), the higher it is. Warmth (kwarm) turns the
// points from cool to warm lilac. The title sits where the room meets the horizon.
// Drag the floor up and down for Depth, left and right for Breaths a minute;
// drag the ceiling up and down for Hall, left and right for Warmth. A drag
// keeps to the direction it starts in; scrolling moves the up-and-down setting.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TAU = Math.PI * 2;
// Columns across, rows from near (ZN) to far (ZF), the eye CAM above the floor, the swell's middle at ZC.
const COLS = 96, ROWS = 30, ZN = 1.2, ZF = 10, CAM = 1, XW = 10, ZC = 2.8, COOL = [186, 198, 255], WARM = [252, 196, 232];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SET = { kdepth: { lo: 0, hi: 1 }, kbpm: { lo: 3, hi: 10 }, kspace: { lo: 0, hi: 1 }, kwarm: { lo: 200, hi: 1600 } };
const AXES = { floor: { x: 'kbpm', y: 'kdepth' }, ceiling: { x: 'kwarm', y: 'kspace' } };
// The horizon, the middle across, and the lens: the nearest floor row lands near the bottom edge.
function layout(w, h) {
  const HOR = Math.round(h * 0.45);
  return { HOR, cx: w / 2, F: ((h - 14 - HOR) * ZN) / CAM };
}
// How far the ceiling is above the eye.
const above = hall => 0.55 + 1.5 * hall;
// A label edged in the night's colour; underlined when its part of the room is under the hand.
function say(ctx, text, x, y, align, ink, edge, hot) {
  ctx.font = '600 13px ' + FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = edge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
  if (hot) {
    const tw = ctx.measureText(text).width;
    ctx.fillRect(align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x, y + 4, tw, 1.5);
  }
}
function move(id, v0, dx, dy, L) {
  const d = SET[id];
  let v;
  if (id === 'kdepth') v = v0 - dy / 240;
  else if (id === 'kspace') v = v0 - dy / 160;
  else if (id === 'kbpm') v = v0 + dx / 60;
  else v = v0 * Math.pow(d.hi / d.lo, dx / 240);
  return clamp(v, d.lo, d.hi);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { lvl: 0, lo: 1, hi: 0, b: 0.5, drag: '', over: '', axis: '' });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, L = layout(w, h), { HOR, cx, F } = L;
    if (s.b === undefined) Object.assign(s, { lvl: 0, lo: 1, hi: 0, b: 0.5, drag: '', over: '', axis: '' });
    const fg = f.color('fg'), bg = f.color('bg');
    // How full the breath is.
    s.lvl += (f.level - s.lvl) * Math.min(1, f.dt * 3);
    s.hi = s.lvl > s.hi ? s.lvl : s.hi - (s.hi - s.lvl) * f.dt * 0.05;
    s.lo = s.lvl < s.lo ? s.lvl : s.lo + (s.lvl - s.lo) * f.dt * 0.05;
    const full = s.hi - s.lo > s.hi * 0.15 ? (s.lvl - s.lo) / (s.hi - s.lo) : 0.5;
    s.b += (clamp(full, 0, 1) - s.b) * Math.min(1, f.dt * 2);
    const b = s.b, depth = f.value('kdepth'), bpm = f.value('kbpm'), hall = f.value('kspace'), warm = f.value('kwarm');
    const active = id => s.over === id || s.drag === id;
    ctx.clearRect(0, 0, w, h);
    const t = Math.log(warm / 200) / Math.log(8);
    const ink = COOL.map((c, i) => Math.round(c + (WARM[i] - c) * t)).join(',');
    const top = above(hall), flow = f.t * 0.012, phase = f.t * (bpm / 60) * TAU;
    // Rows spaced evenly in how far they look, flowing toward you; the far ones first.
    const rows = [];
    for (let j = 0; j < ROWS; j++) {
      const u = (((j / ROWS - flow) % 1) + 1) % 1;
      rows.push({ z: ZN * Math.pow(ZF / ZN, u), u });
    }
    rows.sort((p, q) => q.z - p.z);
    const swell = (x, z) => { const rr = Math.hypot(x / 1.9, (z - ZC) / 1.1); return b * depth * Math.exp(-rr * rr); };
    const ripple = (x, z) => { const rr = Math.hypot(x / 1.9, z - ZC); return depth * 0.09 * Math.sin(rr * 2.6 - phase) * Math.exp(-rr / 2.4); };
    // One plane: the floor (dir 1, at the eye's height below) or the ceiling (dir -1, at top above).
    const plane = (dir, height, bend) => {
      for (const { z, u } of rows) {
        const near = ZN / z, size = 0.7 + 3.4 * near;
        const fog = Math.exp(-(z - ZN) * 0.3) * Math.min(1, (1 - u) / 0.1) * Math.min(1, u / 0.04);
        for (let i = 0; i < COLS; i++) {
          const x = (i / (COLS - 1) - 0.5) * 2 * XW;
          const sx = cx + (x / z) * F;
          if (sx < -4 || sx > w + 4) continue;
          const lift = bend(x, z), sy = HOR + (dir * (height - lift) / z) * F;
          if (sy < -4 || sy > h + 4) continue;
          const a = fog * (0.4 + 0.6 * near) + Math.abs(lift) * 0.55 * fog;
          if (a < 0.02) continue;
          ctx.fillStyle = 'rgba(' + ink + ',' + clamp(a, 0, 1) + ')';
          ctx.beginPath();
          ctx.arc(sx, sy, size / 2, 0, TAU);
          ctx.fill();
        }
      }
    };
    plane(-1, top, (x, z) => -0.7 * swell(x, z));
    plane(1, CAM, (x, z) => 1.05 * swell(x, z) + ripple(x, z));
    // The labels, on what they set: the floor's below the horizon, the ceiling's above.
    const fy = HOR + (CAM / ZC) * F + 22, cy = HOR - (top / ZC) * F - 12;
    say(ctx, 'depth ' + Math.round(depth * 100) + '% ↕', cx - 200, fy, 'center', fg, bg, active('floor'));
    say(ctx, bpm.toFixed(1) + ' breaths a minute ↔', cx + 200, fy, 'center', fg, bg, active('floor'));
    say(ctx, 'hall ' + Math.round(hall * 100) + '% ↕', cx - 200, Math.max(20, cy), 'center', fg, bg, active('ceiling'));
    say(ctx, 'warmth ' + Math.round(warm) + ' Hz ↔', cx + 200, Math.max(20, cy), 'center', fg, bg, active('ceiling'));
  },
  pointer(e, f) {
    const s = f.state, L = layout(f.w, f.h), zone = e.y < L.HOR ? 'ceiling' : 'floor';
    if (e.type === 'down') {
      Object.assign(s, { drag: zone, axis: '', x0: e.x, y0: e.y, from: {} });
      for (const id of Object.values(AXES[zone])) s.from[id] = f.value(id);
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = '';
    if (s.drag && e.type === 'move') {
      const dx = e.x - s.x0, dy = e.y - s.y0;
      if (!s.axis && Math.hypot(dx, dy) > 4) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const id = s.axis && AXES[s.drag][s.axis];
      if (id) f.set(id, move(id, s.from[id], dx, dy, L));
    }
    if (e.type === 'wheel') {
      const id = AXES[zone].y, d = SET[id];
      f.set(id, clamp(f.value(id) - (Math.sign(e.dy) * (d.hi - d.lo)) / 50, d.lo, d.hi));
    }
    s.over = e.type === 'leave' ? '' : s.drag || zone;
    f.cursor(s.drag ? 'grabbing' : 'grab');
  },
};
`;

export function breath(catalog: Catalog) {
  const inside = ['idx1', 'wob1', 'note1', 'note2', 'mtof1', 'osc1', 'lp1'];
  return workInSteps(
    'breath',
    'Exhale',
    catalog,
    [760, 500],
    [
      [
        // ---- the breath: a slow sine, 0 (out) to 1 (in) ----
        add('rate1', 'kit.mul', { label: 'Breaths (Hz)', values: { b: 1 / 60 } }),
        add('breath1', 'den.lfo', { label: 'Breath' }),
        add('in1', 'kit.scale', { label: 'How full', values: { scale: 0.5, offset: 0.5 } }),
        add('out1n', 'kit.scale', { label: 'How empty', values: { scale: -1, offset: 1 } }),
        add('deep1', 'kit.mul', { label: 'Depth' }),
        add('swell1', 'kit.scale', { label: 'Swell', values: { scale: -1, offset: 1 } }),
        add('bamt1', 'kit.mul', { label: 'Breath, as deep as Depth' }),
        wire('rate1.out', 'breath1.rate'),
        wire('breath1.out', 'in1.in'),
        wire('in1.out', 'out1n.in'),
        wire('out1n.out', 'deep1.a'),
        wire('deep1.out', 'swell1.in'),
        wire('in1.out', 'bamt1.a'),
        // The chord's tone opens with the breath.
        add('open1', 'kit.mul', { label: 'Opening', values: { b: 1.8 } }),
        add('cut1', 'kit.cutoffMod', { label: 'Tone', values: { hz: 520 } }),
        wire('bamt1.out', 'open1.a'),
        wire('open1.out', 'cut1.octaves'),
        // ---- one tone of the chord ----
        add('idx1', 'kit.copy', { label: 'Which tone' }),
        add('wob1', 'kit.scale', { label: 'A little off', values: { scale: 0.12, offset: -0.06 } }),
        add('note1', 'kit.add', { label: 'Interval' }),
        add('note2', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'Tone', config: { waveform: 'saw' } }),
        add('lp1', 'den.stateVariableFilter', { label: 'Soft', values: { q: 0.6 } }),
        wire('idx1.random', 'wob1.in'),
        wire('note1.out', 'note2.a'),
        wire('wob1.out', 'note2.b'),
        wire('note2.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        wire('osc1.out', 'lp1.input'),
        wire('cut1.out', 'lp1.cutoffHz'),
        // ---- the chord across, and the air, swelling; a long hall ----
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.75 } }),
        add('chl1', 'kit.mul', { label: 'Chord L' }),
        add('chr1', 'kit.mul', { label: 'Chord R' }),
        wire('lp1.lowpass', 'splay1.in'),
        wire('splay1.left', 'chl1.a'),
        wire('splay1.right', 'chr1.a'),
        wire('swell1.out', 'chl1.b'),
        wire('swell1.out', 'chr1.b'),
        add('air1', 'den.seededNoise', { label: 'Air', config: { seed: 31 } }),
        add('airhz1', 'kit.cutoffMod', { label: 'Air rising', values: { hz: 380 } }),
        add('airband1', 'kit.mul', { label: 'Air sweep', values: { b: 2.2 } }),
        add('airf1', 'den.stateVariableFilter', { label: 'Air band', values: { q: 0.9 } }),
        add('airpow1', 'kit.mul', { label: 'Air swell' }),
        add('airamt1', 'kit.mul', { label: 'Air level', values: { b: 0.35 } }),
        add('airvca1', 'kit.mul', { label: 'Air' }),
        wire('in1.out', 'airband1.a'),
        wire('airband1.out', 'airhz1.octaves'),
        wire('airhz1.out', 'airf1.cutoffHz'),
        wire('air1.out', 'airf1.input'),
        wire('bamt1.out', 'airpow1.a'),
        wire('bamt1.out', 'airpow1.b'),
        wire('airpow1.out', 'airamt1.a'),
        wire('airf1.bandpass', 'airvca1.a'),
        wire('airamt1.out', 'airvca1.b'),
        add('suml1', 'kit.add', { label: 'Left' }),
        add('sumr1', 'kit.add', { label: 'Right' }),
        wire('chl1.out', 'suml1.a'),
        wire('airvca1.out', 'suml1.b'),
        wire('chr1.out', 'sumr1.a'),
        wire('airvca1.out', 'sumr1.b'),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1, decaySeconds: 5, dampingHz: 4500 },
          values: { mix: 0.45 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.16 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.16 } }),
        add('out1', 'kit.out'),
        wire('suml1.out', 'hall1.left'),
        wire('sumr1.out', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        ...patchControl('kkey', 'Key', 'note1.a', [45, 57, 'linear', 'note'], 50),
        ...patchControl('kbpm', 'Breaths a minute', 'rate1.a', [3, 10, 'linear', ''], 6),
        ...patchControl('kdepth', 'Depth', ['deep1.b', 'bamt1.b'], [0, 1, 'linear', ''], 0.8),
        ...patchControl('kwarm', 'Warmth', 'cut1.hz', [200, 1600, 'log', 'Hz'], 520),
        ...patchControl('kspace', 'Hall', 'hall1.mix', [0, 1, 'linear', ''], 0.45),
        ...control('mlevel', 'ui.meter', 'Level', null, r(355, 236, 50, 2)),
        wire('gl1.out', 'mlevel.in'),
        { op: 'makePart', ids: inside, name: 'Tone', id: 'tone', node: 'tone1' },
      ],
      // Its one knob: which tone of the chord this copy is, above the key.
      doc =>
        onlyParams(doc, 'tone', [
          {
            node: 'note1',
            port: 'b',
            id: 'interval',
            label: 'Interval',
            range: { min: -12, max: 24, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'tone',
          doc: 'One tone of the chord: a saw, a little off pitch by its own random number, through a lowpass that opens with the breath. Interval is its note above the key.',
        },
        { op: 'setCount', node: 'tone1', count: 5 },
        {
          op: 'setSpread',
          node: 'tone1',
          port: 'interval',
          spread: { kind: 'each', values: [-12, 0, 7, 14, 19] },
        },
        // ---- the plugin: one picture that breathes ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#1c0e38',
              fg: '#efe8ff',
              accent: '#d9ccff',
              track: '#3a2763',
              knob: '#2a1650',
              pointer: '#efe8ff',
              muted: '#a596d4',
              glow: '#d9ccff',
              font: 'lato',
              labelFont: 'lato',
              valueFont: 'lato',
            },
            background: [
              { kind: 'color', color: '#1c0e38' },
              {
                kind: 'linear',
                angle: 180,
                stops: [
                  { color: '#2c1755', at: 0 },
                  { color: '#1c0e3800', at: 0.36 },
                  { color: '#0e0620', at: 1 },
                ],
              },
            ],
            skins: { meter: { name: 'bar', params: {} } },
          },
        },
        el({ kind: 'canvas', name: 'The breathing field', code: SCENE, rect: r(0, 0, 760, 500) }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'exhale',
          rect: r(280, 210, 200, 24),
          textStyle: { font: 'lato', size: 16, color: 'fg', align: 'center', spacing: 0.6 },
        }),
      ],
    ],
  );
}

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
// together for one soothing scene: here the whole plugin is one picture, a
// misty lavender room of dark points running to the horizon and flowing slowly
// toward you, with a soft swell in the middle that rises as the breath comes in
// and settles as it goes out, in step with what is heard. The title sits on the
// horizon, underlined by how loud the room is; nothing else asks for attention.
// The settings are on the picture: the floor for Depth and Breaths a minute,
// the ceiling for Hall and Warmth, each value on a plate by the hand while it is
// there. Key is kept in the patch.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The field: points running to the horizon, a swell that rises with the breath; it takes the mouse. */
export const SCENE = `// A misty room of points: a floor and a ceiling running to the horizon,
// both flowing slowly toward you. How full the breath is comes from the output
// level, eased and placed between the quietest and loudest of the last few
// breaths, so the room moves with what is heard: as the breath comes in, the
// floor swells up in the middle and the ceiling lifts into a vault above it, as
// far as Depth (kdepth) lets them, the points growing as they rise, and both
// settle as it goes out; a slow ripple runs out
// across the floor once a breath (Breaths a minute, kbpm). The ceiling is the
// hall: the more Hall (kspace), the higher it is. Warmth (kwarm) turns the
// points from cool indigo to warm plum; the further a point, the more it fades
// into the mist. The title sits where the room meets the horizon. Drag the
// floor up and down for Depth, left and right for Breaths a minute; drag the
// ceiling up and down for Hall, left and right for Warmth. A drag keeps to the
// direction it starts in; scrolling moves the up-and-down setting. The two
// settings of the part under the hand show on a plate by it.
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TAU = Math.PI * 2;
// Columns across, rows from near (ZN) to far (ZF), the eye CAM above the floor, the swell's middle at ZC.
const COLS = 96, ROWS = 30, ZN = 1.2, ZF = 10, CAM = 1, XW = 10, ZC = 2.8, COOL = [38, 30, 104], WARM = [112, 28, 84];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SET = { kdepth: { lo: 0, hi: 1 }, kbpm: { lo: 3, hi: 10 }, kspace: { lo: 0, hi: 1 }, kwarm: { lo: 200, hi: 1600 } };
const AXES = { floor: { x: 'kbpm', y: 'kdepth' }, ceiling: { x: 'kwarm', y: 'kspace' } };
// The horizon, the middle across, and the lens: the nearest floor row leaves past the bottom edge.
function layout(w, h) {
  const HOR = Math.round(h * 0.45);
  return { HOR, cx: w / 2, F: ((h + 16 - HOR) * ZN) / CAM };
}
// How far the ceiling is above the eye.
const above = hall => 0.55 + 1.5 * hall;
// The plate by the hand: the settings of the part of the room under it.
function plate(ctx, text, x, y, ink, paper, w) {
  ctx.font = '700 13px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * 7.5) + 18;
  const x0 = clamp(x - tw / 2, 6, w - tw - 6);
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(Math.round(x0), Math.round(y - 12), Math.round(tw), 24, 12); ctx.fill();
  ctx.fillStyle = paper; ctx.fillText(text, Math.round(x0 + 9), Math.round(y) + 0.5);
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
        const near = ZN / z, size = 0.8 + 4.4 * near;
        const fog = Math.exp(-(z - ZN) * 0.3) * Math.min(1, (1 - u) / 0.1);
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
          ctx.arc(sx, sy, (size / 2) * (1 + Math.abs(lift) * 1.8), 0, TAU);
          ctx.fill();
        }
      }
    };
    plane(-1, top, (x, z) => -0.7 * swell(x, z));
    plane(1, CAM, (x, z) => 1.05 * swell(x, z) + ripple(x, z));
    // The plate by the hand, while it is on the room.
    const p = f.pointer, zone = s.drag || s.over;
    if (zone && p && (p.over || s.drag)) {
      const text = zone === 'floor'
        ? 'depth ' + Math.round(depth * 100) + '% ↕ · ' + bpm.toFixed(1) + ' breaths a minute ↔'
        : 'hall ' + Math.round(hall * 100) + '% ↕ · warmth ' + Math.round(warm) + ' Hz ↔';
      plate(ctx, text, p.x, clamp(p.y - 30, 16, h - 16), fg, bg, w);
    }
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
        ...control('mlevel', 'ui.meter', 'Level', null, r(346, 232, 68, 2)),
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
              bg: '#e9e3f7',
              fg: '#231a4f',
              accent: '#231a4f',
              track: '#cbbfe9',
              knob: '#d9d0f2',
              pointer: '#231a4f',
              muted: '#5a4f86',
              glow: '#231a4f',
              font: 'lato',
              labelFont: 'lato',
              valueFont: 'lato',
            },
            background: [
              { kind: 'color', color: '#e9e3f7' },
              {
                kind: 'linear',
                angle: 180,
                stops: [
                  { color: '#d6caef', at: 0 },
                  { color: '#f1ecfb', at: 0.45 },
                  { color: '#d2c5ee', at: 1 },
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
          rect: r(280, 202, 200, 28),
          textStyle: { font: 'lato', size: 22, weight: 700, color: 'fg', align: 'center' },
        }),
      ],
    ],
  );
}

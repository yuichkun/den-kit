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
// slowly turning form of points that swells as the breath comes in and settles
// as it goes out, in step with what is heard, with a small title and nothing
// else that asks for attention. The settings are on the picture: drag it up
// and down for Depth, left and right for Breaths a minute; Warmth and Hall are
// figures you drag.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The form: points on a turning sphere that swell with the breath; it takes the mouse. */
export const SCENE = `// A form of points on a slowly turning sphere. How full the breath is comes
// from the output level, eased and placed between the quietest and loudest of
// the last few breaths, so the form moves with what is heard: it swells on the
// way in and settles on the way out, a slow wave running over it as deep as
// Depth. Drag on it: up and down is Depth (kdepth), left and right Breaths a
// minute (kbpm). Drag the figures at the bottom right up or down: Warmth
// (kwarm) and Hall (kspace).
const TAU = Math.PI * 2, N = 720, GOLD = Math.PI * (3 - Math.sqrt(5));
const FIGURES = [
  { id: 'kwarm', label: 'warmth', x: 600, text: v => Math.round(v) + ' Hz', per: v => v * 0.006 },
  { id: 'kspace', label: 'hall', x: 712, text: v => v.toFixed(2), per: () => 0.005 },
];
function figureAt(x, y, w, h) {
  if (y < h - 76) return null;
  for (const g of FIGURES) if (Math.abs(x - g.x) < 52) return g;
  return null;
}
export default {
  setup(ctx, f) {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + 0.5) / N) * 2, r = Math.sqrt(1 - y * y), a = i * GOLD;
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    Object.assign(f.state, { pts, lvl: 0, lo: 1, hi: 0, b: 0.5, spin: 0, drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted');
    // How full the breath is.
    s.lvl += (f.level - s.lvl) * Math.min(1, f.dt * 3);
    s.hi = s.lvl > s.hi ? s.lvl : s.hi - (s.hi - s.lvl) * f.dt * 0.05;
    s.lo = s.lvl < s.lo ? s.lvl : s.lo + (s.lvl - s.lo) * f.dt * 0.05;
    const full = s.hi - s.lo > s.hi * 0.15 ? (s.lvl - s.lo) / (s.hi - s.lo) : 0.5;
    s.b += (Math.max(0, Math.min(1, full)) - s.b) * Math.min(1, f.dt * 2);
    const b = s.b, depth = f.value('kdepth'), bpm = f.value('kbpm');
    s.spin += f.dt * (0.05 + bpm * 0.012);
    ctx.clearRect(0, 0, w, h);
    // The form: swelling with the breath, a wave over it as deep as Depth.
    const cx = w / 2, cy = h / 2 - 10, base = Math.min(w, h) * 0.3;
    const rad = base * (0.78 + 0.3 * b * (0.4 + 0.6 * depth));
    const ca = Math.cos(s.spin), sa = Math.sin(s.spin), tilt = 0.42, ct = Math.cos(tilt), st = Math.sin(tilt);
    const out = [];
    for (const [x0, y0, z0] of s.pts) {
      const wave = 1 + 0.07 * depth * Math.sin(y0 * 5 - f.t * 0.9) * (0.4 + b);
      const x1 = x0 * ca + z0 * sa, z1 = -x0 * sa + z0 * ca;
      const y2 = y0 * ct - z1 * st, z2 = y0 * st + z1 * ct;
      out.push([cx + x1 * rad * wave, cy + y2 * rad * wave, z2]);
    }
    out.sort((p, q) => p[2] - q[2]);
    ctx.fillStyle = accent;
    for (const [x, y, z] of out) {
      const near = (z + 1) / 2;
      ctx.globalAlpha = 0.18 + 0.82 * near;
      const d = 0.8 + 2.2 * near;
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    // Marks on the picture: what dragging it does.
    const p = f.pointer, on = s.drag === 'form' || (p && p.over && !s.drag && !figureAt(p.x, p.y, w, h));
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? fg : muted;
    ctx.textAlign = 'center';
    ctx.fillText('depth ' + depth.toFixed(2) + '  ↕', cx, cy - base * 1.16 - 14);
    ctx.textAlign = 'left';
    ctx.fillText('↔  ' + bpm.toFixed(1) + ' breaths a minute', cx + base * 1.16 + 10, cy);
    // The figures you drag.
    for (const g of FIGURES) {
      const hot = s.drag === g || (p && p.over && !s.drag && figureAt(p.x, p.y, w, h) === g);
      ctx.textAlign = 'center';
      ctx.fillStyle = hot ? accent : fg;
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(g.text(f.value(g.id)), g.x, h - 46);
      ctx.fillStyle = muted;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(g.label + '  ↕', g.x, h - 24);
    }
  },
  pointer(e, f) {
    const s = f.state, g = figureAt(e.x, e.y, f.w, f.h);
    if (e.type === 'down') {
      s.drag = g || 'form';
      Object.assign(s, { x0: e.x, y0: e.y, d0: f.value('kdepth'), b0: f.value('kbpm'), v0: g ? f.value(g.id) : 0 });
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    if (e.type === 'move' && s.drag === 'form') {
      f.set('kdepth', Math.max(0, Math.min(1, s.d0 + (s.y0 - e.y) / 260)));
      f.set('kbpm', Math.max(3, Math.min(10, s.b0 + (e.x - s.x0) / 70)));
    } else if (e.type === 'move' && s.drag) {
      const r = f.range(s.drag.id);
      f.set(s.drag.id, Math.max(r.min, Math.min(r.max, s.v0 + (s.y0 - e.y) * s.drag.per(s.v0))));
    }
    f.cursor(s.drag ? (s.drag === 'form' ? 'move' : 'ns-resize') : g ? 'ns-resize' : 'move');
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
        ...control('mlevel', 'ui.meter', 'Level', null, r(36, 470, 64, 4)),
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
              bg: '#2b1236',
              fg: '#ffe6d2',
              accent: '#ff9f6b',
              track: '#4a2257',
              knob: '#3a1747',
              pointer: '#ffe6d2',
              muted: '#d9a08a',
              glow: '#ff9f6b',
              font: 'michroma',
              labelFont: 'michroma',
              valueFont: 'michroma',
            },
            background: [
              { kind: 'color', color: '#2b1236' },
              {
                kind: 'linear',
                angle: 180,
                stops: [
                  { color: '#2b123600', at: 0.4 },
                  { color: '#1e0b27', at: 1 },
                ],
              },
            ],
            skins: { meter: { name: 'bar', params: {} } },
          },
        },
        el({ kind: 'canvas', name: 'The breathing form', code: SCENE, rect: r(0, 0, 760, 500) }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'Exhale',
          rect: r(32, 438, 200, 24),
          textStyle: { font: 'michroma', size: 15, color: 'fg', align: 'left' },
        }),
      ],
    ],
  );
}

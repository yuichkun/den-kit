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
// and Graphics), an app of calm evening scenes made to wind down to: one quiet
// scene with soft, low colours and slow motion, little text, and nothing that
// asks for attention. Here the scene breathes with the sound: the moon grows
// and the hills rise a little as the breath comes in, and settle as it goes out.
import type { Catalog } from '../../work/catalog.ts';
import {
  add,
  asset,
  control,
  el,
  onlyParams,
  patchControl,
  r,
  wire,
  workInSteps,
} from './build.ts';

/** The scene: hills, a moon behind them, dust; it breathes with the sound. */
export const SCENE = `// A night scene that breathes with the sound: three hills, a moon rising
// behind them, dust drifting up. How full the breath is comes from the output
// level, eased and placed between the quietest and loudest of the last few
// breaths, so the picture moves with what is heard: on the way in the moon
// grows and the hills rise a little; on the way out they settle.
const TAU = Math.PI * 2;
const HILLS = [
  { color: '#3a3470', base: 0.6, amp: 26, f: 0.006, p: 0.4, lift: 5 },
  { color: '#2a2659', base: 0.67, amp: 20, f: 0.009, p: 2.1, lift: 9 },
  { color: '#1b1a40', base: 0.74, amp: 16, f: 0.013, p: 4.2, lift: 14 },
];
const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => 'rgb(' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t)).join(',') + ')';
export default {
  setup(ctx, f) {
    Object.assign(f.state, {
      lvl: 0, lo: 1, hi: 0, b: 0,
      dust: Array.from({ length: 46 }, (_, i) => ({ x: (i * 97.3) % 1, y: (i * 61.7) % 1, s: 0.4 + ((i * 13) % 7) / 7, v: 0.004 + ((i * 7) % 5) / 900 })),
    });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    // How full the breath is.
    s.lvl += (f.level - s.lvl) * Math.min(1, f.dt * 3);
    s.hi = s.lvl > s.hi ? s.lvl : s.hi - (s.hi - s.lvl) * f.dt * 0.05;
    s.lo = s.lvl < s.lo ? s.lvl : s.lo + (s.lvl - s.lo) * f.dt * 0.05;
    const full = s.hi - s.lo > 1e-4 ? (s.lvl - s.lo) / (s.hi - s.lo) : 0;
    s.b += (Math.max(0, Math.min(1, full)) - s.b) * Math.min(1, f.dt * 2);
    const b = s.b;
    ctx.clearRect(0, 0, w, h);
    // The moon, behind the hills, growing with the breath; still rings round it.
    const mx = w * 0.66, my = h * 0.48, mr = 44 + 28 * b;
    ctx.strokeStyle = '#f3dcb6';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = (0.05 + 0.1 * b) * (1 - i / 4);
      ctx.beginPath(); ctx.arc(mx, my, mr + i * 18 * (0.6 + b), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = mix('#e9cfa6', '#f6e3c3', b);
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    // Dust drifting up, a little faster on the way in.
    ctx.fillStyle = '#f3eee6';
    for (const d of s.dust) {
      d.y -= d.v * f.dt * (0.6 + b) * 6;
      if (d.y < -0.02) d.y = 1.02;
      ctx.globalAlpha = 0.18 + 0.25 * Math.abs(Math.sin(f.t * 0.7 + d.x * 9));
      ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The hills, nearer ones rising more.
    for (const q of HILLS) {
      const base = h * q.base - q.lift * b;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, base + Math.sin(x * q.f + q.p) * q.amp + Math.sin(x * q.f * 2.3 + q.p * 1.7) * q.amp * 0.4);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  },
};
`;

export function breath(catalog: Catalog) {
  const row = { skin: { name: 'bar', params: { radius: 3, label: 'top' } } };
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
        // ---- the plugin: a quiet night that breathes ----
        asset('assets/den-kit/starfield.jpg'),
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#15132f',
              fg: '#f3eee6',
              accent: '#f0d3a4',
              track: '#ffffff26',
              knob: '#1f1c44',
              pointer: '#f3eee6',
              muted: '#bdb6d8',
              glow: '#f0d3a4',
              font: 'lato',
              labelFont: 'lato',
              valueFont: 'lato',
            },
            background: [
              { kind: 'image', asset: 'assets/den-kit/starfield.jpg', fit: 'cover' },
              {
                kind: 'linear',
                angle: 180,
                stops: [
                  { color: '#100e28cc', at: 0 },
                  { color: '#2a2358b3', at: 0.55 },
                  { color: '#4a3a6ecc', at: 1 },
                ],
              },
            ],
            skins: { slider: { name: 'bar', params: { radius: 3, label: 'top' } } },
            css: [
              'dk-slider { position: relative; }',
              'dk-slider::part(label) { text-align: left; font-size: 11px; color: var(--dk-muted); }',
              'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 11px; color: var(--dk-fg); }',
              'dk-slider::part(track) { max-height: 3px; margin-top: 9px; }',
            ].join('\n'),
          },
        },
        el({ kind: 'canvas', name: 'The night', code: SCENE, rect: r(0, 0, 760, 500) }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'Exhale',
          rect: r(48, 40, 300, 46),
          textStyle: { font: 'playfair-display', size: 40, color: 'fg', align: 'left' },
        }),
        el({
          kind: 'text',
          name: 'Subtitle',
          text: 'A room that breathes slowly. Breathe in as the moon grows, out as it settles.',
          rect: r(48, 92, 420, 34),
          textStyle: { size: 13, color: 'muted', align: 'left', lineHeight: 1.4 },
        }),
        el({
          kind: 'shape',
          shape: 'rect',
          name: 'Settings',
          rect: r(24, 396, 712, 80),
          locked: true,
          style: {
            radius: 20,
            fill: [{ kind: 'color', color: '#12102ad9' }],
            stroke: { color: '#ffffff1f', width: 1, style: 'solid' },
          },
        }),
        ...control('kbpm', 'ui.slider', 'Breaths a minute', 'rate1.a', r(48, 418, 150, 38), {
          min: 3,
          max: 10,
          value: 6,
          style: row,
        }),
        ...control('kdepth', 'ui.slider', 'Depth', ['deep1.b', 'bamt1.b'], r(222, 418, 150, 38), {
          min: 0,
          max: 1,
          value: 0.8,
          style: row,
        }),
        ...control('kwarm', 'ui.slider', 'Warmth', 'cut1.hz', r(396, 418, 150, 38), {
          min: 200,
          max: 1600,
          scale: 'log',
          unit: 'Hz',
          value: 520,
          style: row,
        }),
        ...control('kspace', 'ui.slider', 'Hall', 'hall1.mix', r(570, 418, 150, 38), {
          min: 0,
          max: 1,
          value: 0.45,
          style: row,
        }),
      ],
    ],
  );
}
